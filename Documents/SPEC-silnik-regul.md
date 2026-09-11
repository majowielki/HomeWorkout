# SPEC: Silnik reguł (`packages/domain`)

> Specyfikacja implementacyjna. Dokument nadrzędny: [PLAN.md](PLAN.md).
> Wszystkie wartości liczbowe pochodzą z deep researchów w `Documents/Gemini deep research docs/`
> i są **parametrami konfiguracyjnymi**, nie stałymi w kodzie — patrz §1.3.
>
> Wersja 1. Data: 2026-09-10.

---

## 1. Zasady ogólne

### 1.1 Czystość

`packages/domain` nie importuje `react`, `expo`, ani niczego z warstwy bazy danych. Wejście to zwykłe
obiekty, wyjście to zwykłe obiekty. Żadnych efektów ubocznych, żadnego `Date.now()` wewnątrz funkcji —
czas podajemy jako argument. Dzięki temu każda reguła jest testowalna bez mocków.

```ts
// tak
export function nextProgression(history: SetLog[], cfg: ProgressionConfig): ProgressionDecision

// nie
export function nextProgression(exerciseId: string): Promise<...>  // sięga do bazy
```

### 1.2 Wynik zawsze z uzasadnieniem

Każda decyzja silnika zwraca powód w formie kodu, nie tekstu. Tekst generuje UI albo LLM.

```ts
type Decision<T> = {
  value: T;
  reasons: ReasonCode[];        // np. ['REP_TARGET_MET', 'RIR_WITHIN_RANGE']
  confidence: 'high' | 'low';   // 'low' gdy mało danych
};
```

Powód: dzięki temu ekran „czemu dziś mniej serii?" działa bez AI, a AI dostaje gotowe kody zamiast
zgadywać intencje.

### 1.3 Konfiguracja osobno od logiki

```
/packages/domain/config/training.ts
```

