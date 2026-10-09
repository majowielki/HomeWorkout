# Odbiór P6 — 2026-10-09

## Zakres i stan

Odbiór na emulatorze Pixel_API36 (Android 16 / API 36, x86_64) dotyczy builda
release z bieżącej gałęzi `refactor/engine-p6-activation`. Dane emulatora
zostały zachowane. Użytkownik wyraźnie zezwolił na uruchomienie przez ADB
i zadeklarował samodzielny test telefonu.

P6 pozostaje otwarty do odbioru telefonu. Nic nie pushowano ani nie scalano do `main`.

## Kod i migracja

- `npm run verify`: 166 zestawów, **3774 testy**, 5 snapshotów;
  domena i AI **100% statements/branches/functions/lines**.
- Worker: **146 testów / 5 zestawów**, typecheck oraz budowa wdrożeniowa.
- Po ostatniej korekcie tekstu błędu wykonano typecheck, kontrolę formatowania,
  ponowną budowę obu APK, kontrolę podpisu i uruchomienie końcowego release.
- Baza sprzed aktualizacji: 12 treningów, 19 serii, 2 jazdy, 10 migracji.
  Po aktualizacji: 15 migracji; 12 historycznych treningów pozostaje,
  nowy trening zapisano osobno. Historyczna aktywna sesja została zamknięta.
- Porównanie kopii SQLite potwierdza zachowanie wszystkich pierwotnych wartości
  w `set_logs`, `cardio_logs`, `bands`, `daily_logs` i `user_profile`.
  `body_metrics` / `measurements` były puste i pozostały puste.
  `PRAGMA foreign_key_check` nie zwraca błędów.

## Przepływy interfejsu

| Przypadek                     | Dowód                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uruchomienie i migracja       | Instalacja `adb install -r`, zimny start `MainActivity`, ekran Dziś z nowym planem; brak błędu migracji                                                                          |
| Start planu                   | „Nogi + ramiona” → rozgrzewka → logger; zamrożony plan sesji zapisany w bazie                                                                                                    |
| Zapis serii                   | Martwy ciąg rumuński: 6 kg na hantel, 11 powtórzeń, RIR 3; obserwacja dotykiem z edytowanymi wartościami, identyfikatory planu i polecenia                                       |
| Wznowienie                    | `am force-stop` → zimny start → Wznów; następne ćwiczenie, wcześniejsza seria zachowana                                                                                          |
| Zamiana                       | Podgląd ocenianej pompki → zatwierdzenie; rewizja planu 1 → 2, zapis martwego ciągu pozostaje                                                                                    |
| Zakończenie                   | Podsumowanie z jedną serią i RPE 7; sesja `completed`, główny dzień `done`                                                                                                       |
| Historia                      | Lista zawiera nowe i historyczne treningi; szczegóły pokazują `6 kg × 11 · RIR 3`                                                                                                |
| Kalendarz                     | Dzień wykonany i prognozy; baner opisuje zmianę przyszłego planu po zapisanej pracy                                                                                              |
| Sesja dodatkowa               | Wybór pompki → podgląd 3 serii → start; stan pozostaje po aktualizacji APK                                                                                                       |
| Zamienniki po poprawce        | Informacja o pierwszym podejściu pojawia się raz; ranking i recepta nadal dostępne                                                                                               |
| Czat: odczyt                  | Worker `chat/v7`, `getActiveSession`, poprawna odpowiedź: 3 zaplanowane, 0 wykonanych, 3 pozostałe serie                                                                         |
| Czat: propozycja i akceptacja | `getActiveSession` → `assessSessionChange` → `proposeSessionChange`; przed akceptacją 3 serie / rewizja 1, po „Zastosuj” 2 serie / rewizja 2; 20 zapisanych obserwacji bez zmian |

Odbiór ujawnił i usunął powielanie identycznych zdań w ocenie zamiennika,
fałszywą blokadę opisu „pozostają do zrobienia” oraz nieaktualne teksty o szablonach.
Testy strażnika nadal blokują polecenie „zrób 3 serie” i samodzielne dobieranie obciążenia.

