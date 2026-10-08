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

## 3. Etap V2: AI jako zapas (do zrobienia)

- Endpoint Workera `POST /v1/voice-intent`: wejście = transkrypcja (już po bramce tekstu z czatu: tekst medyczny nie wychodzi z telefonu) + lista dostępnych akcji; wyjście = `z.enum([...dostępne, 'unknown'])` i opcjonalnie liczba sekund dla „+N s”. Bez pól na obciążenie (ADR 0001).
- Kontrakt v5, więc APK i Worker idą razem. W tym samym kontrakcie można odsłonić trenerowi powód niedobicia serii (`shortfall`), zgodnie z notatką z etapu skali odczuć.
- Działa tylko przy włączonym przełączniku AI; bez sieci albo przy błędzie pasek mówi „nie rozumiem”, jak dziś.
- Ewaluacje: przypadki fraz spoza słownika z oczekiwaną akcją albo `unknown`, w tym przeczenia i frazy, których model nie powinien zgadywać.

## 4. Postęp

- [x] V1: słownik + testy, mikrofon (pasek głosowy), uchwyty stopera i serii, pomijanie ćwiczenia, cofanie, karta w Ustawieniach, uprawnienie `RECORD_AUDIO` w lokalnym `android/`.
- [x] Emulator (2026-10-08): karta w Ustawieniach (tryb „usługa Google”, systemowe okno pobierania pakietu 39 MB), prośba o mikrofon, „Słucham…”, prawdziwy rozpoznawacz Google pl-PL (szum hosta → limit 8 s → „Nic nie usłyszałem”), przycisk „Pomiń” z potwierdzeniem, podpowiedzi zmieniające się ze stoperem i w przerwie.
- [ ] Telefon z prawdziwą mową: każda z sześciu akcji i „Cofnij”.
- [ ] V2: zapas AI, kontrakt v5.
