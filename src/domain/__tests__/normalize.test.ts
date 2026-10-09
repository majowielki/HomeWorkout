/**
 * Engine v2, P2 (13 §3, 02 §4, T10-T14, T20): from plans and results to the
 * exposures the progression reads — nothing invented to fill a gap.
 */
import {
  type ObservationRow,
  normalizeObservations,
  type SessionMeta,
} from '../observations/normalize';
import { exposureOutcome, outcomeStatus } from '../observations/outcome';
import { legalObservation, legalPlan } from './planFixtures';

const plan = legalPlan();
const exposure = plan.exposures[0]!;
const SET_IDS = exposure.sets.map((s) => s.id); // 1L 1R 2L 2R

const session = (patch: Partial<SessionMeta> = {}): SessionMeta => ({
  sessionId: 's1',
  trainingDate: '2026-10-09',
  status: 'completed',
  deload: false,
  reducedExposures: [],
  ...patch,
});

/** A result for one of the four sets, confirmed as planned. */
const result = (setId: string, patch: Partial<ObservationRow> = {}): ObservationRow => {
  const side = setId.endsWith('L') ? 'left' : setId.endsWith('R') ? 'right' : null;
  return {
    ...legalObservation({
      id: `obs-${setId}`,
      commandId: `cmd-${setId}`,
      plannedSetId: setId,
      logicalSetId: setId.replace(/[LR]$/, ''),
      side,
    }),
    deletedAt: null,
    ...patch,
  };
};

const skip = (setId: string, at = '2026-10-09T08:30:00.000Z') => ({
  plannedSetId: setId,
  status: 'skipped' as const,
  reason: 'user_skipped' as const,
  commandId: `skip-${setId}`,
  at,
});

const run = (
  observations: ObservationRow[],
  extra: Partial<Parameters<typeof normalizeObservations>[0]> = {},
) =>
  normalizeObservations({
    sessions: [session()],
    plans: [plan],
    observations,
    dispositions: [],
    feel: [],
    ...extra,
  });

const states = (observations: ObservationRow[], extra = {}) =>
  run(observations, extra).records[0]!.sets.map((s) => s.disposition);

describe('every planned set gets exactly what belongs to it', () => {
  it('T08 matches results to sets by id, whatever order they come in', () => {
    const shuffled = [...SET_IDS].reverse().map((id) => result(id));
    const { records, problems } = run(shuffled);
    expect(problems).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]!.sets.map((s) => s.planned.id)).toEqual(SET_IDS);
    expect(records[0]!.sets.map((s) => s.observation?.plannedSetId)).toEqual(SET_IDS);
    expect(records[0]).toMatchObject({
      exposureId: 's1/r1/e1',
      exerciseId: 'one-arm-db-row',
      slotId: 'pull-horizontal',
      trainingDate: '2026-10-09',
      progressionScope: 'primary',
      comparisonKey: exposure.comparisonKey,
    });
  });

  it('T10 leaves a set without a result without one — nothing is written in for it', () => {
    const { records } = run([result(SET_IDS[0]!)]);
    const sets = records[0]!.sets;
    expect(sets[0]!.observation).not.toBeNull();
    expect(sets.slice(1).every((s) => s.observation === null)).toBe(true);
    expect(sets.slice(1).map((s) => s.disposition)).toEqual(['skipped', 'skipped', 'skipped']);
  });

  it('T11 sees that only the left side was done', () => {
    const { records } = run([result(SET_IDS[0]!), result(SET_IDS[2]!)]);
    const done = records[0]!.sets.filter((s) => s.observation).map((s) => s.planned.side);
    expect(done).toEqual(['left', 'left']);
  });

  it('T12 keeps a skip, with who said so, apart from a result', () => {
    const { records } = run([result(SET_IDS[0]!)], { dispositions: [skip(SET_IDS[3]!)] });
    expect(records[0]!.sets.map((s) => s.disposition)).toEqual([
      'performed',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(records[0]!.sets[3]!.observation).toBeNull();
  });

  it('reads the last of several skips of one set, whichever order they come in', () => {
    const early = { ...skip(SET_IDS[1]!, '2026-10-09T08:10:00.000Z'), reason: 'pain' as const };
    const late = { ...skip(SET_IDS[1]!, '2026-10-09T08:20:00.000Z'), reason: 'time' as const };
    for (const order of [
      [early, late],
      [late, early],
    ]) {
      expect(run([], { dispositions: order }).problems).toEqual([]);
    }
    const both = run([], { dispositions: [late, early] });
    expect(both.records[0]!.sets[1]!.disposition).toBe('skipped');
  });

  it('a result wins over a skip of the same set', () => {
    const { records } = run([result(SET_IDS[0]!)], { dispositions: [skip(SET_IDS[0]!)] });
    expect(records[0]!.sets[0]!.disposition).toBe('performed');
  });

  it('T13 leaves a running session’s unfinished sets pending, and reads them as skipped once it is closed', () => {
    expect(
      states([result(SET_IDS[0]!)], { sessions: [session({ status: 'in_progress' })] }),
    ).toEqual(['performed', 'pending', 'pending', 'pending']);
    expect(states([result(SET_IDS[0]!)], { sessions: [session({ status: 'completed' })] })).toEqual(
      ['performed', 'skipped', 'skipped', 'skipped'],
    );
  });

  it('an interrupted set is neither done nor skipped', () => {
    const interrupted = result(SET_IDS[0]!, {
      status: 'interrupted',
      amount: { ...legalObservation().amount, value: { kind: 'reps', reps: 4 } },
    });
    expect(states([interrupted])[0]).toBe('interrupted');
  });
});

