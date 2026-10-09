# Przekazanie P6 — stan 2026-10-09

## Aktualizacja po kontynuacji Codex

**Bieżący raport: [ODBIOR-P6](ODBIOR-P6.md).** Poniższe wcześniejsze przekazanie
opisuje checkpoint `3a45f55`; ten akapit zastępuje jego listę pozostałych prac.

- Odbiór emulatora wykonany na buildzie release, bez resetu danych:
  migracja, start, zapis, zimne wznowienie, zamiennik, historia, kalendarz,
  dodatkowa sesja oraz czat z oceną i zatwierdzeniem karty.
- Poprawiono powielanie uzasadnień, fałszywą blokadę opisu pozostałych serii,
  nieaktualne teksty o szablonach i komunikat błędu modelu.
- Schematy funkcji dla Google używają eksportu Zod z `enum` dla literałów;
  walidacja oryginalnym ścisłym schematem pozostaje. Live test skrócenia sesji
  przechodzi dopiero po akceptacji: 3 → 2 serie, rewizja 1 → 2.
- Verify: **166 / 3774 / 5, domena i AI 100%**. Worker: **5 / 146**, typecheck.
- Worker wdrożony: `3adff73c-214e-4b1e-a7d2-6c0ebb4b890d`, kontrakt 7, prompt `chat/v7`.
- Aktualny APK telefonu: `D:/Projekty/HomeWorkout/HomeWorkout-P6-arm64-2026-10-09.apk`.
  Został przebudowany po poprawkach; aktualne hashe i rozmiar są w ODBIOR-P6.
  APK emulatora zawiera identyczny pakiet JS. Dawne release APK pozostają zachowane.
- Stary SPEC ma teraz obowiązującą sekcję kontraktu P6; dawny opis jest jawnie historyczny.
- **Pozostaje tylko odbiór telefonu do zamknięcia P6. Użytkownik wykonuje go sam**
  według checklisty w ODBIOR-P6. Do potwierdzenia nie scalać do `main`; nic nie pushować.
- Nie uruchamiano Metro ani lokalnego Workera. Emulator pozostaje dostępny;
  SDK trzeba podać przez `ANDROID_HOME` i `ANDROID_SDK_ROOT` zgodnie ze ścieżką niżej.

## Archiwalne przekazanie z checkpointu 3a45f55

## Cel i decyzje

Cała aplikacja używa bieżącego silnika. Brak przełącznika i resetu historii.
Zmiany Workera (kontrakt 7) i APK wydajemy razem po odbiorze. Nic nie pushować.
Gałąź: `refactor/engine-p6-activation`; etap nadal otwarty przed odbiorem UI i wydaniem.

## Wykonane w tej kontynuacji

- Usunięte dawne dayPlanner, compose, extra, weekSync, steps, history/doubleProgression,
  prescribe, reset/migration helpers, starty v1, repozytoria szablonów i starego źródła planera.
  W prescribe pozostała wyłącznie wspólna jednostka; fatigue zawiera recoveryLow.
- constraints oddzielone od weekPlan. Bieżące pliki/API nie mają V2.
  history/sessions/planning/weekPlan, day/week/block/plan/simulate i proposals są docelowymi nazwami.
- Migracja 0014: usuwa dawny tydzień, app_state i workout_templates; przebudowuje workouts
  bez template_id; zachowuje tytuł oraz wszystkie dane podrzędne przy FK ON; plan_v2 → session_plan,
  planned_days_v2 → planned_days, plan_generations_v2 → plan_generations.
- Backup 8 czyta wersje 1–7, zachowuje dawne plany i przenosi tytuły szablonów.
  Import historycznej aktywnej sesji zamyka ją bez usuwania serii.
- legacy_sessions pozostaje dla danych z archiwalnych backupów; reset API jest usunięte.
  To świadoma ochrona danych, wyjaśniona w UWAGI. Kalibracje, drabinki i estimatedPeakKg
  nadal są używane przez bieżące modele oporu. Szablony danych A/B służą tylko syntetycznej historii AI.
