# Katalog YMove po uporządkowaniu

Stan: 2026-10-07. Katalog aplikacji: **151 ćwiczeń, wersja 4** (wcześniej 90).

- Dodano **61 ćwiczeń** z polskimi nazwami, wskazówkami, instrukcjami, filmami i mapami mięśni.
- Podłączono **130 kompletów materiałów**, każdy z pełnym polskim tłumaczeniem kroków i wskazówek.
- Odłożono **68 kompletów** do archiwum, bez kasowania plików. Każdy ma zapisany powód.
- Przeniesiono **414 plików**; zachowanie zawartości sprawdzono sumami SHA-256 w `archive/relocation.json`.
- Wszystkie 30 ćwiczeń z dawnego `new/` były już w katalogu. Nie dodano ich ponownie.

## Foldery i podgląd

Cała baza pozostaje w `assets/ymove-trial/`:

```text
ready/
  videos/<exercise-id>.mp4
  body-map/<exercise-id>.svg
  mapping.json                  pełne metadane, źródło i pierwotny klucz
  translations.json             polskie instrukcje i wskazówki
  index.html                    galeria ćwiczeń podłączonych do aplikacji
archive/
  videos/<source>-<key>.mp4
  body-map/<source>-<key>.svg
  exercises.json                pełne metadane oraz powód odłożenia
  originals/                    pierwotne JSON-y, tłumaczenia i galeria kandydatów
  relocation.json               drogi przeniesienia i sumy SHA-256
  index.html                    działająca galeria materiałów archiwalnych
selection.json                  decyzja dla każdego ze 198 rekordów źródłowych
```

Otwórz [galerię podłączonych ćwiczeń](../assets/ymove-trial/ready/index.html) lub
[galerię archiwum](../assets/ymove-trial/archive/index.html). Działają lokalnie, bez serwera;
filmy nie uruchamiają się automatycznie. Pierwotna galeria kandydatów jest zachowana jako
materiał historyczny; po przeniesieniu filmów do podglądu służą nowe galerie.

## Zasady wyboru

Selekcja opiera się na opisach i instrukcjach źródłowych, wyposażeniu z `src/domain/inventory.ts`
i ograniczeniach zapisanych w projekcie. Nie oznacza indywidualnej oceny wszystkich ruchów przez fizjoterapeutę.
Sprzeczne rekordy oraz warianty budzące wątpliwość przy ograniczeniach kolana odłożono do archiwum.
Powody odłożenia odróżniają brak sprzętu, duplikat, niezgodny opis i potrzebę oceny ruchu.

Hantle regulowane z talerzami nie zastępują stabilnych hantli sześciokątnych w podporach.
Krzesło, ściana, kanapa i dotychczasowy stopień są domowymi podparciami; nie przyjęto
posiadania ławki skośnej, sztangi, wyciągu, BOSU ani rollera.

Mini band dodano do modelu wyposażenia na życzenie użytkownika. Dodane warianty to
unoszenie ramion oraz ewersja stopy. Są ćwiczeniami mobilności ze stałym lekkim oporem:
aplikacja zapisuje liczbę powtórzeń lub czas, nie wybiera kolorów długich gum i nie przypisuje
mini band ich kalibracji w kilogramach. Pozostałe warianty mini band pozostają w archiwum
z przyczyn związanych z ruchem lub obciążeniem kolana, a nie brakiem sprzętu.

Rozciąganie łydki przy ścianie jest przypisane do pozycji jednonóż z podparciem i nie pojawia
się w planach w trybie konserwatywnym, przed zgodą fizjoterapeuty. Dotychczasowy filtr
i wykluczenia istniejących ćwiczeń zachowano.

## Poprawione dopasowania

- `band-row` otrzymał film wiosłowania stojąc z kotwicy. Dotychczasowy film w siadzie
  jest osobnym ćwiczeniem `seated-band-row`; logi istniejącego ćwiczenia zachowują swoje ID.
- Film z mini band nad kolanami odłączono od `band-squat`, którego katalog opisuje długą
  gumę pod stopami.
- Odłączono filmy na ławce przypisane do `db-floor-flyes` i `db-pullover` na macie.
- Odłączono materiał siedzący przypisany do `db-shoulder-press` stojąc oraz rekord
  `db-lying-triceps-extension` ze sprzeczną nazwą i instrukcjami.
- Materiały do trwale wykluczonych ćwiczeń kolana trafiły do archiwum.

Same istniejące ćwiczenia i ich ID pozostały w katalogu. **21 ćwiczeń nie ma filmu YMove**;
korzystają z dotychczasowych zdjęć lub ikony zastępczej. Wszystkie nowe ćwiczenia mają filmy.

## Integracja i odtwarzanie

`data/exercises.json` ma wersję 4, `data/slots.json` wersję 3. Każde nowe ćwiczenie ma dokładnie
jeden slot planera; dodano potrzebne zakresy czasu i obciążenia startowe. Przy następnym
uruchomieniu aplikacji istniejący seed zaktualizuje katalog w SQLite, zachowując historię serii.

```powershell
npm run media:ymove          # generuje statyczne odwołania do ready/
npm run media:ymove:preview  # odtwarza obie galerie
npm run validate:data       # sprawdza katalog, zamienniki, szablony i sloty
```

Importer wymaga kompletu film + SVG + polskie tłumaczenie dla każdego rekordu `ready/`.
Przy błędzie zachowuje poprzedni wygenerowany moduł. `archive/` nie jest importowany.
Dla dawnych kopii bazy bez `ready/` importer nadal obsługuje `matched/` i `new/`.

`npm run media:ymove:organize` zastosował lokalny `selection.json` jednorazowo. Ponowne
wywołanie przy istniejących `ready/` lub `archive/` zatrzymuje się przed przenoszeniem plików.
Licencjonowane materiały i wygenerowany moduł pozostają objęte istniejącym `.gitignore`.
