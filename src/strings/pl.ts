import type { ExclusionCode } from '@/domain/exercises/screen';
import type {
  BandSuitability,
  Equipment,
  MovementPattern,
  MuscleGroup,
  Plane,
  Stance,
} from '@/domain/types';

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
    resumeBanner: (templateName: string) => `Niedokończona sesja: ${templateName}`,
    resume: 'Wznów',
    discard: 'Porzuć',
    start: 'Rozpocznij',
    suggested: 'Sugerowane',
    lastSession: (daysAgo: number) =>
      daysAgo === 0
        ? 'Ostatnia sesja: dziś'
        : daysAgo === 1
          ? 'Ostatnia sesja: wczoraj'
          : `Ostatnia sesja: ${daysAgo} dni temu`,
    noSessionsYet: 'Brak sesji w historii — zacznij od dowolnego szablonu.',
    quickCardio: 'Szybki log: rower',
    quickCardioLogged: 'Zapisano jazdę.',
    session: {
      setOf: (n: number, total: number) => `seria ${n} / ${total}`,
      dumbbellSingle: 'Hantel (jeden gryf)',
      dumbbellPaired: 'Hantle (para)',
      band: 'Guma',
      anchorPosition: 'Pozycja',
      reps: 'Powtórzenia',
      time: 'Czas',
      saveSet: 'Zapisz serię',
      restLabel: 'Przerwa',
      restExtend: '+30 s',
      restSkip: 'Pomiń',
      restNotificationBody: 'Wracaj do treningu — czas na kolejną serię.',
      upNext: 'Następne',
      warmupTitle: 'Rozgrzewka',
      warmupDescription: 'Kilka minut na rowerze przed pierwszą serią.',
      minutes: 'Minuty',
      warmupLog: 'Zapisano, zaczynamy',
      warmupSkip: 'Pomiń rozgrzewkę',
      substituteTitle: 'Zamień ćwiczenie',
      noSubstitutes: 'Brak dostępnych zamienników dla Twojego profilu.',
      progressTitle: 'Postęp sesji',
      finishEarly: 'Zakończ',
      notFound: 'Nie znaleziono treningu.',
    },
    summary: {
      title: 'Podsumowanie',
      duration: (minutes: number) => `${minutes} min`,
      setsLogged: (n: number) => `${n} ${n === 1 ? 'seria' : 'serii'} zalogowanych`,
      previousComparison: (daysAgo: number, previousSets: number, currentSets: number) =>
        `Poprzednia sesja tego szablonu: ${daysAgo} ${daysAgo === 1 ? 'dzień' : 'dni'} temu, ${previousSets} serii (dziś: ${currentSets}).`,
      noPrevious: 'To pierwsza sesja tego szablonu w historii.',
      sessionRpe: 'Jak ciężko było całościowo? (RPE)',
      notes: 'Notatka (opcjonalnie)',
      notesPlaceholder: 'Coś ważnego z dzisiejszej sesji…',
      finish: 'Zakończ trening',
    },
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
    comingSoon:
      'Kolejne pozycje (gumy, szablony, backup, ustawienia) dojdą w następnych kamieniach.',
  },
  exercises: {
    title: 'Ćwiczenia',
    empty: 'Baza ćwiczeń jest pusta.',
    countLabel: (n: number, excluded: number) =>
      `${n} ${n === 1 ? 'ćwiczenie' : 'ćwiczeń'} w bazie` +
      (excluded > 0 ? ` · ${excluded} wykluczone dla Twojego profilu` : ''),
    kneeFlag: 'Obciąża kolano',
    excluded: 'Wykluczone',
    pendingPhysio: 'Po akceptacji fizjoterapeuty',
    sections: {
      cues: 'Jak wykonać',
      kneeCue: 'Kolano',
      muscles: 'Partie mięśniowe',
      primary: 'główne',
      secondary: 'pomocnicze',
      equipment: 'Sprzęt',
      biomechanics: 'Biomechanika',
      substitutes: 'Zamienniki',
      whyExcluded: 'Dlaczego wykluczone',
      noMedia: 'Brak zdjęcia — opis poniżej.',
    },
    biomechanics: {
      pattern: 'Wzorzec',
      planes: 'Płaszczyzny',
      chain: 'Łańcuch',
      closedChain: 'zamknięty',
      openChain: 'otwarty',
      stance: 'Podparcie',
      bandFit: 'Dopasowanie gumy',
    },
  },
  labels: {
    pattern: {
      Squat: 'Przysiad',
      Hinge: 'Zawias biodrowy',
      Lunge: 'Wykrok',
      Push: 'Pchanie',
      Pull: 'Przyciąganie',
      Carry: 'Noszenie',
      Isolation: 'Izolacja',
      Core: 'Core',
      Cardio: 'Cardio',
      Mobility: 'Mobilność',
    } satisfies Record<MovementPattern, string>,
    muscle: {
      quads: 'czworogłowe',
      hamstrings: 'dwugłowe uda',
      glutes: 'pośladki',
      calves: 'łydki',
      chest: 'klatka',
      back: 'plecy',
      lats: 'najszersze',
      shoulders: 'barki',
      biceps: 'biceps',
      triceps: 'triceps',
      core: 'core',
      forearms: 'przedramiona',
    } satisfies Record<MuscleGroup, string>,
    equipment: {
      dumbbell: 'hantle',
      band: 'guma',
      mat: 'karimata',
      bike: 'rower',
      bodyweight: 'masa ciała',
    } satisfies Record<Equipment, string>,
    plane: {
      Sagittal: 'strzałkowa',
      Frontal: 'czołowa',
      Transverse: 'poprzeczna',
    } satisfies Record<Plane, string>,
    stance: {
      Bilateral: 'obunóż',
      UnilateralSupported: 'jednonóż z podparciem',
      UnilateralUnsupported: 'jednonóż bez podparcia',
      Seated: 'siedząc',
      Prone: 'w podporze / na brzuchu',
      Supine: 'na plecach',
    } satisfies Record<Stance, string>,
    bandSuitability: {
      excellent: 'świetne — opór rośnie tam, gdzie jesteś najsilniejszy',
      ok: 'neutralne',
      poor: 'słabe — guma jest najcięższa w najsłabszym punkcie',
    } satisfies Record<BandSuitability, string>,
    dumbbellMode: {
      paired: 'dwa hantle (do 10 kg na rękę)',
      single: 'jeden hantel (do 18 kg)',
    },
  },
  exclusion: {
    KNEE_FRONTAL_PLANE:
      'Ruch w płaszczyźnie czołowej obciąża kolano bocznie — brak więzadeł pobocznych tego nie zatrzyma.',
    KNEE_TRANSVERSE_PLANE:
      'Rotacja pod obciążeniem tworzy moment skrętny na przeszczep ACL bez wsparcia stabilizatorów bocznych.',
    KNEE_VALGUS_VARUS: 'Ćwiczenie wprost prowokuje ucieczkę kolana do wewnątrz lub na zewnątrz.',
    KNEE_UNILATERAL_UNSUPPORTED:
      'Cała masa na jednej nodze bez podparcia — ekstremalne zapotrzebowanie na stabilizację, której kolano nie ma pasywnie.',
    KNEE_UNILATERAL_PENDING_PHYSIO:
      'Praca jednonóż z podparciem. Odblokuje się po akceptacji listy przez fizjoterapeutę (Ustawienia → profil kolana).',
    KNEE_PLYOMETRIC:
      'Wyskoki i lądowania wielokrotnie zwiększają siły ścinające na zrekonstruowane struktury.',
    KNEE_OPEN_CHAIN_QUAD:
      'Otwarty łańcuch na czworogłowy: maksymalna przednia siła ścinająca na przeszczep ACL w zakresie 0–30°, bez ko-kontrakcji dwugłowych.',
  } satisfies Record<ExclusionCode, string>,
  common: {
    loading: 'Ładowanie…',
    error: 'Coś poszło nie tak.',
    notFound: 'Nie znaleziono.',
    cancel: 'Anuluj',
  },
} as const;
