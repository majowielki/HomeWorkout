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

_(uzupełniane w P0.2)_

## 3. Mapa modułów v2

Docelowa mapa plików to 13 §0. Status:

| Moduł | Spec. | Etap | Stan |
|---|---|---|---|
| `time/trainingDate.ts` — `trainingDateOf` | 13 §1 | P0.3 | ☑ |
| `policy/dayPolicy.ts` — `resolveDayPolicy` | 13 §2 | P0.4 | ☐ |
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

## 5. Konwencje testów

- Jest (`jest-expo`), pliki `src/**/__tests__/*.test.ts`. Pokrycie `src/domain/**` i `src/ai/**` = 100% (próg w `jest.config.js`).
- Testy są nazwane numerami z korpusu: `describe('T01 …')`, żeby da się było odnaleźć przypadek odbioru ze specyfikacji (08 §3).
- Fixtury domeny: `src/domain/__tests__/fixtures.ts`, `extraFixtures.ts`. Nie importować `Date.now()` w kodzie domeny; testy podają daty jawnie.
- `npm run verify` = lint + format:check + routes:types + typecheck + validate:data + test:coverage. Przed zamknięciem etapu zielony.
- Golden baseline silnika: `src/domain/__tests__/engineBaseline.test.ts` (po P0.1). Zmiana wyniku wymaga świadomej regeneracji
  skrótu i wpisu w UWAGI.
