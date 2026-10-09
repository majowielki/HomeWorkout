# Silnik v2 — uwagi, odstępstwa i rzeczy do sprawdzenia

Trzy części: **(1)** stan repozytorium i decyzje robocze, **(2)** odstępstwa od specyfikacji, **(3)** do sprawdzenia przez człowieka
(telefon, fizjoterapeuta, decyzje produktowe). Pozycje zamknięte nie są usuwane, tylko oznaczane ✔ z datą.

## Aktualne decyzje P6 — 2026-10-09

- **Brak resetu danych.** Kod archiwizacji/resetu jest usunięty. Historyczne workouts i set_logs
  zostają, a planowanie ignoruje planSchema = 1. Dawne aktywne sesje przechodzą do historii jako
  abandoned. Wiersze bez observation są tylko do odczytu i nadal stanowią legacy_unknown.
- **Baza:** przebudowa workouts usuwa template_id z FK; nazwa szablonu trafia do historycznego
  plan.title. Dane podrzędne przeżywają kaskadę przy DROP dzięki kopiom tymczasowym w tej samej
  transakcji. Test obejmuje FK ON i rollback w środku odtwarzania. legacy_sessions zostaje dla
  archiwalnych backupów; usunięcie nieużywanego kodu resetu nie uzasadnia kasowania tych danych.
- **Nazwy:** kod używa SessionPlan, planDay, syncWeek, sessions, planning, history i proposals.
  Wersje migracji i JSON oraz nazwy pól czytanych z dawnych backupów pozostają rozpoznawalne.
- **Shared code:** modele oporu używają kalibracji i drabinek sprzętu. estimatedPeakKg jest
  nadal wywoływane. Dane A/B służą deterministycznej syntetycznej historii ewaluacji; nie są
  instalowane do SQLite ani nie służą startowi sesji. Nie usuwamy używanych obliczeń sprzętowych.
- **UI:** brak osobnego przycisku „Przywróć ćwiczenie z planu” — powrót przez ponowną zamianę.
  Ranking zwraca najwyżej trzy zamienniki. Dodaj ćwiczenie, pełny ekran alternatyw, preferencje,
  pytania o awans i konsument matchSessionIntent są kolejną pracą po odbiorze aktywacji.
- **Prompty i baseline:** dawne chat/v1–v6 i weekly-summary/v2 oraz testy usunięte; historia w Git.
  Porównanie baseline P0 nie jest już bramką. Spadek liczby testów wynika z usunięcia tych
  implementacji; progi pokrycia zostają 100% i bieżący silnik ma własne testy.
- **Odbiór i wydanie:** po wyraźnej zgodzie użytkownika test ADB/UI został wykonany na
  emulatorze, a Worker kontraktu 7 wdrożony razem z przygotowaniem APK. Dowody są w
  [ODBIOR-P6](ODBIOR-P6.md). Test telefonu użytkownik wykonuje sam; do jego potwierdzenia
  P6 pozostaje otwarty i niescalony.
- **Poprawki z odbioru:** identyczne zdania oceny są prezentowane raz; opis
  „pozostają do zrobienia” nie jest poleceniem zmiany obciążenia. Polecenia „zrób”,
  „polecam” i zwiększanie obciążenia nadal przechodzą przez strażnika odpowiedzi.
  Usunięto nieaktualną obietnicę szablonów i opis startu FBW A/B.
- **Schemat narzędzi Workera:** model powtarzał niepoprawny rodzaj zmiany sesji.
  Eksport Zod do draft 4 przekazuje literały jako `enum`, zamiast `const`;
  SDK Google normalizuje `const` dla odpowiedzi, ale nie dla funkcji. Po zmianie
  ten sam test przeszedł: odczyt → ocena → karta → akceptacja 3 → 2 serie.
  Oryginalny ścisły schemat nadal waliduje wywołania. Diagnostyka zapisuje wyłącznie
  znane nazwy pól, znane rodzaje i liczbę dodatkowych pól, nigdy ich wartości.

Poniższe wpisy to zapis decyzji z wcześniejszych etapów. Zdania o wyłączonym resecie albo UI
na dawnym silniku są historyczne; bieżący stan opisują powyższe decyzje i PRZEKAZANIE-P6.

## 1. Stan repozytorium i decyzje robocze

| Data | Uwaga |
|---|---|
| 2026-10-09 | `main` ma **niezatwierdzone zmiany użytkownika** (40 plików, ok. 800 linii): głos z parametrami serii, powody niedobicia dla trenera, kontrakt Workera v6, `Documents/DO-ZROBIENIA.md`, `GLOS.md`. Według DO-ZROBIENIA to wdrożona i zbudowana już wersja (APK `…-voice-parameters-coach-v6.apk`). Nie są częścią przebudowy: w pracy nad silnikiem stage’uję wyłącznie własne pliki (`git add <ścieżki>`), a ich zatwierdzenie zostawiam użytkownikowi. Jeśli któryś etap będzie musiał dotknąć tego samego pliku (np. `src/strings/pl.ts`, `src/db/repositories/coachSource.ts`, kontrakt AI), zatrzymam się i zapytam. |
| 2026-10-09 | Pakiet architektury leży poza repozytorium (`D:\Projekty\HomeWorkout\architektura-silnika-2026-10-08`). Dokumenty tutaj odwołują się do niego ścieżką względną `../../../architektura-silnika-2026-10-08/`. Po sklonowaniu repo gdzie indziej te linki nie zadziałają. |
| 2026-10-09 | Katalog roboczy sesji zmienia się po `cd` w narzędziu powłoki; komendy używają ścieżek bezwzględnych albo zaczynają od `cd` do korzenia repo. |

## 2. Odstępstwa od specyfikacji

Każde odstępstwo: co plan mówi, co robię, dlaczego, czy wymaga zgody.

