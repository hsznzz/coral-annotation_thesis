/**
 * One-time bulk import script.
 *
 * Walks a folder shaped like:
 *
 *   Coral Garden/
 *     2024_JUL_CG_S/
 *       CG-S_T1/
 *         GOPR3088/
 *           Coral1.JPG
 *           Coral2.JPG
 *           ...
 *
 * ...and for each "GOPR####"-style folder creates one `images` row, then
 * uploads every file inside it to the `coral-patches` Storage bucket and
 * creates a matching `patches` row.
 *
 * SAFE TO RE-RUN: already-imported images/patches are skipped, and file
 * uploads use `upsert: true`, so if the script dies partway through
 * (network blip, etc.) you can just run it again.
 *
 * Usage:
 *   1. Create a file named `.env.import` in the project root (NOT `.env`
 *      — keep this separate, and never commit it) containing:
 *        SUPABASE_URL=https://yourprojectref.supabase.co
 *        SUPABASE_SERVICE_ROLE_KEY=your-secret-service-role-key
 *      Get the service_role/secret key from Project Settings → API Keys
 *      → Secret keys. This key bypasses Row Level Security, which is
 *      exactly what a bulk admin import needs — but it must NEVER be
 *      used anywhere in the frontend app, only here, run locally.
 *
 *   2. Run:
 *        node scripts/import-coral-garden.mjs "/path/to/Coral Garden"
 *
 *      (the path is the top-level folder itself — the one whose direct
 *      children are your site folders, e.g. "2024_JUL_CG_S")
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PATCH_BUCKET = 'coral-patches';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

// --- Load .env.import (kept separate from the app's own .env) ----------
function loadEnvImport() {
  const envPath = path.join(__dirname, '..', '.env.import');
  if (!fs.existsSync(envPath)) {
    console.error(`Missing ${envPath}. Create it with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvImport();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in .env.import');
  process.exit(1);
}

const rootArg = process.argv[2];
if (!rootArg) {
  console.error('Usage: node scripts/import-coral-garden.mjs "/path/to/Coral Garden"');
  process.exit(1);
}
const ROOT = path.resolve(rootArg);
if (!fs.existsSync(ROOT)) {
  console.error(`Path not found: ${ROOT}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Retry a flaky async operation a couple of times with a short delay —
 * long imports over hundreds/thousands of requests will occasionally hit
 * a transient network blip that has nothing to do with the data itself. */
async function withRetry(fn, { retries = 2, delayMs = 1500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await fn();
    if (!result?.error) return result;
    lastErr = result.error;
    const message = String(lastErr?.message || lastErr);
    // Only retry things that look transient (network/gateway), not real
    // data errors (bad label, constraint violation, etc.) — those would
    // just fail the same way every time.
    const looksTransient = /fetch failed|network|timeout|ECONNRESET|<html/i.test(message);
    if (!looksTransient || attempt === retries) return result;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { error: lastErr };
}

// --- Metadata parsing ----------------------------------------------------
const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "2024_JUL_CG_S" or "JULY 2024_CG_D" -> { year: '2024', month: '07' } | {} */
function parseDateFromFolder(name) {
  const yearMatch = name.match(/(19|20)\d{2}/);
  const monthMatch = name
    .toLowerCase()
    .match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/);
  const result = {};
  if (yearMatch) result.year = yearMatch[0];
  if (monthMatch) result.month = MONTHS[monthMatch[0]];
  return result;
}

/** "CG-S_T1" -> { site: 'CG-S', transect: 'T1' } | null if it doesn't match */
function parseTransectFolder(name) {
  const m = name.match(/^(.+)_T(\d+)$/i);
  if (!m) return null;
  return { site: m[1], transect: `T${m[2]}` };
}

/** "Coral12.JPG" -> 12 | null */
function parsePatchIndex(filename) {
  const m = filename.match(/(\d+)(?=\.[^.]+$)/);
  return m ? parseInt(m[1], 10) : null;
}

