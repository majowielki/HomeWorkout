# Silnik — dokumentacja techniczna

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

## Stan bieżący — 2026-10-09, P6

Aplikacja korzysta z jednego silnika. Plan dnia i tygodnia, sesja dodatkowa, logger,
historia, kalendarz, zakwasy, narzędzia AI oraz ewaluacje używają skompilowanego planu.
Stare planowanie i reset danych są usunięte. Numery kontraktów danych pozostają:
plan ma `schemaVersion: 2`, Worker `contractVersion: 7`, backup `schemaVersion: 8`.

Weryfikacja kodu: `npm run verify` — 166 zestawów / 3774 testy / 5 snapshotów,
100% statements/branches/functions/lines w domenie i AI. Worker: 5 zestawów / 146 testów.
Usunięcie testów dawnych implementacji i promptu podsumowania v2 zmniejsza liczbę testów;
progi pokrycia nie zostały zmienione.

Migracja `0014_activate_engine` zachowuje historię, serie, korekty, pominięcia,
oceny ekspozycji, rewizje planu, odczucia i jazdy. Zamyka historyczne sesje w toku,
zachowuje nazwy dawnych szablonów w `workouts.plan.title`, usuwa `template_id`,
`workout_templates`, dawny tydzień i `app_state`. Bieżący tydzień używa
`planned_days` / `plan_generations`, plan sesji — `session_plan`.
Przebudowa tabeli nadrzędnej przechowuje wszystkie dane podrzędne w tabelach tymczasowych,
ponieważ migrator pracuje w transakcji z włączonymi kluczami obcymi. Test SQLite obejmuje
zachowanie tych danych oraz rollback po błędzie przy odtwarzaniu.

Odbiór emulatora i wspólne wydanie Workera / APK są wykonane; dowody oraz
checklista są w [ODBIOR-P6](ODBIOR-P6.md). Pozostaje test telefonu użytkownika.
P6 nie jest oznaczony jako zamknięty przed potwierdzeniem tego odbioru.

## 2. Przepływy aplikacji

- Dziś: `weekPlan.syncWeek` → `previewDay` → `acceptDay` w transakcji.
  Akceptacja sprawdza ponownie wejścia, receptę oraz wybór tygodnia; konflikt odświeża podgląd.
- Sesja dodatkowa używa tego samego bilansu dnia i audytu; start wymaga ukończonego dnia.
- Sesja: `readSessionState` odczytuje plan, dyspozycje i wyniki; polecenia w
  `repositories/sessions.ts` zapisują obserwacje oraz rewizje i mają idempotentny ledger.
- Zmiana sesji: resolver / ranking → `assessSessionChange` → świeża ocena oraz
  `applySessionChange` w transakcji. Wykonane serie nie są przepisywane.
- Czat: `app-services/coach/proposals.ts`, `ai/tools/planPreview.ts` i narzędzia sesji.
  Propozycja to karta do zatwierdzenia; tekst modelu nie jest receptą ani wynikiem.
- Historia: dawne wiersze bez observation są tylko do odczytu. Planer pomija plany
  `planSchema = 1`; w normalizacji zapisów bez dowodu pozostaje `legacy_unknown`.
- Startup: migracje → seed katalogu/sprzętu → zamknięcie przeterminowanych sesji przez
  `closeSession`. Zapisana praca pozostaje, główny dzień jest oznaczony jako pominięty.

## 3. Mapa modułów

| Obszar | Bieżące moduły |
| --- | --- |
| Plan, audyt i kroki | `domain/plan/{plan,day,week,block,compile,audit,repair,selectionGuard}.ts` |
| Dowód i progresja | `domain/observations/*`, `history/*`, `progression/{next,rules,policy,assessed,axes,failedRungs,probe,buildUp}.ts` |
| Sprzęt i opór | `resistance/*`, `equipment/*`, `inventory.ts`, obliczenia drabinek i kalibracji |
| Sesja | `session/{progress,setEntry,evaluate,effects,revision,assessmentText}.ts` |
| Odczyt i zapis | `db/repositories/{planning,weekPlan,sessions,history,planningInputs,constraints,sessionChanges}.ts` |
| Sterowanie czatem | `app-services/coach/proposals.ts`, `ai/tools/{planPreview,sessionTools,simulationTools}.ts` |

Nazwy API nie mają przyrostka `V2`. Numery wersji planu, promptu, backupu i migracji są
zachowane, ponieważ identyfikują faktycznie zapisane lub wysłane kontrakty.

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

### 4.3 Uczciwy kod na minimum oporu

Pipeline progresji nie ogłasza obniżenia oporu, jeżeli model oporu nie ma niższego szczebla.
Decyzję zapisuje trace; polski tekst pochodzi z `decisionText` / `traceText`.

### 4.4 Baza pomiarowa

Golden baseline P0 i jego skrypty zostały usunięte razem z implementacją, którą mierzyły.
Ich historyczne wyniki pozostają w Git. Bieżące zachowanie sprawdzają testy domeny,
symulacje i testy transakcyjne na SQLite; plan sprzętu, limity i tuning nie zmieniły się
przy sprzątaniu P6.

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

`src/domain/plan/sessionPlan.ts`, `ids.ts`, `src/domain/observations/`

- Identyfikatory: `s1/r1/e1` (ekspozycja), `s1/r1/e1/2` (seria logiczna), `s1/r1/e1/2L` (jedna strona). Rewizja w identyfikatorze to rewizja, w której element **powstał**; późniejsza rewizja może dodać serię do ekspozycji (identyfikator serii nowszy niż ekspozycji, nigdy starszy).
- `sessionPlanSchema` sprawdza spójność wewnętrzną: unikalne identyfikatory, serie należą do sesji i ekspozycji, żadna z przyszłej rewizji, strona w id = strona serii, role (tylko seria `work` bywa `requiredForProgression`: rozgrzewka, `backoff`, praktyka, mobilność i próba nie zastępują serii roboczej), **każda zaplanowana seria jest wykonywana dokładnie raz** w krokach, czas: części sumują się do `exerciseTotal`, a `overall` = ćwiczenia + rower (niezmiennik 12). Czy plan jest *dozwolony* (sprzęt, limity, profil), rozstrzyga audyt (P4), nie schemat.
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

### 4.11 Warstwa danych

`workouts.sessionPlan` to skompilowany plan; `workouts.plan` zawiera historyczny JSON
czytany tylko dla regions/kind/title. `planSchema` rozróżnia oba kontrakty. Nie ma
przełącznika silników i nie ma funkcji tworzenia dawnych sesji ani dawnych tygodni.

Backup 8 obejmuje obserwacje, rewizje, dyspozycje, odczucia i preferencje. Parser przyjmuje
wersje 1–7, przekształca stare pole `planV2` do `sessionPlan` i przenosi tytuł z szablonu.
Import historycznej sesji in_progress zamyka ją jako abandoned. Planowany tydzień jest
pochodny i po imporcie powstaje ponownie. Import i migracja nie resetują historii.

Tabela `legacy_sessions` pozostaje wyłącznie dla danych archiwalnych kopii zapasowych,
które mogły zostać wcześniej zaimportowane. Jest zachowana w round trip backupu i nie
karmi planowania ani progresji. To świadomy wyjątek chroniący dane, a nie API resetu.

Wartości dla ekranów historii i wykresów są projekcją observation przez setLogColumns;
brak reprezentacji sprzętu pozostawia null. Obliczenia kalibracji gum, fizyczne drabinki,
adapter persistedLoad i dane syntetycznych historii pozostają używane przez obecny kod.

### 4.12 Kwalifikacja dowodu i progresja (P3)

Czysta domena, bez bazy i bez zegara. **Żadna ścieżka aplikacji jeszcze tego nie woła** (to P5/P6), więc zachowanie aplikacji się nie zmienia. Wejście: kolejne ekspozycje primary jednego ćwiczenia na jednym kluczu porównywalności (`ExposureRecord` z normalizatora P2); wyjście: `Draft` — co robić i dlaczego. Zamiana szkicu na serie z identyfikatorami, czasami i krokami to praca kompilatora (P4).

**Kwalifikacja** (`observations/qualify.ts`). `qualifyExposure(rec, policy, model, {context?})` → `EvidenceAssessment`: pokrycie (`complete`/`partial`/`none` względem serii wymaganych, każda strona osobno), porównywalność (opór wykonany a zaplanowany *per seria*; inny opór albo ustawienie = `changed`, brak zapisu oporu = `unknown`), jakość (`invalid` → `unconfirmed` → `missing_rir` → `sufficient`; wysiłek zapisany bez pokazania = brak), kontekst (`abandoned`/`deload`; `intro`/`recalibration` podaje historia), wynik względem zakresu **zaplanowanego w tej serii** (`top_met`: pierwsza seria logiczna na górze, pozostałe o co najwyżej `dropOffAllowance` = 1 niżej; `below_range`; `within_range`; `not_evaluable`, dopóki coś jest niepełne, nieporównywalne, bez wysiłku, skrócone na prośbę albo w tygodniu deloadu). Do tego `effortMet` (czy każda wymagana seria miała wysiłek, o jaki plan prosił), `shortfalls` (to, co osoba zgłosiła jako powód niedobicia — bez gubienia informacji po drodze do kodu) i `reasons` (kody). `isFailure` = kompletna, porównywalna, zwykła i poniżej zakresu, bez bólu, krótkiej przerwy i DOMS. `referenceResistance` = opór, na którym stoi następna recepta: ten, na którym faktycznie zrobiono serie; po kalibracji w sesji najcięższy szczebel, na którym serie mieściły się w zakresie z wysiłkiem, jakiego plan prosił, a gdy żaden — najlżejszy użyty.

