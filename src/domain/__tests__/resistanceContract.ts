/**
 * The contract every resistance model has to keep (05 §10 step 4), as a
 * reusable suite. A new kind of equipment is accepted when its model passes
 * this without a special case; the same suite runs over the three models in
 * the app and over the fixtures that stand in for the ones it does not have
 * yet. Not a test file itself (jest only runs *.test) and not in coverage.
 */
import { canonicalize } from '../fingerprint';
import type { ResistanceModel, ResistanceValue } from '../resistance/types';

export interface ContractOptions {
  /** Values the model can represent but never offers as a step (a jump between two steps, a lb setting). */
  offLadder?: ResistanceValue[];
  /** A value that must be refused by `validate`, besides the generic garbage. */
  invalid?: unknown[];
  /**
   * Steps `nextHarder` may jump over by its own documented rule (a band skips the first anchor of
   * the next band when the jump is gentle). Going down never skips. Default 0.
   */
  maxSkipUp?: number;
}

export function describeResistanceModel(
  name: string,
  make: () => ResistanceModel,
  options: ContractOptions = {},
): void {
  describe(`resistance model contract: ${name}`, () => {
    const model = make();
    const levels = model.levels();

    it('offers at least one step, each with a stable unique id', () => {
      expect(levels.length).toBeGreaterThan(0);
      expect(new Set(levels.map((l) => l.id)).size).toBe(levels.length);
      expect(
        make()
          .levels()
          .map((l) => l.id),
      ).toEqual(levels.map((l) => l.id));
    });

    it('accepts every step it offers as a valid value of its own', () => {
      for (const level of levels) {
        expect(model.validate(level.value)).toEqual({ ok: true, value: level.value });
      }
    });

    it('serialises every step identically after a round trip through JSON', () => {
      for (const level of levels) {
        const again = JSON.parse(JSON.stringify(level.value)) as unknown;
        expect(canonicalize(again)).toBe(canonicalize(level.value));
        expect(model.validate(again).ok).toBe(true);
      }
    });

    it('lists the steps from easiest to hardest, and says so when compared', () => {
      for (let i = 0; i < levels.length; i += 1) {
        for (let j = 0; j < levels.length; j += 1) {
          const expected = i < j ? 'easier' : i > j ? 'harder' : 'equal';
          expect(model.compare(levels[i]!.value, levels[j]!.value)).toBe(expected);
        }
      }
    });

    it('moves one step at a time, harder and easier, and stops at the ends', () => {
      const ids = levels.map((l) => l.id);
      levels.forEach((level, i) => {
        const up = model.nextHarder(level.value);
        if (i === levels.length - 1) {
          expect(up).toBeNull();
        } else {
          expect(up).not.toBeNull();
          expect(ids.indexOf(up!.id)).toBeGreaterThan(i);
          expect(ids.indexOf(up!.id)).toBeLessThanOrEqual(i + 1 + (options.maxSkipUp ?? 0));
        }
        expect(model.nextEasier(level.value)?.id ?? null).toBe(ids[i - 1] ?? null);
      });
    });

    it('compares every step with itself as equal and keeps one signature for a model', () => {
      const signatures = new Set(levels.map((l) => model.comparisonSignature(l.value)));
      expect(signatures.size).toBe(1);
      for (const level of levels) expect(model.compare(level.value, level.value)).toBe('equal');
    });

    it('asks for the same things every time, and for a real quantity of each', () => {
      for (const level of levels) {
        const demand = model.resourceDemand(level.value);
        expect(model.resourceDemand(level.value)).toEqual(demand);
        for (const claim of demand) {
          expect(claim.resourceId).not.toBe('');
          expect(Number.isInteger(claim.quantity) && claim.quantity > 0).toBe(true);
        }
      }
    });

    it('knows the size of a step only if its capabilities say it does', () => {
      const { relativeStep } = model.capabilities;
      for (let i = 1; i < levels.length; i += 1) {
        const step = model.relativeStep(levels[i - 1]!.value, levels[i]!.value);
        if (relativeStep === 'never') expect(step).toBeNull();
        if (relativeStep === 'always') expect(step).toBeGreaterThan(0);
        if (step !== null) expect(Number.isFinite(step)).toBe(true);
      }
    });

    it('refuses what is not a value of this model', () => {
      const garbage = [
        null,
        undefined,
        4,
        'x',
        [],
        {},
        { kind: 'nonsense' },
        // Well-formed, but of a kind none of these models owns: the wrong model, not bad data.
        { kind: 'ordinal', levelId: 'x' },
        ...(options.invalid ?? []),
      ];
      for (const candidate of garbage) expect(model.validate(candidate).ok).toBe(false);
      const extra = { ...levels[0]!.value, surprise: true };
      expect(model.validate(extra).ok).toBe(false);
    });

    it('answers for a value between two steps: the nearest harder and easier one', () => {
      for (const value of options.offLadder ?? []) {
        expect(model.validate(value).ok).toBe(true);
        const harder = model.nextHarder(value);
        const easier = model.nextEasier(value);
        if (harder) expect(model.compare(harder.value, value)).toBe('harder');
        if (easier) expect(model.compare(easier.value, value)).toBe('easier');
        // No step is skipped: the neighbours are adjacent in the list.
        if (harder && easier) {
          const ids = levels.map((l) => l.id);
          expect(ids.indexOf(harder.id) - ids.indexOf(easier.id)).toBe(1);
        }
      }
    });
  });
}
