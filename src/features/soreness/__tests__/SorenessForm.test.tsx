import { fireEvent, render, screen } from '@testing-library/react-native';

import { pl } from '@/strings/pl';
import { SorenessForm } from '../SorenessForm';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
const t = pl.soreness;
async function chooseMuscles(kind: keyof typeof t.kind) {
  await fireEvent.press(screen.getByText(t.kind[kind]));
  // Merely selecting a symptom does not count as "no red flags".
  expect(screen.getByText(t.next)).toBeDisabled();
  await fireEvent.press(screen.getByText(t.redNone));
  await fireEvent.press(screen.getByText(t.next));
  await fireEvent.press(screen.getByText(pl.labels.muscle.chest));
}

it('previews strong DOMS for two days, saves only after applying, and can change the duration', async () => {
  const submit = jest.fn();
  await render(<SorenessForm asOf="2026-10-07" busy={false} onSubmit={submit} />);
  await chooseMuscles('strong_doms');
  await fireEvent.press(screen.getByText(t.next));
  expect(screen.getByText(t.domsEffect)).toBeTruthy();
  expect(screen.getByRole('button', { name: '2 dni' })).toBeSelected();
  expect(submit).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('1 dzień'));
  await fireEvent.press(screen.getByText(t.save));
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'strong_doms', muscles: ['chest'], redFlags: false, days: 1 }),
  );
});
it('records mild DOMS without a duration or exclusion request', async () => {
  const submit = jest.fn();
  await render(<SorenessForm asOf="2026-10-07" busy={false} onSubmit={submit} />);
  await chooseMuscles('mild_doms');
  await fireEvent.press(screen.getByText(t.next));
  expect(screen.getByText(t.mildEffect)).toBeTruthy();
  expect(screen.queryByText(t.duration)).toBeNull();
  await fireEvent.press(screen.getByText(t.saveMild));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'mild_doms' }));
});
it('requires all three pain answers, offers not-tried, and defaults to a three-day exclusion', async () => {
  const submit = jest.fn();
  await render(<SorenessForm asOf="2026-10-07" busy={false} onSubmit={submit} />);
  await chooseMuscles('muscle_pain');
  expect(screen.getByText(t.painHint)).toBeTruthy();
  expect(screen.getByText(t.next)).toBeDisabled();
  await fireEvent.press(screen.getByText(t.answers.onset.during));
  await fireEvent.press(screen.getByText(t.answers.location.focal));
  expect(screen.getByText(t.next)).toBeDisabled();
  await fireEvent.press(screen.getByText(t.answers.movement.not_tried));
  await fireEvent.press(screen.getByText(t.next));
  expect(screen.getByRole('button', { name: '3 dni' })).toBeSelected();
  expect(screen.getByText(t.painEffect)).toBeTruthy();
  expect(screen.getByText(t.strainHint)).toBeTruthy();
  expect(screen.getByText(t.expiryHint)).toBeTruthy();
  await fireEvent.press(screen.getByText(t.previous));
  expect(screen.getByRole('button', { name: t.answers.location.focal })).toBeSelected();
  await fireEvent.press(screen.getByText(t.next));
  await fireEvent.press(screen.getByText(t.save));
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      days: 3,
      pain: { onset: 'during', location: 'focal', movement: 'not_tried' },
    }),
  );
});
it('never reassures a DOMS-like pain report that an injury is ruled out', async () => {
  await render(<SorenessForm asOf="2026-10-07" busy={false} onSubmit={jest.fn()} />);
  await chooseMuscles('muscle_pain');
  await fireEvent.press(screen.getByText(t.answers.onset.delayed));
  await fireEvent.press(screen.getByText(t.answers.location.diffuse));
  await fireEvent.press(screen.getByText(t.answers.movement.better));
  await fireEvent.press(screen.getByText(t.next));
  expect(screen.getByText(t.painUncertain)).toBeTruthy();
  expect(screen.getByText(t.painEffect)).toBeTruthy();
});
it('routes red flags to consultation even when the person selected mild DOMS', async () => {
  const submit = jest.fn();
  await render(<SorenessForm asOf="2026-10-07" busy={false} onSubmit={submit} />);
  await fireEvent.press(screen.getByText(t.kind.mild_doms));
  await fireEvent.press(screen.getByText(t.redSome));
  expect(screen.getByText(t.redHeading)).toBeTruthy();
  expect(screen.queryByText(t.next)).toBeNull();
  expect(screen.queryByText(t.saveMild)).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});
it('shows joint guidance and settings with no planner-change action', async () => {
  await render(<SorenessForm asOf="2026-10-07" busy={false} onSubmit={jest.fn()} />);
  await fireEvent.press(screen.getByText(t.kind.joint_pain));
  expect(screen.getByText(t.jointHeading)).toBeTruthy();
  expect(screen.getByText(t.settings)).toBeTruthy();
  expect(screen.queryByText(t.next)).toBeNull();
  expect(screen.queryByText(t.save)).toBeNull();
});
it('disables submission while saving and lets muscle chips be deselected', async () => {
  const submit = jest.fn();
  const view = await render(<SorenessForm asOf="2026-10-07" busy={false} onSubmit={submit} />);
  await chooseMuscles('strong_doms');
  await fireEvent.press(screen.getByText(pl.labels.muscle.chest));
  expect(screen.getByText(t.next)).toBeDisabled();
  await fireEvent.press(screen.getByText(pl.labels.muscle.back));
  await fireEvent.press(screen.getByText(t.next));
  await view.rerender(<SorenessForm asOf="2026-10-07" busy onSubmit={submit} />);
  expect(screen.getByText(t.saving)).toBeDisabled();
  await fireEvent.press(screen.getByText(t.saving));
  expect(submit).not.toHaveBeenCalled();
});