- Usunięte golden baseline, skrypty baseline/bench/simulate-plan, stare testy i prompt weekly-summary/v2.
- Sweep przeterminowanych sesji używa closeSession, wraz z ledgerem i stanem głównego dnia.

## Dowody

- Pełne `npm run verify`: **166 zestawów / 3771 testów / 5 snapshotów**, domena i AI
  **100% statements/branches/functions/lines**. Progi bez zmian.
- Worker: **5 zestawów / 143 testy**.
- SQLite: migracja z FK ON w transakcji zachowuje serie, korekty, pominięcia, outcomes,
  rewizje planu, feel i cardio; awaria podczas odtworzenia wycofuje całość.
  Testy sweepu i backupu 7 są w sqlite-check-activation.cjs.

## Pozostało do zakończenia P6

1. Odbiór UI na emulatorze (start, zapis, wznowienie, historia, kalendarz, zamiana i czat).
   Emulator Pixel_API36 uruchomiony bez resetu. SDK faktycznie znajduje się pod
   `C:/Users/mmaje/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/Android/Sdk`;
   dawna ścieżka z pamięci nie istnieje. Automatyczna kontrola odrzuciła am start przez ADB
   z komunikatem „blocked by policy”; nie obchodzimy odmowy. Brak jeszcze dowodu UI.
2. APK arm64 **zbudowany**: Gradle `assembleRelease -PreactNativeArchitectures=arm64-v8a`,
   `BUILD SUCCESSFUL in 1m 39s`. Kopia do wydania:
   `D:/Projekty/HomeWorkout/HomeWorkout-P6-arm64-2026-10-09.apk` (277818000 bajtów).
   Nie instalowano jej na telefonie i nie wdrażano Workera. Zostały dry run Workera,
   wspólne wydanie i test telefonu. Nie zastąpiono wcześniejszego release APK.
3. Po domknięciu odbioru scalenie lokalne --no-ff do main; bez pushowania.

Aktualne kontrakty i przepływy: [DOKUMENTACJA-TECHNICZNA](DOKUMENTACJA-TECHNICZNA.md).
Wcześniejsze checkpointy i commity: [POSTEP](POSTEP.md). Decyzje i wyjątki: [UWAGI](UWAGI.md).

## Zatrzymanie i przekazanie Claude

Użytkownik 2026-10-09 poprosił o zapis stanu i commit z powodu limitu tokenów.
Prace zatrzymane po odbiorze kodu i budowie APK. **Nie scalać ani nie uznawać P6 za
zakończony przed testem UI i wspólnym wydaniem.** Nowa wiadomość użytkownika:
„zainstalowałem emulator” — można kontynuować odbiór w jego środowisku.

W tle pozostały serwery uruchomione na potrzeby testu: Metro 8081 (PID 29984),
lokalny Worker z fake model 8787 (PID 30544). Przed użyciem sprawdzić, czy nadal działają.
Metro korzysta z istniejącego `.env.local`; próba nadpisania publicznej konfiguracji
testowej w poleceniu została odrzucona przez automatyczną kontrolę. Worker lokalny
uruchomiony z `wrangler.dev.jsonc --var APP_SECRET:dev-secret --port 8787 --local`.
Nie zmieniono sekretów ani konfiguracji produkcyjnego Workera.

Logi poza repozytorium: `D:/Projekty/HomeWorkout/p6-verify.log`, `p6-worker-tests.log`,
`p6-android-build.log`, `p6-activation.log`. Skrypty `p6-cleanup*.cjs`, `p6-rename.cjs`,
`p6-migration.cjs` itd. są jednorazowymi skryptami roboczymi — **nie uruchamiać ponownie**.
`p6-reachability.cjs` można ponownie użyć do audytu importów.

Dokumentacja techniczna i IMPLEMENTACJA zostały uaktualnione, POSTEP/UWAGI opisują
bieżące decyzje. Starszy SPEC-silnik-regul.md nadal wymaga pełnego przeglądu zgodności.
Po zmianach dokumentacji wykonano formatowanie; kod po zielonym verify nie był zmieniany.
