# Silnik v2 — postęp wdrożenia

Ten plik jest **dziennikiem realizacji** przebudowy silnika. Specyfikacja (co i dlaczego) leży poza repozytorium:
`D:\Projekty\HomeWorkout\architektura-silnika-2026-10-08\` (wersja 1.3, decyzje D01–D39, testy T01–T105, etapy P0–P9).
Jak jest zbudowane to, co już działa: [DOKUMENTACJA-TECHNICZNA.md](DOKUMENTACJA-TECHNICZNA.md).
Odstępstwa od planu, rzeczy do sprawdzenia i pytania: [UWAGI.md](UWAGI.md).

Aktualizowany w tym samym commicie, który zamyka zadanie. Status zadania zmienia się dopiero, gdy istnieje test (albo jawnie
opisany inny dowód) i commit.

## Zasady pracy

- Jedna gałąź na etap (`refactor/engine-pN-…`), scalana lokalnie `--no-ff`; nic nie jest wypychane na GitHub.
- Commity bez współautora. Małe, opisujące jedną zmianę.
- Nowe kontrakty obok v1, konsumenci przenoszeni po kolei, stare API usuwane dopiero po sprawdzeniu użyć (07 §1).
- Pokrycie 100% dla `src/domain/**` jest wymogiem repozytorium: nowy kod domeny ma testy w tym samym commicie.
- Każda zmiana zachowania obecnego silnika jest nazwana (decyzja Dxx, test Txx) i ma wpis w [UWAGI.md](UWAGI.md).
- Etapy, które zmieniają dane użytkownika (P2: archiwizacja i reset), **nie są uruchamiane bez osobnej zgody** — patrz UWAGI.

## Legenda

`☐` do zrobienia · `◐` w toku · `☑` zrobione (test + commit) · `⏸` wstrzymane (czeka na decyzję) · `—` nie dotyczy

## Mapa etapów

| Etap | Zakres | Status | Gałąź | Zależy od |
|---|---|---|---|---|
| P0 | Baza pomiarowa i poprawki bez zmiany strategii | ☑ 2026-10-09 | `refactor/engine-p0-baseline` | — |
| P1 | Kontrakty v2, model oporu, katalog (aliasy, graf wariantów, screenery), preferencje | ☑ 2026-10-09 | `refactor/engine-p1-contracts` | P0 |
| P2 | Zapis i historia: migracja, polecenia sesji, normalizacja, archiwizacja i reset | ☑ warstwa danych 2026-10-09 (logger UI i reset na telefonie: P5/P6) | `refactor/engine-p2-storage` | P1 |
| P3 | Kwalifikacja i progresja (pipeline reguł, pamięć szczebla, próba, budowanie do zakresu) | ☑ domena 2026-10-09 (podłączenie do planowania: P5, aktywacja: P6) | `refactor/engine-p3-progression`, `refactor/engine-p3b-rotation-volume` | P1, P2 |
| P4 | Audyt, kompilator, zasoby, czas | ◐ w toku (gałąź nie scalona, patrz sekcja P4) | `refactor/engine-p4-compile-audit` | P1, P2 |
| P4b | Konsultacja zmian w sesji (domena) | ☐ | | P3, P4 |
| P5 | Tydzień, UI, AI, transakcyjna akceptacja | ☐ | | P3, P4, P4b |
| P6 | Aktywacja silnika bazowego | ☐ | | P0–P5 |
| P7 | Rotacja z ciągłością (plateau, benchmark wieloletni) | ☐ | | P6 |
| P8 | Eksperymenty warunkowe | ☐ | | P6 |
| P9 | Pierwszy nowy sprzęt produkcyjny | ☐ | | P6 |

Kolejność wykonania: P0 → P1 → (P2) → P3 ∥ P4 → P4b → P5 → P6. Uzasadnienie, dlaczego P1 przed P2: P1 jest czystą domeną (typy,
walidatory, adaptery, rejestry), nie dotyka danych użytkownika i nie zmienia zachowania aplikacji, więc można ją wykonać i odebrać
bez ryzyka. P2 wymaga migracji bazy i resetu danych, więc czeka na świadomą decyzję użytkownika o terminie.

## P0 — baza i poprawki bez zmiany strategii

| Zadanie | Zakres | Dowód | Status | Commit |
|---|---|---|---|---|
| P0.3 | `trainingDate` wg lokalnej daty i godziny (`trainingDateOf` ze strefą; stara funkcja czyta lokalną godzinę urządzenia) | T01–T04 w `trainingDateZones.test.ts` | ☑ | `9bed6b2` |
| P0.4 | `resolveDayPolicy` — jeden efektywny config dla `selectDay`, `selectCustom`, `composeDay`, `dayOptions`, `planCustom` | T05, T06 w `dayPolicy.test.ts` | ☑ | `371bc11` |
| P0.7 | (D39 e) brak `PERFORMANCE_REGRESSION` i tekstu „szczebel lżej”, gdy opór się nie zmienia | `progression.test.ts` („stays put at the floor”, „never reports a step down”) | ☑ | `e36d7b2` |
| P0.1 | Golden baseline: manifest (rewizja, dirty, config, katalog) i snapshot symulacji | `engineBaseline.test.ts`, `scripts/engine-baseline.ts`, `baseline/manifest-2026-10-09.json` | ☑ | `f2e6fbc` |
| P0.2 | Lista call-site’ów planowania, startu sesji, importu, szablonu | DOKUMENTACJA §2.1 | ☑ | `a9740eb` |
| P0.5 | Pomiar czasu planowania w node (p50/p95); pomiar na telefonie → UWAGI | `scripts/engine-bench.ts`, DOKUMENTACJA §4.4 | ☑ (telefon: UWAGI T-2) | `a9740eb` |
| P0.6 | Aktualizacja specyfikacji rozbieżnej z kodem (`IMPLEMENTACJA.md` §7.3, `SPEC-silnik-regul.md` §5.1) | diff | ☑ | `a9740eb` |

## P1 — kontrakty v2 i punkty rozszerzeń

Czysta domena: typy, schematy, rejestry i adaptery. **Żadna ścieżka aplikacji ich jeszcze nie używa**, więc zachowanie aplikacji się nie zmienia (golden baseline bez zmian).

| Zadanie | Zakres | Dowód | Status | Commit |
|---|---|---|---|---|
| P1.1 | Typy planu v2: `PlannedSet`, `PlannedExposure`, `SessionPlanV2`, ślad decyzji, kroki wykonania, rozkład czasu, stempel audytu; schemat uruchomieniowy z kontrolą spójności | T08, T09, T41; `planV2.test.ts` (legalne i odrzucane przykłady) | ☑ | `1dcd02e` |
| P1.2 | Identyfikatory z przestrzenią nazw, kanonizacja, odcisk SHA-256 | `fingerprint.test.ts`, `planV2.test.ts` | ☑ | `790b672`, `1dcd02e` |
| P1.3 | Pochodzenie per pole (`Observed<T>`), kanał, potwierdzenie; wynik serii, dyspozycja; typy `ExposureRecord`, `ExposureOutcome` | T12, T16, T39, T85; `observations.test.ts` | ☑ | `1dcd02e` |
| P1.4 | Kontrakt modelu oporu, rejestr, trzy obecne modele przez adapter, instancje i wymagania sprzętowe | T42–T45, T49–T51; `resistance.test.ts`, `equipment.test.ts` | ☑ | `e31009d`, `4b0548b` |
| P1.5 | Sztanga (kg i lb), kettlebell, stos o nieregularnych nastawach, wspomaganie (odwrócona skala), kamizelka: wspólny zestaw testów kontraktu | `resistanceContract.ts` na 12 modelach | ☑ | `e31009d` |
| P1.6 | Adapter v1 ⇄ v2 i zasada „nieobsługiwane = odmowa” (bez wymyślania sprzętu) | `resistance.test.ts` („the v1 adapter”) | ☑ | `e31009d` |
| P1.7 | Rejestr polityk, zdolności (katalog ∩ model ∩ polityka ∩ runner ∩ logger), ślad decyzji | T51; `capabilities.test.ts` | ☑ | `86e43af` |
| P1.8 | Katalog: `aliases`, `equivalenceGroup`, `progressions`, `jointLoading`, `secondaryWeights`; graf wariantów; walidator; krawędzie dla 33 ćwiczeń | T95, T98; `catalogV2.test.ts`, `npm run validate:data` | ☑ (dane aliasów: P4b) | `8bb99a9` |
| P1.9 | Rejestr screenerów per staw (kolano bez zmian) | `screeners.test.ts` (parytet z `screenExercise` dla 151 ćwiczeń × 3 profile) | ☑ | `d812948` |
| P1.10 | Rejestr reguł hard/advice, werdykt, `TrainingPreferences`, `preferenceScore`, `nearEquivalent` | T61–T64, T69, T73, T74; `hardAdvice.test.ts`, `preferences.test.ts` | ☑ | `86e43af` |

## P2 — zapis, historia, archiwizacja

Decyzja użytkownika 2026-10-09: „Start” dla P2. **Zakres wykonany to cała warstwa danych**, sprawdzona na prawdziwym SQLite. Dwie rzeczy z planu świadomie czekają, bo nie mają sensu bez planu v2 w aplikacji: przełączenie loggera UI na polecenia v2 (P2.4/P2.9 — P5) i uruchomienie resetu danych na telefonie (P6). Powód i konsekwencje: UWAGI §2.

| Zadanie | Zakres | Dowód | Status | Commit |
|---|---|---|---|---|
| P2.1 | Migracja addytywna `0010_engine_v2_storage`: kolumny w `workouts` i `set_logs`, tabele `set_log_revisions`, `set_dispositions`, `exposure_outcomes`, `command_ledger`, `planning_revisions`, `session_plan_revisions`, `feel_reports`, `preferences`, `legacy_sessions`, `app_state`; stare wiersze bez zmian | „migration 0010 keeps sessions…” | ☑ | `9834c53`, `9a44a3c` |
| P2.2 | Idempotentne `logSetV2`: ten sam `commandId` = jeden wynik; unikalny bieżący wynik serii (indeks częściowy); konflikt rewizji; wycofanie awarii w transakcji | T15, T17 (SQLite) | ☑ | `488c361` |
| P2.3 | Trwałe pominięcia, `exposure_outcomes`, zamknięcie/porzucenie bez dopisywania wyników | T12, T13, T14 (SQLite + domena) | ☑ | `488c361`, `6edd1a0` |
| P2.4 | Pochodzenie per pole w zapisie (`SetObservation` w kolumnie `observation`); **logger UI** | warstwa danych ☑; UI: P5 | ◐ | `9834c53` |
| P2.5 | `normalizeObservations` i `buildHistoryIndex`; praca z porzuconych sesji zostaje | `normalize.test.ts`, `historyIndex.test.ts` | ☑ | `6edd1a0`, `956827e` |
| P2.6 | Ostatni porównywalny wynik klucza bez limitu dni (`loadLastComparableBefore`) | T34 (SQLite) | ☑ | `488c361` |
| P2.7 | Korekta (z historią zmian), cofnięcie (nagrobek), rewizje i liczniki wejść planowania | T18 (SQLite + domena) | ☑ | `488c361`, `18c2d25` |
| P2.8 | Kopia zapasowa 7: pełny round trip danych v2; archiwizacja → sprawdzenie → reset (D21); import archiwum jako historia do wglądu | T52, T53 (SQLite) | ☑ (reset wyłączony) | `9834c53`, `9a44a3c` |
| P2.9 | Migracja aktywnej sesji, restart sesji v2 | P5 (potrzebuje UI) | ☐ | |

## P3 — kwalifikacja i progresja

Czysta domena: nic w aplikacji tego jeszcze nie woła (pipeline wchodzi do planowania w P5, aktywacja w P6), więc golden baseline jest bez zmian. Zadania ze specyfikacji (07 §6) plus to, co jej v1.1–v1.3 dołożyły do P3 (13 §5–8, 16, 20, 12 §5).

| Zadanie | Zakres | Dowód | Status | Commit |
|---|---|---|---|---|
| P3.1–P3.2 | Kwalifikacja ekspozycji: pokrycie stron, porównywalność oporu per seria, jakość (wysiłek z pochodzeniem), wynik względem zakresu planu (`top_met` z `dropOffAllowance`), opór odniesienia | T10–T11, T22–T28, T31, T97; `qualify.test.ts` | ☑ | `3181260` |
| P3.5 | Zamknięty rejestr kodów decyzji (40) i polityka z liczbami | `pipeline.test.ts` (T105 na wszystkich planach); **teksty PL i payload: P5** | ◐ | `3181260` |
| P3.8 | Pamięć nieudanego szczebla (wyprowadzana z historii), oczyszczanie rozszerzonym zakresem albo dodatkową serią, wygasanie 42 dni | T81–T84; `failedRungs.test.ts` | ☑ | `77bbb98` |
| P3.8b | Osie pośrednie: wydłużenie zakresu (limit powtórzeń z kolana), dodatkowa seria | `axes.test.ts` | ☑ | `77bbb98` |
| P3.9 | Próba szczebla: `shouldProbe`, `probeVerdict`, `probeCooldown`, `rirBias` | T88–T92; `probe.test.ts` | ☑ | `77bbb98` |
| P3.10 | Budowanie do zakresu i karta łatwiejszego wariantu | T101–T103; `buildUp.test.ts` | ☑ | `77bbb98` |
| P3.12 | `recommendSets`: compound 3 / akcesoria 2 / core 2, deload, miejsce dnia, tygodnia i czasu | T76–T80; `sets.test.ts` | ☑ | `475599d` |
| P3.3–P3.4 | Pipeline reguł `prescribeNext` (priorytety 03 §4, dwa zegary przerw, deload, rekalibracja, dowód, porażka, sukces, powtórzenia w zakresie), ślad zgodny ze schematem planu | T22–T25, T27–T34, T56, T86, T88–T90, T101–T103, T105; `pipeline.test.ts`, `pipelineEdges.test.ts` | ☑ | `f5c3500` |
| P3.7 | Interfejs estymatora: tylko ślad, domyślnie wyłączony | `pipeline.test.ts` („the shadow estimator”) | ☑ | `f5c3500` |
| P3.11 | Kalibracja pierwszej ekspozycji w sesji (krok w górę/w dół jako propozycja) | T87, T104; `firstExposure.test.ts` | ☑ (reducer sesji: P4b/P5) | `f1c53d4` |
| P3.6 | Shadow starej i nowej kwalifikacji | — | — nie dotyczy: start od zera (D21), nie ma adaptera v1 | |
| P3.13 | Rotacja z ciągłością: `chooseBlockVariant` (wariant działający albo za mało zbadany zostaje, w grupie prawie równoważnej decyduje preferencja, `avoid` nie wyklucza), dowód z bloku (`blockEvidence`) | T35, T73–T75; `blockVariant.test.ts`, `stall.test.ts` | ☑ | |
| P3.14 | Deload reaktywny `reactiveDeloadTrigger` (dwa sygnały / zastój z zmęczeniem / prośba; od 7. dnia bloku, raz na blok) | T93, T94; `reactiveDeload.test.ts` | ☑ | |
| P3.15 | Dźwignia objętości `volumeRecommendation` (+20% / −20% jako karty, do profilu 10) i wagi mięśni pomocniczych w raporcie (`weeklyVolume`) | T95, T96; `lever.test.ts`, `secondaryWeights.test.ts` | ☑ | |

## P4 — audyt, kompilator, dzień v2 (w toku, gałąź `refactor/engine-p4-compile-audit`, NIE scalona)

| Zadanie | Zakres | Status |
|---|---|---|
| P4.3–P4.5 | `plan/compile.ts`: kompilator receptur do planu (id serii, strony, kroki, przezbrojenia zasobów, czas z kroków, superserie), `stampPlan` | ☑ 100% pokrycia |
| P4.1 | `plan/audit.ts`: jeden audyt dla każdej ścieżki, klasy hard/advice z rejestru, tryby new_plan/start/resume/import/display | ☑ 100% |
| P4.6 | `plan/repair.ts`: `planWithRepair` (drop_filler, split_superset, reduce_sets, drop_exposure, budżet kroków, ready/adjusted/no_feasible_plan/unsupported_input) | ☑ 100% |
| P4.2 | `plan/dayV2.ts` `planDayV2` (wybór zachłanny z jawnym score, recommendSets, prescribeNext, wypełniacze, grupy), `blockV2.ts`, `resistanceOf.ts`, `autoregulation/signalsV2.ts`, `plan/simulateV2.ts` (symulacja tygodni) | ◐ działa na prawdziwym katalogu (6 tygodni, własności objętości i czasu zielone); **brakuje pokrycia 100% gałęzi** `dayV2.ts`, `simulateV2.ts`; 2 testy w `dayV2Worlds.test.ts` są `it.skip` z TODO (zamiennik jednonożny przy FATIGUE_HIGH; propozycje wariantu/CONFIRM_STEP_UP w planie dnia) |
| P4.7 | tryby audytu start/resume/import | ☑ (w audycie) |

**Wznowienie 2026-10-09:** dwa `it.skip` odblokowane (28 testów `dayV2Worlds.test.ts` zielonych): zamiennik badany bez konkurencyjnego przysiadu; propozycje z jawnym wyborem slotu i bez przerwy uruchamiającej regułę powrotu. Test akceptacji awansu sprawdza teraz rzeczywiście zaplanowaną próbę. **Pozostało:** (1) domknąć 100% pokrycia `dayV2.ts`/`simulateV2.ts`; (2) UWAGI + DOKUMENTACJA dla P4; (3) pełne `npm run verify`; (4) scalić `--no-ff`. Obserwacja: przy 3 seriach compound tygodniowe maksima mięśni (pośladki 8, plecy 8) są wyczerpane w 4–5 dniu, więc kolejne dni to głównie wypełniacze (skutek D22; do oceny w benchmarku P8).

## P5–P9

Zadania rozpisane w specyfikacji ([07](../../../architektura-silnika-2026-10-08/07-PLAN-WDROZENIA.md)). Tutaj trafiają dopiero z chwilą
rozpoczęcia etapu, żeby plik pokazywał stan faktyczny, a nie przepisane plany.

## Dziennik

| Data | Co | Commit |
|---|---|---|
| 2026-10-09 | **P4 w toku** (niescalone): kompilator, audyt, naprawa, `planDayV2`, blok v2, symulacja v2, sygnały v2. Domena: 1771 testów zielone; pokrycie 100% nie domknięte dla dayV2/simulateV2. Q-6/Q-7 zamknięte. P3 scalony do main | |
| 2026-10-09 | **P3 zamknięty** (reszta: rotacja z ciągłością, deload reaktywny, dźwignia objętości i wagi mięśni). Q-6 rozstrzygnięte (wydłużenie zakresu przed dodatkową serią, zgodnie z D29), Q-7 potwierdzone. `npm run verify`: 3446 testów, pokrycie domeny 100% | |
| 2026-10-09 | **P3 (rdzeń) w domenie** (scalony do `main`): kwalifikacja dowodu, pipeline `prescribeNext` (14 reguł), pamięć nieudanego szczebla, próba szczebla, budowanie do zakresu, `recommendSets`, kalibracja w sesji jako propozycje. 40 kodów decyzji. `npm run verify` zielone: 3387 testów, pokrycie domeny 100%. Zostaje rotacja z ciągłością, deload reaktywny, dźwignia objętości; pytania Q-6, Q-7 | |
| 2026-10-09 | Przeczytany pakiet architektury (v1.3). Założona gałąź `docs/engine-v2-tracking`; trzy dokumenty w `Documents/silnik-v2/`. Stan wyjściowy: `main` @ `33d0f1e` + niezatwierdzone zmiany użytkownika (głos/trener v6, 40 plików) — patrz UWAGI §1 | |
| 2026-10-09 | Zatwierdzone niezatwierdzone zmiany użytkownika (`51237d0`, Q-1). Przełącznik „Uwzględniaj ograniczenia kolana” i „Ostrożny zakres powtórzeń” w Ustawieniach (`e3d511d`, Q-3). Krawędzie wariantów zmieniające jednostkę, jawnie (`a340051`, Q-4). **P2 (warstwa danych) zamknięty**: normalizator, indeks historii, schemat i migracja 0010, polecenia sesji v2, kopia zapasowa 7, archiwizacja/reset (wyłączony). `npm run verify`: 3138 testów, pokrycie domeny 100% | |
| 2026-10-09 | **P1 zamknięty** (10 zadań, ok. 370 nowych testów, `npm run verify` zielone: 3047 testów, pokrycie domeny 100%). Czysta domena: kontrakty planu i wyników, modele oporu, graf wariantów, screenery, reguły hard/advice, preferencje, sprzęt. Aplikacja bez zmian zachowania (golden baseline identyczny) | |
| 2026-10-09 | **P0 zamknięty** (7 zadań, 46 nowych testów, `npm run verify` zielone: 2673 testy, pokrycie domeny 100%). Gałąź `refactor/engine-p0-baseline` scalona do `main`. Porównanie planów z kodem sprzed przebudowy: jedna różnica, wyjaśniona (P0.7) — DOKUMENTACJA §4.4 | |