| Spec. mówi | Robię | Dlaczego | Zgoda |
|---|---|---|---|
| 13 §2: `resolveDayPolicy(base, week, date, intent, phase, constraints, prefs)` zwraca `DayPolicy` z polami `sessionSec`, `setsByKind`, `weekly`, … | P0.4 wprowadza `resolveDayPolicy(base, week, intent)` i `DayPolicy = PolicyBase & { intent }` (opakowanie na obecne `PlannerConfig` i `TRAINING_CONFIG`) | Zachowuje obecne API planera i zero zmian zachowania w P0. Pola ze specyfikacji dochodzą w P1/P3 razem z kodem, który je czyta; dodanie ich teraz byłoby martwym kodem pod progiem 100% pokrycia | nie wymaga |
| 07 §2c, P0: „nie zwracać `PERFORMANCE_REGRESSION` … tylko uczciwy kod i tekst” — spec. zakłada kod typu `AT_MINIMUM` | Na minimum oporu zwracam zwykłe `REP_PROGRESSION` (istniejący kod), bez nowego kodu | Kody powodów są wyliczone w kontrakcie czatu (`z.enum(PROGRESSION_REASONS)` w `chatTools.ts`), więc nowy kod to zmiana kontraktu i wspólne wdrożenie Workera, a `src/strings/pl.ts` i `versions.ts` mają niezatwierdzone zmiany użytkownika (§1). Nowe kody (`AT_MINIMUM`, `BUILDUP_BELOW_RANGE` …) wchodzą z P3/P5 razem z kontraktem. Tekst `REP_PROGRESSION` („o powtórzenie więcej”) bywa tu niedokładny, bo cel = dół zakresu | nie wymaga |
| 05 §6: model oporu dostaje `ModelContext` przy każdym wywołaniu (`validate(value, ctx)`, `nextHarder(current, ctx)` …) | Model jest budowany *dla* jednego ćwiczenia i inwentarza (`registry.create(ref, ctx)`), a metody nie biorą kontekstu | Ten sam efekt, mniej parametrów; kontekst (hantle, gumy, kalibracje) i tak zmienia się razem z inwentarzem, czyli przy budowie nowego modelu. Parametry per ćwiczenie (`romCm` gumy, `variantId`) są parametrami katalogu | nie wymaga |
| 05 §3: pole `equipmentFamily` w definicji ćwiczenia | Wyliczane z `equipment` (`equipmentFamilyOf`); brak kolumny w danych | Jedno źródło prawdy; nie da się rozjechać z listą sprzętu | nie wymaga |
| 05 §13: krawędzie `harder` i `easier` na każdym ćwiczeniu | Krawędź zapisana raz, w stronę `harder`; odwrotną dodaje graf | Dwa zapisy tej samej prawdy mogłyby się rozjechać; walidator wciąż wyłapuje sprzeczność, gdy ktoś zapisze obie | nie wymaga |
| 05 §13 (v1.3): przykładowe krawędzie rdzenia `hollow-hold → dead-bug` oraz reguła walidatora „ta sama `measurement.kind`” | Obie rzeczy naraz: krawędź zmieniająca jednostkę (sekundy ↔ powtórzenia) jest dozwolona **tylko jawnie** (`changesMeasure: true`; walidator zgłasza błąd bez znacznika i błąd przy znaczniku bez zmiany jednostki). `dead-bug → hollow-hold` jest taką krawędzią; `boat-hold → hollow-hold` zostaje w jednostce. `nextVariant` przy remisie wybiera wariant liczony tak samo jak obecny (sekundy zostają sekundami), dopiero potem zmieniający jednostkę | Przykład w planie łamał własną regułę. Zmiana jednostki jest uczciwa, bo nowy wariant startuje z własnej historii i kalibracji, nic się nie przelicza. Użytkownik: „zrób tak, żeby było dobrze” (2026-10-09) | zamknięte |
| 07 P2, 02 §8a: archiwizacja i reset danych w ramach P2 | Cała maszyneria jest gotowa i przetestowana, ale **reset jest wyłączony** (`ENGINE_V2_RESET_ENABLED = false`) do aktywacji w P6 | Silnik, który dziś planuje, to nadal pierwszy; skasowanie historii teraz zostawiłoby aplikację z pierwszym silnikiem startującym od zera, bez żadnego pożytku. Użytkownik dał „Start” dla P2, więc kod istnieje; włączenie to jedna stała razem z ekranem informującym o archiwum (P6). Do tego czasu historia pozostaje i można ją testować | do potwierdzenia przy P6 |
| 07 P2.4, P2.9: logger zapisuje pochodzenie per pole, aktywna sesja v1 kończy się jako v1 | Polecenia i schemat są gotowe (`logSetV2` itd.), logger UI nadal zapisuje starym `logSet` | Polecenia v2 wymagają planu v2 (`plannedSetId`), którego aplikacja jeszcze nie tworzy; przepięcie loggera w P5 razem z kompilatorem planu. Nowe sesje v1 i v2 mogą współistnieć w bazie | nie wymaga |
| 13 §3: `normalizeObservations(plans, observations, dispositions, feel)` | Czwarty argument obiektowy `{ sessions, plans, observations, dispositions, feel }`: dochodzą metadane sesji (status, faza deloadu, skrócone ekspozycje) | Bez statusu sesji nie da się odróżnić „jeszcze do zrobienia” od „pominięta po zamknięciu”; faza deloadu i skrócenia dochodzą do planu/rewizji w P3/P4b (do tego czasu `false` i `[]`) | nie wymaga |
| 02 §5: `UNIQUE(command_id)` w `set_dispositions` | Brak unikalności (jedno polecenie pomija wiele serii); idempotencję daje księga poleceń | | nie wymaga |
| 02 §5: kolumna `training_date` w `set_logs` | `performed_on` | Nazwa `training_date` zderzała się z `workouts.training_date` w zapytaniach z JOIN-em (kolizja nazw kolumn w wyniku) | nie wymaga |
| 13 §1: `trainingDate` ma delegować do `trainingDateOf` ze strefą urządzenia | `trainingDate` używa lokalnych getterów (`getHours`, `getDate`), `trainingDateOf` — `Intl` z jawną strefą | Wynik jest ten sam (test „agrees … every half hour”), a stara funkcja nie zależy od `Intl.DateTimeFormat` w Hermesie (13 §1 każe to sprawdzić na urządzeniu — T-1) | nie wymaga |

### 2a. Odstępstwa w P3 (progresja)

