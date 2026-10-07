import { fireEvent, render, screen } from '@testing-library/react-native';

import { GroupDoneCard } from '../GroupDoneCard';

describe('GroupDoneCard', () => {
  it('lists the sets just done and moves on only on a tap', async () => {
    const onNext = jest.fn();
    await render(
      <GroupDoneCard
        exercises={[
          { name: 'Przysiad do krzesła', sets: ['6 kg × 10 · RIR 3', '6 kg × 11 · RIR 3'] },
          { name: 'Pompka', sets: ['masa ciała × 8 · RIR 3'] },
        ]}
        nextLabel="B1 · Spacer farmera"
        onNext={onNext}
      />,
    );
    expect(screen.getByText('Superseria zrobiona')).toBeTruthy();
    expect(screen.getByText('2. 6 kg × 11 · RIR 3')).toBeTruthy();
    expect(screen.getByText('B1 · Spacer farmera')).toBeTruthy();
    expect(onNext).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Następne ćwiczenie'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('says a single exercise is done', async () => {
    await render(
      <GroupDoneCard
        exercises={[{ name: 'Deska', sets: ['30 s'] }]}
        nextLabel="C1"
        onNext={jest.fn()}
      />,
    );
    expect(screen.getByText('Ćwiczenie zrobione')).toBeTruthy();
  });
});