describe('corrections and what was taken back', () => {
  it('uses the newest revision of a result', () => {
    const first = result(SET_IDS[0]!, { revision: 1 });
    const corrected = result(SET_IDS[0]!, {
      revision: 2,
      recordedAt: '2026-10-09T08:05:00.000Z',
      amount: { ...legalObservation().amount, value: { kind: 'reps', reps: 10 } },
    });
    for (const order of [
      [first, corrected],
      [corrected, first],
    ]) {
      const { records, problems } = run(order);
      expect(problems).toEqual([]);
      expect(records[0]!.sets[0]!.observation!.amount.value).toEqual({ kind: 'reps', reps: 10 });
    }
  });

  it('breaks a tie between two writes of one revision by when they were recorded', () => {
    const early = result(SET_IDS[0]!, { recordedAt: '2026-10-09T08:00:00.000Z' });
    const late = result(SET_IDS[0]!, {
      recordedAt: '2026-10-09T08:09:00.000Z',
      amount: { ...legalObservation().amount, value: { kind: 'reps', reps: 9 } },
    });
    for (const order of [
      [early, late],
      [late, early],
    ]) {
      expect(run(order).records[0]!.sets[0]!.observation!.amount.value).toEqual({
        kind: 'reps',
        reps: 9,
      });
    }
  });

  it('T18 ignores a result that was taken back, and does not bring an older revision back in its place', () => {
    const first = result(SET_IDS[0]!, { revision: 1 });
    const takenBack = result(SET_IDS[0]!, { revision: 2, deletedAt: '2026-10-09T08:10:00.000Z' });
    const { records } = run([first, takenBack]);
    expect(records[0]!.sets[0]!.observation).toBeNull();
    expect(run([takenBack]).records[0]!.sets[0]!.observation).toBeNull();
  });
});

