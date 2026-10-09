# Przekazanie: P6 — aktywacja nowego silnika i sprzątanie (stan na 2026-10-09)

Dokument dla kolejnego wykonawcy (Codex). Opisuje, co jest zrobione, co zostało, jak pracować i jakie
są pułapki. Źródła prawdy: `POSTEP.md`, `DOKUMENTACJA-TECHNICZNA.md`, `UWAGI.md` w tym katalogu oraz
specyfikacja w `../../../architektura-silnika-2026-10-08/` (v1.3). Ten plik jest tylko mapą na teraz.

## 1. Zadanie i decyzje użytkownika

Przeniesienie **całej aplikacji** (ekrany, hooki, czat, narzędzia AI) na nowy silnik i **usunięcie starego
silnika bez żadnych pozostałości** — „stary silnik jest w historii gita, nie chcemy mieć śmieci w kodzie.
Popraw wszystkie klasy, metody, nazewnictwo, testy. Usuń nieużywane stałe, zmienne, odnośniki,
komentarze. Zostaw kod tak czystym jak to możliwe.”

Decyzje (zapisane wcześniej):
- tydzień przechodzi na model v2 (zrobione w P5),
- UI przepisujemy tak, by działał na nowym silniku; **nowych funkcji UI** (Zamienniki jako osobny ekran, Dodaj ćwiczenie, przyciski „za ciężko/lekko”, preferencje, pytanie o awans) robimy dopiero po zakończeniu aktywacji, o ile starczy czasu — wtedy też wpinamy `matchSessionIntent` (głos), który dziś nie ma konsumenta w aplikacji,
- Worker/kontrakt: zmieniać wolno; **wdrożenie Workera (kontrakt 7) i APK razem na końcu**, potem testy na telefonie,
- **brak resetu danych**: planner v2 ignoruje sesje `planSchema = 1`; stare serie są w historii tylko do odczytu (wiersze bez `observation` nie są edytowalne), nadal liczą się jako `legacy_unknown` w normalizacji historii,
- brak flagi „stary/nowy silnik” — stary kod usuwamy, nie ukrywamy.

Zasady pracy (z pamięci projektu): jedna gałąź na etap (`refactor/engine-pN-…`), lokalny merge `--no-ff` do `main`,
**nigdy nie pushować**, commity **bez** `Co-Authored-By`/śladu Claude. Po zamknięciu zadania w tym samym commicie
aktualizować `POSTEP.md` / `DOKUMENTACJA-TECHNICZNA.md` / `UWAGI.md`. Pokrycie `src/domain/**` i `src/ai/**` musi
zostać **100%** (`npm run verify`). Różnice względem „golden baseline” wyjaśniać w UWAGI — ale baseline i stary
silnik i tak znikają w tym etapie.

## 2. Gdzie jesteśmy

Gałąź: **`refactor/engine-p6-activation`** (od `main` @ `3d5cb49`, P5 scalony). Ostatni commit: `f6e673a`
(„P6 wip …”). Gałąź **nie jest scalona**; `tsc` ma jeszcze ~53 błędy w nieprzepisanych konsumentach (to jest
oczekiwane — patrz §4), więc `npm run verify` jeszcze nie przechodzi.

### Zrobione w P6 (commity `dc5038d`, `f6e673a`)

Domena (100% pokrycia, testy zielone):
- `src/domain/session/progress.ts` — model biegnącej sesji z planu v2: `buildSessionSteps(plan, states)`
  (kolejność z kroków `perform`, runda, strona, `cues` przed serią), `groupsOf`/`labelsOf` (superserie
  wykrywane po przeplocie serii: A1, A2, B1…), `nextPendingIndex/From`, `findResumeIndex`, `isGroupComplete`,
  `latestResult`, typ `StoredResult`. Zastępuje v1 `session/steps.ts` (jeszcze nieusunięte).
- `src/domain/session/setEntry.ts` — formularz serii ↔ wynik: `SetFieldValues`, `suggestedValues`,
  `resultValues`, `entryOf` (które pola zmieniono → `edited`), `correctionOf` (korekta w historii: tylko
  zmienione pola), `resistanceOf`, `isBelowTarget`, `usesDumbbell/usesBand/isTimed/ladderFor`.
  Testy: `progress.test.ts`, `setEntry.test.ts`.

Warstwa danych:
- `readSessionState(sessionId)` w `src/db/repositories/sessionsV2.ts` — jeden spójny odczyt: `{workout{…,revision}, plan, states, results}`.
- `reopenSets` (cofnięcie pominięcia serii) — nowe polecenie + przypadek w `sqlite-check-v2.cjs`.
- `setLogs.ts` zredukowany do `getSetsForWorkout` i (synchronicznego) `getSet`.

