# SPEC: Silnik reguł (`src/domain`)

> Specyfikacja implementacyjna. Dokument nadrzędny: [PLAN.md](PLAN.md).
> Wszystkie wartości liczbowe pochodzą z deep researchów w `Documents/Gemini deep research docs/`
> i są **parametrami konfiguracyjnymi**, nie stałymi w kodzie — patrz §1.3.
>
> Wersja 1.2. Data: 2026-10-02 (v1.1: 2026-09-14, v1: 2026-09-10). Sekcje §2, §3 i §5.0 są zaimplementowane w `src/domain`; kod jest źródłem prawdy, ten dokument opisuje intencję.
>
> **v1.2:** plan dnia ze slotów zamiast stałych szablonów, rotacja ćwiczeń co blok, trening codzienny
> (§10), progresja masy ciała i roweru (§5.8, §7), poprawka kierunku RIR w §4.3. Decyzje użytkownika
> z 2026-10-02; bramka „dwa tygodnie używania" świadomie pominięta (IMPLEMENTACJA §0.1).

---

## 1. Zasady ogólne

### 1.1 Czystość

`src/domain` nie importuje `react`, `expo`, ani niczego z warstwy bazy danych. Wejście to zwykłe
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
/src/domain/config/training.ts
```

Wszystkie liczby z badań (MEV, zakresy RIR, progi deloadu, kroki progresji) siedzą tutaj. Powód
w [PLAN §10.1](PLAN.md#101-zbyt-duża-objętość-jest-kataboliczna--teza-postawiona-za-mocno): te wartości
pochodzą z raportu LLM o różnej jakości źródeł i będą wymagały strojenia pod realną reakcję organizmu.

---

## 2. Typy podstawowe

```ts
export type MovementPattern =
  | 'Squat' | 'Hinge' | 'Lunge' | 'Push' | 'Pull' | 'Carry' | 'Isolation' | 'Core'
  | 'Cardio' | 'Mobility'; // rower i rozciąganie muszą być w katalogu — patrz IMPLEMENTACJA §0.2

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
  dumbbellMode?: 'paired' | 'single';   // która drabinka z §5.0
  bandSuitability: 'excellent' | 'ok' | 'poor';
  substituteIds: string[];

  // prezentacja
  media: string | null;                 // klucz do src/assets/exercise-media.ts
  cues: string[];
  kneeCue?: string;                     // obowiązkowy gdy loadsKnee
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
  | 'KNEE_UNILATERAL_PENDING_PHYSIO' // tryb konserwatywny, §3.3
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

Dopóki `physioApproved === false`, silnik dodatkowo zawęża pulę. Kod używa **osobnego** kodu wykluczenia,
żeby UI mogło odróżnić „na stałe" od „po akceptacji fizjoterapeuty":

