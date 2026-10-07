import catalogue from '@data/exercises.json';

import type { YmoveEntry } from './ymove-media.types';

export type { YmoveDifficulty, YmoveEntry, YmoveInfo } from './ymove-media.types';

/**
 * Exercise clips, muscle maps and descriptions licensed from YMove, keyed by
 * our exercise id.
 *
 * The licence ties the files to an active subscription and forbids passing
 * them on, so neither they nor the module that requires them are committed:
 * `npm run media:ymove` generates ymove-media.generated.ts from the local
 * assets/ymove-trial/ready folder (legacy matched/new also supported).
 * The archive folder is never bundled. Without the generated module (a fresh clone, CI) this is simply
 * empty and every screen falls back to the free-exercise-db photos. Expo's
 * Metro config lets a require() inside try/catch point at a missing module.
 */
function load(): Record<string, YmoveEntry> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional module, see above
    return (require('./ymove-media.generated') as { ymoveMedia: Record<string, YmoveEntry> })
      .ymoveMedia;
  } catch {
    return {};
  }
}

/**
 * Clips that show another exercise or variant than ours (the description
 * audit, Documents/PLAN-TYGODNIA-I-POPRAWKI.md appendix B) are left out:
 * a wrong clip misleads more than a still photo.
 */
function withoutHidden(media: Record<string, YmoveEntry>): Record<string, YmoveEntry> {
  const hidden = new Set(
    (catalogue as { exercises: { id: string; hideClip?: boolean }[] }).exercises
      .filter((e) => e.hideClip)
      .map((e) => e.id),
  );
  return Object.fromEntries(Object.entries(media).filter(([id]) => !hidden.has(id)));
}

export const ymoveMedia: Record<string, YmoveEntry> = withoutHidden(load());
