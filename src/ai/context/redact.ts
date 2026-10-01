import { detectTextSignal } from '@/domain/coach/medicalSignal';
import { detectOutOfScope } from '@/domain/coach/topicGuard';
import { COACH_CONFIG } from '@/domain/config/training';

export interface RawNote {
  date: string;
  source: 'session' | 'daily';
  text: string;
}

export interface NoteOmissions {
  /** Notes that read as an injury or a symptom. Never sent anywhere. */
  medicalNotes: number;
  /** Notes about diet or medication. The app does not advise on either. */
  outOfScopeNotes: number;
}

export interface RedactedNotes {
  kept: RawNote[];
  omissions: NoteOmissions;
}

/**
 * Invisible and bidirectional-control characters: zero-width spaces and
 * joiners, directional marks and overrides, the word joiner and the BOM.
 * Legitimate in no training note, useful in an attack. Listed as code
 * points so no invisible character has to appear in this source file.
 */
const INVISIBLE: readonly (readonly [number, number])[] = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
];

/** Control characters, line and paragraph separators, and every Unicode space: all become one space. */
const SPACES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x007f],
  [0x00a0, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

const inRanges = (ranges: readonly (readonly [number, number])[], codePoint: number) =>
  ranges.some(([from, to]) => codePoint >= from && codePoint <= to);

/** Control and invisible characters out, every kind of whitespace collapsed to one space. */
export function cleanText(text: string): string {
  let out = '';
  for (const ch of text) {
    const codePoint = ch.codePointAt(0)!;
    if (inRanges(INVISIBLE, codePoint)) continue;
    out += inRanges(SPACES, codePoint) ? ' ' : ch;
  }
  return out.split(' ').filter(Boolean).join(' ');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  // By code point, so a cut never lands inside a surrogate pair.
  for (const ch of text) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/**
 * Decide which of the user's own notes may reach a model.
 *
 * A note is judged whole, before it is shortened: a cut that lands before
 * "strzyka" must not turn an injury note into an innocent one. Notes that
 * read as injuries or touch diet or medication are dropped and counted, so
 * the screen can say so; the rest are cleaned, capped in length, and the
 * newest few are kept. Soreness stays — it is exactly what the coach is
 * for.
 *
 * `notes` are expected oldest first.
 */
export function redactNotes(notes: readonly RawNote[], cfg = COACH_CONFIG): RedactedNotes {
  const omissions: NoteOmissions = { medicalNotes: 0, outOfScopeNotes: 0 };
  const survivors: RawNote[] = [];

  for (const note of notes) {
    const cleaned = cleanText(note.text);
    if (cleaned === '') continue;
    if (detectTextSignal(cleaned) === 'medical') {
      omissions.medicalNotes += 1;
    } else if (detectOutOfScope(cleaned) !== null) {
      omissions.outOfScopeNotes += 1;
    } else {
      survivors.push({ ...note, text: truncate(cleaned, cfg.noteMaxChars) });
    }
  }

  return { kept: survivors.slice(-cfg.maxNotes), omissions };
}