| Spec. mówi | Robię | Dlaczego | Zgoda |
|---|---|---|---|
| 13 §7 i 03 §12.2: oś pośrednia = najpierw `add_set`, potem `extend_range`, potem hold. T81 (v1.1) oczekuje `add_set` | Najpierw `extend_range`, potem `add_set` (tylko gdy zakresu nie można wydłużyć, albo oś jest wyłączona), potem hold | 03 §12.3 i 13 §6 (v1.2, D29) oczyszczają szczebel *osiągnięciem rozszerzonej góry zakresu*; dodatkowa seria oczyszcza tylko przy braku możliwości wydłużenia. Gdyby `add_set` szedł pierwszy, ekspozycje z dodatkową serią nigdy nie spełniłyby kryterium oczyszczenia (wydłużonego zakresu nikt by nie ćwiczył). Test T81 w kodzie sprawdza kolejność odwrotną niż w v1.1 | zamknięte 2026-10-09 (Q-6) |
| 13 §7: „górny cel +step, maks. +extendBy” | Wydłużenie o krok na ekspozycję (1 powt. albo 5 s; 2 kroki po „za łatwo”) aż do `góra + 5` powt. (limit: `repCapOf`) albo `góra + 15 s` (sekundy bez limitu własnego). Rozszerzona góra zapisuje się w planie (`target.max`), więc kolejna ekspozycja oceniana jest względem niej | Skok od razu o 5 powtórzeń nie pasowałby do podwójnej progresji; gradualnie pasuje do reszty. Wartości są strojone (`PROGRESSION_V2_CONFIG.extendBy`). Sekundy nie mają ustalonego w spec. limitu: 15 s to moja wartość | zamknięte 2026-10-09 (Q-6) |
| 13 §4: `context` = `intro`/`recalibration` z polityki | `qualifyExposure` dostaje je jako opcję; historia **nie** oznacza dawnych ekspozycji jako intro (porażki w dwóch pierwszych ekspozycjach liczą się jak każde inne). Faza *bieżącej* recepty (RIR 4, `INTRO_EXPOSURE`, `RECALIBRATION`) jest w `phaseRule` | Rekalibracja po przerwie zależy od zegara z tamtej chwili, którego domena nie zna; obliczanie go wstecz dałoby zależność od dzisiejszej daty | nie wymaga |
| 13 §5: `phaseRule` w kolejności zwykłych reguł; `final` zatrzymuje wszystko poza shadow, sets, normalize | `phaseRule` jest `always` i dopisuje kody do `notes` (`DELOAD`, `RECALIBRATION`, `INTRO_EXPOSURE`), które `normalizeRule` dokleja **po** kodzie decyzji. Maksimum oporu (`maxHarder`) ustawia tylko deload i rekalibracja, nie intro | `returnRule` (4) jest `final`, więc deload i rekalibracja po przerwie (T32) inaczej by się nie wykonały; kod fazy nie może przesłonić przyczyny w `trace.code`. Zakaz awansu w dwóch pierwszych ekspozycjach spowalniałby osobę, która od razu trafia w górę zakresu (kalibracja w sesji robi to lepiej) | nie wymaga |
| 13 §5: `probeOutcomeRule` (8a) po `successRule`; 13 §16: „wykonywana przed `successRule`” | Przed `evidenceRule` (5b). Udana próba przesuwa całą ekspozycję na nowy szczebel, jeśli serie robocze nie były poniżej zakresu, nie były skonfundowane i nie zmieniły oporu; nieudana nie jest porażką i idzie dalej zwykłą oceną | Próba to osobny dowód o nowym szczeblu; musi być przeczytana, zanim brak jednej serii roboczej zamieni ekspozycję w „utrzymaj” | nie wymaga |
| 13 §4: wynik liczony tylko przy komplecie, porównywalności i jakości | Dodatkowo: tydzień deloadu i ekspozycja skrócona na prośbę dają `not_evaluable`. Decyzja bierze **ostatnią ekspozycję spoza deloadu**; deload przerywa serię „kolejnych” porażek, ale nie przerywa budowania do zakresu. Kompletna ekspozycja z porzuconej sesji jest dowodem jak każda inna | Spec. mówi „nie łączyć porażek przed i po deloadzie”, ale nie mówi, co po deloadzie: czekanie na kolejną zwykłą ekspozycję kosztowałoby tydzień bez powodu. Porzucenie sesji po zrobieniu całego ćwiczenia nie unieważnia tego ćwiczenia | zamknięte 2026-10-09 (Q-7) |
| 03 §10: rejestr kodów | 40 kodów. Spec. nie wymienia: `INTRO_EXPOSURE`, `REP_PROGRESSION` (istniał w pierwszym silniku), `LAYOFF_STEP_DOWN`, `RE_EXPOSURE`, `PROBE_COOLDOWN`, `NO_ROOM_FOR_PROBE`, `NOT_PRESCRIBED`. Nie ma jeszcze `ROTATION_*`, `INSUFFICIENT_ROTATION_EVIDENCE`, `ESTIMATED_STEP_TOO_LARGE` (rotacja i estymator). Krótka i średnia przerwa: `LAYOFF_REPEAT` / `LAYOFF_STEP_DOWN` (ten drugi tylko, gdy opór faktycznie się zmienił) | Uczciwe kody (D39 e): przerwa średnia na najlżejszym szczeblu nie mówi „krok lżej”. Kody z kontraktu pierwszego silnika (`LAYOFF_MEDIUM` itd.) nie są używane. **Nowe kody to zmiana kontraktu AI i wspólne wdrożenie Workera (P5)** | nie wymaga |
| 13 §6: oczyszczenie przez dodatkową serię, gdy zakresu nie można wydłużyć | „Dodatkowa” = więcej serii logicznych niż miała ekspozycja, w której szczebel zawiódł (nie: niż rekomenduje `recommendSets` dziś) | Przy braku miejsca dziś (`recommended = 0`) każda ekspozycja liczyłaby się jako „z dodatkową serią” | nie wymaga |
| 13 §5: `RuleCtx` ma `ex`, `clock`, `scope`, `feel`, `dayPolicy`, `prefs`; 13 §0: `progression/calibration.ts` | Wejście to `NextInput` (opór/zakres/limit powtórzeń/RIR slotu, historia primary, `asOf`, przerwa, faza, `eligible`, rekomendacja serii, sąsiednie warianty, odpowiedzi osoby); odczucie wchodzi z rekordu ekspozycji, preferencje przez `sets` i `variants`. Kalibracja w sesji to `progression/firstExposure.ts`, bo `calibration.ts` to kalibracja gum | Domena nie zna jeszcze `ExerciseDefinitionV2`, `PlanningClock` ani `DayPolicy` w pełnej postaci (część P4); przeniesienie plików gum to osobny, niepotrzebny teraz ruch | nie wymaga |
| 13 §3: `QuantityTarget` w drafcie | `Draft` niesie cele per seria jako liczby i zakres (`range`); `target.min` w planie = `min(dół zakresu, najniższy cel)` ustali kompilator (P4), bo schemat planu wymaga `min ≤ target`, a cel budowania bywa poniżej dołu zakresu | | nie wymaga |
| 12 §5: `recommendSets(ex, slot, phase, room, policy, prefs)`, czas z kompilatora | `recommendSets({kind, primaryMuscles, phase, lighterDay, room, policy, preferences})`; czas jako wywołanie zwrotne `room.fitsTime(n)` | Kompilator i model czasu to P4; kontrakt wywołania zwrotnego pozwoli go podpiąć bez zmiany funkcji | nie wymaga |
| 13 §3 (kod `CONFIRM_STEP_UP`) | Autopilot = ostatnie dwie ekspozycje primary tego klucza, w których **każda** wymagana seria miała ilość i wysiłek z niezmienionych podpowiedzi. Odpowiedź osoby (`user.stepUp`) przychodzi z wywołującego | Zgodne z 13 §12; w testach domyślny wynik z fixtur to wpisane przez osobę | nie wymaga |

### 2b. Domknięcie P4 (2026-10-09)

- `planDayV2` zapisuje w `trace.evidence.selection` ważone składniki rzeczywiście użytego score: deficyt,
  przeterminowanie slotu, bonus compound i preferencję, sumę oraz marginalny koszt kompilatora w sekundach (04 §3, D25).
  Nie wprowadzono nowych wag ani strojenia polityki. Koszt przezbrojeń ogranicza czas; osobna kara w score i oracle
  pozostają eksperymentem P8.
- Propozycje i regiony dnia opisują **końcowy audytowany plan**. Po `no_feasible_plan` są puste; naprawa usuwa propozycje
  ćwiczeń, których nie ma w wyniku. Regiony liczą serie logiczne work/probe/backoff, bez praktyki i mobilności (D22,
  04 §2). Wcześniej opisywały kandydata przed naprawą i mogły tytułować dzień wypełniaczem.
- Dwa wyłączone testy były problemem fixtur: przysiad zużywał budżet zamiennika wykroku, a długa przerwa i osiągnięty
  cel tygodniowy powstrzymywały generację propozycji. Scenariusze badają teraz samą zamianę oraz jawnie wybrane sloty.
  Test odpowiedzi „tak” sprawdza próbę szczebla, więc nie przechodzi przez sam brak propozycji.
- `planDayV2` jest wejściem **domeny v2**, obok starych ścieżek aplikacji. Przeniesienie wszystkich konsumentów,
  rezerwacje aktywnej sesji, snapshot z DB, UI/AI oraz komunikaty polskie są P4b/P5/P6. Adapter katalogu planera
  obsługuje obecne hantle, gumy i masę ciała; kompilator/audyt przyjmują modele przez `modelOf`.
  Włączenie nowego sprzętu w aplikacji nadal wymaga pełnego odbioru P9.
- `recordsOf` w symulacji przenosi fazę deloadu do `ExposureRecord.context.deload` (D31, Q-7). Dawniej symulacja
  mogła używać deloadu jako zwykłego dowodu progresji. Cele dystansowe są jawnie odrzucane przez symulator, którego
  zakres to powtórzenia i sekundy; nie zamienia ich na fikcyjne powtórzenie (T51).
- Obserwacja D22 pozostaje do benchmarku P8: compound 3 serie wcześniej wyczerpuje maksima tygodniowe; krótszy
  legalny dzień albo praktyka/mobilność po wyczerpaniu limitów są dopuszczalne. Nie podnoszono limitów dla testów.

### 2c. P4b.1 — nazwy i aliasy (2026-10-09)

- `resolveExerciseRef` przyjmuje jawny słownik jako trzeci argument, a fabryka `createExerciseResolver`
  przygotowuje indeks do wielu zapytań. Spec. 13 §11 pokazuje dwa argumenty; dodatkowe wejście zachowuje
  granicę czystej domeny (bez importu JSON) i pozwala odtwarzać wersję słownika.
- Przed przybliżonym Jaccardem rozpoznawane są równoważne zbiory tokenów ze słownika. Dzięki temu odmiana
  „wyciskania siedząco” odpowiada aliasowi „wyciskanie siedząc” mimo dłuższej oficjalnej nazwy wariantu.
  Kierunek, pozycja, strona i sprzęt są zachowywane przy dopasowaniu; „zza głowy” nie jest synonimem „nad głowę”.
  To doprecyzowanie T70, a nie dodanie nowego ćwiczenia ani obejście kwalifikacji.
- Not_found zwraca do trzech kandydatów o **dodatnim** podobieństwie; dla pustego i całkiem obcego zapytania
  lista jest pusta. Wskazówka `movement` jest jawna i może być null. Archived nie jest rozpoznawane jako active.
