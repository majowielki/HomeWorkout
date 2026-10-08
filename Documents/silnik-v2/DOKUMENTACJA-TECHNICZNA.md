# Silnik v2 — dokumentacja techniczna

Opisuje to, **co jest w kodzie**, nie to, co zaplanowano. Plan i uzasadnienia: pakiet
[architektura-silnika-2026-10-08](../../../architektura-silnika-2026-10-08/README.md) (spec. v1.3). Postęp: [POSTEP.md](POSTEP.md).
Sekcje „Zaimplementowane” rosną razem z etapami; „Stan przed przebudową” opisuje punkt wyjścia, żeby było wiadomo, co się zmienia.

## 1. Zasady, których kod się trzyma

1. **Domena jest czysta.** `src/domain/**` nie importuje Reacta, Expo, Drizzle ani nie czyta zegara. Czas wchodzi jako parametr
   (`asOf`, `now`, `PlanningClock`). Granicę pilnuje `no-restricted-imports` w ESLint i `src/__tests__/architecture.test.ts`.
2. **Deterministycznie.** Te same dane wejściowe i wersje dają ten sam plan. Remisy rozstrzyga jawny klucz, nie kolejność z bazy.
3. **Silnik rekomenduje, nie odrzuca wykonalnego** (D18). Reguły mają klasę `hard` (bezpieczeństwo, ból, sprzęt, „nie proponuj”)
   albo `advice` (objętość, regeneracja, czas). Planer sam nie łamie żadnej; prośbę użytkownika odradza z liczbami i realizuje po potwierdzeniu.
4. **Plan ≠ wykonanie.** Cel nigdy nie staje się wynikiem bez czynności użytkownika albo pomiaru (02 §3).
5. **Brak danych to brak danych**, nie porażka i nie sukces: wstrzymanie z kodem powodu.
6. **Parametry są polityką**, nie ukrytą stałą: żyją w `src/domain/config/training.ts` i będą wersjonowane (`policyVersion`).
7. **Kody decyzji mówią prawdę.** Kod spadku oporu pojawia się tylko, gdy opór się naprawdę zmienił (D39 e).

## 2. Stan przed przebudową (`main` @ `33d0f1e`)

| Obszar | Pliki (`src/domain/…`) | Rola |
|---|---|---|
| Katalog i typy | `types.ts`, `plan/types.ts`, `plan/slotCatalog.ts`, `inventory.ts` | `Exercise`, `PlannedLoad` (`dumbbell`/`band`/`bodyweight`), `Slot`, sprzęt (hantle, gumy) |
| Progresja | `progression/{history,doubleProgression,ladder,prescribe,layoff,calibration,load,bike}.ts` | podwójna progresja nad drabinką oporu; powrót po przerwie; kalibracja gum |
| Dobór dnia | `plan/{dayPlanner,eligibility,estimate,validatePlan,reasons,dayState}.ts` | `selectDay` → `buildDay` → `validatePlan`; greedy po wyniku (deficyt objętości, zaległość slotu) |
| Tydzień i blok | `plan/{week,weekSync,block,constraints,today}.ts` | prognoza 7 dni, prośby (`PlanConstraint`), blok 35 dni, deload 28+7 |
| Dodatkowe sesje | `plan/{extra,compose}.ts` | `selectCustom`, `planCustom`, `composeDay`, `dayOptions` |
| Wykonanie | `session/{steps,sides,warmup}.ts` | kroki sesji, strony, rozgrzewka |
| Autoregulacja | `autoregulation/fatigue.ts` | sygnały zmęczenia |
| Objętość | `volume/weekly.ts` | serie bezpośrednie i tygodniowe maksima |
| Konfiguracja | `config/training.ts` | wszystkie liczby (`PLANNER_CONFIG`, `PROGRESSION_CONFIG`, `BLOCK_CONFIG`, …) |
| Czas | `time/trainingDate.ts` | dzień treningowy (granica 04:00), `addDays`, `daysBetween` |

Przepływ dziś: `loadPlannerSource` (DB) → `buildPlanningSnapshot` → `syncWeek` / `planWeek` → `selectDay`/`buildDay` → plan zapisany
jako JSON w `workouts.plan` → `set_logs` → `plannerSource` odtwarza `HistorySession` → `prescribe`. Utrata informacji między DB a domeną
(brak pełnej recepty, roli, `shortfall`) to główny temat P2/P3.

### 2.1 Punkty wejścia planowania (P0.2)

Stan z 2026-10-09 (`33d0f1e` + P0.3/P0.4/P0.7). Lista sprawdzona wyszukiwaniem użyć, nie samych eksportów `plan/`. To jest mapa dla P4.2 („jedno wejście do planowania dla wszystkich intencji”) i P4.7 (tryby audytu).

