/**
 * Engine v2, P1 (05 §5-§8, tests T42-T45, T49-T51): the resistance models, their
 * registry, the v1 adapter, and equipment the app does not have yet.
 */
import { BANDS, DUMBBELLS, dumbbellLadder } from '../inventory';
import { bandLoadLadder, dumbbellLoadLadder } from '../progression/ladder';
import { compareSpecs, resistanceComparisonKey } from '../resistance/compare';
import { createLadderModel } from '../resistance/ladderModel';
import {
  bandValue,
  bodyweightValue,
  dumbbellValue,
  loadFromSpec,
  modelIdOf,
  specFromLoad,
} from '../resistance/persistedLoad';
import {
  BAND_GEOMETRY,
  createBandModel,
  createBodyweightModel,
  createDumbbellModel,
} from '../resistance/models';
import {
  BUILT_IN_FACTORIES,
  createResistanceRegistry,
  defineModel,
  RESISTANCE_REGISTRY,
} from '../resistance/registry';
import {
  RESISTANCE_SCHEMA_VERSION,
  resistanceSpecSchema,
  type ResistanceSpec,
  type ResistanceValue,
} from '../resistance/types';
import type { BandCalibration, BandCalibrationMap, PlannedLoad } from '../types';
import { z } from 'zod';
import { describeResistanceModel } from './resistanceContract';
import {
  assistedModel,
  barbellConfigs,
  barbellModel,
  kettlebellModel,
  stackModel,
  weightedBodyweightModel,
} from './resistanceFixtures';

const linear = (k: number): BandCalibration => ({
  restLengthCm: 100,
  points: [
    { massKg: 0, lengthCm: 100 },
    { massKg: 18, lengthCm: 400 },
  ],
  fit: { type: 'linear', coeffs: [0, k] },
  maxMeasuredKg: 100,
});
/** Bands that get stiffer by very different amounts, so some jumps are gentle and some are not. */
const CALIBRATED: BandCalibrationMap = {
  yellow: linear(5),
  red: linear(6),
  black: linear(13),
  purple: linear(30),
  green: null,
};
const ROM = 50;
const paired = (kg: number): PlannedLoad => ({ kind: 'dumbbell', mode: 'paired', kg });
const single = (kg: number): PlannedLoad => ({ kind: 'dumbbell', mode: 'single', kg });

// ------------------------------------------------------- the contract, everywhere

describeResistanceModel('dumbbell.paired', () => createDumbbellModel('paired'), {
  offLadder: [
    { kind: 'external_mass', massGrams: 5000, convention: 'per_hand', implementCount: 2 },
    { kind: 'external_mass', massGrams: 1000, convention: 'per_hand', implementCount: 2 },
    { kind: 'external_mass', massGrams: 99000, convention: 'per_hand', implementCount: 2 },
  ],
  invalid: [{ kind: 'external_mass', massGrams: 4000, convention: 'total', implementCount: 1 }],
});
describeResistanceModel('dumbbell.single', () => createDumbbellModel('single'));
describeResistanceModel('band.long, not calibrated', () => createBandModel({ romCm: ROM }), {
  maxSkipUp: 1,
  invalid: [
    { kind: 'band_position', bandId: 'red', positionId: 'P7', geometryRevision: BAND_GEOMETRY },
    { kind: 'band_position', bandId: 'pink', positionId: 'P1', geometryRevision: BAND_GEOMETRY },
    { kind: 'band_position', bandId: 'red', positionId: 'P1', geometryRevision: 'another' },
  ],
});
describeResistanceModel(
  'band.long, calibrated',
  () => createBandModel({ romCm: ROM, calibrations: CALIBRATED }),
  { maxSkipUp: 1 },
);
describeResistanceModel('bodyweight', () => createBodyweightModel('crunch'), {
  invalid: [
    { kind: 'bodyweight', variantId: 'plank', addedMassGrams: 0, assistance: null },
    { kind: 'bodyweight', variantId: 'crunch', addedMassGrams: 5000, assistance: null },
  ],
});
describeResistanceModel('barbell, kg', () =>
  barbellModel(20, [
    { mass: 5, pairs: 2 },
    { mass: 1.25, pairs: 2 },
  ]),
);
describeResistanceModel('barbell, lb', () =>
  barbellModel(
    45,
    [
      { mass: 2.5, pairs: 1 },
      { mass: 10, pairs: 2 },
      { mass: 45, pairs: 1 },
    ],
    'lb',
  ),
);
describeResistanceModel('kettlebell, one', () => kettlebellModel([8, 12, 16, 20], 1));
describeResistanceModel('kettlebell, a pair', () => kettlebellModel([8, 12, 16], 2));
describeResistanceModel(
  'weight stack',
  () =>
    stackModel('leg-press-1', [
      { id: 'p1', shown: 10 },
      { id: 'p2', shown: 15 },
      { id: 'p3', shown: 22.5 },
      { id: 'p4', shown: 30 },
    ]),
  {
    invalid: [
      { kind: 'machine_setting', settingId: 'p9', displayValue: 20, displayUnit: 'kg' },
      { kind: 'machine_setting', settingId: 'p2', displayValue: 20, displayUnit: 'kg' },
    ],
  },
);
describeResistanceModel(
  'assisted pull-up',
  () => assistedModel('pull-up', [40, 35, 30, 20, 10, 0]),
  {
    offLadder: [
      {
        kind: 'bodyweight',
        variantId: 'pull-up',
        addedMassGrams: 0,
        assistance: { massGrams: 40000 },
      },
    ],
  },
);
describeResistanceModel('weighted dip', () => weightedBodyweightModel('dip', [0, 2.5, 5, 10, 20]));

