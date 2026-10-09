import { fireEvent, render, screen } from '@testing-library/react-native';

import { specFromLoad } from '@/domain/resistance/persistedLoad';
import { pl } from '@/strings/pl';

import { CalibrationCard } from '../CalibrationCard';
import type { CalibrationOffer } from '../calibration';

const offer = (direction: 'up' | 'down'): CalibrationOffer => ({
  direction,
  comparisonKey: 'k',
  plannedSetId: 's',
  exerciseId: 'goblet-squat',
  remaining: 2,
  from: specFromLoad({ kind: 'dumbbell', mode: 'paired', kg: 6 }),
  to: specFromLoad({ kind: 'dumbbell', mode: 'paired', kg: 8 }),
  command: {} as never,
});

it('offers the sets that remain one step up, with the two loads, and takes the answer', async () => {
  const onAccept = jest.fn();
  const onDecline = jest.fn();
  await render(<CalibrationCard offer={offer('up')} onAccept={onAccept} onDecline={onDecline} />);
  const c = pl.workout.session.calibration;
  expect(screen.getByText(c.upTitle)).toBeTruthy();
  expect(screen.getByText(c.up(2, '2 × 6 kg', '2 × 8 kg'))).toBeTruthy();
  await fireEvent.press(screen.getByText(c.accept));
  expect(onAccept).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByText(c.decline));
  expect(onDecline).toHaveBeenCalledTimes(1);
});

it('says so when it goes down', async () => {
  await render(
    <CalibrationCard offer={offer('down')} onAccept={jest.fn()} onDecline={jest.fn()} />,
  );
  expect(screen.getByText(pl.workout.session.calibration.downTitle)).toBeTruthy();
});
