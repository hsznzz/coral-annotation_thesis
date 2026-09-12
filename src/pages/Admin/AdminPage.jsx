import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import Button from '../../components/common/Button.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import { annotationsApi } from '../../api/annotationsApi.js';
import { patchesApi } from '../../api/patchesApi.js';
import { changeRequestsApi } from '../../api/changeRequestsApi.js';
import { authService } from '../../api/services/authService.js';
import { supabase } from '../../api/supabaseClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ALL_LABELS, LABEL_TEXT } from '../../constants/labels.js';

const PAGE_SIZE = 20;

function StatCard({ label, value, tone = 'text-slate-100' }) {
  return (
    <div className="bg-slate-800/70 border border-slate-700 rounded-lg px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function AdminPage() {
  const navigate = useNavigate();
  const { profile, logout } = useAuth();

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [labelFilter, setLabelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [rowsLoading, setRowsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editDraft, setEditDraft] = useState(null); // { id, label, note }
  const [savingId, setSavingId] = useState(null);

  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [promotingId, setPromotingId] = useState(null);

  const [exporting, setExporting] = useState(false);
  const [exportingImages, setExportingImages] = useState(false);
  const [imageExportProgress, setImageExportProgress] = useState(null); // { done, total }

  const [pendingRequests, setPendingRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState(null);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await annotationsApi.getStats());
    } catch (err) {
      setError(err.message);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadRows = useCallback(async () => {
    setRowsLoading(true);
    setError(null);
    try {
      const { rows: r, total: t } = await annotationsApi.listAnnotations({
        label: labelFilter || null,
        search,
        page,
        pageSize: PAGE_SIZE,
      });
      setRows(r);
      setTotal(t);
    } catch (err) {
      setError(err.message);
    } finally {
      setRowsLoading(false);
    }
  }, [labelFilter, search, page]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      setUsers(await authService.listProfiles());
    } catch (err) {
      setError(err.message);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadPendingRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      setPendingRequests(await changeRequestsApi.listPending());
    } catch (err) {
      setError(err.message);
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadUsers();
    loadPendingRequests();
  }, [loadStats, loadUsers, loadPendingRequests]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-annotation-stats')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'annotations' },
        () => {
          loadStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadStats]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const handleReviewRequest = async (requestId, approve) => {
    setReviewingId(requestId);
    try {
      await changeRequestsApi.review(requestId, approve);
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      if (approve) {
        loadRows();
        loadStats();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSaveEdit = async () => {
    if (!editDraft) return;
    setSavingId(editDraft.id);
    try {
      await annotationsApi.updateLabel(editDraft.id, editDraft.label, editDraft.note);
      setRows((prev) =>
        prev.map((r) =>
          r.id === editDraft.id
            ? { ...r, label: editDraft.label, note: editDraft.label === 'OTHER' ? editDraft.note : null }
            : r
        )
      );
      setEditDraft(null);
      loadStats();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  const handlePromote = async (userId) => {
    setPromotingId(userId);
    try {
      await authService.promoteToAdmin(userId);
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: 'admin' } : u)));
    } catch (err) {
      setError(err.message);
    } finally {
      setPromotingId(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await annotationsApi.exportCsv();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coral-annotations-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleExportImages = async () => {
    setExportingImages(true);
    setImageExportProgress(null);
    try {
      const items = await annotationsApi.listForImageExport();
      if (items.length === 0) {
        setError('No annotated patches to export yet.');
        return;
      }

      const zip = new JSZip();
      const manifestLines = ['label,patch_id,patch_index,source_image,note'];
      setImageExportProgress({ done: 0, total: items.length });

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          const url = await patchesApi.getPatchSignedUrl(item.storagePath);
          const res = await fetch(url);
          const blob = await res.blob();
          const ext = item.storagePath.split('.').pop() || 'jpg';
          const safeSource = (item.sourceFilename || 'unknown').replace(/[^\w.-]/g, '_');
          const filename = `patch-${item.patchIndex ?? item.patchId}_${safeSource}.${ext}`;
          zip.file(`${item.label}/${filename}`, blob);

          const escape = (v) => {
            const s = v == null ? '' : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          };
          manifestLines.push(
            [item.label, item.patchId, item.patchIndex, item.sourceFilename, item.note]
              .map(escape)
              .join(',')
          );
        } catch {
          // Skip a single failed image rather than aborting the whole export.
        }
        setImageExportProgress({ done: i + 1, total: items.length });
      }

      zip.file('manifest.csv', manifestLines.join('\n'));

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coral-annotations-images-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExportingImages(false);
      setImageExportProgress(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const userEmailById = useMemo(() => {
    const map = {};
    for (const u of users) {
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
      map[u.id] = name || u.email;
    }
    return map;
  }, [users]);

  return (
    <div className="min-h-full px-4 sm:px-8 py-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Annotation Review Dashboard</h1>
          <p className="text-sm text-slate-400">Signed in as {profile?.email}</p>
        </div>
        {/* <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate('/dashboard')}>
            Dashboard
          </Button>
          <Button variant="ghost" onClick={() => navigate('/history')}>
            History
          </Button>
          <Button variant="ghost" onClick={() => navigate('/annotate')}>
            Back to annotating
          </Button>
          <Button variant="ghost" onClick={handleLogout}>
            Log out
          </Button>
        </div> */}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-300 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Stats */}
      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Statistics</h2>
        {statsLoading ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Total annotations" value={stats?.totalAnnotations ?? 0} />
            {ALL_LABELS.map((l) => (
              <StatCard key={l.key} label={l.key} value={stats?.byLabel?.[l.key] ?? 0} />
            ))}
          </div>
        )}
      </section>

      {/* Pending change requests from annotators */}
      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">
          Pending change requests
          {pendingRequests.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-amber-500/20 text-amber-300 text-[11px] normal-case font-semibold">
              {pendingRequests.length}
            </span>
          )}
        </h2>
        {requestsLoading ? (
          <Spinner />
        ) : pendingRequests.length === 0 ? (
          <p className="text-sm text-slate-500">No pending requests right now.</p>
        ) : (
          <div className="border border-slate-700 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Image</th>
                  <th className="text-left px-3 py-2">Patch #</th>
                  <th className="text-left px-3 py-2">Current</th>
                  <th className="text-left px-3 py-2">Proposed</th>
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-left px-3 py-2">Requested</th>
                  <th className="text-right px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map((req) => (
                  <tr key={req.id} className="border-t border-slate-800 align-top">
                    <td className="px-3 py-2 text-slate-200">{req.patches?.images?.filename || '—'}</td>
                    <td className="px-3 py-2 text-slate-400">{req.patches?.patch_index ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-400">{LABEL_TEXT[req.current_label] || req.current_label}</td>
                    <td className="px-3 py-2 text-emerald-300">
                      {LABEL_TEXT[req.requested_label] || req.requested_label}
                      {req.requested_note && <span className="block text-slate-500 text-xs">{req.requested_note}</span>}
                    </td>
                    <td className="px-3 py-2 max-w-[220px] text-slate-400 text-xs">{req.reason || '—'}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {req.created_at ? new Date(req.created_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => handleReviewRequest(req.id, false)}
                          disabled={reviewingId === req.id}
                          className="text-red-400 hover:text-red-300 text-xs font-medium disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handleReviewRequest(req.id, true)}
                          disabled={reviewingId === req.id}
                          className="text-emerald-400 hover:text-emerald-300 text-xs font-medium disabled:opacity-50"
                        >
                          {reviewingId === req.id ? 'Saving…' : 'Approve'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Filters + export */}
      <section>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Filter by label</label>
            <select
              value={labelFilter}
              onChange={(e) => {
                setPage(0);
                setLabelFilter(e.target.value);
              }}
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
            >
              <option value="">All labels</option>
              {ALL_LABELS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.text}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-400 mb-1">Search by image or patch ID</label>
            <input
              value={search}
              onChange={(e) => {
                setPage(0);
                setSearch(e.target.value);
              }}
              placeholder="e.g. GOPR4527 or a patch id"
              className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={handleExport} disabled={exporting} variant="primary">
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
          <Button onClick={handleExportImages} disabled={exportingImages} variant="primary">
            {exportingImages
              ? imageExportProgress
                ? `Zipping ${imageExportProgress.done}/${imageExportProgress.total}…`
                : 'Preparing…'
              : 'Export Images (ZIP)'}
          </Button>
        </div>

        {/* Table */}
        <div className="border border-slate-700 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-400 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Image</th>
                <th className="text-left px-3 py-2">Patch #</th>
                <th className="text-left px-3 py-2">Label</th>
                <th className="text-left px-3 py-2">Note</th>
                <th className="text-left px-3 py-2">Annotator</th>
                <th className="text-left px-3 py-2">Updated</th>
                <th className="text-right px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rowsLoading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center">
                    <Spinner />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    No annotations match your filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isEditing = editDraft?.id === row.id;
                  return (
                    <tr key={row.id} className="border-t border-slate-800 hover:bg-slate-800/40 align-top">
                      <td className="px-3 py-2 text-slate-200">{row.imageFilename || '—'}</td>
                      <td className="px-3 py-2 text-slate-400">{row.patchIndex ?? '—'}</td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <select
                            autoFocus
                            value={editDraft.label}
                            disabled={savingId === row.id}
                            onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                            className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                          >
                            {ALL_LABELS.map((l) => (
                              <option key={l.key} value={l.key}>
                                {l.key}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-200">{LABEL_TEXT[row.label] || row.label}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-[220px]">
                        {isEditing ? (
                          editDraft.label === 'OTHER' ? (
                            <input
                              value={editDraft.note}
                              disabled={savingId === row.id}
                              onChange={(e) => setEditDraft((d) => ({ ...d, note: e.target.value }))}
                              placeholder="What is it?"
                              className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                            />
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )
                        ) : (
                          <span className="text-slate-400 text-xs truncate block">{row.note || '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-400">{userEmailById[row.annotatorId] || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => setEditDraft(null)}
                              disabled={savingId === row.id}
                              className="text-slate-400 hover:text-slate-200 text-xs"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleSaveEdit}
                              disabled={savingId === row.id || (editDraft.label === 'OTHER' && !editDraft.note.trim())}
                              className="text-emerald-400 hover:text-emerald-300 text-xs font-medium disabled:opacity-50"
                            >
                              {savingId === row.id ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditDraft({ id: row.id, label: row.label, note: row.note || '' })}
                            className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                          >
                            Correct label
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
          <span>
            Page {page + 1} of {totalPages} · {total} total
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </section>

      {/* Users / roles */}
      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Users</h2>
        {usersLoading ? (
          <Spinner />
        ) : (
          <div className="border border-slate-700 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Role</th>
                  <th className="text-right px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-slate-800">
                    <td className="px-3 py-2 text-slate-200">
                      {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-200">{u.email}</td>
                    <td className="px-3 py-2 text-slate-400">{u.role}</td>
                    <td className="px-3 py-2 text-right">
                      {u.role === 'admin' ? (
                        <span className="text-slate-600 text-xs">—</span>
                      ) : (
                        <button
                          onClick={() => handlePromote(u.id)}
                          disabled={promotingId === u.id}
                          className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                        >
                          {promotingId === u.id ? 'Promoting…' : 'Promote to admin'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default AdminPage;