// ------------------------------------------------ the built-in models are the v1 ladders

describe('the built-in models agree with the v1 ladders step for step', () => {
  it.each(['paired', 'single'] as const)('dumbbell %s', (mode) => {
    const model = createDumbbellModel(mode);
    const ladder = dumbbellLoadLadder(mode, dumbbellLadder(mode)[0]!);
    const kgOf = (v: ResistanceValue | undefined) =>
      v && v.kind === 'external_mass' ? v.massGrams / 1000 : null;
    for (const kg of dumbbellLadder(mode)) {
      const load: PlannedLoad = { kind: 'dumbbell', mode, kg };
      const value = dumbbellValue(mode, kg);
      const up = ladder.up(load);
      const down = ladder.down(load);
      expect(kgOf(model.nextHarder(value)?.value)).toBe(
        up && up.load.kind === 'dumbbell' ? up.load.kg : null,
      );
      expect(kgOf(model.nextEasier(value)?.value)).toBe(
        down && down.kind === 'dumbbell' ? down.kg : null,
      );
    }
  });

  it.each([
    ['no calibration', {}],
    ['calibrated', CALIBRATED],
  ])('bands, %s', (_, calibrations: BandCalibrationMap) => {
    const model = createBandModel({ romCm: ROM, calibrations });
    const ladder = bandLoadLadder(BANDS[0]!.id, ROM, calibrations);
    const positions = [0, 1, 2, 3] as const;
    let landedOnFirst = 0;
    for (const band of BANDS) {
      for (const position of positions) {
        const load: PlannedLoad = { kind: 'band', bandId: band.id, position };
        const spec = specFromLoad(load);
        const value = bandValue(band.id, position);
        const up = ladder.up(load);
        const down = ladder.down(load);
        const harder = model.nextHarder(value);
        const easier = model.nextEasier(value);
        expect(harder ? loadFromSpec({ ...spec, value: harder.value }) : null).toEqual(
          up?.load ?? null,
        );
        expect(easier ? loadFromSpec({ ...spec, value: easier.value }) : null).toEqual(down);
        if (up?.load.kind === 'band' && up.load.position === 0 && position === 3)
          landedOnFirst += 1;
      }
    }
    // With measurements some macro steps are gentle (land on P1), some are not (P0); without, all land on P0.
    if (calibrations === CALIBRATED) expect(landedOnFirst).toBeGreaterThan(0);
  });

  it('a band value that is not on the ladder has no neighbours and compares with nothing', () => {
    const model = createBandModel({ romCm: ROM });
    const stray = { ...bandValue('red', 1), positionId: 'P9' };
    expect(model.nextHarder(stray)).toBeNull();
    expect(model.nextEasier(stray)).toBeNull();
    expect(model.compare(stray, bandValue('red', 1))).toBe('incomparable');
    expect(model.compare(bandValue('red', 1), stray)).toBe('incomparable');
  });

  it('bodyweight has one step and nowhere to go', () => {
    const model = createBodyweightModel('crunch');
    const value = bodyweightValue('crunch');
    expect(model.nextHarder(value)).toBeNull();
    expect(model.nextEasier(value)).toBeNull();
    expect(model.relativeStep(value, value)).toBeNull();
  });
});