- Katalog v6: 109 aliasów dla 63 ćwiczeń. Wersja podniesiona, żeby seed dostarczył pola do istniejącej bazy;
  poza wersją zmieniono tylko aliasy. Historia nie jest resetowana. Katalog może być dalej rozszerzany o
  sprawdzone potoczne nazwy; equivalenceGroup i secondaryWeights zachowują dotychczasowe wartości domyślne.

### 2d. P4b.2 — kontrakt oceny i granice integracji (2026-10-09)

- Snapshot domeny jest rozszerzeniem `DayInputV2`, a nie importem obecnego snapshotu funkcji UI (który
  nadal czyta historię v1). Adapter bazy i podłączenie do aplikacji należą do P5.
- Patch ma oprócz `ops` konkretny `plan` nowej rewizji. Jest wynikiem oceny do podglądu; stamp resume i pusty
  `overrides` nie zastępują ponownego audytu/ACK w transakcji P4b.4.
- Gdy `recommendSets` daje 0 i nie podano liczby, ocena przedstawia dawkę domyślną polityki oraz advice,
  zamiast pustego patcha. Jawnej liczby nigdy nie przycina. Liczba obejmuje także ewentualny probe.
- `reduce_remaining.easier` ocenia lżejszy osiągalny opór. Przejście na łatwiejszy wariant przy minimum oraz
  `feel` są ocenianymi opcjami P4b.5; ranking wszystkich alternatyw jest P4b.3.
- Operacje usuwające/zastępujące pending zachowują listę usuniętych ID. Polecenie P4b.4 musi zachować stare
  rewizje/dyspozycje i zapisać redukcję (`USER_REDUCED`), żeby skrócenie nie stało się dowodem kompletnej
  pierwotnej ekspozycji. Ocena nie zapisuje wyników ani nie oznacza jeszcze FeelReport.
- Czas jest szacunkiem kompilatora; wykonane/przerwane kroki pomniejszają budżet, pominięte nie. Pomiar
  p95 na telefonie pozostaje odbiorem integracji; wynik desktopowy nie zastępuje pomiaru urządzenia.
- Jutro używa tego samego `checkSelection`, z faktami v2 i wyraźnym `ProjectedExposure`, bez tworzenia
  pozornych actual lub wymyślania oporu v1 dla przyszłego sprzętu. Dotychczasowi konsumenci funkcji zachowują
  swoje zachowanie (golden baseline bez zmian).

### 2e. P4b.3 — ranking i pełna pula (2026-10-09)

- Publiczna ocena dołącza alternatywy; podstawowa `evaluateSessionChange` jest współdzieloną oceną
  bez rankingu. Takie rozdzielenie usuwa rekurencję i cykl importów. `maxAlternatives: 0` pozwala
  ponownie ocenić konkretny zamiar bez przeglądania zamienników, z tym samym `assessmentId` i `patchId`.
- Spec. 11 §4 szacuje maksymalnie 1 + 3 oceny, ale §5 wymaga werdyktu jako pierwszego klucza pełnej puli.
  Oceniam wszystkich kandydatów przed obcięciem do trzech wyników; inaczej mogłaby wygrać odradzana opcja,
  mimo istnienia wykonalnej poza pierwszą trójką biomechaniczną. Optymalizacja wspólnych indeksów/cache
  i pomiar na telefonie są odbiorem integracji; nie deklaruję spełnienia p95 < 150 ms na podstawie Jesta.
- `comparisonFamily` jest opcjonalnym polem katalogu/schematu, bez dopisywania heurystycznych rodzin
  do obecnych danych. Brak/null nie łączy ćwiczeń. Rodzina służy odkrywaniu kandydatów, bez transferu siły.
- Każda pozycja zawiera także jawne `change` i pełną ocenę bez dalszych alternatyw. Zachowuje żądane serie,
  pozycję lub ID zamienianej ekspozycji; UI może pokazać kontrole i ponownie ocenić właściwy patch w P4b.4.
- Werdykt, preferencje, deficyt, nakładanie i regeneracja liczone są po wspólnej ocenie. `avoid` nie wyklucza,
  a hard fail zawsze usuwa kandydata. UI/AI/DB pozostają do podłączenia w następnych etapach.

### 2f. P4b.4 — granica zapisu i zachowane recepty (2026-10-09)

- Spec. 11 §6 pokazuje samo `patchId`. Polecenie ma także jawne `change` (z P4b.3): hash jest
  nieodwracalny, a preview nie zapisuje rejestru propozycji. W transakcji zamiar jest ponownie oceniany,
  a wygenerowane ID musi zgadzać się z wybranym. Nie ufamy planowi ani operacjom przesłanym przez UI/AI.
- Kontrakt aplikacji jest asynchroniczny, sama transakcja synchroniczna jak pozostałe polecenia P2.
  Implementacja zapisów leży w `db/repositories/sessionChanges.ts`, a publiczne wejście w wymaganym
  `app-services/commands/applySessionChange.ts`; wspólny ledger, counters i outcomes nie są kopiowane.
- Do ponownej oceny potrzebny jest już teraz świeży odczyt v2, dlatego P4b.4 dodaje minimalny builder
  `sessionChangeSource.ts` czytający przez executor transakcji. Nie importuje obecnego snapshotu UI v1.
  Pełna integracja planera/bloków, runnera i kanałów pozostaje w P5. Brak aktywnego bloku używa wyborów
  zamrożonego planu; inwentarz hantli pozostaje konfiguracją domeny, gumy i kalibracje pochodzą z bazy.
- Nie dodaję osobnej tabeli rezerwacji: aktualny pending plan i jego rewizja są źródłem rezerwacji
  uwzględnianym w `remainingVolume`. Zapis podnosi history/session revision i unieważnia starsze oceny.
- Usunięte pending ID otrzymują dyspozycję `skipped/replaced`; stare recepty pozostają w rewizjach.
  Odczyt historii/outcomes scala je po ID, nie podaje tego złożenia runnerowi jako nowego planu.
  Dzięki temu skrócenie nie zmniejsza po cichu expected i nie daje awansu. `USER_REDUCED` jest już
  zachowane w kontekście normalizacji; opcje `feel` i wybór rekomendowanej opcji są nadal P4b.5.
- Hard/niejednoznaczność po ponownej ocenie daje `CHANGE_BLOCKED`, przed porównaniem brakującego patcha.
  Override przechowuje wyłącznie advice-faile rzeczywiście obecne w tej ocenie. Zbędny/hard ACK nie
  daje dodatkowych uprawnień. Zmiana wykonalnego patcha lub fingerprintu daje `STALE_INPUT`.

### 2g. P4b.5 — kontrakt opcji feel i zapis obserwacji (2026-10-09)

- Spec. 11 §7 nie określa pól opcji na `ChangeAssessment`. Dodaję opcjonalne `feel` z `options`
  i `recommendedOptionIds`. Każda opcja zawiera zamiar i pełną ocenę liścia (jak P4b.3), a opcja
  „następnym razem trudniej” ma null zamiar/patch. Nie dodaje się rekurencyjnych alternatyw.
- Przy null ekspozycji nie zgaduję bieżącego ćwiczenia: raport dotyczy sesji, opcje i rekomendacje
  są osobne dla każdej ekspozycji pending. Każda z tych alternatyw obowiązuje na bieżącej rewizji;
  akceptacja jednej wymaga odświeżenia pozostałych. Po wykonaniu całości zostaje flaga `too_easy`.
- Czysta domena nie zapisuje odczucia. Nowe `reportSessionFeel` w app-services zapisuje je wraz
  z wynikiem oceny w jednej transakcji. Oczekiwane rewizje zapobiegają ocenie zmienionej sesji;
  wynik opcji powstaje po zapisie raportu i podniesieniu historii, więc nie jest od razu stale.
  Osobna późniejsza akceptacja używa dotychczasowego `applySessionChange` i ACK.
- `recordFeelV2` z P2 pozostaje dostępne jako sam zapis. Wspólny writer podnosi teraz history
  revision (wcześniej tylko session revision), bo odczucie zmienia wejście progresji i konsultacji.
  Nie jest wymagana migracja; istniejące `feel_reports` i ledger wystarczają.