**Planowanie — jak powstaje plan**

| Wejście | Plik | Co robi | Gdzie używane w aplikacji |
|---|---|---|---|
| `syncWeek` → `planWeek` | `domain/plan/weekSync.ts`, `week.ts` | tydzień: dzień po dniu `selectDay` / `checkSelection` (dni zachowane) / `composeDay` (dzień złożony z trenerem) → `buildDay` | `features/plan/computeToday.ts` (ekran Dziś, zapis tygodnia), `features/plan/coachPreview.ts` (podgląd propozycji trenera, opcje dnia), `features/coach/chat/proposals.ts` (narzędzie `week`) |
| `planCustom` / `selectCustom` / `extraSessionOptions` / `slotsForFocus` | `domain/plan/extra.ts` | sesja dodatkowa: tylko wskazane sloty, bez uzupełniaczy | `features/extra/actions.ts`, `ExtraSessionPicker.tsx`, `ExtraSessionScreen.tsx`, `coach/chat/proposals.ts` (`proposeExtra`) |
| `composeDay` / `dayOptions` | `domain/plan/compose.ts` | dzień złożony z trenerem (ADR 0006) | tylko przez `planWeek` |
| `planDay` | `domain/plan/dayPlanner.ts` | `selectDay` + `buildDay` jednego dnia | `planToday` (używany tylko przez `ai/testing/plan.ts`), `simulate` — **aplikacja nie woła go bezpośrednio** |
| `validatePlan` | `domain/plan/validatePlan.ts` | jedyny „audyt”: przycina i koryguje plan (sprzęt, zakresy, skoki, objętość, czas) i **zwraca skorygowany plan**, nie listę naruszeń | wyłącznie w `buildDay`; nie jest wołany przy starcie sesji |
| `resolveDayPolicy` | `domain/policy/dayPolicy.ts` | efektywny config dnia (P0.4) | `planWeek`, domyślnie `extra.ts` i `compose.ts` |

**Start sesji i zapis**

| Wejście | Plik | Re-walidacja przy starcie? |
|---|---|---|
| `startPlannedWorkout(plan, trainingDate)` | `db/repositories/workouts.ts`, wołany z `features/plan/usePlanToday.ts` | **nie**: zapisuje plan ze stanu ekranu, jaki dostał; zamraża go w `workouts.plan` |
| `startExtraWorkout(plan, selection)` | `db/repositories/workouts.ts`, z `features/extra/actions.ts` | **tak, po stronie wywołującego**: `startExtraSession` czyta świeży snapshot, planuje ponownie, porównuje JSON z podglądem i datę (`ExtraSessionChangedError`) |
| propozycja trenera (tydzień) | `saveCoachWeek` w `db/repositories/weekPlan.ts`, z `proposals.ts` | porównanie klucza snapshotu (`planningSnapshotKey`) przed zapisem |
| szablon ręczny | — | nie ma ścieżki startu: `templateId` jest zawsze `null` w obu funkcjach startu; szablony (`workout_templates`) służą dziś tylko historii sprzed M7 |
| import kopii | `lib/backup.ts` → `db/backup/parse.ts` → `db/repositories/backup.ts` | tylko walidacja formatu kopii; plany z kopii nie przechodzą przez silnik |

**Wnioski dla etapów**

1. P4.2: do ujednolicenia są dwa światy — tydzień (`planWeek`, który sam wybiera config) i sesja dodatkowa (`extra.ts`, wyliczana od nowa przy starcie). Wspólny punkt to `resolveDayPolicy` (P0.4) i `PlannerInput`.
2. P4.7: plan dnia automatycznego nie jest sprawdzany ponownie przy starcie. Plan v2 wymaga trybu `start_session` (02, 01 §5).
3. Historia do progresji powstaje w `db/repositories/plannerSource.ts` z serii sesji `completed`; tam ginie pełna recepta (P2/P3).

## 3. Mapa modułów v2

Docelowa mapa plików to 13 §0. Status:

