import { useCallback, useEffect, useRef, useState } from 'react';
import { patchesApi } from '../api/patchesApi.js';
import { annotationsApi } from '../api/annotationsApi.js';

/**
 * Orchestrates the core annotation workflow:
 *  - claim + display the next unannotated patch
 *  - zoom/pan is handled by the component (react-zoom-pan-pinch), not here
 *  - save a label, then auto-advance to the next patch
 *  - step backward/forward through patches visited this session
 *  - re-label a patch you've already visited (upsert, so this "just works")
 *  - track progress (total / annotated / remaining / per-label counts)
 *  - release the soft lock on a patch if the user navigates away unsaved
 */
export function useAnnotationFlow() {
  const [currentPatch, setCurrentPatch] = useState(null);
  const [history, setHistory] = useState([]); // patches visited this session, oldest first
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saveConfirmation, setSaveConfirmation] = useState(null); // { label, at } | null
  const [isDone, setIsDone] = useState(false); // no unannotated patches left

  const [progress, setProgress] = useState({
    total: 0,
    annotated: 0,
    remaining: 0,
    counts: { LC: 0, PB: 0, DC: 0, DCA: 0 },
  });

  // Keep a ref to the currently-displayed, not-yet-saved patch so we can
  // release its lock from an unmount cleanup without a stale closure.
  const lockedPatchRef = useRef(null);

  const refreshProgress = useCallback(async () => {
    try {
      const p = await patchesApi.getProgress();
      setProgress(p);
    } catch {
      // Progress is a nice-to-have; a failure here shouldn't block annotating.
    }
  }, []);

  const loadNextPatch = useCallback(async (skipPatchId = null) => {
    setLoading(true);
    setError(null);
    setSaveConfirmation(null);
    try {
      if (skipPatchId) {
        // Skipping without saving: release the lock so the patch is free
        // for others (and for us again later), and tell the claim RPC to
        // give us something else — otherwise it's still the lowest-index
        // unannotated patch locked to us and just gets handed right back.
        await patchesApi.releaseLock(skipPatchId).catch(() => {});
      }
      const patch = await patchesApi.claimNextPatch(skipPatchId);
      if (!patch) {
        setIsDone(true);
        setCurrentPatch(null);
        lockedPatchRef.current = null;
        return;
      }
      setIsDone(false);
      setCurrentPatch(patch);
      lockedPatchRef.current = patch.id;
      setHistory((prev) => [...prev, patch]);
      setHistoryIndex((prev) => prev + 1);
    } catch (err) {
      setError(err.message || 'Failed to load the next patch.');
    } finally {
      setLoading(false);
    }
  }, []);

  const goToPrevious = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setCurrentPatch(history[newIndex]);
    setSaveConfirmation(null);
  }, [historyIndex, history]);

  const goToNext = useCallback(() => {
    if (historyIndex < history.length - 1) {
      // Stepping forward through patches already visited this session —
      // no network call needed.
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setCurrentPatch(history[newIndex]);
      setSaveConfirmation(null);
      return;
    }
    // At the frontier: this is a genuine "Skip" of the current patch
    // (it hasn't been saved, or we'd have auto-advanced already).
    const skipId = currentPatch?.status === 'unannotated' ? currentPatch.id : null;
    loadNextPatch(skipId);
  }, [historyIndex, history, loadNextPatch, currentPatch]);

  const submitLabel = useCallback(
    async (label, note = null) => {
      if (!currentPatch) return;
      setSaving(true);
      setError(null);
      try {
        await annotationsApi.saveAnnotation(currentPatch.id, label, note);
        lockedPatchRef.current = null;
        setSaveConfirmation({ label, at: Date.now() });

        // Reflect the save immediately in local history/state.
        setCurrentPatch((p) => (p ? { ...p, status: 'annotated' } : p));
        setHistory((prev) =>
          prev.map((p) => (p.id === currentPatch.id ? { ...p, status: 'annotated' } : p))
        );

        await refreshProgress();

        // Auto-advance only if we were on the most recent (unannotated) patch —
        // if the user went "back" to fix an old one, stay put so they can see
        // the confirmation instead of yanking them forward.
        const wasAtEnd = historyIndex === history.length - 1;
        if (wasAtEnd) {
          await loadNextPatch();
        }
      } catch (err) {
        setError(err.message || 'Failed to save annotation.');
      } finally {
        setSaving(false);
      }
    },
    [currentPatch, historyIndex, history.length, loadNextPatch, refreshProgress]
  );

  // Initial load.
  useEffect(() => {
    loadNextPatch();
    refreshProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Release an unsaved lock when the hook unmounts (e.g. logout, route away).
  useEffect(() => {
    return () => {
      if (lockedPatchRef.current) {
        patchesApi.releaseLock(lockedPatchRef.current).catch(() => {});
      }
    };
  }, []);

  return {
    currentPatch,
    historyIndex,
    historyLength: history.length,
    canGoPrevious: historyIndex > 0,
    loading,
    saving,
    error,
    saveConfirmation,
    isDone,
    progress,
    submitLabel,
    goToPrevious,
    goToNext,
    refreshProgress,
    setError,
  };
}
