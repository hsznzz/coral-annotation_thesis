import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/common/Button.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import { annotationsApi } from '../../api/annotationsApi.js';
import { patchesApi } from '../../api/patchesApi.js';
import { changeRequestsApi } from '../../api/changeRequestsApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ALL_LABELS, LABEL_TEXT } from '../../constants/labels.js';

const PAGE_SIZE = 20;

const STATUS_STYLES = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  rejected: 'bg-red-500/15 text-red-300 border-red-500/40',
};

function StatusBadge({ status }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide border ${
        STATUS_STYLES[status] || 'bg-slate-700 text-slate-300 border-slate-600'
      }`}
    >
      {status}
    </span>
  );
}

/** "View image" link — patches live in a private bucket, so the signed URL
 * is fetched lazily on click instead of up front for every row. */
function ViewImageLink({ storagePath }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    setErr(false);
    try {
      const url = await patchesApi.getPatchSignedUrl(storagePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setErr(true);
    } finally {
      setLoading(false);
    }
  };

  if (!storagePath) return <span className="text-slate-600 text-xs">—</span>;

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="text-emerald-400 hover:text-emerald-300 text-xs font-medium underline underline-offset-2 disabled:opacity-50"
    >
      {loading ? 'Opening…' : err ? 'Retry view' : 'View image ↗'}
    </button>
  );
}

function RequestChangeModal({ row, onClose, onSubmitted }) {
  const [label, setLabel] = useState(row.label);
  const [note, setNote] = useState(row.note || '');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!reason.trim()) {
      setError('Please explain why this label should change.');
      return;
    }
    if (label === 'OTHER' && !note.trim()) {
      setError('Please describe what the patch actually shows.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await changeRequestsApi.create(row.id, label, label === 'OTHER' ? note.trim() : null, reason.trim());
      onSubmitted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-sm w-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm sm:text-base font-semibold text-slate-100">Request a label change</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-lg leading-none" aria-label="Close">
            ×
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-slate-400">
            Currently labeled <span className="text-slate-200">{LABEL_TEXT[row.label] || row.label}</span>. An
            admin will review this before it changes.
          </p>
          <div className="space-y-1">
            <label className="block text-xs text-slate-400">Proposed label</label>
            <select
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
            >
              {ALL_LABELS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.text}
                </option>
              ))}
            </select>
          </div>
          {label === 'OTHER' && (
            <div className="space-y-1">
              <label className="block text-xs text-slate-400">What is it actually?</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={submitting}
                placeholder="e.g. sand, rock, sponge"
                className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="block text-xs text-slate-400">Reason for the change</label>
            <textarea
              autoFocus={label !== 'OTHER'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              rows={3}
              placeholder="Why do you think this should be relabeled?"
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-md text-sm text-slate-300 hover:bg-slate-800">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-2 rounded-md text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryPage() {
  const navigate = useNavigate();
  const { profile, isAdmin } = useAuth();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [labelFilter, setLabelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [onlyMine, setOnlyMine] = useState(!isAdmin);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editDraft, setEditDraft] = useState(null); // admin inline edit: { id, label, note }
  const [savingId, setSavingId] = useState(null);

  const [requestRow, setRequestRow] = useState(null); // annotator: row being requested-for
  const [myRequests, setMyRequests] = useState([]); // annotator's own request statuses
  const [confirmation, setConfirmation] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows: r, total: t } = await annotationsApi.listAnnotations({
        label: labelFilter || null,
        search,
        page,
        pageSize: PAGE_SIZE,
        annotatorId: onlyMine && !isAdmin ? profile?.id : null,
      });
      setRows(r);
      setTotal(t);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [labelFilter, search, page, onlyMine, isAdmin, profile?.id]);

  const loadMyRequests = useCallback(async () => {
    if (isAdmin || !profile?.id) return;
    try {
      setMyRequests(await changeRequestsApi.listMine(profile.id));
    } catch {
      // Non-critical — the page still works without request statuses.
    }
  }, [isAdmin, profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadMyRequests();
  }, [loadMyRequests]);

  const requestStatusByAnnotation = useMemo(() => {
    const map = {};
    for (const req of myRequests) {
      // Most recent request per annotation wins (list is newest-first).
      if (!map[req.annotation_id]) map[req.annotation_id] = req.status;
    }
    return map;
  }, [myRequests]);

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
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  const handleRequestSubmitted = () => {
    setRequestRow(null);
    setConfirmation('Change request submitted — an admin will review it.');
    loadMyRequests();
    setTimeout(() => setConfirmation(''), 4000);
  };

  return (
    <div className="min-h-full px-4 sm:px-8 py-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Annotation History</h1>
          <p className="text-sm text-slate-400">
            {isAdmin
              ? 'Every annotation ever saved. You can correct a label directly here.'
              : "Every patch that's been annotated. You can request a correction — an admin reviews it before it changes."}
          </p>
        </div>
        <div className="flex gap-2">
          {/* <Button variant="ghost" onClick={() => navigate('/dashboard')}>
            Dashboard
          </Button>
          <Button variant="ghost" onClick={() => navigate('/annotate')}>
            Back to annotating
          </Button> */}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>
      )}
      {confirmation && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-sm rounded-lg px-4 py-3">
          {confirmation}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
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
        {isAdmin && (
          <label className="flex items-center gap-2 text-xs text-slate-400 pb-2">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => {
                setPage(0);
                setOnlyMine(e.target.checked);
              }}
            />
            Only my annotations
          </label>
        )}
      </div>

      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Image</th>
              <th className="text-left px-3 py-2">Patch #</th>
              <th className="text-left px-3 py-2">Label</th>
              <th className="text-left px-3 py-2">Note</th>
              <th className="text-left px-3 py-2">Updated</th>
              <th className="text-left px-3 py-2">Image link</th>
              <th className="text-right px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center">
                  <Spinner />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  No annotated patches match your filters yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isEditing = editDraft?.id === row.id;
                const myStatus = requestStatusByAnnotation[row.id];
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
                        <div className="flex items-center gap-2">
                          <span className="text-slate-200">{LABEL_TEXT[row.label] || row.label}</span>
                          {!isAdmin && myStatus && <StatusBadge status={myStatus} />}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[200px]">
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
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <ViewImageLink storagePath={row.patchStoragePath} />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {isAdmin ? (
                        isEditing ? (
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
                        )
                      ) : myStatus === 'pending' ? (
                        <span className="text-amber-400 text-xs">Request pending</span>
                      ) : (
                        <button
                          onClick={() => setRequestRow(row)}
                          className="text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                        >
                          Request change
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

      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>
          Page {page + 1} of {totalPages} · {total} total
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button variant="ghost" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      {requestRow && (
        <RequestChangeModal row={requestRow} onClose={() => setRequestRow(null)} onSubmitted={handleRequestSubmitted} />
      )}
    </div>
  );
}

export default HistoryPage;
