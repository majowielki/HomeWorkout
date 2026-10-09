import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import { exercise } from '@/domain/__tests__/fixtures';
import { legalObservation } from '@/domain/__tests__/planFixtures';
import { body, kg } from '@/domain/__tests__/progressionFixtures';
import { specFromLoad } from '@/domain/resistance/persistedLoad';
import { suggestedValues } from '@/domain/session/setEntry';
import { pl } from '@/strings/pl';
import { SetLogger, type SetLoggerHandle } from '../SetLogger';
import { loggerStep } from './loggerFixtures';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('@/assets/ymove-media', () => ({ ymoveMedia: {} }));
const dumbbell = exercise({ equipment: ['dumbbell'], dumbbellMode: 'paired' });
const hold = exercise({ equipment: ['bodyweight'], forceProfile: 'Isometric' });
const band = exercise({ equipment: ['band'] });
const timedStep = () =>
  loggerStep({ unit: 'duration' }, { lo: 20, target: 30, hi: 40, resistance: body });

describe('SetLogger', () => {
  it('submits the prescribed values as confirmed suggestions through touch', async () => {
    const onSave = jest.fn();
    await render(
      <SetLogger
        exercise={dumbbell}
        step={loggerStep({}, { resistance: kg(6) })}
        onSave={onSave}
      />,
    );
    expect(screen.getByText('6 kg')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('cel: 8–12')).toBeTruthy();
    await fireEvent.press(screen.getByText(pl.workout.session.saveSet));
    expect(onSave).toHaveBeenCalledWith({
      channel: 'touch',
      shown: { amount: 'visible', resistance: 'visible', rir: 'visible' },
      entry: expect.objectContaining({
        amount: { value: { kind: 'reps', reps: 10 }, edited: false },
        resistance: { value: kg(6), edited: false },
        rir: { value: 2, edited: false },
      }),
    });
  });
  it('uses the previous result for load and effort, preserving this set target', async () => {
    const result = legalObservation();
    const previous = {
      ...result,
      resistance: { ...result.resistance, value: kg(8) },
      rir: { ...result.rir, value: 1 },
    };
    const onSave = jest.fn();
    await render(
      <SetLogger exercise={dumbbell} step={loggerStep()} previous={previous} onSave={onSave} />,
    );
    expect(screen.getByText('8 kg')).toBeTruthy();
    await fireEvent.press(screen.getByText(pl.workout.session.saveSet));
    expect(onSave.mock.calls[0][0].entry).toMatchObject({
      amount: { value: { reps: 10 } },
      rir: { value: 1 },
    });
  });
  it('labels a probe set and starts the set after it from the plan, not from the probe load', async () => {
    const probeStep = loggerStep({}, { role: 'probe', required: false, resistance: kg(6) });
    expect(probeStep.set.role).toBe('probe');
    const { unmount } = await render(
      <SetLogger exercise={dumbbell} step={probeStep} onSave={jest.fn()} />,
    );
    expect(screen.getByText(pl.workout.session.probe)).toBeTruthy();
    await unmount();
    const workStep = loggerStep({}, { resistance: kg(4) });
    const previous = {
      ...legalObservation(),
      resistance: { ...legalObservation().resistance, value: kg(6) },
    };
    await render(
      <SetLogger
        exercise={dumbbell}
        step={workStep}
        previous={previous}
        previousPlanned={probeStep.set}
        onSave={jest.fn()}
      />,
    );
    expect(screen.getByText('4 kg')).toBeTruthy();
    expect(screen.queryByText(pl.workout.session.probe)).toBeNull();
  });
  it('restores a taken-back set instead of the suggestion', async () => {
    const step = loggerStep();
    const restore = {
      ...suggestedValues(dumbbell, step.set, null),
      reps: 7,
      weightKg: 8,
      rir: 1,
      shortfall: 'pain' as const,
    };
    const onSave = jest.fn();
    await render(<SetLogger exercise={dumbbell} step={step} restore={restore} onSave={onSave} />);
    expect(screen.getByText('7')).toBeTruthy();
    await fireEvent.press(screen.getByText(pl.workout.session.saveSet));
    expect(onSave.mock.calls[0][0].entry).toMatchObject({
      amount: { edited: true, value: { reps: 7 } },
      shortfall: 'pain',
    });
  });
  it('edits effort and steps weight along the inventory ladder', async () => {
    const onSave = jest.fn();
    await render(<SetLogger exercise={dumbbell} step={loggerStep()} onSave={onSave} />);
    await fireEvent.press(screen.getByLabelText('Zwiększ: Hantle (para)'));
    expect(screen.getByText('6 kg')).toBeTruthy();
    await fireEvent.press(screen.getByText('Lekko'));
    await fireEvent.press(screen.getByText(pl.workout.session.saveSet));
    expect(onSave.mock.calls[0][0].entry).toMatchObject({
      resistance: { value: kg(6), edited: true },
      rir: { value: 4, edited: true },
    });
  });
  it('asks why the amount fell short and drops the reason when the target is met', async () => {
    const onSave = jest.fn();
    await render(
      <SetLogger exercise={dumbbell} step={loggerStep({}, { lo: 10 })} onSave={onSave} />,
    );
    await fireEvent.press(screen.getByLabelText('Zmniejsz: Powtórzenia'));
    await fireEvent.press(screen.getByText(pl.workout.session.shortfall.reason.pain));
    expect(screen.getByText(pl.workout.session.shortfall.painNote)).toBeTruthy();
    await fireEvent.press(screen.getByText(pl.workout.session.saveSet));
    expect(onSave.mock.calls[0][0].entry.shortfall).toBe('pain');
    await fireEvent.press(screen.getByLabelText('Zwiększ: Powtórzenia'));
    expect(screen.queryByText(pl.workout.session.shortfall.title)).toBeNull();
    await fireEvent.press(screen.getByText(pl.workout.session.saveSet));
    expect(onSave.mock.calls[1][0].entry.shortfall).toBeNull();
  });
  it('shows band controls and the compiler warm-up cue', async () => {
    const onSave = jest.fn();
    const resistance = specFromLoad({ kind: 'band', bandId: 'black', position: 2 });
    await render(
      <SetLogger
        exercise={band}
        step={loggerStep({ bandWarmup: true }, { resistance })}
        onSave={onSave}
      />,
    );
    expect(screen.getByText(pl.workout.session.bandPrestretch)).toBeTruthy();
    expect(screen.queryByLabelText('Zwiększ: Hantle (para)')).toBeNull();
    await fireEvent.press(screen.getByText(pl.workout.session.saveSet));
    expect(onSave.mock.calls[0][0].entry.resistance).toEqual({ value: resistance, edited: false });
  });
  it('records mini-band mobility without long-band colours or kilograms', async () => {
    const mini = exercise({ equipment: ['mini-band'], movementPattern: 'Mobility' });
    const onSave = jest.fn();
    await render(
      <SetLogger exercise={mini} step={loggerStep({}, { resistance: body })} onSave={onSave} />,
    );
    expect(screen.getByText(pl.workout.session.miniBandNote)).toBeTruthy();
    expect(screen.queryByText('P2')).toBeNull();
    await fireEvent.press(screen.getByText(pl.workout.session.saveSet));
    expect(onSave.mock.calls[0][0].entry.resistance.value).toEqual(body);
  });
  it('logs seconds for a hold and has no reps control', async () => {
    const onSave = jest.fn();
    await render(<SetLogger exercise={hold} step={timedStep()} onSave={onSave} />);
    await fireEvent.press(screen.getByLabelText('Zwiększ: Czas'));
    await fireEvent.press(screen.getByText(pl.workout.session.saveSet));
    expect(onSave.mock.calls[0][0].entry.amount).toEqual({
      value: { kind: 'duration', seconds: 35 },
      edited: true,
    });
    expect(screen.queryByLabelText('Zwiększ: Powtórzenia')).toBeNull();
  });
  it('reads a voice save back and marks voice confirmations', async () => {
    const ref = createRef<SetLoggerHandle>();
    const onSave = jest.fn();
    await render(<SetLogger ref={ref} exercise={dumbbell} step={loggerStep()} onSave={onSave} />);
    let text: string | null = null;
    await act(() => {
      text = ref.current!.save();
    });
    expect(text).toContain('10');
    expect(onSave.mock.calls[0][0]).toMatchObject({
      channel: 'voice',
      shown: { amount: 'read_back', rir: 'read_back' },
    });
  });
  it('edits voice parameters with independent undo and rejects unavailable fields', async () => {
    const ref = createRef<SetLoggerHandle>();
    const onSave = jest.fn();
    await render(<SetLogger ref={ref} exercise={dumbbell} step={loggerStep()} onSave={onSave} />);
    let undo: (() => void) | undefined;
    await act(() => {
      undo = ref.current!.setParameter({ action: 'set_reps', reps: 12 })?.undo;
    });
    await act(() => {
      ref.current!.setParameter({ action: 'set_weight', kg: 8 });
    });
    await act(() => {
      undo?.();
    });
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('8 kg')).toBeTruthy();
    expect(ref.current!.setParameter({ action: 'set_time', seconds: 40 })).toBeNull();
    expect(ref.current!.setParameter({ action: 'set_weight', kg: 7 })).toBeNull();
    expect(ref.current!.setParameter({ action: 'set_reps', reps: 0 })).toBeNull();
    expect(ref.current!.setParameter({ action: 'set_effort', rir: 5 })).toBeNull();
    await fireEvent.press(screen.getByText(pl.workout.session.saveSet));
    expect(onSave.mock.calls[0][0].entry).toMatchObject({
      amount: { edited: false },
      resistance: { edited: true },
    });
  });
  it('edits a band and position by voice', async () => {
    const ref = createRef<SetLoggerHandle>();
    const onSave = jest.fn();
    await render(
      <SetLogger
        ref={ref}
        exercise={band}
        step={loggerStep(
          {},
          { resistance: specFromLoad({ kind: 'band', bandId: 'yellow', position: 1 }) },
        )}
        onSave={onSave}
      />,
    );
    await act(() => {
      ref.current!.setParameter({ action: 'set_band', bandId: 'black' });
    });
    await act(() => {
      ref.current!.setParameter({ action: 'set_position', position: 3 });
    });
    await act(() => {
      ref.current!.save();
    });
    expect(onSave.mock.calls[0][0].entry.resistance).toEqual({
      value: specFromLoad({ kind: 'band', bandId: 'black', position: 3 }),
      edited: true,
    });
  });
  it('stops a running stopwatch on voice save and stores the measured duration', async () => {
    jest.useFakeTimers();
    try {
      const ref = createRef<SetLoggerHandle>();
      const onSave = jest.fn();
      const onStopwatchChange = jest.fn();
      await render(
        <SetLogger
          ref={ref}
          exercise={hold}
          step={timedStep()}
          onSave={onSave}
          onStopwatchChange={onStopwatchChange}
        />,
      );
      await act(() => {
        ref.current!.startStopwatch();
      });
      await act(() => {
        jest.advanceTimersByTime(38_000);
      });
      expect(ref.current!.setParameter({ action: 'set_time', seconds: 50 })).toBeNull();
      await act(() => {
        ref.current!.save();
      });
      expect(onSave.mock.calls[0][0].entry.amount.value).toEqual({ kind: 'duration', seconds: 38 });
      expect(onStopwatchChange).toHaveBeenLastCalledWith(false);
    } finally {
      jest.useRealTimers();
    }
  });
  it('blocks touch and voice while saving', async () => {
    const ref = createRef<SetLoggerHandle>();
    const onSave = jest.fn();
    await render(
      <SetLogger ref={ref} exercise={dumbbell} step={loggerStep()} onSave={onSave} saving />,
    );
    expect(ref.current!.save()).toBeNull();
    expect(ref.current!.setParameter({ action: 'set_reps', reps: 12 })).toBeNull();
    await fireEvent.press(screen.getByText(pl.workout.session.saveSet));
    expect(onSave).not.toHaveBeenCalled();
  });
  it('shows side, supersets and knee cues from the active step', async () => {
    await render(
      <SetLogger
        exercise={exercise({ kneeCue: 'Kolano nad stopą.' })}
        step={loggerStep({ sideMode: 'per_set' })}
        supersetWith="Wiosłowanie"
        onSave={jest.fn()}
      />,
    );
    expect(screen.getByText(pl.workout.session.side.left)).toBeTruthy();
    expect(screen.getByText(pl.workout.session.supersetWith('Wiosłowanie'))).toBeTruthy();
    expect(screen.getByText('Kolano nad stopą.')).toBeTruthy();
  });
});
