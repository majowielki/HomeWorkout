# Do zrobienia (stan na 2026-10-08 wieczór)

Wdrożone: Worker v5 (kontrakt 5), APK z głosem, zapasem AI, rozgrzewką głosową i trybami „hej trener” / „cały czas”. Plan głosu: [GLOS.md](GLOS.md).

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
- Później: powód niedobicia serii (`shortfall`) dla trenera (kontrakt v6 + nowe wersje promptów); komendy rozgrzewki w zapasie AI (też kontrakt v6).
