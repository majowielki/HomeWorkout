import { loadSessionChangeSource } from '@/db/repositories/sessionChangeSource';
import { applySessionChange } from '@/db/repositories/sessionChanges';
import { getCurrentBlock, setBlockSelection } from '@/db/repositories/trainingBlocks';
import { recipe, world } from '@/domain/__tests__/sessionChangeFixtures';
import { adviceOf, loadAlternatives, swapExercise } from '../alternatives';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'command' }));
jest.mock('@/db/repositories/sessionChangeSource', () => ({ loadSessionChangeSource: jest.fn() }));
jest.mock('@/db/repositories/sessionChanges', () => ({ applySessionChange: jest.fn() }));
jest.mock('@/db/repositories/trainingBlocks', () => ({
  getCurrentBlock: jest.fn(),
  setBlockSelection: jest.fn(),
}));
const fixture = world([recipe('goblet-squat')]);
const source = {
  ...fixture,
  session: { ...fixture.session, records: [...fixture.session.records] },
  problems: [],
};
const exposure = source.session.plan.exposures[0]!;
const committed = { kind: 'committed' as const, result: { planRevision: 2 }, sessionRevision: 2 };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadSessionChangeSource).mockReturnValue(source);
  jest.mocked(applySessionChange).mockReturnValue(committed);
  jest
    .mocked(getCurrentBlock)
    .mockResolvedValue({ id: 'block' } as Awaited<ReturnType<typeof getCurrentBlock>>);
  jest.mocked(setBlockSelection).mockResolvedValue(undefined);
});
describe('alternatives', () => {
  it('ranks against the fresh session and retains the revisions for acceptance', () => {
    const loaded = loadAlternatives('s1', exposure)!;
    expect(loaded.expected).toEqual({ planRevision: 1, historyRevision: 7 });
    expect(loaded.alternatives.length).toBeGreaterThan(0);
    expect(loaded.alternatives.every((a) => a.verdict !== 'blocked')).toBe(true);
    expect(loadSessionChangeSource).toHaveBeenCalledWith('s1');
  });
  it('rejects missing or unreadable sessions and filters by equipment family', () => {
    const loaded = loadAlternatives('s1', exposure, 'band')!;
    expect(
      loaded.alternatives.every((a) =>
        source.snap.catalog[a.exerciseId]!.equipment.includes('band'),
      ),
    ).toBe(true);
    jest.mocked(loadSessionChangeSource).mockReturnValue(null);
    expect(loadAlternatives('s1', exposure)).toBeNull();
    jest.mocked(loadSessionChangeSource).mockReturnValue({
      ...source,
      problems: [{ code: 'UNKNOWN_SESSION', recordId: 'bad', detail: 'bad', sessionId: 's1' }],
    });
    expect(loadAlternatives('s1', exposure)).toBeNull();
  });
  it('accepts the assessed patch and advice before saving the block choice', async () => {
    const { alternatives, expected } = loadAlternatives('s1', exposure)!;
    const alternative = alternatives[0]!;
    expect(
      await swapExercise('s1', exposure, alternative, expected, {
        forBlock: true,
        channel: 'touch',
      }),
    ).toEqual({ result: committed, blockSaved: true });
    expect(applySessionChange).toHaveBeenCalledWith({
      commandId: 'command',
      sessionId: 's1',
      patchId: alternative.patchId,
      change: alternative.change,
      expected,
      acknowledged: adviceOf(alternative),
      channel: 'touch',
    });
    expect(setBlockSelection).toHaveBeenCalledWith(
      'block',
      exposure.slotId,
      alternative.exerciseId,
    );
  });
  it('never saves a block selection after conflict or for a today-only swap', async () => {
    const { alternatives, expected } = loadAlternatives('s1', exposure)!;
    await swapExercise('s1', exposure, alternatives[0]!, expected, {
      forBlock: false,
      channel: 'voice',
    });
    jest
      .mocked(applySessionChange)
      .mockReturnValue({ kind: 'conflict', code: 'STALE_INPUT', actualRevision: 2 });
    await swapExercise('s1', exposure, alternatives[0]!, expected, {
      forBlock: true,
      channel: 'touch',
    });
    expect(setBlockSelection).not.toHaveBeenCalled();
  });
  it('reports a block-save failure after a successful session swap', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { alternatives, expected } = loadAlternatives('s1', exposure)!;
    jest.mocked(setBlockSelection).mockRejectedValue(new Error('write failed'));
    expect(
      await swapExercise('s1', exposure, alternatives[0]!, expected, {
        forBlock: true,
        channel: 'touch',
      }),
    ).toEqual({ result: committed, blockSaved: false });
    warning.mockRestore();
  });
});