describe('the size of a step (13 §16)', () => {
  const model = createDumbbellModel('paired');
  const at = (kg: number) => dumbbellValue('paired', kg);

  it('is the fraction a rung is heavier than the one before', () => {
    expect(model.relativeStep(at(4), at(6))).toBeCloseTo(0.5);
    expect(model.relativeStep(at(8), at(10))).toBeCloseTo(0.25);
    expect(model.relativeStep(at(6), at(4))).toBeCloseTo(-1 / 3);
  });

  it('is unknown for bands until they are calibrated, and then is the ratio of their peak forces', () => {
    const value = (bandId: string, position: 0 | 1 | 2 | 3) => bandValue(bandId, position);
    const bare = createBandModel({ romCm: ROM });
    expect(bare.relativeStep(value('yellow', 0), value('yellow', 1))).toBeNull();
    const measured = createBandModel({ romCm: ROM, calibrations: CALIBRATED });
    const step = measured.relativeStep(value('yellow', 0), value('yellow', 3));
    expect(step).toBeGreaterThan(0);
    expect(measured.relativeStep(value('yellow', 3), value('green', 0))).toBeNull(); // green has no curve
    expect(
      measured.relativeStep(value('yellow', 0), { ...value('yellow', 0), positionId: 'P9' }),
    ).toBeNull();
  });

  it('is unknown where the dial is no force, or the body mass would be needed', () => {
    const pullUp = assistedModel('pull-up', [40, 35]);
    const [easy, hard] = pullUp.levels();
    expect(pullUp.relativeStep(easy!.value, hard!.value)).toBeNull();
  });
});

// ------------------------------------------------------------------- the adapter

