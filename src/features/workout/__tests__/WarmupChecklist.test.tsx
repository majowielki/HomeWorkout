import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';

import { getWarmupView, setWarmupView } from '@/lib/warmupView';

import { WarmupChecklist, type WarmupHandle } from '../WarmupChecklist';

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

describe('WarmupChecklist by voice', () => {
  const checked = (name: RegExp) =>
    screen.getByRole('checkbox', { name }).props.accessibilityState.checked as boolean;

  it('in the list, ticks the next unticked move, takes it back, and ends after the last', async () => {
    jest.mocked(getWarmupView).mockReturnValue('list');
    const onDone = jest.fn();
    const ref = createRef<WarmupHandle>();
    await render(<WarmupChecklist ref={ref} moves={['arm-circles', 'cat-cow']} onDone={onDone} />);

    let step!: ReturnType<WarmupHandle['next']>;
    await act(async () => {
      step = ref.current!.next();
    });
    expect(step).toEqual({ kind: 'ticked', id: 'arm-circles', index: 0 });
    expect(checked(/Krążenia ramion/)).toBe(true);

    await act(async () => ref.current!.untick(step as Extract<typeof step, { kind: 'ticked' }>));
    expect(checked(/Krążenia ramion/)).toBe(false);

    await act(async () => void ref.current!.next());
    await act(async () => void ref.current!.next());
    await act(async () => {
      step = ref.current!.next();
    });
    expect(step).toEqual({ kind: 'finished' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('in the cards, does what "Zrobione, dalej" does', async () => {
    jest.mocked(getWarmupView).mockReturnValue('cards');
    const onDone = jest.fn();
    const ref = createRef<WarmupHandle>();
    await render(<WarmupChecklist ref={ref} moves={['arm-circles', 'cat-cow']} onDone={onDone} />);
    await layOutCards();

    let step!: ReturnType<WarmupHandle['next']>;
    await act(async () => {
      step = ref.current!.next();
    });
    expect(step).toEqual({ kind: 'ticked', id: 'arm-circles', index: 0 });
    expect(screen.getByText('2 z 2')).toBeTruthy();

    await act(async () => ref.current!.untick(step as Extract<typeof step, { kind: 'ticked' }>));
    expect(screen.getByText('1 z 2')).toBeTruthy();

    await act(async () => void ref.current!.next());
    await act(async () => {
      step = ref.current!.next();
    });
    expect(step).toEqual({ kind: 'finished' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
