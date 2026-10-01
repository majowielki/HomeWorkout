import { addDays } from '@/domain/time/trainingDate';

import { coachContextSchema } from '../../contract/coachContext';
import { scenario } from '../../testing/synthetic';
import { buildCoachContext } from '../buildCoachContext';
import type { CoachSource, SourceSet } from '../source';

const build = (spec: Parameters<typeof scenario>[0] = {}) => buildCoachContext(scenario(spec));

describe('buildCoachContext — sessions and history', () => {
  it('describes a steady block of training', () => {
    const { context } = build();
    expect(context.asOf).toBe('2026-10-01');
    expect(context.windowDays).toBe(28);
    expect(context.goal).toBe('lean_mass_retention_in_deficit');
    expect(context.sessions).toHaveLength(9);
    expect(context.historicalSessionCount).toBe(29); // 20 older + 9 in the window
    expect(context.signals).toEqual([]);
    expect(context.sessions[0]).toMatchObject({
      template: 'FBW A',
      durationMin: 42,
      sessionRpe: 7,
    });
  });

  it('puts sessions in date order and exercises in the order they were done', () => {
    const { context } = build();
    const dates = context.sessions.map((s) => s.date);
    expect(dates).toEqual([...dates].sort());
    expect(context.sessions[0]!.exercises.map((e) => e.exerciseId)).toEqual([
      'goblet-squat',
      'band-row',
      'db-romanian-deadlift',
      'db-floor-press',
      'glute-bridge',
      'plank',
    ]);
  });

  it('counts working sets per session and leaves warm-ups out', () => {
    const source = scenario();
    const first = source.completedWorkouts.find((w) => w.id === 'w-0')!;
    const warmup: SourceSet = {
      ...source.sets[0]!,
      id: 'warmup',
      workoutId: first.id,
      isWarmup: true,
    };
    const { context } = buildCoachContext({ ...source, sets: [...source.sets, warmup] });
    expect(context.sessions[0]!.workingSets).toBe(12);
    expect(context.sessions[0]!.exercises[0]!.sets).toHaveLength(2);
  });

  it('ignores sessions outside the window but counts them in the history', () => {
    const { context } = build({ sessions: 3, olderSessions: 10 });
    expect(context.sessions).toHaveLength(3);
    expect(context.historicalSessionCount).toBe(13);
  });

  it('orders two sessions on the same day by when they started', () => {
    const source = scenario({ sessions: 1, olderSessions: 0 });
    const [first] = source.completedWorkouts;
    const early = { ...first!, id: 'early', startedAt: `${first!.trainingDate}T08:00:00.000Z` };
    const late = { ...first!, id: 'late', startedAt: `${first!.trainingDate}T20:00:00.000Z` };
    const { context } = buildCoachContext({
      ...source,
      completedWorkouts: [late, early],
      sets: [],
    });
    expect(context.sessions).toHaveLength(2);
    expect(context.sessions.every((s) => s.workingSets === 0 && s.exercises.length === 0)).toBe(
      true,
    );
  });

  it('keeps a completed session that has no sets logged', () => {
    const source = scenario({ sessions: 2, olderSessions: 0 });
    const { context } = buildCoachContext({
      ...source,
      sets: source.sets.filter((s) => s.workoutId !== 'w-1'),
    });
    expect(context.sessions[1]).toMatchObject({ workingSets: 0, exercises: [] });
  });

  it('has no duration for a session that was never finished', () => {
    const source = scenario({ sessions: 2 });
    const open = {
      ...source,
      completedWorkouts: source.completedWorkouts.map((w) =>
        w.id === 'w-1' ? { ...w, finishedAt: null } : w,
      ),
    };
    expect(buildCoachContext(open).context.sessions[1]!.durationMin).toBeNull();
  });

  it('names an exercise by id when the catalogue does not know it', () => {
    const source = scenario({ sessions: 2 });
    const { context } = buildCoachContext({ ...source, exercises: [] });
    expect(context.sessions[0]!.exercises[0]!.name).toBe('goblet-squat');
  });
});

