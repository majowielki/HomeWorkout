import { describe, expect, it } from 'vitest';
import type { CoachContext } from '../../src/ai/contract/coachContext';
import { MEDICAL_REFERRAL } from '../../src/ai/prompts/weeklySummary/v1';
import { messagesReportPain, summaryWithReferral } from '../src/reportedPain';
import { context, GOOD, reasonMessages } from './helpers';

describe('explicit reported pain', () => {
  it.each([false, true])(
    'reads only an explicit pain code from history or recent-session data: recent=%s',
    (recent) => {
      expect(messagesReportPain(reasonMessages('pain', recent))).toBe(true);
      expect(messagesReportPain(reasonMessages('short_rest', recent))).toBe(false);
      expect(messagesReportPain(reasonMessages(null, recent))).toBe(false);
    },
  );
  it('does not infer pain from an error, another tool or conversation text', () => {
    expect(messagesReportPain([{ role: 'user', text: 'pain' }])).toBe(false);
    expect(
      messagesReportPain([
        {
          role: 'tool',
          results: [
            { callId: 'r', name: 'getExerciseHistory', output: { error: 'unknown_exercise' } },
          ],
        },
      ]),
    ).toBe(false);
    expect(
      messagesReportPain([
        {
          role: 'tool',
          results: [{ callId: 'r', name: 'findExercises', output: { total: 0, exercises: [] } }],
        },
      ]),
    ).toBe(false);
  });
  it('guarantees exactly one final referral highlight only for a logged pain reason', () => {
    const withPain: CoachContext = {
      ...context,
      sessions: [
        {
          date: '2026-10-01',
          template: 'FBW',
          durationMin: 30,
          sessionRpe: 7,
          workingSets: 1,
          exercises: [
            {
              exerciseId: 'row',
              name: 'Wiosłowanie',
              sets: [
                { reps: 8, timeSec: null, rir: 2, shortfall: 'pain', load: { kind: 'bodyweight' } },
              ],
            },
          ],
        },
      ],
    };
    expect(summaryWithReferral(GOOD, context)).toBe(GOOD);
    expect(summaryWithReferral(GOOD, withPain).highlights.at(-1)).toBe(MEDICAL_REFERRAL);
    const duplicated = { ...GOOD, highlights: ['Fakt.', MEDICAL_REFERRAL, MEDICAL_REFERRAL] };
    expect(summaryWithReferral(duplicated, withPain).highlights).toEqual([
      'Fakt.',
      MEDICAL_REFERRAL,
    ]);
    expect(
      summaryWithReferral({ ...GOOD, highlights: ['A', 'B', 'C', 'D'] }, withPain).highlights,
    ).toEqual(['A', 'B', 'C', MEDICAL_REFERRAL]);
  });
});
