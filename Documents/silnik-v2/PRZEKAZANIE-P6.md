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

Gałąź: **`refactor/engine-p6-activation`**, nadal niescalona. Kontynuacja 2026-10-09: testy sesji domknięte w `01c2b67`; konsumenci „Dziś”, planu dnia, kalendarza, zakwasów, sesji dodatkowej i czatu przeniesieni na nowy silnik. `tsc --noEmit` przechodzi. Wdrożenie i pełne sprzątanie P6 pozostają otwarte.

### Kontynuacja — stan aktualny

- `features/plan/today.ts` / `usePlanToday`: `syncWeek` → świeży `previewDay` → transakcyjny `acceptDay`; konflikt odświeża podgląd, bez startu. Start zachowuje wybór ćwiczeń tygodnia (odczyt `kept` w transakcji); zmiana wyboru po podglądzie daje konflikt. Powtórne naciśnięcie startu nie wysyła drugiego polecenia.
- `PlanHero`, `SessionHero`, `ExercisePreview`, „Dlaczego ten plan?”: ekspozycje i kroki skompilowanego planu; `traceText` oraz podsumowanie dnia. `PlanningFeedback` wyjaśnia audyt/naprawę, a brak legalnego planu nie jest przedstawiany jako dzień wolny. Bilans tygodnia pokazuje osobno pewne serie i serie bez potwierdzonego wysiłku. Regeneracja pochodzi z indeksu rzeczywistych ekspozycji.
- Kalendarz czyta `planned_days_v2`; dawne sesje mają tytuł z minimalnych danych planu albo nazwę zastępczą. Szablony nie są już ładowane do ekranu „Dziś” ani kalendarza. Zakwasy odświeżają tydzień przez `weekPlanV2.syncWeek`.
- Sesja dodatkowa: opcje z `planDayV2` na wspólnym bilansie dnia, podgląd przez `previewDay({kind:'extra', only})`, start przez `acceptDay`. Sprawdzane ukończenie dnia, dzień wolny, zmiana daty i konflikt recepty; błąd podglądu daje ponowny odczyt.
- Czat korzysta wyłącznie z kontrolera `app-services/coach/proposalsV2`. Narzędzia sesji i symulacji podłączone do telefonu. Karta sesji ma polskie zdania `assessmentText`, stosuje oceniony patch w transakcji i wygasa po nowym poleceniu/pytaniu. Spóźniony wynik narzędzia nie tworzy karty dla nowej rozmowy. Odczyt jutra w `sessionChangeSource` korzysta z nowego tygodnia.
- `closeSessionV2` oznacza główny dzień w nowym tygodniu; zamknięcie sesji dodatkowej nie zmienia tego statusu. Licznik historii pomija wyniki cofnięte. Usunięte: `computeToday`, dawny kontroler czatu i ich nieaktualne testy. `planningSnapshot` / `coachPreview` nadal są używane przez ewaluacje i czekają na ich migrację.
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

Testy sesji zostały przepisane i odebrane w `01c2b67`; `GroupDoneCard` zachował poprawny kontrakt. Patrz „Kontynuacja — stan aktualny”.

## 3. Co zostało (kolejność sugerowana)

Punkty 1–4 poprzedniej listy (testy sesji oraz konsumenci UI/czatu) wykonane — szczegóły powyżej.

Przed usuwaniem domeny trzeba jeszcze przepisać **ewaluacje i syntetyczny planner** (`evals/chat/planning.ts`, `src/ai/testing/plan.ts`) na obecny silnik oraz usunąć fallback v1 z `ai/tools/implementations.ts`. `session/effects.ts` nadal używa `dayPlanner.checkSelection` do oceny jutra; źródło danych jest już nowe, ale ten wspólny strażnik wymaga przeniesienia/przepisania przed usunięciem starego plannera. Część skryptów SQLite wciąż testuje dawne repozytoria: zachować dowody odczytu i backupu starych danych, usunąć testy tworzenia sesji/tygodnia v1 wraz z martwym API. Obsługę dawnych sesji `in_progress` przy aktywacji należy sprawdzić przy sprzątaniu i migracji (bez kasowania historii).
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
git status --short && git log --oneline | head -5      # gałąź refactor/engine-p6-activation, bieżący stan: git log -5
npx tsc --noEmit 2>&1 | grep -v "^ " | head -60        # typecheck ma przechodzić; martwy kod znaleźć przez graf importów
npx jest src/domain/__tests__/progress.test.ts src/domain/__tests__/setEntry.test.ts src/features/workout/__tests__/useActiveSession.test.ts
```


Odbiór kontynuacji: `npm run verify` — 187 zestawów / 4129 testów / 9 snapshotów, pokrycie domeny i AI 100%; Worker 5 zestawów / 143 testy. Test emulatora i wdrożenie pozostają po sprzątaniu P6.