```ts
// stance inne niż Bilateral / Seated / Supine / Prone, o ile nie jest już
// wykluczone jako UnilateralUnsupported
if (!knee.physioApproved && isUnilateral(ex.stanceMechanics) && !out.includes('KNEE_UNILATERAL_UNSUPPORTED')) {
  out.push('KNEE_UNILATERAL_PENDING_PHYSIO');
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
Serie rozgrzewkowe nie wchodzą do puli. *v1.2:* ćwiczenia `Mobility` i `Cardio` też nie — kot-krowa
ma w katalogu `primaryMuscles: back`, ale nie jest ciężką serią na plecy.

Wkład w grupę mięśniową:
- `primaryMuscles` → 1,0 serii
- `secondaryMuscles` → 0,5 serii

Wyjście: `Record<MuscleGroup, number>` + status `below_min | in_range | above_max` per grupa.

### 4.3 Dobór dnia

Wejście: `DailyLog` (sen, DOMS per partia, energia) + objętość z okna 7 dni.

```
DOMS danej partii >= 4          → wyklucz ćwiczenia, gdzie jest primary
sen < 6 h LUB energia <= 2      → podnieś docelowe RIR o 1 (czyli trenuj lżej)
objętość partii >= max          → nie dokładaj serii tej partii
zmęczenie skumulowane wysokie   → tylko Bilateral (patrz raport o taksonomii, §Integracja Zmęczenia)
```

*Poprawka v1.2:* v1.1 mówiło „obniż RIR o 1 (czyli trenuj lżej)". To sprzeczność: niższe RIR to
bliżej upadku, czyli ciężej. Obowiązuje intencja: **lżej = RIR +1**, z górną granicą 5.

Przy treningu codziennym te reguły są częścią planera dnia — §10.4.

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
   (tylko gdy na drabince jest krok w dół: od 2026-10-09 najlżejszy szczebel nie zgłasza regresu, bo nic się nie zmienia —
    silnik v2, P0.7; budowanie do zakresu od wyniku wejdzie w P3)

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

**v1.3 (2026-10-07):** wyłączone (`PROGRESSION_CONFIG.requireBandWarmup = false`). Zapisywanie serii
rozgrzewkowych okazało się w użyciu zbędne; zamiast niej ekran serii prosi przed pierwszą serią z gumą
o 5–10 rozciągnięć bez liczenia. Pierwsza seria robocza liczy się do porównań jak każda inna.

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

### 5.8 Jeden algorytm, trzy drabinki (v1.2)

§5.1 i §5.4 to ten sam double progression nad różnymi drabinkami obciążenia:

| Sprzęt | Drabinka | Krok w górę | Sufit |
|---|---|---|---|
| hantle | `LADDER_PAIRED` / `LADDER_SINGLE` (§5.0) | następny szczebel | ostatni szczebel → `LOAD_CEILING_REACHED` |
| guma | (guma, pozycja) w kolejności żółta P0…P3, czerwona P0…P3, … | pozycja +1 (`BAND_MICRO_PROGRESSION`); z P3 następna guma od P1 (`BAND_MACRO_PROGRESSION`), od P0 gdy skoku nie da się oszacować albo przekracza 15% | zielona P3 |
| masa ciała | jeden szczebel | — | od razu: `BODYWEIGHT_CEILING` |

**Ilość** to powtórzenia albo — dla ćwiczeń izometrycznych (`forceProfile: 'Isometric'`) — sekundy,
z krokiem 1 powtórzenie / 5 s. Warunek awansu, regres i „+1 w pierwszej serii poniżej max" są wspólne.
Ćwiczenie na sufit drabinki trzyma ilość na max i czeka na rotację w następnym bloku (§10.2), która
w slocie przechodzi do kolejnego wariantu.

**Seria bez rozgrzewki przy gumie** (§5.6): pierwsza seria robocza ćwiczenia z gumą, przed którą
w tej sesji nie było serii rozgrzewkowej, dostaje `WARMUP_MISSING` i nie wchodzi do porównań. Plan
każe zrobić rozgrzewkę przed każdym ćwiczeniem z gumą.

**Pierwszy kontakt.** Ćwiczenie bez historii zaczyna od ciężaru startowego slotu (§10.1). Pierwsze
`introExposures` (2) sesje ćwiczenia idą przy RIR 4 (`FIRST_EXPOSURE`). Ciężary startowe to
**zgadywanie, nie wynik badań** — RIR 4 jest po to, żeby pomyłka w górę była bezpieczna, a w dół
nieszkodliwa. Silnik uczy się z tego, co faktycznie zalogowano, nie z tego, co zaproponował.

Ten sam mechanizm obsługuje ćwiczenie niewykonywane od > 30 dni (wróciło po rotacji albo po długiej
przerwie): szczebel w dół od ostatniego obciążenia, RIR 4, `RE_EXPOSURE`.

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

**v1.2 — rower codziennie, 10–20 min, na początku sesji** (rozgrzewa kolano przed ćwiczeniami).

**v1.3 (2026-10-07, po pierwszych testach)** — rower to osobne zadanie dnia na ekranie „Dziś”
(„Zrobione” / „Później”), do zrobienia przed treningiem, po nim albo wieczorem; niezrobiony nie blokuje
sesji. Sesja zaczyna się od ogólnej rozgrzewki do odhaczenia (`src/domain/session/warmup.ts`):
same ruchy obunóż bez obciążenia, wykroki w tył dopiero po zgodzie fizjoterapeuty. Przepis na jazdę
liczy się tak samo jak niżej — z każdej zapisanej jazdy, w sesji czy osobno.

Kadencja jest opcjonalna w logu, więc decyduje RPE ostatniej jazdy:

| Ostatnia jazda | Następna |
|---|---|
| brak historii | `bikeMinutes.min`, opór do wyboru — `FIRST_EXPOSURE` |
| RPE ≥ 8 | −2 min, nie mniej niż min — `BIKE_EASE_OFF` |
| RPE ≤ 5 i minuty < max | +2 min — `BIKE_TIME_UP` |
| RPE ≤ 5 w dwóch ostatnich jazdach, minuty = max | opór +1 — `BIKE_RESISTANCE_UP` |
| w pozostałych przypadkach | bez zmian — `BIKE_HOLD` |

Przerwa ≥ 15 dni → minuty wracają do min. Rower nie wchodzi do objętości partii (§4.2).

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

*v1.2:* punkt 2 obejmuje też listę „nie proponuj" użytkownika (`USER_EXCLUDED`, usunięcie w całości).
Kontekst walidacji niesie objętość z ostatnich 7 dni oraz ostatnie obciążenie każdego ćwiczenia
z informacją, czy cel powtórzeń został osiągnięty — punkt 4 sprawdza plan z silnika i plan z LLM
(A3) tak samo. Kolejność: 1, 2 (usuwanie) → 3, 6 (klamry wartości) → 4 → 5 (przycięcie serii od
końca planu) → 7 (usuwanie ćwiczeń od końca).

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
| `bodyweightProgression`, `bike` | sufit masy ciała, ćwiczenia na czas, wszystkie wiersze tabeli z §7 |
| `block` | start, deload planowy i reaktywny, zerowanie licznika po przerwie, rotacja cykliczna, wymiana wykluczonego |
| `dayPlanner` | każdy kod pominięcia slotu z §10.4, budżet czasu, dopełnienie, deload, kolejność |
| **symulacja** | 12 tygodni codziennego treningu — właściwości z §10.6 |

Test, który warto napisać jako pierwszy, bo pilnuje najważniejszej poprawki w całym projekcie:

```ts
it('nie wyklucza wznosów bokiem mimo płaszczyzny czołowej', () => {
  const lateralRaise = { planesOfMotion: ['Frontal'], loadsKnee: false, /* ... */ };
  expect(screenExercise(lateralRaise, kneeProfile)).toEqual([]);
});
```

---

## 10. Plan dnia: sloty, bloki, trening codzienny (v1.2)

### 10.0 Skąd ta zmiana

Dwa szablony FBW A/B to 12 ćwiczeń na zmianę. Cel użytkownika jest inny: pewność, że w dłuższym
okresie trenuje całe ciało, a nie „kilka ćwiczeń na zmianę". Do tego trenuje **codziennie**: 10–20 min
roweru + 20–30 min ćwiczeń, a objętość zostaje 3–6 serii na partię tygodniowo (§4.1, nadal deficyt).
Z arytmetyki: to około 6 ciężkich serii dziennie dla partii, które są „do zrobienia", plus lekkie
dopełnienie.

Szablony FBW A/B zostają w aplikacji jako „trening ręczny" — silnik ich nie używa.

### 10.1 Slot

Slot opisuje **ruch**, nie ćwiczenie: „pchanie poziome", „hinge", „łydki". `data/slots.json`:

```ts
interface Slot {
  id: string;
  name: string;                       // po polsku, do UI
  kind: 'compound' | 'accessory' | 'core' | 'filler';
  region: 'lower' | 'push' | 'pull' | 'shoulders' | 'arms' | 'core' | 'mobility';
  exerciseIds: string[];              // kolejność = łatwiejsze najpierw
  repRange: [number, number];
  timeRange?: [number, number];       // wymagane, gdy któryś kandydat jest izometryczny
  rir: [number, number];
  restSec: number;
  start: { paired?: number; single?: number; band?: string };  // ciężar startowy, §5.8
  lightFill?: boolean;                // może dopełniać krótki dzień lekką pracą przy RIR 5
}
```

`validate-data` pilnuje: każde ćwiczenie poza `Cardio` jest w dokładnie jednym slocie; id istnieją;
każdy slot ma kandydata, który przechodzi twardy filtr kolana (§3.2 bez trybu konserwatywnego);
ciężar startowy leży na drabince, guma istnieje; `timeRange` jest tam, gdzie trzeba.

Slot `filler` (mobilność) jest wyjątkiem: używa wszystkich swoich dozwolonych ćwiczeń, nie rotuje
i nie wchodzi do objętości (§4.2).

### 10.2 Blok (mezocykl) i rotacja

- Blok to `blockWorkDays` (28) dni kalendarzowych pracy, potem `deloadDays` (7) deloadu (§6.2),
  potem następny blok.
- W bloku każdy slot ma **jedno** ćwiczenie — double progression musi mieć co porównywać.
- **Rotacja:** w nowym bloku slot bierze następne dozwolone ćwiczenie po tym z poprzedniego bloku,
  cyklicznie. Pierwszy blok bierze pierwsze dozwolone, czyli najłatwiejsze.
- **Dozwolone** = `screenExercise` puste + nie na liście „nie proponuj" użytkownika + sprzęt dostępny.
- Wybór, który w trakcie bloku przestał być dozwolony, zastępuje następny dozwolony w slocie
  (`SELECTION_REPLACED`). Zamiana w sesji „do końca bloku" nadpisuje wybór slotu.
- Przerwa ≥ 8 dni zeruje licznik bloku: start = dziś, wybory zostają (`BLOCK_CLOCK_RESET`).
  Inaczej przerwa tuż przed deloadem dałaby deload zaraz po przerwie (IMPLEMENTACJA, tabela ryzyk).
- Deload reaktywny (§6.1, ≥ 2 sygnały) najwcześniej po `reactiveDeloadMinDays` (7) dniach bloku.
- Stan bloku jest zapisywany (wybory muszą przetrwać restart); faza wynika z dat.

### 10.3 Dzień — wejście

Data, katalog, sloty, profil medyczny, lista „nie proponuj", stan bloku, ukończone sesje z seriami,
jazdy na rowerze, dziennik dnia (sen, energia, DOMS), kalibracje gum. Zwykłe obiekty (§1.1).

### 10.4 Dzień — algorytm

1. **Kontekst dnia:** przerwa (§6.3), sygnały (§6.1), faza bloku, gotowość — sen < 6 h albo
   energia ≤ 2 → RIR +1 dla całego dnia (`LOW_READINESS`).
2. **Kwalifikacja** każdego slotu z jego ćwiczeniem z bloku. Slot, który odpada, dostaje kod:

   | Kod | Kiedy |
   |---|---|
   | `NO_CANDIDATE` | w slocie nie ma dozwolonego ćwiczenia |
   | `DOMS_HIGH` | DOMS ≥ 4 w partii głównej (dzisiejszy dziennik) |
   | `RECOVERING` | partia główna miała serie robocze wczoraj albo dziś (serie przy RIR 5 się nie liczą) |
   | `VOLUME_AT_MAX` | nie mieści się ani jedna seria bez przekroczenia tygodniowego max serii bezpośrednich |
   | `ALREADY_TODAY` | partia główna ma już dziś `maxDirectSetsPerMuscleDay` serii z innego slotu |
   | `VOLUME_ON_TARGET` | partie główne mają już cel tygodnia, a slot był niedawno (< `forceStaleDays`) |
   | `FATIGUE_BILATERAL_ONLY` | `FATIGUE_HIGH`, ćwiczenie jest jednostronne, a w slocie nie ma obunożnego |
   | `NOT_PICKED` | slot się kwalifikował, ale przegrał z innymi o budżet czasu |

   `RECOVERING` przy treningu codziennym sam tworzy naprzemienność partii.

   **Planer liczy serie bezpośrednie** — tylko te, w których partia jest główna. Tak brzmi zalecenie
   z researchu („3–6 bezpośrednich, ciężkich serii", §4.1), a pół-serie z innych ćwiczeń zapychały
   limit: brzuch, pomocniczy w przysiadzie, pompkach i noszeniu, nie dostawał ani jednego ćwiczenia
   na brzuch (§10.8). Wskaźnik dla AI (§4.2) nadal liczy pomocnicze po 0,5.
3. **Punktacja:** `2 × niedobór + min(dni od ostatniego wykonania slotu, 14) / 7 + (compound ? 1 : 0)`,
   gdzie niedobór = suma po partiach głównych z
   `max(0, cel − serie bezpośrednie 7 dni − zaplanowane dziś) / liczba slotów, które ją trenują`.
   Dzielnik sprawia, że partia z jednym slotem (dwójki uda: tylko hinge) wygrywa z partią z czterema
   (pośladki), zanim wspólny limit zostanie zużyty. Przeliczana po każdym wyborze. Slot wchodzi tylko,
   gdy jego partie mają niedobór albo czekał ≥ `forceStaleDays` (10) dni — wtedy wraca mimo celu,
   żeby żaden ruch nie zniknął na stałe.
4. **Wypełnianie:** sloty od najwyższej punktacji, dopóki szacowany czas < `sessionMinutes.target`
   i dodanie nie przekroczy `sessionMinutes.max`; najwyżej `maxExercisesPerSession`. Serie:
   `setsPerExercise`, w deloadzie 1, mniej, gdy brakuje miejsca w limicie tygodnia albo dnia
   (`maxDirectSetsPerMuscleDay`, 2 — rozkłada tydzień na dni, zamiast ładować go w pierwszy).
5. **Dopełnienie:** gdy czas < `sessionMinutes.min` → najpierw lekka praca slotów z `lightFill`
   (core, rotatory) przy RIR 5, której nie ma już w planie — od najdłużej czekającego; RIR 5 to nie
   seria robocza (§4.2), więc nie liczy się do objętości ani do regeneracji. Potem mobilność, bez
   progresji. Gdy ciężkiej pracy jest mniej niż połowa min → `LIGHT_DAY`.
6. **Recepta** dla każdego ćwiczenia: §5.8 → przerwa (§6.3) → deload (§6.2: 1 seria, RIR 4–5,
   obciążenie i ilość z ostatniej sesji) → gotowość. Ćwiczenie z gumą dostaje serię rozgrzewkową.
7. **Kolejność:** rower; ćwiczenia złożone w parach dół + góra (A1/A2, B1/B2); akcesoria; core;
   dopełnienie. Bloki planu mają kształt `TemplateBlock`, więc sesję prowadzi istniejący
   `buildSessionSteps`.
8. **`validatePlan`** (§8).

Szacunek czasu: seria = praca (powtórzenia × `secondsPerRep` albo sekundy) + przerwa; ćwiczenie
+`exerciseChangeoverSec`; rozgrzewka gumą +`bandWarmupSec`. To parametr do strojenia.

### 10.5 Wyjście

`SessionPlan`: data, blok, faza, rower, ćwiczenia (kształt `TemplateBlock` + slot, obciążenie,
cel ilości, seria rozgrzewkowa, kody), **pominięte sloty z kodami**, kody dnia, szacowany czas
i poprawki z `validatePlan`.

Plan jest liczony na żywo aż do startu sesji, potem zamrożony w `workouts.plan`: historia pokazuje,
co zaproponowano wtedy, a nie co silnik zaproponowałby dziś. Pominięte sloty z kodami to odpowiedź
na „czemu dziś nie ma przysiadów?" — dla ekranu i dla narzędzia AI `getPlanExplanation`.

### 10.6 Symulacja — co ma być prawdą

`domain/plan/__tests__/simulation.test.ts`: syntetyczny użytkownik przez 12 tygodni trenuje
codziennie i wykonuje plan. Wymagane właściwości:

- żadna partia główna nie ma serii roboczych dwa dni z rzędu;
- serie bezpośrednie z 7 dni żadnej partii nigdy nie przekraczają jej max;
- nigdy nie pojawia się ćwiczenie odrzucone przez filtr kolana ani z listy „nie proponuj";
- plan dnia mieści się w `sessionMinutes.max`;
- każdy slot z dozwolonym kandydatem pojawia się przynajmniej raz w każdym bloku;
- sloty z ≥ 2 kandydatami zmieniają ćwiczenie między blokami;
- deload co ~5 tygodni, obciążenie w deloadzie równe obciążeniu sprzed niego;
- po 10 dniach przerwy pierwsza sesja nie ma progresji.

Pokrycie partii (ile dni każda partia jest w 3–6) jest **raportowane** przez `scripts/simulate-plan.ts`,
nie wymuszane. Przy limicie 3–6 i nakładających się partiach głównych (pośladki są główne
w przysiadzie, wykroku i hinge'u) część partii może stale leżeć pod min — to sygnał do strojenia
konfiguracji, nie błąd algorytmu.

### 10.7 Konfiguracja — nowe klucze

`sessionMinutes {min 20, target 20, max 30}` · `bikeMinutes {min 10, max 20}` · `setsPerExercise 2` ·
`maxExercisesPerSession 6` · `maxDirectSetsPerMuscleDay 2` · `forceStaleDays 10` · `fillerSets 2` ·
`lightFillRir 5` · `introExposures 2` · `reExposureAfterDays 31` · `blockWorkDays 28` ·
`deloadDays 7` · `reactiveDeloadMinDays 7` · wagi punktacji · `secondsPerRep 4` ·
`exerciseChangeoverSec 30` · `bandWarmupSec 60` · progi roweru (RPE 5 / 8, krok 2 min) ·
`maxDirectSetsOverride {glutes 8, back 8}`.

Wszystkie poza dolną granicą objętości (§4.1) to parametry do strojenia, **nie wyniki badań**.

### 10.8 Czego nauczyła pierwsza symulacja (2026-10-02)

Silnik powstał przed realnym używaniem, więc pierwszym „użytkownikiem" była symulacja
(`npx tsx scripts/simulate-plan.ts --weeks 12`). Cztery przebiegi, cztery poprawki:

| Przebieg | Co wyszło | Zmiana |
|---|---|---|
| 1 | brzuch ani razu jako ćwiczenie; dzień 1 — 28 min, potem dni z samą mobilnością | serie bezpośrednie zamiast pół-serii; limit dnia 2 serie na partię; slot tylko przy niedoborze (albo po 10 dniach) |
| 2 | dwójki uda bez ani jednej serii w bloku 1 — hinge zaczynał od mostka (same pośladki) | osobny slot „Pośladki"; hinge zawsze trenuje dwójki |
| 3 | dwójki uda i przedramiona pod normą — ich jedyny slot przegrywał o limit pośladków / pleców | niedobór dzielony przez liczbę slotów partii; lekka praca przy RIR 5 nie jest blokowana przez `validatePlan` |
| 4 | przy max 6 czwórki i dwójki uda (oraz najszersze i przedramiona) nie mieszczą się razem w normie — 3 + 3 serie to już 6 na pośladki | max 8 serii bezpośrednich dla pośladków i pleców — partii głównych w wielu slotach. Górna granica jest tą do strojenia (§4.1) |

Limit 8 dla pośladków i pleców **zatwierdzony przez użytkownika 2026-10-02**.

Wynik dla 12 tygodni: dzień 18–25 min ćwiczeń (śr. 22) + rower; każda partia w normie przez
większość dni — pod normą głównie w tygodniach deloadu, czyli zgodnie z planem.

---

## 11. Tydzień do przodu (v1.4, 2026-10-07)

Plan i decyzje: `Documents/PLAN-TYGODNIA-I-POPRAWKI.md` §3.9.

### 11.1 Dwa kroki dnia

`planDay = buildDay(selectDay(...))`. **`selectDay`** decyduje *co*: kwalifikacja slotów, punktacja,
wypełnianie, dopełnienie — wynik to `DaySelection` (slot, ćwiczenie, serie, rola `work` / `light` /
`mobility`, pominięte sloty, kody `LIGHT_DAY` i `LIGHTER_DAY_REQUESTED`). **`buildDay`** decyduje
*ile*: receptę każdego elementu z historii z dnia, w którym dzień jest budowany (progresja, przerwa,
deload, gotowość), kolejność i etykiety, `validatePlan`. Wszystkie testy `planDay` sprzed podziału
przechodzą bez zmian.

### 11.2 Prośby (`plan/constraints.ts`)

| Rodzaj | Działanie |
|---|---|
| `avoid_muscle`, powód `doms` | partia odpada jako główna (`AVOIDED_BY_REQUEST`); praca pomocnicza zostaje — lekki ruch pomaga przy zakwasach (research, dodatek D) |
| `avoid_muscle`, powód `pain` | partia odpada całkiem: główna, pomocnicza, dopełnienie i mobilność |
| `rest_day` / `train_day` | dzień wolny / treningowy wbrew wzorcowi tygodnia |
| `lighter_day` | jedna seria każdego ćwiczenia (`LIGHTER_DAY_REQUESTED`) |

Wzorzec tygodnia (`TrainingWeek.restWeekdays`): przy mniej niż 7 dniach treningowych dzienny cel czasu
rośnie, żeby tygodniowa praca została podobna: `clamp(cel × 7 / dni, min, max)` (`scaledConfig`).

Kody `AVOIDED_BY_REQUEST` i `LIGHTER_DAY_REQUESTED` są poza listami kontraktu czatu v2 — narzędzie
`getPlanExplanation` je pomija do kontraktu v3 (etap E7).

### 11.3 `planWeek` i `checkSelection`

`planWeek` idzie dzień po dniu jak symulacja (§10.6), na prawdziwej historii: dla każdego dnia
przesuwa blok (w pamięci), sprawdza dzień wolny, a zapisany wcześniej wybór dnia **zostawia**, jeśli
`checkSelection` nie zgłasza naruszeń; inaczej wybiera od nowa. Prognoza dnia (`buildDay`) jest
„wykonywana” zgodnie z planem, zanim powstanie dzień następny. Wynik: dni ze statusem `kept` /
`changed` / `new`, naruszeniami i prognozowaną objętością partii.

`checkSelection` to reguły `selectDay` sprawdzone na stanie z dnia: ćwiczenie dozwolone i nadal
wybrane w bloku (`NOT_ALLOWED`, `SELECTION_CHANGED`), blok i faza bez zmian (`BLOCK_CHANGED`),
prośba o lżejszy dzień bez zmian (`REQUEST_CHANGED`), partia nie `RECOVERING` / `DOMS_HIGH` /
`AVOIDED_BY_REQUEST`, limity tygodnia i dnia (`VOLUME_AT_MAX`). Dzień, który stał się wolny:
`REST_DAY`.

### 11.4 Właściwości (testy `week.test.ts`)

- bez zapisanych dni `planWeek` daje te same plany co symulacja dzień po dniu;
- zapisany tydzień przeliczony na tej samej historii zostaje w całości (`kept`);
- dodatkowy trening w poniedziałek z pracą zaplanowaną na wtorek zmienia **tylko wtorek**
  (`RECOVERING`), reszta tygodnia zostaje;
- prośba o pominięcie partii działa tylko w swoich dniach; ból wyklucza też pracę pomocniczą;
- objętość prognozy nie przekracza tygodniowego max żadnej partii.

### 11.5 Zapis tygodnia i transakcje

`computeToday` serializuje synchronizację tygodnia. `planned_days` przechowuje wybór oraz prognozę,
`plan_generations` — powód i różnice, a `plan_constraints` — prośby z zakresem dat. Zapis wyborów,
oznaczenie minionych dni i zapis generacji są jedną transakcją. Aktualizacja prognoz nie tworzy
banera, jeśli wybór ćwiczeń się nie zmienił.

Sterownik Drizzle dla Expo SQLite jest synchroniczny. Callback transakcji musi być synchroniczny,
z jawnym `.run()` / `.all()` / `.get()`; `async` i `await` wewnątrz callbacku kończyły transakcję
przed wykonaniem kolejnych zapytań. Test integracyjny `src/db/__tests__/storage.test.ts` sprawdza
wycofanie zmian po błędzie podczas zapisu tygodnia, zmiany dnia, rotacji bloku, seeda i importu backupu.

### 11.6 Kalendarz

Zakładka Kalendarz zastępuje Trening; dotychczasowa trasa `/(tabs)/workout` pozostaje dla powrotu
z podsumowania sesji. Siatka ma 42 dni i zaczyna tydzień od poniedziałku. Historia jest odczytywana
według `trainingDate`, nie daty rozpoczęcia sesji, z zapytań ograniczonych do widocznej siatki.
Można cofać miesiące bez limitu; daty po `asOf + 6` są nieaktywne.

Arkusz dnia łączy sesje (odsyłacz do szczegółów i liczba serii bez rozgrzewkowych), wszystkie jazdy
oraz dziennik. Przyszłość pokazuje ćwiczenia, serie, czas i odsyłacz do wyjaśnienia tego konkretnego
dnia. Prognoza nie obiecuje przyszłych ciężarów: recepta nadal powstaje z historii w dniu treningu.
Start, wznowienie, dodatkowy trening i szybki wpis roweru są dostępne w arkuszu dzisiejszego dnia.

„Dzień wolny / Jednak trenuję” zamienia pojedynczy wyjątek użytkownika atomowo, nie odwołuje prośby
o pominięcie mięśni i uruchamia przeliczenie od wybranej daty. Ukończony dzień i dzień z sesją
w trakcie nie udostępniają zmiany. Link do zgłaszania zakwasów otwiera formularz E5.

### 11.7 Zgłoszenie zakwasów i bólu (E5)

`assessReport` jest czystą funkcją, nie diagnozą. Czerwone flagi mają pierwszeństwo przed rodzajem
zgłoszenia. Ból stawu / kolana i czerwone flagi zwracają ścieżkę konsultacji, nigdy prośbę do
planera. Brak odpowiedzi o objawach alarmowych nie oznacza ich braku — użytkownik musi odpowiedzieć.

| Zgłoszenie | Zapis i działanie |
|---|---|
| lekkie zakwasy (1–3/5) | zapis `2` w `daily_logs.soreness` wybranych partii; reszta dziennika i inne partie pozostają; bez nowego `avoid_muscle` |
| silne zakwasy (4–5/5) | `avoid_muscle`, powód `doms`, domyślnie dziś i jutro; wykluczenie partii jako głównych |
| ból mięśnia | trzy odpowiedzi o początku, lokalizacji i reakcji na wcześniejszy ruch; `avoid_muscle`, powód `pain`, domyślnie 3 dni; wykluczenie partii głównych i pomocniczych |
| objawy alarmowe / ból stawu | komunikat konsultacyjny; brak zapisu i przeliczenia |

Dla bólu mięśnia pełne wykluczenie obowiązuje także, gdy odpowiedzi przypominają zakwasy. Odpowiedź
„Nie sprawdzałem” jest dozwolona; formularz nie zachęca do wykonania ruchu w celu testowania bólu.
Ograniczenia planu siłowego nie stanowią zezwolenia na bolesny rower ani rozgrzewkę.

Użytkownik widzi partie, działanie i zakres dat przed „Zastosuj”. Zakres obejmuje oba końce, liczony
od daty treningowej; można wybrać 1–3 dni. Termin planera nie jest potwierdzeniem wyleczenia.
Przy zapisie data jest sprawdzana ponownie, żeby zmiana dnia nie przesunęła zgłoszenia bez wiedzy
użytkownika. Link do dziennika przekazuje tę samą datę, także po północy przed granicą dnia.

Odwołanie oznacza `revokedAt` i przeliczenie. Nie kasuje innych zgłoszeń ani wpisu DOMS w dzienniku:
jeśli w dzienniku nadal jest ≥ 4, reguła `DOMS_HIGH` pozostaje. Silne zgłoszenie nie wpisuje dodatkowo
DOMS 4 do dziennika, więc samo nie tworzy drugiej blokady, której odwołanie nie zdejmie.

Zapis i przeliczenie mają osobne wyniki: awaria przeliczenia pozostawia zgłoszenie i informację
o potrzebie ponowienia planu; ponowienie nie wymaga tworzenia kolejnego zgłoszenia. Backup v4
już obejmuje dziennik i ograniczenia, więc E5 nie wymaga migracji ani nowego formatu eksportu.

### 11.8 Dodatkowy trening (E6)

Po ukończeniu dzisiejszej sesji użytkownik może wybrać dodatkowe ruchy. `extraSessionOptions`
sprawdza każdy slot roboczy osobno, na rzeczywistej historii obejmującej dzisiejsze ukończone
serie. Niedostępny slot pokazuje powód: regenerację, DOMS, ograniczenie, maksimum objętości,
brak dozwolonego ćwiczenia albo wymóg wariantu obunóż przy zmęczeniu.

`selectCustom` uruchamia `selectDay` na wskazanych slotach, bez mobilizacji i lekkiego dopełnienia.
Wybór użytkownika zastępuje warunek niedoboru do tygodniowego celu, zachowuje jednak maksima
serii, regenerację, ograniczenia, deload i budżet czasu. Sesja może być krótsza niż 20 minut.
Kilka ruchów dostępnych osobno może nie zmieścić się razem — podgląd ujawnia pominięcia.
`planCustom` buduje receptę przez `buildDay` i `validatePlan`, z obciążeniami z rzeczywistej historii.

Przed startem dane są odczytywane ponownie. Zmieniona recepta lub data wymaga ponownego wyboru;
trwająca sesja jest wznawiana zamiast tworzenia kolejnej. Dzień wolny i brak ukończonego treningu
blokują dodatkową sesję. Zapis zamraża plan z `kind: extra` w `workouts.plan` i wybór w
`planned_days` w jednej transakcji. Klucz po migracji 0007 to `(date, seq)`: główny plan ma
`seq = 1`, dodatkowe sesje `seq >= 2` i `workoutId`. Synchronizacja tygodnia dotyczy tylko
głównego planu. Ukończenie lub porzucenie aktualizuje status powiązanego wpisu; usunięcie sesji
usuwa go kaskadowo. Po ukończeniu reguły synchronizacji minimalnie korygują kolejne dni.

**Historia per sesja (2026-10-08).** Silnik dostaje jedną `HistorySession` na trening, nie na dzień:
sesja główna i dodatkowa z tej samej daty są osobne. Każda reguła mówi jawnie, jak je czyta:
objętość, regeneracja, przerwa i data ostatniej sesji liczą się po datach (bez zmian); progresja
(`prescribe`, `lastLoadsOf`) porównuje **pierwszą ekspozycję ćwiczenia w danym dniu**
(`firstOfEachDay`) — powtórka wieczorem to dodatkowa praca na zmęczeniu, nie test obciążenia;
sygnały zmęczenia §6.1 czytają **dni treningowe** (`byTrainingDay`), więc dwie sesje jednego dnia
nie są „dwiema sesjami z RIR 0 z rzędu”.

FBW A/B nie mają już przycisków startu i nie powstają na nowej instalacji; istniejące szablony
pozostają dla historii i backupu. Format backupu v4 się nie zmienia: sesje zachowują `kind: extra`,
a odtwarzalny plan kalendarza jest po imporcie wyliczany ponownie.

### 11.9 Propozycje trenera (E7)

Kontrakt v3 udostępnia odczyt tygodnia i dwa narzędzia przygotowujące propozycję. Dane wyjściowe
nie zawierają ciężarów, gum, pozycji kotwicy ani celów powtórzeń. `proposePlanChange` przyjmuje
wyłącznie ograniczenia (`avoid_muscle`, `rest_day`, `lighter_day`), zakresy względne w horyzoncie
7 dni i neutralną notatkę. `proposeExtraSession` przyjmuje partie, a dostępne sloty i receptę
wybiera silnik z E6. Model nie przekazuje ćwiczeń ani obciążeń do zapisania.

Narzędzia niczego nie zapisują. Propozycja ma lokalny identyfikator i podgląd: ograniczenia,
daty i różnice ćwiczeń oraz serii, albo receptę dodatkowej sesji bez obciążeń. Karta staje się
aktywna po pełnej odpowiedzi przechodzącej strażniki. Błąd, anulowanie, skrócenie i wycofanie
odpowiedzi nie udostępniają akceptacji. Nowe pytanie i odrzucenie wygaszają starsze podglądy.

„Zastosuj” ponownie ładuje źródło, bieżący blok, zapisane dni i ograniczenia. Inne dane lub
inna data treningowa wygaszają propozycję; nic nie zapisuje się z nowej, nieobejrzanej recepty.
Przy zmianie tygodnia ograniczenia (`source: coach`), blok, dni i generacja (`trigger: coach`)
są jedną transakcją. Identyfikator propozycji jest identyfikatorem generacji — ponowienie nie
tworzy drugiego zapisu. Akceptacja i zwykła synchronizacja współdzielą kolejkę. Akceptacja
dodatkowej sesji korzysta z ponownej walidacji E6 i zapisuje `source: ai_accepted` oraz
`coachProposalId` w `workouts.plan`. Format backupu v4 pozostaje zgodny.

Fakty czatu są odczytywane na nowo przed każdym pytaniem. Narzędzia wiążą względne daty
z datą przekazaną modelowi; zmiana dnia podczas pytania zwraca `date_changed` i wymaga nowego
pytania. Zatrzymanie przed odczytem faktów nie rozpoczyna wywołania modelu.

Prośby są blokowane podczas trwającej sesji. Ukończony dzień pozostaje zamknięty. Dodatkowa
sesja wymaga ukończonego treningu na dziś i dnia treningowego. Zakwasy nieokreślone lub lekkie
nie stają się `avoid_muscle`; narzędzie wymaga jawnych silnych DOMS, a nie wywnioskowanej przez
model diagnozy albo nasilenia. Notatka propozycji przechodzi bramkę tekstową i filtr recept.
Ból stawu/kolana nadal kończy rozmowę stałym komunikatem, bez narzędzi i sieci.

Wybranie „Jednak trenuję” w kalendarzu odwołuje dotyczący tego dnia fragment przyjętego
`rest_day` trenera. Pozostałe daty prośby i ograniczenia mięśni są zachowane; rozcięcie zakresu
i zapis wyjątku są jedną transakcją.
