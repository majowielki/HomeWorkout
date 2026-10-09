import { defaultPreferences } from '../../../domain/preferences/preferences';
import type { PlanConstraint } from '../../../domain/plan/constraints';
import { syncWeek, type StoredDay } from '../../../domain/plan/week';
import { CATALOG, ELIGIBILITY, SELECTIONS, SLOTS } from '../../../domain/__tests__/dayFixtures';
import { VERSIONS } from '../../../domain/__tests__/compileFixtures';
import { HASH_A } from '../../../domain/__tests__/planFixtures';
import { CHAT_TOOLS, type ToolInput } from '../../contract/chatTools';
import {
  describeDayOptions,
  describePlan,
  describeWeek,
  movementName,
  previewDayPlan,
  previewPlanChange,
  proposeDayPreview,
  summarizeDay,
  validateComposeIntent,
  validateExtraQuestion,
  validatePlanIntent,
  type WeekContext,
} from '../planPreview';

const FROM = '2026-10-05';
const context = (patch: Partial<WeekContext> = {}): WeekContext => ({
  asOf: FROM,
  catalog: CATALOG,
  slots: SLOTS,
  eligibility: ELIGIBILITY,
  block: {
    index: 1,
    startedOn: FROM,
    deloadFrom: null,
    deloadReason: null,
    selections: SELECTIONS,
  },
  endedBlocks: [],
  records: [],
  rides: [],
  daily: [],
  preferences: defaultPreferences(),
  versions: VERSIONS,
  snapshotFingerprint: HASH_A,
  stored: [],
  trainedDates: new Set(),
  ...patch,
});
/** The week as it would be after a first look at it: stored, with the summaries. */
const stored = (ctx: WeekContext): StoredDay[] => syncWeek(ctx).rows;
const compound = SLOTS.find((s) => s.kind === 'compound')!;
const rest = (date: string): PlanConstraint => ({
  id: 'c-rest',
  kind: 'rest_day',
  muscles: [],
  from: date,
  until: date,
  reason: 'busy',
  source: 'user',
  note: null,
});

