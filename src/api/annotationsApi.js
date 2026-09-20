import { supabase } from './supabaseClient.js';

// Supabase/PostgREST caps any single select() at 1,000 rows by default,
// silently -- no error, just a truncated result. Anything that expects to
// return more than that (both functions below, once past 1,000 total
// annotations) must page through with .range() until a page comes back
// shorter than PAGE_SIZE.
const EXPORT_PAGE_SIZE = 1000;

async function fetchAllRows(buildQuery) {
  const rows = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const to = from + EXPORT_PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < EXPORT_PAGE_SIZE) break;
    from += EXPORT_PAGE_SIZE;
  }
  return rows;
}

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
   * annotations joined with patch + image info. Deliberately NOT routed
   * through fetchAllRows -- this is UI-driven page-at-a-time browsing
   * (pageSize is small, e.g. 20), not a full export, so a single .range()
   * call is correct here already.
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
      .order('id', { ascending: true })
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

  /**
   * Stats used by both the progress bar and the admin dashboard. Uses
   * `head: true` count-only queries throughout, so these were never
   * subject to the 1,000-row select cap that affected exportCsv() below --
   * the progress numbers you've been seeing have been accurate all along.
   */
  async getStats() {
    const byLabel = { LC: 0, PB: 0, DC: 0, DCA: 0, OTHER: 0 };
    const labels = Object.keys(byLabel);
    const [{ count: totalAnnotations, error: totalError }, ...labelResults] = await Promise.all([
      supabase.from('annotations').select('*', { count: 'exact', head: true }),
      ...labels.map((label) =>
        supabase.from('annotations').select('*', { count: 'exact', head: true }).eq('label', label)
      ),
    ]);

    if (totalError) throw new Error(`Failed to load stats: ${totalError.message}`);
    for (let index = 0; index < labels.length; index++) {
      const { count, error } = labelResults[index];
      if (error) throw new Error(`Failed to load ${labels[index]} stats: ${error.message}`);
      byLabel[labels[index]] = count || 0;
    }

    return { byLabel, totalAnnotations: totalAnnotations || 0 };
  },

  /**
   * Export every annotation (joined with patch/image info) as a CSV
   * string, ready to hand to a Blob download.
   *
   * FIX 1 (patch-locating bug): this previously never selected
   * `patch_relpath` or `storage_path`, so the exported CSV had no way to
   * point back to an actual patch file, local or remote. Both are now
   * included — `patch_relpath` mirrors the relative path already used in
   * `patches_manifest_refined.csv`, `storage_path` is the full public R2
   * URL, either is enough to locate the file.
   *
   * FIX 2 (1,000-row cap): Supabase/PostgREST silently truncates any
   * unpaginated select() at 1,000 rows. With 5,000+ annotations this was
   * exporting only the newest 1,000. Now pages through fetchAllRows()
   * until a short page signals the end. Ordering by `updated_at desc, id
   * asc` (rather than `updated_at` alone) keeps that pagination correct
   * even when multiple rows share a timestamp -- without a fully
   * deterministic order, .range() paging can skip or duplicate rows
   * across page boundaries.
   */
  async exportCsv() {
    let data;
    try {
      data = await fetchAllRows((from, to) =>
        supabase
          .from('annotations')
          .select(
            `
            id, label, note, created_at, updated_at, annotator_id,
            patches:patch_id ( id, patch_index, image_id, patch_relpath, storage_path,
              images:image_id ( filename ) )
          `
          )
          .order('updated_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
      );
    } catch (error) {
      throw new Error(`Failed to export annotations: ${error.message}`);
    }

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
      'patch_relpath',
      'storage_path',
    ];

    const escapeCsv = (val) => {
      const str = val == null ? '' : String(val);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const lines = [header.join(',')];
    for (const row of data) {
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
          row.patches?.patch_relpath,
          row.patches?.storage_path,
        ]
          .map(escapeCsv)
          .join(',')
      );
    }

    console.log(`exportCsv: wrote ${data.length} annotation rows.`);
    return lines.join('\n');
  },

  /**
   * Everything needed to build the "export images by label" ZIP: every
   * annotation joined with its patch's storage path and source filename.
   *
   * FIX (same 1,000-row cap as exportCsv()): this was silently capped at
   * 1,000 annotations too, just not yet noticed since this feature isn't
   * in active use for Phase 2.
   */
  async listForImageExport() {
    let data;
    try {
      data = await fetchAllRows((from, to) =>
        supabase
          .from('annotations')
          .select(
            `
            id, label, note,
            patches:patch_id ( id, patch_index, storage_path,
              images:image_id ( filename ) )
          `
          )
          .order('label', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      );
    } catch (error) {
      throw new Error(`Failed to load annotations for export: ${error.message}`);
    }

    return data
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