describe('results that are not for a planned set', () => {
  it('keeps work beyond the plan with its exposure, and work with none apart', () => {
    const beyond = { ...result(SET_IDS[0]!), id: 'beyond', plannedSetId: null, logicalSetId: null };
    const loose = { ...beyond, id: 'loose', exposureId: null };
    const { records, unassigned, problems } = run([beyond, loose]);
    expect(problems).toEqual([]);
    expect(records[0]!.extra.map((o) => o.id)).toEqual(['beyond']);
    expect(unassigned.map((o) => o.id)).toEqual(['loose']);
    expect('deletedAt' in records[0]!.extra[0]!).toBe(false);
  });

  it('reports a result for a set that is not in the plan, and still counts it as work', () => {
    const ghost = result(SET_IDS[0]!, { id: 'ghost', plannedSetId: 's1/r1/e1/9' });
    const { records, problems } = run([ghost]);
    expect(problems).toEqual([
      { code: 'UNKNOWN_PLANNED_SET', recordId: 'ghost', detail: 's1/r1/e1/9', sessionId: 's1' },
    ]);
    expect(records[0]!.extra.map((o) => o.id)).toEqual(['ghost']);
    expect(records[0]!.sets.every((s) => s.observation === null)).toBe(true);
  });

  it('refuses a result recorded in one session for a set of another', () => {
    const wrong = result(SET_IDS[0]!, { id: 'wrong', sessionId: 's2' });
    const { problems } = run([wrong], { sessions: [session(), session({ sessionId: 's2' })] });
    expect(problems.map((p) => p.code)).toEqual(['UNKNOWN_PLANNED_SET']);
  });

  it('reports a result of a session nobody knows', () => {
    const { problems, records } = run([result(SET_IDS[0]!, { id: 'lost', sessionId: 'nope' })]);
    expect(problems).toEqual([
      { code: 'UNKNOWN_SESSION', recordId: 'lost', detail: 'nope', sessionId: 'nope' },
    ]);
    expect(records[0]!.sets[0]!.observation).toBeNull();
  });

  it('keeps a result in the wrong measure out of the set it was meant for', () => {
    const seconds = result(SET_IDS[0]!, {
      id: 'wrong-unit',
      amount: { ...legalObservation().amount, value: { kind: 'duration', seconds: 30 } },
    });
    const { problems, records } = run([seconds]);
    expect(problems).toEqual([
      {
        code: 'UNIT_MISMATCH',
        recordId: 'wrong-unit',
        detail: 'duration recorded for a reps target',
        sessionId: 's1',
      },
    ]);
    expect(records[0]!.sets[0]!.observation).toBeNull();
    expect(records[0]!.extra.map((o) => o.id)).toEqual(['wrong-unit']);
  });

  it('keeps a result with no amount at all as the result of its set — the quality check decides what it is worth', () => {
    const empty = result(SET_IDS[0]!, {
      status: 'interrupted',
      amount: { ...legalObservation().amount, value: null },
    });
    expect(run([empty]).problems).toEqual([]);
    expect(states([empty])[0]).toBe('interrupted');
  });

  it('T15 reports two different results for one set, keeping the newer, and never counting one twice', () => {
    const a = result(SET_IDS[0]!, { id: 'a', recordedAt: '2026-10-09T08:00:00.000Z' });
    const b = result(SET_IDS[0]!, { id: 'b', recordedAt: '2026-10-09T08:01:00.000Z' });
    const { records, problems } = run([a, b]);
    expect(problems).toEqual([
      {
        code: 'DUPLICATE_OBSERVATION',
        recordId: 'a',
        detail: `${SET_IDS[0]} also has b`,
        sessionId: 's1',
      },
    ]);
    expect(records[0]!.sets[0]!.observation!.id).toBe('b');
    expect(records[0]!.extra.map((o) => o.id)).toEqual(['a']);
  });

  it('reports a skip for a set that is not planned', () => {
    const { problems } = run([], { dispositions: [skip('s1/r1/e1/9')] });
    expect(problems).toEqual([
      {
        code: 'UNKNOWN_PLANNED_SET',
        recordId: 's1/r1/e1/9',
        detail: 'skip-s1/r1/e1/9',
        sessionId: null,
      },
    ]);
  });

  it('reports a plan whose session is not known', () => {
    const { problems, records } = run([], { sessions: [] });
    expect(problems).toEqual([
      {
        code: 'UNKNOWN_SESSION',
        recordId: 's1',
        detail: 'plan without a session',
        sessionId: 's1',
      },
    ]);
    expect(records).toEqual([]);
  });
});