describe('buildCoachContext — loads', () => {
  const lone = (patch: Partial<SourceSet>): CoachSource => {
    const base = scenario({ sessions: 1, olderSessions: 0 });
    return { ...base, sets: [{ ...base.sets[0]!, ...patch }] };
  };
  const loadOfFirstSet = (source: CoachSource) =>
    buildCoachContext(source).context.sessions[0]!.exercises[0]!.sets[0]!.load;

  it('reads a dumbbell set', () => {
    expect(
      loadOfFirstSet(
        lone({ weightKg: 12, dumbbellMode: 'paired', bandId: null, anchorPosition: null }),
      ),
    ).toEqual({ kind: 'dumbbell', mode: 'paired', kg: 12 });
  });

  it('assumes a single dumbbell when the mode was not recorded', () => {
    expect(
      loadOfFirstSet(
        lone({ weightKg: 12, dumbbellMode: null, bandId: null, anchorPosition: null }),
      ),
    ).toEqual({ kind: 'dumbbell', mode: 'single', kg: 12 });
  });

  it('reads a band set and its anchor position', () => {
    expect(
      loadOfFirstSet(
        lone({ weightKg: null, dumbbellMode: null, bandId: 'black', anchorPosition: 2 }),
      ),
    ).toEqual({ kind: 'band', bandId: 'black', position: 2 });
  });

  it('falls back to position 0 for a band set with no usable position', () => {
    expect(
      loadOfFirstSet(
        lone({ weightKg: null, dumbbellMode: null, bandId: 'black', anchorPosition: null }),
      ),
    ).toEqual({ kind: 'band', bandId: 'black', position: 0 });
    expect(
      loadOfFirstSet(
        lone({ weightKg: null, dumbbellMode: null, bandId: 'black', anchorPosition: 9 }),
      ),
    ).toEqual({ kind: 'band', bandId: 'black', position: 0 });
  });

  it('treats a set with no weight and no band as bodyweight', () => {
    expect(
      loadOfFirstSet(
        lone({ weightKg: null, dumbbellMode: null, bandId: null, anchorPosition: null }),
      ),
    ).toEqual({ kind: 'bodyweight' });
    expect(
      loadOfFirstSet(lone({ weightKg: 0, dumbbellMode: null, bandId: null, anchorPosition: null })),
    ).toEqual({ kind: 'bodyweight' });
  });
});

describe('buildCoachContext — signals', () => {
  it('flags a sparse history', () => {
    const { context } = build({ sessions: 2, olderSessions: 0, lastSessionDaysAgo: 1 });
    expect(context.signals).toEqual(['SPARSE_HISTORY']);
    expect(context.historicalSessionCount).toBe(2);
  });

  it('flags a layoff by the days since the last session', () => {
    expect(build({ lastSessionDaysAgo: 12 }).context.signals).toEqual(['LAYOFF_SHORT']);
    expect(build({ lastSessionDaysAgo: 20 }).context.signals).toEqual(['LAYOFF_MEDIUM']);
  });

  it('flags three short nights in a row', () => {
    const { context } = build({ sleep: { hours: 5, days: 3 } });
    expect(context.signals).toEqual(['SLEEP_LOW_STREAK']);
    expect(context.recovery.avgSleepHours).toBe(5);
    expect(context.recovery.daysLogged).toBe(3);
  });

  it('measures the history up to the summary date, not past it', () => {
    const source = scenario({ sessions: 4, olderSessions: 0 });
    const future = {
      id: 'future',
      trainingDate: addDays(source.asOf, 3),
      startedAt: `${addDays(source.asOf, 3)}T17:00:00.000Z`,
      finishedAt: null,
      templateName: 'FBW A',
      sessionRpe: null,
      notes: null,
    };
    const { context } = buildCoachContext({
      ...source,
      completedWorkouts: [...source.completedWorkouts, future],
    });
    expect(context.historicalSessionCount).toBe(4);
  });
});

describe('buildCoachContext — constraints', () => {
  it('turns the knee profile into limit codes, not a diagnosis', () => {
    expect(build().context.constraints).toEqual([
      'knee_no_frontal_plane_under_load',
      'knee_limit_anterior_shear',
      'knee_bilateral_only_until_physio',
    ]);
  });

  it('has none without a knee profile', () => {
    expect(build({ knee: null }).context.constraints).toEqual([]);
  });

  it('drops the conservative-mode limit once a physio has signed off', () => {
    const knee = {
      side: 'right',
      missingCollaterals: false,
      aclReconstructed: false,
      varusThrust: false,
      physioApproved: true,
    } as const;
    expect(build({ knee }).context.constraints).toEqual([]);
  });
});