| Moduł | Spec. | Etap | Stan |
|---|---|---|---|
| `time/trainingDate.ts` — `trainingDateOf` | 13 §1 | P0.3 | ☑ |
| `policy/dayPolicy.ts` — `resolveDayPolicy` | 13 §2 | P0.4 | ◐ (warstwy: baza, tydzień, intencja) |
| `policy/hardAdvice.ts`, `policy/registry.ts` | 12 §2, 13 §5 | P1 | ☐ |
| `observations/{types,normalize,qualify}.ts` | 13 §3–4 | P1 (typy), P3 | ☐ |
| `progression/{next,failedRungs,axes,calibration,probe,buildUp}.ts` | 13 §5–8, 16, 20 | P3 | ☐ |
| `catalog/{variants,resolve}.ts`, `medical/screeners.ts` | 13 §9–11 | P1, P4b | ☐ |
| `preferences/preferences.ts`, `plan/sets.ts` | 12 §3–5 | P1, P3 | ☐ |
| `history/index.ts` | 13 §13 | P2/P3 | ☐ |
| `session/{assess,effort,simulateProposal}.ts` | 11, 13 §12 | P4b, P5 | ☐ |
| `plan/reactiveDeload.ts`, `volume/{weights,lever}.ts` | 13 §17–19 | P3 | ☐ |
| `app-services/commands/*` | 13 §14, 11 §6 | P2, P4b | ☐ |

## 4. Zaimplementowane

### 4.1 Dzień treningowy (P0.3)

`src/domain/time/trainingDate.ts`

- `trainingDate(now, boundaryHour)` — dzień treningowy w strefie urządzenia. Przed godziną graniczną jest to poprzednia **data kalendarzowa** według lokalnych getterów (`getHours`, `getDate`), a nie "instant minus N godzin": stara arytmetyka myliła się o godzinę w dwie noce zmiany czasu (2026-10-25 03:30 CET dawało 25., a ma być 24.; 2026-03-29 04:00 CEST dawało 28., a ma być 29.). Niepoprawny `Date` i godzina spoza 0–23 dają `RangeError`.
- `trainingDateOf(instant, timeZone, boundaryHour)` — ta sama reguła w jawnej strefie IANA przez `Intl.DateTimeFormat` (`hourCycle: h23`). Do zapisu strefy sesji i do testów niezależnych od maszyny. Nieznana strefa → `RangeError`.
- Godzina powtórzona (02:00–02:59 dwa razy) i pominięta mapują się według zegara ściennego; granica w pominiętej godzinie zaczyna dzień od pierwszego istniejącego czasu.
- Dzień sesji jest zamrażany przy starcie (`plan.date`); żaden kod nie przelicza go później (T04).

### 4.2 Efektywna polityka dnia (P0.4)

`src/domain/policy/dayPolicy.ts`

```ts
resolveDayPolicy(base: PolicyBase, week: TrainingWeek | undefined, intent: PlanIntent): DayPolicy
// PolicyBase = { planner: PlannerConfig; training: typeof TRAINING_CONFIG }
// DayPolicy  = PolicyBase & { intent }
```

Warstwy, każda tylko zawęża poprzednią: **baza** od wywołującego → **wzorzec tygodnia** (`scaledConfig`: mniej dni treningowych = dłuższy cel sesji w granicach min/max dnia) → **intencja**. Intencje jawne (`extra`, `compose`, `session_change`) mają `sessionMinutes = { min: 0, target: max, max }` i `forceStaleDays = 0`: prośba może przekroczyć tygodniowy cel, nigdy maksimum. `auto_day` i `template` zostają przy wartościach po skalowaniu.

Kto z czego korzysta:

| Ścieżka | Polityka |
|---|---|
| `planWeek` → `selectDay`, `buildDay`, `checkSelection` | `auto_day` z configu przekazanego do `planWeek` |
| `planWeek` → `composeDay`, `dayOptions` | `compose` z tego samego configu |
| `selectCustom`, `extraSessionOptions`, `slotsForFocus`, `planCustom` | domyślnie `extra` z `BASE_POLICY` i `input.week`; wywołujący może podać własną |

Przed zmianą ścieżki `selectCustom`/`composeDay`/`dayOptions` czytały globalne `PLANNER_CONFIG`, więc config przekazany do `planWeek` (np. krótszy limit czasu) obowiązywał dzień automatyczny, a dzień złożony z trenerem już nie. `PlannerInput` ma teraz opcjonalne `week`. W aplikacji dziś wszyscy używają domyślnego configu, więc wynik planów się nie zmienia (golden baseline P0.1 to potwierdzi); poprawka dotyczy każdego innego configu: testów, przyszłych profili objętości i preferencji.

Kolejne warstwy z 13 §2 (profil objętości `higher`, preferencja liczby serii, `phase`, `constraints` jako argumenty) dochodzą razem z funkcjami, które je czytają (P1, P3); do tego czasu faza i prośby dnia są czytane przez planer z bloku i logów.

### 4.3 Uczciwy kod na minimum oporu (P0.7, D39 e)