UI biegnącej sesji (przepisane na nowy silnik):
- `useActiveSession.ts` (wstrzykiwane zależności `ActiveSessionDeps`; polecenia przez `send()` z jednokrotnym
  ponowieniem po `SESSION_CHANGED`; pominięcie ćwiczenia = trwałe `skipSets`, „cofnij” = `reopenSets`;
  „cofnij serię” = `undoSet` ostatniego wyniku), `SetLogger.tsx`, `SetFields.tsx`, `SessionProgressSheet.tsx`,
  `SubstituteModal.tsx` + `alternatives.ts` (alternatywy z `rankAlternatives`, zamiana przez `applySessionChange`,
  „na resztę bloku” przez `setBlockSelection`), `useSessionVoice.ts`, `undoneSet.ts`,
  `app/workout/active/[id].tsx`, `app/workout/summary/[id].tsx` (zamknięcie przez `closeSessionV2`).
- Historia: `describeSet.ts` (+`describeResult`), `workoutTitle.ts`, `app/history/[id].tsx` (wiersze legacy tylko do odczytu),
  `app/history/set/[id].tsx` (edycja przez `updateSetV2`/`undoSetV2`), `app/(tabs)/history.tsx`.
- `features/plan/format.ts` przepisane na plan v2 (`dayTitle`, `planTitle`, `loadText`, `prescriptionText`, `workSetsOf`).
- Test `useActiveSession.test.ts` przepisany (25 zielonych).

Uwaga: pliki w `src/features/workout/__tests__/` poza `useActiveSession.test.ts` (**`SetLogger.test.tsx`,
`SetLoggerClip.test.tsx`, `SubstituteModal.test.tsx`, `useSessionVoice.test.ts`, `GroupDoneCard.test.tsx`**) jeszcze
opisują stare API i trzeba je przepisać.

## 3. Co zostało (kolejność sugerowana)

1. **Dokończyć testy ekranów sesji**: wyżej wymienione pięć plików; dodać testy `alternatives.ts` (SQLite lub mock),
   `workoutTitle.ts`. `dayTitle(regions, kind?)` — `kind` ma być opcjonalny (stare plany bez `kind`; teraz błąd typu w `workoutTitle.ts`).
2. **Dziś / plan dnia**: `usePlanToday` → `syncWeek`/`previewDay`/`acceptDay` (`weekPlanV2.ts`, `planningV2.ts`);
   `computeToday.ts`, `planningSnapshot.ts`, `coachPreview.ts` do usunięcia; `PlanHero`, `SessionHero`,
   `ExercisePreview`, `DayDoneCard`, `PlanChangeBanner` (używa `getUnseenChanges`/`markChangesSeen` z `weekPlanV2`),
   `VolumeMeter`, `RideCard`, `app/(tabs)/index.tsx`, `app/plan/index.tsx` (powody z `decisionText`/`traceText`,
   `StoredDayV2.summary` zamiast pól v1), `useSessionOverview` (bez szablonów). `startedPlanOn`/`runningPlanOn` już są.
3. **Kalendarz** (`dayView`, `CalendarDaySheet`, `CalendarScreen`, `db/repositories/calendar.ts`), **zakwasy**
   (`soreness/actions.ts`, `ReportScreen`), **sesja dodatkowa** (`features/extra/*` → `previewDay({kind:'extra', only})` + `acceptDay`).
4. **Czat/AI**: `features/coach/chat/environment.ts`, `useCoachChat`, `ProposalCard` (karty z `assessmentText`),
   kontroler `app-services/coach/proposalsV2.ts` jako jedyny; narzędzia plan/sesja/symulacja już są po stronie v2.
   `src/db/repositories/sessionChangeSource.ts` czyta `tomorrow` z **v1 `planned_days`** — przepiąć na `planned_days_v2`.
5. **Usunięcie starego silnika** (po przepięciu wszystkich konsumentów; do znalezienia martwego kodu użyć skryptu
   osiągalności od `app/**`, `worker/src/**`, `scripts/validate-data.ts` — graf importów jest w scratchpadzie sesji,
   łatwo napisać od nowa): `domain/plan/{dayPlanner,week,weekSync,block,blockVariant,compose,validatePlan,simulate,today,
   reactiveDeload,sets(v1?),…}`, `domain/progression/*` używane tylko przez v1, `domain/session/steps.ts`, repozytoria
   `weekPlan.ts`, `plannerSource.ts`, `templates.ts`, `workouts.ts` (start*/complete*/abandonWorkout/find*), `engineMigration.ts`
   + `lib/engineMigration.ts` (reset niepotrzebny), prompty `ai/prompts/chat/v1–v6` i ich testy, słowniki v1 w `strings/pl.ts`
   (`progression`, `skip`, `day`, `bike`, `signal`, `blockEvent`, `validation`, `targetEffort` jeśli nieużywane…),
   `scripts/{simulate-plan,engine-baseline,engine-bench}.ts`, golden baseline (`Documents/silnik-v2/baseline`),
   `DEFAULT_EFFORT_RIR` w `voice/parameters.ts` (już nieużywane), `estimatedPeakKg` itp.