**Jak reguły czytają historię** (`progression/assessed.ts`): `assess` robi z rekordów `Assessed` = rekord + kwalifikacja + opór odniesienia + identyfikator szczebla modelu + zakres planu. `usable` to ekspozycje, w których coś zrobiono; ekspozycja bez niczego nie przesuwa osoby między szczeblami, ale **przerywa** serię porażek. Tydzień deloadu nie jest czytany (decyduje ekspozycja przed nim) i nie przerywa budowania do zakresu, a przerywa serię „kolejnych” porażek.

**Pipeline** (`progression/next.ts`, `rules.ts`, `draft.ts`). `prescribeNext(input, pipeline = PIPELINE_)` → `{ draft, trace }`. Reguły w kolejności priorytetów 03 §4:

| # | Reguła | Co robi |
|---|---|---|
| 1 | `eligibility` | `NOT_PRESCRIBED` / `MODEL_NOT_APPLICABLE`, koniec |
| 2 | `pain` | ból w ostatniej ekspozycji → powtórz receptę, bez kroku w żadną stronę (`PAIN_REPORTED`) |
| 3 | `first_exposure` | nic nie zrobiono → start slotu, dół zakresu, RIR 4 (`FIRST_COMPARABLE_EXPOSURE`) |
| 4 | `return` | przerwa liczona od **ostatniej faktycznej** ekspozycji: ćwiczenie nieobecne ≥ 31 dni → `RE_EXPOSURE`; globalna krótka → `LAYOFF_REPEAT`; średnia → `LAYOFF_STEP_DOWN` (albo `LAYOFF_REPEAT`, gdy nie ma lżejszego). Dwa zegary: ślad mówi, który zadziałał (`clock`) |
| 5 | `phase` (zawsze) | deload: ostatnia recepta, RIR 4–5, bez awansu; rekalibracja po długiej przerwie i dwie pierwsze ekspozycje: RIR 4; rekalibracja zakazuje awansu |
| 5b | `probe_outcome` | próba udana → cała ekspozycja na nowym szczeblu (`PROBE_PASSED`); nieudana → `PROBE_FAILED` i dalej zwykła ocena (próba nie jest porażką) |
| 6 | `evidence` | niepełne / inny opór / brak wysiłku / niepotwierdzone / konfundery (krótka przerwa, DOMS) / skrócone na prośbę → utrzymaj z kodem, co brakuje |
| 7 | `failure` | dwie kolejne porażki **na jednym szczeblu i w jednym zakresie** → `nextEasier`, `LOAD_STEP_DOWN` |
| 7a | `build_up` | brak lżejszego oporu i seria poniżej dołu zakresu → cel = wynik + krok (≤ dół), `AT_MINIMUM` + `BUILDUP_BELOW_RANGE`; karta łatwiejszego wariantu (`VARIANT_DOWN_SUGGESTED`) przy ≤ połowie dołu zakresu albo po dwóch ekspozycjach bez poprawy; bez łatwiejszego wariantu `NO_EASIER_VARIANT` |
| 8 | `success` | `top_met`: wysiłek za mały → `RIR_TOO_LOW`; „za ciężko” → `FEEL_TOO_HARD`; szczyt drabinki → `LOAD_CEILING` + wydłużanie zakresu do limitu, potem `REP_CAP_REACHED` i wariant trudniejszy; szczebel niedawno nieudany → `RUNG_RECENTLY_FAILED`; dwie ekspozycje z samych niezmienionych podpowiedzi → pytanie `CONFIRM_STEP_UP` (odpowiedzi: awans / `USER_DEFERRED`); skok ≥ 15% albo nieznany → seria próbna (`PROBE_PLANNED`), po nieudanej próbie `PROBE_COOLDOWN`; mniejszy skok → `LOAD_STEP_UP` |
| 9 | `rep_progression` | wewnątrz zakresu albo pojedyncza porażka: ten sam opór, cel każdej serii = wynik + krok (dwa kroki po „za łatwo”), seria zrobiona „do oporu” nie rośnie |
| 10 | `estimator_shadow` (zawsze) | model siły (domyślnie wyłączony) pisze do śladu, nic nie zmienia |
| 11 | `sets` (zawsze) | liczba serii: rekomendacja albo to, o co poprosiła oś; próba zabiera jedną z serii |
| 12 | `normalize` (zawsze) | opór musi być szczeblem modelu, cele w granicach (limit powtórzeń), RIR domyślny; dopisuje `notes` fazy (`DELOAD`, `RECALIBRATION`, `INTRO_EXPOSURE`) **po** kodzie decyzji |

`final` zatrzymuje kolejne reguły z wyjątkiem tych oznaczonych `always`. Dzięki temu pierwszy kod w śladzie (`trace.code`) jest zawsze przyczyną decyzji. Ślad (`DecisionTrace` planu v2) niesie: decyzję, kod, politykę, dowody (id ekspozycji, szczebel, lista reguł, które coś zmieniły) i `estimate: null`.

**Pamięć nieudanego szczebla** (`failedRungs.ts`), wyprowadzana z historii przy każdym planowaniu: zdarzenie to awans na szczebel X (cięższy niż poprzedni), po nim seria ekspozycji na X zakończona kompletną porażką, a potem zejście do lżejszego (zrobione przez regres albo przez osobę, choćby plan mówił X). Wpis znika po 42 dniach bez ekspozycji na X lub Y (liczone w kolejnych odstępach, nie tylko od ostatniej). Oczyszczenie: kompletna ekspozycja na Y z wszystkimi wymaganymi seriami na **rozszerzonej górze** zakresu (`extendedTop`: góra + 5 powt. albo + 15 s, w limicie powtórzeń) przy wysiłku, o jaki plan prosił; gdy zakresu nie można wydłużyć — kompletna `top_met` z serią więcej niż miała nieudana ekspozycja. Oś pośrednia (`axes.ts`): najpierw wydłużenie zakresu o krok (dwa po „za łatwo”), potem dodatkowa seria, potem utrzymanie. Zakres wydłużony jest zapisany w planie (`max` celu), więc kolejna ekspozycja ocenia się względem niego.

**Próba szczebla** (`probe.ts`): `shouldProbe(relativeStep)` (skok ≥ 15% albo `null` = nieznany: guma bez kalibracji, masa ciała); `probeVerdict` (udana: ≥ dół zakresu przy wysiłku, jakiego plan prosił; nieudana: poniżej dołu albo „do oporu”; brak werdyktu: bez wysiłku, inny opór, nie zrobiona); `probeCooldown` (ile ekspozycji `top_met` brakuje do kolejnej próby, z historii); `rirBias` (mediana różnic, tylko informacja, ≥ 5 par).

**Budowanie do zakresu** (`buildUp.ts`): `buildUpState` (aktywne, ile ekspozycji bez poprawy najlepszej sumy, najlepsza seria; `since` = dzień odrzucenia karty wariantu), `buildUpTargets`, `shouldSuggestVariantDown`. Reguła zależy od braku `nextEasier` oporu, nie od rodzaju sprzętu (masa ciała, czas, najlżejsze hantle i guma budują tak samo).

**Kalibracja w sesji** (`firstExposure.ts`): `calibrationProposal` — po serii nie ostatniej: krok w górę (RIR ≥ 3 i góra zakresu, maks. 2), w dół (RIR ≤ 1 i poniżej dołu, maks. 1): lżejszy szczebel, a jeśli go nie ma — łatwiejszy wariant, a jeśli i tego nie ma — cel pozostałych serii = wynik tej. Same propozycje; przyjęcie to zmiana planu w sesji (P4b/P5).

**Liczba serii** (`plan/sets.ts`): `recommendSets` — compound 3, akcesoria/core/filler 2 (`SETS_CONFIG`), deload ×0,5 (min 1), lżejszy dzień 1, w granicach miejsca dnia, tygodnia i czasu; `allowed` (bez pytań) i `advisable` (z potwierdzeniem, do 10).

**Kody** (`progression/codes.ts`): zamknięty rejestr `DECISION_CODES` (40), `STEP_DOWN_CODES` i `STEP_UP_CODES`. Test sprawdza na wszystkich planach z testów, że kod „lżej” pojawia się tylko, gdy opór faktycznie spadł (T105), że żaden plan nie jest cięższy od ostatniej ekspozycji bez kodu awansu i że kolejność rekordów nie zmienia wyniku (T56). Teksty polskie i schemat payloadu kodów dochodzą z UI/AI w P5 (kontrakt AI wylicza kody przez `z.enum`, więc to zmiana kontraktu i wspólne wdrożenie Workera).

