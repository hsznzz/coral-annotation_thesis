import { useCallback, useState } from 'react';

/**
 * Small reusable helper for the load/error/data dance every async action
 * in this app needs (fetching a patch, saving a label, exporting a CSV...).
 *
 * const { loading, error, run, setError } = useLoadingState();
 * const onSave = () => run(() => annotationsApi.saveAnnotation(id, label));
 */
export function useLoadingState(initialLoading = false) {
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState(null);

  const run = useCallback(async (fn) => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err?.message || 'Something went wrong.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, setError, setLoading, run };
}