describe('the context of an exposure', () => {
  it('T14 marks an abandoned session, whose work stays', () => {
    const { records } = run([result(SET_IDS[0]!)], {
      sessions: [session({ status: 'abandoned' })],
    });
    expect(records[0]!.context.abandoned).toBe(true);
    expect(records[0]!.sets[0]!.observation).not.toBeNull();
    expect(run([]).records[0]!.context.abandoned).toBe(false);
  });

  it('carries the deload week and the exposures the person shortened', () => {
    const { records } = run([], {
      sessions: [session({ deload: true, reducedExposures: ['s1/r1/e1'] })],
    });
    expect(records[0]!.context).toMatchObject({ deload: true, userReduced: true });
    expect(run([]).records[0]!.context).toMatchObject({ deload: false, userReduced: false });
  });

  it('reads how it felt: the exposure’s own word before the session’s, the latest first', () => {
    const feel = (feelValue: 'too_hard' | 'too_easy', at: string, exposureId: string | null) => ({
      sessionId: 's1',
      exposureId,
      feel: feelValue,
      channel: 'touch' as const,
      at,
    });
    const felt = (reports: ReturnType<typeof feel>[]) =>
      run([], { feel: reports }).records[0]!.context.feel;
    expect(felt([])).toBeNull();
    expect(felt([feel('too_hard', '2026-10-09T08:00:00Z', null)])).toBe('too_hard');
    expect(
      felt([
        feel('too_hard', '2026-10-09T08:00:00Z', null),
        feel('too_easy', '2026-10-09T08:05:00Z', 's1/r1/e1'),
      ]),
    ).toBe('too_easy');
    expect(
      felt([
        feel('too_easy', '2026-10-09T08:05:00Z', 's1/r1/e1'),
        feel('too_hard', '2026-10-09T08:09:00Z', null),
      ]),
    ).toBe('too_easy');
    expect(
      felt([
        feel('too_easy', '2026-10-09T08:09:00Z', 's1/r1/e1'),
        feel('too_hard', '2026-10-09T08:05:00Z', 's1/r1/e1'),
      ]),
    ).toBe('too_easy');
    expect(felt([{ ...feel('too_hard', '2026-10-09T08:00:00Z', 's1/r1/e9') }])).toBeNull();
  });
});

describe('the outcome of an exposure (02 §4)', () => {
  const versions = { planRevision: 1, historyRevision: 7 };
  const outcome = (
    state: Record<string, 'performed' | 'interrupted' | 'skipped' | 'pending'>,
    closed: boolean,
  ) => exposureOutcome(exposure, new Map(Object.entries(state)), versions, closed);

  it.each([
    [4, { performed: 4, interrupted: 0, skipped: 0 }, 'complete'],
    [4, { performed: 1, interrupted: 0, skipped: 3 }, 'partial'],
    [4, { performed: 0, interrupted: 1, skipped: 0 }, 'partial'],
    [4, { performed: 0, interrupted: 0, skipped: 4 }, 'skipped'],
    [4, { performed: 0, interrupted: 0, skipped: 1 }, 'partial'],
    [4, { performed: 0, interrupted: 0, skipped: 0 }, 'not_started'],
  ] as const)('expected %i with %j is %s', (expected, counts, status) => {
    expect(outcomeStatus(expected, counts)).toBe(status);
  });

  it('counts a plan’s sets and says which revisions it was worked out from', () => {
    expect(outcome({ [SET_IDS[0]!]: 'performed', [SET_IDS[1]!]: 'skipped' }, false)).toEqual({
      exposureId: 's1/r1/e1',
      status: 'partial',
      planRevision: 1,
      historyRevision: 7,
      expected: 4,
      performed: 1,
      interrupted: 0,
      skipped: 1,
    });
  });

  it('counts an interrupted set as neither done nor skipped', () => {
    expect(outcome({ [SET_IDS[0]!]: 'interrupted' }, false)).toMatchObject({
      status: 'partial',
      interrupted: 1,
      performed: 0,
      skipped: 0,
    });
  });

  it('T12/T13 a skipped exposure is not a failure, and a closed session reads what is left as skipped', () => {
    expect(outcome(Object.fromEntries(SET_IDS.map((id) => [id, 'skipped'])), false).status).toBe(
      'skipped',
    );
    expect(outcome({}, false).status).toBe('not_started');
    expect(outcome({}, true).status).toBe('skipped');
    expect(outcome({ [SET_IDS[0]!]: 'performed' }, true)).toMatchObject({
      status: 'partial',
      skipped: 3,
    });
    expect(outcome(Object.fromEntries(SET_IDS.map((id) => [id, 'performed'])), true).status).toBe(
      'complete',
    );
  });
});
