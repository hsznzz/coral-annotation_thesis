import { supabase } from './supabaseClient.js';

/**
 * Annotators can't edit a saved annotation directly — only admins can.
 * Instead, an annotator files a "change request" (proposed label + reason)
 * against an existing annotation; an admin reviews it and either approves
 * (which applies the new label) or rejects it. Everything routes through
 * security-definer RPCs in 0004_skip_fix_and_change_requests.sql.
 */
export const changeRequestsApi = {
  /** File (or update, if one's already pending) a change request. */
  async create(annotationId, requestedLabel, requestedNote = null, reason = null) {
    const { data, error } = await supabase.rpc('request_annotation_change', {
      p_annotation_id: annotationId,
      p_requested_label: requestedLabel,
      p_requested_note: requestedNote,
      p_reason: reason,
    });
    if (error) throw new Error(`Failed to submit change request: ${error.message}`);
    return data;
  },

  /** Admin only: approve or reject a pending request. */
  async review(requestId, approve, reviewNote = null) {
    const { data, error } = await supabase.rpc('review_change_request', {
      p_request_id: requestId,
      p_approve: approve,
      p_review_note: reviewNote,
    });
    if (error) throw new Error(`Failed to review change request: ${error.message}`);
    return data;
  },

  /** Admin dashboard: every pending request, oldest first. */
  async listPending() {
    const { data, error } = await supabase
      .from('annotation_change_requests')
      .select(
        `
        id, annotation_id, patch_id, requested_by, current_label,
        requested_label, requested_note, reason, status, created_at,
        patches:patch_id ( patch_index, storage_path,
          images:image_id ( filename ) )
      `
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Failed to load change requests: ${error.message}`);
    return data || [];
  },

  /** All change requests filed by one annotator (any status), newest first. */
  async listMine(userId) {
    const { data, error } = await supabase
      .from('annotation_change_requests')
      .select('id, annotation_id, requested_label, status, created_at, reviewed_at, review_note')
      .eq('requested_by', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to load your change requests: ${error.message}`);
    return data || [];
  },
};
