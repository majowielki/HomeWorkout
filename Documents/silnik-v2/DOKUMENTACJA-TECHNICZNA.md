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
| `policy/hardAdvice.ts` (klasy reguł, werdykt), `policy/registry.ts` (polityki, zdolności) | 12 §2, 13 §5 | P1 | ☑ |
| `observations/{types,exposure}.ts` | 13 §3 | P1 | ☑ |
| `observations/{normalize,outcome,project}.ts`, `commands/result.ts`, `history/index.ts` | 13 §3, §13, 10 §1 | P2 | ☑ |
| `observations/qualify.ts` | 13 §4 | P3 | ☐ |
| `db/repositories/{sessionsV2,historyV2,ledger,engineMigration}.ts` | 13 §14, 02 §5–§8a | P2 | ☑ |
| `resistance/{types,ladderModel,models,registry,legacy,compare}.ts` | 05 §5–§8 | P1 | ☑ |
| `equipment/types.ts` | 05 §4 | P1 | ☑ |
| `plan/{planV2,ids}.ts`, `fingerprint/*` | 02 §1–2, 01 §4 | P1 | ☑ |
| `progression/{next,failedRungs,axes,calibration,probe,buildUp}.ts` | 13 §5–8, 16, 20 | P3 | ☐ |
| `catalog/{attributes,variants,validate}.ts`, `medical/screeners.ts` | 13 §9–10, 05 §13–14 | P1 | ☑ |
| `catalog/resolve.ts` (`resolveExerciseRef`) | 13 §11 | P4b | ☐ |
| `preferences/preferences.ts` (model, `preferenceScore`, `nearEquivalent`) | 12 §3–4 | P1 | ☑ |
| `chooseBlockVariant`, `plan/sets.ts` (`recommendSets`) | 12 §4.2, §5 | P3 | ☐ |
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

### 4.5 Odcisk wejścia (P1.2)

`src/domain/fingerprint/` — `canonicalize(value)` daje jeden tekst dla tych samych danych: klucze obiektów w porządku kodowym, tablice w zadanej kolejności, `Set` posortowany, brak jako jawne `null`, liczby skończone (`-0` → `0`). Odmawia (`CanonicalizationError` ze ścieżką do miejsca): `undefined`, `NaN`, `Infinity`, funkcji, `Date`, instancji klas, `bigint`, `symbol`, klucza `$set` w zwykłym obiekcie. `sha256Hex` to własna implementacja FIPS 180-4 (domena nie importuje `crypto`), sprawdzona na wektorach testowych i na losowych tekstach względem Node. `fingerprint(value)` = SHA-256 tekstu kanonicznego; `fingerprintWithout(obj, …pola)` pomija własne pole skrótu planu (01 §4).

### 4.6 Modele oporu (P1.4–P1.6)

`src/domain/resistance/`

- `types.ts`: `ResistanceValue` (zod, 5 rodzajów: `external_mass` w gramach z konwencją `total`/`per_hand`, liczbą przyrządów i opcjonalnym `display` dla lb; `band_position`; `machine_setting`; `bodyweight` z masą dodaną i **wspomaganiem** (więcej = łatwiej); `ordinal`), `ResistanceSpec`, interfejs `ResistanceModel` (`validate`, `levels`, `compare`, `nextHarder`, `nextEasier`, `resourceDemand`, `comparisonSignature`, `relativeStep`, `capabilities`).
- `ladderModel.ts`: `createLadderModel` — wspólna budowa modelu dla sprzętu o stałych krokach; kierunek trudności daje funkcja `effort` (dla wspomagania odwrotna do liczby na tarczy).
- `models.ts`: `dumbbell.paired`, `dumbbell.single`, `band.long`, `bodyweight` zbudowane **na** drabinkach v1 (`dumbbellLadder`, `bandLoadLadder`), więc nie mogą się z nimi rozjechać; test przechodzi po wszystkich szczeblach obu.
- `registry.ts`: statyczny rejestr (`createResistanceRegistry`, `defineModel`); nieznany identyfikator = `unknown_model`, a nie zastępczy model. Nowy sprzęt = jeden wpis, bez zmian w doborze dnia (test: sztanga dodana tylko przez rejestr).
- `legacy.ts`: `specFromLoad` / `loadFromSpec`; sprzęt, którego v1 nie wyrazi (sztanga, stos, wspomaganie, kamizelka, inna geometria gumy), daje `null`, nigdy „0 kg”.
- `compare.ts`: `resistanceComparisonKey` i `compareSpecs` — inna maszyna, przełożenie wyciągu (`configurationKey`), geometria gumy albo konwencja hantli dają `incomparable` mimo tej samej liczby (T49).
- `relativeStep(from, to)`: ułamek, o jaki `to` jest cięższe (hantle: stosunek mas; guma: stosunek szczytowych sił, **null** bez kalibracji; masa ciała, wspomaganie, stos: null). Podstawa próby szczebla (P3).

