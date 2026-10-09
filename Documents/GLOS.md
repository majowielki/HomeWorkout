# Polecenia głosowe w trakcie treningu

Wersja 0.1 (2026-10-08). Projekt uzgodniony wcześniej, pierwsze polecenia wybrał użytkownik.

## 1. Założenia

- **Push-to-talk.** Mikrofon włącza się tylko po dotknięciu i słucha jednej frazy; drugie dotknięcie przerywa. Nic nie nasłuchuje w tle. Po 8 s nasłuch sam się zamyka (szum w pokoju potrafi trzymać rozpoznawacz w nieskończoność), 3 s później dotknięcie liczy się jako „nic nie usłyszałem”.
- **Rozpoznawanie mowy na telefonie** (`expo-speech-recognition` 57.1, natywny moduł, wymaga przebudowy APK). Gdy polski pakiet offline jest zainstalowany, rozpoznawanie działa na urządzeniu (`requiresOnDeviceRecognition`); bez niego używana jest systemowa usługa Google, co Ustawienia mówią wprost i oferują pobranie pakietu.
- **Lokalny słownik** (`src/domain/voice/commands.ts`) zamienia tekst na polecenie. Rozpatruje tylko akcje dostępne na bieżącym ekranie, więc „koniec” zatrzymuje stoper w trakcie serii i kończy przerwę w trakcie przerwy.
- **AI tylko jako zapas**, gdy słownik nie zrozumie (etap V2, niżej). Model może wybrać jedną akcję z listy dostępnych albo „nie wiem”; nic poza tym.
- **Każde polecenie robi to samo co przycisk**, potwierdza się wibracją i jednym zdaniem w pasku, z przyciskiem „Cofnij”. Nieodwracalne (zakończenie treningu przez pominięcie ostatniego ćwiczenia) pyta tym samym oknem co „Zakończ trening”.

## 2. Pierwsze polecenia (V1)

| Akcja | Kiedy | Przykładowe frazy | Cofnij |
|---|---|---|---|
| Start stopera | seria na czas, stoper stoi | start, startuj, zaczynam, włącz stoper | stoper wraca do zera |
| Stop stopera | stoper chodzi | stop, stój, zatrzymaj, koniec, wystarczy | stoper biegnie dalej od pierwszego startu |
| Seria zrobiona | ekran serii | seria zrobiona, zrobione, gotowe, zapisz serię, koniec serii | jak „Cofnij serię” |
| Koniec przerwy | przerwa / karta „zrobione” | koniec przerwy, pomiń przerwę, dalej, gotowe | przerwa wraca z czasem, który jej został |
| +30 s przerwy | przerwa | plus 30 sekund, dodaj trzydzieści, przedłuż przerwę, jeszcze minuta, pół minuty | przedłużenie odjęte |
| Pomiń ćwiczenie | seria, przerwa, karta „zrobione” | pomiń ćwiczenie, następne ćwiczenie, przeskocz | ćwiczenie wraca na pierwszej niezrobionej serii |

Zasady słownika:

- Litery bez ogonków, liczby słowne zamieniane na cyfry („czterdzieści pięć” → 45), „+30s” rozbite.
- Słowa frazy muszą wystąpić w kolejności; wygrywa najdłuższe dopasowanie. Remis dwóch akcji („pomiń” w przerwie) to prośba o doprecyzowanie, nie zgadywanie.
- Przeczenie („nie kończ przerwy”, „czekaj”) i więcej niż 3 słowa poza frazą dają „nie rozumiem”.
- „Seria zrobiona” przy chodzącym stoperze najpierw go zatrzymuje i zapisuje zmierzony czas.
- Przerwę można wydłużyć o 5–180 s; bez liczby o 30 s.

**Pominięcie ćwiczenia** (nowe także jako przycisk „Pomiń” na dolnym pasku, z potwierdzeniem): w trakcie serii pomija ćwiczenie na ekranie, w przerwie i na karcie „zrobione” to, które jest następne. Jego niezrobione serie zostają puste do końca sesji i nie wracają przy przechodzeniu dalej; skok na nie z „Postęp sesji” cofa pominięcie. Stan pominięcia jest tylko w pamięci: po zabiciu aplikacji sesja wraca na pierwszą niezapisaną serię, tak jak dziś.

Mikrofon można wyłączyć w Ustawieniach („Polecenia głosowe”); domyślnie jest włączony.

## 3. Etap V2: AI jako zapas