describe('the v1 adapter', () => {
  const loads: PlannedLoad[] = [
    paired(8),
    single(18),
    paired(2.5),
    { kind: 'band', bandId: 'red', position: 2 },
    { kind: 'bodyweight' },
  ];

  it.each(loads)('reads %j as a spec and back, unchanged', (load) => {
    const spec = specFromLoad(load);
    expect(resistanceSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.modelId).toBe(modelIdOf(load));
    expect(loadFromSpec(spec)).toEqual(load);
  });

  it('writes a dumbbell mass in whole grams, with the convention of its mode', () => {
    expect(specFromLoad(paired(2.5)).value).toEqual({
      kind: 'external_mass',
      massGrams: 2500,
      convention: 'per_hand',
      implementCount: 2,
    });
    expect(specFromLoad(single(14)).value).toMatchObject({
      convention: 'total',
      implementCount: 1,
    });
  });

  it('names the bodyweight movement when it is told, and the band it uses', () => {
    expect(specFromLoad({ kind: 'bodyweight' }, { variantId: 'plank' }).value).toMatchObject({
      variantId: 'plank',
    });
    expect(specFromLoad({ kind: 'bodyweight' }).value).toMatchObject({ variantId: 'bodyweight' });
    expect(specFromLoad({ kind: 'band', bandId: 'red', position: 1 }).equipmentInstanceIds).toEqual(
      ['band:red'],
    );
  });

  it('refuses, and does not invent, equipment v1 cannot express (T51)', () => {
    const base = {
      schemaVersion: RESISTANCE_SCHEMA_VERSION,
      equipmentInstanceIds: [] as string[],
      configurationKey: '',
    } as const;
    const barbell = barbellModel(20, [{ mass: 5, pairs: 1 }]).levels()[0]!.value;
    const refused: ResistanceSpec[] = [
      { ...base, modelId: 'barbell.kg', value: barbell },
      {
        ...base,
        modelId: 'machine.stack',
        value: { kind: 'machine_setting', settingId: 'a', displayValue: 1, displayUnit: 'kg' },
      },
      {
        ...base,
        modelId: 'bodyweight.assisted',
        value: {
          kind: 'bodyweight',
          variantId: 'x',
          addedMassGrams: 0,
          assistance: { massGrams: 0 },
        },
      },
      {
        ...base,
        modelId: 'bodyweight.weighted',
        value: { kind: 'bodyweight', variantId: 'x', addedMassGrams: 5000, assistance: null },
      },
      {
        ...base,
        modelId: 'dumbbell.paired',
        value: { kind: 'external_mass', massGrams: 4000, convention: 'total', implementCount: 1 },
      },
      {
        ...base,
        modelId: 'dumbbell.single',
        value: {
          kind: 'external_mass',
          massGrams: 4000,
          convention: 'per_hand',
          implementCount: 2,
        },
      },
      {
        ...base,
        modelId: 'band.long',
        value: {
          kind: 'band_position',
          bandId: 'red',
          positionId: 'P9',
          geometryRevision: BAND_GEOMETRY,
        },
      },
      {
        ...base,
        modelId: 'band.long',
        value: {
          kind: 'band_position',
          bandId: 'red',
          positionId: 'P1',
          geometryRevision: 'other',
        },
      },
      { ...base, modelId: 'x', value: { kind: 'ordinal', levelId: 'a' } },
    ];
    for (const spec of refused) expect(loadFromSpec(spec)).toBeNull();
  });
});

describe('the spec schema', () => {
  const spec = specFromLoad(paired(8));

  it('accepts a legal spec', () => {
    expect(resistanceSpecSchema.parse(spec)).toEqual(spec);
  });

  it.each([
    ['an unknown field', { ...spec, extra: 1 }],
    ['a wrong schema version', { ...spec, schemaVersion: 2 }],
    ['an empty model id', { ...spec, modelId: '' }],
    ['a fractional gram', { ...spec, value: { ...spec.value, massGrams: 8000.5 } }],
    ['a negative mass', { ...spec, value: { ...spec.value, massGrams: -1 } }],
    ['a value of no known kind', { ...spec, value: { kind: 'vibes' } }],
    ['too many implements', { ...spec, value: { ...spec.value, implementCount: 9 } }],
    ['a missing configuration key', { ...spec, configurationKey: undefined }],
  ])('refuses %s', (_, candidate) => {
    expect(resistanceSpecSchema.safeParse(candidate).success).toBe(false);
  });
});

// ------------------------------------------------------------------- the registry

