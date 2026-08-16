import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/common/Button.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import { annotationsApi } from '../../api/annotationsApi.js';
import { patchesApi } from '../../api/patchesApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { LABEL_TEXT } from '../../constants/labels.js';

function StatCard({ label, value, tone = 'text-slate-100' }) {
  return (
    <div className="bg-slate-800/70 border border-slate-700 rounded-lg px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const { profile, isAdmin, logout } = useAuth();

  const [progress, setProgress] = useState(null);
  const [myCount, setMyCount] = useState(0);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [overallProgress, mine] = await Promise.all([
        patchesApi.getProgress(),
        annotationsApi.listAnnotations({ annotatorId: profile.id, page: 0, pageSize: 5 }),
      ]);
      setProgress(overallProgress);
      setRecent(mine.rows);
      setMyCount(mine.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const displayName = profile?.first_name || profile?.email || 'there';
  const remaining = progress?.remaining ?? 0;
  const readyToAnnotate = remaining > 0;

  return (
    <div className="min-h-full px-4 sm:px-8 py-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Welcome back, {displayName}</h1>
          <p className="text-sm text-slate-400">Here's where things stand with your coral annotations.</p>
        </div>
        {/* <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate('/history')}>
            View history
          </Button>
          {isAdmin && (
            <Button variant="ghost" onClick={() => navigate('/admin')}>
              Admin dashboard
            </Button>
          )}
          <Button variant="ghost" onClick={handleLogout}>
            Log out
          </Button>
        </div> */}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {/* Status / call to action */}
          <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p
                className={`inline-flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full border mb-2 ${
                  readyToAnnotate
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-700/50 text-slate-300 border-slate-600'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${readyToAnnotate ? 'bg-emerald-400' : 'bg-slate-400'}`} />
                {readyToAnnotate ? 'Ready to annotate now' : 'All patches annotated'}
              </p>
              <h2 className="text-lg font-semibold text-slate-100">
                {readyToAnnotate
                  ? `${remaining} patch${remaining === 1 ? '' : 'es'} still need${remaining === 1 ? 's' : ''} a label`
                  : "There's nothing left in the queue right now"}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {readyToAnnotate
                  ? 'You can jump straight into the annotation workspace whenever you like — there is no schedule to wait for.'
                  : 'Check back later, or review your past annotations below.'}
              </p>
            </div>
            <Button variant="primary" size="lg" onClick={() => navigate('/annotate')} disabled={!readyToAnnotate}>
              {readyToAnnotate ? 'Start / resume annotating →' : 'Nothing to annotate'}
            </Button>
          </div>

          {/* Stats */}
          <section>
            <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Your progress</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Your annotations" value={myCount} tone="text-emerald-400" />
              <StatCard label="Overall annotated" value={progress?.annotated ?? 0} />
              <StatCard label="Overall remaining" value={progress?.remaining ?? 0} />
              <StatCard label="Overall total patches" value={progress?.total ?? 0} />
            </div>
          </section>

          {/* Recent history */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Your recent annotations</h2>
              <button onClick={() => navigate('/history')} className="text-xs text-emerald-400 hover:text-emerald-300 font-medium">
                View full history →
              </button>
            </div>
            {recent.length === 0 ? (
              <div className="border border-slate-700 rounded-lg px-4 py-6 text-center text-slate-500 text-sm">
                You haven't annotated any patches yet.
              </div>
            ) : (
              <div className="border border-slate-700 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-800 text-slate-400 text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Image</th>
                      <th className="text-left px-3 py-2">Patch #</th>
                      <th className="text-left px-3 py-2">Label</th>
                      <th className="text-left px-3 py-2">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((row) => (
                      <tr key={row.id} className="border-t border-slate-800">
                        <td className="px-3 py-2 text-slate-200">{row.imageFilename || '—'}</td>
                        <td className="px-3 py-2 text-slate-400">{row.patchIndex ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-200">{LABEL_TEXT[row.label] || row.label}</td>
                        <td className="px-3 py-2 text-slate-500 text-xs">
                          {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default DashboardPage;
