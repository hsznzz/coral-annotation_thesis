import Button from '../common/Button.jsx';
import { ALL_LABELS } from '../../constants/labels.js';

/**
 * @param {boolean} disabled - true while a save is in flight
 * @param {string|null} currentLabel - already-saved label for this patch, if any (re-labeling)
 * @param {(label: string) => void} onSelect - called for ANY label, including 'OTHER'.
 *   The caller decides what 'OTHER' means (e.g. open a note prompt before saving).
 */
function LabelButtons({ disabled = false, currentLabel = null, onSelect }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {ALL_LABELS.map((label) => {
        const isCurrent = currentLabel === label.key;
        return (
          <Button
            key={label.key}
            size="lg"
            className={`${label.color} w-full justify-center relative transition-transform ${
              isCurrent ? 'ring-4 ring-white/70 scale-[1.02]' : ''
            }`}
            disabled={disabled}
            onClick={() => onSelect && onSelect(label.key)}
          >
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-mono opacity-70 border border-current rounded px-1">
              {label.shortcut}
            </span>
            {label.text}
            {isCurrent ? ' \u2713' : ''}
          </Button>
        );
      })}
    </div>
  );
}

export default LabelButtons;
