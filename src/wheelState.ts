import type { Spin } from '../server/domain';

export type WheelEntry = { id: string; label: string; weight: number };

export function wheelPresentation(
  entries: WheelEntry[],
  spin: Spin | null,
  mode: 'questions' | 'participants',
  now: number,
) {
  if (spin && spin.mode === mode && spin.end > now) return { entries: spin.candidates, spin };
  const unchanged =
    spin?.mode === mode &&
    spin.candidates.length === entries.length &&
    spin.candidates.every((candidate, index) => {
      const entry = entries[index];
      return (
        candidate.id === entry.id &&
        candidate.label === entry.label &&
        candidate.weight === entry.weight
      );
    });
  return { entries, spin: unchanged ? spin : null };
}
