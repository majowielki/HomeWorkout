import { fireEvent, render, screen } from '@testing-library/react-native';
import { dayInput } from '@/domain/__tests__/dayV2Fixtures';
import { planDayV2 } from '@/domain/plan/dayV2';
import type { DayPreview } from '@/db/repositories/planningV2';
import { extraOptions, type loadExtraSession } from '../actions';
import { ExtraSessionPicker } from '../ExtraSessionPicker';
import { pl } from '@/strings/pl';

jest.mock('@/db/repositories/planningV2', () => ({}));
jest.mock('@/db/repositories/weekPlanV2', () => ({}));
jest.mock('@/db/repositories/workouts', () => ({}));
function fixture() {
  const input = dayInput({
    daily: [{ date: '2026-10-05', sleepHours: 7, energy: 4, soreness: { quads: 4 } }],
  });
  const data = {
    input,
    options: extraOptions(input),
    inProgress: null,
    done: true,
    rest: false,
  } satisfies Awaited<ReturnType<typeof loadExtraSession>>;
  const output = planDayV2({
    ...input,
    only: [{ slotId: 'push-horizontal' }],
    session: { ...input.session, kind: 'extra' },
  });
  const preview = { input, output } as DayPreview;
  return { data, preview };
}
it('toggles available movements, explains soreness and shows the compiled prescription', async () => {
  const { data, preview } = fixture();
  const slot = data.input.slots.find((s) => s.id === 'push-horizontal')!;
  const squat = data.input.slots.find((s) => s.id === 'squat')!;
  const onChange = jest.fn();
  const view = await render(
    <ExtraSessionPicker
      data={data}
      preview={null}
      selected={[]}
      onChange={onChange}
      busy={false}
    />,
  );
  expect(screen.queryByRole('checkbox', { name: squat.name })).toBeNull();
  expect(screen.getByText(new RegExp(`${squat.name} ·`))).toBeTruthy();
  await fireEvent.press(screen.getByRole('checkbox', { name: slot.name }));
  expect(onChange).toHaveBeenCalledWith(['push-horizontal']);
  await view.rerender(
    <ExtraSessionPicker
      data={data}
      preview={preview}
      selected={['push-horizontal']}
      onChange={onChange}
      busy={false}
    />,
  );
  expect(screen.getByText(pl.extra.preview)).toBeTruthy();
  expect(screen.getByText(/RIR/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('checkbox', { name: slot.name }));
  expect(onChange).toHaveBeenLastCalledWith([]);
  await view.rerender(
    <ExtraSessionPicker
      data={data}
      preview={preview}
      selected={['push-horizontal']}
      onChange={onChange}
      busy
    />,
  );
  onChange.mockClear();
  await fireEvent.press(screen.getByRole('checkbox', { name: slot.name }));
  expect(onChange).not.toHaveBeenCalled();
});
it('explains when no movements are available', async () => {
  const { data } = fixture();
  data.options = [];
  await render(
    <ExtraSessionPicker
      data={data}
      preview={null}
      selected={[]}
      onChange={jest.fn()}
      busy={false}
    />,
  );
  expect(screen.getByText(pl.extra.empty)).toBeTruthy();
});
