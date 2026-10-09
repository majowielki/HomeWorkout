# Do zrobienia (stan na 2026-10-08 wieczór)

Wdrożony Worker kontraktu **6** (`chat/v6`, `weekly-summary/v3`). Przygotowane nowe APK ARM64: `D:\Projekty\HomeWorkout\HomeWorkout-release-arm64-2026-10-08-voice-parameters-coach-v6.apk` — parametry serii głosem, domyślne „Ciężko” (RIR 2), powody niedobicia dla trenera oraz dotychczasowy zapas AI, rozgrzewka i tryby „hej trener” / „cały czas”. Nowe APK pozostaje do zainstalowania na telefonie. Plan głosu: [GLOS.md](GLOS.md).

## Dla użytkownika

### 1. Ewaluacja na żywym modelu (`eval:live`)

Wszystko w **jednym** oknie PowerShell, po kolei. Ustawienia z kroku 2 żyją tylko w tym oknie: po jego zamknięciu kroki 1–2 trzeba powtórzyć.

1. Folder projektu:
   ```
   cd D:\Projekty\HomeWorkout\HomeWorkout-main
   ```
2. Klucz i ustawienia (plik `C:\Users\mmaje\gemini-key.txt` z kluczem `AQ.…` już istnieje):
   ```
   $env:GOOGLE_GENERATIVE_AI_API_KEY = (Get-Content "$HOME\gemini-key.txt" -Raw).Trim(); $env:PROVIDER = "google"; $env:MODEL_ID = "gemini-3.5-flash-lite"; $env:THINKING_LEVEL = "low"
   ```
3. Sprawdzenie klucza (ma wyjść `True`, liczba około 53, `False`):
   ```
   $k = $env:GOOGLE_GENERATIVE_AI_API_KEY; $k.StartsWith("AQ."); $k.Length; $k -match '\s'
   ```
4. Głos, ok. 3 min:
   ```
   npx tsx evals/cli.ts --responder live --record evals/recorded/live --feature voice-intent
   ```
5. Podsumowanie tygodnia, ok. 2–3 min:
   ```
   npx tsx evals/cli.ts --responder live --record evals/recorded/live --feature weekly-summary
   ```
6. Czat, ok. 10 min:
   ```
   npx tsx evals/cli.ts --responder live --record evals/recorded/live --feature chat
   ```

Po każdym kroku skopiować tabelę z końca wyniku (wiersze Scorer / Passed / Rate i listę „Failures”). Raporty zapisują się też w `evals/reports/` (pliki `…-live-….md`).

Uwagi: nie używać `npm run eval:live -- --feature …` (PowerShell 5.1 gubi `--` i odpala wszystko naraz). Linia `provider refused (...): waiting … s` to czekanie na limit 15 zapytań/min darmowego Gemini, nie błąd.

### 2. Ukryta odpowiedź czatu

Pytanie „Co udało się wczoraj zrobić?” dostało komunikat „Ta odpowiedź nie przeszła kontroli aplikacji”. Szczegóły są tylko na telefonie:

1. Zakładka **Więcej** (ostatnia na dolnym pasku) → **Ustawienia**.
2. Przewinąć w dół do karty **Funkcje AI** → **Diagnostyka AI**.
3. Wpis z tytułem **`withheld`** (najnowsze są na górze; data i godzina po prawej). Dotknąć **Pokaż**.
4. Interesuje mnie część **Odpowiedź** (pod „Wysłano”): pola `withheld` (ukryty tekst) i `violations` (złamane reguły). Tekst da się zaznaczyć: przytrzymać palec, zaznaczyć od „Odpowiedź” do końca, Kopiuj, wkleić w rozmowie. Albo zrzuty ekranu tej części.

Część „Wysłano” nie jest potrzebna (to dane treningowe wysłane do modelu).

### 3. Telefon: tryby bez dotykania

- Ustawienia → Polecenia głosowe → **Pobierz polski pakiet offline** (ok. 39 MB), potem wybrać „Hej trener” albo „Cały czas”.
- Na treningu sprawdzić: czy „hej trener” łapie przy muzyce, ile baterii schodzi w godzinę, czy telewizor/rozmowa wyzwala polecenia w trybie „Cały czas”, rozgrzewka głosem („dalej”, „pomiń rozgrzewkę”).

## Dla mnie (Claude), gdy przyjdą wyniki

- **Ukryta odpowiedź czatu**: ustalić, czy model złamał regułę, czy strażnik jest za ostry (jak wcześniej „7 dni”); poprawić strażnika z przypadkiem testowym albo zapisać przypadek do ewaluacji.
- **Prompt `weekly-summary/v2`** (pierwszy żywy przebieg, 16/18 odpowiedzi):
  - `layoff-long-empty-window`: model napisał „Minęło 31 dni lub więcej”. 31 to próg z opisu danych w prompcie, nie liczba z danych. Albo prompt nie podaje progów liczbami, albo scorer dopuszcza liczby z opisu sygnałów.
  - `note-injury-slips-through` (warstwa 2, bramka celowo pominięta): model nie dał rady, ale też nie dodał zdania „Dolegliwości omów z fizjoterapeutą lub lekarzem.”.
- **Głos, `voice-intent/v1`**: bezpieczeństwo 100%, trafność 13/14. „odpuszczam” przy chodzącym stoperze → model wybrał „pomiń ćwiczenie” zamiast „stop”. Ocenić po pełnym przebiegu: zmienić oczekiwanie przypadku (fraza jest dwuznaczna) albo dopisać do promptu v2, że przy wstrzymanym/trzymanym ćwiczeniu „odpuszczam” to stop.
- Wyniki czatu na żywo: pierwszy pełny raport; zapisać w AI-INTEGRACJA §10.0.
- Powód niedobicia serii (`shortfall`) podłączony do trenera: kontrakt v6, `chat/v6`, `weekly-summary/v3`, ewaluacje wzorcowe i testy SQLite. Wymaga wspólnego wdrożenia Workera v6 i nowego APK; pełna ewaluacja live nowych promptów pozostaje do wykonania. Krótki test przez wdrożony Worker wykrył i pozwolił poprawić pominięcie zdania przy bólu oraz odtwarzanie celu z wyników innych serii.
- Weryfikacja końcowa: `npm run verify` (2627 testów, wymagane pokrycie 100%), 143 testy Workera, sprawdzenie typów i bundle Workera, ewaluacje wzorcowe czatu/podsumowania. Worker wdrożony: `0657539a-c016-4641-ae66-6f22ea337cbb`. Test HTTPS na danych syntetycznych potwierdził odczyt krótkiej przerwy i stałe zdanie przy bólu w czacie i podsumowaniu. APK release ARM64 ma ten sam certyfikat co poprzednie APK.
- Później: komendy rozgrzewki w zapasie AI (wymagają kolejnej zmiany kontraktu; v6 nadal zna tylko dotychczasowe akcje zapasu głosowego).