**Parametry** (`config/training.ts`): `PRESCRIPTION_CONFIG` (próg próby 15%, góra +5/+15 s, pamięć 42 dni, połowa dołu zakresu, kalibracja 2/1, `dropOffAllowance`), `SETS_CONFIG`; `progression/policy.ts` składa z nich `ProgressionPolicy` razem z krokami i progami przerw z pierwszego silnika.

### 4.13 Rotacja, deload reaktywny, dźwignia objętości (P3)

**Czy ćwiczenie idzie do przodu** (`progression/stall.ts`): `improved` = cięższy opór albo więcej powtórzeń/sekund na tym samym; inne ustawienie to zmiana, nie zastój. `stalledRun` liczy kolejne kompletne ekspozycje bez poprawy (niepełne i tydzień deloadu są pomijane). `blockEvidence` = ile kwalifikowanych ekspozycji miał wariant w bloku i czy idzie do przodu (jest uczony albo poprawił się w ostatnich 3).

**Wybór wariantu na blok** (`plan/blockVariant.ts`): kolejność: wybór osoby (jeśli dozwolony) → wariant zostaje, gdy ma za mało kwalifikowanych ekspozycji (`INSUFFICIENT_ROTATION_EVIDENCE`, brak danych to nie zastój, T35) albo idzie do przodu (`ROTATION_CONTINUITY`). Wyjątki: wariant niedozwolony (zmiana sprzętu, wykluczenie) zmienia się od razu, a `variety: varied` to zwykła rotacja. Przy rotacji: następny z listy; w grupie prawie równoważnej (`nearEquivalent`) wygrywa wynik preferencji; wariant z `avoid` ustępuje nieunikanemu, którego nie użyto w ostatnich 2 blokach (`AVOIDED_SKIPPED`), a gdy wszystko jest `avoid`, i tak coś zostaje wybrane (T75). Wykrywanie plateau i limit kolejnych bloków: P7. Parametry (3 ekspozycje, okno 3) są zastępcze do czasu benchmarku (`ROTATION_CONFIG`).

**Deload reaktywny** (`plan/reactiveDeload.ts`): brak planowego deloadu po 28 dniach. Powody: dwa różne sygnały przeciążenia, zastój co najmniej dwóch ćwiczeń kluczowych (po 2 ekspozycje bez poprawy) razem ze snem < 6 h albo energią ≤ 2 w ostatnich 3 dniach, albo prośba osoby. Nie przed 7. dniem bloku (prośba osoby to pomija) i raz na blok. Sygnały przeciążenia pochodzą z istniejącego `fatigueSignals` (pierwszy silnik); ich odpowiedniki na rekordach ekspozycji dojdą z podłączeniem do planowania (P5). Fazę deloadu w `advanceBlock` zmienia dopiero P6.

**Dźwignia objętości** (`volume/lever.ts`): `volumeRecommendation` zwraca karty: +20% (w górę, do 10), gdy mięsień jest trenowany co najmniej 28 dni bez przerwy ≥ 8 dni, wszystkie jego ćwiczenia kluczowe stoją od 2 ekspozycji, nie ma `RECOVERY_LOW` i DOMS ≥ 4 w 14 dniach; −20% (nie poniżej 3), gdy jest `RECOVERY_LOW` albo DOMS ≥ 4 w ≥ 3 z ostatnich 7 dni. Nic nie zmienia się bez akceptacji. **Wagi mięśni pomocniczych**: `weeklyVolume` czyta wagę osoby → katalogu → 0,5 (`secondaryWeightOf`); planowanie bezpośrednie jak dotąd liczy tylko mięśnie główne.

### 4.14 Kompilator, audyt i naprawa (P4)

To warstwa domeny v2; aplikacja nadal używa dotychczasowych ścieżek (§2.1). Przeniesienie konsumentów i runnera jest
P5/P6. Nowy plan nie korzysta z `validatePlan` pierwszego silnika.

**Kompilator** (`plan/compile.ts`): `compileSession({exposures, sessionId, planRevision, versions, modelOf, bikeSec, …})`
zamienia `ExposureSpec[]` na `SessionPlan` bez stempla. Każda seria ma stabilne ID w przestrzeni sesji/rewizji/ekspozycji;
`per_set` rozwija serię logiczną na lewą i prawą stronę, `alternating` oraz `both` pozostają jednym wykonaniem. Próba
szczebla poprzedza work, ma własny opór i czas. Superserie wykonują się rundami; nierówne liczby serii nie są wyrównywane
nowymi seriami. Kompilator generuje perform/rest/setup/transition/cue i dzieli czas na hardWork, practice, mobility,
warmup, rest, setup i transition. `exerciseTotal` to suma, `overall = exerciseTotal + bike`. Po ostatniej serii nie ma
odpoczynku. `resourceDemand` modelu określa konfiguracje; zmiana współdzielonej pary hantli kosztuje setup przy każdym
powrocie do innej nastawy. `stampPlan` wiąże hash recepty/kroków z fingerprintem wejścia, trybem audytu i overrides.

**Audyt** (`plan/audit.ts`): `auditPlan(plan, context, acknowledged)` jest czysty. Najpierw sprawdza schemat i hash,
potem kwalifikację, politykę i kody śladu, legalność i osiągalność oporu, skoki, zakresy, serie oraz reguły dnia.
Objętość liczy logiczne work/probe/backoff z planowanym RIR ≤ 4 lub nieznanym. Zapisana niepewna praca jest wliczana
do maksimum. Ból i avoid, DOMS/regeneracja, czas oraz zasoby korzystają z jednego rejestru hard/advice. Wynik zawiera
referencje do ekspozycji/serii i dozwolone rodzaje napraw. Potwierdzenie nie przepuszcza hard. Tryby new_plan/start_session
oceniają bieżący plan; resume_session pomija settled przy sprawdzaniu przyszłego wykonania i objętości;
history_import/historical_display sprawdzają integralność formatu bez nakładania dzisiejszych limitów na dawne actual.

**Naprawa** (`plan/repair.ts`): `planWithRepair(specs, compileInput, auditContext, options)` kompiluje i audytuje po
każdej transformacji. Kolejność wynika z findingów: drop_filler, split_superset, reduce_sets, drop_exposure. Budżet
to 12 kroków (`DEFAULT_REPAIR_BUDGET`), nie czas ścienny. Serie zmniejsza od końca, próba zostaje pierwsza.
Wynik to ready/adjusted z planem i listą zmian albo no_feasible_plan/unsupported_input z powodami. Minimum czasu
nie wymusza luzowania reguł; krótki legalny dzień jest poprawnym wynikiem.

### 4.15 Dzień, blok i symulacja v2 (P4)

**Dzień** (`plan/day.ts`): `planDay(DayInput)` buduje indeks actual, politykę dnia, sygnały i recepty z
`prescribeNext` oraz `recommendSets`. Greedy przelicza marginalny deficyt, staleness, bonus compound i preferencję po
każdym wyborze. Dostawców mięśnia liczy z kandydatów kwalifikowanych w tym wejściu. Remis rozstrzyga kolejność slotów.
`trace.evidence.selection` zapisuje ważone składowe, sumę i `addedSec`; wagi pozostają bazowe (D25).
Budżet czasu oszacowania i recepty liczy ten sam kompilator; wydłużona recepta jest ponownie sprawdzana przed wyborem.
`only` wskazuje sloty i górną liczbę serii, bez wypełniaczy; druga ekspozycja tego samego klucza w dniu jest supplemental
i czyta historię sprzed tego dnia. Praktyka z RIR 5, potem mobilność, uzupełniają krótki dzień. Po grupowaniu plan
przechodzi `planWithRepair`. Regiony liczą tylko serie logiczne ciężkiej pracy z planu końcowego; propozycje usuniętych
ekspozycji nie są zwracane. Przy braku planu obie listy są puste.

**Adapter** (`plan/resistanceOf.ts`) wiąże obecny katalog i start slotu z modelem hantli/gumy/masy ciała oraz kluczem
porównywalności. Nieznana konfiguracja modelu daje null. Rozszerzanie inwentarza produkcyjnego wymaga kontraktów P9;
kompilator i audyt już otrzymują model przez jawne `modelOf`.

**Blok** (`plan/block.ts`) wywołuje `chooseBlockSelections` i `reactiveDeloadTrigger`: 35 dni, bez planowego deloadu,
deload trwa 7 dni i nie kończy bloku. Przerwa resetuje zegar; wykluczony wariant jest naprawiany. Sygnały z ekspozycji
(`autoregulation/signals.ts`) odpowiadają przeciążeniu, regresowi kolana i niskiemu recovery. Przy FATIGUE_HIGH dzień
szuka kwalifikowanego dwunożnego zamiennika w tym samym slocie; bez niego pomija slot.

