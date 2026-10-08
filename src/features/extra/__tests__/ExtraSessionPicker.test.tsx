import { fireEvent, render, screen } from '@testing-library/react-native';
import { extraInput } from '@/domain/__tests__/extraFixtures';
import { pl } from '@/strings/pl';
import { ExtraSessionPicker } from '../ExtraSessionPicker';

it('toggles only available movements, previews loads and explains omitted choices', async () => {
  const input = extraInput({
    daily: [{ date: '2026-10-08', sleepHours: 7, energy: 4, soreness: { quads: 4 } }],
  });
  const onChange = jest.fn();
  const view = await render(
    <ExtraSessionPicker input={input} selected={[]} onChange={onChange} busy={false} />,
  );
  expect(screen.queryByRole('checkbox', { name: 'Nogi' })).toBeNull();
  expect(screen.getByText(/Nogi · mocne zakwasy/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Pchanie' }));
  expect(onChange).toHaveBeenCalledWith(['push']);
  await view.rerender(
    <ExtraSessionPicker input={input} selected={['push']} onChange={onChange} busy={false} />,
  );
  expect(screen.getByText(pl.extra.preview)).toBeTruthy();
  expect(screen.getByText(/RIR/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Pchanie' }));
  expect(onChange).toHaveBeenLastCalledWith([]);
  await view.rerender(
    <ExtraSessionPicker input={input} selected={['push']} onChange={onChange} busy />,
  );
  onChange.mockClear();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Plecy' }));
  expect(onChange).not.toHaveBeenCalled();
});
it('shows recovery when no muscles are available', async () => {
  const input = extraInput();
  input.block.selections = {};
  await render(
    <ExtraSessionPicker input={input} selected={[]} onChange={jest.fn()} busy={false} />,
  );
  expect(screen.getByText(pl.extra.empty)).toBeTruthy();
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
});
it('previews a combined choice within limits and tells which movement was left out', async () => {
  const input = extraInput();
  input.catalog.pull!.primaryMuscles = ['chest'];
  await render(
    <ExtraSessionPicker
      input={input}
      selected={['push', 'pull']}
      onChange={jest.fn()}
      busy={false}
    />,
  );
  expect(screen.getByText(pl.extra.reduced)).toBeTruthy();
  expect(screen.getByText(/Plecy · ta partia pracuje/)).toBeTruthy();
});