Wspólny zestaw testów kontraktu (`__tests__/resistanceContract.ts`) działa na 12 modelach: produkcyjnych (guma dwa razy: bez kalibracji i skalibrowana) i atrapach sprzętu z `resistanceFixtures.ts`: sztanga w kg i w lb (talerze w parach, najmniej talerzy na stronę), kettlebell pojedynczy i para, stos 10/15/22,5/30, wspomaganie 40…0 kg, kamizelka.

### 4.7 Plan i wynik v2 (P1.1–P1.3)

`src/domain/plan/planV2.ts`, `ids.ts`, `src/domain/observations/`

- Identyfikatory: `s1/r1/e1` (ekspozycja), `s1/r1/e1/2` (seria logiczna), `s1/r1/e1/2L` (jedna strona). Rewizja w identyfikatorze to rewizja, w której element **powstał**; późniejsza rewizja może dodać serię do ekspozycji (identyfikator serii nowszy niż ekspozycji, nigdy starszy).
- `sessionPlanV2Schema` sprawdza spójność wewnętrzną: unikalne identyfikatory, serie należą do sesji i ekspozycji, żadna z przyszłej rewizji, strona w id = strona serii, role (tylko seria `work` bywa `requiredForProgression`: rozgrzewka, `backoff`, praktyka, mobilność i próba nie zastępują serii roboczej), **każda zaplanowana seria jest wykonywana dokładnie raz** w krokach, czas: części sumują się do `exerciseTotal`, a `overall` = ćwiczenia + rower (niezmiennik 12). Czy plan jest *dozwolony* (sprzęt, limity, profil), rozstrzyga audyt (P4), nie schemat.
- `observed(...)`: wartość z pochodzeniem. Reguły sprzeczności: pomiar tylko z czujnika; niezmieniona podpowiedź (`presentedDefault`) jest *potwierdzeniem*, nie zgłoszeniem; `edited` = zgłoszone przez osobę i nie jest podpowiedzią; `legacy_unknown` tylko z danych starych lub zaimportowanych. Seria `performed` ma coś w sobie — próba z zerem to `interrupted`. `rir.value = null` to „nie podano”, osobny fakt od zera.
- `ExposureRecord` i `ExposureOutcome` to na razie tylko typy (normalizator: P3).

### 4.8 Katalog v2 (P1.8)

`src/domain/catalog/`, `data/exercises.json`, `data/exercises.schema.ts`

- Pola opcjonalne w ćwiczeniu: `aliases`, `equivalenceGroup`, `progressions` (krawędzie `harder`/`easier`, zapisywane w jedną stronę — graf dodaje odwrotną), `jointLoading`, `secondaryWeights`. `equipmentFamily` i obciążenie kolana są *wyliczane* (`equipmentFamilyOf`, `loadsJoint`), nie przechowywane.
- `loadsJoint`: kolano wg `loadsKnee`, każdy inny staw `'unknown'` dopóki ktoś nie powie — nieznane to nie „nie”. `repCapOf`: 25, a 20 przy kolanie (`PROGRESSION_CONFIG.repCap`). `secondaryWeightOf`: osoba → katalog → 0,5.
- `buildVariantGraph`, `nextVariant` (tylko warianty, które przeszłyby kwalifikację planu: kolano, „nie proponuj”, archiwum, sprzęt; potem wynik preferencji, potem kolejność katalogu).
- `catalogueProblems` (`npm run validate:data`): **błędy**: krawędź donikąd, do siebie, zdublowana, sprzeczna, cykl w `harder`, różne jednostki (powt. vs sekundy), brak wspólnego mięśnia głównego, alias znaczący już coś innego, waga dla mięśnia niebędącego pomocniczym; **ostrzeżenia**: krawędź między slotami, ćwiczenie core bez łatwiejszego wariantu (`NO_EASIER_VARIANT`), grupa równoważności jednoosobowa lub między slotami; **informacje**: ćwiczenia z masą ciała na sufitie (bez `harder`).
- Dane: 36 krawędzi `harder` dla 33 ćwiczeń (core, pompki, mostki, zawias, przysiad). Stan: 18 ostrzeżeń `NO_EASIER_VARIANT` (część to najłatwiejsze w swoich łańcuchach, np. `dead-bug-legs-only`, `kneeling-plank-on-elbows`), 23 ćwiczenia na suficie.