**Symulator** (`plan/simulate.ts`): `simulate` prowadzi blok dzień po dniu, jawnie uwzględnia restDays, readiness,
prośby deloadu, preferencje i model syntetycznej osoby. `recordsOf` tworzy actual wyłącznie z końcowego planu, z ilością
i RIR podanymi przez athlete, potwierdzonym oporem oraz fazą deloadu w kontekście. Nie ma planu → nie ma actual/ride;
dzień odpoczynku nadal przesuwa blok. Cele dystansowe są poza zakresem symulatora i powodują jawną odmowę.
Testy na prawdziwym katalogu obejmują 6 tygodni deterministycznej osoby i 8 tygodni osoby okresowo niedobijającej celu,
kontrolują dzienne/tygodniowe maksima, czas, rotację, deload, unikalność ID i prawdziwość kodów progresji.

**Dowody P4:** `compile.test.ts`, `audit.test.ts`, `repair.test.ts`, `day.test.ts`, `dayWorlds.test.ts`,
`dayEdges.test.ts`, `block.test.ts`, `signals.test.ts`, `resistanceOf.test.ts`, `simulate.test.ts`,
`simulateEdges.test.ts`. Scenariusze dawniej wyłączone są aktywne. Znane ograniczenia i różnice: UWAGI §2b.

### 4.16 Rozpoznawanie ćwiczeń (P4b.1)

`catalog/resolve.ts` udostępnia `resolveExerciseRef(ref, catalog, lexicon)` oraz
`createExerciseResolver(catalog, lexicon)` do wielokrotnego rozpoznawania z jednym przygotowanym katalogiem.
Słownik jest jawnym wejściem, bo domena nie importuje plików danych. `data/movement-terms.json` v1 przechowuje
odmiany/synonimy, frazy, słowa puste, grupy określeń wymagających zachowania i wskazówki ruchowe z mięśniami.
`movement-terms.schema.ts` oraz `validate:data` sprawdzają format, sprzeczne znaczenia form (także kanonicznych),
duplikaty i referencje do nieznanych tokenów. Są to wskazówki do rankingu, nie nowa klasyfikacja medyczna.

Kolejność: jawne ID → dokładna znormalizowana nazwa → alias → zgodność zbiorów tokenów z jawnymi odmianami
→ Jaccard zbioru nazwy i aliasów, z bonusem wzorca ruchu. `normalizeExerciseName` składa Unicode NFC, stosuje
istniejący `fold`, zamienia interpunkcję/białe znaki na spacje. Frazy są rozpoznawane przed słowami pustymi,
najdłuższa pierwsza. Typo to jedno dodanie/usunięcie/zastąpienie znaku, wyłącznie dla słów ≥ 6 znaków i gdy
korekta prowadzi do jednego kanonicznego tokenu ze słownika albo nazw/aliasów katalogu. Nie używa stemmerów
ani przybliżonej podmiany całych nazw.

Progi w `EXERCISE_RESOLVER_CONFIG`: score ≥ 0,6, przewaga ≥ 0,15, bonus ruchu 0,2, najwyżej 3 najbliższe nazwy.
Podana pozycja/kierunek/sprzęt/strona musi występować także u kandydata do automatycznego dopasowania.
„Wyciskanie hantli zza głowy” pozostaje not_found z push-vertical; nie staje się wyciskaniem nad głowę ani
wyprostem na triceps. Przy remisie zwracane jest ambiguous w kolejności ID, niezależnie od kolejności katalogu.
Not_found zachowuje oryginalne zapytanie i `movement: {id, muscles} | null`. Zerowe podobieństwo nie daje
arbitralnej listy najbliższych. Archived jest pomijane także dla ID i podpowiedzi.

`data/exercises.json` v6 ma 109 aliasów w 63 ćwiczeniach. Zmiana danych obejmuje wyłącznie aliasy i wersję;
ID, biomechanika, graf wariantów, sprzęt i recepty nie zmieniły się. Wersja powoduje reseed w zainstalowanej
aplikacji, w tym wcześniej dodanych pól P1, bez resetu historii. Testy sprawdzają każdą nazwę/alias rzeczywistego
katalogu, odmiany, literówki, niejednoznaczność, próg score, brak dopasowania i permutację wejścia.
Resolver pozostaje poza ścieżkami aplikacji do integracji w P4b/P5.

### 4.17 Ocena zmian niewykonanej części sesji (P4b.2)

`assessSessionChange(snapshot, activeSession, change, opts?)` jest czystą funkcją w `session/assess.ts`.
Ocena pojedynczego wariantu znajduje się w `session/evaluate.ts`; publiczna funkcja dołącza ranking (§4.18).
Wejścia z `session/types.ts` są zwykłymi danymi: `SessionChangeSnapshot` rozszerza `DayInput` o rewizje
historii/preferencji, słownik i zapisany wybór jutra; `ActiveSessionState` zawiera plan v2 i aktualne
znormalizowane rekordy/dyspozycje. Rekordy aktywnej sesji zastępują jej starszą kopię w snapshotcie, więc
wykonana praca nie jest liczona dwukrotnie. Data musi odpowiadać zamrożonej dacie sesji. Uszkodzony hash lub
schemat jest blokowany przed budowaniem rewizji; wykonywanie celów `distance` pozostaje niewspierane.

Obsługiwane zmiany: `add_exercise`, `add_sets`, `swap_remaining`, `reduce_remaining`, `skip_remaining`.
Resolver zwraca również niejednoznaczność (`needs_clarification`) i brak ćwiczenia (`blocked`). Recepta
pochodzi z `prescribeNext` + współdzielonego `prescriptionSpec` i `hasLowReadiness`; mobilność używa `fillerSpec` ze scope `none`.
Jawna liczba serii nie jest ograniczana do `recommendSets`: recommendation opisuje zalecany zakres, a
patche zawierają prośbę. Próba szczebla mieści się w żądanej łącznej liczbie serii. Przy braku miejsca i braku
jawnej liczby proponowana jest dawka domyślna polityki z oceną advice, obok uczciwej rekomendacji 0.

`revision.ts` zachowuje istniejące ID/recepty i historyczne kroki. Dopisywane serie mają nową rewizję i dalsze
ordinale; są nieobowiązkowe dla progresji. Redukcja liczby usuwa całe pending pary, zachowuje pozostałą stronę
rozpoczętej pary i odrzuca żądanie usunięcia strony już wykonanej. `easier` obniża opór tylko pending do
osiągalnego `nextEasier`; brak lżejszego szczebla jest jawnym hard fail (opcje wariantów: P4b.5).
`compilePlannedSets` współdzieli kompilację kroków/czasu z `compileSession`, ale zachowuje ID i jawny porządek.
Nie powtarza rozgrzewki gumy rozpoczętej ekspozycji. Wykonane, przerwane i pominięte serie są settled;
pominięte nie zużywają szacowanego budżetu czasu. Rower jest oddzielny od czasu ćwiczeń.

Hipotetyczna rewizja przechodzi `auditPlan` w trybie `resume_session`, bez `planWithRepair`, bez akceptacji
advice. Audyt uwzględnia pending czas, ból mięśni głównych i pomocniczych oraz `RESOURCE_CONFLICT`:
przezbrojenie obecne w krokach daje `warn` z `setupSec`, brak koniecznego przezbrojenia nadal daje `fail`.
Do checków audytu dochodzą nakładanie ze zrobioną dziś pracą, pokrycie minimum i wpływ na jutro. Werdykt
pochodzi wyłącznie z `verdictOf`; `not_recommended` ma patch, `blocked` i `needs_clarification` go nie mają.

`effects.ts` liczy pewną/niepewną objętość dnia i tygodnia (jedna strona = pół serii), regenerację z historii
sprzed dziś, DOMS, nakładanie, czas oraz scope. Jutro sprawdza istniejący `checkSelection` z opcjonalnymi
faktami objętości/regeneracji wyprowadzonymi z actual i `ProjectedExposure`. Prognoza nigdy nie tworzy
obserwacji ani `ExposureRecord`; nie zależy od konwersji oporu do v1. Raportowane są tylko nowe naruszenia
względem pierwotnego pending planu, a nie problemy istniejące wcześniej.

`assessmentId` wiąże rewizje, fingerprint snapshotu, plan, actual/dyspozycje i zmianę. `patchId` wiąże tę ocenę
z operacjami i konkretnym planem nowej rewizji. `SessionPlanPatch` zawiera pięć typów operacji i `plan`, aby
wynik był gotowy do pokazania i ponownego audytu w transakcji P4b.4. Sam stamp nie oznacza zatwierdzenia:
`overrides` jest puste, advice wymaga świadomego ACK w poleceniu zapisu.

Dowody: `assessSessionChange.test.ts` — T61–T66 i granice (84 testy), pełne pokrycie nowych funkcji i regresja
dotychczasowego silnika. Funkcja pozostaje poza aplikacją do P5. `feel`, zapisy i
deterministyczne teksty PL są kolejnymi zadaniami P4b.

### 4.18 Ranking alternatyw w sesji (P4b.3)

`rankAlternatives(target, ctx)` jest eksportowane z `session/assess.ts`, a implementowane w
`session/alternatives.ts`. Target podaje opcjonalne ID ćwiczenia/slotu i mięśnie; kontekst zawiera snapshot,
aktywną sesję i jawny zamiar `add_exercise` albo `swap_remaining`. Alternatywa zastępuje wyłącznie ID
ćwiczenia w tym zamiarze: zachowuje liczbę serii, pozycję lub ID ekspozycji do zamiany. Recepta pochodzi
z własnej historii kandydata, bez transferu oporu z oryginału.

