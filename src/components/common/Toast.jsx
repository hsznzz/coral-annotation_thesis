/**
 * Small dismiss-on-its-own confirmation banner, used to confirm a save
 * ("Saved as Living Coral (LC)") without blocking the UI.
 */
function Toast({ message, tone = 'success' }) {
  if (!message) return null;

  const tones = {
    success: 'bg-emerald-500/90 text-white border-emerald-400',
    error: 'bg-red-500/90 text-white border-red-400',
  };

  return (
    <div
      className={`fixed top-20 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-lg border shadow-lg text-sm font-medium ${tones[tone] || tones.success}`}
      role="status"
    >
      {message}
    </div>
  );
}

export default Toast;
