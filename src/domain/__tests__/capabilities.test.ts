/**
 * Engine v2, P1 (05 §8, 07 P1.7, T51): an exercise is planned automatically
 * only when everything on the path can handle it.
 */
import { createDumbbellModel } from '../resistance/models';
import { z } from 'zod';
import { createResistanceRegistry, defineModel, RESISTANCE_REGISTRY } from '../resistance/registry';
import {
  canPlanAutomatically,
  CURRENT_LOGGER,
  CURRENT_RUNNER,
  PROGRESSION_POLICIES,
  type PlanningNeeds,
} from '../policy/registry';
import { barbellModel, stackModel } from './resistanceFixtures';

const needs = (patch: Partial<PlanningNeeds> = {}): PlanningNeeds => ({
  quantityKind: 'reps',
  modelId: 'dumbbell.paired',
  policyId: 'reps_then_resistance',
  ...patch,
});

describe('the policies there are', () => {
  it('has the double progression of today, for repetitions and holds', () => {
    const policy = PROGRESSION_POLICIES.reps_then_resistance!;
    expect(policy).toMatchObject({ id: 'reps_then_resistance', version: '2', needsEffort: true });
    expect(policy.quantityKinds).toEqual(['reps', 'duration']);
    expect(policy.resistanceKinds).toContain('external_mass');
  });
});

