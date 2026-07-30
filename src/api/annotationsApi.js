import { supabase } from './supabaseClient.js';

export const annotationsApi = {
  /**
   * Save (insert or update) the annotation for a patch, and mark the
   * patch as annotated + release its lock — all atomically server-side.
   * `note` is required by the database when label is 'OTHER'.
   */
  async saveAnnotation(patchId, label, note = null) {
    const { data, error } = await supabase.rpc('save_annotation', {
      p_patch_id: patchId,
      p_label: label,
      p_note: note,
    });
    if (error) throw new Error(`Failed to save annotation: ${error.message}`);
    return data;
  },

  /** Get the annotation (if any) for a specific patch. */
  async getByPatchId(patchId) {
    const { data, error } = await supabase
      .from('annotations')
      .select('*')
      .eq('patch_id', patchId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load annotation: ${error.message}`);
    return data;
  },

  /**
   * Admin dashboard: paginated, filterable, searchable list of
   * annotations joined with patch + image info.
   */
  async listAnnotations({ label = null, search = '', page = 0, pageSize = 25, annotatorId = null } = {}) {
    let query = supabase
      .from('annotations')
      .select(
        `
        id, label, note, created_at, updated_at, annotator_id,
        patches:patch_id ( id, patch_index, storage_path, image_id,
          images:image_id ( id, filename ) )
      `,
        { count: 'exact' }
      )
      .order('updated_at', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (label) {
      query = query.eq('label', label);
    }
    if (annotatorId) {
      query = query.eq('annotator_id', annotatorId);
    }

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to load annotations: ${error.message}`);

    let rows = (data || []).map((row) => ({
      id: row.id,
      label: row.label,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      annotatorId: row.annotator_id,
      patchId: row.patches?.id,
      patchIndex: row.patches?.patch_index,
      patchStoragePath: row.patches?.storage_path,
      imageId: row.patches?.images?.id,
      imageFilename: row.patches?.images?.filename,
    }));

    // Search by image filename or patch id (client-side filter on the
    // current page's join result — cheap because pages are small; for a
    // very large dataset this could move into a Postgres full-text/ILIKE
    // query instead).
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.patchId?.toLowerCase().includes(needle) ||
          r.imageFilename?.toLowerCase().includes(needle)
      );
    }

    return { rows, total: count || 0 };
  },

  /** Admin: change/correct an existing annotation's label (and note, e.g. for OTHER). */
  async updateLabel(annotationId, label, note = null) {
    const { data, error } = await supabase
      .from('annotations')
      .update({ label, note: label === 'OTHER' ? note : null })
      .eq('id', annotationId)
      .select()
      .single();
    if (error) throw new Error(`Failed to update annotation: ${error.message}`);
    return data;
  },

  /** Stats used by both the progress bar and the admin dashboard. */
  async getStats() {
    const { data, error } = await supabase.from('annotations').select('label, annotator_id');
    if (error) throw new Error(`Failed to load stats: ${error.message}`);

    const byLabel = { LC: 0, PB: 0, DC: 0, DCA: 0, OTHER: 0 };
    const byAnnotator = {};
    for (const row of data || []) {
      if (byLabel[row.label] != null) byLabel[row.label] += 1;
      byAnnotator[row.annotator_id] = (byAnnotator[row.annotator_id] || 0) + 1;
    }

    return { byLabel, byAnnotator, totalAnnotations: data?.length || 0 };
  },

  /**
   * Export every annotation (joined with patch/image info) as a CSV
   * string, ready to hand to a Blob download.
   */
  async exportCsv() {
    const { data, error } = await supabase
      .from('annotations')
      .select(
        `
        id, label, note, created_at, updated_at, annotator_id,
        patches:patch_id ( id, patch_index, image_id,
          images:image_id ( filename ) )
      `
      )
      .order('updated_at', { ascending: false });

    if (error) throw new Error(`Failed to export annotations: ${error.message}`);

    const header = [
      'annotation_id',
      'patch_id',
      'patch_index',
      'image_id',
      'image_filename',
      'label',
      'note',
      'annotator_id',
      'created_at',
      'updated_at',
    ];

    const escapeCsv = (val) => {
      const str = val == null ? '' : String(val);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const lines = [header.join(',')];
    for (const row of data || []) {
      lines.push(
        [
          row.id,
          row.patches?.id,
          row.patches?.patch_index,
          row.patches?.image_id,
          row.patches?.images?.filename,
          row.label,
          row.note,
          row.annotator_id,
          row.created_at,
          row.updated_at,
        ]
          .map(escapeCsv)
          .join(',')
      );
    }

    return lines.join('\n');
  },

  /**
   * Everything needed to build the "export images by label" ZIP: every
   * annotation joined with its patch's storage path and source filename.
   */
  async listForImageExport() {
    const { data, error } = await supabase
      .from('annotations')
      .select(
        `
        id, label, note,
        patches:patch_id ( id, patch_index, storage_path,
          images:image_id ( filename ) )
      `
      )
      .order('label', { ascending: true });
    if (error) throw new Error(`Failed to load annotations for export: ${error.message}`);

    return (data || [])
      .filter((row) => row.patches?.storage_path)
      .map((row) => ({
        annotationId: row.id,
        label: row.label,
        note: row.note,
        patchId: row.patches.id,
        patchIndex: row.patches.patch_index,
        storagePath: row.patches.storage_path,
        sourceFilename: row.patches.images?.filename || '',
      }));
  },
};