describe('the registry (T51)', () => {
  it('lists the built-in models and builds them from catalogue parameters', () => {
    expect(RESISTANCE_REGISTRY.ids()).toEqual([
      'band.long',
      'bodyweight',
      'dumbbell.paired',
      'dumbbell.single',
    ]);
    expect(RESISTANCE_REGISTRY.has('band.long')).toBe(true);
    const made = RESISTANCE_REGISTRY.create({
      id: 'bodyweight',
      parameters: { variantId: 'crunch' },
    });
    expect(made.ok && made.model.id).toBe('bodyweight');
    const dumbbells = RESISTANCE_REGISTRY.create({ id: 'dumbbell.paired' });
    expect(dumbbells.ok && dumbbells.model.levels().length).toBe(dumbbellLadder('paired').length);
    const band = RESISTANCE_REGISTRY.create({ id: 'band.long', parameters: { romCm: 40 } });
    expect(band.ok && band.model.levels()).toHaveLength(BANDS.length * 4);
  });

  it('refuses a model nobody registered, and parameters that do not fit', () => {
    expect(RESISTANCE_REGISTRY.create({ id: 'barbell.kg' })).toEqual({
      ok: false,
      reason: 'unknown_model',
    });
    expect(RESISTANCE_REGISTRY.create({ id: 'toString' })).toEqual({
      ok: false,
      reason: 'unknown_model',
    });
    expect(RESISTANCE_REGISTRY.has('constructor')).toBe(false);
    expect(RESISTANCE_REGISTRY.create({ id: 'bodyweight' })).toEqual({
      ok: false,
      reason: 'invalid_parameters',
    });
    expect(RESISTANCE_REGISTRY.create({ id: 'band.long', parameters: { romCm: -3 } })).toEqual({
      ok: false,
      reason: 'invalid_parameters',
    });
    expect(RESISTANCE_REGISTRY.create({ id: 'dumbbell.single', parameters: { kg: 3 } })).toEqual({
      ok: false,
      reason: 'invalid_parameters',
    });
  });

  it('takes the equipment from the context it is given', () => {
    const fewer = { ...DUMBBELLS, plates: [{ massKg: 1, count: 4 }] };
    const made = RESISTANCE_REGISTRY.create(
      { id: 'dumbbell.single' },
      { dumbbells: fewer, bands: BANDS, bandCalibrations: {} },
    );
    expect(made.ok && made.model.levels().length).toBe(dumbbellLadder('single', fewer).length);
  });

  it('takes a new kind of equipment as one entry, without touching the others', () => {
    const registry = createResistanceRegistry({
      'barbell.kg': defineModel(z.strictObject({ bar: z.number().positive() }), (p) =>
        barbellModel(p.bar, [{ mass: 5, pairs: 2 }]),
      ),
    });
    expect(registry.ids()).toContain('barbell.kg');
    const barbell = registry.create({ id: 'barbell.kg', parameters: { bar: 20 } });
    expect(barbell.ok && barbell.model.levels().map((l) => l.id)).toEqual([
      'barbell.kg/20kg',
      'barbell.kg/30kg',
      'barbell.kg/40kg',
    ]);
    expect(RESISTANCE_REGISTRY.has('barbell.kg')).toBe(false);
    expect(Object.keys(BUILT_IN_FACTORIES)).not.toContain('barbell.kg');
  });
});

describe('building a ladder', () => {
  const definition = (ids: string[], efforts: number[]) => ({
    id: 'toy',
    schemaVersion: 1,
    capabilities: {
      quantityKinds: ['reps' as const],
      perSetResistance: false,
      relativeStep: 'always' as const,
    },
    levels: ids.map((id) => ({ id, value: { kind: 'ordinal' as const, levelId: id } })),
    validate: () => ({ ok: false as const, reason: 'toy' }),
    effort: (v: ResistanceValue) => efforts[ids.indexOf(v.kind === 'ordinal' ? v.levelId : '')]!,
    signature: () => 'ordinal',
    demand: () => [],
  });

  it('refuses duplicate ids and steps that do not get harder', () => {
    expect(() => createLadderModel(definition(['a', 'a'], [1, 2]))).toThrow('duplicate level ids');
    expect(() => createLadderModel(definition(['a', 'b'], [2, 1]))).toThrow('must get harder');
    expect(() => createLadderModel(definition(['a', 'b'], [1, 1]))).toThrow('must get harder');
  });

  it('knows a step of unknown size when the lowest effort is not above zero', () => {
    const model = createLadderModel(definition(['a', 'b'], [0, 5]));
    const [a, b] = model.levels();
    expect(model.relativeStep(a!.value, b!.value)).toBeNull();
  });

  it('leaves values of another signature incomparable', () => {
    const model = createDumbbellModel('paired');
    const single = createDumbbellModel('single').levels()[1]!.value;
    expect(model.compare(model.levels()[1]!.value, single)).toBe('incomparable');
    expect(model.nextHarder(single)).toBeNull();
  });
});

// ----------------------------------------- equipment the app does not have yet