### 4.9 Screenery per staw (P1.9)

`src/domain/medical/screeners.ts` — `Screener` (staw, pola wymagane, `loads`, `screen`), `SCREENERS = [kneeScreener]` (to samo co `screenExercise`, sprawdzone na 151 ćwiczeniach × 3 profilach), `screenAll`. Ćwiczenie obciążające staw opisany w profilu (albo o nieznanym obciążeniu), bez wymaganych faktów, dostaje `MISSING_CLASSIFICATION` i nie jest dopuszczone.

### 4.10 Reguły, preferencje, zdolności, sprzęt (P1.7, P1.10)

- `policy/hardAdvice.ts`: `RULE_CLASS` — jedna tabela klas (`hard`/`advice`/`info`) dla planera, audytu, oceny w sesji i AI; `finding(code, status, data)` nadaje klasę z tabeli (wywołujący nie wybiera); `verdictOf` (11 §3: niejednoznaczne → `needs_clarification`, błąd twardy → `blocked`, błąd rady → `not_recommended`, ostrzeżenie lub zmiana prośby → `ok_with_changes`); `adviceToAcknowledge` / `unacknowledged` — co użytkownik musi zobaczyć i potwierdzić (D19).
- `preferences/preferences.ts`: `TrainingPreferences` (zod), `defaultPreferences`, `preferenceScore` (ćwiczenie ±2 przed sprzętem ±1), `nearEquivalent` (grupa jawna albo ten sam slot, ta sama jednostka i mięśnie główne, `substituteScore` ≥ 70 w obie strony; `PREFERENCE_CONFIG`).
- `policy/registry.ts`: `PROGRESSION_POLICIES` (`reps_then_resistance` v2) i `canPlanAutomatically` — przecięcie zdolności modelu, polityki, runnera i loggera; zwraca *które* brakuje (`UNKNOWN_MODEL`, `LOGGER_MODEL` …). `CURRENT_RUNNER` i `CURRENT_LOGGER` opisują stan aplikacji i **zmienia się je razem z loggerem**, nigdy przed nim.
- `equipment/types.ts`: `EquipmentInstance`, `EquipmentRequirement` (zdolność z ilością i ustawieniami, konkretna instancja, jedno z kilku) i `requirementsMet` — rzecz liczy się tylko do jednego wymagania, tylko dostępna i tylko w miejscu sesji, z nawrotami przy alternatywach.

### 4.11 Warstwa danych v2 (P2)

**Schemat** (migracja `0010_engine_v2_storage.sql`, kopia zapasowa `BACKUP_SCHEMA_VERSION = 7`):

- `workouts` + `plan_schema` (1 = plan pierwszego silnika w `plan`, 2 = `planV2`), `plan_v2`, `plan_revision`, `revision` (licznik sesji; od niego zależy każde polecenie), `time_zone`.
- `set_logs` + `command_id` (unikalny), `planned_set_id`, `exposure_id`, `logical_set_id`, `role`, `comparison_key`, `progression_scope`, `source`, `performed_on`, `revision`, `deleted_at` (nagrobek), `observation` (pełny `SetObservation` z pochodzeniem pól). Indeks częściowy: **jeden bieżący wynik na zaplanowaną serię** (`workout_id, planned_set_id WHERE deleted_at IS NULL`). Kolumny `reps`, `weight_kg` itd. są wypełniane z wyniku (`legacyColumns`), więc dotychczasowe ekrany czytają sesję v2 bez zmian (T52); sprzęt nieobecny w v1 zostawia je puste, nie zapisuje „0 kg”.
- Nowe tabele: `set_log_revisions` (co korekta zastąpiła), `set_dispositions` (pominięcia), `exposure_outcomes` (rzut, do odbudowania), `command_ledger`, `planning_revisions` (liczniki wejść: history, profile, catalog, inventory, requests, block, preferences), `session_plan_revisions`, `feel_reports`, `preferences`, `legacy_sessions`, `app_state` (generacja silnika danych tej instalacji).

