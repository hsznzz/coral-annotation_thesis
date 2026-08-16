import { supabase } from './supabaseClient.js';

/**
 * Attach the patch's already-public R2 URL, plus the parent image's
 * metadata, to a raw patch row.
 *
 * MIGRATION NOTE (Cloudflare R2 cutover): patches.storage_path used to be a
 * Supabase Storage object key that had to be exchanged for a short-lived
 * signed URL via supabase.storage.from(bucket).createSignedUrl(). Since the
 * R2 migration, upload_to_r2_and_populate_supabase.py writes storage_path as
 * the FULL public r2.dev URL directly -- there's no signing step, no bucket
 * lookup, and no expiry to manage. Using it as-is here is the correct
 * behavior for a public bucket, not a shortcut.
 */
async function hydratePatch(patch) {
  if (!patch) return null;

  const { data: image, error: imageError } = await supabase
    .from('images')
    .select('id, filename, metadata')
    .eq('id', patch.image_id)
    .single();

  if (imageError) {
    throw new Error(`Failed to load image metadata: ${imageError.message}`);
  }

  return {
    id: patch.id,
    imageId: patch.image_id,
    patchIndex: patch.patch_index,
    imageUrl: patch.storage_path,
    x: patch.x,
    y: patch.y,
    width: patch.width,
    height: patch.height,
    status: patch.status,
    lockedBy: patch.locked_by,
    lockedAt: patch.locked_at,
    image: {
      id: image.id,
      filename: image.filename,
      metadata: image.metadata || {},
    },
  };
}

export const patchesApi = {
  /**
   * Atomically claim the next unannotated (and unlocked, or stale-locked)
   * patch for the current user. Per-annotator assignment is enforced
   * server-side inside the claim_next_patch RPC via
   * patches.assigned_annotator_id -- this function doesn't need to know or
   * care which annotator it's talking to. Returns null if none are left.
   * @param {string|null} excludePatchId - when skipping a patch without
   *   saving it, pass its id so the RPC won't just hand it straight back.
   */
  async claimNextPatch(excludePatchId = null) {
    const { data, error } = await supabase.rpc('claim_next_patch', {
      p_exclude_patch_id: excludePatchId,
    });
    if (error) throw new Error(`Failed to claim next patch: ${error.message}`);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return hydratePatch(row);
  },

  /** Fetch a single patch by id (used for "previous" navigation). */
  async getPatchById(patchId) {
    const { data, error } = await supabase
      .from('patches')
      .select('*')
      .eq('id', patchId)
      .single();

    if (error) throw new Error(`Failed to load patch: ${error.message}`);
    return hydratePatch(data);
  },

  /** Release a lock without saving, e.g. on unmount/logout. */
  async releaseLock(patchId) {
    const { error } = await supabase.rpc('release_patch_lock', { p_patch_id: patchId });
    if (error) throw new Error(`Failed to release patch lock: ${error.message}`);
  },

  /**
   * Progress counters: total patches, annotated, remaining, and a
   * breakdown of annotated counts per label.
   */
  async getProgress() {
    const { count: total, error: totalError } = await supabase
      .from('patches')
      .select('*', { count: 'exact', head: true });
    if (totalError) throw new Error(`Failed to load progress: ${totalError.message}`);

    const { count: annotated, error: annotatedError } = await supabase
      .from('patches')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'annotated');
    if (annotatedError) throw new Error(`Failed to load progress: ${annotatedError.message}`);

    const { data: labelRows, error: labelError } = await supabase
      .from('annotations')
      .select('label');
    if (labelError) throw new Error(`Failed to load label counts: ${labelError.message}`);

    const counts = { LC: 0, PB: 0, DC: 0, DCA: 0 };
    for (const row of labelRows || []) {
      if (counts[row.label] != null) counts[row.label] += 1;
    }

    return {
      total: total || 0,
      annotated: annotated || 0,
      remaining: (total || 0) - (annotated || 0),
      counts,
    };
  },

  /**
   * MIGRATION NOTE: pre-R2 this exchanged a Supabase Storage key for a
   * signed URL. patches.storage_path is now already a full public R2 URL,
   * so there's nothing left to sign -- kept as a passthrough only so any
   * existing caller (you mentioned an admin bulk image export) doesn't
   * break. If you share that file, I can remove this indirection entirely
   * instead of leaving a shim.
   */
  async getPatchSignedUrl(storagePath) {
    return storagePath;
  },

  /**
   * Same story as getPatchSignedUrl. Note images.storage_path is currently
   * NULL for every row -- this batch only uploaded patches to R2, not full
   * source images -- so this will return null/undefined until that changes.
   */
  async getImageSignedUrl(storagePath) {
    return storagePath;
  },
};