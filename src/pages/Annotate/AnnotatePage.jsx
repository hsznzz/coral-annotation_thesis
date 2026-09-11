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
import { ALL_LABELS, LABEL_TEXT, OTHER_NOTE, SHORTCUT_TO_LABEL } from '../../constants/labels.js';

// Patches often fill the whole frame at 1:1, which reads as "too zoomed
// in" the instant the page loads. Starting a little zoomed OUT (with room
// to go even further out) gives a safe, comfortable overview by default,
// centered in the viewport; annotators can still zoom in for detail.
const DEFAULT_SCALE = 1;
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

  const anyModalOpen = isOptionsOpen || isImageInfoOpen || isShortcutsOpen;

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleLabel = useCallback(
    async (labelKey) => {
      await submitLabel(labelKey, labelKey === 'OTHER' ? OTHER_NOTE : null);
    },
    [submitLabel]
  );

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
              <div className="absolute inset-0 z-0">
                <TransformComponent
                  wrapperClass="flex items-center justify-center"
                  wrapperStyle={{ width: '100%', height: '100%' }}
                  contentStyle={{ width: '100%', height: '100%' }}
                >
                  {currentPatch && (
                    <img
                      src={currentPatch.imageUrl}
                      alt="Coral patch for annotation"
                      className="w-full h-full object-contain select-none"
                      draggable={false}
                    />
                  )}
                </TransformComponent>
              </div>

              {/* TOP BAR — one flex row (wraps below sm:) instead of three
                  separately-positioned islands, so it can never overflow a
                  narrow screen. pointer-events-none on the wrapper + auto
                  on each group keeps the empty space between them
                  pass-through for panning/zooming the image underneath. */}
              <div
                className="absolute top-0 left-0 right-0 z-50 px-3 sm:px-4 pointer-events-none"
                style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
              >
                <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
                  <div className="flex gap-2 pointer-events-auto order-1">
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

                  <div className="order-3 sm:order-2 w-full sm:w-auto sm:flex-1 flex justify-center pointer-events-auto">
                    <div className="w-full max-w-[260px] sm:max-w-xs md:max-w-sm px-4 py-2 rounded-lg bg-slate-900/50 border border-slate-700/70 backdrop-blur-sm">
                      <ProgressBar progress={progress} compact scopeLabel={isAdmin ? 'Project progress' : 'Your progress'} />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2 pointer-events-auto order-2 sm:order-3">
                    <button onClick={() => setIsShortcutsOpen(true)} className="px-2 sm:px-3 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium text-slate-200 bg-slate-900/40 hover:bg-slate-900/60 border border-slate-600/70" title="Keyboard shortcuts (?)">
                      ⌨<span className="hidden sm:inline"> Shortcuts</span>
                    </button>
                    <button onClick={() => setIsImageInfoOpen(true)} className="px-2 sm:px-3 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium text-emerald-200 bg-slate-900/40 hover:bg-slate-900/60 border border-emerald-500/60" title="View image metadata">
                      <span className="sm:hidden">ℹ</span><span className="hidden sm:inline">Image Info</span>
                    </button>
                    <button onClick={() => setIsOptionsOpen(true)} className="px-2 sm:px-3 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium text-slate-200 bg-slate-900/40 hover:bg-slate-900/60 border border-slate-600/70" title="Options">
                      <span className="sm:hidden">⚙</span><span className="hidden sm:inline">Options</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* BOTTOM BAR — Previous / Labels / Skip as one flex row.
                  flex-1 + min-w-0 on the middle wrapper is what actually
                  prevents the label strip from ever overlapping the corner
                  buttons, at any screen width — it can only occupy
                  whatever space Previous/Skip don't need. */}
              <div
                className="absolute left-0 right-0 bottom-0 z-40 px-3 sm:px-4 pointer-events-none"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={goToPrevious}
                    disabled={!canGoPrevious || loading || saving}
                    className="shrink-0 pointer-events-auto px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium text-slate-100 bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700/70 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Previous patch (←)"
                  >
                    ←<span className="hidden sm:inline"> Previous</span>
                  </button>

                  <div className="flex-1 min-w-0 flex justify-center pointer-events-auto">
                    <div className="max-w-full px-3 py-2.5 rounded-2xl bg-slate-900/30 border border-slate-700/60 backdrop-blur-sm">
                      <LabelButtons disabled={saving} currentLabel={currentLabel} onSelect={handleLabel} />
                    </div>
                  </div>

                  <button
                    onClick={goToNext}
                    disabled={loading || saving}
                    className="shrink-0 pointer-events-auto px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium text-slate-100 bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700/70 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Next patch"
                  >
                    <span className="hidden sm:inline">{historyIndex < 0 ? 'Next' : 'Skip'} </span>→
                  </button>
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

              {/* SHORTCUTS HELP MODAL */}
              {isShortcutsOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
                  <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-sm w-full mx-4 max-h-[85vh] overflow-y-auto">
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
                        <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-xs"></kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>Next / skip patch</span>
                        <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-xs"></kbd>
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
                  <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-sm w-full mx-4 max-h-[85vh] overflow-y-auto">
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
                  <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-sm w-full mx-4 max-h-[85vh] overflow-y-auto">
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