describe('T42 dumbbells in pairs and single ones are different resistances', () => {
  it('have different conventions, keys and demands even at the same number of kilograms', () => {
    const pairedModel = createDumbbellModel('paired');
    const singleModel = createDumbbellModel('single');
    const p = specFromLoad(paired(6));
    const s = specFromLoad(single(6));
    expect(resistanceComparisonKey(p, pairedModel)).not.toBe(
      resistanceComparisonKey(s, singleModel),
    );
    expect(pairedModel.compare(p.value as never, s.value as never)).toBe('incomparable');
    // One adjustable set: 2 x 6 kg and 1 x 6 kg cannot be loaded at once.
    const [pc] = pairedModel.resourceDemand(p.value as never);
    const [sc] = singleModel.resourceDemand(s.value as never);
    expect(pc!.resourceId).toBe(sc!.resourceId);
    expect(pc!.configuration).not.toBe(sc!.configuration);
    expect(pc!.quantity).toBe(2);
    expect(sc!.quantity).toBe(1);
  });
});

describe('T43 a barbell with the plates there are', () => {
  const bar20 = [{ mass: 5, pairs: 2 }];

  it('makes only the symmetric totals the plates allow, from the bar upward', () => {
    expect(barbellConfigs(20, bar20).map((c) => c.total)).toEqual([20, 30, 40]);
    expect(
      barbellConfigs(20, [
        { mass: 1.25, pairs: 1 },
        { mass: 5, pairs: 1 },
      ]).map((c) => c.total),
    ).toEqual([20, 22.5, 30, 32.5]);
  });

  it('never offers an unreachable mass, and nothing lighter than the bare bar', () => {
    const model = barbellModel(20, bar20);
    const masses = model.levels().map((l) => l.value.massGrams / 1000);
    expect(masses).not.toContain(25);
    expect(Math.min(...masses)).toBe(20);
    expect(model.nextHarder(model.levels()[0]!.value)?.value.massGrams).toBe(30000);
    expect(model.nextEasier(model.levels()[0]!.value)).toBeNull();
  });

  it('asks for the bar and the pairs of plates, and shares plates between totals', () => {
    const model = barbellModel(20, [
      { mass: 5, pairs: 2 },
      { mass: 10, pairs: 1 },
    ]);
    const level = (kg: number) =>
      model.levels().find((l) => l.value.massGrams === kg * 1000)!.value;
    expect(model.resourceDemand(level(20))).toEqual([
      { resourceId: 'barbell', quantity: 1, configuration: '' },
    ]);
    // 50 kg = 20 + 2 x 15: a 10 and a 5 on each side, rather than three 5s that the stock does not have.
    expect(model.resourceDemand(level(50))).toEqual([
      { resourceId: 'barbell', quantity: 1, configuration: '' },
      { resourceId: 'plate:5kg', quantity: 2, configuration: 'pair' },
      { resourceId: 'plate:10kg', quantity: 2, configuration: 'pair' },
    ]);
    // A mass the model does not make asks for the bar only, rather than guess plates.
    expect(
      model.resourceDemand({
        kind: 'external_mass',
        massGrams: 33000,
        convention: 'total',
        implementCount: 1,
      }),
    ).toEqual([{ resourceId: 'barbell', quantity: 1, configuration: '' }]);
  });

  it('prefers the arrangement with the fewest plates', () => {
    // 40 kg is 10 kg a side, as one plate or as two 5 kg plates: the one plate is the simpler load.
    const configs = barbellConfigs(20, [
      { mass: 5, pairs: 2 },
      { mass: 10, pairs: 1 },
    ]);
    const forty = configs.find((c) => c.total === 40)!;
    expect([...forty.perSide].filter(([, n]) => n > 0)).toEqual([[10, 1]]);
  });
});