describe('buildCoachContext — weekly volume', () => {
  it('lists four rolling weeks, newest first', () => {
    const { context } = build();
    expect(context.weeklyVolume.map((w) => w.endDate)).toEqual([
      '2026-10-01',
      '2026-09-24',
      '2026-09-17',
      '2026-09-10',
    ]);
  });

  it('weights primary muscles at 1 and secondary at 0.5 and rates them against the band', () => {
    const { context } = build();
    const week = context.weeklyVolume[0]!;
    const quads = week.muscles.find((m) => m.muscle === 'quads');
    expect(quads).toBeDefined();
    expect(quads!.sets).toBeGreaterThan(0);
    expect(['below_min', 'in_range', 'above_max']).toContain(quads!.status);
    expect(week.muscles.every((m) => m.sets > 0)).toBe(true);
  });

  it('is empty for a week with no sessions', () => {
    const { context } = build({ sessions: 2, cadenceDays: 3, lastSessionDaysAgo: 1 });
    expect(context.weeklyVolume[3]!.muscles).toEqual([]);
  });
});

describe('buildCoachContext — trends', () => {
  it('reports progress when the numbers climb', () => {
    const { context } = build({ progress: 'improving' });
    expect(context.trendSummary.improved).toBeGreaterThan(0);
    expect(context.trendSummary.declined).toBe(0);
    expect(context.trends.every((t) => t.sessions >= 2)).toBe(true);
  });

  it('reports a decline when they fall', () => {
    const { context } = build({ progress: 'declining' });
    expect(context.trendSummary.declined).toBeGreaterThan(0);
  });

  it('reports maintenance when nothing moves', () => {
    const { context } = build({ progress: 'flat' });
    expect(context.trendSummary).toEqual({
      improved: 0,
      maintained: context.trends.length,
      declined: 0,
    });
    expect(context.trends.length).toBeGreaterThan(0);
  });

  it('says nothing about an exercise done once', () => {
    expect(build({ sessions: 1, olderSessions: 0 }).context.trends).toEqual([]);
  });
});

describe('buildCoachContext — body', () => {
  it('summarises the weight series', () => {
    const { weight } = build({ weight: { startKg: 96, perWeekKg: -0.6 } }).context;
    expect(weight).not.toBeNull();
    expect(weight!.entries).toBe(28);
    expect(weight!.latestDate).toBe('2026-10-01');
    expect(weight!.avg7Kg).not.toBeNull();
    expect(weight!.trendKgPerWeek).toBeLessThan(0);
    expect(weight!.avg7ChangeKg).toBeLessThan(0);
  });

  it('has no weight block without weigh-ins', () => {
    expect(build({ weight: null }).context.weight).toBeNull();
  });

  it('drops the 7-day mean when the last weigh-in is old', () => {
    const { weight } = build({
      weight: { startKg: 96, perWeekKg: -0.6, days: 14, lastEntryDaysAgo: 9 },
    }).context;
    expect(weight!.avg7Kg).toBeNull();
    expect(weight!.latestDate).toBe('2026-09-22');
  });

  it('has no change figure from a single weigh-in', () => {
    const { weight } = build({ weight: { startKg: 96, perWeekKg: -0.6, days: 1 } }).context;
    expect(weight!.entries).toBe(1);
    expect(weight!.avg7ChangeKg).toBeNull();
    expect(weight!.trendKgPerWeek).toBeNull();
  });

  it('reports the waist change across the window', () => {
    const { waist } = build({ waist: { startCm: 104, perWeekCm: -0.5 } }).context;
    expect(waist).toEqual({
      latestCm: 102.5,
      latestDate: '2026-10-01',
      changeCm: -1.5,
      entries: 4,
    });
  });

  it('has no waist block without measurements, and no change from one', () => {
    expect(build({ waist: null }).context.waist).toBeNull();
    const single = { ...scenario(), waists: [{ date: '2026-09-28', value: 101 }] };
    expect(buildCoachContext(single).context.waist).toMatchObject({ changeCm: null, entries: 1 });
  });
});