Wszystkie liczby z badań (MEV, zakresy RIR, progi deloadu, kroki progresji) siedzą tutaj. Powód
w [PLAN §10.1](PLAN.md#101-zbyt-duża-objętość-jest-kataboliczna--teza-postawiona-za-mocno): te wartości
pochodzą z raportu LLM o różnej jakości źródeł i będą wymagały strojenia pod realną reakcję organizmu.

---

## 2. Typy podstawowe

```ts
export type MovementPattern =
  | 'Squat' | 'Hinge' | 'Lunge' | 'Push' | 'Pull' | 'Carry' | 'Isolation' | 'Core';

export type Plane = 'Sagittal' | 'Frontal' | 'Transverse';

export type Stance =
  | 'Bilateral' | 'UnilateralSupported' | 'UnilateralUnsupported'
  | 'Seated' | 'Prone' | 'Supine';

export type ForceProfile = 'ConcentricEccentric' | 'Isometric' | 'Plyometric';

export type Equipment = 'dumbbell' | 'band' | 'mat' | 'bike' | 'bodyweight';

export interface Exercise {
  id: string;
  name: string;

  // biomechanika
  movementPattern: MovementPattern;
  planesOfMotion: Plane[];
  isClosedKineticChain: boolean;
  stanceMechanics: Stance;
  forceProfile: ForceProfile;

  // flagi ryzyka — patrz §3
  loadsKnee: boolean;                 // czy ćwiczenie w ogóle obciąża staw kolanowy
  provokesValgusVarus: boolean;
  highAnteriorTibialShear: boolean;

  // programowanie
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment[];
  bandSuitability: 'excellent' | 'ok' | 'poor';
  substituteIds: string[];

  // prezentacja
  mediaRef: string | null;
  cues: string[];
}
```

---

## 3. Filtr bezpieczeństwa (profil medyczny)

### 3.1 Różnica względem raportu

Raport `Medyczna Taksonomia Ćwiczeń Fitness.md` definiuje wykluczenia HEC_A–HEC_E globalnie.
Zaimplementowane dosłownie odrzuciłyby wznosy bokiem, rozpiętki i każdą rotację tułowia — ćwiczenia,
które nie mają styczności z kolanem. Poprawka: **wykluczenia kolanowe bramkujemy polem `loadsKnee`.**

### 3.2 Implementacja

```ts
export interface MedicalProfile {
  knee: {
    side: 'left' | 'right' | 'both';
    missingCollaterals: boolean;      // brak MCL/LCL
    aclReconstructed: boolean;
    varusThrust: boolean;
    physioApproved: boolean;          // czy lista przeszła akceptację fizjoterapeuty
  } | null;
}

export type ExclusionCode =
  | 'KNEE_FRONTAL_PLANE'
  | 'KNEE_TRANSVERSE_PLANE'
  | 'KNEE_VALGUS_VARUS'
  | 'KNEE_UNILATERAL_UNSUPPORTED'
  | 'KNEE_PLYOMETRIC'
  | 'KNEE_OPEN_CHAIN_QUAD';

export function screenExercise(ex: Exercise, profile: MedicalProfile): ExclusionCode[] {
  const out: ExclusionCode[] = [];
  const knee = profile.knee;
  if (!knee) return out;

  // BRAMKA: reguły kolanowe dotyczą wyłącznie ćwiczeń obciążających kolano.
  if (!ex.loadsKnee) return out;

  if (knee.missingCollaterals || knee.varusThrust) {
    if (ex.planesOfMotion.includes('Frontal'))    out.push('KNEE_FRONTAL_PLANE');
    if (ex.planesOfMotion.includes('Transverse')) out.push('KNEE_TRANSVERSE_PLANE');
    if (ex.provokesValgusVarus)                   out.push('KNEE_VALGUS_VARUS');
    if (ex.stanceMechanics === 'UnilateralUnsupported')
      out.push('KNEE_UNILATERAL_UNSUPPORTED');
  }

  if (ex.forceProfile === 'Plyometric') out.push('KNEE_PLYOMETRIC');

  // otwarty łańcuch na czworogłowy — maks. przednia siła ścinająca w zakresie 0–30°
  if (knee.aclReconstructed
      && !ex.isClosedKineticChain
      && ex.highAnteriorTibialShear) {
    out.push('KNEE_OPEN_CHAIN_QUAD');
  }

  return out;
}

export const isAllowed = (ex: Exercise, p: MedicalProfile) => screenExercise(ex, p).length === 0;
```

### 3.3 Tryb konserwatywny

Dopóki `physioApproved === false`, silnik dodatkowo zawęża pulę:

```ts
if (!knee.physioApproved && ex.loadsKnee && ex.stanceMechanics !== 'Bilateral') {
  out.push('KNEE_UNILATERAL_UNSUPPORTED'); // traktujemy każdy jednonóż jak niedopuszczony
}
```

Czyli: **do momentu akceptacji fizjoterapeuty żadnych split squatów, wykroków ani bułgarskich.**
Wyłącznie obunóż. Rower pozostaje dozwolony (`loadsKnee: true`, ale `Bilateral`, `Sagittal`,
zamknięty łańcuch, brak plyometrii → przechodzi filtr).

### 3.4 Substytucja

Gdy ćwiczenie wypadnie z planu, szukamy zamiennika w puli dozwolonej. Scoring z raportu, uproszczony:

```ts
score = 50 * (udział wspólnych primaryMuscles)
      + 30 * (movementPattern === 'Hinge' ? 1 : 0)        // tylny łańcuch chroni ACL
      + 20 * (stanceMechanics === 'Bilateral' ? 1 : 0)
      + 10 * (isClosedKineticChain ? 1 : 0)
      +  5 * (ten sam movementPattern co oryginał ? 1 : 0)
```

Jeśli najwyższy wynik jest niższy od progu (np. 40), **nie proponujemy nic** i mówimy o tym wprost.
Zły zamiennik jest gorszy niż brak zamiennika.

### 3.5 Testy obowiązkowe

- wznosy bokiem (`Frontal`, `loadsKnee: false`) → **dozwolone**
- rozpiętki (`Transverse`, `loadsKnee: false`) → **dozwolone**
- Cossack squat (`Frontal`, `loadsKnee: true`) → odrzucone: `KNEE_FRONTAL_PLANE`
- prostowanie nóg w siadzie / z gumą → odrzucone: `KNEE_OPEN_CHAIN_QUAD`
- skater jumps → odrzucone: trzy kody naraz
- goblet squat → dozwolone
- bułgarski przy `physioApproved: false` → odrzucone; przy `true` → dozwolone
- rower → dozwolone zawsze

---

## 4. Objętość, częstotliwość, dobór dnia

### 4.1 Konfiguracja

```ts
export const TRAINING_CONFIG = {
  // Retencja masy w deficycie kalorycznym (terapia GLP-1/GIP).
  // Źródło: Trening Oporowy Podczas Terapii Mounjaro.md §3.1
  // UWAGA: dolna granica jest dobrze udokumentowana, górna to parametr do strojenia.
  weeklyWorkingSetsPerMuscle: { min: 3, target: 4, max: 6 },

  sessionsPerWeek:      { min: 2, target: 3, max: 3 },
  sessionMinutes:       { min: 30, max: 45 },
  restSecondsCompound:  { min: 90, max: 180 },
  restSecondsIsolation: { min: 45, max: 90 },

  repRange: {
    upperBody:   { min: 8,  max: 15 },
    lowerBody:   { min: 10, max: 20 },   // kompensacja lekkiego sprzętu
    isolation:   { min: 10, max: 20 },
  },

  targetRir: {
    compound:  { min: 2, max: 3 },       // ochrona CUN w deficycie
    isolation: { min: 0, max: 1 },
  },

  eccentricSeconds: { dumbbell: 2, band: 3 },  // przy gumach dłużej — histereza, §5.5
} as const;
```

### 4.2 Liczenie objętości

Okno 7 dni wstecz od podanej daty. Seria liczy się jako **robocza**, gdy `rir <= 4`.
Serie rozgrzewkowe nie wchodzą do puli.

Wkład w grupę mięśniową:
- `primaryMuscles` → 1,0 serii
- `secondaryMuscles` → 0,5 serii

Wyjście: `Record<MuscleGroup, number>` + status `below_min | in_range | above_max` per grupa.

### 4.3 Dobór dnia

Wejście: `DailyLog` (sen, DOMS per partia, energia) + objętość z okna 7 dni.

```
DOMS danej partii >= 4          → wyklucz ćwiczenia, gdzie jest primary
sen < 6 h LUB energia <= 2      → obniż docelowe RIR o 1 (czyli trenuj lżej)
objętość partii >= max          → nie dokładaj serii tej partii
zmęczenie skumulowane wysokie   → tylko Bilateral (patrz raport o taksonomii, §Integracja Zmęczenia)
```

---

## 5. Progresja

### 5.0 Inwentarz sprzętu (dane wejściowe silnika)

```ts
export const INVENTORY = {
  dumbbells: {
    bars: 2,
    barMassKg: 2.0,              // [DO ZWAŻENIA] wyliczone z bilansu 20 kg zestawu
    plates: [
      { massKg: 1, count: 8 },
      { massKg: 2, count: 4 },
    ],
  },
  bands: [
    { id: 'yellow', label: 'żółta',     nominalKg: [2, 7]   },
    { id: 'red',    label: 'czerwona',  nominalKg: [8, 11]  },
    { id: 'black',  label: 'czarna',    nominalKg: [12, 17] },
    { id: 'purple', label: 'fioletowa', nominalKg: [17, 26] },
    { id: 'green',  label: 'zielona',   nominalKg: [27, 45] },
  ],
} as const;
```

Drabinka obciążeń wyliczana jest raz z inwentarza, nie wpisywana ręcznie — obciążniki muszą leżeć
symetrycznie, więc rosną parami:

```ts
// dwa hantle, obciążniki dzielone po równo → 4×1 kg + 2×2 kg na hantel
export const LADDER_PAIRED  = [2, 4, 6, 8, 10];                     // kg na rękę
// jeden hantel, wszystkie obciążniki na jednym gryfie
export const LADDER_SINGLE  = [2, 4, 6, 8, 10, 12, 14, 16, 18];     // kg
```

Wybór drabinki wynika z ćwiczenia: `exercise.dumbbellMode: 'paired' | 'single'`.
Goblet squat, pullover i wiosłowanie jednorącz to `single` — i tylko dzięki temu dostają 18 kg
zamiast 10.

### 5.1 Hantle — double progression

**Skok wynosi 2 kg i jest niepodzielny.** Przy hantlu 8 kg to +25%, czyli wielokrotnie więcej niż
klasyczne „maksymalnie 10% tydzień do tygodnia". Nie da się tego obejść sprzętowo, więc bezpieczeństwo
przenosimy z ograniczania skoku na **warunek awansu**: obciążenie rośnie wyłącznie wtedy, gdy pełny cel
powtórzeń został zrealizowany we wszystkich seriach roboczych. Zakres powtórzeń jest szeroki
(8–15 / 10–20) właśnie po to, żeby zaabsorbować ten skok.

```
Cel: 3 serie × zakres [min, max] powtórzeń przy stałym ciężarze.

JEŻELI wszystkie serie robocze osiągnęły `max` powtórzeń ORAZ rir >= targetRir.min
   → zwiększ ciężar o najmniejszy dostępny krok
   → zresetuj cel powtórzeń do `min`
   → reasons: ['REP_TARGET_MET']

JEŻELI którakolwiek seria < `min` powtórzeń w dwóch kolejnych sesjach
   → zmniejsz ciężar o jeden krok
   → reasons: ['PERFORMANCE_REGRESSION']

W przeciwnym razie
   → utrzymaj ciężar, cel: +1 powtórzenie w pierwszej serii, która nie osiągnęła `max`
```

Awans i regres poruszają się **po drabince z §5.0**, nigdy przez dodanie dowolnej liczby kilogramów:

```ts
const idx = ladder.indexOf(current);
const next = ladder[Math.min(idx + 1, ladder.length - 1)];
```

Gdy `idx` jest już ostatni (10 kg w trybie `paired`, 18 kg w `single`), progresja obciążeniem się kończy.
Silnik przełącza się wtedy na: więcej powtórzeń → wolniejsza faza ekscentryczna → dołożenie gumy do
ćwiczenia (`accommodating resistance`) → zmiana ćwiczenia na trudniejszy wariant.
Kod powodu: `LOAD_CEILING_REACHED`.

### 5.2 Gumy — dlaczego osobny algorytm

Guma nie ma masy. Ma **krzywą siły zależną od rozciągnięcia**, a rozciągnięcie zależy od tego, jak
daleko stoisz od kotwicy i jak długie masz ręce. Ta sama guma daje inne obciążenie w każdej sesji,
jeśli nie ustandaryzujesz pozycji.

### 5.3 Dyskretyzacja pozycji

```ts
export type AnchorPosition = 0 | 1 | 2 | 3;
// P0 – guma napięta, zerowe napięcie wstępne
// P1 – jeden zdefiniowany krok od kotwicy
// P2 – dwa kroki
// P3 – trzy kroki (maksimum dla pomieszczenia)
```

W praktyce: taśma malarska na podłodze w czterech miejscach. Aplikacja loguje numer, nie centymetry.
To zamienia zmienną ciągłą, której nie da się powtarzalnie zmierzyć w trakcie serii, w policzalną.

### 5.4 Drzewo progresji

```
Start: [guma najlżejsza sensowna, P1], cel np. 3 × 12–15 powtórzeń

Osiągnięto 3 × 15 przy rir w celu?
  ├─ TAK, i pozycja < P3
  │     → MIKRO-PROGRESJA: ta sama guma, pozycja +1, cel wraca do 12
  │       reasons: ['BAND_MICRO_PROGRESSION']
  │
  ├─ TAK, i pozycja == P3
  │     → MAKRO-PROGRESJA: następna guma w górę, pozycja wraca do P1, cel do 12
  │       reasons: ['BAND_MACRO_PROGRESSION']
  │       (warunek dodatkowy: nowa konfiguracja nie może dawać skoku > 15% szacowanej siły —
  │        jeśli daje, wróć do P0 zamiast P1)
  │
  └─ NIE → utrzymaj konfigurację, cel +1 powtórzenie
```

**Ważne:** log musi zapisywać `(bandId, anchorPosition, reps, rir)` jako komplet. Sam spadek liczby
powtórzeń bez kontekstu pozycji wygląda jak regres, a może być progresją — dokładnie ten przypadek
opisuje raport (10 powtórzeń z P1 → 8 powtórzeń z P2 to **wzrost** obciążenia).

### 5.5 Kalibracja i szacowanie obciążenia

Procedura jednorazowa, na urządzeniu:

```
1. zmierz długość spoczynkową gumy L0
2. dla mas m ∈ {2, 4, 6, 8, 10, 12, 14, 16, 18} kg: podwieś, zmierz długość L
   (jeden gryf, obciążniki parami — drabinka LADDER_SINGLE z §5.0)
3. przerwij, gdy przyrost długości między kolejnymi masami spadnie poniżej progu mierzalności
4. dopasuj F(λ), gdzie λ = L / L0
   – regresja liniowa, jeśli R² > 0,97
   – kwadratowa w przeciwnym razie
   – **odmów dopasowania przy mniej niż 4 punktach pomiarowych**
5. zapisz współczynniki ORAZ `maxMeasuredKg` w tabeli Band
```

Zasięg kalibracji przy dostępnych 18 kg:

| Guma | Zakres nominalny | Kalibracja | `calibrationFit` |
|---|---|---|---|
| żółta | 2–7 kg | pełna | dopasowanie |
| czerwona | 8–11 kg | pełna | dopasowanie |
| czarna | 12–17 kg | pełna | dopasowanie |
| fioletowa | 17–26 kg | dolna część zakresu | dopasowanie + `maxMeasuredKg = 18` |
| **zielona** | **27–45 kg** | **niemożliwa** | **`null`** |

**Zielona guma jest jednocześnie nieskalibrowalna i najważniejsza** — przy 10 kg na rękę to ona,
a nie hantle, dostarcza obciążenia dla nóg. System pozycji P0–P3 jest więc dla niej mechanizmem
podstawowym, nie zapasowym. Silnik musi działać w pełni poprawnie przy `calibrationFit === null`;
to jest ścieżka główna, a nie przypadek brzegowy, i tak trzeba ją przetestować.

Estymacja podczas treningu:

```ts
estimatedLoadKg = fit(lambdaAt(anchorPosition, exerciseRomProfile))
```

**Ograniczenia, które trzeba jawnie obsłużyć w UI:**

| Sytuacja | Zachowanie aplikacji |
|---|---|
| `calibrationFit === null` (zielona) | nie pokazuj kilogramów w ogóle — tylko „Zielona, pozycja P2" |
| wynik przekracza `maxMeasuredKg` (fioletowa wyżej niż 18 kg) | pokaż `„> 18 kg"`, **nigdy ekstrapolowanej liczby** |
| kalibracja pokrywa wynik | pokaż **przedział** („≈ 12–14 kg"), nigdy wartości z częścią dziesiętną |

Powód ostatniego wiersza: precyzja pokazana użytkownikowi sugeruje pewność, której ten pomiar nie ma.

### 5.6 Poprawki materiałowe

**Efekt Mullinsa** — pierwsze 3–10 cykli rozciągnięcia stawia wyraźnie większy opór, potem materiał
„mięknie" i stabilizuje się.
→ Silnik **wymaga serii rozgrzewkowej z gumą** przed pierwszą serią roboczą danego ćwiczenia.
Brak rozgrzewki oznacza flagę `WARMUP_MISSING` na serii i wykluczenie jej z porównań progresji.

**Histereza** — faza ekscentryczna jest o 5–25% lżejsza niż koncentryczna.
→ `eccentricSeconds.band = 3` (wobec 2 dla hantli). Cue w UI: „opuszczaj wolniej niż podnosisz".

**Zużycie** — po tysiącach cykli sztywność spada.
→ licznik `cycleCount` per guma (suma powtórzeń), przypomnienie o rekalibracji przy 5000 cykli
albo po 6 miesiącach, cokolwiek nastąpi pierwsze.

### 5.7 Konflikt krzywych siły

`bandSuitability` steruje doborem narzędzia:

| Wartość | Znaczenie | Zachowanie silnika |
|---|---|---|
| `excellent` | krzywa wznosząca (przysiad, wyciskanie) — guma pasuje idealnie | preferuj gumę |
| `ok` | neutralne | dowolnie |
| `poor` | krzywa zstępująca (wiosłowanie, przyciąganie) — guma najcięższa tam, gdzie najsłabszy | preferuj hantle; przy gumie zwiększ pre-stretch i skróć zakres ruchu, dodaj cue |

---

## 6. Autoregulacja i deload

### 6.1 Sygnały przeciążenia

```
RIR 0 na ćwiczeniach wielostawowych w dwóch kolejnych sesjach   → FATIGUE_HIGH
spadek ciężaru/powtórzeń w dwóch kolejnych sesjach              → PERFORMANCE_DROP
sen < 6 h przez 3 dni z rzędu                                   → RECOVERY_LOW
DOMS >= 4 utrzymujące się > 72 h                                → RECOVERY_LOW
```

Dwa lub więcej sygnałów jednocześnie → zaproponuj deload wcześniej niż w harmonogramie.

### 6.2 Deload

Wyzwalacz: co **4–5 tygodni** ciągłego treningu, albo reaktywnie wg §6.1.

Protokół „step-taper" — to jest wbrew intuicji i dlatego warto to zapisać wprost:

```
objętość:      –30% do –50% (np. 6 serii/partię/tydzień → 3)
ciężar:        BEZ ZMIAN — te same hantle, te same gumy i pozycje
RIR:           4–5 (czyli daleko od wysiłku granicznego)
częstotliwość: bez zmian albo –1 sesja
```

**Dlaczego ciężar bez zmian:** to obciążenie bezwzględne informuje układ nerwowy, że mięśnie są nadal
potrzebne. Klasyczny „lekki tydzień z małym ciężarem" w deficycie kalorycznym działa przeciwskutecznie —
wycofuje bodziec akurat wtedy, gdy jest najbardziej potrzebny.

**Czego silnik NIE robi:** nie proponuje niczego dotyczącego kalorii, białka ani dawki leku.
Raport źródłowy zaleca zsynchronizowanie deloadu z przerwą dietetyczną; to jest zalecenie medyczne
i wychodzi poza kompetencje aplikacji. Silnik może co najwyżej wyświetlić neutralną notatkę:
*„W tym tygodniu obniżamy objętość treningową. Kwestie żywieniowe w trakcie terapii omów z lekarzem
prowadzącym."* — i nic ponadto.

### 6.3 Powrót po przerwie

To reguła krytyczna, bo przerwy są w Twoim przypadku pewne, nie hipotetyczne.

| Przerwa | Zachowanie |
|---|---|
| ≤ 7 dni | normalna progresja |
| 8–14 dni | powtórz ostatnią sesję bez progresji, `reasons: ['LAYOFF_SHORT']` |
| 15–30 dni | zejdź o jeden stopień (ciężar –1 krok / guma –1 pozycja), cel powtórzeń = `min` |
| > 30 dni | tryb rekalibracji: 2 sesje wprowadzające przy RIR 4, potem restart progresji |

Aplikacja nigdy nie komunikuje przerwy jako porażki. Kod powodu `LAYOFF_*` mapuje się na neutralny
komunikat, nie na „straciłeś formę".

---

## 7. Rower

```ts
interface CardioLog {
  minutes: number;
  resistanceLevel: number;   // skala tego roweru, porządkowa
  avgCadence?: number;       // jeśli komputerek pokazuje
  avgHr?: number;
  rpe: number;               // 1-10
}
```

Progresja: czas → kadencja → opór, w tej kolejności. Bez pretendowania do watów — Hop-Sport Bravo
nie mierzy mocy, a przeliczenia „opór × kadencja = waty" byłyby zmyśleniem.

Stałe zalecenia (cue'y wyświetlane przy logowaniu, wynikające z profilu kolana):
- jazda w siodle, bez wstawania,
- wysokość siodełka zapisana w ustawieniach i niezmieniana,
- opór umiarkowany + wyższa kadencja zamiast niskiej kadencji z dużym oporem.

---

## 8. Walidacja wyjścia (klamry bezpieczeństwa)

Każdy plan — z silnika reguł **czy z LLM** — przechodzi przez ten sam zestaw klamer przed pokazaniem:

```ts
export function validatePlan(plan: PlanDay, ctx: ValidationContext): ValidationResult {
  // 1. ćwiczenie istnieje w bazie
  // 2. ćwiczenie przechodzi screenExercise() dla profilu medycznego
  // 3. sprzęt jest dostępny
  // 4. awans obciążenia = dokładnie jeden szczebel drabinki (hantle) lub jedna pozycja/guma (gumy),
  //    i wyłącznie gdy cel powtórzeń został spełniony. Klamra procentowa NIE obowiązuje —
  //    przy skoku 2 kg jest fizycznie niewykonalna, patrz §5.1.
  // 5. objętość tygodniowa per partia <= weeklyWorkingSetsPerMuscle.max
  // 6. serie 1..6, powtórzenia 1..30, RIR 0..5
  // 7. czas sesji (serie × (praca + przerwa)) <= sessionMinutes.max
}
```

Naruszenie → plan jest **przycinany**, nie odrzucany, a użytkownik dostaje informację co i dlaczego
zostało zmienione. Wyjątek: naruszenie punktu 2 (bezpieczeństwo medyczne) → ćwiczenie usuwane w całości,
bez przycinania.

---

## 9. Plan testów jednostkowych

Cel: **100% pokrycia `packages/domain`.** To jednocześnie wymóg bezpieczeństwa i najmocniejszy element
portfolio w projekcie.

| Moduł | Co musi być pokryte |
|---|---|
| `screenExercise` | wszystkie osiem przypadków z §3.5, oba stany `physioApproved` |
| `substitute` | brak sensownego zamiennika → `null`, nie „cokolwiek" |
| `weeklyVolume` | granice okna 7 dni, wagi primary/secondary, pominięcie serii rozgrzewkowych |
| `ladder` | generowanie `LADDER_PAIRED` i `LADDER_SINGLE` z inwentarza, symetria obciążników |
| `dumbbellProgression` | osiągnięcie celu, regres, jedna seria, **sufit drabinki → `LOAD_CEILING_REACHED`** |
| `bandProgression` | mikro, makro, P3→makro, wykrycie „mniej powtórzeń ale dalsza pozycja = progres" |
| `calibration` | dopasowanie liniowe vs kwadratowe, odmowa przy < 4 punktach, **`null` dla zielonej** |
| `loadDisplay` | zakaz ekstrapolacji powyżej `maxMeasuredKg`, brak kilogramów przy `fit === null` |
| `deload` | wyzwalacz czasowy, wyzwalacz reaktywny, **ciężar niezmieniony** |
| `layoff` | wszystkie cztery progi z §6.3 |
| `validatePlan` | każda z siedmiu klamer osobno + przypadek medyczny (usunięcie, nie przycięcie) |

Test, który warto napisać jako pierwszy, bo pilnuje najważniejszej poprawki w całym projekcie:

```ts
it('nie wyklucza wznosów bokiem mimo płaszczyzny czołowej', () => {
  const lateralRaise = { planesOfMotion: ['Frontal'], loadsKnee: false, /* ... */ };
  expect(screenExercise(lateralRaise, kneeProfile)).toEqual([]);
});
```
