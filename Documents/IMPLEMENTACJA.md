# HomeWorkout — dokument implementacyjny

> Wersja 2.1. Data: 2026-09-15 (v2: 2026-09-14, v1: 2026-09-10).
> Dokumenty nadrzędne: [PLAN.md](PLAN.md) (dlaczego), [SPEC-silnik-regul.md](SPEC-silnik-regul.md) (logika domenowa).
> Ten dokument odpowiada na pytanie **jak** — i tam, gdzie jest sprzeczny z PLAN.md, to on obowiązuje
> (lista różnic w §1). **Stan realizacji i odstępstwa kodu od tego dokumentu: §0.**

---

## 0. Stan realizacji i odstępstwa od dokumentu

Aktualizowane po każdym kamieniu. Jeśli kod i dokument się różnią, ta sekcja mówi dlaczego.

### 0.1 Kamienie

| Kamień | Stan | Commit | Uwagi |
|---|---|---|---|
| M0 — środowisko | ✅ 2026-09-11 | `b6a0742` | build lokalny na Pixel 10 Pro; emulator x86_64 skonfigurowany osobno (§0.3) |
| M1 — fundament | ✅ 2026-09-11 | `861b2ba` | |
| M2 — katalog ćwiczeń | ✅ 2026-09-14 | `e592807` | 60 ćwiczeń; filtr bezpieczeństwa wyciągnięty z M7 do przodu |
| M3 — aktywna sesja | ✅ 2026-09-14 | `5579106` | dwa cięcia zakresu, §0.2 |
| review M0–M3 | ✅ 2026-09-14 | `c014730` | poprawki motywu i interopu, duplikaty serii, testy komponentów, ten rozdział |
| M4 — ciało, dziennik, przypomnienia | ✅ 2026-09-15 | `f5c808b` | wzór Navy w formie metrycznej (§0.2), przypomnienia jako jednorazowe z stałym id |
| M5 — historia, eksport / import | ✅ 2026-09-15 | `59c88a0` | picker z `expo-file-system` zamiast `expo-document-picker` (§0.2); DoD wymaga testu na urządzeniu |
| ⛔ bramka — dwa tygodnie używania | ⏳ | | M6+ dopiero po ≥ 4 sesjach i ≥ 14 dniach wagi |
| M6 — kalibracja gum | ✅ 2026-09-15 | `d7a309e` | model pozycja → rozciągnięcie doprecyzowany (§0.2); DoD wymaga trzech realnych kalibracji; **zrobiony przed bramką** — bramka nadal obowiązuje przed M7 |
| review M4–M6 | ✅ 2026-09-15 | | nagłówki stacka, przypomnienia jako seria, seria rozgrzewkowa, rower w historii, granica SQL egzekwowana lintem, ten rozdział |
| M7+ | ⏳ | | |

### 0.2 Odstępstwa od dokumentu — świadome

