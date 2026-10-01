import { clauses, hasStem } from './text';

/**
 * Subjects the app does not advise on, whatever the user asks and whatever
 * a model might volunteer (AI-INTEGRACJA I4): what to eat, and anything
 * about the medication.
 */
export type OutOfScopeTopic = 'diet' | 'medication';

const MEDICATION = [
  'mounjaro',
  'tirzepat',
  'zepbound',
  'ozempic',
  'semaglut',
  'wegovy',
  'zastrzyk',
  'wstrzyk', // wstrzyknąłem, wstrzyknięcie
  'insulin',
  'recept',
];

/** "lek" is a stem of "lekki" and "lekarz"; only the drug forms count. */
const MEDICATION_EXACT = new Set(['lek', 'leku', 'leki', 'lekow', 'lekiem', 'lekach']);

/** "dawka" is a dose of the drug, or of training stimulus. A training word in the clause decides. */
const DOSE = ['dawk', 'dawkowa'];
const TRAINING_WORDS = ['trening', 'cwicz', 'bodz', 'seri'];

const DIET = [
  'kalor',
  'kcal',
  'bialk',
  'diet',
  'weglowodan',
  'posilk',
  'glodz',
  'jedzeni',
  'suplement',
  'odzywk',
  'kreatyn',
  'apetyt',
  'jadl', // jadłem, jadłam
];

const DIET_EXACT = new Set(['post', 'postu', 'poscie', 'jem', 'jesc']);

/**
 * Which out-of-scope subject a text touches, if any. Medication wins over
 * diet: it is the more sensitive of the two.
 */
export function detectOutOfScope(text: string): OutOfScopeTopic | null {
  let diet = false;
  for (const clause of clauses(text)) {
    const dose = hasStem(clause, DOSE) && !hasStem(clause, TRAINING_WORDS);
    if (dose || hasStem(clause, MEDICATION) || clause.some((t) => MEDICATION_EXACT.has(t))) {
      return 'medication';
    }
    if (hasStem(clause, DIET) || clause.some((t) => DIET_EXACT.has(t))) diet = true;
  }
  return diet ? 'diet' : null;
}
