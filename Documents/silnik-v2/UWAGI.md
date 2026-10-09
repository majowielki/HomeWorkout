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
| Q-5 | Aliasy nazw (do rozpoznawania „wyciskanie siedząc”, „pompki”) są polem w katalogu, ale **bez danych**; wypełnię je razem z `resolveExerciseRef` w P4b, gdzie da się je sprawdzić na prawdziwych zdaniach. `equivalenceGroup` i `secondaryWeights` też puste (zachowanie domyślne: heurystyka `nearEquivalent`, waga 0,5) | P4b |

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
| Drabinka masy ciała nie ma szczebla w dół; po dwóch sesjach pod zakresem pojawia się `PERFORMANCE_REGRESSION` mimo braku zmiany | P0.7 (kod i tekst), P3 (budowanie do zakresu, D39) | |
| `plannerSource` nie niesie pełnej recepty, roli i `shortfall` do historii domenowej | P2/P3 | |
| `LAYOFF_MEDIUM` („o krok lżej”) i `RE_EXPOSURE` („krok lżej niż ostatnio”) mówią o kroku w dół także wtedy, gdy `ladder.down` zwraca null i opór zostaje | P3 (kody z prawdziwą zmianą oporu, D39 e) | tak samo jak `PERFORMANCE_REGRESSION` przed P0.7; poza zakresem P0, bo to kody kontraktu |
| Nowe pola katalogu (`progressions` …) trafiają do aplikacji dopiero po podniesieniu `version` w `data/exercises.json` (dziś 5): seed zapisuje ćwiczenia do bazy per wersja, a planer czyta je z bazy | P3 (podnieść w pierwszym etapie, który je czyta) | bez wpływu na dzisiejsze plany: silnik ich nie czyta |
| 18 ostrzeżeń `NO_EASIER_VARIANT` w `validate:data` (ćwiczenia core bez łatwiejszego wariantu) | P3/P5 (uzupełnianie katalogu) | część to najłatwiejsze ćwiczenia swoich łańcuchów |
| Zapis serii generuje nowe UUID przy każdym wywołaniu (brak idempotencji) | P2 | |