Pula łączy warianty łatwiejsze/trudniejsze (także odwrotne krawędzie), jawne zamienniki, rodzeństwo slotu
i jawne `comparisonFamily`. To nowe opcjonalne pole domeny/schematu katalogu: brak/null nie tworzy grupy.
Przy nierozpoznanym ćwiczeniu pula obejmuje aktywne ćwiczenia ze wspólnym mięśniem głównym z podpowiedzią
słownika ruchów. Brak podpowiedzi daje pustą listę; niejednoznaczność wymaga doprecyzowania. Archiwalne,
nieistniejące i oryginalne ID są pomijane, powody pochodzenia łączone bez duplikatów.

Każdy kandydat przechodzi tę samą `evaluateSessionChange` co prośba. Hard fail oznacza brak patcha
i usuwa kandydata; advice zachowuje go z `not_recommended`. Klucz porządku to kolejno: grupa werdyktu
(`ok`/`ok_with_changes` przed `not_recommended`), `biomechSimilarity` (dotychczasowy `substituteScore` / 115),
`preferenceScore`, rzeczywiście pokryty deficyt do minimum tygodnia, liczba nakładających się ćwiczeń,
liczba kontroli regeneracji/DOMS, pozycja w slocie i ID porównane po punktach kodowych. Bez oryginału
podobieństwo oznacza udział pokrytych mięśni zapytania; sam target slotu bez mięśni daje 0.
`avoid` obniża preferencję, a twarde „nie proponuj” usuwa kandydata w audycie.

Wynik ma maksymalnie trzy pozycje z `why`, werdyktem, receptą i własnym `patchId`; dodatkowo przechowuje
`change` i pełną ocenę bez dalszych alternatyw, potrzebne karcie i ponownej ocenie przed zapisem.
`maxAlternatives` ogranicza wynik do 1–3, 0 wyłącza ranking; wartości niepoprawne dają pustą listę.
Opcjonalny filtr `equipmentFamily` zawęża pulę niezależnie od preferencji. Oceny redukcji, dodania serii
i pominięcia nie dołączają zamienników.

Pula jest oceniana przed obcięciem wyniku, aby niżej podobny, ale bez advice-faili kandydat nie zniknął.
Nie ma rekurencji; wydajność pełnej puli i pomiar p95 na telefonie pozostają do odbioru integracji
(odstępstwo od oszacowania „1 + 3 oceny” opisane w UWAGI §2e).
Dowody: `rankAlternatives.test.ts` — T67/T75, permutacje katalogu/slotów/krawędzi, własne patche,
filtrowanie hard-faili, świadomie wykonalne advice, preferencje i zachowanie wykonanych serii.

### 4.19 Transakcyjne zatwierdzenie zmiany sesji (P4b.4)

`app-services/commands/applySessionChange.ts` udostępnia kontrakt Promise z `CommandResult<{planRevision}>`.
Repozytorium `sessionChanges.ts` wykonuje jedną synchroniczną transakcję Expo/Drizzle, korzystając
ze wspólnej granicy `sessionCommandStore` istniejących poleceń P2. Żaden await nie rozdziela odczytu i zapisu.
Polecenie zawiera `commandId`, `sessionId`, `patchId`, jawne `change`, oczekiwane rewizje planu/historii,
`acknowledged` i kanał. Klient nie przesyła planu ani operacji patcha. `change` jest potrzebne, ponieważ
hash patcha nie pozwala odtworzyć zamiaru; tę różnicę względem skróconego kontraktu 11 §6 opisuje UWAGI §2f.

Kolejność: ledger (retry zwraca dawny wynik nawet po kolejnej zmianie/zamknięciu sesji), walidacja polecenia,
aktywna sesja v2 i poprawny schemat planu, rewizje, świeży snapshot w transakcji, ponowne
`assessSessionChange(..., {maxAlternatives: 0})`, porównanie `patchId`, komplet ACK dla advice-faili.
Zmiana rewizji lub treści snapshotu/patcha daje `conflict: STALE_INPUT`. Hard fail/niejednoznaczność
zwraca `CHANGE_BLOCKED`; brak wszystkich potwierdzeń daje `ACK_REQUIRED` z brakującymi kodami.
Ledger nie przechowuje odrzuceń, więc to samo ID może później zatwierdzić pełny ACK. ID innego typu
polecenia lub innej sesji nie może udawać powtórzenia tej zmiany. Override obejmuje tylko bieżące advice-faile,
bez uprawnień wynikających z przesłanych obcych lub hard kodów.

`sessionChangeSource.ts` czyta przez ten sam executor katalog, profil i wykluczenia, preferencje,
kalibracje i definicje gum, blok, ograniczenia, wybór jutra, dzienniki/rower oraz znormalizowaną historię.
Snapshot obejmuje również liczniki wejść. Fingerprint wiąże fakty, a nie same liczniki, więc zmiana profilu,
katalogu, gotowości lub inwentarza bez podniesienia licznika także unieważnia preview. Data pochodzi
z zamrożonego dnia aktywnej sesji. Przy braku bloku używane są wybory aktywnego planu; adapter nie obraca
ani nie zapisuje bloku. `loadSessionChangeSource` udostępnia spójny, tylko do odczytu snapshot do preview.

Po autoryzacji zapisuje się nowa `session_plan_revisions` (`user_change`, kanał, overrides), aktualny plan
i numer rewizji w workout, dyspozycje usuniętych pending ID, odbudowane outcomes, liczniki sesji/historii
i ledger. Błąd któregokolwiek zapisu cofa całość. Pending recepty aktualnego planu są rezerwacją objętości
czytaną przez następną ocenę; po ACK serie nadal liczą się normalnie. Nie są tworzone obserwacje wykonania.

`history.historyPlans` scala recepty ze wszystkich rewizji według ID ekspozycji i serii, wyłącznie
do normalizacji historii/outcomes. Runner nadal dostaje bieżący wykonywalny plan. Usunięte serie zachowują
receptę i dyspozycję `skipped/replaced`; licznik expected obejmuje pierwotnie wymagane serie. Skrócone
ekspozycje oraz nowe recepty obniżonego oporu mają kontekst `userReduced`, więc kwalifikacja zwraca
`USER_REDUCED` zamiast dowodu pełnego wykonania lub porażki siłowej. Logowanie, korekta, undo i zamknięcie
sesji również odbudowują outcomes na tych samych zachowanych receptach.

Dowody: `sqlite-check-session-changes.cjs`, uruchamiane jako 32 osobne przypadki w `storage.test.ts`:
T68/T69, pełny i niepełny ACK, retry, kanały, aktualność faktów, własny patch alternatywy,
wykonana część/historia po redukcji/zamianie, rezerwacja oraz rollback błędów czterech tabel.
Podłączenie do runnera, UI i AI pozostaje etapem P5.

### 4.20 Sygnały odczucia i ocenione opcje (P4b.5)

`SessionChange` obejmuje `FeelChange {kind:'feel', exposureId:string|null, feel:'too_hard'|'too_easy'}`.
`assessSessionChange` zwraca obserwacyjną ocenę bez patcha, z niezmienionymi efektami planu oraz
`feel: {options, recommendedOptionIds}`. Każda `FeelOption` niesie jawny zamiar `SessionPlanChange`,
`why` i pełną ocenę liścia (jak alternatywy, bez rekurencyjnych opcji). Niewykonalna opcja ma hard fail
i null patch; UI może wyjaśnić, dlaczego np. brak lżejszego oporu. `next_prescription` ma null zamiar
i null patch: zapisany raport wystarcza polityce progresji, akceptacja tej opcji niczego nie zapisuje.

`effort.ts` ocenia −1 serię, lżejszy opór i skip dla `too_hard`. Poleca szczebel niżej, jeśli pozostały
co najmniej dwie serie logiczne. Jeśli oporu nie da się obniżyć, ranking ocenia wyłącznie krawędzie
`easier` (także odwrotności `harder`), przed ograniczeniem wyników do trzech. Polecany jest najlepszy
dostępny wariant; przy braku wariantu −1 seria. Gdy pozostała tylko niewykonana strona wykonanej serii,
dropping całej pary jest blocked i fallback to skip. Wszystkie opcje korzystają ze wspólnego audytu.
`too_easy` ocenia +1 serię i poleca ją tylko przy `ok`; przy ostrzeżeniu/advice/hard poleca flagę na
następną receptę. Dodatkowe serie mają `requiredForProgression:false`, oryginalne zachowują swoje role.

Null `exposureId` zapisuje odczucie całej sesji i ocenia opcje osobno dla każdej ekspozycji z pending.
Rekomendacje są alternatywami na tej samej rewizji, nie zbiorczym patchem: każda akceptacja wymaga
aktualnej oceny. Po wykonaniu całości pozostaje tylko flaga `too_easy`; jawny ID kompletnej ekspozycji
nadal pozwala ocenić dodatkową serię. Uszkodzona integralność/schemat, obca ekspozycja, zła data lub
nieobsługiwane wykonanie nie produkują opcji. Ból blokuje dalszą pracę, a usunięcie pending może być
wykonalne; samo `too_hard` nie jest zgłoszeniem bólu.

