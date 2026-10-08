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
| P0 | Baza pomiarowa i poprawki bez zmiany strategii | ◐ | `refactor/engine-p0-baseline` | — |
| P1 | Kontrakty v2, model oporu, katalog (aliasy, graf wariantów, screenery), preferencje | ☐ | | P0 |
| P2 | Zapis i historia: migracja, logger, archiwizacja i reset | ⏸ | | P1 |
| P3 | Kwalifikacja i progresja (pipeline reguł, pamięć szczebla, próba, budowanie do zakresu) | ☐ | | P1, P2 |
| P4 | Audyt, kompilator, zasoby, czas | ☐ | | P1, P2 |
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
| P0.3 | `trainingDate` wg lokalnej daty i godziny (`trainingDateOf` ze strefą; stara funkcja czyta lokalną godzinę urządzenia) | T01–T04 w `trainingDateZones.test.ts` | ☑ | (ten commit) |
| P0.4 | `resolveDayPolicy` — jeden efektywny config dla `selectDay`, `selectCustom`, `composeDay`, `dayOptions`, `planCustom` | T05, T06 w `dayPolicy.test.ts` | ☑ | (ten commit) |
| P0.7 | (D39 e) brak `PERFORMANCE_REGRESSION` i tekstu „szczebel lżej”, gdy opór się nie zmienia | `progression.test.ts` („stays put at the floor”, „never reports a step down”) | ☑ | (ten commit) |
| P0.1 | Golden baseline: manifest (rewizja, dirty, config, katalog) i snapshot symulacji | `engineBaseline.test.ts`, `scripts/engine-baseline.ts`, `baseline/manifest-2026-10-09.json` | ☑ | (ten commit) |
| P0.2 | Lista call-site’ów planowania, startu sesji, importu, szablonu | DOKUMENTACJA §2.1 | ☑ | (ten commit) |
| P0.5 | Pomiar czasu planowania w node (p50/p95); pomiar na telefonie → UWAGI | `scripts/engine-bench.ts`, DOKUMENTACJA §4.4 | ☑ (telefon: UWAGI T-2) | (ten commit) |
| P0.6 | Aktualizacja specyfikacji rozbieżnej z kodem (`IMPLEMENTACJA.md` §7.3, `SPEC-silnik-regul.md` §5.1) | diff | ☑ | (ten commit) |

## P1–P9

Zadania rozpisane w specyfikacji ([07](../../../architektura-silnika-2026-10-08/07-PLAN-WDROZENIA.md)). Tutaj trafiają dopiero z chwilą
rozpoczęcia etapu, żeby plik pokazywał stan faktyczny, a nie przepisane plany.

## Dziennik

| Data | Co | Commit |
|---|---|---|
| 2026-10-09 | Przeczytany pakiet architektury (v1.3). Założona gałąź `docs/engine-v2-tracking`; trzy dokumenty w `Documents/silnik-v2/`. Stan wyjściowy: `main` @ `33d0f1e` + niezatwierdzone zmiany użytkownika (głos/trener v6, 40 plików) — patrz UWAGI §1 | |
