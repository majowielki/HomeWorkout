/**
 * Engine v2, P1 (05 §4, 07 P1.4, T46, T47): equipment as things with
 * quantities, and requirements that are met by them — all together, or one of
 * several alternatives, never the same thing twice.
 */
import {
  type EquipmentInstance,
  type EquipmentRequirement,
  equipmentInstanceSchema,
  equipmentRequirementSchema,
  requirementsMet,
} from '../equipment/types';

const thing = (patch: Partial<EquipmentInstance> & { id: string }): EquipmentInstance => ({
  typeId: patch.id,
  schemaVersion: 1,
  label: patch.id,
  status: 'available',
  locationId: 'home',
  quantity: 1,
  capabilities: [],
  configuration: {},
  revision: 1,
  ...patch,
});
const needs = (capability: string, quantity = 1, constraints = {}): EquipmentRequirement => ({
  kind: 'capability',
  capability,
  quantity,
  constraints,
});
const exactly = (instanceId: string, quantity = 1): EquipmentRequirement => ({
  kind: 'instance',
  instanceId,
  quantity,
});
const oneOf = (...alternatives: EquipmentRequirement[][]): EquipmentRequirement => ({
  kind: 'one_of',
  alternatives,
});

describe('the schemas', () => {
  it('accept an instance and every kind of requirement', () => {
    const bar = thing({
      id: 'bar-1',
      typeId: 'barbell',
      capabilities: ['barbell'],
      configuration: { massGrams: 20000 },
    });
    expect(equipmentInstanceSchema.parse(bar)).toEqual(bar);
    for (const requirement of [
      needs('barbell'),
      exactly('bar-1', 2),
      oneOf([needs('flat-bench')], [needs('adjustable-bench'), needs('rack')]),
    ]) {
      expect(equipmentRequirementSchema.parse(requirement)).toEqual(requirement);
    }
  });

  it.each([
    ['no quantity', { ...thing({ id: 'x' }), quantity: 0 }],
    ['an unknown status', { ...thing({ id: 'x' }), status: 'borrowed' }],
    ['a setting that is not a plain value', { ...thing({ id: 'x' }), configuration: { a: [1] } }],
    ['an unknown field', { ...thing({ id: 'x' }), colour: 'red' }],
    ['a fractional revision', { ...thing({ id: 'x' }), revision: 1.5 }],
  ])('refuse an instance with %s', (_, candidate) => {
    expect(equipmentInstanceSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    [
      'a requirement of nothing',
      { kind: 'capability', capability: 'rack', quantity: 0, constraints: {} },
    ],
    [
      'an alternative of one',
      { kind: 'one_of', alternatives: [[{ kind: 'instance', instanceId: 'a', quantity: 1 }]] },
    ],
    [
      'an empty alternative',
      { kind: 'one_of', alternatives: [[], [{ kind: 'instance', instanceId: 'a', quantity: 1 }]] },
    ],
    ['a kind nobody knows', { kind: 'vibe', quantity: 1 }],
  ])('refuse %s', (_, candidate) => {
    expect(equipmentRequirementSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('requirementsMet', () => {
  const room = [
    thing({ id: 'bar', capabilities: ['barbell'] }),
    thing({ id: 'plates', capabilities: ['plates'], quantity: 8 }),
    thing({ id: 'rack', capabilities: ['rack'] }),
    thing({ id: 'bench', capabilities: ['flat-bench'] }),
  ];

  it('is met when everything needed is there (a barbell and plates and a rack)', () => {
    expect(requirementsMet([needs('barbell'), needs('plates', 4), needs('rack')], room)).toBe(true);
    expect(requirementsMet([], room)).toBe(true);
  });

  it('is not met when any one part is missing, or there are too few', () => {
    expect(requirementsMet([needs('barbell'), needs('cable')], room)).toBe(false);
    expect(requirementsMet([needs('plates', 9)], room)).toBe(false);
    expect(requirementsMet([exactly('ghost')], room)).toBe(false);
  });

  it('is met by one of several alternatives', () => {
    const wants = oneOf([needs('adjustable-bench')], [needs('flat-bench'), needs('rack')]);
    expect(requirementsMet([wants], room)).toBe(true);
    expect(
      requirementsMet(
        [wants],
        room.filter((i) => i.id !== 'rack'),
      ),
    ).toBe(false);
    expect(
      requirementsMet(
        [wants],
        [
          ...room.filter((i) => i.id !== 'bench'),
          thing({ id: 'inc', capabilities: ['adjustable-bench'] }),
        ],
      ),
    ).toBe(true);
  });

  it('counts a thing for one requirement only (T46: one pair of dumbbells is not two)', () => {
    const one = [thing({ id: 'pair', capabilities: ['dumbbell'], quantity: 2 })];
    expect(requirementsMet([needs('dumbbell', 2)], one)).toBe(true);
    expect(requirementsMet([needs('dumbbell', 2), needs('dumbbell', 2)], one)).toBe(false);
    expect(requirementsMet([needs('dumbbell', 1), needs('dumbbell', 1)], one)).toBe(true);
    expect(requirementsMet([needs('rack'), needs('rack')], room)).toBe(false);
    expect(requirementsMet([exactly('rack'), needs('rack')], room)).toBe(false);
  });

  it('takes a quantity from several things when one does not have enough', () => {
    const kettlebells = [
      thing({ id: 'kb-16-a', capabilities: ['kettlebell-16'], quantity: 1 }),
      thing({ id: 'kb-16-b', capabilities: ['kettlebell-16'], quantity: 1 }),
    ];
    expect(requirementsMet([needs('kettlebell-16', 2)], kettlebells)).toBe(true);
    expect(requirementsMet([needs('kettlebell-16', 3)], kettlebells)).toBe(false);
  });

  it('chooses an alternative that leaves what the rest needs (backtracking)', () => {
    const benches = [
      thing({ id: 'bench-a', capabilities: ['bench'] }),
      thing({ id: 'bench-b', capabilities: ['bench'] }),
    ];
    // Either bench would do for the first; only bench-a is allowed for the second, so the first must take bench-b.
    expect(
      requirementsMet(
        [oneOf([exactly('bench-a')], [exactly('bench-b')]), exactly('bench-a')],
        benches,
      ),
    ).toBe(true);
    expect(requirementsMet([needs('bench'), exactly('bench-a')], benches)).toBe(true);
    expect(
      requirementsMet(
        [oneOf([exactly('bench-a')], [exactly('bench-a', 1)]), exactly('bench-a')],
        benches,
      ),
    ).toBe(false);
  });

  it('matches the setting an instance must have', () => {
    const set = [
      thing({
        id: 'adj',
        capabilities: ['dumbbell'],
        configuration: { adjustable: true, maxKg: 20 },
      }),
    ];
    expect(requirementsMet([needs('dumbbell', 1, { adjustable: true })], set)).toBe(true);
    expect(requirementsMet([needs('dumbbell', 1, { adjustable: false })], set)).toBe(false);
    expect(requirementsMet([needs('dumbbell', 1, { adjustable: true, maxKg: 30 })], set)).toBe(
      false,
    );
  });

  it('does not count what is unavailable or retired', () => {
    const worn = [
      thing({ id: 'bar', capabilities: ['barbell'], status: 'unavailable' }),
      thing({ id: 'old', capabilities: ['barbell'], status: 'retired' }),
    ];
    expect(requirementsMet([needs('barbell')], worn)).toBe(false);
    expect(requirementsMet([exactly('bar')], worn)).toBe(false);
  });

  it('T48 counts only what is in the place of the session', () => {
    const both = [
      thing({ id: 'home-plates', capabilities: ['plates'], quantity: 4, locationId: 'home' }),
      thing({ id: 'gym-plates', capabilities: ['plates'], quantity: 20, locationId: 'gym' }),
    ];
    expect(requirementsMet([needs('plates', 10)], both, 'home')).toBe(false);
    expect(requirementsMet([needs('plates', 10)], both, 'gym')).toBe(true);
    expect(requirementsMet([needs('plates', 24)], both)).toBe(true);
  });
});