describe('T44 a stack with irregular settings', () => {
  const model = stackModel('leg-press-1', [
    { id: 'p1', shown: 10 },
    { id: 'p2', shown: 15 },
    { id: 'p3', shown: 22.5 },
    { id: 'p4', shown: 30 },
  ]);
  const setting = (id: string) => model.levels().find((l) => l.value.settingId === id)!.value;

  it('steps to the next pin, not by a fixed amount', () => {
    expect(model.nextHarder(setting('p2'))?.value.displayValue).toBe(22.5);
    expect(model.nextHarder(setting('p4'))).toBeNull();
    expect(model.nextEasier(setting('p1'))).toBeNull();
  });

  it('has no 20 or 25 on the dial, and refuses them', () => {
    const shown = model.levels().map((l) => l.value.displayValue);
    expect(shown).toEqual([10, 15, 22.5, 30]);
    for (const value of [20, 25]) {
      expect(
        model.validate({
          kind: 'machine_setting',
          settingId: 'p3',
          displayValue: value,
          displayUnit: 'kg',
        }).ok,
      ).toBe(false);
    }
  });
});

describe('T45 an assisting machine goes the other way', () => {
  const model = assistedModel('pull-up', [40, 35, 30, 20, 10, 0]);
  const at = (kg: number) =>
    model.levels().find((l) => l.value.assistance?.massGrams === kg * 1000)!.value;

  it('progresses by giving less help, and regresses by giving more', () => {
    expect(model.nextHarder(at(40))?.value.assistance?.massGrams).toBe(35000);
    expect(model.nextHarder(at(35))?.value.assistance?.massGrams).toBe(30000);
    expect(model.nextEasier(at(30))?.value.assistance?.massGrams).toBe(35000);
    expect(model.compare(at(30), at(40))).toBe('harder');
  });

  it('treats no assistance as the hardest step — a value, not an empty log', () => {
    const hardest = at(0);
    expect(hardest.assistance).toEqual({ massGrams: 0 });
    expect(model.nextHarder(hardest)).toBeNull();
    expect(model.levels().at(-1)!.value).toEqual(hardest);
  });
});

describe('T49 a changed setup breaks the comparison, not the history', () => {
  it('another machine, at the same number, is another resistance', () => {
    const a = stackModel('press-a', [{ id: 'p1', shown: 30 }]);
    const b = stackModel('press-b', [{ id: 'p1', shown: 30 }]);
    const spec = (model: typeof a): ResistanceSpec => ({
      schemaVersion: 1,
      modelId: model.id,
      equipmentInstanceIds: [],
      configurationKey: '',
      value: model.levels()[0]!.value,
    });
    expect(resistanceComparisonKey(spec(a), a)).not.toBe(resistanceComparisonKey(spec(b), b));
  });

  it('a cable at another ratio is incomparable although the stack is the same', () => {
    const cable = stackModel('cable-1', [
      { id: 'p1', shown: 20 },
      { id: 'p2', shown: 25 },
    ]);
    const withRatio = (ratio: string, i: number): ResistanceSpec => ({
      schemaVersion: 1,
      modelId: cable.id,
      equipmentInstanceIds: ['cable-1'],
      configurationKey: `ratio:${ratio}`,
      value: cable.levels()[i]!.value,
    });
    expect(compareSpecs(withRatio('1:1', 0), withRatio('1:1', 1), cable)).toBe('easier');
    expect(compareSpecs(withRatio('1:1', 1), withRatio('2:1', 0), cable)).toBe('incomparable');
    expect(resistanceComparisonKey(withRatio('1:1', 0), cable)).not.toBe(
      resistanceComparisonKey(withRatio('2:1', 0), cable),
    );
  });

  it('another model is incomparable, and the same setup compares by effort', () => {
    const dumbbell = createDumbbellModel('paired');
    const p = specFromLoad(paired(4));
    expect(compareSpecs(p, specFromLoad(paired(6)), dumbbell)).toBe('easier');
    expect(compareSpecs(p, specFromLoad(single(4)), dumbbell)).toBe('incomparable');
  });

  it('a band anchored in another geometry is another resistance', () => {
    const model = createBandModel({ romCm: ROM });
    const spec = specFromLoad({ kind: 'band', bandId: 'red', position: 1 });
    const moved: ResistanceSpec = {
      ...spec,
      value: { ...bandValue('red', 1), geometryRevision: 'anchor-45cm-v1' },
    };
    expect(resistanceComparisonKey(spec, model)).not.toBe(resistanceComparisonKey(moved, model));
    expect(
      model.compare(bandValue('red', 1), {
        ...bandValue('red', 1),
        geometryRevision: 'anchor-45cm-v1',
      }),
    ).toBe('incomparable');
  });
});

