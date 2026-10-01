import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useRestTimerStore } from '@/stores/restTimerStore';

import { RestTimer } from '../RestTimer';

jest.mock('@/lib/notifications', () => ({
  scheduleRestEndNotification: jest.fn(async () => 'notification-1'),
  cancelNotification: jest.fn(async () => undefined),
}));

describe('RestTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-14T10:00:00Z'));
    useRestTimerStore.setState({ restEndsAt: null, notificationId: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing until the store has an end time', async () => {
    await render(<RestTimer nextLabel={null} onDone={jest.fn()} />);
    expect(screen.queryByText('Przerwa')).toBeNull();
  });

  it('counts down from the end timestamp rather than a local counter', async () => {
    await act(() => useRestTimerStore.getState().start(90, 'body'));
    await render(<RestTimer nextLabel="A2 · Wiosłowanie" onDone={jest.fn()} />);

    await act(() => jest.advanceTimersByTime(300));
    expect(screen.getByText('1:30')).toBeTruthy();

    // Jump the clock 50 s in one go — a decrementing counter would show 1:29
    // here; recomputing from the timestamp shows the true remaining time.
    await act(() => jest.advanceTimersByTime(50_000));
    expect(screen.getByText('0:40')).toBeTruthy();
    expect(screen.getByText(/A2 · Wiosłowanie/)).toBeTruthy();
  });

  it('calls onDone once the time runs out', async () => {
    const onDone = jest.fn();
    await act(() => useRestTimerStore.getState().start(2, 'body'));
    await render(<RestTimer nextLabel={null} onDone={onDone} />);

    await act(() => jest.advanceTimersByTime(1_000));
    expect(onDone).not.toHaveBeenCalled();

    await act(() => jest.advanceTimersByTime(1_500));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('skip stops the store and reports done immediately', async () => {
    const onDone = jest.fn();
    await act(() => useRestTimerStore.getState().start(90, 'body'));
    await render(<RestTimer nextLabel={null} onDone={onDone} />);
    await act(() => jest.advanceTimersByTime(300));

    await fireEvent.press(screen.getByText('Pomiń'));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(useRestTimerStore.getState().restEndsAt).toBeNull();
  });

  it('+30 s pushes the end time back', async () => {
    await act(() => useRestTimerStore.getState().start(60, 'body'));
    await render(<RestTimer nextLabel={null} onDone={jest.fn()} />);
    await act(() => jest.advanceTimersByTime(300));
    expect(screen.getByText('1:00')).toBeTruthy();

    await fireEvent.press(screen.getByText('+30 s'));
    await act(() => jest.advanceTimersByTime(300));
    expect(screen.getByText('1:30')).toBeTruthy();
  });
});