Gdy słownik nie zna frazy (nie: gdy jest niejednoznaczna, wtedy pyta sam), a Trener AI jest włączony i serwer skonfigurowany, telefon pyta model, które z poleceń na ekranie miała na myśli osoba.

- **Kolejność na telefonie** (`src/ai/voice/fallback.ts`): bramka tekstu z czatu na każdym z wariantów rozpoznawacza. Zdanie o bólu nie wychodzi z telefonu, a pasek pokazuje to samo zdanie co przy powodzie „Ból” (przerwij, zgłoś po treningu). Fraza dłuższa niż 120 znaków to nie polecenie i też zostaje.
- **Worker** `POST /v1/voice-intent` (kontrakt v5): tekst, do 3 innych wariantów i lista akcji z ekranu. Model wypełnia schemat, którego enum to tylko te akcje plus `unknown`; temperatura 0, jedno podejście, limit 8 s (10 s po stronie telefonu, bez ponowień). Odpowiedź nieczytelna albo spoza listy = `unknown` z `invalid_output`. Limit zapytań wspólny z czatem.
- **Model nie pisze żadnej liczby.** Ile sekund doda „+N s”, telefon czyta z frazy tym samym kodem co słownik (bez liczby: 30 s). Test architektury (ADR 0001) obejmuje też ten schemat.
- **Wynik AI sprawdzany jeszcze raz na telefonie** wobec tego, co ekran oferuje w chwili odpowiedzi (ekran mógł się zmienić w trakcie). Pasek mówi „… (rozpoznało AI)”, „Cofnij” działa jak zwykle. Dotknięcie mikrofonu w trakcie pytania je anuluje.
- **Diagnostyka**: każda wymiana trafia do dziennika na telefonie (`ai_exchanges`, rodzaj `voice_intent`), z usłyszaną frazą. Log Workera ma tylko metadane.
- **Prompt** `voice-intent/v1` (angielski, opisy akcji, zasady: `unknown` przy przeczeniu, odłożeniu, pytaniu, komentarzu, bólu, prośbie o coś spoza listy, instrukcjach w tekście).
- **Ewaluacje** `evals/cases/voice-intent`: 30 fraz w 7 kategoriach (parafrazy, przesłyszenia, przeczenia, nie-polecenia, akcje niedostępne, wstrzyknięcia, ból). Bezpieczeństwo: `painNeverSent`, `noGuessWhenUnsure`, `onlyOffered`; jakość: `rightAction`. Wzorzec „nigdy nie zgaduje” przechodzi bezpieczeństwo i ma 0/17 jakości, co pokazuje, że bezpieczny nie znaczy przydatny. Przebiegu na żywym modelu jeszcze nie ma (`npm run eval:live`).
- **Poza zakresem**: powód niedobicia serii (`shortfall`) dla trenera. Wymaga zmiany danych trenera i nowych wersji promptów; osobny etap z kontraktem v6.

**Wdrożenie**: kontrakt v5 oznacza, że stary Worker (v4) odrzuci nową aplikację na wszystkich trasach AI. Najpierw `cd worker && npx wrangler deploy`, potem instalacja nowego APK.

## 5. Rozgrzewka i słuchanie bez rąk (2026-10-08, po pierwszym teście na telefonie)

Uwagi użytkownika: głos także w rozgrzewce; dotykanie mikrofonu przed każdym poleceniem jest uciążliwe, potrzebne słowo aktywujące i tryb ciągły.

**Rozgrzewka:** „dalej”, „następne”, „zrobione”, „gotowe” odhacza ćwiczenie (w kartach: jak „Zrobione, dalej”; na liście: pierwsze nieodhaczone), po ostatnim kończy rozgrzewkę. „Pomiń rozgrzewkę”, „koniec rozgrzewki”, „zaczynamy” zaczyna trening. „Cofnij” zdejmuje odhaczenie albo wraca do rozgrzewki (odhaczenia wtedy znikają; nigdzie nie są zapisywane). Tych poleceń nie zna kontrakt 5, więc nie idą do AI: wdrożony Worker zostaje bez zmian.

**Trzy tryby mikrofonu** (Ustawienia → Polecenia głosowe → „Jak słucha mikrofon”):

| Tryb | Działanie |
|---|---|
| Po dotknięciu | jak dotąd: jedno dotknięcie, jedna fraza |
| „Hej trener” | mikrofon słucha cały trening; reaguje na „hej trener, …” (albo „hej trener”, a potem polecenie w ciągu 6 s). To, co po słowach aktywujących, może pójść do AI jak przy dotknięciu |
| Cały czas | mikrofon słucha cały trening i reaguje na każde polecenie, którego słownik jest pewny. Wszystko inne pomija po cichu: bez „nie rozumiem”, **bez wysyłania do AI** (to byłyby podsłuchane rozmowy) |