`reportSessionFeel` ma Promise w app-services, synchroniczną transakcję w `sessionFeel.ts`, `commandId`,
oczekiwane rewizje planu/historii i kanał. Waliduje ledger/aktywną sesję/schemat/rewizje/ID ekspozycji
oraz normalizację, zapisuje `FeelReport`, podnosi history/session revision i zwraca ocenę już z nowej
historii. Dlatego patch wybranej opcji jest zgodny z następnym `applySessionChange`; raport nie wymaga
nowej rewizji planu. Kolejny raport unieważnia starsze opcje. Retry zwraca zapisany wynik także po
zamknięciu; ID innego polecenia/sesji jest odrzucane. Błąd raportu/outcomes/ledger cofa całą transakcję.
Dotychczasowy `recordFeel` współdzieli zapis, waliduje payload i też podnosi history revision.

Akceptacja redukcji przechodzi przez P4b.4 i zachowuje wymagane stare recepty oraz dyspozycje.
Zamiana na łatwiejszy wariant dodaje `trace.evidence.reducedFrom` także do nowej ekspozycji, więc
obie strony zmiany mają `USER_REDUCED`. Kwalifikacja nie daje awansu ani porażki/licznika regresu.
Samo odczucie bez przyjętej redukcji pozostaje wyłącznie sygnałem dla istniejących reguł P3.
Dowody: `feel.test.ts` (T71/T72/T105) i dodatkowe przypadki `sqlite-check-session-changes.cjs`.
Podłączenie UI/głosu/AI — P5. Teksty: §4.21.

### 4.21 Polskie teksty oceny (P4b.6)

`assessmentText(assessment, {exerciseName?, maxAlternatives?}): string[]` składa kartę oceny offline, bez LLM
i bez żadnych danych spoza oceny. Kolejność (głos czyta pierwsze dwa zdania): werdykt (`Można.`, `Można, z poprawkami.`,
`Odradzam.`, `Tego nie zrobię.`, `Nie wiem, o które ćwiczenie chodzi.`) → kontrole posortowane przez `sortChecks`
(twarde, rady, ostrzeżenia, informacje; zwykłe `pass` pomijane) → zalecenie serii (`Zalecam 2 serie jako następne
(mieści się do 3).`, albo brak miejsca z powodami limit dnia/tygodnia/czas) → recepta (`Recepta: 2 serie, 6 kg,
8–15 powtórzeń.`) → do dwóch alternatyw z oceną (`odradzane` przy `not_recommended`). Przy `needs_clarification`
tylko werdykt i lista kandydatów. Przy `blocked` bez recepty.

`CHECK_TEXT` to `Record<RuleCode, …>`: kompilator wymusza zdanie dla każdego kodu rejestru twardych/rad/informacji.
Zdanie nie wymyśla liczb — brak liczby w `data` daje zdanie ogólne (testowane dla każdego kodu z danymi i bez, we
wszystkich statusach). `checkText(check, name?)` jest eksportowane dla karty i dla AI jako zdanie awaryjne.
Odmiana: `plural` (1 seria, 2–4 serie, 5+ serii, 12–14 serii), dopełniacz „do 13 serii”, biernik „zalecam 1 serię”.
Imiona ćwiczeń przez `exerciseName(id)`; bez niego pokazywane jest id. Nazwy mięśni z własnej tabeli w domenie
(domena nie importuje `@/strings`), spójnej z `pl.labels.muscle`.

Dla `feel`: `Przyjęto: za ciężko/za lekko.`, `Polecam: …`, `Inne możliwości: …`, a przy redukcji uwaga, że skrócenie
na prośbę nie liczy się jako porażka siłowa (zgodne z USER_REDUCED). Dowód: `assessmentText.test.ts` — snapshot
zdania każdego kodu, scenariusze na realnym silniku (dodanie, ponad limit dnia, nieznane ćwiczenie, niejednoznaczne,
feel), determinizm i niezmienność wejścia.

### 4.22 Serwis dnia: od bazy do sesji (P5.5a)

Pierwszy kawałek integracji. Nic w ekranach go jeszcze nie woła; sprawdzony jest na prawdziwym SQLite
(`sqlite-check-planning.cjs`).

- `planningInputs.ts` (`readPlanningInputs(tx, asOf)`, `readDayBoundaryHour`): jeden czytnik wejść (profil, preferencje,
  katalog, gumy, historia znormalizowana, odczyty dnia, jazdy, prośby, tydzień, rewizje) w transakcji wywołującego. Używają go
  dzień i konsultacja w sesji (`sessionChangeSource` został do niego przepisany bez zmiany wyniku), więc nie mogą widzieć różnych historii.
- `plan/blockContext.ts` (`blockContext`): co blok czyta z historii (dowód każdego slotu, sygnały deloadu). Wyodrębnione z
  `simulate`, które teraz woła tę samą funkcję — symulacja i aplikacja nie mogą inaczej zdecydować o bloku. `plan/versions.ts`:
  wersje wpisywane do planu (silnik 2.0.0, polityki, kompilator, schemat śladu); wersja katalogu = najnowsza `data_version` z bazy.
- `planDayIn(tx, request, now)`: data dnia z godziny granicznej profilu → wejścia → blok przesunięty do dziś (`advanceBlock`,
  bez zapisu) → `planDay`. `DayRequest` niesie id sesji nadawane przez wywołującego (podgląd i akceptacja muszą się zgadzać),
  intencję, rodzaj, `only`, `acknowledged`, prośbę o deload. Odcisk wejścia obejmuje całe wejście i prośbę.
- `previewDay`: transakcja tylko do odczytu, wynik `{asOf, input, current, advance, output, planHash}`.
- `acceptDay({commandId, request, expectedPlanHash, timeZone})`: w jednej transakcji ledger → ponowne planowanie z bazy →
  porównanie hasha → `startSessionIn` (wyodrębnione z `startSession`) → zapis bloku (`writeBlockAdvance`) i podniesienie rewizji
  `block`. Inny hasz (zmiana profilu, historii, odczytu, prośby albo dnia) to `conflict: STALE_INPUT` z nowym haszem w `detail`;
  brak planu to `rejected: INVALID_PLAN`; trwająca sesja to `ACTIVE_SESSION_EXISTS`. Błąd zapisu bloku cofa też sesję i ledger.
  Powtórka tego samego `commandId` zwraca zapisany wynik.
- Dowód: plan z pustej bazy, brak zapisu w podglądzie, ten sam plan o różnych porach, start sesji, odczyt przez konsultację,
  powtórka, konflikt po zmianie odczytu i po zmianie dnia, odrzucony obcy hasz, trwająca sesja, cofnięcie przy błędzie bloku,
  dzień bez planu i **sześć dni pod rząd** (planowanie → wykonanie zgodne z planem → zamknięcie → następny dzień czyta poprzednie:
  pojawia się `REP_PROGRESSION`).

### 4.23 Zdania śladu decyzji (P5.3a)

`decisionText(code, evidence?)` zwraca jedno polskie zdanie dla kodu z zamkniętego rejestru `DECISION_CODES`; rekord
`Record<DecisionCode, …>` jest wyczerpujący, więc nowy kod nie skompiluje się bez zdania. Zdanie mówi, co silnik zrobił i jaka
jedna rzecz go do tego skłoniła; liczby (`gapDays`, `failures`) bierze z dowodu śladu, a bez nich pisze ogólnie. Zdania o kroku
„lżej/wyżej” mają tylko kody, które ten krok robią (D39 e) — pilnuje tego test. `traceText(trace)` zwraca zdania rozstrzygającego
kodu i pozostałych zapisanych w śladzie (`evidence.codes`), każde raz; kod, którego ten silnik nie zna (plan z nowszej wersji),
jest pomijany, a nie pokazywany jako surowy identyfikator. Używają tego: karta „Dlaczego?” (P5.3b) i prompty AI (P5.6).

### 4.24 Tydzień na silniku (P5.1–P5.2)

**Wybór dnia, nie obciążenie.** `KeptItem {slotId, exerciseId, sets}`; `DayInput.kept` mówi `planDay`, co wybrano wcześniej.
Dzień jest planowany tylko z tych slotów i z tą liczbą serii (przez te same reguły: kwalifikacja, regeneracja, limity, czas, audyt).
Jeśli każdy element się mieści — `kept: 'held'`; jeśli któryś nie (inny ćwiczenie w slocie po rotacji bloku, brak miejsca w objętości,
prośba o pominięcie partii, DOMS) — dzień jest wybrany od nowa, `kept: 'changed'`, a `keptViolations` niesie powód z `SkipReason`.
Pominięte jest tu kryterium „warto robić”, więc dzień nie zmienia się tylko dlatego, że cel tygodniowy został osiągnięty. Dzień
zapisany bez ćwiczeń roboczych (tylko lekka praca) jest utrzymany, dopóki nadal takiego nie ma. Wybrane ćwiczenie roboczego dnia to
`selectionOf(plan)`.

