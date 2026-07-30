import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import Button from '../../components/common/Button.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import Toast from '../../components/common/Toast.jsx';
import LabelButtons from '../../components/annotation/LabelButtons.jsx';
import ProgressBar from '../../components/annotation/ProgressBar.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAnnotationFlow } from '../../hooks/useAnnotationFlow.js';
import { annotationsApi } from '../../api/annotationsApi.js';
import { ALL_LABELS, LABEL_TEXT, SHORTCUT_TO_LABEL } from '../../constants/labels.js';

// Patches often fill the whole frame at 1:1, which reads as "too zoomed
// in" the instant the page loads. Starting a little zoomed OUT (with room
// to go even further out) gives a safe, comfortable overview by default,
// centered in the viewport; annotators can still zoom in for detail.
const DEFAULT_SCALE = 0.85;
const MIN_SCALE = 0.4;
const MAX_SCALE = 5;

function AnnotatePage() {
  const navigate = useNavigate();
  const { profile, isAdmin, logout } = useAuth();
  const {
    currentPatch,
    historyIndex,
    canGoPrevious,
    loading,
    saving,
    error,
    saveConfirmation,
    isDone,
    progress,
    submitLabel,
    goToPrevious,
    goToNext,
  } = useAnnotationFlow();

  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isImageInfoOpen, setIsImageInfoOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [otherNote, setOtherNote] = useState('');
  const [isOtherModalOpen, setIsOtherModalOpen] = useState(false);
  const [otherError, setOtherError] = useState('');

  // Cache of patchId -> saved label, filled in lazily so re-visiting an
  // already-annotated patch (via "Previous") highlights its current label.
  const [labelCache, setLabelCache] = useState({});

  // Note: zoom resets automatically because <TransformWrapper key={currentPatch?.id}>
  // below remounts on patch change; its own onTransformed callback re-syncs `scale`.
  useEffect(() => {
    if (currentPatch?.status !== 'annotated' || labelCache[currentPatch.id] !== undefined) {
      return;
    }
    let active = true;
    annotationsApi
      .getByPatchId(currentPatch.id)
      .then((a) => {
        if (active) setLabelCache((prev) => ({ ...prev, [currentPatch.id]: a?.label ?? null }));
      })
      .catch(() => {
        if (active) setLabelCache((prev) => ({ ...prev, [currentPatch.id]: null }));
      });
    return () => {
      active = false;
    };
  }, [currentPatch?.id, currentPatch?.status, labelCache]);

  const currentLabel =
    currentPatch?.status === 'annotated' ? labelCache[currentPatch.id] ?? null : null;

  const anyModalOpen = isOptionsOpen || isImageInfoOpen || isShortcutsOpen || isOtherModalOpen;

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleLabel = useCallback(
    async (labelKey) => {
      if (labelKey === 'OTHER') {
        setOtherNote('');
        setOtherError('');
        setIsOtherModalOpen(true);
        return;
      }
      await submitLabel(labelKey);
    },
    [submitLabel]
  );

  const confirmOther = async () => {
    if (!otherNote.trim()) {
      setOtherError('Please describe what this patch actually shows.');
      return;
    }
    setIsOtherModalOpen(false);
    await submitLabel('OTHER', otherNote.trim());
  };

  // --- Keyboard shortcuts -----------------------------------------------
  // 1-4: coral labels, 5: Other, ←/→: previous/next, ?: shortcuts help, Esc: close modals.
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';

      if (e.key === 'Escape') {
        setIsOptionsOpen(false);
        setIsImageInfoOpen(false);
        setIsShortcutsOpen(false);
        setIsOtherModalOpen(false);
        return;
      }

      if (isTyping || anyModalOpen || saving || loading || !currentPatch) return;

      if (e.key === '?') {
        setIsShortcutsOpen(true);
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (canGoPrevious) goToPrevious();
        return;
      }
      if (e.key === 'ArrowRight') {
        goToNext();
        return;
      }
      const labelKey = SHORTCUT_TO_LABEL[e.key];
      if (labelKey) {
        handleLabel(labelKey);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyModalOpen, saving, loading, currentPatch, canGoPrevious, goToPrevious, goToNext, handleLabel]);

  // --- Full-page states -----------------------------------------------
  if (loading && !currentPatch && !isDone) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <Spinner size="lg" className="mx-auto mb-4" />
          <p className="text-slate-400">Loading patch...</p>
        </div>
      </div>
    );
  }

  if (error && !currentPatch) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center max-w-sm px-4">
          <p className="text-red-400 mb-4">{error}</p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => window.location.reload()} variant="primary">
              Retry
            </Button>
            <Button onClick={handleLogout} variant="ghost">
              Log out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isDone) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center max-w-md px-4">
          <div className="text-5xl mb-4">🪸</div>
          <h1 className="text-xl font-semibold text-slate-100 mb-2">All patches annotated</h1>
          <p className="text-slate-400 mb-6">
            There are no unannotated patches left. Nice work
            {profile?.first_name || profile?.email ? `, ${profile.first_name || profile.email}` : ''}.
          </p>
          <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 mb-6">
            <ProgressBar progress={progress} />
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            <Button onClick={() => navigate('/dashboard')} variant="primary">
              Go to Dashboard
            </Button>
            <Button onClick={() => navigate('/history')} variant="ghost">
              View History
            </Button>
            {isAdmin && (
              <Button onClick={() => navigate('/admin')} variant="ghost">
                Admin Dashboard
              </Button>
            )}
            <Button onClick={handleLogout} variant="ghost">
              Log out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const metadata = currentPatch?.image?.metadata || {};

  return (
    <div className="fixed inset-0 bg-slate-900 overflow-hidden">
      <Toast
        message={
          saveConfirmation
            ? `Saved as ${LABEL_TEXT[saveConfirmation.label] || saveConfirmation.label}`
            : error
        }
        tone={error ? 'error' : 'success'}
      />

      <TransformWrapper
        key={currentPatch?.id}
        initialScale={DEFAULT_SCALE}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        limitToBounds={true}
        centerOnInit={true}
        centerZoomedOut={true}
        onTransformed={({ state }) => setScale(state.scale)}
        wheel={{ step: 40, disabled: false, touchPadDisabled: false }}
        pinch={{ disabled: false }}
        panning={{ disabled: false, velocityDisabled: false }}
        doubleClick={{ disabled: false, step: 0.7, animation: true }}
      >
        {({ zoomIn, zoomOut, resetTransform }) => {
          const canZoomOut = scale > MIN_SCALE + 1e-3;

          return (
            <>
              {/* FULLSCREEN IMAGE, kept at a safe, centered viewing distance
                  (padding on all sides) instead of edge-to-edge */}
              <div className="w-full h-full flex items-center justify-center p-6 sm:p-12">
                <TransformComponent
                  wrapperClass="w-full h-full flex items-center justify-center"
                  contentClass="max-w-[80vw] max-h-[75vh] flex items-center justify-center"
                >
                  {currentPatch && (
                    <img
                      src={currentPatch.imageUrl}
                      alt="Coral patch for annotation"
                      className="max-w-[80vw] max-h-[75vh] w-auto h-auto object-contain"
                    />
                  )}
                </TransformComponent>
              </div>

              {/* ZOOM CONTROLS - TOP LEFT */}
              <div className="absolute top-4 left-4 z-50 flex gap-2">
                <button onClick={() => zoomIn()} className="px-2 py-1.5 rounded-md text-xs sm:text-sm font-medium text-slate-100 bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700/60" title="Zoom in">
                  🔍+
                </button>
                <button onClick={() => canZoomOut && zoomOut()} disabled={!canZoomOut} className="px-2 py-1.5 rounded-md text-xs sm:text-sm font-medium text-slate-100 bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed" title="Zoom out">
                  🔍−
                </button>
                <button onClick={() => resetTransform()} className="px-2 py-1.5 rounded-md text-xs sm:text-sm font-medium text-slate-100 bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700/60" title="Reset view">
                  ↺
                </button>
              </div>

              {/* TOP-RIGHT: OPTIONS + IMAGE INFO + SHORTCUTS */}
              <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
                <button onClick={() => setIsShortcutsOpen(true)} className="px-3 py-2 rounded-md text-xs sm:text-sm font-medium text-slate-200 bg-slate-900/40 hover:bg-slate-900/60 border border-slate-600/70" title="Keyboard shortcuts (?)">
                  ⌨ Shortcuts
                </button>
                <button onClick={() => setIsImageInfoOpen(true)} className="px-3 py-2 rounded-md text-xs sm:text-sm font-medium text-emerald-200 bg-slate-900/40 hover:bg-slate-900/60 border border-emerald-500/60" title="View image metadata">
                  Image Info
                </button>
                <button onClick={() => setIsOptionsOpen(true)} className="px-3 py-2 rounded-md text-xs sm:text-sm font-medium text-slate-200 bg-slate-900/40 hover:bg-slate-900/60 border border-slate-600/70" title="Options">
                  Options
                </button>
              </div>

              {/* PROGRESS - TOP CENTER */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 w-64 sm:w-80 px-4 py-2 rounded-lg bg-slate-900/50 border border-slate-700/70 backdrop-blur-sm">
                <ProgressBar progress={progress} compact />
              </div>

              {/* PREVIOUS - BOTTOM LEFT */}
              <button
                onClick={goToPrevious}
                disabled={!canGoPrevious || loading || saving}
                className="absolute bottom-6 left-6 z-40 px-4 py-2 rounded-md text-xs sm:text-sm font-medium text-slate-100 bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700/70 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous patch (←)"
              >
                ← Previous
              </button>

              {/* NEXT - BOTTOM RIGHT */}
              <button
                onClick={goToNext}
                disabled={loading || saving}
                className="absolute bottom-6 right-6 z-40 px-4 py-2 rounded-md text-xs sm:text-sm font-medium text-slate-100 bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700/70 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next patch (→)"
              >
                {historyIndex < 0 ? 'Next →' : 'Skip →'}
              </button>

              {/* LABELS - BOTTOM CENTER */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 w-full flex justify-center px-4">
                <div className="px-4 py-3 rounded-2xl bg-slate-900/30 border border-slate-700/60 backdrop-blur-sm max-w-[95vw] sm:max-w-3xl w-full">
                  <LabelButtons disabled={saving} currentLabel={currentLabel} onSelect={handleLabel} />
                </div>
              </div>

              {/* SAVING OVERLAY */}
              {(loading || saving) && (
                <div className="absolute inset-0 bg-black/25 z-30 flex items-center justify-center pointer-events-none">
                  <div className="bg-slate-900/70 border border-slate-700 rounded-lg p-6">
                    <Spinner size="lg" className="mx-auto mb-2" />
                    <p className="text-slate-200 text-sm">{saving ? 'Saving...' : 'Loading...'}</p>
                  </div>
                </div>
              )}

              {/* OTHER / NOT CORAL MODAL */}
              {isOtherModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
                  <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-sm w-full mx-4">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                      <h2 className="text-sm sm:text-base font-semibold text-slate-100">Not Coral / Other</h2>
                      <button onClick={() => setIsOtherModalOpen(false)} className="text-slate-400 hover:text-slate-200 text-lg leading-none" aria-label="Close">
                        ×
                      </button>
                    </div>
                    <div className="px-4 py-4 space-y-3">
                      <p className="text-xs sm:text-sm text-slate-400">
                        What does this patch actually show? (e.g. sand, rock, sponge, fish)
                      </p>
                      <textarea
                        autoFocus
                        value={otherNote}
                        onChange={(e) => {
                          setOtherNote(e.target.value);
                          if (otherError) setOtherError('');
                        }}
                        rows={3}
                        placeholder="Describe what's shown..."
                        className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      {otherError && <p className="text-xs text-red-400">{otherError}</p>}
                      <div className="flex gap-2 justify-end pt-1">
                        <button
                          onClick={() => setIsOtherModalOpen(false)}
                          className="px-4 py-2 rounded-md text-sm text-slate-300 hover:bg-slate-800"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={confirmOther}
                          className="px-4 py-2 rounded-md text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SHORTCUTS HELP MODAL */}
              {isShortcutsOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
                  <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-sm w-full mx-4">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                      <h2 className="text-sm sm:text-base font-semibold text-slate-100">Keyboard Shortcuts</h2>
                      <button onClick={() => setIsShortcutsOpen(false)} className="text-slate-400 hover:text-slate-200 text-lg leading-none" aria-label="Close shortcuts">
                        ×
                      </button>
                    </div>
                    <div className="px-4 py-4 text-sm text-slate-300 space-y-2">
                      {ALL_LABELS.map((l) => (
                        <div key={l.key} className="flex justify-between">
                          <span>{l.text}</span>
                          <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-xs">
                            {l.shortcut}
                          </kbd>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2 border-t border-slate-800 mt-2">
                        <span>Previous patch</span>
                        <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-xs">←</kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>Next / skip patch</span>
                        <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-xs">→</kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>Show this help</span>
                        <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-xs">?</kbd>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* OPTIONS MODAL */}
              {isOptionsOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
                  <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-sm w-full mx-4">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                      <h2 className="text-sm sm:text-base font-semibold text-slate-100">Options</h2>
                      <button onClick={() => setIsOptionsOpen(false)} className="text-slate-400 hover:text-slate-200 text-lg leading-none" aria-label="Close options">
                        ×
                      </button>
                    </div>
                    <div className="px-4 py-4 space-y-3">
                      <p className="text-xs sm:text-sm text-slate-400">
                        Signed in as <span className="text-slate-200">{profile?.email}</span>
                        {isAdmin ? ' (admin)' : ''}.
                      </p>
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => navigate('/dashboard')}
                          className="w-full inline-flex justify-center items-center px-4 py-2.5 rounded-md bg-slate-700 hover:bg-slate-600 text-sm font-medium text-white transition-colors"
                        >
                          Dashboard
                        </button>
                        <button
                          onClick={() => navigate('/history')}
                          className="w-full inline-flex justify-center items-center px-4 py-2.5 rounded-md bg-slate-700 hover:bg-slate-600 text-sm font-medium text-white transition-colors"
                        >
                          History
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => navigate('/admin')}
                            className="w-full inline-flex justify-center items-center px-4 py-2.5 rounded-md bg-slate-700 hover:bg-slate-600 text-sm font-medium text-white transition-colors"
                          >
                            Admin Dashboard
                          </button>
                        )}
                        <button
                          onClick={handleLogout}
                          className="w-full inline-flex justify-center items-center px-4 py-2.5 rounded-md bg-red-600 hover:bg-red-700 text-sm font-medium text-white transition-colors"
                        >
                          Logout
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* IMAGE INFO MODAL */}
              {isImageInfoOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
                  <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-lg w-full mx-4">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                      <h2 className="text-sm sm:text-base font-semibold text-slate-100">Image Information</h2>
                      <button onClick={() => setIsImageInfoOpen(false)} className="text-slate-400 hover:text-slate-200 text-lg leading-none" aria-label="Close image info">
                        ×
                      </button>
                    </div>
                    <div className="px-4 py-4 max-h-[70vh] overflow-y-auto text-xs sm:text-sm text-slate-200 space-y-3">
                      <div>
                        <h3 className="text-xs font-semibold text-slate-400 mb-1">Source image</h3>
                        <p className="text-slate-100">{currentPatch?.image?.filename || 'Unknown'}</p>
                      </div>
                      {Object.keys(metadata).length > 0 ? (
                        <div>
                          <h3 className="text-xs font-semibold text-slate-400 mb-1">Metadata</h3>
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                            {Object.entries(metadata).map(([key, value]) => (
                              <div key={key} className="contents">
                                <dt className="text-slate-400 capitalize">{key.replace(/_/g, ' ')}</dt>
                                <dd className="text-slate-100 truncate">{String(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ) : (
                        <p className="text-slate-500">No metadata recorded for this image.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        }}
      </TransformWrapper>
    </div>
  );
}

export default AnnotatePage;
