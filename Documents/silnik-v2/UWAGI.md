# Silnik v2 — uwagi, odstępstwa i rzeczy do sprawdzenia

Trzy części: **(1)** stan repozytorium i decyzje robocze, **(2)** odstępstwa od specyfikacji, **(3)** do sprawdzenia przez człowieka
(telefon, fizjoterapeuta, decyzje produktowe). Pozycje zamknięte nie są usuwane, tylko oznaczane ✔ z datą.

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

## 3. Do sprawdzenia

### 3.1 Telefon

| # | Co sprawdzić | Etap | Status |
|---|---|---|---|
| T-1 | `Intl.DateTimeFormat` z opcją `timeZone` w Hermesie na Pixelu (13 §1 każe sprawdzić w P0). Obecna implementacja `trainingDate` używa tylko getterów lokalnej daty, więc **nie zależy** od tego; sprawdzenie dotyczy `trainingDateOf` ze strefą, gdy zacznie być używana w aplikacji | P0 | ☐ |
| T-2 | Czas planowania tygodnia i dnia na telefonie (p50/p95) dla historii: mała (4 tygodnie), roczna, trzyletnia — tak jak mierzy go `scripts/engine-bench.ts` w node. Procedura po zbudowaniu APK z profilem czasu | P0 | ☐ |

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
