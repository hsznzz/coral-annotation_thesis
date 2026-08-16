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
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto max-w-full">
      {ALL_LABELS.map((label) => {
        const isCurrent = currentLabel === label.key;
        return (
          <Button
            key={label.key}
            size="sm"
            className={`${label.color} shrink-0 whitespace-nowrap justify-center relative transition-transform px-3 py-2 text-xs sm:text-sm ${
              isCurrent ? 'ring-4 ring-white/70 scale-[1.02]' : ''
            }`}
            disabled={disabled}
            onClick={() => onSelect && onSelect(label.key)}
          >
            <span className="mr-1.5 text-[10px] font-mono opacity-70 border border-current rounded px-1">
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