describe('P5.6c the plan tools on the week of engine', () => {
  describe('a day as the chat describes it', () => {
    it('names the exercises and movements and carries the reasons of the day, never a load', () => {
      const ctx = context();
      const [today] = stored(ctx);
      const out = summarizeDay(ctx, FROM, today!);
      expect(out.status).toBe('planned');
      expect(out.rest).toBe(false);
      expect(out.exercises.length).toBeGreaterThan(0);
      expect(out.exercises[0]!.exercise.name).toBe(CATALOG[out.exercises[0]!.exercise.id]!.name);
      expect(out.exercises[0]!.movement).toBe(
        SLOTS.find((s) => s.name === out.exercises[0]!.movement)!.name,
      );
      expect(out.estimatedMinutes).toBeGreaterThan(0);
      expect(out.phase).toBe('work');
      expect(JSON.stringify(out)).not.toMatch(/kg|resistance|massGrams/);
      expect(CHAT_TOOLS.getWeekPlan.output.shape.days.safeParse([out]).success).toBe(true);
    });

    it('keeps only the reasons the contract names, and the movement the shipped data names', () => {
      const ctx = context();
      const out = summarizeDay(ctx, FROM, {
        forecast: null,
        summary: {
          phase: 'deload',
          dayReasons: ['FIRST_DAY', 'FROM_THE_FUTURE'],
          regions: ['push'],
          skipped: [
            { slotId: compound.id, exerciseId: null, reason: 'RECOVERING' },
            { slotId: 'no-such-slot', exerciseId: null, reason: 'FROM_THE_FUTURE' },
            { slotId: 'no-such-slot', exerciseId: null, reason: 'DOMS_HIGH' },
          ],
          composed: true,
          estimatedMinutes: 12,
        },
      });
      expect(out.dayReasons).toEqual(['FIRST_DAY']);
      expect(out.skipped).toEqual([
        { movement: compound.name, reason: 'RECOVERING' },
        { movement: 'no-such-slot', reason: 'DOMS_HIGH' },
      ]);
      expect(out).toMatchObject({
        phase: 'deload',
        composed: true,
        estimatedMinutes: 12,
        rest: true,
      });
      expect(movementName(ctx, 'x')).toBe('x');
    });

    it('an exercise outside any movement is named by itself', () => {
      const ctx = context();
      const [today] = stored(ctx);
      const forecast = {
        ...today!.forecast!,
        exposures: today!.forecast!.exposures.map((e) => ({ ...e, slotId: null })),
      };
      const out = summarizeDay(ctx, FROM, { forecast, summary: today!.summary });
      expect(out.exercises[0]!.movement).toBe(out.exercises[0]!.exercise.name);
    });

    it('a day with nothing planned is a rest day with no reasons', () => {
      expect(summarizeDay(context(), FROM, null)).toMatchObject({
        rest: true,
        composed: false,
        regions: [],
        phase: null,
        estimatedMinutes: 0,
        exercises: [],
        skipped: [],
      });
    });

    it('says a catalogue exercise it has lost by its id, and a one-sided exercise as per side', () => {
      const ctx = context();
      const [today] = stored(ctx);
      const lost = summarizeDay({ ...ctx, catalog: {} }, FROM, today!);
      expect(lost.exercises[0]!.exercise.name).toBe(lost.exercises[0]!.exercise.id);
      expect(lost.exercises[0]!.perSide).toBe(false);
    });
  });

  describe('getPlanExplanation', () => {
    it('explains today’s plan from the week: the reasons of the day and of each exercise', () => {
      const ctx = context();
      const rows = stored(ctx);
      const out = describePlan({ ...ctx, stored: rows }, 0, null);
      expect(CHAT_TOOLS.getPlanExplanation.output.safeParse(out).success).toBe(true);
      const o = out as Exclude<typeof out, { error: string }>;
      expect(o).toMatchObject({ date: FROM, source: 'today', blockIndex: 1, phase: 'work' });
      expect(o.dayReasons).toContain('FIRST_DAY');
      expect(o.bike.minutes).toBeGreaterThan(0);
      expect(o.exercises.length).toBeGreaterThan(0);
      for (const e of o.exercises) expect(e.reasons.length).toBeGreaterThan(0);
      expect(o.exercises[0]!.reasons).toContain('FIRST_COMPARABLE_EXPOSURE');
    });

    it('plans today from the week when nothing is stored yet, and says there is nothing for a day gone by', () => {
      const ctx = context();
      expect(describePlan(ctx, 0, null)).toMatchObject({ date: FROM, source: 'today' });
      expect(describePlan(ctx, 3, null)).toEqual({ error: 'no_plan' });
      expect(describePlan({ ...ctx, stored: [] }, 2, null)).toEqual({ error: 'no_plan' });
    });

    it('a session that was started is the plan as it was frozen, with what is known of its day', () => {
      const ctx = context();
      const rows = stored(ctx);
      const frozen = rows[0]!.forecast!;
      const out = describePlan({ ...ctx, stored: rows }, 0, frozen) as { source: string };
      expect(out.source).toBe('session');
      // A day with no stored summary explains its exercises and nothing else.
      const bare = describePlan(
        { ...ctx, stored: [{ ...rows[0]!, summary: undefined }] },
        0,
        frozen,
      ) as Exclude<ReturnType<typeof describePlan>, { error: string }>;
      expect(bare).toMatchObject({
        blockIndex: 1,
        phase: 'work',
        dayReasons: [],
        signals: [],
        skipped: [],
      });
      expect(bare.bike).toEqual({ minutes: 0, reasons: [] });
      expect(bare.exercises.length).toBeGreaterThan(0);
      expect(describePlan({ ...ctx, stored: [], block: null }, 1, frozen)).toMatchObject({
        blockIndex: 1,
      });
    });

    it('keeps only the codes the contract names and counts each reason once', () => {
      const ctx = context();
      const rows = stored(ctx);
      const frozen = rows[0]!.forecast!;
      const first = frozen.exposures[0]!;
      const changed = {
        ...frozen,
        exposures: [
          {
            ...first,
            slotId: null,
            trace: {
              ...first.trace,
              code: 'FROM_THE_FUTURE',
              evidence: { codes: ['DELOAD', 'DELOAD', 7, 'FROM_THE_FUTURE'] },
            },
          },
          {
            ...frozen.exposures[1]!,
            trace: { ...frozen.exposures[1]!.trace, evidence: { codes: 'nope' } },
          },
        ],
      };
      const summary = {
        ...rows[0]!.summary!,
        dayReasons: ['FIRST_DAY', 'FROM_THE_FUTURE'],
        signals: ['FATIGUE_HIGH', 'FROM_THE_FUTURE'],
        bike: { minutes: 15, reasons: ['BIKE_TIME_UP', 'FROM_THE_FUTURE'] },
        skipped: [
          { slotId: compound.id, exerciseId: null, reason: 'RECOVERING' },
          { slotId: compound.id, exerciseId: first.exercise.id, reason: 'FROM_THE_FUTURE' },
          { slotId: compound.id, exerciseId: first.exercise.id, reason: 'DOMS_HIGH' },
        ],
      };
      const out = describePlan(
        { ...ctx, stored: [{ ...rows[0]!, summary }] },
        0,
        changed,
      ) as Exclude<ReturnType<typeof describePlan>, { error: string }>;
      expect(out.exercises[0]!.reasons).toEqual(['DELOAD']);
      expect(out.exercises[0]!.movement).toBe(out.exercises[0]!.exercise.name);
      expect(out.exercises[1]!.reasons).toEqual([frozen.exposures[1]!.trace.code]);
      expect(out.dayReasons).toEqual(['FIRST_DAY']);
      expect(out.signals).toEqual(['FATIGUE_HIGH']);
      expect(out.bike).toEqual({ minutes: 15, reasons: ['BIKE_TIME_UP'] });
      expect(out.skipped.map((x) => [x.reason, x.exercise === null])).toEqual([
        ['RECOVERING', true],
        ['DOMS_HIGH', false],
      ]);
    });
  });

  describe('getWeekPlan', () => {
    it('lists seven days from today, the stored ones as they were planned', () => {
      const ctx = context();
      const out = describeWeek({ ...ctx, stored: stored(ctx) }, null);
      expect(out.asOf).toBe(FROM);
      expect(out.days).toHaveLength(7);
      expect(out.days.every((d) => d.status === 'planned')).toBe(true);
      expect(CHAT_TOOLS.getWeekPlan.output.safeParse(out).success).toBe(true);
    });

    it('shows today from the workout under way, and a trained day as done', () => {
      const ctx = context();
      const rows = stored(ctx);
      const live = rows[0]!.forecast!;
      const out = describeWeek(
        { ...ctx, stored: rows, trainedDates: new Set(['2026-10-06']) },
        { plan: live },
      );
      expect(out.days[0]!.status).toBe('in_progress');
      expect(out.days[0]!.exercises.length).toBeGreaterThan(0);
      expect(out.days[1]!.status).toBe('done');
      // With no stored row for today, a workout under way is still described.
      const bare = describeWeek({ ...ctx, stored: [] }, { plan: live });
      expect(bare.days[0]!.status).toBe('in_progress');
    });

    it('describes a rest day as one', () => {
      const ctx = context({ constraints: [rest('2026-10-07')] });
      const out = describeWeek({ ...ctx, stored: stored(ctx) }, null);
      expect(out.days[2]).toMatchObject({ date: '2026-10-07', rest: true, exercises: [] });
    });

    it('a day with no row at all is a rest day', () => {
      const ctx = context();
      const out = describeWeek({ ...ctx, stored: [] }, null);
      expect(out.days).toHaveLength(7);
    });
  });

  describe('proposePlanChange', () => {
    const intent: ToolInput<'proposePlanChange'> = {
      constraints: [{ kind: 'rest_day', muscles: [], fromDaysAhead: 2, days: 1, reason: 'busy' }],
      note: 'Dzień wolny na prośbę.',
    };

    it('previews the week with the request added and names the days that differ', () => {
      const ctx = context();
      const rows = stored(ctx);
      const { summary, constraints, sync } = previewPlanChange(
        { ...ctx, stored: rows },
        { ...intent, constraints: [...intent.constraints] },
        'p1',
      );
      expect(CHAT_TOOLS.proposePlanChange.output.safeParse(summary).success).toBe(true);
      expect(summary.constraints).toEqual([
        { kind: 'rest_day', muscles: [], from: '2026-10-07', until: '2026-10-07', reason: 'busy' },
      ]);
      expect(constraints[0]).toMatchObject({ id: 'p1-0', source: 'coach', note: intent.note });
      const changed = summary.changes.find((c) => c.after.date === '2026-10-07')!;
      expect(changed.before.rest).toBe(false);
      expect(changed.after.rest).toBe(true);
      expect(sync.trigger).toBe('coach');
    });

    it('compares with the plan as it would be when no day is stored yet', () => {
      const { summary } = previewPlanChange(context(), intent, 'p3');
      expect(summary.changes.some((c) => c.after.date === '2026-10-07' && c.after.rest)).toBe(true);
    });

    it('a request that changes nothing has no changes to show', () => {
      const ctx = context({ constraints: [rest('2026-10-07')] });
      const { summary } = previewPlanChange(
        { ...ctx, stored: stored(ctx) },
        {
          constraints: [
            { kind: 'rest_day', muscles: [], fromDaysAhead: 2, days: 1, reason: 'busy' },
          ],
          note: 'Dzień wolny.',
        },
        'p2',
      );
      expect(summary.changes.filter((c) => c.after.date === '2026-10-07')).toEqual([]);
    });
  });

  describe('proposeDayPlan', () => {
    // Two days ahead: the compound lift of today leaves its muscles recovering tomorrow.
    const intent = (
      slotId: string,
      sets?: number,
      daysAhead = 2,
      confirmRecovery = false,
    ): ToolInput<'proposeDayPlan'> => ({
      days: [
        {
          daysAhead,
          slots: [
            {
              slotId,
              ...(sets === undefined ? {} : { sets }),
              ...(confirmRecovery ? { confirmRecovery } : {}),
            },
          ],
        },
      ],
      note: 'Układamy dzień.',
    });

    it('composes the movements asked for and says nothing was refused', () => {
      const ctx = context();
      const preview = previewDayPlan({ ...ctx, stored: stored(ctx) }, intent(compound.id, 2), 'd1');
      expect(CHAT_TOOLS.proposeDayPlan.output.safeParse(preview.summary).success).toBe(true);
      expect(preview.summary.proposalId).toBe('d1');
      expect(preview.summary.days).toEqual([{ date: '2026-10-07', applied: true, conflicts: [] }]);
      expect(preview.constraints).toHaveLength(1);
      expect(preview.constraints[0]).toMatchObject({
        kind: 'compose_day',
        items: [{ slotId: compound.id, sets: 2 }],
      });
    });

    it('advises against a movement whose muscles have not recovered, and takes it once confirmed (D18)', () => {
      const ctx = context();
      const week = { ...ctx, stored: stored(ctx) };
      const advised = previewDayPlan(week, intent(compound.id, 2, 1), 'd6');
      expect(advised.summary.proposalId).toBeNull();
      expect(advised.summary.days[0]).toMatchObject({
        applied: false,
        conflicts: [{ movement: compound.name, reason: 'RECOVERING' }],
      });
      const confirmed = previewDayPlan(week, intent(compound.id, 2, 1, true), 'd7');
      expect(confirmed.summary.proposalId).toBe('d7');
      expect(confirmed.constraints[0]!.items).toEqual([
        { slotId: compound.id, sets: 2, confirmRecovery: true },
      ]);
    });

    it('takes the engine’s number of sets when none is asked for', () => {
      const ctx = context();
      const preview = previewDayPlan({ ...ctx, stored: stored(ctx) }, intent(compound.id), 'd2');
      expect(preview.constraints[0]!.items![0]!.sets).toBeGreaterThan(0);
    });

    it('says why a movement was not taken, and that nothing was when none was', () => {
      const exercise = CATALOG[SELECTIONS[compound.id]!]!;
      const ctx = context({
        constraints: [
          {
            id: 'c-avoid',
            kind: 'avoid_muscle',
            muscles: [exercise.primaryMuscles[0]!],
            from: FROM,
            until: '2026-10-12',
            reason: 'doms',
            source: 'user',
            note: null,
          },
        ],
      });
      const preview = previewDayPlan({ ...ctx, stored: stored(ctx) }, intent(compound.id, 2), 'd3');
      expect(preview.summary.proposalId).toBeNull();
      expect(preview.summary.days[0]).toMatchObject({
        applied: false,
        conflicts: [{ movement: compound.name, reason: 'AVOIDED_BY_REQUEST' }],
      });
      expect(preview.constraints).toEqual([]);
    });

    it('a rest day takes none of it', () => {
      const ctx = context({ constraints: [rest('2026-10-06')] });
      const preview = previewDayPlan(
        { ...ctx, stored: stored(ctx) },
        intent(compound.id, 2, 1),
        'd4',
      );
      expect(preview.summary.days[0]).toMatchObject({
        applied: false,
        conflicts: [{ movement: compound.name, reason: 'REST_DAY' }],
      });
    });

    it('takes back an earlier composition of the same day', () => {
      const earlier: PlanConstraint = {
        id: 'c-old',
        kind: 'compose_day',
        muscles: [],
        from: '2026-10-06',
        until: '2026-10-06',
        reason: 'other',
        source: 'coach',
        note: null,
        items: [{ slotId: compound.id, sets: 1 }],
      };
      const ctx = context({ constraints: [earlier] });
      const preview = previewDayPlan(
        { ...ctx, stored: stored(ctx) },
        intent(compound.id, 2, 1),
        'd5',
      );
      expect(preview.replaced).toEqual(['c-old']);
    });
  });

  describe('getDayOptions', () => {
    it('reports RECOVERING for a movement the day before the week has already trained (D18)', () => {
      const ctx = context();
      const out = describeDayOptions({ ...ctx, stored: stored(ctx) }, 1);
      if ('error' in out) throw new Error(out.error);
      const option = out.options.find((o) => o.slotId === compound.id)!;
      expect(option).toMatchObject({ available: false, reason: 'RECOVERING' });
    });

    it('offers every working movement with the engine’s sets, and the reason for one it cannot', () => {
      const exercise = CATALOG[SELECTIONS[compound.id]!]!;
      const ctx = context({
        constraints: [
          {
            id: 'c-avoid',
            kind: 'avoid_muscle',
            muscles: [exercise.primaryMuscles[0]!],
            from: FROM,
            until: '2026-10-12',
            reason: 'doms',
            source: 'user',
            note: null,
          },
        ],
      });
      const out = describeDayOptions({ ...ctx, stored: stored(ctx) }, 1);
      expect(CHAT_TOOLS.getDayOptions.output.safeParse(out).success).toBe(true);
      const o = out as Exclude<typeof out, { error: string }>;
      expect(o.date).toBe('2026-10-06');
      expect(o.options.length).toBe(SLOTS.filter((s) => s.kind !== 'filler').length);
      const blocked = o.options.find((x) => x.slotId === compound.id)!;
      expect(blocked).toMatchObject({ available: false, reason: 'AVOIDED_BY_REQUEST', sets: 0 });
      const open = o.options.find((x) => x.available)!;
      expect(open.sets).toBeGreaterThan(0);
      expect(open.reason).toBeNull();
      expect(o.plan.date).toBe('2026-10-06');
    });

    it('a rest day offers nothing, and a day already gone is closed', () => {
      const ctx = context({ constraints: [rest('2026-10-06')], trainedDates: new Set([FROM]) });
      const out = describeDayOptions({ ...ctx, stored: [] }, 1) as {
        rest: boolean;
        options: { available: boolean }[];
      };
      expect(out.rest).toBe(true);
      expect(out.options.every((x) => !x.available)).toBe(true);
      expect(describeDayOptions({ ...ctx, stored: [] }, 0)).toEqual({ error: 'day_done' });
    });

    it('names a slot whose reason the contract does not know as having no candidate', () => {
      const out = describeDayOptions(
        context({
          slots: SLOTS.map((s) => (s.id === compound.id ? { ...s, exerciseIds: [] } : s)),
        }),
        1,
      );
      const o = out as Exclude<typeof out, { error: string }>;
      expect(o.options.find((x) => x.slotId === compound.id)).toMatchObject({ available: false });
    });
  });

  describe('the words of the person', () => {
    const plan = (note: string, patch = {}) => ({
      constraints: [
        {
          kind: 'rest_day' as const,
          muscles: [],
          fromDaysAhead: 0,
          days: 1,
          reason: 'busy' as const,
          ...patch,
        },
      ],
      note,
    });

    it('lets a neutral note through and stops one that prescribes or that the gate keeps out', () => {
      expect(
        validatePlanIntent(plan('Dzień wolny na prośbę.'), 'Chcę dzień wolny jutro'),
      ).toBeNull();
      expect(validatePlanIntent(plan('Zrób 12 powtórzeń z 8 kg'), 'dzień wolny')).toEqual({
        error: 'invalid_input',
      });
      expect(validatePlanIntent(plan('Dzień wolny'), 'bardzo boli mnie kolano')).toEqual({
        error: 'invalid_input',
      });
    });

    it('asks when the soreness is not said to be strong, and refuses a range outside the week', () => {
      const avoid = (p = {}) =>
        plan('Pomijam partię.', {
          kind: 'avoid_muscle',
          muscles: ['glutes'],
          reason: 'doms',
          domsLevel: 5,
          ...p,
        });
      expect(
        validatePlanIntent(avoid({ domsLevel: undefined }), 'mam zakwasy w pośladkach'),
      ).toEqual({
        error: 'clarification_required',
      });
      expect(validatePlanIntent(avoid(), 'mam silne zakwasy 5/5 w pośladkach')).toBeNull();
      expect(
        validatePlanIntent(plan('Dzień wolny.', { days: 3, fromDaysAhead: 6 }), 'wolne'),
      ).toEqual({ error: 'invalid_input' });
    });

    it('checks that composed movements exist, that a day is named once, and that soreness is not hidden', () => {
      const compose = (days: { daysAhead: number; slots: { slotId: string }[] }[]) => ({
        days,
        note: 'Układamy.',
      });
      expect(
        validateComposeIntent(
          compose([{ daysAhead: 1, slots: [{ slotId: compound.id }] }]),
          'ułóż jutro',
          SLOTS,
        ),
      ).toBeNull();
      expect(
        validateComposeIntent(
          compose([{ daysAhead: 1, slots: [{ slotId: 'nope' }] }]),
          'ułóż jutro',
          SLOTS,
        ),
      ).toEqual({ error: 'invalid_input' });
      expect(
        validateComposeIntent(
          compose([
            { daysAhead: 1, slots: [{ slotId: compound.id }] },
            { daysAhead: 1, slots: [{ slotId: compound.id }] },
          ]),
          'ułóż jutro',
          SLOTS,
        ),
      ).toEqual({ error: 'invalid_input' });
      expect(
        validateComposeIntent(
          compose([{ daysAhead: 1, slots: [{ slotId: compound.id }] }]),
          'ułóż jutro, mam silne zakwasy w nogach',
          SLOTS,
        ),
      ).toEqual({ error: 'clarification_required' });
      expect(
        validateComposeIntent(
          {
            days: [{ daysAhead: 1, slots: [{ slotId: compound.id }] }],
            note: 'Dodaj 3 serie po 20 kg',
          },
          'ułóż',
          SLOTS,
        ),
      ).toEqual({ error: 'invalid_input' });
    });

    it('extra work needs a question that passes the gate and does not hide soreness', () => {
      expect(validateExtraQuestion('dodatkowy trening na brzuch')).toBeNull();
      expect(validateExtraQuestion('boli mnie kolano, dodatkowy trening')).toEqual({
        error: 'invalid_input',
      });
      expect(validateExtraQuestion('mam zakwasy, dodatkowy trening na nogi')).toEqual({
        error: 'clarification_required',
      });
    });

    it('composes a day only when it is still ahead, and returns the cleaned note with the preview', () => {
      const ctx = context();
      const input = {
        days: [{ daysAhead: 2, slots: [{ slotId: compound.id, sets: 2 }] }],
        note: 'Układamy dzień.',
      };
      const ok = proposeDayPreview({ ...ctx, stored: stored(ctx) }, input, 'ułóż jutro', 'x1');
      expect('preview' in ok && ok.preview.summary.proposalId).toBe('x1');
      expect(proposeDayPreview(ctx, input, 'ułóż jutro, mam silne zakwasy', 'x2')).toEqual({
        error: { error: 'clarification_required' },
      });
      const closed = context({ trainedDates: new Set([FROM]) });
      expect(
        proposeDayPreview(
          closed,
          { ...input, days: [{ daysAhead: 0, slots: [{ slotId: compound.id }] }] },
          'ułóż dziś',
          'x3',
        ),
      ).toEqual({ error: { error: 'day_done' } });
    });
  });
});
