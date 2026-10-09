import type { Exercise } from '../types';
export type Unit = 'reps' | 'sec';

export function unitOf(exercise: Pick<Exercise, 'forceProfile'>): Unit {
  return exercise.forceProfile === 'Isometric' ? 'sec' : 'reps';
}
