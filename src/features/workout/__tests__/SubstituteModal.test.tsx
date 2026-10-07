import catalogue from '@data/exercises.json';
import { exerciseCatalogueSchema } from '@data/exercises.schema';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Exercise } from '@/domain/types';

import { SubstituteModal } from '../SubstituteModal';

const exercises = exerciseCatalogueSchema.parse(catalogue).exercises as Exercise[];
const exerciseMap = Object.fromEntries(exercises.map((e) => [e.id, e]));
const goblet = exerciseMap['goblet-squat']!;
const boxSquat = exerciseMap['box-squat']!;

function renderModal(patch: Partial<Parameters<typeof SubstituteModal>[0]> = {}) {
  const props = {
    visible: true,
    current: goblet,
    exerciseMap,
    profile: { knee: null },
    excludedIds: new Set<string>(),
    planned: true,
    onSelect: jest.fn(),
    onRestore: jest.fn(),
    onExclude: jest.fn(),
    onClose: jest.fn(),
    ...patch,
  };
  return { props, view: render(<SubstituteModal {...props} />) };
}

describe('SubstituteModal', () => {
  it('lists replacements with their main muscles', async () => {
    const { view } = renderModal();
    await view;
    expect(screen.getByText(boxSquat.name)).toBeTruthy();
    expect(screen.getAllByText(/czworogłowe/).length).toBeGreaterThan(0);
  });

  it('opens a preview on tap and swaps only from its button', async () => {
    const { props, view } = renderModal();
    await view;
    await fireEvent.press(screen.getByText(boxSquat.name));
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(screen.getByText(/Główne mięśnie:/)).toBeTruthy();

    await fireEvent.press(screen.getByText('‹ Wróć do listy'));
    expect(screen.getByText('Zamień ćwiczenie')).toBeTruthy();

    await fireEvent.press(screen.getByText(boxSquat.name));
    await fireEvent.press(screen.getByText('Zamień na to ćwiczenie'));
    expect(props.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ exercise: boxSquat, forBlock: true }),
    );
  });

  it('offers the way back to the planned exercise once swapped', async () => {
    const { props, view } = renderModal({ swappedTo: boxSquat });
    await view;
    expect(screen.getByText('Wróć do ćwiczenia z planu')).toBeTruthy();
    // The current swap is not offered again.
    expect(screen.queryByText(boxSquat.name)).toBeNull();
    await fireEvent.press(screen.getByText(goblet.name));
    expect(props.onRestore).toHaveBeenCalledTimes(1);
  });

  it('has no way back before any swap', async () => {
    const { view } = renderModal();
    await view;
    expect(screen.queryByText('Wróć do ćwiczenia z planu')).toBeNull();
  });
});
