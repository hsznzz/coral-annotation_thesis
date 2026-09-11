export const LABELS = [
  { key: 'LC', text: 'Living Coral (LC)', mobileText: 'LC', color: 'bg-emerald-500 hover:bg-emerald-600', shortcut: '1' },
  { key: 'PB', text: 'Partially Bleached (PB)', mobileText: 'PB', color: 'bg-amber-400 hover:bg-amber-500 text-slate-900', shortcut: '2' },
  { key: 'DC', text: 'Dead Coral (DC)', mobileText: 'DC', color: 'bg-red-500 hover:bg-red-600', shortcut: '3' },
  { key: 'DCA', text: 'Dead Coral with Algae (DCA)', mobileText: 'DCA', color: 'bg-violet-500 hover:bg-violet-600', shortcut: '4' },
];

// Not a coral patch at all (sand, rock, sponge, fish, etc.) — requires a
// note explaining what it actually is. Kept separate from LABELS so the
// core 4-class grid stays a clean list, while UI that needs "every
// possible label" can use ALL_LABELS.
export const OTHER_LABEL = {
  key: 'OTHER',
  text: 'Others',
  mobileText: 'Others',
  color: 'bg-slate-500 hover:bg-slate-600',
  shortcut: '5',
};

export const OTHER_NOTE = 'not coral';

export const ALL_LABELS = [...LABELS, OTHER_LABEL];

export const LABEL_TEXT = ALL_LABELS.reduce((acc, l) => ({ ...acc, [l.key]: l.text }), {});

export const SHORTCUT_TO_LABEL = ALL_LABELS.reduce(
  (acc, l) => ({ ...acc, [l.shortcut]: l.key }),
  {}
);
