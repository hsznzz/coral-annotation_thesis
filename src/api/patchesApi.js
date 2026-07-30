import { supabase } from './supabaseClient.js';

const IMAGE_BUCKET = 'coral-images';
const PATCH_BUCKET = 'coral-patches';
const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 minutes

/**
 * Attach a short-lived signed URL (patches are stored in a private bucket)
 * plus the parent image's metadata to a raw patch row.
 */
async function hydratePatch(patch) {
  if (!patch) return null;

  const { data: signed, error: signError } = await supabase.storage
    .from(PATCH_BUCKET)
    .createSignedUrl(patch.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signError) {
    throw new Error(`Failed to create signed URL for patch: ${signError.message}`);
  }

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
    imageUrl: signed.signedUrl,
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
   * patch for the current user. Returns null if none are left.
   * @param {string|null} excludePatchId - when skipping a patch without
   *   saving it, pass its id so the RPC won't just hand it straight back
   *   (it would otherwise still be the lowest-index patch locked to you).
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

  /** Signed URL for a given patch's storage_path — used by the admin bulk image export. */
  async getPatchSignedUrl(storagePath) {
    const { data, error } = await supabase.storage
      .from(PATCH_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (error) throw new Error(`Failed to sign patch URL: ${error.message}`);
    return data.signedUrl;
  },

  /** Public helper if you ever need a signed URL for a full source image. */
  async getImageSignedUrl(storagePath) {
    const { data, error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (error) throw new Error(`Failed to sign image URL: ${error.message}`);
    return data.signedUrl;
  },
};
