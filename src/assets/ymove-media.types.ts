export type YmoveDifficulty = 'beginner' | 'intermediate' | 'advanced';

/** What YMove's API returns about an exercise, minus the fields the app does not show. */
export interface YmoveInfo {
  title: string;
  /** Null when YMove has not graded the exercise (about one in six). */
  difficulty: YmoveDifficulty | null;
  /** The broad group YMove files the exercise under, e.g. "chest". */
  muscleGroup: string;
  /** Finer-grained muscles including the primary ones, e.g. "pectoralis_major". */
  muscleGroups: string[];
  /** Supporting muscles, in YMove's own (English) vocabulary. */
  secondaryMuscles: string[];
  exerciseType: string[];
  /** Numbered steps, in English. */
  instructions: string[];
  /** Coaching tips, in English. */
  importantPoints: string[];
  /** Polish translation of the two lists above, when one was written. */
  pl?: { instructions: string[]; importantPoints: string[] };
}

export interface YmoveEntry {
  /** Metro asset id of the looping demonstration clip. */
  video: number;
  /** Metro asset id of the SVG that shades the muscles worked. */
  bodyMap: number;
  info: YmoveInfo;
}