describe('T50 units and conventions do not drift', () => {
  const lbBar = () =>
    barbellModel(
      45,
      [
        { mass: 2.5, pairs: 1 },
        { mass: 5, pairs: 1 },
        { mass: 10, pairs: 1 },
        { mass: 25, pairs: 1 },
      ],
      'lb',
    );

  it('names a pound setting by the pound, however many grams it comes to', () => {
    const model = lbBar();
    const ids = model.levels().map((l) => l.id);
    expect(ids[0]).toBe('barbell.lb/45lb');
    // 45 lb bar + 2 x (25 + 10 + 5 + 2.5) lb of plates = 130 lb at most; nothing between 45 and 50.
    expect(ids).toContain('barbell.lb/50lb');
    expect(ids.at(-1)).toBe('barbell.lb/130lb');
    expect(ids).not.toContain('barbell.lb/47.5lb');
    for (const id of ids) expect(id).toMatch(/^barbell\.lb\/\d+(\.\d+)?lb$/);
  });

  it('keeps the original setting through any number of round trips', () => {
    const model = lbBar();
    for (const level of model.levels()) {
      let value = level.value;
      for (let i = 0; i < 5; i += 1) {
        const parsed = model.validate(JSON.parse(JSON.stringify(value)));
        expect(parsed.ok).toBe(true);
        value = (parsed as { value: typeof value }).value;
      }
      expect(value).toEqual(level.value);
      expect(value.display?.unit).toBe('lb');
    }
    // 45 lb is not a whole number of grams: the lb figure, not the gram figure, is the identity.
    expect(lbBar().levels()[0]!.value.massGrams).toBe(20412);
    expect(lbBar().levels()[0]!.value.display).toEqual({ value: 45, unit: 'lb' });
  });

  it('refuses a kilogram setting on a pound barbell, and a per-hand mass on a total one', () => {
    const model = lbBar();
    expect(
      model.validate({
        kind: 'external_mass',
        massGrams: 20000,
        convention: 'total',
        implementCount: 1,
        display: { value: 20, unit: 'kg' },
      }).ok,
    ).toBe(false);
    expect(
      model.validate({
        kind: 'external_mass',
        massGrams: 20412,
        convention: 'per_hand',
        implementCount: 2,
        display: { value: 45, unit: 'lb' },
      }).ok,
    ).toBe(false);
  });

  it('does not double a per-hand mass when the pair is counted, and keeps the total apart', () => {
    const pair = createDumbbellModel('paired');
    expect(pair.comparisonSignature(dumbbellValue('paired', 8))).toBe('external_mass/per_hand/x2');
    const kettlebells = kettlebellModel([16], 2);
    expect(kettlebells.levels()[0]!.value).toMatchObject({
      massGrams: 16000,
      convention: 'per_hand',
      implementCount: 2,
    });
    expect(kettlebells.resourceDemand(kettlebells.levels()[0]!.value)).toEqual([
      { resourceId: 'kettlebell:16000', quantity: 2, configuration: '' },
    ]);
  });
});

describe('T51 a model the app does not know', () => {
  it('is not planned automatically: the registry says so instead of falling back to bodyweight', () => {
    const result = RESISTANCE_REGISTRY.create({ id: 'machine.stack', parameters: {} });
    expect(result).toEqual({ ok: false, reason: 'unknown_model' });
  });

  it('keeps the model capabilities honest about what it cannot give', () => {
    expect(createBodyweightModel('x').capabilities).toMatchObject({
      perSetResistance: false,
      relativeStep: 'never',
    });
    expect(createBandModel({ romCm: 40 }).capabilities.relativeStep).toBe('when_calibrated');
    expect(createDumbbellModel('single').capabilities.relativeStep).toBe('always');
  });
});