**`planWeek`** idzie dzień po dniu jak `simulate`: blok (`advanceBlock` z `blockContext`), dzień odpoczynku (wzór tygodnia albo
prośba), dzień złożony z trenerem (`compose_day` → `only`), w innym razie `planDay` z `kept`. Prognoza kolejnych dni czyta plan poprzednich
jako zrobiony zgodnie z planem (`recordsOf`), ale **te rekordy żyją tylko wewnątrz funkcji**: wynik nie zawiera `ExposureRecord`, wejście nie
jest zmieniane, a dzień pierwszy widzi wyłącznie prawdziwą historię (T21). Prognozowane sesje mają id `forecast-<data>`. Trwająca sesja dnia
(`running`): jej niewykonane serie liczą się w prognozach po niej jako zrobione (`completedAsPlanned`), a wykonane zostają, jak były (T19).

**`syncWeek`** to odpowiednik `syncWeek` pierwszego silnika: dni minione oznaczone `done`/`missed`, horyzont 7 dni od dziś (dziś odpada, gdy ma
sesję zakończoną albo trwającą), dzień chybiony albo jawna prośba planuje od nowa, wynik niesie `trigger`, wiersze do zapisu i `changes` (regiony
przed i po, powody) dla banera.

**Zapis.** Migracja 0011: `planned_days` (data, `selection`, `forecast` = plan v2, status, generacja) i `plan_generations`. Osobne tabele,
żeby tydzień pierwszego silnika nie zmienił się do P6. `weekPlan.syncWeek` w jednej transakcji czyta, planuje i zapisuje: bez zmian wyboru zapisuje
tylko statusy i odświeżoną prognozę (obciążenia idą za historią), przy zmianie nową generację (urodzoną jako zobaczoną, jeśli nic się nie zmieniło).
Blok nie jest tu zapisywany — przesuwa go dopiero start sesji dnia (`acceptDay`). `previewWeek` niczego nie zapisuje.

### 4.25 Logger, głos i odpowiedzi na pytania recepty (P5.4)

**Rekord wyniku** (`observations/entry.ts`). `buildObservation(entry, ctx)` jest jedynym miejscem, gdzie wpis na loggerze staje się wynikiem, więc dotyk
i głos dają ten sam rekord, różny tylko kanałem i tym, co zostało pokazane. Pole wpisane albo wypowiedziane: `user_reported` / `edited`. Podpowiedź
przyjęta: `user_confirmed` / `presentedDefault` z potwierdzeniem `visible` (chip na ekranie), `read_back` (odczytana głosem) albo `none` (zapisana,
ale nikt jej nie pokazał — wysiłek z takiej serii nie jest dowodem, `effortOf` = null). Wysiłek, którego nikt nie podał i nic nie zaproponowało,
zapisuje się jako `null` (nic nie jest twierdzone). `defaultEffort`: wynik poprzedniej serii → dolny RIR celu → „ciężko” (2). `readBackText`:
„Zapisuję 12, ciężko”. `transcriptStillApplies(started, now)`: spóźniona transkrypcja dotyczy serii i rewizji planu, dla których zaczęto słuchać (T40).

**Intencje głosu w sesji** (`voice/sessionIntent.ts`, 11 §9). `matchSessionIntent(transcript, {exposureId, offer})` → `add_exercise{query}`,
`add_sets{n}`, `swap_remaining{query}`, `skip_remaining`, `feel`, `alternatives{family}` („zamień na coś z gumą”) albo odpowiedź na kartę (`yes`/`no`/`mine`;
tylko gdy karta czeka). Słowa ćwiczenia wychodzą w postaci złożonej do rozpoznania przez `resolveExerciseRef` — ten plik nigdy nie zgaduje nazwy.
Negacja unieważnia rozkaz. Zdania spoza słownika to `null`. Nie zastępuje dotychczasowego `matchCommand` (stoper, przerwa, parametry); kolejność
ich wywołania ustali integracja z ekranem.

**Odpowiedzi** (migracja 0012, `prescription_answers`, `answers.ts`). `answerPrescription({commandId, comparisonKey, kind, answer, afterExposureId, on})`:
idempotentne, jedna odpowiedź na klucz i rodzaj (zmiana zdania nadpisuje), podnosi rewizję historii (podgląd sprzed odpowiedzi jest nieaktualny). Odpowiedź
`step_up` dotyczy ostatniej ekspozycji klucza (`afterExposureId`); nowsza ekspozycja unieważnia odpowiedź przy odczycie, więc „tak” nie zatwierdza
każdego kolejnego awansu, a pytanie o nieaktualną ekspozycję to `STALE_INPUT`. `variant_down` zapamiętuje tylko odroczenie („nie”, z datą);
przyjęcie łatwiejszego wariantu jest zmianą wyboru slotu, nie odpowiedzią. `readPlanningInputs` dokłada `answers` do wejścia dnia i tygodnia, więc
trafiają też do odcisku wejścia.

### 4.26 Model konsultuje trwający trening (P5.6a, kontrakt 7)

**Kontrakt** (`CONTRACT_VERSION = 7`). Trzy narzędzia, wszystkie w `CHAT_TOOLS` (źródło dla aplikacji i Workera): `getActiveSession` (ćwiczenia z liczbą serii zrobionych,
oczekujących i pominiętych, partie, serie partii dziś wobec dziennego maksimum, sekundy do końca), `assessSessionChange` (wejście: rodzaj zmiany ze **słowami** ćwiczenia, bez
pola na obciążenie ani powtórzenia — pilnuje tego `architecture.test.ts`; wyjście: skrót oceny silnika) i `proposeSessionChange` (karta do akceptacji na telefonie).
Nowe błędy narzędzi: `no_active_session`, `stale_assessment`. Powody recepty w `getPlanExplanation` przyjmują też kody decyzji drugiego silnika (`PLAN_REASON_CODES`).

**Skrót oceny** (`sessionSummary.ts`): werdykt, rozpoznanie ćwiczenia (id i nazwa z katalogu, kandydaci, najbliższe), do 5 kontroli z liczbami (słowa wpisane przez osobę —
`query`, `message`, `path` — nie opuszczają telefonu; wartości ucięte do 80 znaków), zalecenie liczby serii, recepta jako liczby (serie, `massKg` albo null dla gumy,
zakres powtórzeń/czasu, pogrupowane), do 3 alternatyw z własnym `assessmentId`/`patchId`, opcje `feel` i budżet czasu. Brak wolnego tekstu (I9).

**Środowisko** (`sessionEnvironment.ts`): `createSessionToolHooks(source)` czyta świeży stan przy każdym wywołaniu; maksymalnie 2 oceny na turę (`newTurn()` zeruje licznik); pamięta
zmianę stojącą za każdym `assessmentId` (także alternatyw i opcji feel). `proposeSessionChange` ocenia zmianę **jeszcze raz** na aktualnej sesji: inny `assessmentId` to
`stale_assessment`, brak patcha albo inny `patchId` — `invalid_input`. Karta (`SessionProposal`) niesie zmianę, `patchId`, oczekiwane rewizje i listę rad do zaakceptowania; jej
zatwierdzenie to istniejące `applySessionChange` z kanałem `ai_proposal` (ponowna ocena w transakcji, ACK_REQUIRED). Model niczego nie zapisuje (T72, T60).
`app-services/queries/sessionTools.ts` wiąże to z bazą (`loadActiveSessionSource`); `session/overview.ts` wyodrębnia z oceny budżet czasu i sumę serii dnia.

**Prompt** `chat/v7` (v6 pozostaje nietknięte): blok `<session_rules>` (kiedy konsultować, werdykty, odpowiedź do 80 słów z liczbami z kontroli, nieznane ćwiczenie = silnik go nie
ocenia, karta dopiero po „tak”, nic nie jest zrobione przez model), `<session_guide>` (znaczenie kodów kontroli i opcji) i `<decision_codes>` (zdanie `decisionText` dla każdego z 42 kodów).
Wyjątek od zakazu cytowania obciążeń dotyczy wyłącznie recepty z `assessSessionChange`. Worker deklaruje narzędzia z `CHAT_TOOLS` i używa `chat/v7`; nie wdrożono go.

### 4.27 Symulacja propozycji (P5.6b)

`simulateProposal(base, input, {horizonDays, athlete})` uruchamia ten sam `planWeek`, który układa plan, dwa razy: raz jak jest i raz z propozycją. Propozycja to zmiana
tygodnia (prośby: dzień wolny, lżejszy, partia pominięta), zmiana polityki (własna liczba serii na rodzaj ćwiczenia, profil objętości) albo zmiana trwającego treningu (ocena silnika +
plan po łatce: wykonane serie zostają, reszta liczy się jak zrobiona zgodnie z planem). Wynik: `baseline`, `withProposal`, `diff` (serie partii w ostatnim tygodniu horyzontu wobec min/max,
minuty dni, oczekiwane awanse i serie próbne, czy przyjdzie deload, dni ze zmienionym wyborem) i `warnings` w kodach rejestru (`WEEK_MAX_EXCEEDED`, a przy zmianie treningu także kontrole oceny).
Prognoza żyje w `planWeek` i nigdzie się nie zapisuje (test: tabela `planned_days` pusta po symulacji). `athlete`: `follows_plan` (dokładnie jak w planie) albo `observed_trend`
(powtórzenia przesunięte o średnią różnicę wynik−cel z 28 dni, w granicach ±2).