Próba karty skrócenia sesji ujawniła niepoprawny dyskryminator `kind` generowany
przez model. Worker przekazuje teraz literały schematu jako `enum` przez eksport Zod
do draft 4 i nadal waliduje każde wywołanie oryginalnym ścisłym schematem.
Test obejmuje prawidłową redukcję i odrzucenie nieznanego rodzaju, brakującego ID,
zbyt dużej redukcji oraz dodatkowego pola obciążenia. Diagnostyka błędu zawiera
tylko znane nazwy schematu i liczbę dodatkowych pól, bez wartości argumentów.
Ta sama prośba po poprawce utworzyła kartę i została zaakceptowana w UI.
Eksport schematu rozwiązał obserwowany błąd; nie jest gwarancją poprawności
każdego przyszłego wywołania przez model. Błędne wywołanie nadal jest odrzucane.
Komunikat takiej odmowy jest wspólny dla czatu i podsumowania i nie przypisuje
nieprawdziwej liczby prób.

Po zabiciu procesu licznik przerwy nie jest wznawiany, a wcześniej zaplanowane
powiadomienie może się pojawić. To istniejące zachowanie opisane w
`stores/restTimerStore.ts`; postęp treningu jest odtwarzany z zapisanych serii.
Nie jest to dowód odbioru głosu, mikrofonu ani pracy telefonu w tle.

## Wydanie i artefakty

- APK telefonu: `D:/Projekty/HomeWorkout/HomeWorkout-P6-arm64-2026-10-09.apk`,
  **277817692 bajty**, wyłącznie `arm64-v8a`.
- SHA-256 APK: `9E22344DBB17C120CDB36EE1A3C781D7F2D2538E6F55FBD1011479BB41DB670A`.
- APK emulatora: `D:/Projekty/HomeWorkout/HomeWorkout-P6-x86_64-emulator-2026-10-09.apk`.
- Oba APK mają identyczny `assets/index.android.bundle`:
  `8537F3EDF80044699143D2620C780676AC2503AC16E3846A1F67D73BCC44AC53`.
- Podpis APK zweryfikowany; certyfikat zgodny z wcześniejszym release APK:
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- Worker: `https://homeworkout-coach.mmajewski111.workers.dev`, kontrakt **7**.
  Wersja końcowa: `3adff73c-214e-4b1e-a7d2-6c0ebb4b890d`.
- Test HTTP: bez klucza `401 unauthorized`; stary kontrakt 6:
  `409 contract_mismatch`, `expected: 7`. Starszy APK wymaga aktualizacji do tej pary wydania.
- Wersja Workera przed P6, na wypadek przywrócenia zgodnej pary:
  `0657539a-c016-4641-ae66-6f22ea337cbb`. Przywrócenie samego starego APK nie cofa migracji bazy.

Zrzuty i raporty artefaktów są poza repozytorium:
`D:/Projekty/HomeWorkout/p6-odbior-2026-10-09/`.
Emulator pozostawiono z testową sesją dodatkową (2 serie po zaakceptowanej redukcji),
żeby można było ponownie sprawdzić wznowienie. Metro i lokalny Worker są wyłączone.
Kopie bazy mają prefiks `p6-emulator-current-`; logi końcowe:
`p6-verify-odbior-final.log`, `p6-worker-odbior-tests-final.log`,
`p6-android-{arm64,x86}-release-final.log`, `p6-worker-deploy-final.log`.
Nie zmieniono sekretów, profilu urządzenia ani wcześniejszych plików release APK.

## Test telefonu — do wykonania przez użytkownika

1. W dotychczasowej aplikacji wykonaj Eksport / Import → eksport kopii dziennika.
2. Zainstaluj wskazany APK arm64 jako aktualizację istniejącej aplikacji.
3. Sprawdź stare treningi, ich serie i nazwy w Historii oraz pomiary i sprzęt.
4. Rozpocznij plan, zapisz serię, zamknij aplikację i sprawdź Wznów oraz zachowany wynik.
5. Sprawdź podgląd i zatwierdzenie zamiennika, zakończenie oraz zapis w Historii i Kalendarzu.
6. W czacie zapytaj o aktywną sesję i sprawdź kartę propozycji przed jej zatwierdzeniem.
7. Sprawdź głos, dźwięk/przerwę, zablokowany ekran i pracę w tle na telefonie.

Po potwierdzeniu wyniku telefonu można zamknąć P6 i wykonać lokalne scalenie `--no-ff`.
Pomiary p50/p95 na telefonie oraz odłożone rozszerzenia ekranów pozostają
osobnymi pozycjami w [UWAGI](UWAGI.md).
