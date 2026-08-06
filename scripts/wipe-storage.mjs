/**
 * One-time wipe script — empties the `coral-patches` Storage bucket
 * completely, recursively (Storage's own `list()` only returns one folder
 * level at a time, so this walks every subfolder itself).
 *
 * This does NOT touch the database. Pair it with:
 *   delete from public.images;
 * run in the Supabase SQL Editor — that cascades and removes all
 * `patches`, `annotations`, and `annotation_change_requests` rows too.
 * Do the DB delete and this Storage wipe together; if you have leftover
 * files in Storage but no DB rows for them (or vice versa), things get
 * confusing fast.
 *
 * Usage (same .env.import file as import-coral-garden.mjs):
 *   node scripts/wipe-storage.mjs
 *
 * It'll print how many files it's about to permanently delete and wait
 * for you to confirm before doing anything.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUCKET = 'coral-patches';

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

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Recursively collect every file path in the bucket under `prefix`. */
async function listAllFiles(prefix = '') {
  const files = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`Listing "${prefix}" failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Folders come back with id === null; files have metadata.
      if (entry.id === null) {
        files.push(...(await listAllFiles(fullPath)));
      } else {
        files.push(fullPath);
      }
    }

    if (data.length < limit) break;
    offset += limit;
  }
  return files;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

async function main() {
  console.log(`Scanning "${BUCKET}" bucket...`);
  const files = await listAllFiles();
  console.log(`Found ${files.length} files in "${BUCKET}".`);

  if (files.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  const answer = await ask(`Type DELETE to permanently remove all ${files.length} files: `);
  if (answer.trim() !== 'DELETE') {
    console.log('Aborted — nothing was deleted.');
    return;
  }

  const BATCH = 100;
  let removed = 0;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) {
      console.error(`Failed removing batch starting at ${i}: ${error.message}`);
      continue;
    }
    removed += batch.length;
    console.log(`... deleted ${removed}/${files.length}`);
  }

  console.log('\nDone. Storage bucket is now empty.');
  console.log('Don\'t forget to also run `delete from public.images;` in the SQL Editor if you haven\'t yet.');
}

main().catch((err) => {
  console.error('Wipe failed:', err);
  process.exit(1);
});
