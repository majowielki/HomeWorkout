import { BAND_CONFIG } from '@/domain/config/training';
import type { ExclusionCode } from '@/domain/exercises/screen';
import type { LoadEstimate } from '@/domain/progression/calibration';
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
    weightCard: 'Waga',
    noWeightYet: 'Jeszcze się nie ważyłeś.',
    logWeightToday: 'Zapisz dzisiejszą wagę',
    weightLoggedToday: (kg: number) => `Dziś: ${kg} kg`,
    average7: (kg: number) => `śr. 7 dni: ${kg} kg`,
    trend: (kgPerWeek: number) =>
      kgPerWeek === 0
        ? 'trend: stabilnie'
        : `trend: ${kgPerWeek > 0 ? '+' : ''}${kgPerWeek} kg/tydz.`,
    sessionCard: 'Trening',
    nextTemplate: (name: string) => `Następny: ${name}`,
    startNext: (name: string) => `Rozpocznij ${name}`,
    dailyCard: 'Dziennik dnia',
    dailyEmpty: 'Jak się dziś czujesz? Sen, energia, zakwasy — 10 sekund.',
    dailySummary: (sleep: number | null, energy: number | null, soreCount: number) =>
      [
        sleep !== null ? `sen ${String(sleep).replace('.', ',')} h` : null,
        energy !== null ? `energia ${energy}/5` : null,
        soreCount > 0 ? `zakwasy: ${soreCount}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Wpis zapisany.',
    fillDaily: 'Uzupełnij',
    editDaily: 'Edytuj',
  },
  workout: {
    title: 'Trening',
    resumeBanner: (templateName: string) => `Niedokończona sesja: ${templateName}`,
    resume: 'Wznów',
    discard: 'Porzuć',
    discardConfirmTitle: 'Porzucić sesję?',
    discardConfirmBody:
      'Zalogowane serie zostaną w historii jako sesja porzucona. Nie da się jej potem wznowić.',
    blockCount: (n: number) => `${n} ${n === 1 ? 'blok' : n >= 2 && n <= 4 ? 'bloki' : 'bloków'}`,
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
    cardio: {
      minutes: 'Minuty',
      resistance: 'Opór (skala roweru)',
      rpe: 'RPE',
      unset: '—',
      save: 'Zapisz',
    },
    session: {
      setOf: (n: number, total: number) => `seria ${n} / ${total}`,
      targetReps: (min: number, max: number) => `cel: ${min}–${max}`,
      targetTime: (sec: number) => `cel: ${sec} s`,
      /** Toggle on the first set of a block: log this as a warm-up, then do the working set. */
      warmupSet: 'Seria rozgrzewkowa',
      warmupSetHint: 'Rozgrzewkowa nie liczy się do objętości; po niej wracasz do tej samej serii.',
      saveWarmupSet: 'Zapisz rozgrzewkową',
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
      saddleHeight: (cm: number) =>
        `Siodełko: ${String(cm).replace('.', ',')} cm — sprawdź przed jazdą.`,
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
      setsLogged: (n: number) =>
        `${n} ${n === 1 ? 'seria zalogowana' : n >= 2 && n <= 4 ? 'serie zalogowane' : 'serii zalogowanych'}`,
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
    weightSection: 'Waga',
    weightInputLabel: 'Dzisiejsza waga (kg)',
    weightSave: 'Zapisz',
    weightSavedToday: 'Zapisano na dziś. Możesz poprawić — nadpisze wpis.',
    chartTitle: 'Ostatnie 60 dni',
    chartLegend: 'kropki = wpisy · linia = średnia 7-dniowa',
    chartEmpty: 'Wykres pojawi się po 3 wpisach.',
    noTrendYet: 'Trend pojawi się po ~10 wpisach w ciągu 3 tygodni.',
    measurementsLink: 'Obwody',
    measurementsHint: 'Talia, biodra, klatka, ramię, udo, szyja',
    dailyLink: 'Dziennik dnia',
    dailyHint: 'Sen, energia, stres, zakwasy',
    invalidWeight: 'Podaj wagę między 30 a 300 kg.',
  },
  measurements: {
    title: 'Obwody',
    intro: 'Mierz zawsze tak samo: rano, na czczo, taśma płasko, bez wciągania brzucha.',
    waist: 'Talia (cm)',
    hips: 'Biodra (cm)',
    chest: 'Klatka (cm)',
    arm: 'Ramię (cm)',
    thigh: 'Udo (cm)',
    neck: 'Szyja (cm)',
    save: 'Zapisz obwody',
    saved: 'Zapisano.',
    lastEntry: (date: string) => `Ostatni pomiar: ${date}`,
    navyTitle: 'Szacowany % tkanki tłuszczowej (wzór US Navy)',
    navyValue: (pct: number) => `≈ ${pct} %`,
    navyMissingProfile: 'Uzupełnij wzrost i płeć w Ustawieniach, żeby policzyć.',
    navyMissingInputs: 'Potrzebne: talia, szyja (i biodra dla kobiet).',
    navyCaveat: '±3–4 p.p. Patrz na trend, nie na liczbę.',
    waistChartTitle: 'Talia — ostatnie 90 dni',
    waistChartEmpty: 'Wykres talii pojawi się po 2 pomiarach.',
    invalid: 'Wartości muszą być między 20 a 250 cm.',
  },
  daily: {
    title: 'Dziennik dnia',
    sleep: 'Sen (godziny)',
    energy: 'Energia',
    stress: 'Stres',
    soreness: 'Zakwasy (DOMS)',
    sorenessHint: 'Stuknij: brak → lekkie → mocne.',
    sorenessMild: 'lekko',
    sorenessStrong: 'mocno',
    note: 'Notatka',
    notePlaceholder: 'Cokolwiek istotnego…',
    save: 'Zapisz',
    saved: 'Zapisano.',
    scaleLow: '1 = fatalnie',
    scaleHigh: '5 = świetnie',
    stressLow: '1 = spokój',
    stressHigh: '5 = ciężko',
  },
  settings: {
    title: 'Ustawienia',
    profileSection: 'Profil',
    heightCm: 'Wzrost (cm)',
    birthYear: 'Rok urodzenia',
    sex: 'Płeć',
    sexMale: 'mężczyzna',
    sexFemale: 'kobieta',
    dayBoundaryHour: 'Granica doby treningowej (godzina)',
    dayBoundaryHint: 'Trening o 00:40 przy granicy 4:00 liczy się do poprzedniego dnia.',
    saddleHeightCm: 'Wysokość siodełka (cm)',
    saddleHint: 'Ustaw raz i nie zmieniaj — ma znaczenie dla kolana.',
    kneeSection: 'Profil kolana',
    physioApproved: 'Lista ćwiczeń zaakceptowana przez fizjoterapeutę',
    physioApprovedHint:
      'Odblokowuje ćwiczenia jednonóż z podparciem (split squat, wykrok w tył, wejście na stopień, kickback). Włącz dopiero po realnej konsultacji.',
    remindersSection: 'Przypomnienia',
    weightReminder: 'Waga codziennie',
    workoutReminder: 'Trening, gdy minie',
    afterDays: (n: number) => `${n} ${n === 1 ? 'dzień' : 'dni'}`,
    time: 'o godzinie',
    muteWeek: 'Wycisz na 7 dni',
    mutedUntil: (date: string) => `Wyciszone do ${date}`,
    unmute: 'Włącz z powrotem',
    save: 'Zapisz ustawienia',
    saved: 'Zapisano.',
    invalidProfile: 'Sprawdź wartości: wzrost 100–250, rok 1900–2020, godzina 0–23.',
  },
  reminders: {
    weightTitle: 'Waga',
    weightBody: 'Zważ się, zanim zjesz — jeden wpis, 10 sekund.',
    workoutTitle: 'Trening',
    workoutBody: (daysAgo: number) =>
      `Ostatni trening był ${daysAgo} ${daysAgo === 1 ? 'dzień' : 'dni'} temu. Kolejna sesja czeka, kiedy będziesz gotowy.`,
  },
  history: {
    title: 'Historia',
    empty: 'Jeszcze nic tu nie ma. Pierwsza zakończona sesja pojawi się na liście.',
    noTemplate: 'bez szablonu',
    ride: 'Rower',
    rideMeta: (minutes: number, resistance: number | null, rpe: number | null) =>
      [
        `${minutes} min`,
        resistance !== null ? `opór ${resistance}` : null,
        rpe !== null ? `RPE ${rpe}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    deleteRideTitle: 'Usunąć jazdę?',
    deleteRideBody: 'Wpis roweru zniknie z historii. Tego nie da się cofnąć.',
    status: {
      in_progress: 'w trakcie',
      abandoned: 'porzucona',
    },
    sets: (n: number) => `${n} ${n === 1 ? 'seria' : n >= 2 && n <= 4 ? 'serie' : 'serii'}`,
    minutes: (n: number) => `${n} min`,
    rpe: (n: number) => `RPE ${n}`,
    detail: {
      notFound: 'Nie znaleziono treningu.',
      notes: 'Notatka',
      noSets: 'Brak zalogowanych serii.',
      editHint: 'Stuknij serię, żeby ją poprawić lub usunąć.',
      warmup: 'rozgrzewka',
      bike: 'Rower',
      bikePurpose: { warmup: 'rozgrzewka', cardio: 'jazda' } as const,
      deleteWorkout: 'Usuń trening',
      deleteWorkoutTitle: 'Usunąć trening?',
      deleteWorkoutBody: 'Sesja i wszystkie jej serie znikną z historii. Tego nie da się cofnąć.',
      delete: 'Usuń',
    },
    setEdit: {
      title: 'Edytuj serię',
      notFound: 'Nie znaleziono serii.',
      setNumber: (n: number) => `seria #${n}`,
      save: 'Zapisz zmiany',
      delete: 'Usuń serię',
      deleteTitle: 'Usunąć serię?',
      deleteBody: 'Seria zniknie z historii. Tego nie da się cofnąć.',
    },
    set: {
      /** Pieces of a one-line set description, e.g. "14 kg × 12 · RIR 2". */
      reps: (n: number) => `× ${n}`,
      seconds: (n: number) => `${n} s`,
      kg: (n: number) => `${n} kg`,
      band: (label: string, position: number) => `${label} P${position}`,
      bodyweight: 'masa ciała',
      /** The stored estimate is the top of the calibrated range, never a point value. */
      peakKg: (n: number) => `(do ≈ ${n} kg)`,
      rir: (n: number) => `RIR ${n}`,
    },
  },
  bands: {
    title: 'Gumy',
    intro:
      'Kalibracja zamienia kolor gumy na kilogramy. Robisz ją raz na gumę, z jednym gryfem i miarką.',
    nominal: (min: number, max: number) => `nominalnie ${min}–${max} kg`,
    notCalibrated: 'nieskalibrowana',
    calibrated: (maxKg: number, date: string) => `skalibrowana do ${maxKg} kg · ${date}`,
    noFit: 'zmierzona, bez dopasowania',
    fitLinear: 'dopasowanie liniowe',
    fitQuadratic: 'dopasowanie kwadratowe',
    cycles: (n: number) => `${n} cykli`,
    recalibrate: 'Czas na ponowną kalibrację (zużycie lub wiek).',
    positionsHint: (stepCm: number) =>
      `Pozycje P0–P3: taśma na podłodze co ${stepCm} cm od punktu, w którym guma jest ledwo napięta.`,
    /** Load range shown next to a band choice. Never a decimal, never past the calibrated maximum. */
    estimate: (e: LoadEstimate) =>
      e.kind === 'above'
        ? `> ${e.maxMeasuredKg} kg`
        : e.kind === 'range'
          ? e.minKg === e.maxKg
            ? `≈ ${e.maxKg} kg`
            : `≈ ${e.minKg}–${e.maxKg} kg`
          : '',
    wizard: {
      title: (label: string) => `Kalibracja: ${label}`,
      stepRest: 'Krok 1 — długość spoczynkowa',
      restHint:
        'Rozłóż gumę luźno i zmierz jej długość (cm). Przy pętli mierz całą pętlę tak, jak będziesz ją zawieszać.',
      restLabel: 'L0 (cm)',
      next: 'Dalej',
      stepPoints: 'Krok 2 — podwieszaj masy',
      pointsHint:
        'Zawieś gumę, podwieś gryf z obciążeniem i zmierz długość. Kolejne masy z drabinki; przerwij, gdy guma przestaje się wydłużać.',
      lengthFor: (kg: number) => `${kg} kg → długość (cm)`,
      addPoint: 'Zapisz pomiar',
      plateau: `Ostatni przyrost poniżej ${BAND_CONFIG.minLengthStepCm} cm — więcej masy niewiele powie. Możesz zakończyć.`,
      pointsSoFar: (n: number) =>
        `${n} ${n === 1 ? 'pomiar' : n >= 2 && n <= 4 ? 'pomiary' : 'pomiarów'}`,
      removeLast: 'Cofnij ostatni',
      back: 'Wróć do pomiarów',
      finish: 'Zakończ i dopasuj',
      stepResult: 'Krok 3 — wynik',
      reason: {
        FIT_LINEAR: 'Siła rośnie liniowo z rozciągnięciem — dopasowanie liniowe.',
        FIT_QUADRATIC: 'Siła rośnie coraz szybciej — dopasowanie kwadratowe.',
        TOO_FEW_POINTS: `Za mało pomiarów na dopasowanie (potrzeba ${BAND_CONFIG.minCalibrationPoints}). Pomiary zostaną zapisane, kilogramów nie będzie.`,
        NO_STRETCH:
          'Guma nie wydłuża się mierzalnie przy dostępnych masach. Kalibracja nie jest możliwa — to normalne dla zielonej. Silnik pracuje na pozycjach P0–P3.',
      },
      r2: (r2: number) => `R² = ${r2.toFixed(3)}`,
      maxMeasured: (kg: number) => `Zmierzona do ${kg} kg — powyżej aplikacja pokaże „> ${kg} kg”.`,
      preview: (romCm: number) => `Podgląd przy zakresie ruchu ${romCm} cm`,
      previewRow: (position: number, text: string) => `P${position}: ${text || '—'}`,
      save: 'Zapisz kalibrację',
      saved: 'Zapisano.',
      invalidRest: 'Podaj długość spoczynkową między 20 a 300 cm.',
      invalidLength: 'Długość musi być liczbą nie mniejszą niż L0.',
      notFound: 'Nie znaleziono gumy.',
    },
  },
  backup: {
    title: 'Eksport / Import',
    shareTitle: 'Zapisz kopię HomeWorkout',
    exportSection: 'Eksport',
    exportHint:
      'Cały dziennik — treningi, serie, waga, obwody, dziennik dnia, ustawienia — w jednym pliku JSON. Zapisz go na Dysku albo wyślij sobie mailem.',
    exportButton: 'Eksportuj do pliku',
    exporting: 'Przygotowuję plik…',
    exported: (name: string) => `Gotowe: ${name}`,
    importSection: 'Import',
    importHint:
      'Przywraca dane z pliku eksportu. Obecny stan zostaje nadpisany — ale najpierw aplikacja sama zapisze jego kopię (lista poniżej).',
    importButton: 'Importuj z pliku',
    importing: 'Importuję…',
    confirmTitle: 'Nadpisać dane?',
    confirmBody: (file: string, workouts: number, sets: number, weights: number) =>
      `Plik ${file}: ${workouts} treningów, ${sets} serii, ${weights} wpisów wagi. Wszystko, co masz teraz, zostanie zastąpione.`,
    confirmAction: 'Nadpisz',
    imported: (safety: string) => `Zaimportowano. Kopia poprzedniego stanu: ${safety}`,
    safetySection: 'Kopie sprzed importu',
    safetyHint: 'Zapisywane automatycznie przed każdym importem. Zostaje pięć ostatnich.',
    safetyEmpty: 'Jeszcze żadnej.',
    restore: 'Przywróć',
    restoreTitle: 'Przywrócić tę kopię?',
    restoreBody: 'Obecny stan zostanie nadpisany (i też zapisany jako kopia).',
    sizeKb: (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`,
    errors: {
      not_json: 'To nie jest plik JSON.',
      not_a_backup: 'To nie jest plik eksportu HomeWorkout.',
      newer_version: 'Plik pochodzi z nowszej wersji aplikacji. Zaktualizuj aplikację.',
      invalid: 'Plik jest uszkodzony lub niekompletny.',
      unknownExercises: (ids: string[]) =>
        `Plik odwołuje się do ćwiczeń, których nie ma w tej wersji: ${ids.join(', ')}.`,
    },
  },
  more: {
    title: 'Więcej',
    exercises: 'Ćwiczenia',
    bands: 'Gumy',
    templates: 'Szablony',
    backup: 'Eksport / Import',
    settings: 'Ustawienia',
    glossary: 'Słownik pojęć',
    comingSoon: 'Szablony dojdą w następnych kamieniach.',
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
  notifications: {
    restChannel: 'Koniec przerwy',
    restTitle: 'Koniec przerwy',
    reminderChannel: 'Przypomnienia',
  },
  a11y: {
    decrement: (label: string) => `Zmniejsz: ${label}`,
    increment: (label: string) => `Zwiększ: ${label}`,
    noPhoto: 'Brak zdjęcia',
  },
  common: {
    loading: 'Ładowanie…',
    error: 'Coś poszło nie tak.',
    notFound: 'Nie znaleziono.',
    cancel: 'Anuluj',
    close: 'Zamknij',
    today: 'dziś',
    yesterday: 'wczoraj',
  },
  glossary: {
    title: 'Słownik pojęć',
    trigger: 'Co oznaczają te skróty?',
    terms: [
      {
        term: 'FBW A / FBW B',
        definition:
          'Full Body Workout — trening całego ciała w jednej sesji. A i B to dwa warianty tego samego szablonu, na przemian: po A zawsze proponujemy B, i odwrotnie, żeby te same partie mięśniowe pracowały nieco inaczej między sesjami.',
      },
      {
        term: 'RIR',
        definition:
          'Reps In Reserve (powtórzenia w zapasie) — ile powtórzeń mógłbyś jeszcze wykonać w danej serii, zanim doszedłbyś do odmowy mięśniowej. RIR 2 oznacza „zostały mi jeszcze 2 powtórzenia”. Im niższe RIR, tym bliżej maksimum.',
      },
      {
        term: 'RPE',
        definition:
          'Rate of Perceived Exertion (odczuwany wysiłek) — subiektywna ocena w skali 1–10, jak ciężka była cała sesja. 10 to maksymalny możliwy wysiłek.',
      },
      {
        term: 'DOMS',
        definition:
          'Delayed Onset Muscle Soreness (opóźniona bolesność mięśni) — zakwasy, które pojawiają się zwykle 24–72 godziny po treningu, a nie od razu po nim.',
      },
      {
        term: 'ACL',
        definition:
          'Anterior Cruciate Ligament (więzadło krzyżowe przednie) — jedno z głównych więzadeł stabilizujących kolano. Jego stan (np. po rekonstrukcji) wpływa na to, które ćwiczenia są dla Ciebie bezpieczne.',
      },
    ],
  },
} as const;