Narzędzie `simulateProposal` (kontrakt 7) przyjmuje te same względne daty i rodzaje próśb co `proposePlanChange`, bez pola na obciążenie. `TOOL_ANNOTATIONS` (readOnly / proposal / idempotent) odpowiada tabeli
z 11 §13: narzędzia odczytu i symulacja są tylko do odczytu; cztery narzędzia propozycji nic nie zmieniają bez akceptacji na telefonie. `loadSimulationBase` czyta bazę świeżo (tydzień, historia, blok,
odpowiedzi, trwający trening v2).

### 4.28 Narzędzia planu na tygodniu (P5.6c)

**Podsumowanie dnia.** Do wiersza `planned_days` dochodzi `summary` (migracja 0013, JSON): faza, powody dnia, regiony, pominięte ruchy z powodem, `composed`, szacowane minuty, blok, sygnały
przeciążenia i rower. Prognoza planu v2 tego nie niesie, a model ma tłumaczyć decyzje silnika tylko z kodów, więc powody zapisują się razem z dniem (`summaryOf` w `week`).

**`planPreview.ts`** (czyste, w warstwie AI, 100%): `summarizeDay` (ćwiczenia z nazwą katalogu i ruchem ze slotu, serie logiczne, powody tylko znane kontraktowi, nigdy obciążenie),
`describeWeek` (7 dni; dziś z trwającego treningu, dni zrobione), `previewPlanChange` / `previewDayPlan` (tydzień zaplanowany z dodaną prośbą obok tygodnia jak jest; różniące się dni
jako przed/po, konflikty ruchów z powodem, zastąpiona wcześniejsza kompozycja), `describeDayOptions` (dla każdego ruchu roboczego dzień zaplanowany tylko dla niego: dostępny albo powód
i serie, które dałby silnik; dzień minięty to `day_done`), `describePlan` (`getPlanExplanation`: plan zamrożony przy starcie sesji albo dzisiejszy z tygodnia; powody ćwiczeń z kodów śladu)
oraz walidacje słów osoby (notatka nie przepisuje, partia po DOMS tylko za silnym zakwasem, nieznane ruchy, ból).

**Kontroler** (`app-services/coach/proposals.ts`): to samo API co pierwszy silnik (`tools`, `beginTurn`, `resolve`, `reject`, `apply`). Narzędzia tylko podglądają i trzymają szkic do końca pytania.
`apply` w kolejce: ponowne wczytanie tygodnia, porównanie odcisku (data, odcisk wejścia, zapisane dni, dni trenowane) i — dla zmian — ponowne zrobienie podglądu i porównanie z tym, który widziała
osoba; różnica to `ProposalChangedError`. Zmiana planu i dzień złożony zapisuje `saveCoachWeek` (prośby, zastąpione prośby i tydzień w jednej transakcji; generacją jest id propozycji, więc
druga akceptacja nic nie zapisuje). Sesja dodatkowa to `acceptDay` z `kind: 'extra'` i hashem pokazanego planu; wymaga zakończonej sesji głównej dnia (`finish_first`) i dnia treningowego (`rest_day`).
Trwający trening blokuje każdą propozycję (`in_progress`). Blok nie jest zapisywany przy akceptacji tygodnia — przesuwa go start sesji.

## 5. Konwencje testów

- Jest (`jest-expo`), pliki `src/**/__tests__/*.test.ts`. Pokrycie `src/domain/**` i `src/ai/**` = 100% (próg w `jest.config.js`).
- Testy są nazwane numerami z korpusu: `describe('T01 …')`, żeby da się było odnaleźć przypadek odbioru ze specyfikacji (08 §3).
- Fixtury domeny: `src/domain/__tests__/fixtures.ts`, `extraFixtures.ts`. Nie importować `Date.now()` w kodzie domeny; testy podają daty jawnie.
- `npm run verify` = lint + format:check + routes:types + typecheck + validate:data + test:coverage. Przed zamknięciem etapu zielony.
- Golden baseline silnika: `src/domain/__tests__/engineBaseline.test.ts` (§4.4). Zmiana wyniku wymaga świadomej regeneracji
  skrótu i wpisu w UWAGI.

### P6 — odbiór testów biegnącej sesji (2026-10-09)

Testy komponentów loggera korzystają z `SessionStep` skompilowanego z recepty. Sprawdzają `LoggedEntry`, w tym kanał i potwierdzenia pól, zamiast dawnych wierszy `set_logs`. `alternatives.test.ts` używa rzeczywistego rankera z fixture domeny i mockuje granicę bazy: sprawdza rewizje, akceptację patcha i zapis wyboru na blok wyłącznie po udanej zmianie sesji. Testy karty zamiennika sprawdzają osobny podgląd i jawny przycisk akceptacji. `useSessionVoice` przekazuje odczyt loggera; cofnięcie pominięcia otrzymuje całe polecenie z identyfikatorami serii.
### P6 — aktywacja konsumentów planowania i czatu (2026-10-09)

`features/plan/today.ts` odświeża tydzień w SQLite, pobiera kontekst rzeczywistej historii i tworzy `DayPreview`. `usePlanToday` przekazuje do `acceptDay` żądanie i hash dokładnie tego podglądu. `planDayIn` odczytuje utrzymany wybór dzisiejszego dnia z `planned_days` w tej samej transakcji; uwzględnia go w odcisku wejść i przelicza receptę. Zmiana wyboru albo historii po podglądzie zatrzymuje start. Powtórne naciśnięcie startu po udanej akceptacji nie generuje kolejnego polecenia.

Ekrany prezentują ekspozycje i etykiety wyprowadzone z kroków wykonania. `DaySummary` niesie informacje dnia i bloku; `traceText` opisuje receptę, `checkText` opisuje audyt. Kalendarz czyta nowy tydzień, a rzeczywiste sesje i dawne serie pozostają historią. Bilans tygodnia pochodzi z `buildHistoryIndex`/`weekWork`: pewne serie są oddzielone od niepewnych. Zakończenie głównej sesji oznacza dzień w nowym tygodniu; zakończenie dodatkowej nie zmienia tego statusu. Licznik listy historii pomija tombstones.

Dodatkowy trening korzysta z tego samego czytnika wejść i plannera. Opcja jednego ruchu oraz połączony podgląd uwzględniają pracę wykonaną w głównej sesji. Dopiero `acceptDay` zapisuje sesję. Ekran obsługuje konflikt, zmianę daty i błąd podglądu przez ponowny odczyt.

Czat używa `app-services/coach/proposals` dla tygodnia, dnia, sesji dodatkowej i zmiany trwającego treningu. Narzędzia sesji zachowują ocenę tylko w obrębie pytania; nowa rozmowa/pytanie czyści karty i oceny. `assessmentText` dostarcza tekst karty, `applySessionChange` ponownie ocenia patch w transakcji po akceptacji użytkownika. Zmiana rewizji daje kartę nieaktualną, a spóźniony wynik narzędzia jest odrzucany. Symulacja i wyjaśnienie planu mają świeże czytniki SQLite. Źródło jutra konsultacji czyta `planned_days`.

Pozostałe adaptery testowe, ewaluacje, strażnik wyboru jutra i dawne repozytoria wymagają jeszcze sprzątania; aktywacja konsumentów nie jest zamknięciem całego P6.
### P6 — odłączenie pozostałych konsumentów starego plannera (2026-10-09)

Ewaluacje pytają `planPreview` oraz `planDay`/`syncWeek`, tak jak telefon. `syntheticWeekContext` zamienia syntetyczne dzienniki w rzeczywiste ekspozycje o zakresie supplemental: dziennik nie zawiera zamrożonej recepty, więc nie tworzymy z niego dowodu progresji. Rozgrzewki, wiersze bez ilości, nieznane i przyszłe sesje są pomijane. Wysiłek i ilość zachowują pochodzenie zgłoszonego wyniku; prognozy nadal istnieją tylko w plannerze. Kontekst ewaluacji jest budowany dopiero, gdy narzędzie planu go potrzebuje, i współdzielony przez narzędzia jednego przypadku.

Środowisko AI ma wyłącznie `explainPlan`; usunięte dawne `PlanLookup` i `plan`. Oczekiwania testów transportu obejmują brak narzędzia, a szczegóły obecnego wyjaśnienia nadal są sprawdzane w `planPreview.test.ts`. Usunięte prompty czatu v1–v6 wraz z testami oraz martwe `features/plan/coachPreview` i `planningSnapshot`.

`selectionGuard.checkSelection` sprawdza wybór jutra na wspólnych danych plannera: kwalifikacji ćwiczenia, żądaniach, fazie nowego bloku, regeneracji, zakwasach i budżetach. Dostaje jawne fakty rzeczywistej historii plus projekcję niewykonanej części sesji; nie tworzy obserwacji ani nie zapisuje prognoz jako wykonanej pracy. Limit dnia jest zgodny z obecnym silnikiem (3 bezpośrednie serie). `session/effects` nie zależy już od starego `dayPlanner`.
