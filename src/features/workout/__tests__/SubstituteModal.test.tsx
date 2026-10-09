import { fireEvent, render, screen } from '@testing-library/react-native';
import { CATALOG } from '@/domain/__tests__/dayV2Fixtures';
import { recipe, world } from '@/domain/__tests__/sessionChangeFixtures';
import { rankAlternatives } from '@/domain/session/assess';
import { pl } from '@/strings/pl';
import { SubstituteModal } from '../SubstituteModal';
import { loadAlternatives, swapExercise } from '../alternatives';

jest.mock('@gorhom/bottom-sheet', () => ({
  __esModule: true,
  ...jest.requireActual('@gorhom/bottom-sheet/mock'),
}));
jest.mock('../alternatives', () => ({
  loadAlternatives: jest.fn(),
  swapExercise: jest.fn(),
  adviceOf: () => [],
}));
const { snap, session } = world([recipe('goblet-squat')]);
const exposure = session.plan.exposures[0]!;
const alternatives = rankAlternatives(
  { exerciseId: 'goblet-squat', slotId: exposure.slotId!, muscles: [] },
  {
    snap,
    session,
    change: { kind: 'swap_remaining', exposureId: exposure.id, exercise: { id: 'goblet-squat' } },
  },
);
const data = { alternatives, expected: { planRevision: 1, historyRevision: 7 } };

async function renderModal(patch: Partial<Parameters<typeof SubstituteModal>[0]> = {}) {
  const props = {
    visible: true,
    sessionId: 's1',
    exposure,
    current: CATALOG['goblet-squat']!,
    exerciseMap: CATALOG,
    excludedIds: new Set<string>(),
    onSwapped: jest.fn(),
    onExclude: jest.fn(),
    onClose: jest.fn(),
    ...patch,
  };
  await render(<SubstituteModal {...props} />);
  return props;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadAlternatives).mockReturnValue(data);
  jest.mocked(swapExercise).mockResolvedValue({
    result: { kind: 'committed', result: { planRevision: 2 }, sessionRevision: 2 },
    blockSaved: true,
  });
});

describe('SubstituteModal', () => {
  it('shows alternatives ranked by the engine, with their muscles', async () => {
    await renderModal();
    expect(alternatives.length).toBeGreaterThan(0);
    await screen.findByText(CATALOG[alternatives[0]!.exerciseId]!.name);
    expect(loadAlternatives).toHaveBeenCalledWith('s1', exposure, undefined);
    expect(screen.getAllByText(/czworogłowe/).length).toBeGreaterThan(0);
  });
  it('opens a preview and applies only after the person chooses its button', async () => {
    const props = await renderModal();
    const first = alternatives[0]!;
    await fireEvent.press(await screen.findByText(CATALOG[first.exerciseId]!.name));
    expect(swapExercise).not.toHaveBeenCalled();
    expect(screen.getByText(/Główne mięśnie:/)).toBeTruthy();
    await fireEvent.press(screen.getByText(pl.workout.session.substituteBack));
    await fireEvent.press(screen.getByText(CATALOG[first.exerciseId]!.name));
    await fireEvent.press(screen.getByText(pl.workout.session.substitutePick));
    expect(swapExercise).toHaveBeenCalledWith('s1', exposure, first, data.expected, {
      forBlock: true,
      channel: 'touch',
    });
    expect(props.onSwapped).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it('can swap for today only', async () => {
    await renderModal();
    await fireEvent.press(screen.getByText(pl.workout.session.substituteForBlock));
    await fireEvent.press(await screen.findByText(CATALOG[alternatives[0]!.exerciseId]!.name));
    await fireEvent.press(screen.getByText(pl.workout.session.substitutePick));
    expect(swapExercise).toHaveBeenCalledWith('s1', exposure, alternatives[0], data.expected, {
      forBlock: false,
      channel: 'touch',
    });
  });
  it('shows an unreadable session and an empty ranking distinctly', async () => {
    jest.mocked(loadAlternatives).mockReturnValue(null);
    const view = await renderModal();
    await screen.findByText(pl.workout.session.substituteFailed);
    await renderModal({ sessionId: 'empty' });
    jest.mocked(loadAlternatives).mockReturnValue({ ...data, alternatives: [] });
    // Changing the exposure triggers a fresh ranking.
    await renderModal({ exposure: { ...exposure, id: 'empty' } });
    await screen.findByText(pl.workout.session.noSubstitutes);
    expect(view.onSwapped).not.toHaveBeenCalled();
  });
  it('excludes the current exercise through the caller', async () => {
    const props = await renderModal();
    await fireEvent.press(screen.getByText(pl.workout.session.excludeCurrent(props.current.name)));
    expect(props.onExclude).toHaveBeenCalledWith(props.current);
  });
});