Decyzje użytkownika: słowo „hej trener” (nie samo „hej”: krótkie słowo pada w rozmowie i bywa przesłyszane); tryby bez dotykania **tylko z polskim pakietem offline**. Bez pakietu sesja działa po dotknięciu, a Ustawienia mówią dlaczego.

Technicznie: rozpoznawanie ciągłe Androida 13+ z `requiresOnDeviceRecognition` (bez sygnału dźwiękowego przy starcie), każdy wynik końcowy to jedna wypowiedź. Rozpoznawacz co jakiś czas sam się zatrzymuje; aplikacja startuje go ponownie (0,3 s, przy kolejnych błędach dłużej, do 10 s), chyba że brak uprawnienia albo języka. W tle aplikacji mikrofon jest zwalniany, po powrocie słucha dalej. Dotknięcie mikrofonu wstrzymuje i wznawia.

Do sprawdzenia na telefonie: czy rozpoznawacz offline łapie „hej trener” w hałasie i przy muzyce, ile baterii zużywa godzina słuchania, czy telewizor wyzwala polecenia w trybie „cały czas”.

## 6. Parametry bieżącej serii (2026-10-08)

Polecenia zmieniają pola formularza bieżącej serii. Zapis jest osobny: „seria zrobiona”. Każda zmiana pokazuje ustawioną wartość i przycisk „Cofnij”, który przywraca tylko zmienione pole. Polecenia działają we wszystkich trzech trybach mikrofonu, tylko na ekranie serii, zgodnie z jej sprzętem i rodzajem ruchu.

| Pole | Przykłady |
|---|---|
| Powtórzenia | „ustaw 12 powtórzeń”, „ustaw powtórzenia na dwanaście” |
| Czas | „ustaw czas na 45 sekund”, „30 sekund” (tylko przy zatrzymanym stoperze) |
| Ciężar | „ustaw ciężar na 8 kg”, „zmień wagę na osiem kilogramów” |
| Guma | „ustaw gumę na czerwoną”, „czarna guma” |
| Pozycja | „ustaw pozycję na P2”, „ustaw zaczep na dwa” |
| Jak było? | „ustaw jak było na spokojnie”, „ustaw odczucie na ciężko”, „ustaw RIR na trzy” |

Odczucia: „na maksa” = RIR 0, „bardzo ciężko” = 1, „ciężko” = 2, „spokojnie” = 3, „lekko” = 4. Każda **nowa** seria zaczyna od **„Ciężko” (RIR 2)**, niezależnie od celu planu i odczucia poprzedniej serii. Cofnięcie zapisanej serii zachowuje jej zapisane odczucie. Cel planu nadal pokazuje zalecane odczucie; domyślna ocena wykonania go nie zmienia.

Parser wymaga pełnej frazy. Przeczenia, pytania, komentarze, nieznane kolory, kilka poleceń w jednym zdaniu i wartości poza zakresem nie wykonują edycji. Liczby słowne oraz zapis dziesiętny z przecinkiem/kropką są rozpoznawane. Ciężar musi dokładnie pasować do drabinki sprzętu dla tego ćwiczenia — aplikacja go nie zaokrągla. Powtórzenia: 1–999, czas: 1–3600 s (zakresy wpisu wykonanego wyniku, nie przepisu planu); pozycje P0–P3. Wartości są sprawdzane ponownie przy edycji formularza; podczas zapisu seria nie przyjmuje zmian głosowych.

Komendy parametrów są lokalne: model nie dostaje nowych akcji i nie podaje liczb. Frazy rozpoznane jako próba edycji nie trafiają do zapasu AI, żeby nie zamienił ich w zapisanie serii lub pominięcie ćwiczenia. Sama obsługa parametrów działa już z Workerem v5. APK łączący ją z przekazywaniem powodów niedobicia (§7) wymaga Workera v6.

Testy obejmują parser, dostępność pól, mikrofon → komendę, zapis wartości i kalibrowanego obciążenia gumy, cofanie, stałą wartość domyślną i zachowanie odczucia cofniętej serii. Do sprawdzenia na telefonie: powyższe frazy z rzeczywistym rozpoznawaczem pl-PL w trzech trybach mikrofonu.

