/**
 * A rule-based stand-in for the model: no network, no randomness, and a
 * promise to follow every rule the prompt states.
 *
 * It exists to exercise the pipeline and the scorers without a key. An
 * evaluation that has never seen a passing answer cannot tell a broken
 * scorer from a broken model, and one that has never seen a failing answer
 * cannot tell a lenient scorer from a good one. This is the first half;
 * `mutations.ts` is the second. It says nothing about any model, and every
 * report it produces says so.
 */
import type { CoachContext } from '@/ai/contract/coachContext';
import type { WeeklySummary } from '@/ai/contract/weeklySummary';
import { MEDICAL_REFERRAL } from '@/ai/prompts/weeklySummary/v1';
import { detectTextSignal } from '@/domain/coach/medicalSignal';
import type { SignalCode } from '@/domain/coach/vocabulary';
import type { ShortfallReason } from '@/domain/types';

const REASON_LABELS: Record<ShortfallReason, string> = {
  doms: 'zakwasy lub zmęczony mięsień',
  short_rest: 'za krótką przerwę',
  technique: 'problem z techniką',
  pain: '',
};

const pl = (n: number) => String(n).replace('.', ',');

const FLAG_COMMENTS: Record<SignalCode, string> = {
  SPARSE_HISTORY: 'W dzienniku jest jeszcze mało sesji, więc zbieramy dopiero dane.',
  LAYOFF_SHORT: 'Od ostatniej sesji minęło kilka dni. To zwykła przerwa, plan wraca spokojnie.',
  LAYOFF_MEDIUM: 'Od ostatniej sesji minęło sporo dni. Zwykła przerwa, wracasz bez pośpiechu.',
  LAYOFF_LONG:
    'Od ostatniej sesji minęło dużo czasu. Wracasz po przerwie, a aplikacja zacznie ostrożnie.',
  SLEEP_LOW_STREAK: 'Kilka nocy z rzędu było krótkich. Warto o tym pamiętać przy ocenie tygodnia.',
};

export const REFERENCE_MODEL = 'reference-responder';

export function referenceAnswer(context: CoachContext): WeeklySummary {
  const sparse = context.signals.includes('SPARSE_HISTORY');
  const highlights: string[] = [];

  if (context.sessionCount > 0) {
    highlights.push(
      sparse
        ? `W oknie czterech tygodni masz ${context.sessionCount} zapisanych sesji.`
        : `W ostatnich czterech tygodniach zrobiłeś ${context.sessionCount} sesji.`,
    );
  }
  const { improved, maintained, declined } = context.trendSummary;
  if (!sparse && improved + maintained + declined > 0) {
    highlights.push(
      `Ćwiczenia: ${improved} z lepszym wynikiem, ${maintained} utrzymanych, ${declined} z niższym.`,
    );
  }
  const reasons = context.sessions.flatMap((s) =>
    s.exercises.flatMap((e) =>
      e.sets.flatMap((set) => (set.shortfall === null ? [] : [set.shortfall])),
    ),
  );
  const reported = reasons.find((reason) => reason !== 'pain');
  if (reported)
    highlights.push(
      `W dzienniku zaznaczyłeś ${REASON_LABELS[reported]} jako powód krótszej serii.`,
    );
  const avg7 = context.weight?.avg7Kg;
  if (typeof avg7 === 'number') {
    highlights.push(`Średnia waga z ostatnich dni to ${pl(avg7)} kg.`);
  }
  const waistChange = context.waist?.changeCm;
  if (typeof waistChange === 'number') {
    highlights.push(`Obwód talii zmienił się o ${pl(Math.abs(waistChange))} cm w tym oknie.`);
  }
  const sleep = context.recovery.avgSleepHours;
  if (typeof sleep === 'number') {
    highlights.push(`Średni sen w zapisanych dniach to ${pl(sleep)} h.`);
  }
  if (highlights.length === 0)
    highlights.push('W tym oknie nie ma jeszcze danych do podsumowania.');

  // A complaint that got past the gate: say nothing about it, add the fixed
  // sentence last. The schema allows four points, and the sentence keeps its place.
  const complaint =
    reasons.includes('pain') ||
    context.notes.some((note) => detectTextSignal(note.text) === 'medical');
  const kept = highlights.slice(0, complaint ? 3 : 4);
  if (complaint) kept.push(MEDICAL_REFERRAL);

  return {
    headline: sparse
      ? 'Dopiero zbieramy dane, więc na razie bez wniosków.'
      : `Ostatnie cztery tygodnie: ${context.sessionCount} sesji.`,
    highlights: kept,
    flags: context.signals.map((code) => ({ code, comment: FLAG_COMMENTS[code] })),
    questions: [],
  };
}