describe('T51 planning an exercise by itself', () => {
  it('is possible for what the app does today: dumbbells, bands and bodyweight, in repetitions and seconds', () => {
    expect(canPlanAutomatically(needs(), RESISTANCE_REGISTRY)).toEqual({ ok: true });
    expect(
      canPlanAutomatically(
        needs({ modelId: 'dumbbell.single', quantityKind: 'duration' }),
        RESISTANCE_REGISTRY,
      ),
    ).toEqual({ ok: true });
    expect(
      canPlanAutomatically(
        needs({ modelId: 'band.long', modelParameters: { romCm: 40 } }),
        RESISTANCE_REGISTRY,
      ),
    ).toEqual({ ok: true });
    expect(
      canPlanAutomatically(
        needs({ modelId: 'bodyweight', modelParameters: { variantId: 'plank' } }),
        RESISTANCE_REGISTRY,
      ),
    ).toEqual({ ok: true });
  });

  it('is refused for a model nobody registered, naming the model — not quietly treated as bodyweight', () => {
    const result = canPlanAutomatically(needs({ modelId: 'machine.stack' }), RESISTANCE_REGISTRY);
    expect(result).toEqual({ ok: false, missing: ['UNKNOWN_MODEL', 'LOGGER_MODEL'] });
  });

  it('is refused when the model exists but the logger cannot enter its settings', () => {
    const registry = createResistanceRegistry({
      'barbell.kg': defineModel(z.strictObject({}), () =>
        barbellModel(20, [{ mass: 5, pairs: 1 }]),
      ),
    });
    expect(canPlanAutomatically(needs({ modelId: 'barbell.kg' }), registry)).toEqual({
      ok: false,
      missing: ['LOGGER_MODEL'],
    });
    const taught = {
      ...CURRENT_LOGGER,
      resistanceModels: [...CURRENT_LOGGER.resistanceModels, 'barbell.kg'],
    };
    expect(
      canPlanAutomatically(
        needs({ modelId: 'barbell.kg' }),
        registry,
        PROGRESSION_POLICIES,
        CURRENT_RUNNER,
        taught,
      ),
    ).toEqual({ ok: true });
  });

  it('is refused for a policy that does not exist, or does not move this kind of resistance or measure', () => {
    expect(
      canPlanAutomatically(needs({ policyId: 'assistance_reduction' }), RESISTANCE_REGISTRY),
    ).toEqual({
      ok: false,
      missing: ['UNKNOWN_POLICY'],
    });
    expect(canPlanAutomatically(needs({ policyId: 'toString' }), RESISTANCE_REGISTRY).ok).toBe(
      false,
    );
    const narrow = {
      only_bands: {
        id: 'only_bands',
        version: '1',
        quantityKinds: ['reps'] as const,
        resistanceKinds: ['band_position'] as const,
        needsEffort: false,
      },
    };
    expect(
      canPlanAutomatically(needs({ policyId: 'only_bands' }), RESISTANCE_REGISTRY, narrow),
    ).toEqual({
      ok: false,
      missing: ['POLICY_RESISTANCE'],
    });
    expect(
      canPlanAutomatically(
        needs({ policyId: 'only_bands', quantityKind: 'duration' }),
        RESISTANCE_REGISTRY,
        narrow,
      ),
    ).toEqual({ ok: false, missing: ['POLICY_QUANTITY', 'POLICY_RESISTANCE'] });
  });

  it('is refused for a measure the model, the runner or the logger cannot handle', () => {
    const distance = canPlanAutomatically(needs({ quantityKind: 'distance' }), RESISTANCE_REGISTRY);
    expect(distance).toEqual({
      ok: false,
      missing: ['MODEL_QUANTITY', 'POLICY_QUANTITY', 'RUNNER_QUANTITY', 'LOGGER_QUANTITY'],
    });
  });

  it('is refused when the sets would need different resistance and the model or the runner cannot', () => {
    const bodyweight = needs({
      modelId: 'bodyweight',
      modelParameters: { variantId: 'x' },
      perSetResistance: true,
    });
    expect(canPlanAutomatically(bodyweight, RESISTANCE_REGISTRY)).toEqual({
      ok: false,
      missing: ['MODEL_PER_SET_RESISTANCE', 'RUNNER_PER_SET_RESISTANCE'],
    });
    const dumbbells = needs({ perSetResistance: true });
    expect(canPlanAutomatically(dumbbells, RESISTANCE_REGISTRY)).toEqual({
      ok: false,
      missing: ['RUNNER_PER_SET_RESISTANCE'],
    });
    expect(
      canPlanAutomatically(dumbbells, RESISTANCE_REGISTRY, PROGRESSION_POLICIES, {
        ...CURRENT_RUNNER,
        perSetResistance: true,
      }),
    ).toEqual({ ok: true });
  });

  it('is refused when a policy needs the effort and the logger does not record it', () => {
    expect(
      canPlanAutomatically(needs(), RESISTANCE_REGISTRY, PROGRESSION_POLICIES, CURRENT_RUNNER, {
        ...CURRENT_LOGGER,
        effort: false,
      }),
    ).toEqual({ ok: false, missing: ['LOGGER_EFFORT'] });
  });

  it('judges a model with no steps by what it declares, not by a step it does not have', () => {
    const empty = createResistanceRegistry({
      none: defineModel(z.strictObject({}), () => {
        const real = createDumbbellModel('paired');
        return { ...real, levels: () => [] };
      }),
    });
    const logger = { ...CURRENT_LOGGER, resistanceModels: ['none'] };
    expect(
      canPlanAutomatically(
        needs({ modelId: 'none' }),
        empty,
        PROGRESSION_POLICIES,
        CURRENT_RUNNER,
        logger,
      ),
    ).toEqual({ ok: true });
  });

  it('reads a machine stack as supported by the policy, once a logger knows it', () => {
    const registry = createResistanceRegistry({
      'machine.stack': defineModel(
        z.strictObject({}),
        () =>
          stackModel('press', [
            { id: 'p1', shown: 10 },
            { id: 'p2', shown: 15 },
          ]) as never,
      ),
    });
    const logger = {
      ...CURRENT_LOGGER,
      resistanceModels: [...CURRENT_LOGGER.resistanceModels, 'machine.stack'],
    };
    expect(
      canPlanAutomatically(
        needs({ modelId: 'machine.stack' }),
        registry,
        PROGRESSION_POLICIES,
        CURRENT_RUNNER,
        logger,
      ),
    ).toEqual({ ok: true });
  });
});
