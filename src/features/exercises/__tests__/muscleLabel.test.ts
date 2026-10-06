import { muscleLabel, muscleLabels } from '../muscleLabel';

describe('muscleLabel', () => {
  it('translates a YMove muscle id', () => {
    expect(muscleLabel('pectoralis_major')).toBe('piersiowy większy');
  });

  it('reads "rear delts" and "rear_deltoids" as the same muscle', () => {
    expect(muscleLabel('rear delts')).toBe('tylne aktony barków');
    expect(muscleLabel('Rear-Deltoids')).toBe('tylne aktony barków');
  });

  it('shows an id it has no translation for as plain words rather than hiding it', () => {
    expect(muscleLabel('levator_scapulae')).toBe('levator scapulae');
  });
});

describe('muscleLabels', () => {
  it('drops repeats that arrive under two ids', () => {
    expect(muscleLabels(['rear_delts', 'rear_deltoids', 'triceps'])).toEqual([
      'tylne aktony barków',
      'triceps',
    ]);
  });
});
