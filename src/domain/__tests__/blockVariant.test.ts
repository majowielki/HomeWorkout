/**
 * Engine v2, P3 (03 §9, 12 §4.2; T35, T73-T75): which exercise a slot gets for
 * the next block.
 */
import {
  chooseBlockSelections,
  chooseBlockVariant,
  rotationPolicyOf,
  type VariantInput,
} from '../plan/blockVariant';
import { defaultPreferences } from '../preferences/preferences';
import type { Exercise } from '../types';
import { exercise, slot } from './fixtures';

const goblet = exercise({ id: 'goblet', equipment: ['dumbbell'], equivalenceGroup: 'squat' });
const banded = exercise({ id: 'banded', equipment: ['band'], equivalenceGroup: 'squat' });
const paired = exercise({ id: 'paired', equipment: ['dumbbell'], equivalenceGroup: 'squat' });
const lunge = exercise({
  id: 'lunge',
  equipment: ['dumbbell'],
  movementPattern: 'Lunge',
  stanceMechanics: 'UnilateralSupported',
  primaryMuscles: ['glutes'],
});
const catalog: Record<string, Exercise> = Object.fromEntries(
  [goblet, banded, paired, lunge].map((e) => [e.id, e]),
);
const SLOT = slot({ id: 'squat', exerciseIds: ['goblet', 'banded', 'paired', 'lunge'] });

const input = (patch: Partial<VariantInput> = {}): VariantInput => ({
  slot: SLOT,
  current: 'goblet',
  catalog,
  eligibility: { profile: { knee: null }, excludedIds: new Set() },
  preferences: defaultPreferences(),
  evidence: { qualifiedExposures: 5, progressing: false },
  recentBlocks: [],
  ...patch,
});
const prefer = (patch: Partial<ReturnType<typeof defaultPreferences>>) => ({
  ...defaultPreferences(),
  ...patch,
});

describe('the rotation of today is the base', () => {
  it('the first block takes the first allowed variant', () => {
    expect(chooseBlockVariant(input({ current: undefined, evidence: null }))).toEqual({
      exerciseId: 'goblet',
      reasons: [],
    });
  });

  it('then the next one, and round again', () => {
    expect(chooseBlockVariant(input()).exerciseId).toBe('banded');
    expect(chooseBlockVariant(input({ current: 'lunge' })).exerciseId).toBe('goblet');
  });

  it('what may not be planned is not a candidate', () => {
    const eligibility = { profile: { knee: null }, excludedIds: new Set(['banded']) };
    expect(chooseBlockVariant(input({ eligibility })).exerciseId).toBe('paired');
  });

  it('one allowed variant is the only choice; none is none', () => {
    const only = { profile: { knee: null }, excludedIds: new Set(['banded', 'paired', 'lunge']) };
    expect(chooseBlockVariant(input({ eligibility: only })).exerciseId).toBe('goblet');
    const none = { profile: { knee: null }, excludedIds: new Set(SLOT.exerciseIds) };
    expect(chooseBlockVariant(input({ eligibility: none }))).toEqual({
      exerciseId: undefined,
      reasons: [],
    });
  });
});

describe('T35 a variant that works, or that is not done enough to judge, stays', () => {
  it('too few exposures, or none known: no data is not a stall', () => {
    const few = chooseBlockVariant(
      input({ evidence: { qualifiedExposures: 2, progressing: false } }),
    );
    expect(few).toEqual({ exerciseId: 'goblet', reasons: ['INSUFFICIENT_ROTATION_EVIDENCE'] });
    expect(chooseBlockVariant(input({ evidence: null })).reasons).toEqual([
      'INSUFFICIENT_ROTATION_EVIDENCE',
    ]);
  });

  it('progress: continuity', () => {
    const moving = chooseBlockVariant(
      input({ evidence: { qualifiedExposures: 5, progressing: true } }),
    );
    expect(moving).toEqual({ exerciseId: 'goblet', reasons: ['ROTATION_CONTINUITY'] });
  });

  it('enough exposures and no progress: the rotation moves on', () => {
    expect(chooseBlockVariant(input()).exerciseId).toBe('banded');
  });

  it('a person who wants variety gets the plain rotation', () => {
    const varied = prefer({ variety: 'varied' });
    expect(chooseBlockVariant(input({ preferences: varied, evidence: null })).exerciseId).toBe(
      'banded',
    );
    expect(rotationPolicyOf('varied')).toBe('cycle_all');
    expect(rotationPolicyOf('stable')).toBe('progress_aware');
    expect(rotationPolicyOf('normal')).toBe('progress_aware');
  });

  it('a variant that can no longer be done is changed whatever it shows (the equipment changed)', () => {
    const eligibility = { profile: { knee: null }, excludedIds: new Set(['goblet']) };
    const stays = input({ eligibility, evidence: { qualifiedExposures: 9, progressing: true } });
    expect(chooseBlockVariant(stays).exerciseId).toBe('banded');
  });

  it('the person’s own choice is respected, if it may be planned', () => {
    expect(chooseBlockVariant(input({ chosenByUser: 'lunge' }))).toEqual({
      exerciseId: 'lunge',
      reasons: ['USER_CHOICE'],
    });
    const eligibility = { profile: { knee: null }, excludedIds: new Set(['lunge']) };
    expect(chooseBlockVariant(input({ chosenByUser: 'lunge', eligibility })).exerciseId).toBe(
      'banded',
    );
  });
});