- Ranking opcji redukcji wariantu filtruje graf do `easier` przed truncation; preferowany twardszy
  zamiennik nie może wyprzeć łatwiejszego. Zamiana na łatwiejszy wariant zapisuje `reducedFrom`
  na nowej recepturze; historia oznacza USER_REDUCED także po stronie zastępującej.
- Polski tekst opcji/kontroli: P4b.6 (§2h). UI/runner/AI nie są jeszcze podłączone (P5).

### 2h. P4b.6 — teksty oceny i poprawka samonakładania (2026-10-09)

- Spec. 11 §8 podaje sygnaturę `assessmentText(assessment): string[]`. Zdania zawierają nazwy ćwiczeń, których ocena
  nie niesie (tylko id), więc dodałem opcjonalny drugi argument `{exerciseName, maxAlternatives}`; bez niego
  pokazywane jest id. Wywołujący (UI, P5) przekazuje nazwy z katalogu.
- Domena nie importuje `@/strings`, więc teksty i nazwy mięśni są w `session/assessmentText.ts`. P5 decyduje, czy
  przenieść je do `pl.ts` (wtedy tekst jest wstrzykiwany); do tego czasu istnieje jeden zestaw, z testami.
- Usterka znaleziona przy tekstach: `OVERLAP_TODAY` (advice, `samePattern`) porównywało zmianę na ćwiczeniu w toku
  z jego własnymi wykonanymi seriami, więc `reduce_remaining`/`add_sets` były `not_recommended`, a polecana opcja
  feel „lżejszy opór” wychodziła jako odradzana. Teraz zmiana na istniejącej ekspozycji (poza `swap_remaining`)
  pomija własne ćwiczenie; dodanie tego samego ćwiczenia jako nowej ekspozycji nadal się nakłada. Test:
  `assessSessionChange.test.ts` („carries on an exercise in progress”). Golden baseline bez zmian.
- Do sprawdzenia na telefonie w P5: czy zdania czytane głosem (pierwsze dwa) są zrozumiałe; formy bezosobowe
  („Dziś zgłoszono ból”) wybrane celowo, żeby nie zgadywać rodzaju gramatycznego.

### 2i. P5.5a — serwis dnia (2026-10-09)

- Spec. 01 §4 mówi o `PlanningSnapshot` jako osobnym obiekcie z rewizjami. W kodzie jego rolę pełni odcisk całego wejścia
  (`fingerprint` w `planDayIn`) i hasz planu: wystarczy do porównania podglądu z akceptacją, a rewizje domen i tak są częścią wejścia.
  Osobny typ `PlanningSnapshot` nie jest potrzebny, dopóki nie pojawi się konsument, który go wymaga (replay diagnostyczny).
- Historia jest czytana w całości (jak w konsultacji), bez okna 120 dni i bez `loadLastComparableBefore`. Przy dużej bazie to
  kandydat do pomiaru (UWAGI T-2) — wtedy ten sam czytnik przechodzi na okno + starsze „ostatnie wyniki”.
- Prośba o deload nie ma jeszcze źródła w bazie (v1 nie miał takiej prośby); `DayRequest.deloadRequested` czeka na ekran/AI (P5.3/P5.6).
- `ENGINE_VERSIONS` (2.0.0 / policy-2.0 / compiler-1 / trace 1) to wartości z symulacji; zmiana któregokolwiek składnika
  planu wymaga podniesienia odpowiedniej wersji w `plan/versions.ts` razem z opisem tutaj.

### 2j. P5.1–P5.2 — tydzień na v2 (2026-10-09)

- Decyzja użytkownika: tydzień przechodzi na model v2 (zamiast planowania samego dnia). UI nie jest zmieniane do końca implementacji silnika (decyzja
  tego samego dnia), więc ekrany kalendarza i „Dziś” nadal czytają `planned_days` pierwszego silnika.
- Spec. 04 §5 każe przechowywać „wybory ruchów/slotów”. Przechowywany jest `KeptItem` (slot, ćwiczenie, liczba serii) i prognoza planu v2 (do pokazania
  dnia). Prognoza nie jest źródłem prawdy o obciążeniu: start sesji planuje dzień od nowa z prawdziwej historii (`acceptDay`).
- Stabilizacja jest „twarda w obrębie reguł”, nie miękka premia w score: dzień trzymany jest planowany tylko ze zapisanych slotów i albo mieści się w całości,
  albo jest wybrany od nowa. Dzięki temu zmiana zawsze ma wymieniony powód.
- Obserwacja (D22 jak w P4): przy 3 seriach compound maksima pośladków i pleców wyczerpują się w 4–5 dniu, więc dni 6–7 prognozy mają tylko lekką pracę
  i mobilność. Gdy użytkownik doda dzień odpoczynku, te puste dni dostają prawdziwy trening i pojawiają się w banerze jako zmiana (bez powodu reguły —
  to wolna pojemność, nie naruszenie). Limity nie zostały zmienione; do rozstrzygnięcia przy benchmarku P8.
- Brak jeszcze źródła prośby o deload w bazie (`deloadRequests`), sesji dodatkowych (`seq > 1`) w tygodniu v2 i unieważniania prognozy poza wejściem do ekranu
  (P5.1b). Tydzień nie zapisuje bloku.

### 2k. P5.4 — logger, głos i odpowiedzi (2026-10-09)

- Spec. 06 §3 mówi „głos przez wspólny command handler”. Sam handler (`logSetV2`) istnieje od P2; tu dodany jest budowniczy rekordu (`buildObservation`),
  którego ekran loggera i parser głosu mają użyć, oraz intencje sesji. **Podłączenie do ekranów czeka** (decyzja użytkownika: UI bez zmian do końca implementacji
  silnika) — dziś `useSessionVoice` i logger działają jak przedtem.
- Odpowiedź na `CONFIRM_STEP_UP` nie była nigdzie zapisywana (`DayInputV2.answers` było tylko parametrem), więc dodałem tabelę. Odpowiedź wygasa z nową ekspozycją klucza;
  alternatywą było trzymanie jej bez końca, co zamieniłoby „tak” w trwałe wyłączenie ochrony przed autopilotem (D20).
- `matchSessionIntent` rozpoznaje „dodaj” jako odpowiedź „tak” tylko gdy karta czeka; bez karty „dodaj” bez przedmiotu to `null`. Frazy parametrów („jak było lekko”) są
  celowo poza zasięgiem: odczucie sesji wymaga „za”/„zbyt”.
- Do sprawdzenia na telefonie po integracji: czy rozpoznawanie mowy zapisuje „zamień na coś z gumą” w postaci, którą słownik łapie (gum\w*), oraz czy odpowiedź „dodaj” / „tak” nie koliduje z istniejącymi komendami przerwy.

### 2l. P5.6a — kontrakt 7 (2026-10-09)

- Decyzja użytkownika: kod Workera i kontraktu zmieniam teraz, **wdrożenie Workera i nowego APK razem po zakończeniu implementacji silnika**, potem testy na działającej aplikacji. Do tego czasu
  telefon i wdrożony Worker pozostają na kontrakcie 6; kontrakt 7 jest tylko w repozytorium (klient N/N−1 nie jest zapewniony — zob. P5.6b).
- Spec. 11 §8 mówi o odpowiedzi „z liczbami z `checks.data`” i receptach z kilogramami, a obecny prompt zakazuje cytowania obciążeń planu. Rozstrzygnięcie: recepta z
  `assessSessionChange` jest policzona przez silnik dla dokładnie tej zmiany i wolno ją cytować; reszta narzędzi planu nadal nie niesie obciążeń.
- Pole `position` żądania zmiany nazwałem `placement`, bo test architektury (ADR 0001) zabrania w wejściu modelu pól o nazwach kojarzących się z obciążeniem (`position`, `target`, `rep…`).
- Karta propozycji (`SessionProposal`) istnieje jako dane; ekran karty w czacie jest w P6 (narzędzia sesji wiąże `createProposalController`; dawne `createPhoneSessionTools` usunięto).
- Przypadki ewaluacji dla narzędzi sesji (`evals/cases/chat`) wymagają syntetycznej sesji v2 w środowisku ewaluacji i nagrania na żywym modelu — do zrobienia przy testach na działającej aplikacji.