| Dokument mówi | Kod robi | Dlaczego |
|---|---|---|
| UI: `react-native-reusables` przez CLI | komponenty pisane ręcznie w stylu shadcn (`cva` + `cn`), `src/components/ui` | CLI nadpisałoby konfigurację Babel/Metro zweryfikowaną w M1; RNR to i tak model „kopiujesz do siebie" |
| `date-fns` | własne `domain/time/trainingDate.ts` | dwie funkcje; zależność nie była nigdy użyta i została usunięta |
| `eslint-plugin-import` | tylko `eslint-config-expo` | wystarcza; granicę domeny pilnuje `no-restricted-imports` |
| `workouts.plan`, `ai_exchanges` w schemacie | brak | powstaną z M7 / M9 przez migrację, nie na zapas |
| `SessionPlan`, `PlannedExercise` w `types.ts` | brak | jw. — M7 |
| §2.3: po zapisie serii SetLogger zostaje na ekranie, timer jako pasek | timer przerwy zastępuje ekran serii; następny SetLogger pojawia się po jego końcu | dwa wykluczające się stany zamiast „zamrożonego" formularza — prostsze, ta sama intencja |
| „przejdź" / „zamień" trwałe | żyją tylko w pamięci sesji; restart wraca do pierwszego niezalogowanego kroku i domyślnego ćwiczenia z szablonu | pominięcie kroku jest z natury bezpieczne (krok zostaje „niezalogowany" i wraca); zamiana nie przeżywa ubicia aplikacji — akceptowalne w M3 |
| seed szablonów „gated on version" | nadpisuje bezwarunkowo | brak edytora w aplikacji (M10), więc JSON jest jedynym autorem |
| `BottomSheetModal` | `BottomSheet` (nie-modalny, zawsze zamontowany, `index={-1}`) | bez providera na poziomie roota; wystarcza |
| SPEC §3.3: tryb konserwatywny reużywa `KNEE_UNILATERAL_UNSUPPORTED` | osobny kod `KNEE_UNILATERAL_PENDING_PHYSIO` | UI musi rozróżnić „na stałe" od „po akceptacji fizjoterapeuty" |
| `MovementPattern` z 8 wartościami | +`Cardio`, +`Mobility` | rower w katalogu jest obowiązkowym przypadkiem testowym filtra |
| §7.4: `movingAverage` „dla dni bez wpisu brak punktu" | średnia liczona per wpis w oknie kalendarzowym; wykres rysuje linię od pierwszego wpisu (`minPoints=1`), nagłówek „śr. 7 dni" wymaga ≥3 wpisów | jedna funkcja, dwa progi; wykres bez linii przez pierwszy tydzień byłby pusty |
| Navy → `body_metrics(source='navy')` | zapisywane tylko gdy istnieje waga z tego dnia lub wcześniejsza; inaczej tylko wyświetlane | `weightKg` jest `NOT NULL`; estymata bez wagi nie ma sensu |
| przypomnienia: „DAILY" trigger dla wagi | **seria** jednorazowych `DATE` triggerów na 14 dni naprzód (`reminder-weight-YYYY-MM-DD`), przeliczana przy każdym starcie / wpisie / sesji / imporcie / zmianie ustawień; dni wyciszone pomijane | tylko tak da się pominąć dzień, który już ma wpis (§10.2); pojedynczy trigger umierał po pierwszym odpaleniu — kto nie otworzył aplikacji, nie dostawał już nic, a to dokładnie osoba, dla której przypomnienie istnieje |
| §10.2: trening — „anuluj poprzednie, zaplanuj nowe na `lastSessionDate + N`" | jw. seria od `lastSessionDate + N` przez 14 dni, każda z własnym „ostatni trening był X dni temu" | jw.; po wyciszeniu na tydzień seria sama wznawia się ósmego dnia bez otwierania aplikacji |
| §7.2 / M3: uprawnienie do powiadomień „przy timerze" | timer i Ustawienia (zapis z włączonym przypomnieniem) proszą o uprawnienie; start aplikacji i wpis wagi **nie** — bez zgody seria po prostu nie jest planowana | dialog systemowy przed pierwszym ekranem to zły pierwszy kontakt; do tego provider czekał na odpowiedź użytkownika zanim cokolwiek wyrenderował |
| jeden kanał Android dla wszystkich powiadomień | `rest-timer` (HIGH, wibracja) i `reminders` (DEFAULT) osobno | koniec przerwy ma się przebić w trakcie treningu; poranne „zważ się" ma dać się ściszyć bez wyłączania alarmu przerwy |
| SPEC §5.5: „zakaz ekstrapolacji poza najwyższy zmierzony punkt" — kod sprawdzał tylko siłę | `estimateBandLoad` odmawia także, gdy koniec ruchu wykracza poza **najdłuższe zmierzone rozciągnięcie** | parabola z ujemną krzywizną poza danymi potrafi przewidzieć umiarkowaną siłę poniżej `maxMeasuredKg` — to nadal fikcja; test pilnuje obu osi |
| SPEC §5.6: seria rozgrzewkowa gumą obowiązkowa — UI nie miało jak jej zalogować | przełącznik „Seria rozgrzewkowa" na pierwszej serii bloku; zapis z `isWarmup=true` nie „zalicza" kroku, po przerwie wraca ta sama seria | bez tego M7 flagowałby `WARMUP_MISSING` na każdym ćwiczeniu z gumą; rozgrzewkowa nie wchodzi do objętości ani do prefillu następnej sesji |
| PLAN §11: „Log roweru: minuty, opór, kadencja, RPE"; §2.2: „rower: szybki log" | szybki log ma minuty + opór + RPE (kadencja odłożona — §0 PLAN pkt 1 wciąż otwarty); jazdy samodzielne są wierszami w Historii, rower sesji widoczny w jej szczegółach | do review dane roweru były zapisywane i nigdy nigdzie nie pokazywane |
| §10 pkt 4: porzucona sesja < 50 % serii → powtórz szablon (domyślnie: ≥ 50 % liczy się jako zrobiona) | naprzemienność patrzy wyłącznie na ostatnią sesję **ukończoną**; porzucona — niezależnie od procentu — nie przesuwa cyklu | próg 50 % to reguła silnika (M7 `dayPlanner`), tam trafi z testem; do tego czasu prostsza zasada, bez niespodzianek |
| §7.5: import — „walidacja Zod" | + sprawdzenie referencji **wewnątrz pliku** (`set_logs → workouts/bands`, `workouts → templates`, `cardio → workouts`) w `parseBackup`, czysto i z testem | inaczej wiszący identyfikator kończył się błędem klucza obcego ze środka transakcji, bez nazwy wiersza |
| historia: `estimatedLoadKg` pokazywany jako „≈ 12 kg" | „(do ≈ 12 kg)" | kolumna trzyma szczyt przedziału; jedna liczba bez „do" sugerowała wartość punktową, której SPEC §5.5 zakazuje |
| DOMS per partia „chipy" | trzy stany per partia: brak → 2 → 4 | mapuje się wprost na próg SPEC §4.3 (DOMS ≥ 4 = pomiń partię) |
| ustawienia: minuty przypomnień | tylko pełne godziny (stepper) | minuty nie są tu wartością; stepper jest szybszy niż picker |
| M5: `expo-document-picker` | `File.pickFileAsync()` z `expo-file-system` | SDK 57 ma picker wbudowany w file-system; jeden moduł natywny mniej |
| §7.5: przykład `schemaVersion: 3` | `BACKUP_SCHEMA_VERSION = 1`, niezależny od numeracji migracji Drizzle | wersja pliku rośnie tylko, gdy zmienia się kształt wiersza; migracje JSON w `db/backup/parse.ts` |
| §7.5: auto-backup „do folderu aplikacji" | `Paths.document/backups/`, pięć ostatnich, każdy do przywrócenia jednym tapnięciem z ekranu Eksport / Import | kopia, której nie da się odtworzyć bez kabla USB, to nie kopia |
| M5: „edycja/usunięcie serii" | + usunięcie całej sesji | porzucona sesja z zerem serii nie miała innej drogi zniknięcia z listy |
| SPEC §5.5: `lambdaAt(anchorPosition, exerciseRomProfile)` — niezdefiniowane | długość startowa gumy = L0 + pozycja × 30 cm (`BAND_CONFIG.anchorStepCm`, taśma na podłodze co 30 cm); zakres ruchu per wzorzec ruchu w `config/training.ts` (`romCm`); estymata to **przedział** [F(λ_start), F(λ_koniec)] | aplikacja dyktuje odstęp taśmy tak samo, jak dyktuje cztery pozycje — inaczej P2 znaczy co innego w każdej sesji; ROM per wzorzec to zgrubne przybliżenie, ale karmi tylko przedział z „≈", nigdy liczbę z ułamkiem |
| SPEC §5.5: `estimatedLoadKg = fit(...)` — jedna liczba | zapisywany **szczyt** przedziału (koniec koncentryki); `null`, gdy przedział wychodzi ponad `maxMeasuredKg` | kolumna nigdy nie trzyma ekstrapolacji; szczyt jest tym, co ogranicza progresję |
| SPEC §5.5: kwadratowe „w przeciwnym razie" | kwadratowe tylko przy ≥ 3 różnych λ; inaczej zostaje liniowe | przy dwóch różnych długościach równania normalne są osobliwe |
| SPEC §5.6: `cycleCount` | naliczany w `logSet` (suma powtórzeń); edycja/usunięcie w historii go nie koryguje; zerowany przy zapisie kalibracji | licznik orientacyjny, nie audyt |
| historia: edycja serii zmienia tylko liczby | pozycja w sesji (`exercise_order`, `set_index`) i `logged_at` nieedytowalne | poprawka literówki, nie przepisywanie przebiegu sesji |

### 0.3 Ustalenia środowiskowe, których dokument nie znał

- `sdkmanager` jest wygaszony; Android Studio 2026.1 używa CLI `android` (Rust). Składnia: `android sdk install "system-images/android-36/google_apis/x86_64"` — ukośniki, nie średniki. Zwraca niezerowe kody wyjścia (9, 255) także przy sukcesie.
- `expo run:android` buduje tylko ABI podłączonego urządzenia. APK z telefonu (arm64) nie uruchomi się na emulatorze (x86_64) — potrzebny osobny build z `--device emulator-5554`. Obie instalacje potem żyją równolegle.
- Typy tras expo-router regeneruje `npx expo customize tsconfig.json` bez serwera deweloperskiego (`npm run routes:types`); CI musi to zrobić przed `tsc`, bo `.expo/` nie jest w repo.
- `babel-preset-expo` w SDK 57 siedzi w `expo/node_modules` — własny `babel.config.js` wymaga jawnej instalacji na najwyższym poziomie.
- `react-dom` przypięty w `overrides` do wersji Reacta: `expo-router` ciągnie go tranzytywnie (`@expo/ui` → `vaul`) i bez tego `npm install` się wywala.
- NativeWind 4 wiąże `className` tylko z komponentami rdzenia RN. `expo-image`, `SectionList` i ikony lucide wymagają rejestracji (`src/lib/interop.ts`), inaczej klasy są po cichu ignorowane. Placeholder `TextInput` koloruje się wariantem `placeholder:`, nie osobnym propem.
- Nawigacja (nagłówki, tab bar) nie czyta tokenów NativeWind — bierze `ThemeProvider` eksportowany z expo-router; paleta jest zdublowana w `src/lib/theme.ts` dla tych kilku miejsc, które potrzebują surowego koloru.
- `@testing-library/react-native` 14 ma w pełni asynchroniczne API (`await render`, `await fireEvent.press`). `lucide-react-native` w Jest mapowany na build CJS (`moduleNameMapper`), bo warunek eksportu `react-native` wskazuje `.mjs`.
- Wzór US Navy: powszechnie kopiowane stałe `86.010 / 70.041 / 36.76` są dla **cali**. Z centymetrami zawyżają wynik o 5–25 p.p. Kod używa formy metrycznej (gęstość → Siri: `495/D − 450`); test pilnuje, żeby nie wrócić do calowej.
- `react-native-gifted-charts` wymaga `expo-linear-gradient` jako peera (moduł natywny) — M4 wymaga pełnego `expo run:android`.
- `expo-file-system` 57: stare API (`readAsStringAsync` itd.) rzuca w runtime z głównego eksportu; nowe to klasy `File` / `Directory` / `Paths` z synchronicznymi `write` / `textSync` / `exists`. `File.pickFileAsync({ mimeTypes })` zwraca `{ canceled, result: File }`. `npx expo install expo-sharing` samo dopisuje plugin do `app.json`.
- Schematy Zod pliku backupu są przypięte do typów Drizzle w obie strony (`satisfies z.ZodType<Row>` + test typu `Equal<>`): nowa kolumna w `schema.ts` bez wpisu w `db/backup/format.ts` nie przechodzi `tsc`.
- NativeWind zamienia `View` z klasą `active:` na `Pressable` przy pierwszym renderze — dlatego `<Link asChild><Card className="active:…">` działa, a bez `active:` po cichu nie.
- Reguły `react-hooks/purity` i `set-state-in-effect` z `eslint-config-expo` są egzekwowane jako błędy. Praktyczne skutki: żadnego `Date.now()` w renderze, żadnego synchronicznego `setState` w ciele efektu — „reset przed fetchem" rozwiązuje się przez remount z `key`, nie przez efekt.
- **`<Stack screenOptions={{ headerShown: false }}>` w `app/_layout.tsx` ukrywał nagłówek każdej trasy**, nie tylko grupy `(tabs)`: `Stack.Screen options={{ title }}` w ekranie dokłada tytuł, ale nie odwraca `headerShown`. Od M1 do review M4–M6 Ustawienia, Historia, Gumy i aktywna sesja nie miały tytułu, strzałki wstecz ani przycisku „Zakończ" w nagłówku — nawigacja szła wyłącznie gestem systemowym. Poprawka: `headerShown: false` tylko na `<Stack.Screen name="(tabs)">`.
- `expo-notifications`: `scheduleNotificationAsync({ identifier })` nadpisuje powiadomienie o tym samym id, a `getAllScheduledNotificationsAsync()` zwraca identyfikatory — serię przypomnień da się przeplanować bez trzymania czegokolwiek w bazie (anuluj po prefiksie, zaplanuj od nowa).
- Flat config ESLint: późniejszy obiekt **zastępuje** ustawienie tej samej reguły z wcześniejszego, nie łączy list. Dwie granice (`src/domain` bez frameworka; `@/db/client` i `@/db/schema` tylko w `src/db`) muszą być osobnymi blokami w kolejności od ogólnego do szczegółowego, inaczej domena traci swoją listę.
- Repozytoria eksportują buildery `live*Query()` dla `useLiveQuery` (`liveExercisesQuery`, `liveBandsQuery`, `liveKneeProfileQuery`) — hook w `features/` woła `useLiveQuery(liveBandsQuery())` i nie widzi ani klienta, ani schematu. To jedyna forma, w jakiej SQL wychodzi poza `src/db`.

---

## 1. Krytyczna rewizja planu — co zmieniam i dlaczego

Przeszedłem przez PLAN.md i SPEC z perspektywy osoby, która ma to faktycznie zbudować sama, wieczorami,
na Windowsie, ucząc się przy okazji React Native. Kilka wcześniejszych decyzji było poprawnych dla zespołu
produktowego, a złych dla tego projektu. Poniżej korekty — wszystkie idą w stronę **mniej ruchomych części**.

### 1.1 Monorepo → jedna aplikacja z wymuszoną granicą pakietów

**Było:** pnpm workspaces, `apps/mobile` + `packages/domain` + `packages/db` + `packages/ai`.
**Jest:** jedna aplikacja Expo, folder `src/domain` z **zakazem importów** frameworka egzekwowanym
przez ESLint (§5.3).

Powód: Metro (bundler React Native) i symlinki workspace'ów to klasyczne źródło godzin debugowania
(„moduł nie znaleziony", podwójne kopie Reacta, `watchFolders`). Dla jednej osoby uczącej się RN to
koszt bez zysku. Wartość portfolio leży w tym, że logika domenowa jest czysta i przetestowana —
nie w tym, że mieszka w osobnym pakiecie npm. Rekruter otwierający `src/domain` widzi dokładnie to samo.
Monorepo wraca na stół w momencie, gdy pojawi się drugi konsument domeny (np. panel webowy).

### 1.2 Vitest → jeden runner: `jest-expo`

Domena testowana w Vitest, komponenty w Jest — dwa configi, dwa sposoby mockowania. Przy jednym pakiecie
`jest-expo` obsłuży i czysty TS, i komponenty. Jedna komenda `npm test`.

### 1.3 victory-native XL → `react-native-gifted-charts`

Victory XL ciągnie za sobą Skia — kolejny natywny moduł do skompilowania przy pierwszym buildzie na
Windowsie. Gifted-charts opiera się tylko na `react-native-svg` i w zupełności wystarcza do wykresu wagi
ze średnią kroczącą. Pierwszy build ma się udać, nie imponować.

### 1.4 react-hook-form → zbędne na MVP

Formularze to: waga (jedna liczba), obwody (sześć liczb), suwaki dziennika. Kontrolowane inputy + Zod.
RHF wraca, jeśli pojawi się edytor szablonów treningowych z dynamicznymi listami.

### 1.5 Backend .NET → usunięty z planu

Wspominałem o backendzie synchronizacyjnym w C#/.NET jako opcji na etap 4. Wycofuję: **w tym projekcie
nie ma ani jednej linii C#.** Aplikacja jest w TypeScript/React Native, a jedyny element serwerowy
(proxy do Gemini, etap 3) jest funkcją w TypeScript — Cloudflare Workers albo Azure Functions
w runtime Node. Jeśli kiedyś powstanie backend synchronizacyjny, też będzie w TS.

### 1.6 Luki w modelu, które plan pomijał

Rzeczy, których nie było w PLAN.md, a bez których aplikacja nie zadziała poprawnie:

| Brak | Konsekwencja bez tego | Rozwiązanie |
|---|---|---|
| **Szablon treningu** (`WorkoutTemplate`) | „co dziś" nie ma z czego generować sesji; użytkownik składa trening od zera za każdym razem | encja + seed dwóch szablonów FBW A/B (§6.4) |
| **Profil użytkownika** | wzór Navy potrzebuje wzrostu i płci; granica doby i wysokość siodełka nie mają gdzie żyć | tabela `user_profile`, jeden wiersz |
| **Trwałość aktywnej sesji** | zabicie aplikacji w trakcie treningu = utrata wszystkich serii | każda seria zapisywana do SQLite natychmiast; status `in_progress`; wznowienie po starcie (§7.1) |
| **Timer przerwy w tle** | timery JS zamierają po zablokowaniu ekranu | znacznik czasu końca + lokalna notyfikacja OS (§7.2) |
| **Blok rozgrzewki** | efekt Mullinsa fałszuje pierwszą serię z gumą; kolano bez rozgrzewki | flaga `isWarmup` na serii, 5 min roweru jako domyślna rozgrzewka |
| **Import**, nie tylko eksport | backup, którego nie da się przywrócić, nie jest backupem | import JSON z walidacją Zod + wersją schematu (§7.5) |
| **Interakcja deload × przerwa** | przerwa 2 tygodnie tuż przed deloadem → deload zaraz po przerwie, absurd | przerwa ≥ 8 dni zeruje licznik deloadu |
| **RIR po każdej serii = tarcie** | użytkownik przestaje wpisywać albo wpisuje byle co | domyślnie wartość z poprzedniej serii, korekta jednym tapnięciem |

### 1.7 Ryzyka techniczne, których wcześniej nie nazwałem

- **Agresywne oszczędzanie baterii na Androidzie** (Samsung, Xiaomi) potrafi ubić zaplanowaną notyfikację.
  Mitygacja: instrukcja wyłączenia optymalizacji dla aplikacji w ustawieniach; ekran i tak nie gaśnie
  (`keep-awake`), więc notyfikacja jest zabezpieczeniem, nie podstawą.
- **Pierwszy build natywny na Windowsie** to najbardziej prawdopodobne miejsce utknięcia w całym
  projekcie. Dlatego kamień milowy M0 (§8) to *wyłącznie* „hello world na telefonie" — bez żadnej
  biblioteki. Dopiero potem dokładamy zależności, pojedynczo.
- **Tryb konserwatywny kolana wyklucza cały wzorzec Lunge.** Sprawdziłem, czy da się zbudować dwa
  pełne szablony FBW wyłącznie z ćwiczeń obunóż — da się (§6.4), ale pula na nogi jest wąska:
  goblet squat, przysiad z gumą, RDL, glute bridge / hip thrust, pull-through z gumą, rower.
  To kolejny argument za wizytą u fizjoterapeuty: odblokowanie split squatów podwaja pulę.

### 1.8 Harmonogram

Estymaty w PLAN.md („2–3 tygodnie") zakładały pełne dni. Realne tempo to **wieczory i weekendy**,
plus narzut na naukę specyfiki RN (Metro, native build, nawigacja). Kamienie milowe w §8 mają estymaty
w wieczorach, nie w tygodniach, i zakładają ~2 h skupionej pracy na wieczór.

---

## 2. Docelowy kształt aplikacji

### 2.1 Jedno zdanie

Aplikacja, którą otwierasz raz rano (waga, 10 sekund), raz przed treningiem (mówi, co dziś i dlaczego),
trzymasz otwartą w trakcie (loguje serie, odmierza przerwy), i raz w tygodniu (podsumowanie + rozmowa
z trenerem AI).

### 2.2 Nawigacja

```
[Dziś]        [Trening]        [Ciało]        [Historia]        [Więcej]
  │              │                │               │                │
  │              │                │               │                ├─ Ćwiczenia (baza, podgląd)
  │              │                │               │                ├─ Gumy (kalibracja)
  │              │                │               │                ├─ Szablony
  │              │                │               │                ├─ Trener AI       (etap 3)
  │              │                │               │                ├─ Eksport / Import
  │              │                │               │                └─ Ustawienia / Profil
  │              │                │               │
  │              │                │               └─ lista treningów → szczegóły → edycja
  │              │                │
  │              │                ├─ waga: wpis + wykres (7d MA + trend)
  │              │                ├─ obwody: wpis + wykres talii
  │              │                └─ dziennik dnia: sen / energia / DOMS / notatka
  │              │
  │              ├─ start: wybór szablonu albo „co dziś" (etap 2) → rozgrzewka → sesja
  │              ├─ AKTYWNA SESJA (patrz 2.3)
  │              └─ podsumowanie: session RPE, notatka, porównanie z poprzednią
  │
  └─ karta „dziś": ostatnia waga + trend, status tygodnia (sesje / objętość),
     przycisk „Rozpocznij trening", niedokończona sesja do wznowienia (jeśli jest),
     rower: szybki log
```

Pięć zakładek na dole. „Więcej" to lista — nie ma sensu robić szóstej ikony dla rzeczy używanych raz w miesiącu.

### 2.3 Ekran aktywnej sesji — najważniejszy ekran w aplikacji

Projektowany pod: telefon leży na podłodze obok karimaty, spocone palce, ekran się nie gaśnie.

```
┌──────────────────────────────────────────┐
│  A1 · Goblet squat              2 / 2   │   ← ćwiczenie, która seria z ilu
│  ─────────────────────────────────────   │
│  [obraz ćwiczenia]   cel: 10–20 · RIR 2–3│   ← cel z szablonu / silnika
│                       ostatnio: 14 kg×14 │
│                                          │
│   HANTEL (single)        POWTÓRZENIA     │
│   ┌────┐ ┌──────┐ ┌────┐  ┌────┐┌────┐┌────┐
│   │ –2 │ │ 14 kg│ │ +2 │  │ –  ││ 14 ││ +  │
│   └────┘ └──────┘ └────┘  └────┘└────┘└────┘
│                                          │
│   RIR:  [0] [1] [2•] [3] [4]             │   ← domyślnie poprzednia wartość
│                                          │
│  ┌────────────────────────────────────┐  │
│  │        ZAPISZ SERIĘ  ✓             │  │   ← jeden duży przycisk, haptic
│  └────────────────────────────────────┘  │
│                                          │
│  ⏱  przerwa: 1:32          [+30s] [skip] │   ← po zapisie startuje automatycznie
│  następne: A2 · Wiosłowanie gumą (P2)    │   ← superseria: pokazuje, co za chwilę
├──────────────────────────────────────────┤
│  [◀ poprzednie]   [lista ▤]   [dalej ▶]  │
└──────────────────────────────────────────┘
```

Zasady:
- **Wszystko, co można, jest wstępnie wypełnione** (ciężar i powtórzenia z poprzedniej serii / z planu).
  W typowym przypadku logowanie serii to jedno tapnięcie.
- Przy gumie zamiast ciężaru: `[żółta ▾]  P: [0][1][2•][3]`.
- Przy izometrii (deska): zamiast powtórzeń — sekundy, timer odliczający w górę.
- Cue'y ćwiczenia pod obrazem, rozwijane; dla nóg cue kolanowy zawsze widoczny.
- Bottom sheet „lista" pokazuje całą sesję z postępem — można przeskoczyć, pominąć ćwiczenie,
  podmienić na zamiennik (etap 2: filtrowany silnikiem).

### 2.4 Co użytkownik widzi w kolejnych etapach

| Etap | Co przybywa na ekranach |
|---|---|
| 1 — dziennik | wszystko z §2.2 poza „co dziś", Trenerem i kalibracją; treningi startują z szablonu |
| 1.5 — gumy | ekran kalibracji; przy gumach skalibrowanych pojawia się przedział kg |
| 2 — silnik | karta „co dziś" z uzasadnieniem (kody powodów → polskie zdania); zamienniki filtrowane; progresja wypełnia cel automatycznie; ostrzeżenia (objętość, zmęczenie, deload) |
| 3 — AI | „Trener": podsumowanie tygodnia, pytania, propozycje zmian do akceptacji; etap 0 = przycisk „kopiuj brief" |
| 4 | zdjęcia progresu, Health Connect, przypomnienia, guardraile |

---

## 3. Stack — lista ostateczna

Wszystko TypeScript. Zero C#. Wersje: **aktualne stabilne w dniu startu** — `npx expo install` dobiera
wersje zgodne z SDK, nie pinujemy ręcznie.

### 3.1 Aplikacja

| Warstwa | Biblioteka | Po co |
|---|---|---|
| Runtime | **Expo SDK (najnowszy stabilny)**, dev build, New Architecture (domyślna) | natywne moduły bez Xcode, `expo run:android` lokalnie |
| Język | TypeScript `strict: true` | kontrakt danych |
| Nawigacja | `expo-router` | routing plikowy, typed routes |
| Baza | `expo-sqlite` + `drizzle-orm` + `drizzle-kit` | SQLite, typowane zapytania, migracje generowane z kodu, `useLiveQuery` |
| Stan UI | `zustand` (jeden mały store sesji + timer) | stan aktywnej sesji między ekranami; dane trwałe zawsze w SQLite |
| Walidacja | `zod` | dane wejściowe, `exercises.json`, import backupu, odpowiedzi AI |
| UI | `nativewind` (Tailwind) + własne komponenty w stylu shadcn (`cva`, `cn`) — patrz §0.2 | znany model z shadcn/ui |
| Ikony | `lucide-react-native` przez `src/components/ui/icons.ts` (rejestracja `cssInterop`) | kolor z `className`, nie z twardego `color` |
| Wykresy | `react-native-gifted-charts` (+ `react-native-svg`) | waga, talia, objętość |
| Sheet | `@gorhom/bottom-sheet` | lista sesji, wybór ćwiczenia |
| Gesty/animacje | `react-native-gesture-handler`, `react-native-reanimated` | wymagane przez sheet i reusables |
| Obrazy | `expo-image` | cache, szybkie ładowanie obrazów ćwiczeń |
| Sesja | `expo-keep-awake`, `expo-haptics`, `expo-notifications` | ekran nie gaśnie, feedback, koniec przerwy |
| Pliki | `expo-file-system`, `expo-sharing`, `expo-document-picker` | eksport / import |
| Id | `expo-crypto` (`randomUUID`) | identyfikatory |
| Testy | `jest-expo`, `@testing-library/react-native` 14 (API async) | domena + komponenty, jeden runner |
| Jakość | `eslint` (flat config, `eslint-config-expo`), `prettier`, `typescript` | granice modułów, formatowanie |
| CI | GitHub Actions | lint + typecheck + test na każdy push |

### 3.2 Serwer (dopiero etap 3)

| Element | Wybór |
|---|---|
| Hosting | **Cloudflare Workers** (TS, darmowy tier, zero utrzymania) — alternatywnie Azure Functions w Node/TS, jeśli chcesz Azure w CV |
| SDK | `@google/genai` (aktualny, zunifikowany SDK Google; stary `@google/generative-ai` jest wygaszony) |
| Model | Gemini — szybki/tani do komentarzy, mocniejszy do planu tygodnia; `responseMimeType: 'application/json'` + `responseSchema` |
| Auth | nagłówek ze wspólnym sekretem + limit zapytań; sekret w aplikacji da się wyciągnąć, ale chroni tylko dostęp do *Twojego* proxy z limitem, nie klucz Gemini — akceptowalne dla jednego użytkownika |

### 3.3 Czego świadomie nie ma

Realm, WatermelonDB, RxDB, Redux, React Query (brak serwera na MVP), i18n (jeden język), Skia,
Lottie, monorepo, Docker, C#.

---

## 4. Struktura repozytorium

```
HomeWorkout/
├── app/                                  # expo-router — TYLKO trasy, cienkie
│   ├── _layout.tsx                       # providers: DB, gesture handler, theme
│   ├── (tabs)/
│   │   ├── _layout.tsx                   # 5 zakładek
│   │   ├── index.tsx                     # Dziś
│   │   ├── workout.tsx                   # Trening (start)
│   │   ├── body.tsx                      # Ciało
│   │   ├── history.tsx                   # Historia
│   │   └── more.tsx                      # Więcej
│   ├── workout/
│   │   ├── active/[id].tsx               # aktywna sesja
│   │   └── summary/[id].tsx
│   ├── history/[id].tsx
│   ├── exercises/index.tsx, [id].tsx
│   ├── bands/index.tsx, calibrate/[id].tsx
│   ├── templates/index.tsx
│   ├── coach/index.tsx                   # etap 3
│   ├── backup.tsx
│   └── settings.tsx
│
├── src/
│   ├── domain/                           # CZYSTY TS — zero react / expo / db (ESLint pilnuje)
│   │   ├── types.ts                      # Exercise, Band, SetLog, SessionPlan, ...
│   │   ├── config/training.ts            # MEV, RIR, zakresy, drabinki — patrz SPEC
│   │   ├── inventory.ts                  # INVENTORY, LADDER_PAIRED, LADDER_SINGLE
│   │   ├── exercises/  screen.ts  substitute.ts
│   │   ├── progression/ dumbbell.ts  band.ts  calibration.ts  layoff.ts
│   │   ├── volume/     weekly.ts
│   │   ├── autoregulation/ fatigue.ts  deload.ts  dayPlanner.ts
│   │   ├── metrics/    movingAverage.ts  trend.ts  navy.ts
│   │   ├── time/       trainingDate.ts
│   │   ├── reasons.ts                    # ReasonCode → klucz tekstu
│   │   └── __tests__/                    # lustro struktury powyżej
│   │
│   ├── db/
│   │   ├── client.ts                     # openDatabaseSync + drizzle()
│   │   ├── schema.ts                     # tabele Drizzle (§6)
│   │   ├── migrations/                   # generowane przez drizzle-kit, commitowane
│   │   ├── seed.ts                       # ćwiczenia, gumy, szablony z /data
│   │   └── repositories/                 # workouts.ts, sets.ts, body.ts, ... (jedyne miejsce z SQL)
│   │
│   ├── features/                         # ekrany = kompozycja tych modułów
│   │   ├── workout/    hooks/ components/ (ActiveSession, SetLogger, RestTimer, SessionList)
│   │   ├── body/       (WeightEntry, WeightChart, Measurements, DailyLog)
│   │   ├── bands/      (CalibrationWizard)
│   │   ├── backup/     (export.ts, import.ts)
│   │   ├── planner/    (etap 2: łączy domain + repositories → SessionPlan)
│   │   └── coach/      (etap 3)
│   │
│   ├── components/ui/                    # react-native-reusables (button, card, sheet, ...)
│   ├── stores/       sessionStore.ts  restTimerStore.ts
│   ├── ai/           brief.ts  schemas.ts  client.ts   (etap 3)
│   ├── lib/          ids.ts  dates.ts  format.ts
│   └── strings/pl.ts                     # wszystkie teksty UI w jednym miejscu
│
├── data/
│   ├── exercises.json                    # baza ćwiczeń — źródło prawdy
│   ├── exercises.schema.ts               # Zod; ten sam schemat waliduje w CI i przy seedzie
│   ├── bands.json
│   └── templates.json                    # FBW A / FBW B
│
├── assets/exercise-media/                # obrazy z free-exercise-db + LICENSE (Unlicense)
├── scripts/
│   ├── validate-data.ts                  # CI: exercises.json ↔ schemat, każde ćwiczenie ma obraz
│   └── import-media.ts                   # jednorazowo: kopiuje wybrane obrazy z free-exercise-db
│
├── .github/workflows/ci.yml
├── app.json  metro.config.js  babel.config.js  tailwind.config.js  global.css
├── drizzle.config.ts  jest.config.js  eslint.config.js  tsconfig.json
└── README.md
```

**Zasada przepływu:** `app/` → `features/` → `db/repositories/` + `domain/`. Trasy nie zawierają
logiki, repozytoria nie zawierają reguł, domena nie wie o niczym poza swoimi typami.

---

## 5. Konfiguracja — pliki, które muszą być dokładnie takie

### 5.1 `metro.config.js`

```js
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push('sql');            // migracje Drizzle jako moduły

module.exports = withNativeWind(config, { input: './global.css' });
```

### 5.2 `babel.config.js`

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      ['inline-import', { extensions: ['.sql'] }],   // babel-plugin-inline-import
      'react-native-reanimated/plugin',              // ZAWSZE ostatni
    ],
  };
};
```

### 5.3 `eslint.config.js` — granica domeny

```js
// fragment: reguła, która czyni src/domain czystym
{
  files: ['src/domain/**/*.ts'],
  ignores: ['src/domain/__tests__/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['react', 'react-native', 'react-native/*', 'expo', 'expo-*', 'expo/*',
                'drizzle-orm', 'drizzle-orm/*', '@/db/*', '@/features/*', '@/stores/*', '@/components/*'],
        message: 'src/domain musi pozostać wolne od frameworka. Przekaż dane jako argumenty.',
      }],
    }],
  },
},
```

### 5.4 `drizzle.config.ts`

```ts
import type { Config } from 'drizzle-kit';
export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
```

Przepływ zmiany schematu: edytuj `schema.ts` → `npx drizzle-kit generate` → commit wygenerowanego
folderu → `useMigrations()` w `_layout.tsx` aplikuje przy starcie. **Nigdy nie edytuj wygenerowanych
migracji ręcznie i nigdy nie usuwaj starych** — na telefonie są już zastosowane.

### 5.5 `src/db/client.ts`

```ts
import { openDatabaseSync } from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as schema from './schema';

const sqlite = openDatabaseSync('homeworkout.db', { enableChangeListener: true }); // wymagane dla useLiveQuery
sqlite.execSync('PRAGMA journal_mode = WAL;');
sqlite.execSync('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });
```

### 5.6 `tsconfig.json` — aliasy

```json
{ "extends": "expo/tsconfig.base", "compilerOptions": { "strict": true, "paths": { "@/*": ["./src/*"], "@data/*": ["./data/*"] } } }
```

### 5.7 `app.json` — istotne wpisy

```json
{
  "expo": {
    "name": "HomeWorkout", "slug": "homeworkout", "scheme": "homeworkout",
    "android": { "package": "pl.majewski.homeworkout", "permissions": ["POST_NOTIFICATIONS", "VIBRATE"] },
    "plugins": ["expo-router", "expo-sqlite", "expo-notifications", "expo-font"],
    "experiments": { "typedRoutes": true }
  }
}
```

---

## 6. Model danych — schemat Drizzle

Konwencje: klucze `text` UUID; czasy zdarzeń jako ISO UTC (`*_at`); daty logiczne jako `YYYY-MM-DD`
(`date`, `training_date`); obiekty złożone jako kolumny JSON z typem (`{ mode: 'json' }`), bo przy
jednym użytkowniku i 60 ćwiczeniach filtrowanie w SQL nie jest potrzebne — domena filtruje w pamięci.

```ts
// src/db/schema.ts
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import type { Exercise, BandCalibration, KneeProfile, SessionPlan, TemplateBlock, MuscleGroup } from '@/domain/types';

export const userProfile = sqliteTable('user_profile', {
  id: integer('id').primaryKey(),                        // zawsze 1
  heightCm: real('height_cm'),
  birthYear: integer('birth_year'),
  sex: text('sex', { enum: ['male', 'female'] }),
  dayBoundaryHour: integer('day_boundary_hour').notNull().default(4),
  saddleHeightCm: real('saddle_height_cm'),
  kneeProfile: text('knee_profile', { mode: 'json' }).$type<KneeProfile | null>(),
  updatedAt: text('updated_at').notNull(),
});

export const exercises = sqliteTable('exercises', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  data: text('data', { mode: 'json' }).$type<Exercise>().notNull(),   // pełna taksonomia
  dataVersion: integer('data_version').notNull(),                       // wersja exercises.json
});

export const bands = sqliteTable('bands', {
  id: text('id').primaryKey(),                           // 'yellow' | 'red' | ...
  label: text('label').notNull(),
  nominalMinKg: real('nominal_min_kg').notNull(),
  nominalMaxKg: real('nominal_max_kg').notNull(),
  restLengthCm: real('rest_length_cm'),
  calibration: text('calibration', { mode: 'json' }).$type<BandCalibration | null>(),
  cycleCount: integer('cycle_count').notNull().default(0),
  calibratedAt: text('calibrated_at'),
});

export const workoutTemplates = sqliteTable('workout_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),                          // 'FBW A'
  blocks: text('blocks', { mode: 'json' }).$type<TemplateBlock[]>().notNull(),
  sortOrder: integer('sort_order').notNull(),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
});

export const workouts = sqliteTable('workouts', {
  id: text('id').primaryKey(),
  trainingDate: text('training_date').notNull(),         // wg granicy doby
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status', { enum: ['in_progress', 'completed', 'abandoned'] }).notNull(),
  templateId: text('template_id').references(() => workoutTemplates.id),
  plan: text('plan', { mode: 'json' }).$type<SessionPlan | null>(),  // co było zaplanowane (etap 2)
  sessionRpe: integer('session_rpe'),
  notes: text('notes'),
}, (t) => [index('workouts_date_idx').on(t.trainingDate), index('workouts_status_idx').on(t.status)]);

export const setLogs = sqliteTable('set_logs', {
  id: text('id').primaryKey(),
  workoutId: text('workout_id').notNull().references(() => workouts.id, { onDelete: 'cascade' }),
  exerciseId: text('exercise_id').notNull().references(() => exercises.id),
  exerciseOrder: integer('exercise_order').notNull(),   // pozycja w sesji
  setIndex: integer('set_index').notNull(),
  isWarmup: integer('is_warmup', { mode: 'boolean' }).notNull().default(false),
  reps: integer('reps'),
  timeSec: integer('time_sec'),                          // izometria
  rir: integer('rir'),
  weightKg: real('weight_kg'),
  dumbbellMode: text('dumbbell_mode', { enum: ['paired', 'single'] }),
  bandId: text('band_id').references(() => bands.id),
  anchorPosition: integer('anchor_position'),            // 0..3
  estimatedLoadKg: real('estimated_load_kg'),            // null gdy brak kalibracji
  loggedAt: text('logged_at').notNull(),
}, (t) => [index('set_logs_workout_idx').on(t.workoutId), index('set_logs_exercise_idx').on(t.exerciseId)]);

export const cardioLogs = sqliteTable('cardio_logs', {
  id: text('id').primaryKey(),
  workoutId: text('workout_id').references(() => workouts.id, { onDelete: 'cascade' }), // null = osobna jazda
  trainingDate: text('training_date').notNull(),
  purpose: text('purpose', { enum: ['warmup', 'cardio'] }).notNull(),
  minutes: integer('minutes').notNull(),
  resistanceLevel: integer('resistance_level'),
  avgCadence: integer('avg_cadence'),
  avgHr: integer('avg_hr'),
  rpe: integer('rpe'),
  loggedAt: text('logged_at').notNull(),
}, (t) => [index('cardio_date_idx').on(t.trainingDate)]);

export const bodyMetrics = sqliteTable('body_metrics', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),                          // kalendarzowa — waga rano
  weightKg: real('weight_kg').notNull(),
  bodyFatPct: real('body_fat_pct'),
  source: text('source', { enum: ['manual', 'scale', 'navy'] }).notNull(),
  loggedAt: text('logged_at').notNull(),
}, (t) => [index('body_date_idx').on(t.date)]);

export const measurements = sqliteTable('measurements', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  waistCm: real('waist_cm'), hipsCm: real('hips_cm'), chestCm: real('chest_cm'),
  armCm: real('arm_cm'), thighCm: real('thigh_cm'), neckCm: real('neck_cm'),
  loggedAt: text('logged_at').notNull(),
});

export const dailyLogs = sqliteTable('daily_logs', {
  date: text('date').primaryKey(),
  sleepHours: real('sleep_hours'),
  energy: integer('energy'),                             // 1..5
  stress: integer('stress'),                             // 1..5
  soreness: text('soreness', { mode: 'json' }).$type<Partial<Record<MuscleGroup, number>>>(),
  steps: integer('steps'),
  note: text('note'),
  updatedAt: text('updated_at').notNull(),
});

// etap 3
export const aiExchanges = sqliteTable('ai_exchanges', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['weekly_summary', 'question', 'plan_proposal'] }).notNull(),
  request: text('request', { mode: 'json' }).notNull(),
  response: text('response', { mode: 'json' }),
  accepted: integer('accepted', { mode: 'boolean' }),
  createdAt: text('created_at').notNull(),
});
```

### 6.1 Typy domenowe (`src/domain/types.ts`) — kluczowe

```ts
export interface TemplateBlock {
  label: string;                       // 'A1'
  exerciseId: string;
  sets: number;
  repMin: number; repMax: number;      // lub timeSec dla izometrii
  targetRirMin: number; targetRirMax: number;
  supersetWith?: string;               // 'A2'
  restSec: number;
}

export type PlannedLoad =
  | { kind: 'dumbbell'; mode: 'paired' | 'single'; kg: number }
  | { kind: 'band'; bandId: string; position: 0 | 1 | 2 | 3 }
  | { kind: 'bodyweight' };

export interface PlannedExercise extends TemplateBlock {
  load: PlannedLoad | null;            // null = pierwsza sesja, użytkownik wybiera
  reasons: ReasonCode[];
}

export interface SessionPlan {
  generatedAt: string;
  source: 'template' | 'engine' | 'ai_accepted';
  exercises: PlannedExercise[];
  warnings: ReasonCode[];
}
```

### 6.2 Seed przy starcie

`seed.ts` czyta `data/*.json`, waliduje Zodem, i **upsertuje** po `id` z `dataVersion`. Zmiana JSON-a
+ podbicie wersji = aktualizacja ćwiczeń u użytkownika bez migracji. Ćwiczenie usunięte z JSON-a
**nie jest** usuwane z bazy (logi go referencjonują) — dostaje flagę `archived` w `data`.

### 6.3 `exercises.json` — kształt jednego wpisu

```json
{
  "id": "goblet-squat",
  "name": "Przysiad goblet",
  "movementPattern": "Squat",
  "planesOfMotion": ["Sagittal"],
  "isClosedKineticChain": true,
  "stanceMechanics": "Bilateral",
  "forceProfile": "ConcentricEccentric",
  "loadsKnee": true,
  "provokesValgusVarus": false,
  "highAnteriorTibialShear": false,
  "primaryMuscles": ["quads", "glutes"],
  "secondaryMuscles": ["core"],
  "equipment": ["dumbbell"],
  "dumbbellMode": "single",
  "bandSuitability": "excellent",
  "substituteIds": ["band-squat", "wall-sit"],
  "media": "goblet-squat",
  "cues": [
    "Hantel przy klatce, łokcie pod nim.",
    "Kolana śledzą palce stóp — nie uciekają na zewnątrz.",
    "Schodzisz 3 s, wstajesz płynnie.",
    "Pięty cały czas na podłodze."
  ],
  "kneeCue": "Kontroluj prawe kolano: oś nad drugim palcem stopy przez cały ruch."
}
```

`scripts/validate-data.ts` (w CI) sprawdza: schemat, unikalność `id`, że każdy `substituteId` istnieje,
że `media` ma plik w `assets/exercise-media/`, że każde ćwiczenie z `loadsKnee: true` ma `kneeCue`.

### 6.4 Szablony startowe (tryb konserwatywny kolana — wyłącznie obunóż)

```
FBW A                                       FBW B
A1 Goblet squat (single)     2×10–20        A1 Przysiad z gumą (pod stopami)   2×12–20
A2 Wiosłowanie gumą z kotwicy 2×10–15       A2 Wiosłowanie hantlem jednorącz   2×8–15
B1 RDL hantle (paired)        2×10–20       B1 Pull-through z gumą             2×12–20
B2 Wyciskanie hantli z podłogi 2×8–15       B2 Pompki (guma na plecach = progres) 2×8–15
C1 Glute bridge / hip thrust  2×12–20       C1 Wznosy bokiem (paired)          2×10–15
C2 Deska                      2×30–60 s     C2 Martwy robak                    2×8–12/str.
+ rozgrzewka: rower 5 min, seria rozgrzewkowa gumy przed A2/B1
```

Objętość tygodniowa przy A+B: nogi 4–6, plecy 4, klatka 4, barki 2, core 4 — zgadza się z MEV.

---

## 7. Mechanizmy krytyczne

### 7.1 Trwałość aktywnej sesji

```
start sesji     → INSERT workouts (status='in_progress')          ← natychmiast, przed pierwszym ekranem
zapis serii     → INSERT set_logs                                 ← natychmiast, haptic dopiero po commit
zakończ         → UPDATE status='completed', finished_at, session_rpe
porzuć          → UPDATE status='abandoned' (logi zostają — to nadal dane)
start aplikacji → SELECT ... WHERE status='in_progress'
                  → jeśli jest: karta „Masz niedokończoną sesję z [data]: [wznów] [porzuć]"
                  → jeśli started_at > 12 h temu: automatycznie 'abandoned'
```

Zustand trzyma tylko: id aktywnej sesji, indeks bieżącego ćwiczenia/serii, ostatnio wpisane wartości
(do prefill). Wszystko odtwarzalne z bazy.

### 7.2 Timer przerwy

```
zapis serii → restEndsAt = now + restSec
            → zustand: { restEndsAt }
            → expo-notifications: scheduleNotificationAsync({ trigger: { date: restEndsAt } })
ekran       → co 250 ms: remaining = restEndsAt - now (nie „licznik –1", bo JS zamiera w tle)
powrót z tła→ ten sam wzór, wynik poprawny bez specjalnej obsługi
[+30s]      → restEndsAt += 30 s, przeplanuj notyfikację
[skip] / następna seria → anuluj notyfikację
```

Ekran nie gaśnie (`useKeepAwake()` na trasie aktywnej sesji), więc notyfikacja jest zabezpieczeniem
na wypadek zablokowania telefonu ręcznie.

### 7.3 Granica doby

```ts
// src/domain/time/trainingDate.ts
export const trainingDate = (now: Date, boundaryHour: number) =>
  format(subHours(now, boundaryHour), 'yyyy-MM-dd');
```

Trening o 00:40 przy granicy 4:00 → data poprzedniego dnia. Waga (`body_metrics.date`) używa daty
**kalendarzowej** — ważysz się rano, nie ma dwuznaczności.

### 7.4 Średnia krocząca i trend

`movingAverage(points, 7)` — dla dni bez wpisu brak punktu (nie interpolujemy). Trend: regresja liniowa
na oknie 21 dni, wynik jako kg/tydzień; ukryty, gdy w oknie < 10 punktów. Obie funkcje w `domain/metrics`,
czyste, testowane na sztucznych seriach.

### 7.5 Eksport / import

Plik `homeworkout-backup-YYYY-MM-DD.json`:

```json
{ "schemaVersion": 3, "exportedAt": "...", "app": "homeworkout",
  "tables": { "user_profile": [...], "bands": [...], "workout_templates": [...], "workouts": [...],
              "set_logs": [...], "cardio_logs": [...], "body_metrics": [...], "measurements": [...],
              "daily_logs": [...], "ai_exchanges": [...] } }
```

Ćwiczeń nie eksportujemy (odtwarzane z seeda). Import: walidacja Zod → jeśli `schemaVersion` starszy,
funkcja migrująca JSON → transakcja: wyczyść tabele → wstaw. **Przed importem automatyczny eksport
bieżącego stanu** do folderu aplikacji — na wypadek pomyłki.

Test end-to-end kamienia M5: eksport → odinstaluj → zainstaluj → import → identyczne dane.

### 7.6 Brief dla AI (etap 3, krok 0)

Markdown generowany z tych samych repozytoriów, co ekrany: ostatnie 4 tygodnie sesji w tabeli, objętość
per partia, waga (7d MA) + trend, talia, sygnały (sen, DOMS, RPE), aktualne szablony, `historical_session_count`.
Przycisk „Kopiuj brief" → schowek. Prompt systemowy (cztery bloki z PLAN §6.2) leży w `src/ai/prompts/`
i ma własny przycisk „Kopiuj prompt".

---

## 8. Plan realizacji — kamienie milowe

Estymaty w **wieczorach (~2 h)**. Każdy kamień ma definicję ukończenia (DoD), która jest binarna.
Nie zaczynaj kolejnego, dopóki DoD poprzedniego nie jest spełnione — to jedyna obrona przed §1.7.

### M0 — Środowisko i pusty build (1–2 wieczory) ✅

1. Zainstaluj **Android Studio** → SDK Manager: Android SDK Platform (najnowsze API), Build-Tools,
   Platform-Tools, Command-line Tools.
2. Zainstaluj **JDK 17** (Temurin). Ustaw zmienne (PowerShell, użytkownika):
   ```powershell
   [Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\Program Files\Eclipse Adoptium\jdk-17...', 'User')
   [Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
   # do PATH: %ANDROID_HOME%\platform-tools
   ```
3. Telefon: Opcje programisty → Debugowanie USB. `adb devices` pokazuje urządzenie.
4. `npx create-expo-app@latest HomeWorkout --template blank-typescript` — **bez żadnej biblioteki**.
5. `npx expo run:android` → aplikacja na telefonie.
6. `git init`, pierwszy commit, repo na GitHubie.

**DoD:** „Hello" na Twoim telefonie z lokalnego builda; repozytorium istnieje.

### M1 — Fundament (3–4 wieczory) ✅

1. `expo-router` + pięć zakładek z pustymi ekranami.
2. NativeWind + `npx @react-native-reusables/cli@latest init` + 3 komponenty (Button, Card, Input).
3. `expo-sqlite` + Drizzle: `schema.ts` (§6), `drizzle-kit generate`, `useMigrations` w layoucie.
4. `data/exercises.json` z **5 ćwiczeniami** (nie 60 — na razie chodzi o rurociąg), Zod, seed, lista
   ćwiczeń na ekranie „Więcej → Ćwiczenia" przez `useLiveQuery`.
5. ESLint flat config z regułą granicy domeny; Prettier; `jest-expo` z jednym testem domenowym
   (`trainingDate`).
6. GitHub Actions: `npm ci && npm run lint && npx tsc --noEmit && npm test && npm run validate:data`.

**DoD:** CI zielone; aplikacja pokazuje 5 ćwiczeń z bazy; celowy import `react` w `src/domain` wywala lint.

### M2 — Baza ćwiczeń (2–3 wieczory, głównie praca merytoryczna, nie kod) ✅

1. `scripts/import-media.ts`: kopiuje wskazane obrazy z klonu free-exercise-db do `assets/exercise-media/`.
2. 50–60 ćwiczeń pod Twój sprzęt z pełną taksonomią (§6.3). Wszystkie z `loadsKnee: true` — z `kneeCue`.
3. `validate-data.ts` w CI.
4. Ekran szczegółów ćwiczenia: obraz, cue'y, partie, sprzęt, zamienniki.

**DoD:** walidacja przechodzi; każde ćwiczenie ma obraz i cue'y; przejrzałeś listę i nie ma na niej
niczego, czego nie zrobisz w domu.

### M3 — Aktywna sesja (5–7 wieczorów — najtrudniejszy kamień) ✅

1. `templates.json` (FBW A/B z §6.4), seed, ekran listy szablonów.
2. Start sesji: wybór szablonu → `INSERT workouts` → nawigacja do `workout/active/[id]`.
3. Ekran sesji (§2.3): `SetLogger` (hantel paired/single po drabince, guma+pozycja, powtórzenia, RIR),
   prefill z poprzedniej serii **tego ćwiczenia** (z bazy, nie ze store'a), haptic po zapisie.
4. `RestTimer` (§7.2) + notyfikacja + uprawnienie.
5. Bottom sheet z listą sesji: przejdź / pomiń / zamień (na razie: dowolne z `substituteIds`).
6. Wznowienie po restarcie (§7.1). Podsumowanie: session RPE, notatka, porównanie z poprzednią sesją
   tego szablonu.
7. Szybki log roweru (rozgrzewka / osobna jazda).

**DoD:** pełny trening FBW A zalogowany na prawdziwej sesji; zabicie aplikacji w połowie → po ponownym
otwarciu wznowienie z tego samego miejsca; notyfikacja końca przerwy przychodzi przy zablokowanym ekranie.

### M4 — Ciało i dziennik dnia (3–4 wieczory) ✅

1. Profil: wzrost, płeć, rok urodzenia, granica doby, wysokość siodełka.
2. Waga: wpis (prefill wczorajszej), wykres 60 dni: punkty + linia 7d MA + trend w kg/tydz.
3. Obwody: formularz sześciu pól, wykres talii, wzór Navy → `body_metrics(source='navy')`.
4. Dziennik dnia: trzy suwaki + DOMS per partia (chipy) + notatka; wpis na dziś z ekranu „Dziś".
5. Karta „Dziś" (§10.1): waga + trend, ostatnia sesja „N dni temu", następny szablon (naprzemiennie),
   przycisk startu, niedokończona sesja.
6. Przypomnienia (§10.2): waga codziennie, trening po N dniach; Ustawienia z godzinami, N,
   przełącznikami i „wycisz na 7 dni". Realizacja: seria jednorazowych powiadomień na 14 dni
   naprzód (§0.2).

**DoD:** 7 dni prawdziwych wpisów wagi widocznych na wykresie z poprawną średnią (sprawdzoną ręcznie);
przypomnienie o wadze nie przychodzi w dniu, w którym wpis już jest.

### M5 — Historia, eksport / import (2–3 wieczory) ✅

1. Historia: lista sesji (data, szablon, czas, serie), szczegóły, edycja/usunięcie serii.
2. Eksport do pliku + `expo-sharing`. Import z `expo-document-picker` + walidacja + auto-backup przed.

**DoD:** test z §7.5 przeszedł (odinstalowanie i przywrócenie bez utraty danych).

### ⛔ BRAMKA — dwa tygodnie używania

Nie zaczynaj M6+, dopóki nie przetrenowałeś **≥ 4 sesji i ≥ 14 dni wagi** na tej wersji. Zapisuj, co
irytuje. Napraw to przed pójściem dalej — etap 2 buduje na nawykach z etapu 1.

### M6 — Kalibracja gum (1–2 wieczory) ✅

1. `domain/progression/calibration.ts` + testy (liniowa/kwadratowa, < 4 punkty → null, `maxMeasuredKg`).
2. Kreator: guma → `L0` → kolejne masy → długości → wynik → zapis. Zielona: ekran informuje, że
   kalibracja nie jest możliwa i dlaczego.
3. `estimatedLoadKg` przy zapisie serii; wyświetlanie jako przedział / „> 18 kg" / nic.

**DoD:** trzy gumy skalibrowane; przy czarnej w P2 aplikacja pokazuje sensowny przedział; przy zielonej nie pokazuje kilogramów.

### M7 — Silnik reguł (8–12 wieczorów)

Kolejność wg zależności; każdy moduł = implementacja + testy z SPEC §9 zanim następny.

1. `exercises/screen.ts` (filtr kolana z bramką `loadsKnee`) → `substitute.ts` — zamienniki w sesji
   filtrowane od teraz.
2. `volume/weekly.ts` → wskaźnik objętości na „Dziś".
3. `progression/dumbbell.ts`, `progression/band.ts`, `progression/layoff.ts`.
4. `autoregulation/fatigue.ts`, `deload.ts`, `dayPlanner.ts`.
5. `features/planner`: szablon + historia + dziennik → `SessionPlan` z `reasons`; zapis w `workouts.plan`.
6. Ekran „co dziś": plan z uzasadnieniem (kody → `strings/pl.ts`), akceptacja → start sesji z prefillem
   z planu. Ostrzeżenia: objętość, zmęczenie, propozycja deloadu.
7. `validatePlan` — klamry z SPEC §8.

**DoD:** 100% pokrycia `src/domain`; wznosy bokiem przechodzą filtr, prostowanie nóg nie; sesja
zaproponowana przez silnik po tygodniu z wysokim DOMS nóg nie zawiera przysiadów; po 10-dniowej przerwie
plan powtarza ostatnie obciążenia bez progresji.

### M8 — AI, krok 0 (1–2 wieczory)

1. `ai/brief.ts` + ekran „Trener" z „Kopiuj brief" / „Kopiuj prompt".
2. Miesiąc ręcznego używania z Gemini. Decyzja: czy odpowiedzi są warte integracji.

### M9 — AI, krok 1 (4–6 wieczorów, warunkowo)

1. Cloudflare Worker w TS: `POST /coach` → prompt systemowy z serwera + `@google/genai` z `responseSchema`
   → JSON. Sekret + limit.
2. `ai/client.ts` + schematy Zod; `ai_exchanges`; propozycje planu przez `validatePlan` → akceptacja.
3. Podsumowanie tygodnia automatyczne w niedzielę (przy otwarciu aplikacji, nie w tle).

### M10+ — rozbudowa (wg potrzeby)

Edytor szablonów w aplikacji · zdjęcia progresu · Health Connect · przypomnienia · guardraile
Input/Output · testy red-team promptu · ciemny motyw dopracowany · F-Droid.

---

## 9. Konwencje

- **Język:** kod, nazwy, komentarze, commity — angielski. Teksty UI — polski, wyłącznie w `src/strings/pl.ts`.
- **Commity:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`), małe, jeden temat.
- **Gałęzie:** `main` zawsze buduje; funkcje na gałęziach `feat/…`, PR do siebie z zielonym CI — nawyk,
  który dobrze wygląda w historii repozytorium.
- **Testy:** każdy plik w `src/domain` ma lustrzany test. Komponenty: testy tylko dla `SetLogger`
  i `RestTimer` (logika UI), reszta to kompozycja.
- **Typy:** żadnego `any`; typy rzędów bazy (`typeof workouts.$inferSelect`) nie wyciekają poza
  `db/repositories` — repozytoria zwracają typy domenowe. *Stan faktyczny po M6:* `WorkoutRow`,
  `SetLogRow`, `BandRow`, `ProfileRow`, `CardioLogRow` są eksportowane i używane w `app/`
  (historia, edycja serii, gumy). Świadomy dług: przy jednym użytkowniku i płaskich tabelach typ
  wiersza *jest* typem domenowym; mapowanie 1:1 dodałoby kod bez informacji. Wraca na stół, gdy
  pojawi się drugi konsument (M9 AI, sync) albo gdy schemat zacznie się rozjeżdżać z tym, co ekrany
  chcą widzieć.
- **Nazwy plików:** `kebab-case.ts`, komponenty `PascalCase.tsx`.
- **README:** czym jest projekt, zrzuty ekranu, architektura (ten podział), jak uruchomić, status.
  Pisany od M1, aktualizowany przy każdym kamieniu.

---

## 10. Doprecyzowania — rozstrzygnięte (2026-09-10)

| # | Pytanie | Decyzja | Skutek w implementacji |
|---|---|---|---|
| 1 | Zakres dziennika dnia | **tylko trening i samopoczucie** | brak tabeli `activities`; model z §6 bez zmian |
| 2 | Rytm tygodnia | **kroczący** | brak pojęcia „zaległej sesji"; silnik i karta „Dziś" patrzą wyłącznie na odstęp od ostatniej sesji (§10.1) |
| 3 | Szablony na etap 1 | **dwa gotowe FBW A/B**, edycja przez `templates.json` | edytor w aplikacji przesunięty do M10 |
| 4 | Kolejność A/B | **naprzemienna**, niezależna od dnia tygodnia | `nextTemplate = last.template === 'A' ? 'B' : 'A'`; przy porzuconej sesji (< 50% serii) powtórz ten sam szablon |
| 5 | Przypomnienia | **tak** | dwa typy, konfigurowalne w Ustawieniach (§10.2); realizacja w M4 |

### 10.1 Karta „Dziś" w rytmie kroczącym

```
Ostatnia sesja: FBW A · 3 dni temu           ← zamiast „zaległe: 1"
Następna: FBW B                              ← naprzemiennie
[ Rozpocznij FBW B ]  [ inny szablon ▾ ]
```

Sygnał czasu jest neutralny: „3 dni temu", nigdy „spóźniony o…". Etap 2 dodaje pod spodem uzasadnienie
silnika („dziś lżej: sen 5 h") i ewentualną sugestię „po 10 dniach przerwy powtarzamy ostatnie obciążenia".

### 10.2 Przypomnienia (M4, `expo-notifications`, lokalne)

| Typ | Wyzwalacz | Domyślnie | Konfiguracja |
|---|---|---|---|
| **Waga** | codziennie o stałej godzinie | 07:00 | godzina, wł./wył.; **nie wysyłaj, jeśli dziś już jest wpis** |
| **Trening** | gdy od ostatniej sesji minęło ≥ N dni, o stałej godzinie | N = 3, 17:00 | N, godzina, wł./wył. |

Mechanika (oba typy, po review M4–M6): przy każdym otwarciu aplikacji, wpisie wagi, zakończonej lub
usuniętej sesji, imporcie i zmianie ustawień — anuluj wszystkie zaplanowane pod prefiksem, zaplanuj
**serię jednorazowych** powiadomień na 14 dni naprzód (`domain/reminders/schedule.ts`, czyste; `lib/reminders.ts`
woła `expo-notifications`). Waga: jedno na dzień o wybranej godzinie, dzisiejsze pomijane, gdy wpis już jest.
Trening: od `lastSessionDate + N` przez 14 dni, każde z własnym „X dni temu". Dni wyciszone są pomijane,
więc tydzień ciszy kończy się sam. Seria zamiast pojedynczego triggera, bo pojedynczy umiera po odpaleniu:
kto nie otworzył aplikacji następnego dnia, nie dostawał już nic.
Treść neutralna: *„Ostatni trening był 3 dni temu. Kolejna sesja czeka, kiedy będziesz gotowy."*

Oba przypomnienia mają jeden przełącznik „wycisz na 7 dni" — na tygodnie, o których pisałeś, że
treningu prawie nie będzie. Aplikacja ma o tym wiedzieć, nie dobijać.

Wszystko jest rozstrzygnięte. Start od M0.
