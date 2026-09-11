/**
 * All user-facing copy lives here. The app is Polish-only by design
 * (single user), but keeping strings in one module means the UI code
 * stays free of hardcoded text and copy can be reviewed in one place.
 */
export const pl = {
  tabs: {
    today: 'Dziś',
    workout: 'Trening',
    body: 'Ciało',
    history: 'Historia',
    more: 'Więcej',
  },
  today: {
    title: 'Dziś',
    empty: 'Brak danych. Zacznij od zważenia się albo treningu.',
  },
  workout: {
    title: 'Trening',
  },
  body: {
    title: 'Ciało',
  },
  history: {
    title: 'Historia',
  },
  more: {
    title: 'Więcej',
    exercises: 'Ćwiczenia',
    bands: 'Gumy',
    templates: 'Szablony',
    backup: 'Eksport / Import',
    settings: 'Ustawienia',
  },
  exercises: {
    title: 'Ćwiczenia',
    empty: 'Baza ćwiczeń jest pusta.',
    countLabel: (n: number) => `${n} ${n === 1 ? 'ćwiczenie' : 'ćwiczeń'} w bazie`,
  },
  common: {
    loading: 'Ładowanie…',
    error: 'Coś poszło nie tak.',
  },
} as const;