### 2m. P5.6b — symulacja i adnotacje (2026-10-09)

- Spec. 11 §13 każe Workerowi odrzucać wywołanie narzędzia propozycji bez `proposalId`. Obecne narzędzia propozycji nie przyjmują `proposalId` od modelu (powstaje po stronie telefonu, a powtórka daje tę samą
  kartę), więc adnotacje są deklaracją i testem kształtu, nie egzekwowaną regułą Workera. Egzekwowanie wymaga zmiany protokołu (wspólne wdrożenie, razem z kontraktem 7).
- Ostrzeżenia symulacji obejmują przekroczenie tygodniowego maksimum (z uwzględnieniem wyższego limitu pośladków i pleców). Brak „poniżej minimum” w rejestrze kodów: model czyta je z liczb (`musclesWeek` vs `min`).
  Przekroczenia czasu dnia nie raportuję, bo prognoza z konstrukcji mieści się w budżecie dnia.
- Symulacja używa `observed_trend` tylko do powtórzeń; wysiłek (RIR) zostaje na dole celu. Wystarczy na rekomendację „czy dodanie X zmieni tydzień”, nie na przewidywanie siły.

### 2n. P5.6c — plan i propozycje na tygodniu v2 (2026-10-09)

- Wyjaśnienie planu dla sesji, która już wystartowała, bierze powody dnia z `summary` zapisanego z dniem tygodnia. Dla dnia bez zapisanego wiersza (np. sesja dodatkowa albo dzień sprzed pierwszego
  zapisu tygodnia) tłumaczy tylko ćwiczenia z kodów śladu; powody dnia, sygnały i rower są puste.
- Opcje dnia (`getDayOptions`) liczą się osobnym planowaniem dla każdego z ~19 ruchów (≈ 0,5 s na telefonie według pomiaru w node ≈ 150 ms). Do pomiaru na telefonie (UWAGI T-2); jeśli za wolne — jedno planowanie
  z `only` = wszystkie sloty i odczyt `skipped`.
- `ProposalChangedError` także gdy zmieniła się data lub jakikolwiek zapisany dzień — ostrożniej niż pierwszy silnik (porównywał klucz migawki). Karta stara się więc częściej wygasać niż aplikować coś,
  czego osoba nie widziała.
- Pierwszy silnik (`proposals.ts`) i jego testy pozostają bez zmian do P6. Test architektury (ADR 0001/0006) obejmuje teraz `saveCoachWeekV2` i `acceptDay`: wolno je wołać tylko z orkiestratorów.

### 2o. Co zostaje do ekranów i P6 (2026-10-09)

- Ekrany, które czytają `workouts.plan` (JSON pierwszego silnika) — podgląd planu sesji, wznowienie, historia „plan vs wykonane” — dla sesji v2 mają `plan = null` i `plan_v2`; trzeba je przestawić na `plan_v2` przy pracy nad UI.
  Liczby i serie historii są w kolumnach starego formatu (`legacyColumns`), więc listy, wykresy i kontekst trenera działają bez zmian.
- Wywołania do wpięcia w P6: `syncWeek` na wejściu do ekranów i po zamknięciu sesji; `previewDay`/`acceptDay` zamiast `computeToday`/`startPlannedWorkout`; `createPhonePlanTools`, kontroler
  `createProposalControllerV2` i `createSimulationHook(loadSimulationBase)` w środowisku narzędzi czatu (`useCoachChat`); `matchSessionIntent` obok `matchCommand`; `buildObservation` w loggerze; `answerPrescription` pod pytaniem o awans.
- Kontrakt 7 jest w repozytorium, wdrożony Worker ma 6: APK zbudowany z `main` po scaleniu P5 wymaga wdrożenia Workera (i odwrotnie). Czat nie zadziała z niezgodnym Workerem (czytelny błąd „zaktualizuj aplikację”).

### 2p. Poprawki po przeglądzie 2026-10-09 (gałąź `fix/review-2026-10-09`)

Raport: `D:ProjektyHomeWorkouteview-2026-10-09` (7 MAJOR, 14 MINOR, 4 pytania). Co zmieniono i co zostało decyzją:

