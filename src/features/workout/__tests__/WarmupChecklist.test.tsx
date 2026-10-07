import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { getWarmupView, setWarmupView } from '@/lib/warmupView';

import { WarmupChecklist } from '../WarmupChecklist';

jest.mock('@/lib/warmupView', () => ({
  getWarmupView: jest.fn(() => 'list'),
  setWarmupView: jest.fn(),
}));

/** The card pager renders once it knows its width. */
async function layOutCards() {
  await act(async () => {
    fireEvent(screen.getByTestId('warmup-cards'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 600 } },
    });
  });
}

describe('WarmupChecklist', () => {
  beforeEach(() => {
    jest.mocked(getWarmupView).mockReturnValue('list');
    jest.mocked(setWarmupView).mockClear();
  });

  it('ticks moves off and starts with any number ticked', async () => {
    const onDone = jest.fn();
    await render(<WarmupChecklist moves={['arm-circles', 'cat-cow']} onDone={onDone} />);

    const circles = screen.getByRole('checkbox', { name: /Krążenia ramion/ });
    expect(circles.props.accessibilityState.checked).toBe(false);
    await fireEvent.press(circles);
    expect(
      screen.getByRole('checkbox', { name: /Krążenia ramion/ }).props.accessibilityState.checked,
    ).toBe(true);
    expect(screen.queryByText('Wykroki w tył z podparciem')).toBeNull();

    await fireEvent.press(screen.getByText('Gotowe, zaczynamy'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('can be skipped', async () => {
    const onDone = jest.fn();
    await render(<WarmupChecklist moves={['arm-circles']} onDone={onDone} />);
    await fireEvent.press(screen.getByText('Pomiń rozgrzewkę'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('switches to big cards, keeps the ticks and remembers the choice', async () => {
    await render(<WarmupChecklist moves={['arm-circles', 'cat-cow']} onDone={jest.fn()} />);
    await fireEvent.press(screen.getByRole('checkbox', { name: /Krążenia ramion/ }));

    await fireEvent.press(screen.getByLabelText('Pokaż duże karty'));
    expect(setWarmupView).toHaveBeenCalledWith('cards');
    await layOutCards();

    expect(screen.getByText('1 z 2')).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Krążenia ramion' }).props.accessibilityState.checked,
    ).toBe(true);

    await fireEvent.press(screen.getByLabelText('Pokaż listę'));
    expect(setWarmupView).toHaveBeenLastCalledWith('list');
  });

  it('on cards, "done" ticks the move and moves on; the last one starts the workout', async () => {
    jest.mocked(getWarmupView).mockReturnValue('cards');
    const onDone = jest.fn();
    await render(<WarmupChecklist moves={['arm-circles', 'cat-cow']} onDone={onDone} />);
    await layOutCards();

    await fireEvent.press(screen.getByText('Zrobione, dalej'));
    expect(screen.getByText('2 z 2')).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Krążenia ramion' }).props.accessibilityState.checked,
    ).toBe(true);
    expect(onDone).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Gotowe, zaczynamy'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('checkbox', { name: 'Koci grzbiet' }).props.accessibilityState.checked,
    ).toBe(true);
  });
});