6. **Baza**: migracja `0014` — usunąć nieużywane tabele v1 (`planned_days`, `plan_generations`, `legacy_sessions`, `app_state`
   jeśli nieużywane, `workout_templates`), przemianować tabele `*_v2` (edycja wygenerowanego SQL). Kolumny
   potrzebne do wyświetlania starych sesji (`workouts.plan` v1 JSON → typ minimalny `{regions, kind?}`) zostają; kolumny
   `templateId` itp. — albo przebudowa tabeli przez drizzle-kit, albo świadomie zostawić i opisać w UWAGI. `closeSessionV2`
   i `abandon…` nie mogą już dotykać `planned_days`.
7. **Zmiana nazw**: usunąć przyrostki/sformułowania `V2`, „second engine”, „first engine”, „engine v2” z plików, funkcji,
   testów i komentarzy (np. `sessionsV2.ts` → `sessions.ts`, `logSetV2` → `logSet`, `planDayV2` → `planDay`,
   `weekPlanV2.ts`, `historyV2.ts`, `planningV2.ts`, `sqlite-check-*-v2.cjs`, `proposalsV2.ts`, `PLAN_WRITERS` w teście
   architektury: zostają `saveCoachWeek`, `acceptDay`). Komentarze odwołujące się do numerów P/D usuniętych rzeczy — usunąć.
8. **Dokumentacja**: `Documents/SPEC*`, `IMPLEMENTACJA*`, `silnik-v2/*` zaktualizować do stanu faktycznego; wpis w
   `POSTEP.md` (P6) i dzienniku; `UWAGI.md`: decyzje (brak resetu, stare serie tylko do odczytu, usunięte prompty, brak
   „Przywróć ćwiczenie z planu” — zamiennik wraca przez ponowną zamianę, brak pełnej listy zamienników — silnik zwraca max 3).
9. Na końcu: `npm run verify` + testy Workera (`cd worker && npx vitest run`), scalenie `--no-ff` do `main`, smoke test na emulatorze
   (receptura w pamięci: `android-local-build.md`), potem wdrożenie Workera i APK **razem** (decyzja użytkownika).

## 4. Pułapki i konwencje

- **Skrypty node z polskimi cudzysłowami/apostrofami**: heredoc w narzędziu Bash potrafi cicho nie wykonać polecenia
  (błąd cudzysłowu). Skrypty do edycji plików pisać narzędziem Write i uruchamiać `node plik.js`. Po `prettier --write`
  literały w plikach zmieniają łamanie linii — przed kolejną podmianą tekstu sprawdzać `grep`.
- Katalog roboczy potrafi „dryfować” (`cd`): używać `cd /d/Projekty/HomeWorkout/HomeWorkout-main && …`.
- Testy SQLite: `npx jest src/db/__tests__/storage.test.ts -t "fragment nazwy"` (skrypty `sqlite-check-*.cjs` na `node:sqlite`).
- Test architektury (`src/__tests__/architecture.test.ts`): lista `PLAN_WRITERS`/`PLAN_ORCHESTRATORS` — przy usuwaniu v1 przyciąć.
- Polecenia sesji wymagają `expectedSessionRevision`; `useActiveSession.send()` już obsługuje jedno ponowienie.
- Wynik wygrywa nad pominięciem (log serii kasuje `set_dispositions` tej serii); `reopenSets` kasuje tylko `skipped`.
- Dobór wysiłku: `defaultEffort(previous, targetRir)` (nie stałe „Ciężko”); sugestia obciążenia po pierwszej serii
  ćwiczenia = obciążenie faktycznie użyte. Głos: kanał `voice`, `shown: read_back` dla ilości i wysiłku (dowód liczy się
  tylko przy RIR z potwierdzeniem — `effortOf`).
- Narzędzie Edit wymaga wcześniejszego `Read` pliku; pliki zmieniane przez prettier trzeba czytać ponownie.
- Wdrożenie Workera i APK — dopiero po całym P6 (kontrakt 7). Pliki lokalne/sekrety: pamięć `live-deployment.md`.

## 5. Szybka weryfikacja stanu

```bash
cd /d/Projekty/HomeWorkout/HomeWorkout-main
git status --short && git log --oneline | head -5      # gałąź refactor/engine-p6-activation, ostatni f6e673a
npx tsc --noEmit 2>&1 | grep -v "^ " | head -60        # lista konsumentów jeszcze na starym silniku
npx jest src/domain/__tests__/progress.test.ts src/domain/__tests__/setEntry.test.ts src/features/workout/__tests__/useActiveSession.test.ts
```