- **SES-01.** Seria próbna ma etykietę „Seria próbna” i krótką podpowiedź w loggerze. Ciężar poprzedniej serii przechodzi na następną tylko, gdy plan prosił o ten sam opór (`suggestedValues(…, previousPlanned)`): po próbie 6 kg robocze serie podpowiadają planowane 4 kg. Decyzja użytkownika (2026-10-09): jeśli próba się udała, a **wszystkie** zrobione serie robocze osoba wzięła na ciężarze próby, to jest jej własny awans (`PROBE_PASSED`, `workedAtProbeStep`), a niedobicie zakresu na nowym stopniu nie jest porażką. Gdy choć jedna robocza seria była na innym oporze — ocena jak dotąd.
- **ENG-01.** `planDayIn` i `planWeek` biorą żądanie dnia z jednego miejsca (`composedRequest`): dzień ułożony z trenerem startuje jako `compose` z tymi samymi ruchami, nie regułami dnia automatycznego. Podsumowanie „Dziś” czyta `composed` z intencji planu.
- **ENG-02 / ENG-05.** Zachowany dzień (`kept`) idzie za deloadem i „lżejszym dniem”: te same ćwiczenia, mniej serii, nadal `held`. Liczba serii w `KeptItem` obejmuje serię próbną. Nowy powód zmiany tygodnia `block` (baner: zmienił się blok/deload).
- **ENG-03 (D18).** Regeneracja jest radą także dla próśb jawnych (`only`): ruch odradzany jest pomijany z powodem `RECOVERING`, chyba że `acknowledged` zawiera `RECOVERING`. Ból (`PAIN_TODAY`, hard) nie jest chowany za regeneracją i nie da się go potwierdzić. Dodatkowy trening: ruchy odradzane są wybieralne z ostrzeżeniem (wybór = potwierdzenie). Czat: `proposeDayPlan` przyjmuje `confirmRecovery` na ruchu (kontrakt **8**, wymaga wdrożenia Workera razem z APK), zapisywane w `ComposedItem`. `getDayOptions` planuje dzień po poprzednich dniach tygodnia (`recordsBefore`), więc raportuje `RECOVERING` zgodnie z tygodniem.
- **ENG-04 (decyzja użytkownika: podłączyć).** `volumeProfile` i `volumeOverrides` czyta `resolveDayPolicy` (`volumeTargets`): `higher` = 4/6/10, własne maksimum mięśnia wygrywa z profilem. Użyte przez planer dnia, ocenę zmian sesji, symulację i licznik objętości na ekranie planu. Wersja polityk `policy-2.1`. Ustawienie profilu w UI nadal nie istnieje (tylko model i symulacja trenera). Dźwignia objętości (`volume/lever.ts`) nadal bez konsumenta — Q-01.
- **SES-02.** Odpowiedź głosu/AI jest wykonywana tylko, gdy ekran nadal jest na tej samej serii i rewizji planu (`transcriptStillApplies`, `VoiceTarget`). „Cofnij” po zapisie głosem cofa dokładnie tę serię albo mówi, że nie jest już ostatnia.
- **SES-03.** Nieudane zakończenie treningu pokazuje błąd; skok do pominiętego ćwiczenia, którego nie da się otworzyć, zostaje na miejscu.
- **DAT-01.** Backup odrzuca sesję v2 bez planu i plan innej sesji niż wiersz. Start aplikacji nie rzuca ze sweepu: sesji nie do zamknięcia poleceniem oznacza `abandoned`; błąd zapisu zostawia sesję i próbuje przy kolejnym starcie.
- **DAT-02.** Walidacja backupu zna wszystkie relacje wewnątrz pliku. Problemy normalizacji niosą `sessionId`; konsultacja sesji bierze pod uwagę tylko problemy bieżącej sesji. **Nie zrobione:** semantyczna kontrola obserwacji (`plannedSetId` należy do planu) przy imporcie — zbyt łatwo odrzuciłaby prawdziwy plik; skutki zagradza filtr problemów.
- **DAT-03.** `replay` sprawdza rodzaj polecenia i sesję (`INVALID_COMMAND`).
- **DAT-04.** Restore podnosi rewizje wszystkich domen i buduje na nowo `exposure_outcomes`.
- **DAT-05.** Księga poleceń jest przycinana (90 dni) po sweepie startowym.
- **DAT-06.** Cofnięcie i poprawka serii z gumą korygują licznik zużycia gumy.
- **ENG-06.** W superserii seria próbna idzie pierwsza, osobno, a rundy liczą się bez niej.
- **ENG-07.** Pominięcie z powodem `pain` ustawia `skippedForPain` na rekordzie serii: liczy się do bólu dnia i do reguły bólu progresji.
- **ENG-08.** `logSet` odrzuca serię spoza planu, która nie należy do ćwiczenia planu (nie ma już "niczyjej" pracy).
- **Q-04.** Sesja rozpoczęta wczoraj i wciąż w toku nie jest „opuszczonym dniem”; tydzień jest liczony od jutra.
- **DEAD-01 / DEAD-02 / DOC-01 / DOC-02.** Usunięto kod bez konsumenta (`createPhoneSessionTools`, `addBandCycles`, `readRevisions`, `getTrainingWeek`, `SLOT_NAMES`); poprawiono mapę modułów i opis bloku w słowniku. **Zostaje do decyzji/po odbiorze:** API używane tylko przez testy (`rankSubstitutes`, `unacknowledged`, `canPlanAutomatically`, `STEP_DOWN_CODES`, `MAX_CALIBRATION_MASS_KG`, `previewWeek`, `saveBlockAdvance`, `loadWindow` i pokrewne), podział `applySessionChange`/`reportSessionFeel`, tabela `exposure_outcomes` bez czytelnika, nieaktualne ścieżki w dokumentach historycznych (`IMPLEMENTACJA.md`, `PLAN-TYGODNIA-I-POPRAWKI.md`, `AI-INTEGRACJA.md`).
- **Q-01 (decyzja użytkownika 2026-10-09: podłączyć wszystkie trzy) — zrobione.**
  - *Kalibracja w sesji (D24).* Po serii nowego ćwiczenia (ślad `FIRST_COMPARABLE_EXPOSURE`, ekspozycja główna), gdy wyszła daleko za lekko albo za ciężko, karta nad zegarem odpoczynku proponuje pozostałe serie o stopień wyżej/niżej. Zmiana to `reduce_remaining` z `harder`/`easier` i `calibrate` (tylko telefon, model AI tego nie widzi), oceniona i sprawdzona jeszcze raz przy zatwierdzeniu; oferta znika, gdy silnik ją odradza. Maks. 2 kroki, „Zostaw jak jest” = więcej nie pyta o to ćwiczenie w tej sesji. Pozostałe serie zostają **główną ekspozycją** (`calibratedFrom`), a serie zrobione na starcie nie są „zmniejszeniem” (`reducedExposures`), więc następna sesja startuje od skalibrowanego stopnia i idzie zwykłą progresją. Nie oferujemy: wariantu łatwiejszego i obniżenia celu (to sprawa kolejnej sesji), oferty przy superserii bez przerwy.
  - *„Za ciężko / za łatwo”.* Dwa przyciski przy każdym ćwiczeniu na karcie „Ćwiczenie zrobione”; zapis przez `recordFeel` (zmienia kontekst następnej recepty, nie plan). Opcje ze `reportSessionFeel` (łatwiejszy opór, mniej serii…) nie mają ekranu — to osobna, większa decyzja UI.
  - *Dźwignia objętości (D32).* Karty „więcej/mniej serii w tygodniu” pod licznikiem objętości na ekranie planu (`volumeCardsFor` z tych samych danych co planer). „Zwiększ/Zmniejsz” zapisuje własne maksimum partii (`volumeOverrides`) i podnosi rewizję preferencji; karta jest sprawdzana jeszcze raz przy zapisie. „Nie teraz” działa do zamknięcia aplikacji (nie jest zapisywane). Pojedynczy dzień treningu partii nie wystarcza do karty (rozciągłość 0 dni) — zgodnie z dotychczasową domeną.
- **Q-02, Q-03.** Bez zmian (zapis `read_back` bez odczytu na głos; odczyt całej historii przy „Dziś”): pomiar T-2 na telefonie.

## 3. Do sprawdzenia

### 3.1 Telefon

| # | Co sprawdzić | Etap | Status |
|---|---|---|---|
| T-1 | `Intl.DateTimeFormat` z opcją `timeZone` w Hermesie na Pixelu (13 §1 każe sprawdzić w P0). Obecna implementacja `trainingDate` używa tylko getterów lokalnej daty, więc **nie zależy** od tego; sprawdzenie dotyczy `trainingDateOf` ze strefą, gdy zacznie być używana w aplikacji | P0 | ☐ |
| T-2 | Czas planowania tygodnia i dnia na telefonie (p50/p95) dla historii: mała (4 tygodnie), roczna, trzyletnia — mierzone na bieżącym API (`readToday`, `syncWeek`, `describeDayOptions`). Skrypt `scripts/engine-bench.ts` usunięto w P6 razem ze starym silnikiem; nowy pomiar do napisania przy odbiorze telefonu | P0 | ☐ |

### 3.2 Decyzje i pytania do użytkownika

| # | Pytanie | Kiedy potrzebne |
|---|---|---|
| Q-1 ✔ 2026-10-09 | Zatwierdzone przez agenta na prośbę użytkownika (`51237d0`). Pierwotne pytanie: czy zatwierdzić niezatwierdzone zmiany z §1 osobnym commitem przed dalszą pracą nad silnikiem? (Nie blokuje P0–P1.) | przed P2 |
| Q-2 ✔ 2026-10-09 (start dany) | Termin P2 (archiwizacja i reset danych treningowych na telefonie): P2 kasuje historię treningów z aplikacji po zrobieniu pliku archiwum. Plan zakłada zgodę (D21), ale uruchomienie to osobna decyzja | przed P2 |
| Q-3 ✔ 2026-10-09 | Potwierdzone przez użytkownika; regulowane w Ustawieniach (§2: przełącznik „Uwzględniaj ograniczenia kolana” i „Ostrożny zakres powtórzeń”, pole `KneeProfile.cautiousReps`; sufit stosuje się tylko, gdy profil kolana istnieje i przełącznik nie jest wyłączony — `repCapOf(ćwiczenie, profil)`). Pierwotne pytanie: Fizjoterapeuta: sufit powtórzeń 20 dla ćwiczeń obciążających kolano (D34) i brak celu RIR 0 powyżej 15 powtórzeń — zasada ostrożności do potwierdzenia. Wartość jest w `PROGRESSION_CONFIG.repCap.kneeLoading` | przed P3 |
| Q-4 ✔ 2026-10-09 | Zgoda użytkownika na kolejność krawędzi; krawędzie zmieniające jednostkę: patrz §2. Pierwotne pytanie: przejrzeć 36 krawędzi wariantów w `data/exercises.json` (pole `progressions`; kolejność trudności to moja ocena: np. `pelvic-curl → glute-bridge → glute-bridge-march`, `push-up → deadstop-push-up → archer-push-up`, `crunch → pilates-roll-up → teaser → v-up`). Błędna kolejność oznacza złą propozycję „trudniejszy/łatwiejszy wariant” w P3 | przed P3 |
| Q-5 ✔ 2026-10-09 (nazwy) | P4b.1: resolver T70 i 109 sprawdzonych aliasów dla 63 ćwiczeń w katalogu v6. Wszystkie oficjalne nazwy są rozpoznawane, „wyciskanie siedząc” i „pompki” działają. `equivalenceGroup` i `secondaryWeights` zachowują domyślne zachowanie (heurystyka `nearEquivalent`, waga 0,5); nie są wymagane do rozpoznawania nazw | P4b |
| Q-6 ✔ 2026-10-09 | Rozstrzygnięte przez agenta na prośbę użytkownika („wybierz poprawnie”): zostaje wydłużenie zakresu przed dodatkową serią, bo D29 (v1.2, najnowsza decyzja, potwierdzona w E9 i 14 §3) wskazuje wydłużony zakres jako sposób oczyszczenia, a dodatkową serię tylko tam, gdzie zakres stoi na suficie. Pierwotne pytanie: P3: oś pośrednia po nieudanym szczeblu — najpierw wydłużenie zakresu o krok na ekspozycję (do góry + 5 powt. albo + 15 s), potem dodatkowa seria (UWAGI §2a). Czy tak ma być? Alternatywa ze spec. v1.1: najpierw dodatkowa seria (wtedy trzeba zmienić kryterium oczyszczenia na „kompletna `top_met` z dodatkową serią”) | przed P5 |
| Q-7 ✔ 2026-10-09 | Użytkownik: „ok”. Pierwotne pytanie: P3: tydzień deloadu nie jest oceniany, decyzja po nim bierze ostatnią ekspozycję sprzed deloadu; kompletna ekspozycja z porzuconej sesji jest dowodem. Czy to zgodne z oczekiwaniem? | przed P5 |