`doubleProgression` zwraca `PERFORMANCE_REGRESSION` (tekst „szczebel lżej”) tylko wtedy, gdy `ladder.down` istnieje, czyli opór naprawdę się zmienia. Na masie ciała, najlżejszym szczeblu hantli i najlżejszej gumie (pozycja 0 żółtej) obie sesje pod zakresem traktowane są jak każda ekspozycja poniżej góry zakresu: ten sam opór, kod `REP_PROGRESSION`, cel nie niżej niż dół zakresu. Strategia się nie zmienia; to jest wyłącznie przejściowa naprawa nieprawdziwego komunikatu. Docelowe zachowanie (budowanie do zakresu od wyniku, kody `AT_MINIMUM`, `BUILDUP_BELOW_RANGE`, karta wariantu w dół) wchodzi w P3 (13 §20).

### 4.4 Baza pomiarowa (P0.1, P0.5)

- **Golden baseline** `src/domain/__tests__/engineBaseline.test.ts` + snapshot (ok. 190 KB, czytelny tekst): 5 scenariuszy symulacji na katalogu z `data/` — 12 tygodni z kolanem wg wyboru użytkownika, 8 tygodni z kolanem konserwatywnym, 10 tygodni z niedzielami wolnymi i osobą, która co piątą serię robi o powtórzenie mniej i co siódmą „do odmowy”, miesiąc przerwy (RE_EXPOSURE, rekalibracja) oraz test determinizmu. Każda decyzja planu (ćwiczenie, serie, cel, opór, RIR, kody, pominięte sloty, korekty walidatora) jest linią tekstu. Zmiana planu = czytelny diff.
- **Porównanie z kodem sprzed przebudowy** (`33d0f1e`): po P0.3, P0.4 i P0.7 snapshot różni się **jedną linią** — `band-pull-apart … yellow P0`: `PERFORMANCE_REGRESSION` → `REP_PROGRESSION` (naprawa z P0.7: najlżejsza guma nie ma szczebla w dół). Zero innych zmian planów, więc P0.3 i P0.4 nie zmieniają zachowania aplikacji.
- **Manifest** `npm run engine:baseline` (`scripts/engine-baseline.ts`): commit, gałąź, lista zmienionych plików (stan roboczy!), skróty SHA-256 konfiguracji, katalogu i snapshotu. Zapisany stan wyjściowy: `Documents/silnik-v2/baseline/manifest-2026-10-09.json`.
- **Czas planowania** `npx tsx scripts/engine-bench.ts` (node 22, PC; telefon → UWAGI T-2), p50 / p95 w ms, 20 przebiegów:

| Historia | `planDay`, cała historia | `planWeek` 7 dni, cała | `planDay`, ostatnie 120 dni | `planWeek`, ostatnie 120 dni |
|---|---|---|---|---|
| 4 tygodnie (28 sesji, 340 serii) | 1,2 / 1,7 | 9,2 / 11,1 | 0,9 / 1,1 | 8,7 / 9,8 |
| rok (365 sesji, 4319 serii) | 5,9 / 6,4 | 44,5 / 46,5 | 2,3 / 2,6 | 18,3 / 19,2 |
| 3 lata (1095 sesji, 12928 serii) | 16,7 / 17,8 | 127,1 / 129,1 | 2,2 / 2,6 | 17,9 / 18,9 |

  Koszt rośnie liniowo z liczbą sesji, a okno 120 dni, które aplikacja czyta dziś, trzyma go na ok. 2 ms (dzień) i 18 ms (tydzień). Wniosek dla P2: odczyt „ostatnia porównywalna ekspozycja per klucz” spoza okna (02 §7) trzeba robić osobnym zapytaniem, a nie poszerzaniem okna, bo cała historia za trzy lata to 130 ms na tydzień w node.

## 5. Konwencje testów

- Jest (`jest-expo`), pliki `src/**/__tests__/*.test.ts`. Pokrycie `src/domain/**` i `src/ai/**` = 100% (próg w `jest.config.js`).
- Testy są nazwane numerami z korpusu: `describe('T01 …')`, żeby da się było odnaleźć przypadek odbioru ze specyfikacji (08 §3).
- Fixtury domeny: `src/domain/__tests__/fixtures.ts`, `extraFixtures.ts`. Nie importować `Date.now()` w kodzie domeny; testy podają daty jawnie.
- `npm run verify` = lint + format:check + routes:types + typecheck + validate:data + test:coverage. Przed zamknięciem etapu zielony.
- Golden baseline silnika: `src/domain/__tests__/engineBaseline.test.ts` (§4.4). Zmiana wyniku wymaga świadomej regeneracji
  skrótu i wpisu w UWAGI.