describe('T73 among variants so close that either would do, the preference decides', () => {
  it('the band is preferred: chosen within the group', () => {
    const preferences = prefer({ equipment: { band: 'prefer' } });
    const next = chooseBlockVariant(input({ current: 'lunge', preferences }));
    expect(next).toEqual({ exerciseId: 'banded', reasons: ['PREFERRED'] });
  });

  it('a variant outside the group is not drawn in by a preference', () => {
    const preferences = prefer({ exercises: { lunge: 'prefer' } });
    expect(chooseBlockVariant(input({ preferences })).exerciseId).toBe('banded');
  });

  it('without a preference the rotation decides, in its own order', () => {
    expect(chooseBlockVariant(input({ current: 'banded' })).exerciseId).toBe('paired');
  });
});

describe('T74, T75 what “avoid” means', () => {
  it('the heart for an exercise wins over a dislike of its equipment', () => {
    const preferences = prefer({
      exercises: { goblet: 'prefer' },
      equipment: { dumbbell: 'avoid' },
    });
    expect(chooseBlockVariant(input({ current: 'lunge', preferences })).exerciseId).toBe('goblet');
  });

  it('is not an exclusion: everything avoided still gives a variant', () => {
    const preferences = prefer({ equipment: { dumbbell: 'avoid', band: 'avoid' } });
    const next = chooseBlockVariant(input({ preferences }));
    expect(next.exerciseId).toBe('banded');
    expect(next.reasons).toEqual([]);
  });

  it('gives way to a variant that is not avoided and was not used lately', () => {
    const preferences = prefer({
      exercises: { goblet: 'avoid', banded: 'avoid', paired: 'avoid' },
    });
    const next = chooseBlockVariant(input({ preferences, recentBlocks: [{ squat: 'goblet' }] }));
    expect(next).toEqual({ exerciseId: 'lunge', reasons: ['AVOIDED_SKIPPED'] });
  });

  it('but not to one that was used in the last blocks', () => {
    const preferences = prefer({
      exercises: { goblet: 'avoid', banded: 'avoid', paired: 'avoid' },
    });
    const used = [{ squat: 'lunge' }, { squat: 'goblet' }];
    const next = chooseBlockVariant(input({ preferences, recentBlocks: used }));
    expect(next).toEqual({ exerciseId: 'banded', reasons: [] });
  });

  it('within a group, an avoided variant simply loses to one that is not', () => {
    const preferences = prefer({ exercises: { banded: 'avoid' } });
    expect(chooseBlockVariant(input({ preferences }))).toEqual({
      exerciseId: 'paired',
      reasons: ['PREFERRED'],
    });
  });
});

describe('a block', () => {
  it('asks every slot, with its own evidence and the person’s own choices', () => {
    const other = slot({ id: 'lunge', exerciseIds: ['lunge', 'goblet'] });
    const { slot: _s, current: _c, evidence: _e, chosenByUser: _u, ...shared } = input();
    const result = chooseBlockSelections(
      [SLOT, other],
      shared,
      { squat: 'goblet', lunge: 'lunge' },
      (s) => (s.id === 'squat' ? { qualifiedExposures: 5, progressing: false } : null),
      { lunge: 'goblet' },
    );
    expect(result.selections).toEqual({ squat: 'banded', lunge: 'goblet' });
    expect(result.reasons).toEqual({ squat: [], lunge: ['USER_CHOICE'] });
  });

  it('the first block: no slot has a previous variant, and a slot with nothing allowed has no entry', () => {
    const empty = slot({ id: 'empty', exerciseIds: ['nobody'] });
    const { slot: _s, current: _c, evidence: _e, chosenByUser: _u, ...shared } = input();
    const result = chooseBlockSelections([SLOT, empty], shared, null, () => null);
    expect(result.selections).toEqual({ squat: 'goblet' });
    expect(result.reasons.empty).toEqual([]);
  });
});