describe('buildCoachContext — recovery', () => {
  it('counts the days a muscle was reported very sore', () => {
    const { recovery } = build({ highSoreness: ['quads', 'glutes'] }).context;
    expect(recovery.highSoreness).toEqual([
      { muscle: 'quads', days: 2 },
      { muscle: 'glutes', days: 2 },
    ]);
  });

  it('averages only the values that were logged', () => {
    const { recovery } = build({ sleep: { hours: 7, days: 2 } }).context;
    expect(recovery.avgSleepHours).toBe(7);
    expect(recovery.avgEnergy).toBe(3);
    expect(recovery.avgStress).toBe(2);
  });

  it('has nothing to average without daily logs', () => {
    expect(build().context.recovery).toEqual({
      daysLogged: 0,
      avgSleepHours: null,
      avgEnergy: null,
      avgStress: null,
      highSoreness: [],
    });
  });
});

describe('buildCoachContext — notes', () => {
  const notes = [
    { daysAgo: 1, source: 'daily' as const, text: 'zakwasy w udach po przysiadach' },
    { daysAgo: 2, source: 'daily' as const, text: 'kolano strzyka przy schodzeniu' },
    { daysAgo: 3, source: 'daily' as const, text: 'ile kalorii powinienem jeść' },
    { daysAgo: 5, source: 'session' as const, text: 'trening poszedł lepiej' },
  ];

  it('passes soreness and ordinary notes, oldest first', () => {
    const { context } = build({ notes, sessions: 9, cadenceDays: 3, lastSessionDaysAgo: 5 });
    expect(context.notes.map((n) => n.text)).toEqual([
      'trening poszedł lepiej',
      'zakwasy w udach po przysiadach',
    ]);
    expect(context.notes.map((n) => n.source)).toEqual(['session', 'daily']);
  });

  it('withholds injury and out-of-scope notes and says how many', () => {
    const { omissions } = build({ notes, lastSessionDaysAgo: 5 });
    expect(omissions).toEqual({ medicalNotes: 1, outOfScopeNotes: 1 });
  });

  it('ignores notes older than the note window', () => {
    const { context, omissions } = build({
      notes: [{ daysAgo: 20, source: 'daily', text: 'kolano strzyka' }],
    });
    expect(context.notes).toEqual([]);
    expect(omissions.medicalNotes).toBe(0);
  });
});

describe('buildCoachContext — what a model must never be told (I9)', () => {
  const forbiddenWords = [
    'mounjaro',
    'tirzepat',
    'semaglut',
    'kneeProfile',
    'missingCollaterals',
    'aclReconstructed',
    'varusThrust',
    'birthYear',
    'heightCm',
    'saddle',
    'email',
  ];

  it('carries no diagnosis, no drug and no profile field, whatever the data', () => {
    const rich = build({
      weight: { startKg: 96, perWeekKg: -0.6 },
      waist: { startCm: 104, perWeekCm: -0.5 },
      sleep: { hours: 5, days: 4 },
      highSoreness: ['quads'],
      progress: 'improving',
      notes: [{ daysAgo: 1, source: 'daily', text: 'zakwasy w łydkach' }],
    });
    const json = JSON.stringify(rich.context).toLowerCase();
    for (const word of forbiddenWords) expect(json).not.toContain(word.toLowerCase());
  });

  it('is exactly the keys the contract lists — an extra field does not survive', () => {
    const { context } = build();
    expect(Object.keys(context).sort()).toEqual(Object.keys(coachContextSchema.shape).sort());
    expect(coachContextSchema.safeParse({ ...context, email: 'a@b.c' }).success).toBe(false);
  });

  it('never lets a note that reads as an injury through, however it is phrased', () => {
    const phrasings = [
      'kolano strzyka',
      'boli bark',
      'mam kontuzję',
      'rwa kulszowa',
      'kolano daje o sobie znać',
    ];
    for (const text of phrasings) {
      const { context } = build({ notes: [{ daysAgo: 1, source: 'daily', text }] });
      expect(context.notes).toEqual([]);
    }
  });
});
