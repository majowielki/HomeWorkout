import { BAND_CONFIG } from '@/domain/config/training';
import type { ToolName } from '@/ai/contract/chatTools';
import type { SignalCode } from '@/domain/coach/vocabulary';
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
    greeting: (hour: number) =>
      hour < 5 ? 'Dobranoc' : hour < 12 ? 'Dzień dobry' : hour < 18 ? 'Cześć' : 'Dobry wieczór',
    nextSessionEyebrow: 'Następny trening',
    inProgressEyebrow: 'Sesja w trakcie',
    loggedToday: 'zapisano dziś',
    average7Label: 'Średnia 7 dni',
    trendLabel: 'Trend',
    trendValue: (kgPerWeek: number) =>
      kgPerWeek === 0
        ? 'stabilnie'
        : `${kgPerWeek > 0 ? '+' : ''}${String(kgPerWeek).replace('.', ',')} kg/tydz.`,
    kg: 'kg',
    sleepLabel: 'Sen',
    energyLabel: 'Energia',
    sorenessLabel: 'Zakwasy',
    hours: (h: number) => `${String(h).replace('.', ',')} h`,
    outOfFive: (n: number) => `${n}/5`,
    noValue: '—',
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
    quickCardioHint: 'Jazda poza sesją — najbezpieczniejsza objętość dla nóg',
    templatesEyebrow: 'Szablony',
    moreExercises: (n: number) => `+${n}`,
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
    trackingEyebrow: 'Pomiary',
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
    emptyTitle: 'Czysta karta',
    entries: (n: number) =>
      `${n} ${n === 1 ? 'wpis' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'wpisy' : 'wpisów'}`,
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
  coach: {
    title: 'Trener',
    intro:
      'Eksperyment. Aplikacja składa z Twojego dziennika zwięzły brief z ostatnich czterech tygodni. Wklej go razem z promptem do Gemini albo innego modelu i sprawdź, czy odpowiedzi są konkretne i czy cokolwiek zmieniają. Nic nie jest wysyłane automatycznie.',
    loading: 'Składam brief…',
    loadError: 'Nie udało się złożyć briefu.',
    briefEyebrow: 'Brief',
    summary: (sessions: number, weighIns: number, notes: number) =>
      `${sessions} ${sessions === 1 ? 'sesja' : sessions >= 2 && sessions <= 4 ? 'sesje' : 'sesji'} · ${weighIns} ${weighIns === 1 ? 'ważenie' : weighIns >= 2 && weighIns <= 4 ? 'ważenia' : 'ważeń'} · ${notes} ${notes === 1 ? 'notatka' : notes >= 2 && notes <= 4 ? 'notatki' : 'notatek'}`,
    size: (chars: number) => `${chars.toLocaleString('pl-PL')} znaków`,
    sparse: 'Mało danych. Prompt każe modelowi nie mówić o trendach, dopóki nie ma więcej sesji.',
    omittedMedical: (n: number) =>
      `Pominięto ${n} ${n === 1 ? 'notatkę' : n >= 2 && n <= 4 ? 'notatki' : 'notatek'}, które wspominają o bólu lub urazie. Nie trafiają do briefu.`,
    omittedScope: (n: number) =>
      `Pominięto ${n} ${n === 1 ? 'notatkę' : n >= 2 && n <= 4 ? 'notatki' : 'notatek'} o diecie lub leku. Aplikacja w tych sprawach nie doradza.`,
    howToEyebrow: 'Jak użyć',
    howTo:
      'Skopiuj prompt i brief jednym przyciskiem, wklej do rozmowy z modelem i przeczytaj odpowiedź. Przez dwa tygodnie notuj, czy powiedziała Ci coś, czego nie widać na wykresach.',
    copyAll: 'Kopiuj prompt i brief',
    copyPrompt: 'Kopiuj prompt',
    copyBrief: 'Kopiuj brief',
    copied: 'Skopiowano',
    copyFailed: 'Nie udało się skopiować.',
    chatEntry: 'Porozmawiaj z trenerem',
    chatEntryHint: 'Pytania o Twoje dane, odpowiedź pojawia się na żywo',
    viewPayload: 'Co dokładnie wysyłam',
    viewPayloadHint: 'Pełna treść briefu, przed skopiowaniem',
    payloadTitle: 'Co wysyłam',
    payloadIntro:
      'To są wszystkie Twoje dane, jakie widzi model. Obok nich dostaje stały prompt z zasadami (przycisk „Kopiuj prompt”). Nie ma tu imienia, daty urodzenia ani diagnozy: kolano opisują kody ograniczeń. Notatki o bólu, diecie i leku są pominięte.',
    /** Names for the signal codes the model may flag. Typed so a new code cannot be forgotten. */
    signals: {
      SPARSE_HISTORY: 'Mało danych',
      LAYOFF_SHORT: 'Krótka przerwa',
      LAYOFF_MEDIUM: 'Przerwa',
      LAYOFF_LONG: 'Długa przerwa',
      SLEEP_LOW_STREAK: 'Krótki sen',
    } satisfies Record<SignalCode, string>,
    chat: {
      title: 'Rozmowa z trenerem',
      intro:
        'Pytaj o to, co widać w dzienniku: serie, postępy w ćwiczeniach, objętość, waga. Model sam sprawdza dane na Twoim telefonie i niczego nie zmienia w planie. Nie doradza w sprawie diety, leków ani dolegliwości.',
      placeholder: 'Zadaj pytanie o swój trening',
      send: 'Wyślij',
      stop: 'Stop',
      newChat: 'Nowa rozmowa',
      you: 'Ty',
      coach: 'Trener',
      empty:
        'Na przykład: „Jak mi idzie z wiosłowaniem?” albo „Ile serii na plecy zrobiłem w tym tygodniu?”',
      disclaimer:
        'To komentarz do liczb z dziennika, nie plan ani porada. Obciążenia ustala wyłącznie silnik reguł.',
      counter: (used: number, max: number) => `${used}/${max}`,
      /** What the app says while the model looks something up. Typed so a new tool cannot be forgotten. */
      tools: {
        getRecentSessions: 'Sprawdzam ostatnie sesje…',
        getExerciseHistory: 'Sprawdzam historię ćwiczenia…',
        getWeeklyVolume: 'Liczę serie z tygodnia…',
        getBodyTrend: 'Sprawdzam wagę i talię…',
        findExercises: 'Szukam ćwiczenia…',
      } satisfies Record<ToolName, string>,
      /** The app's own replies, when it does not ask the model at all. */
      blocked: {
        medical: 'Dolegliwości omów z fizjoterapeutą lub lekarzem.',
        outOfScope: 'Aplikacja nie doradza w sprawie diety ani leków. Zapytaj mnie o trening.',
        tooLong: (max: number) => `Wiadomość jest za długa. Limit to ${max} znaków.`,
        empty: 'Napisz najpierw pytanie.',
      },
      withheld:
        'Ta odpowiedź nie przeszła kontroli aplikacji, więc jej nie pokazuję. Spróbuj zadać pytanie inaczej. Szczegóły są w diagnostyce.',
      truncated: 'Odpowiedź została ucięta.',
      interrupted: 'Odpowiedź została przerwana.',
      stopped: 'Zatrzymano.',
      retry: 'Spróbuj ponownie',
      errors: {
        toolLimit: 'Model za długo szukał danych i nie zdążył odpowiedzieć. Spróbuj prościej.',
        emptyReply: 'Model nie odpowiedział niczym. Spróbuj jeszcze raz.',
      },
    },
    ai: {
      eyebrow: 'Podsumowanie od modelu',
      disabled:
        'Funkcje AI są wyłączone, więc aplikacja nic nigdzie nie wysyła. Włącz je w Ustawieniach, jeśli chcesz poprosić model o podsumowanie.',
      notConfigured:
        'Serwer AI nie jest skonfigurowany. Ustaw EXPO_PUBLIC_COACH_URL i EXPO_PUBLIC_COACH_SECRET w .env.local i zbuduj aplikację od nowa. Brief do ręcznego wklejenia działa bez tego.',
      ask: 'Poproś o podsumowanie',
      asking: 'Model pisze podsumowanie…',
      cancel: 'Anuluj',
      again: 'Poproś ponownie',
      retry: 'Spróbuj ponownie',
      flagsTitle: 'Na co zwrócić uwagę',
      questionsTitle: 'Pytania na następny raz',
      repaired: 'Pierwsza odpowiedź nie przeszła kontroli, ta jest poprawiona.',
      disclaimer:
        'To komentarz do liczb z dziennika, nie plan ani porada. Obciążenia ustala wyłącznie silnik reguł.',
      meta: (model: string, tokens: number, seconds: number) =>
        `${model} · ${tokens.toLocaleString('pl-PL')} tokenów · ${seconds.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} s`,
      errors: {
        offline: 'AI niedostępne: brak połączenia z serwerem. Reszta aplikacji działa bez zmian.',
        timeout: 'Model nie odpowiedział na czas.',
        rateLimited: 'Za dużo zapytań w ostatniej minucie. Spróbuj za chwilę.',
        upstream: 'Dostawca modelu nie odpowiada.',
        invalidOutput:
          'Nie udało się ułożyć podsumowania: model dwa razy odpowiedział nie tak, jak trzeba. Szczegóły są w diagnostyce.',
        budget: 'Limit na dziś wyczerpany. Wróć jutro.',
        unauthorized: 'Serwer odrzucił klucz aplikacji. Sprawdź konfigurację.',
        contractMismatch: 'Aplikacja i serwer są w różnych wersjach. Zaktualizuj aplikację.',
        misconfigured: 'Serwer jest źle skonfigurowany: brakuje klucza dostawcy albo modelu.',
        incompatible: 'Serwer odpowiedział czymś, czego ta wersja aplikacji nie rozumie.',
      },
      settings: {
        section: 'Funkcje AI',
        toggle: 'Trener AI',
        toggleHint:
          'Wyłączone: aplikacja nic nigdzie nie wysyła i działa jak zawsze. Włączone: zwięzły brief (zobacz „Co wysyłam”) trafia na Twój serwer tylko wtedy, gdy o to poprosisz.',
        configured: 'Serwer: skonfigurowany',
        notConfigured: 'Serwer: nieskonfigurowany',
        diagnostics: 'Diagnostyka AI',
        diagnosticsHint: 'Ostatnie wymiany z pełną treścią, tylko na tym telefonie',
      },
    },
    diagnostics: {
      title: 'Diagnostyka AI',
      intro:
        'Ostatnie wymiany z serwerem, z pełną treścią. Zapisane tylko na tym telefonie; serwer trzyma wyłącznie metadane.',
      empty: 'Jeszcze żadnej wymiany.',
      clear: 'Wyczyść historię',
      clearTitle: 'Wyczyścić historię AI?',
      clearBody: 'Usuwa zapisane wymiany z tego telefonu. Dziennik treningowy zostaje.',
      request: 'Wysłano',
      response: 'Odpowiedź',
      show: 'Pokaż',
      hide: 'Ukryj',
      line: (tokensIn: number | null, tokensOut: number | null, ms: number | null) =>
        [
          tokensIn !== null && tokensOut !== null ? `${tokensIn}+${tokensOut} tokenów` : null,
          ms !== null
            ? `${(ms / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} s`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
    },
  },
  more: {
    title: 'Więcej',
    coach: 'Trener',
    coachHint: 'Brief do wklejenia w modelu (eksperyment)',
    exercises: 'Ćwiczenia',
    bands: 'Gumy',
    templates: 'Szablony',
    backup: 'Eksport / Import',
    settings: 'Ustawienia',
    glossary: 'Słownik pojęć',
    comingSoon: 'Szablony dojdą w następnych kamieniach.',
    libraryEyebrow: 'Biblioteka',
    appEyebrow: 'Aplikacja',
    exercisesHint: 'Baza ruchów, zdjęcia, wykluczenia',
    bandsHint: 'Kalibracja gum i pozycje kotwicy',
    backupHint: 'Kopia całego dziennika w pliku JSON',
    settingsHint: 'Profil, kolano, przypomnienia',
    glossaryHint: 'RIR, RPE, DOMS i reszta skrótów',
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
