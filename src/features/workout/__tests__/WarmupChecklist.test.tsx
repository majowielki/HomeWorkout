import { fireEvent, render, screen } from '@testing-library/react-native';

import { WarmupChecklist } from '../WarmupChecklist';

describe('WarmupChecklist', () => {
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
});