// --- Main walk -------------------------------------------------------------
// Depth-agnostic: recurses through however many organizational folders exist
// (site, date, batch, session, transect, whatever) and treats ANY folder
// that directly contains image files as one "source image" — its image
// files become patches. This means it doesn't matter how many extra levels
// of segregation sit between the root and the GOPR-style folders.
async function main() {
  let imagesCreated = 0;
  let imagesSkipped = 0;
  let patchesCreated = 0;
  let patchesSkipped = 0;
  let uploadFailures = [];
  let sourceFoldersSeen = 0;
  let filesSeen = 0;

  async function processSourceFolder(dirPath, relPath, pathSegments) {
    // NOTE: uses !isDirectory() rather than isFile() — OneDrive/cloud-sync
    // "Files On-Demand" placeholder files show up as reparse points on
    // Windows, and Node's isFile() can fail to recognize those even though
    // they're real files. !isDirectory() + the extension check is safer.
    const files = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((f) => !f.isDirectory() && IMAGE_EXTENSIONS.has(path.extname(f.name).toLowerCase()));

    if (files.length === 0) return;

    sourceFoldersSeen++;
    const folderName = pathSegments[pathSegments.length - 1];

    // Best-effort metadata: scan every path segment for a transect-style
    // name ("CG-S_T1") and a date (year + month name) anywhere in the path.
    let transectInfo = null;
    let dateInfo = {};
    for (const seg of pathSegments) {
      if (!transectInfo) transectInfo = parseTransectFolder(seg);
      const d = parseDateFromFolder(seg);
      if (d.year && d.month) dateInfo = d;
    }

    const metadata = {
      path: pathSegments.join('/'),
      source_folder: folderName,
      ...(transectInfo ? { site: transectInfo.site, transect: transectInfo.transect } : {}),
      ...(dateInfo.year && dateInfo.month ? { capture_date: `${dateInfo.year}-${dateInfo.month}` } : {}),
    };

    // --- images row (one per source folder) ---
    let imageId;
    const { data: existingImage, error: findImageErr } = await withRetry(() =>
      supabase.from('images').select('id').eq('storage_path', relPath).maybeSingle()
    );
    if (findImageErr) {
      console.error(`Failed checking existing image for ${relPath}: ${findImageErr.message}`);
      uploadFailures.push({ path: relPath, error: `check existing image: ${findImageErr.message}` });
      return;
    }

    if (existingImage) {
      imageId = existingImage.id;
      imagesSkipped++;
    } else {
      const { data: inserted, error: insertImageErr } = await withRetry(() =>
        supabase.from('images').insert({ filename: folderName, storage_path: relPath, metadata }).select('id').single()
      );
      if (insertImageErr) {
        console.error(`Failed creating image row for ${relPath}: ${insertImageErr.message}`);
        uploadFailures.push({ path: relPath, error: `create image: ${insertImageErr.message}` });
        return;
      }
      imageId = inserted.id;
      imagesCreated++;
    }

    // --- patches (one per file) ---
    for (const file of files) {
      filesSeen++;
      const patchIndex = parsePatchIndex(file.name);
      if (patchIndex === null) {
        console.warn(`Skipping ${file.name} in ${relPath}: couldn't parse a patch number from the filename`);
        continue;
      }

      const storagePath = `${relPath}/${file.name}`;

      const { data: existingPatch, error: findPatchErr } = await withRetry(() =>
        supabase.from('patches').select('id').eq('image_id', imageId).eq('patch_index', patchIndex).maybeSingle()
      );
      if (findPatchErr) {
        console.error(`Failed checking existing patch ${storagePath}: ${findPatchErr.message}`);
        uploadFailures.push({ path: storagePath, error: `check existing patch: ${findPatchErr.message}` });
        continue;
      }
      if (existingPatch) {
        patchesSkipped++;
        continue;
      }

      const filePath = path.join(dirPath, file.name);
      const fileBuffer = fs.readFileSync(filePath);
      const contentType = path.extname(file.name).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';

      const { error: uploadErr } = await withRetry(() =>
        supabase.storage.from(PATCH_BUCKET).upload(storagePath, fileBuffer, { contentType, upsert: true })
      );
      if (uploadErr) {
        uploadFailures.push({ path: storagePath, error: `upload: ${uploadErr.message}` });
        console.error(`Upload failed for ${storagePath}: ${uploadErr.message}`);
        continue;
      }

      const { error: insertPatchErr } = await withRetry(() =>
        supabase.from('patches').insert({ image_id: imageId, patch_index: patchIndex, storage_path: storagePath })
      );
      if (insertPatchErr) {
        uploadFailures.push({ path: storagePath, error: `insert patch row: ${insertPatchErr.message}` });
        console.error(`Patch row failed for ${storagePath}: ${insertPatchErr.message}`);
        continue;
      }

      patchesCreated++;
      if (filesSeen % 50 === 0) {
        console.log(`... ${filesSeen} files processed so far`);
      }
    }
  }

  async function walk(dirPath, pathSegments) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const subdirs = entries.filter((e) => e.isDirectory());

    // If this folder directly contains image files, treat it as one source image.
    await processSourceFolder(dirPath, pathSegments.join('/'), pathSegments);

    // Always keep recursing, in case organizational folders and image
    // folders are mixed at the same level.
    for (const sub of subdirs) {
      await walk(path.join(dirPath, sub.name), [...pathSegments, sub.name]);
    }
  }

  await walk(ROOT, []);

  console.log('\n--- Import complete ---');
  console.log(`Source folders seen (folders with image files): ${sourceFoldersSeen}`);
  console.log(`Images created: ${imagesCreated} (skipped, already existed: ${imagesSkipped})`);
  console.log(`Patches created: ${patchesCreated} (skipped, already existed: ${patchesSkipped})`);
  if (uploadFailures.length > 0) {
    console.log(`\n${uploadFailures.length} failures — re-run the script to retry just these:`);
    for (const f of uploadFailures) console.log(`  - ${f.path}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
