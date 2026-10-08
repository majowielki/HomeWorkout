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
| Q-1 | Czy zatwierdzić niezatwierdzone zmiany z §1 osobnym commitem przed dalszą pracą nad silnikiem? (Nie blokuje P0–P1.) | przed P2 |
| Q-2 | Termin P2 (archiwizacja i reset danych treningowych na telefonie): P2 kasuje historię treningów z aplikacji po zrobieniu pliku archiwum. Plan zakłada zgodę (D21), ale uruchomienie to osobna decyzja | przed P2 |
| Q-3 | Fizjoterapeuta: sufit powtórzeń 20 dla ćwiczeń obciążających kolano (D34) i brak celu RIR 0 powyżej 15 powtórzeń — zasada ostrożności do potwierdzenia | przed P3 |

### 3.3 Znane luki obecnego kodu, które plan naprawia później

| Luka | Naprawa w | Uwagi |
|---|---|---|
| `selectCustom`/`composeDay`/`dayOptions` używają globalnego `PLANNER_CONFIG` zamiast efektywnego configu dnia | P0.4 | |
| `trainingDate` odejmuje stałą liczbę ms (błąd 1 h przy zmianie czasu) | P0.3 | |
| Drabinka masy ciała nie ma szczebla w dół; po dwóch sesjach pod zakresem pojawia się `PERFORMANCE_REGRESSION` mimo braku zmiany | P0.7 (kod i tekst), P3 (budowanie do zakresu, D39) | |
| `plannerSource` nie niesie pełnej recepty, roli i `shortfall` do historii domenowej | P2/P3 | |
| Zapis serii generuje nowe UUID przy każdym wywołaniu (brak idempotencji) | P2 | |