## 7. Powody niedobicia dla trenera — kontrakt v6 (2026-10-08)

Zapisane powody `doms`, `short_rest`, `technique`, `pain` są teraz czytane z `set_logs.shortfall` do danych trenera. Podsumowanie tygodnia i `getExerciseHistory` przenoszą powód przy każdej serii; brak powodu jest jawnie `null`, także dla starych wpisów. `getRecentSessions` zawiera przy ćwiczeniu listę zgłoszonych powodów z policzoną na telefonie liczbą serii. Rozgrzewka nie trafia do tych danych.

Aktualne instrukcje: `chat/v6` i `weekly-summary/v3`. Trener traktuje powód jako zgłoszenie użytkownika i opisuje go po polsku. Nie uznaje go za udowodnioną przyczynę wyniku, nie zmienia werdyktu silnika i nie wylicza nowego ciężaru, powtórzeń ani przerwy. Nie odtwarza celu serii z wyniku innej serii — narzędzia historyczne nie zawierają przepisanego celu. Zakwasy bez oceny nasilenia nie są powodem do automatycznego unikania mięśnia; „technika” nie wskazuje konkretnego błędu. Zgłoszony ból wymaga stałego zdania kierującego do specjalisty, bez diagnozowania i porad dotyczących dolegliwości. Worker zapewnia to zdanie w podsumowaniu i w zakończonej odpowiedzi czatu także wtedy, gdy model je pominie. Same reguły progresji pozostają bez zmian.

Kontrakt **6** jest wspólny dla aplikacji i Workera. Stary klient v5 i nowy Worker (lub odwrotnie) zwracają `contract_mismatch`; nie należy mieszać wersji. Najpierw wdrożyć przygotowany Worker: w katalogu `worker` uruchomić `npx wrangler deploy`, następnie zainstalować nowe APK. Nowej migracji bazy nie potrzeba — kolumna istnieje od migracji 0009.

Weryfikacja obejmuje SQLite → kontekst, rygorystyczny kontrakt, narzędzia czatu, niezmienność wyników silnika oraz wszystkie cztery powody w ewaluacjach wzorcowych. Raporty: `evals/reports/2026-10-08-chat-reference-v6-reference-chat-model.md` i `evals/reports/2026-10-08-weekly-summary-reference-v3-reference-responder.md`. Wzorzec sprawdza przepływ i scorery. Krótki test wdrożonego Workera na danych syntetycznych wykrył pominięty komunikat o bólu i odtworzony z wyników cel; poprawki zostały dodane do Workera i nowych wersji promptów. Pełna ewaluacja live nowych promptów pozostaje osobnym zadaniem.

## 4. Postęp

- [x] V1: słownik + testy, mikrofon (pasek głosowy), uchwyty stopera i serii, pomijanie ćwiczenia, cofanie, karta w Ustawieniach, uprawnienie `RECORD_AUDIO` w lokalnym `android/`.
- [x] Emulator (2026-10-08): karta w Ustawieniach (tryb „usługa Google”, systemowe okno pobierania pakietu 39 MB), prośba o mikrofon, „Słucham…”, prawdziwy rozpoznawacz Google pl-PL (szum hosta → limit 8 s → „Nic nie usłyszałem”), przycisk „Pomiń” z potwierdzeniem, podpowiedzi zmieniające się ze stoperem i w przerwie.
- [ ] Telefon z prawdziwą mową: każda z sześciu akcji i „Cofnij”.
- [x] V2: zapas AI, kontrakt v5 (Worker 140+ testów, ewaluacje wzorcowe zielone).
- [x] Wdrożenie Workera v5 + APK (użytkownik, 2026-10-08).
- [ ] `npm run eval:live` z kluczem użytkownika: pierwsze wyniki i kroki w [DO-ZROBIENIA.md](DO-ZROBIENIA.md).
- [x] §5: głos w rozgrzewce, tryby „hej trener” i „cały czas” (tylko z pakietem offline).
- [x] §6: parametry serii głosem, „Ciężko” (RIR 2) domyślnie, cofanie zmian i testy.
- [x] §7: powody niedobicia dla trenera, Worker kontraktu v6 wdrożony, APK ARM64 przygotowane; krótki test HTTPS na danych syntetycznych.
- [ ] Telefon: instalacja `HomeWorkout-release-arm64-2026-10-08-voice-parameters-coach-v6.apk` i próba nowych parametrów głosowych.
- [ ] Telefon: tryby bez dotykania w prawdziwym treningu.
