const LABEL_COLORS = {
  LC: 'text-emerald-400',
  PB: 'text-amber-400',
  DC: 'text-red-400',
  DCA: 'text-violet-400',
};

/**
 * Compact progress readout: total / annotated / remaining, plus a per-label
 * breakdown. Designed to sit in a small translucent panel over the image.
 */
function ProgressBar({ progress, compact = false, scopeLabel = null }) {
  const { total, annotated, remaining, counts } = progress;
  const pct = total > 0 ? Math.round((annotated / total) * 100) : 0;
 
  return (
    <div className={compact ? 'text-xs sm:text-sm' : 'text-sm'}>
      {scopeLabel && (
        <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wide mb-0.5">
          {scopeLabel}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-slate-300">
          {annotated}/{total} annotated
        </span>
        <span className="text-slate-400">{remaining} remaining</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {!compact && (
        <div className="flex gap-3 mt-2 flex-wrap">
          {Object.entries(counts).map(([label, count]) => (
            <span key={label} className={`${LABEL_COLORS[label]} font-medium`}>
              {label}: {count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
 
export default ProgressBar;