### 3.1a Do sprawdzenia po P2

| # | Co sprawdzić | Etap | Status |
|---|---|---|---|
| T-3 | Aplikacja z migracją 0010 otwiera istniejącą bazę na telefonie bez błędu i bez zmiany widocznych danych (nic nie zmienia zachowania; dodane tylko kolumny i puste tabele). Najlepiej: zainstalować APK z `main` po P2 na kopii/emulatorze z kopią bazy z telefonu | P2 | ☐ |
| T-4 | Ustawienia → „Profil kolana”: przełącznik „Uwzględniaj ograniczenia kolana” (wyłączony = brak filtrów kolana w planie) i „Ostrożny zakres powtórzeń”; zapis i powrót | knee-settings | ☐ |

### 3.3 Znane luki obecnego kodu, które plan naprawia później

| Luka | Naprawa w | Uwagi |
|---|---|---|
| `selectCustom`/`composeDay`/`dayOptions` używają globalnego `PLANNER_CONFIG` zamiast efektywnego configu dnia | P0.4 | |
| `trainingDate` odejmuje stałą liczbę ms (błąd 1 h przy zmianie czasu) | P0.3 | |
| Drabinka masy ciała nie ma szczebla w dół; po dwóch sesjach pod zakresem pojawia się `PERFORMANCE_REGRESSION` mimo braku zmiany | P0.7 (kod i tekst), P3 (budowanie do zakresu, D39) — **domena gotowa** (`buildUpRule`, `AT_MINIMUM`, `BUILDUP_BELOW_RANGE`), podłączenie do planowania w P5 | |
| `plannerSource` nie niesie pełnej recepty, roli i `shortfall` do historii domenowej | P2/P3 | |
| `LAYOFF_MEDIUM` („o krok lżej”) i `RE_EXPOSURE` („krok lżej niż ostatnio”) mówią o kroku w dół także wtedy, gdy `ladder.down` zwraca null i opór zostaje | P3 (kody z prawdziwą zmianą oporu, D39 e) — **domena gotowa** (`LAYOFF_STEP_DOWN` tylko przy zmianie oporu, `RE_EXPOSURE`), podłączenie w P5 | tak samo jak `PERFORMANCE_REGRESSION` przed P0.7; poza zakresem P0, bo to kody kontraktu |
| Nowe pola katalogu (`progressions` …) trafiają do aplikacji dopiero po podniesieniu `version` w `data/exercises.json` (dziś 5): seed zapisuje ćwiczenia do bazy per wersja, a planer czyta je z bazy | P3 (podnieść w pierwszym etapie, który je czyta) | bez wpływu na dzisiejsze plany: silnik ich nie czyta |
| 18 ostrzeżeń `NO_EASIER_VARIANT` w `validate:data` (ćwiczenia core bez łatwiejszego wariantu) | P3/P5 (uzupełnianie katalogu) | część to najłatwiejsze ćwiczenia swoich łańcuchów |
| Zapis serii generuje nowe UUID przy każdym wywołaniu (brak idempotencji) | P2 | |

### P6 — testy loggera (2026-10-09)

Usunięte założenie starych testów „zawsze Ciężko” nie opisuje już aplikacji: pierwszy wynik zaczyna od `defaultEffort(previous, targetRir)`, kolejne serie zachowują wysiłek poprzedniej obserwacji. Pochodzenie sugestii i zmian sprawdza nowy kontrakt testów. Karta zamiennika nie ma osobnego „Wróć do ćwiczenia z planu”; powrót odbywa się przez ponowną zamianę z oceną silnika. `GroupDoneCard` nie potrzebował zmiany API.
### P6 — decyzje i obserwacje aktywacji konsumentów (2026-10-09)

- Start dnia zachowuje tygodniowy wybór ćwiczeń, ale przelicza ilości i opór z bieżącej historii. Zmiana utrzymanego wyboru po podglądzie jest konfliktem tak samo jak zmiana historii. SQLite sprawdza odmowę bez zapisania sesji/bloku.
- Brak legalnego planu nie jest automatycznie dniem wolnym: ekran pokazuje powód audytu. Naprawiony plan jest opisany. Pewne i niepewne serie są oddzielone w bilansie; odziedziczone dane bez potwierdzonego wysiłku nie stają się pewnym dowodem.
- Szablony nie służą już do prezentacji planów w „Dziś” i kalendarzu. Dawne sesje bez rozpoznawalnego planu otrzymują nazwę zastępczą, a ich dane pozostają do odczytu/backupowania. Tabele szablonów nadal czekają na migrację porządkową.
- Karta zmiany sesji jest akceptowana kanałem `ai_proposal` (kanał zapisany w istniejącym kontrakcie), wyłącznie po przycisku użytkownika. Nowe pytanie, inna rewizja lub zmiana sesji uniemożliwia zastosowanie dawnej karty. Spóźnione narzędzie nie może odtworzyć karty po rozpoczęciu nowej rozmowy.
- Cztery nieaktualne przypadki SQLite wywoływały usunięte API loggera albo oczekiwały tygodnia v1 w kalendarzu. Zastąpione dowodami aktualnych odczytów i zachowania backupu historycznej serii; usunięte metody nie zostały przywrócone.
- Bez resetu i bez wdrożenia. Pełne sprzątanie starego silnika, migracja nazw/tabel i test urządzenia są następnym fragmentem P6. Worker i APK nadal mają być wdrożone razem dopiero po jego zamknięciu.
### P6 — porządki w punktach integracji planowania (2026-10-09)

Syntetyczne dzienniki ewaluacji nie zawierają zamrożonych recept. Są więc pracą supplemental (objętość/regeneracja), a nie pierwotnymi ekspozycjami dla progresji. Adapter nie wymyśla planowanych celów na podstawie wyniku. Przy usuwaniu pozostałych typów starego planu trzeba zachować minimalne dane dawnych sesji i kopii zapasowych.

Ocena jutra nie korzysta już z `dayPlanner`. Przeniesiony strażnik używa fazy bloku bieżącego silnika i jego limitu 3 serii na mięsień w dniu, zamiast dawnego limitu 2. Testy sprawdzają kwalifikację, zmianę wyboru/fazy/żądania, zakwasy, projekcję regeneracji, pracę lekką i mobilność oraz oba budżety.

Usunięte prompty `chat/v1`–`chat/v6` nie mają już odbiorców w produkcji; obecny prompt to `chat/v7`. Historyczne metadane wymian (np. wpisane wersje promptów w zapisanych rekordach) nadal mogą opisywać wcześniejsze odpowiedzi i nie wymagają plików dawnych promptów.