**Polecenia** (`sessionsV2.ts`; każde = jedna transakcja; odpowiedź `CommandResult`): `startSessionV2`, `logSetV2`, `skipSetsV2`, `updateSetV2`, `undoSetV2`, `recordFeelV2`, `closeSessionV2`. Zasady wspólne:

1. **Ledger.** Ten sam `commandId` zwraca zapisaną odpowiedź (`already_committed`) i niczego nie zmienia. Wyjątek: polecenie, którego wynik cofnięto, daje `COMMAND_SUPERSEDED` (nie wskrzesza go).
2. **Rewizja.** Polecenia zapisu serii niosą `expectedSessionRevision`; inna wartość = `SESSION_CHANGED`, bez zapisu. Korekta używa rewizji wyniku (`STALE_INPUT`).
3. **Walidacja przed zapisem**, z bazy w tej samej transakcji: plan sesji, przynależność serii, schemat wyniku (sprzeczne pochodzenie, wynik pusty jako „wykonany” → `INVALID_COMMAND`).
4. **Awaria sklepu** (wyjątek w środku transakcji) wycofuje wszystko i daje `storage_error`, `retryable`; ponowienie tego samego polecenia zapisuje raz (sprawdzone wyzwalaczem wstrzykującym błąd w `set_logs`, `exposure_outcomes` i `command_ledger`).
5. Licznik zużycia gumy rośnie raz na nowy wynik, nigdy przy ponowieniu.
6. Zamknięcie sesji nie dopisuje niczego dla serii niewykonanych: zostają bez wyniku, a `exposure_outcomes` liczy je jako pominięte.
7. Jeden aktywny trening naraz (`ACTIVE_SESSION_EXISTS`). Korekty działają także po zakończeniu sesji.

**Odczyt** (`historyV2.ts`): `loadWindow(od)` – sesje v2 od daty, znormalizowane do `ExposureRecord`; `loadLastComparableBefore(przed)` – dla każdego klucza najnowsza ekspozycja primary sprzed daty (zapytanie `GROUP BY comparison_key`, bez limitu dni, T34); `loadHistoryForPlanning` – jedno i drugie.

**Czytniki pierwszego silnika** (`plannerSource`, `coachSource`, `setLogs`, `calendar`) pomijają nagrobki (`deleted_at`).

**Przejście na silnik v2** (`engineMigration.ts`, D21): `migrateToEngineV2(sink)` – archiwum (pełna kopia 7 jako `homeworkout-v1-archive-<data>.json`) → odczyt z powrotem i parsowanie → dopiero wtedy w jednej transakcji kasuje sesje, serie, bloki, tydzień, prośby, rowery i księgę poleceń oraz ustawia `app_state.engine_generation = 2`. Zostają: profil (kolano, granica dnia, lista „nie proponuj”), gumy z kalibracją i zużyciem, dziennik poranny, waga, pomiary, szablony, diagnostyka AI, preferencje. Błąd na dowolnym kroku przed ostatnim zostawia dane nietknięte (zapis, odczyt, zgodność pliku, sama transakcja — każdy sprawdzony). `importLegacySessions` wkłada zakończone sesje z archiwum do `legacy_sessions` (do wglądu; idempotentnie). `src/lib/engineMigration.ts` opakowuje to plikiem w katalogu dokumentów aplikacji i stałą **`ENGINE_V2_RESET_ENABLED = false`**.

**Harness SQLite:** `src/db/__tests__/sqlite-harness.cjs` (wspólny), `sqlite-check.cjs` (19 przypadków pierwszego silnika), `sqlite-check-v2.cjs` (27 przypadków v2); `storage.test.ts` zamienia każdy w osobny test Jesta.

## 5. Konwencje testów

- Jest (`jest-expo`), pliki `src/**/__tests__/*.test.ts`. Pokrycie `src/domain/**` i `src/ai/**` = 100% (próg w `jest.config.js`).
- Testy są nazwane numerami z korpusu: `describe('T01 …')`, żeby da się było odnaleźć przypadek odbioru ze specyfikacji (08 §3).
- Fixtury domeny: `src/domain/__tests__/fixtures.ts`, `extraFixtures.ts`. Nie importować `Date.now()` w kodzie domeny; testy podają daty jawnie.
- `npm run verify` = lint + format:check + routes:types + typecheck + validate:data + test:coverage. Przed zamknięciem etapu zielony.
- Golden baseline silnika: `src/domain/__tests__/engineBaseline.test.ts` (§4.4). Zmiana wyniku wymaga świadomej regeneracji
  skrótu i wpisu w UWAGI.
