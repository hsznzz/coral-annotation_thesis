# Coral Annotation Tool

A web app for marine biologists to annotate coral image patches into four
classes: **Living Coral (LC)**, **Partially Bleached (PB)**, **Dead Coral
(DC)**, and **Dead Coral with Algae (DCA)**.

Built with React + Vite, Tailwind CSS, React Router, Supabase (Auth,
Postgres, Storage, Row Level Security), and react-zoom-pan-pinch.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a Supabase project, then copy `.env.example` to `.env` and fill
   in your project's URL and **anon** key (Project Settings → API):
   ```bash
   cp .env.example .env
   ```
   Never put a service-role/secret key here — anything prefixed `VITE_`
   is bundled into the client JS and shipped to the browser.

3. Run the database migration in `supabase/migrations/0001_init.sql`
   against your project (Supabase dashboard → SQL Editor, paste and run).
   This creates the schema, RLS policies, storage buckets, and the
   `claim_next_patch` / `save_annotation` functions the app depends on.

4. Upload your source images to the `coral-images` bucket and populate
   the `images` and `patches` tables (patch crops go in `coral-patches`).
   The first user who ever signs up automatically becomes an admin.

   If your patches are already organized as
   `<site>/<transect>/<source-photo-folder>/<patch-file>.jpg` (e.g. a
   GoPro dive export), you can bulk-import them instead of doing this by
   hand — see **Bulk importing patch images** below.

5. Start the dev server:
   ```bash
   npm run dev
   ```

## Environment variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase project's public anon key |

## Bulk importing patch images

`scripts/import-coral-garden.mjs` walks a folder shaped like:

```
Coral Garden/
  2024_JUL_CG_S/
    CG-S_T1/
      GOPR3088/
        Coral1.JPG
        Coral2.JPG
```

...and creates one `images` row per source-photo folder (`GOPR3088`),
uploads every patch inside it to the `coral-patches` bucket, and creates
one `patches` row per file. It also picks up site, transect, and date
from the folder names automatically.

**Setup (one-time):**
1. Copy `.env.import.example` to `.env.import` and fill in your project
   URL and **service_role/secret key** (Project Settings → API Keys →
   Secret keys). This file is separate from `.env` on purpose — the
   service_role key bypasses Row Level Security, so it must never be
   used anywhere in the actual app, only in this local script.
2. Run:
   ```bash
   node scripts/import-coral-garden.mjs "/path/to/Coral Garden"
   ```
   (point it at the top-level folder itself — the one whose direct
   children are your site folders)

The script is safe to re-run — anything already imported is skipped, so
if it's interrupted partway through, just run it again.

## Deployment

Frontend deploys to Vercel (or any static host) as a standard Vite build
(`npm run build` → `dist/`). Supabase hosts Auth, Postgres, and Storage —
no custom backend server is required.
