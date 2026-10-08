# Plan: tydzień do przodu, kalendarz i poprawki po pierwszej pełnej sesji

> Wersja 0.2 · 2026-10-07 · status: **zaakceptowany** (decyzje w §5), refaktor silnika w §3.9.
> Źródło: uwagi użytkownika po pierwszej pełnej sesji (8 punktów) + przegląd kodu.
> Zasady pracy bez zmian: jedna gałąź na etap, `npm run verify` na zielono, lokalny merge `--no-ff`
> do `main`, bez pusha; ekran sprawdzony na emulatorze (z 3-przyciskową nawigacją) przed „zrobione”.

---

## 0. Streszczenie

Dwa strumienie pracy:

- **Q — szybkie poprawki sesji** (punkty 2–8). Małe, niezależne, do sprawdzenia już na następnym
  treningu. Robimy je **najpierw**.
- **E — silnik i kalendarz** (punkt 1). Duża zmiana: dzień „zamknięty” po treningu, plan na
  7 dni do przodu (zapisany, „sztywny”, korygowany, gdy przestaje być bezpieczny), kalendarz,
  zgłaszanie zakwasów/bólu, dodatkowy trening zamiast FBW A/B, a na końcu trener AI, który
  może poprosić o przeliczenie.

Kolejność: **Q1 → E1 → Q2 → E2 → E3 → E4 → E5 → E6 → E7** (tabela w §4).
E1 („dziś zrobione”) idzie zaraz po Q1, bo to błąd, który widać codziennie.

---

## 1. Diagnoza: dlaczego po dwóch sesjach „wróciła pierwsza”

Plan dnia jest liczony **na żywo** dla bieżącej daty (`computeToday` → `planToday` → `planDay`,
[dayPlanner.ts](../src/domain/plan/dayPlanner.ts)). Aplikacja nie ma pojęcia „dzisiejszy trening już
był”. Po zakończeniu sesji silnik liczy plan na **ten sam dzień** jeszcze raz:

1. Partie z pierwszej sesji dostają `RECOVERING`, więc zostają tylko sloty `lightFill`
   (core, rotatory) — to jest „Brzuch + barki” ze zrzutów: cel 8–12, **RIR 5**.
2. Serie przy RIR 5 z założenia **nie są roboczymi** (SPEC §4.2) — nie liczą się do objętości
   ani do regeneracji. Po zrobieniu tej sesji silnik widzi ten sam stan co przed nią i proponuje
   **identyczny** plan po raz kolejny.

Czyli to nie losowość, tylko brak stanu „dzień zamknięty”. Naprawa: E1.

---

## 2. Szybkie poprawki sesji (Q)

### Q-8. Paski serii pod filmem — spójne kolory

[SetLogger.tsx:309](../src/features/workout/SetLogger.tsx) (`SetProgress`): teraz zrobione =
`bg-primary` (limonka), bieżąca = `bg-foreground` (biała), czekające = `bg-secondary`.
**Zmiana:** zrobione i czekające tym samym ciemnoszarym kolorem, bieżąca biała. Postęp i tak jest
w nagłówku („Seria 2 / 2”). Test komponentu na klasy.

### Q-7. Powrót z przerwy i z podsumowania ćwiczenia („cofnij serię”)

Dziś „Seria zrobiona” od razu zapisuje wiersz w `set_logs` i przechodzi do przerwy
(`RestTimer`) albo karty „zrobione” (`GroupDoneCard`); cofnąć się nie da.

- Przycisk **„Cofnij serię”** na ekranie przerwy i na karcie „zrobione”: usuwa **ostatnio zapisaną**
  serię (nowa funkcja `deleteSetLog(workoutId, exerciseOrder, setIndex)`), zatrzymuje timer, wraca do
  tej serii z **wpisanymi poprzednio wartościami** (powtórzenia, RIR, ciężar), żeby poprawić, a nie
  wpisywać od nowa.
- To samo po ostatniej serii całej sesji: ekran podsumowania sesji dostaje „Wróć do treningu”
  (cofa ostatnią serię; sesja jest jeszcze `in_progress`, bo kończy ją dopiero „Zakończ” na
  podsumowaniu).
- Systemowy „wstecz” na przerwie = to samo co „Cofnij serię”, z potwierdzeniem.
- Bez potwierdzenia na przycisku (cofnięcie jest odwracalne — wystarczy zapisać ponownie).

Testy: repozytorium (usunięcie nie rusza innych serii, `getLoggedStepKeys` się zgadza, wznowienie
po restarcie trafia w cofniętą serię).

### Q-3. Powiększenie filmu ćwiczenia

Tapnięcie w klip (ekran serii, przerwa, układ poziomy) otwiera **pełnoekranowy podgląd** (Modal
na czarnym tle, klip w pętli, zamykany tapnięciem, gestem w dół albo „wstecz”). Mały klip pod
spodem pauzuje, żeby nie dekodować dwóch naraz. Bez kontrolek odtwarzania — jak teraz.
Brak klipu → powiększa się zdjęcie.

### Q-2. Alternatywny widok rozgrzewki: duże karty

[WarmupChecklist.tsx](../src/features/workout/WarmupChecklist.tsx): po prawej od tytułu „Rozgrzewka”
przełącznik widoku (ikona lista ↔ karty).

- **Widok kart:** jedna karta na cały ekran — bardzo duża nazwa ruchu i dawka (czytelne z podłogi
  z 2 m), numer „3 / 10”, kropki postępu. Swipe w lewo/prawo między kartami; duży przycisk
  „Zrobione” odhacza i przesuwa na następną. Po ostatniej: „Zaczynamy trening”.
- Odhaczenia wspólne dla obu widoków (przełączenie nie gubi stanu).
- Aplikacja **zapamiętuje** wybrany widok (ustawienie lokalne).
- Działa w poziomie (sesja pozwala na obrót).

### Q-6. Opisy niezgodne z ćwiczeniem (np. „Stań prosto” przy Y na leżąco)

Przyczyna: kroki na stronie ćwiczenia to przetłumaczone instrukcje **YMove**
([exercises/[id].tsx:58](../app/exercises/[id].tsx), `info.pl.instructions`), a w kilku przypadkach
tekst YMove opisuje inny wariant niż klip. Przy `y-raises` instrukcja mówi „Stand tall…”, a klip
pokazuje wariant leżący. Do tego nasze dane mają własne błędy, np. `side-plank` ma
`stanceMechanics: "Prone"`, a ćwiczenia w leżeniu bokiem (`clamshell`, `open-book`) są oznaczone
jako `Supine`.

- **Audyt** (skrypt + przegląd klatek klipów): dla każdego ćwiczenia z klipem porównać pozycję
  z tekstu YMove (stand/lie/kneel/sit), naszą `stanceMechanics` i to, co widać na klatce. Wynik:
  tabela niezgodności w tym dokumencie (dodatek B), Ty zatwierdzasz.
- **Poprawka:** opcjonalne pole `steps` w `data/exercises.json` (nasz polski tekst kroków). Ma
  pierwszeństwo przed tekstem YMove. Naprawiamy tylko to, co audyt wskaże — nie przepisujemy
  wszystkiego.
- Poprawki `stanceMechanics` przechodzą przez filtr kolana (`validate-data` + testy filtra), bo
  pozycja wpływa na wykluczenia.

### Q-4. Ćwiczenia na stronę: „teraz lewa, w następnej serii prawa”

Dziś deska bokiem ma wskazówkę „Oba boki, ten sam czas”, a seria to obie strony naraz.

- Nowe pole ćwiczenia `sides`:
  - `perSet` — **jedna seria = jedna strona**, następna seria = druga strona (deska bokiem,
    otwarta książka, ćwiczenia w leżeniu bokiem, wiosłowanie jednorącz, jednonóż…);
  - `alternating` — strony na zmianę **w każdej serii** (bird dog, rowerek, martwy robak); bez
    zmian w przebiegu, tylko jasny napis „na zmianę w każdej serii”;
  - brak = obustronne.
- Dla `perSet` jedna zaplanowana seria to dwa kroki sesji: L i P. Nagłówek ekranu serii:
  **„A2 · Seria 1 / 2 · LEWA STRONA”** (duży znacznik), przerwa: „Następnie: Deska bokiem —
  prawa strona”.
- W supersecie strony przeplatają się z drugim ćwiczeniem: A1-L → A2 → A1-P → A2… (to od razu
  spełnia Q-5).
- **Kolejność stron:** zaczynamy od strony słabszego kolana z profilu (standardowa zasada:
  słabsza strona pierwsza, mocniejsza dorównuje). Dla ćwiczeń górnych — od lewej.
- Zapis: kolumna `side` (`left`/`right`/null) w `set_logs` (migracja). Objętość: para L+P = jedna
  seria dla partii. Progresja porównuje serie tej samej strony. Szacunek czasu planu liczy
  pracę dwa razy.
- Lista ćwiczeń do oznaczenia: dodatek A — do Twojej akceptacji.

### Q-5. Bez serii tego samego ćwiczenia zaraz po sobie

Skąd się bierze: `orderAndLabel` w [dayPlanner.ts](../src/domain/plan/dayPlanner.ts) łączy ćwiczenia
w pary, ale przy nieparzystej liczbie zostaje **grupa jednoosobowa** (np. jedno akcesorium) — jej
serie idą jedna po drugiej. Drugi przypadek: w grupie ćwiczenia z różną liczbą serii
(`buildSessionSteps`), np. 3 + 1 seria daje na końcu dwie serie A1 pod rząd.

- Planer nie zostawia grup jednoosobowych: samotne ćwiczenie dołącza do sąsiedniej grupy (trójka),
  najlepiej o innym regionie (dół/góra, góra/core).
- `buildSessionSteps`: gdy w grupie zostaje jedno ćwiczenie z seriami, jego pozostałe serie
  przeplatają się z następną grupą zamiast iść jedna po drugiej.
- Wyjątek: gdy w całej sesji jest **jedno** ćwiczenie — wtedy przerwa wystarczy.
- Właściwość w teście symulacji: w żadnym dniu nie ma dwóch kolejnych kroków tego samego ćwiczenia
  (poza tym wyjątkiem; strony L/P to różne kroki, ale też nie pod rząd, jeśli jest z czym przeplatać).

---

## 3. Silnik i kalendarz (E)

### 3.1 Docelowe zachowanie

- Każdy plan ma **datę**. „Dziś” pokazuje „Plan na dziś · śr 7.10”, a po treningu: **„Dziś zrobione
  — czas na regenerację”** + co odpoczywa do kiedy + **plan na jutro**.
- Silnik trzyma **plan na 7 dni do przodu** (dziś + 6). Plan jest **zapisany i stały** — nie zmienia
  się przy każdym otwarciu ekranu. Zmienia się tylko, gdy:
  1. **przestaje być bezpieczny albo możliwy** (patrz „korekta” niżej) — automatycznie, z informacją,
     co się zmieniło;
  2. **poprosisz** („Przelicz tydzień”, z loaderem);
  3. **poprosi trener AI** — po Twojej akceptacji.
- **Co jest stałe, a co liczone w dniu treningu:** na tydzień ustalamy **co** (sloty, ćwiczenia,
  liczba serii, tytuł dnia, szacowany czas). **Ile** (ciężar, cel powtórzeń) liczy się w dniu
  treningu z prawdziwej historii — bo progresja musi widzieć, ile faktycznie zrobiłeś wczoraj.
  Dzięki temu „sztywny” plan nie podsuwa ciężarów wyliczonych z założenia, że wszystko poszło
  idealnie.
- Kalendarz pokazuje przeszłość (co było) i przyszłość (co zaplanowane).

### 3.2 Model danych (migracja 0005, backup v3)

| Tabela | Po co | Najważniejsze pola |
|---|---|---|
| `planned_days` | plan dnia z tygodniowej prognozy | `date`, `seq` (1 = główny, 2+ = dodatkowy), `status` (`planned` / `done` / `missed` / `replaced`), `skeleton` (json: sloty, ćwiczenia, serie, regiony, minuty, kody), `generationId`, `workoutId` (po starcie) |
| `plan_generations` | historia przeliczeń: kiedy i dlaczego | `trigger` (`horizon` / `manual` / `missed_day` / `unsafe` / `constraint` / `coach`), `constraints` (snapshot), `summary` (co się zmieniło) |
| `plan_constraints` | Twoje i trenera prośby, które silnik uwzględnia | `kind` (`avoid_muscle` / `rest_day` / `lighter_day`), `muscles`, `from`, `until`, `reason` (`doms` / `pain` / `busy` / `other`), `source` (`user` / `coach`), `note`, `revokedAt` |

`workouts.plan` zostaje bez zmian (zamrożona recepta z dnia treningu). Backup v3 obejmuje nowe
tabele; import v2 nadal działa. Dane FBW A/B **nie są kasowane** (stare sesje w historii się do
nich odwołują).

### 3.3 Silnik (czysta domena, `src/domain/plan`)

- `dayStatus(asOf, sessions)` → `open` / `inProgress` / `done`. Sesja ukończona z datą treningu =
  dziś zamyka dzień — także gdy była samym dopełnieniem przy RIR 5 (naprawa §1).
- `recoveryOutlook(sessions, asOf)` → dla każdej partii: kiedy znowu gotowa
  (`recoveryDays`, dziś 1 → partia z dziś wraca pojutrze). Do karty „czas na regenerację”.
- `planDay` dostaje **ograniczenia** (`plan_constraints` na dany dzień): nowe kody pominięcia
  `AVOIDED_BY_REQUEST` (partia wyłączona przez Ciebie / trenera) i kod dnia `REST_DAY_REQUESTED` /
  `LIGHTER_DAY_REQUESTED`. Ból partii = wyłączenie jej jako głównej **i** pomocniczej.
- `planWeek(input, { from, days: 7, constraints, keep })` — na bazie istniejącego `simulate()`:
  dzień po dniu planuje, zakłada wykonanie zgodne z planem i liczy następny dzień. `keep` = dni,
  których nie ruszamy (zrobione, w trakcie). Zwraca szkielety dni + prognozowaną objętość partii
  na koniec tygodnia (do miernika „w tym tygodniu klatka 5 serii, norma 3–6”).
- `checkPlannedDay(skeleton, liveInput)` → czy zapisany dzień nadal przechodzi twarde reguły:
  ćwiczenie dozwolone (kolano, „nie proponuj”), partia nie `RECOVERING` (np. po dodatkowym
  treningu wczoraj), brak DOMS ≥ 4, brak ograniczenia, mieści się w tygodniowym max. Każde
  naruszenie → korekta od tego dnia.
- `extraSessionOptions(input)` — dla dodatkowego treningu: które sloty mogą dziś jeszcze wejść
  (po dzisiejszej sesji), z kodami dla pozostałych. `planCustom(slotIds)` buduje receptę tylko
  z wybranych slotów i przepuszcza ją przez `validatePlan`.
- Właściwości w teście symulacji: plan zapisany na 7 dni przechodzi te same właściwości co §10.6;
  po pominiętym dniu reszta tygodnia przelicza się i dalej nie łamie limitów; ograniczenie
  `avoid_muscle` nigdy nie daje serii tej partii w swoim okresie.

### 3.4 Kiedy plan się koryguje sam

Przy każdym otwarciu „Dziś” / kalendarza (szybkie — czysta funkcja, milisekundy):

1. **Horyzont:** brakuje dni do 7 → dopisz kolejne, **bez zmieniania** istniejących (`horizon`).
2. **Pominięty dzień:** zaplanowany dzień w przeszłości bez sesji → `missed`, przelicz od dziś
   (`missed_day`). Silnik sam nadrobi niedobory w ramach limitów.
3. **Niebezpieczny dzień:** `checkPlannedDay` zgłasza naruszenie (np. wpisałeś DOMS 4 w nogach,
   zrobiłeś dodatkowy trening) → przelicz **tylko ten dzień**; następne dni zostają, jeśli dalej
   przechodzą sprawdzenie (kaskadowo — zmieniony dzień może sprawić, że jutro przestaje być
   bezpieczne, wtedy przelicza się i jutro). Plan zmienia się minimalnie.
4. **Zmiana ograniczeń albo dni wolnych** → przelicz od pierwszego dnia, którego dotyczy.

Każda automatyczna korekta zostawia **baner**: „Przeliczyłem plan: pominięta sesja we wtorek.
Zmiany: czw — nogi zamiast pleców…”. Szczegóły w kalendarzu.

Niedorobione serie (np. 1 z 2) **nie** przeliczają tygodnia — to nie naruszenie, silnik wyrówna
niedobór w następnych dniach w ramach zwykłej punktacji.

### 3.5 „Dziś” i „Kalendarz” — ekrany

**Dziś**, cztery stany karty treningu:

| Stan | Karta |
|---|---|
| plan na dziś, nie zaczęty | jak teraz + data („Plan na dziś · śr 7.10”) |
| w trakcie | jak teraz („Wznów”) |
| **zrobione** | „Dziś zrobione” (czas, serie), **Czas na regenerację**: „Nogi i plecy odpoczywają do pt”, **Jutro**: tytuł + ćwiczenia + szacowany czas; przycisk „Dodatkowy trening” (opcjonalny, mniej widoczny) |
| dzień wolny (na Twoją prośbę) | „Dzień wolny” + jutro |

Karta roweru zostaje osobno, jak teraz.

**Kalendarz** — siatka miesiąca (bez nowej biblioteki: własna siatka 7 × 6 w naszym motywie):

- Strzałki + swipe między miesiącami; wstecz bez limitu, do przodu do końca horyzontu.
- Komórka dnia: numer + ikony: **rower** (jazda), **hantel** (sesja), **dwa hantle** (2 sesje).
  Dni zaplanowane: te same ikony w wersji przygaszonej/obrysowanej. Pominięty: przygaszony
  z czerwoną kropką. Deload: delikatne tło całego tygodnia. Dziś: obwódka. Legenda pod siatką.
- Tap w dzień → arkusz (bottom sheet): przeszłość — sesje z seriami (link do istniejącego widoku
  historii), jazdy, wpis dziennika; przyszłość — ćwiczenia, serie, czas, „dlaczego tak” (kody),
  i akcje: „Dzień wolny” (ograniczenie `rest_day` + przeliczenie).
- Na górze: „Przelicz tydzień” (loader, potem baner ze zmianami) i link do „Zgłoś zakwasy / ból”.

### 3.6 Zgłaszanie zakwasów i bólu (bez AI)

Arkusz „Zgłoś” (doprecyzowany researchem, dodatek D): partie, rodzaj (zakwasy lekkie / silne, ból
mięśnia z trzema pytaniami o naciągnięcie, czerwone flagi), na ile dni
(1–3, domyślnie 2). Zapis do `plan_constraints` + przeliczenie od dziś. Odwołanie = `revokedAt`
+ przeliczenie.

**Ból stawu / kolana to nie ten formularz:** pokazujemy komunikat, że to sprawa dla fizjoterapeuty,
i (jak dziś) tryb konserwatywny w Ustawieniach. Silnik nie „leczy” planem.

DOMS z porannego dziennika działa jak dotąd (≥ 4 w partii głównej → `DOMS_HIGH` na dziś),
a teraz dodatkowo może uruchomić korektę dnia (§3.4 p. 3).

### 3.7 FBW A/B → „Dodatkowy trening”

- Sekcja „Trening ręczny” (FBW A/B) znika z UI. Szablony zostają w bazie (historia, backup), seed
  nie tworzy ich na nowej instalacji.
- **Dodatkowy trening** (z karty „Dziś zrobione” i z kalendarza na dziś): silnik pokazuje, które
  sloty mogą dziś jeszcze wejść — partie nieobciążone i z miejscem w limicie tygodnia — z krótkim
  „dlaczego” dla pozostałych. Zaznaczasz, silnik buduje receptę (`planCustom`), start. Zapis jako
  `planned_days.seq = 2`; po nim plan na kolejne dni sprawdza się sam (§3.4 p. 3), bo te partie
  będą się regenerować.
- Ta sama ścieżka dla trenera AI (E7).

### 3.8 Trener AI: przeliczenie na prośbę i dodatkowy trening

Zasada bez zmian (AI-INTEGRACJA, ADR): **LLM nie ustala obciążeń ani ćwiczeń wprost.** Proponuje
**ograniczenia**, silnik planuje, `validatePlan` pilnuje, Ty akceptujesz.

- Nowe narzędzia czatu (kontrakt **v3**):
  - `getWeekPlan` (tylko odczyt) — plan tygodnia z kodami; rozszerza `getPlanExplanation`;
  - `proposePlanChange({ constraints, note })` — np. „zakwasy w nogach, 2 dni” →
    `avoid_muscle: [quads, glutes], 2 dni, doms`;
  - `proposeExtraSession({ focusMuscles })` — wybór slotów z `extraSessionOptions`.
- Aplikacja liczy propozycję **bez zapisu** i pokazuje w czacie kartę różnic („czw: nogi → plecy;
  pt bez zmian”) z przyciskami **Zastosuj / Odrzuć**. Dopiero „Zastosuj” zapisuje ograniczenia
  (`source: coach`) i nowy plan (`trigger: coach`).
- Ból: istniejący wykrywacz sygnałów medycznych zostaje; przy bólu stawu narzędzie zmiany planu
  nie jest dostępne, odpowiedź kieruje do fizjoterapeuty.
- Loader w czacie na czas liczenia + karta wyniku.
- Kontrakt v3 = **aplikacja i Worker muszą być wdrożone razem** (jak przy v2). Nowe przypadki
  ewaluacji: zakwasy → ograniczenie, ból kolana → brak zmiany planu + fizjoterapeuta, prośba
  „daj więcej kg” → odmowa (silnik decyduje o obciążeniach).

### 3.9 Refaktor silnika — jak dokładnie

Cel: ten sam deterministyczny, testowalny silnik (SPEC §1.1), rozcięty tak, żeby „co trenować”
dało się zaplanować na tydzień i zapisać, a „ile” policzyć w dniu treningu.

**Podział `planDay`** ([dayPlanner.ts](../src/domain/plan/dayPlanner.ts)):

```
planDay(input)              = buildDay(selectDay(input), input)      // zachowanie bez zmian
selectDay(input)  → DaySelection   // kwalifikacja slotów, punktacja, wypełnianie, dopełnienie
buildDay(sel, in) → SessionPlan    // recepta z prawdziwej historii, kolejność + etykiety, validatePlan
```

```ts
interface SelectedItem { slotId: string; exerciseId: string; sets: number; role: 'work' | 'light' | 'mobility' }
interface DaySelection {
  date: string; blockIndex: number; phase: 'work' | 'deload';
  items: SelectedItem[]; skipped: SkippedSlot[];
  /** Kody znane już przy wyborze (LIGHT_DAY, LIGHTER_DAY_REQUESTED, …). */
  dayReasons: DayReason[];
}
```

Wszystkie dzisiejsze testy `planDay` zostają i mają przechodzić bez zmian — to siatka
bezpieczeństwa refaktoru.

**Nowe moduły w `src/domain/plan`:**

| Moduł | Funkcje |
|---|---|
| `constraints.ts` | typ `PlanConstraint`, `constraintsOn(date)`, `avoidedMuscles(date)` (zakwasy: partie główne; ból: główne i pomocnicze), `isRestDay(date, schedule, constraints)` |
| `dayState.ts` | `dayStatus` (open / inProgress / done), `recoveryOutlook` (partia → data gotowości) |
| `week.ts` | `planWeek`, `checkSelection`, `diffWeeks` |
| `extra.ts` | `extraSessionOptions`, `selectCustom(slotIds)` (E6) |

**`planWeek`** — symulacja jak `simulate()`, tylko na prawdziwej historii:

```
dla d = from … from+6:
  blok = advanceBlock(blok, d)                     // w pamięci; zapisujemy tylko dzisiejszy
  jeśli dzień wolny (wzorzec tygodnia albo ograniczenie)  → { d, rest }
  jeśli d ma zapisany wybór (locked) i checkSelection(wybór, stan na d) == []  → zostaw
  inaczej → selectDay(stan na d, ograniczenia na d)
  plan = buildDay(wybór, stan na d)                 // prognoza z ciężarami, tylko do podglądu
  historia += wykonanie zgodne z planem             // jak FOLLOWS_THE_PLAN
wynik: dni + prognozowana objętość partii (7 dni) + dla każdego dnia: zachowany / nowy / zmieniony
```

`checkSelection` sprawdza każdy element wyboru na stanie z dnia d (z prawdziwą i symulowaną
historią przed d): ćwiczenie nadal dozwolone i nadal wybrane w bloku, partia nie `RECOVERING`,
brak DOMS ≥ 4, brak ograniczenia, jest miejsce w tygodniowym max. To ta sama logika co
kwalifikacja w `selectDay` — wyciągnięta do jednej funkcji, żeby obie ścieżki nie mogły się
rozjechać.

**Tryby przeliczenia:** `keep` (zostaw każdy zapisany dzień, który przechodzi sprawdzenie —
korekta „niebezpieczny dzień” i dopisanie horyzontu) albo `fresh` (od daty X wszystko od nowa —
pominięty dzień, ręczne „Przelicz”, zmiana ograniczeń).

**Dni wolne i obciążenie (decyzja 2):** wzorzec tygodnia w Ustawieniach (domyślnie trening
codziennie) + pojedyncze dni w kalendarzu („dzień wolny” / „jednak trenuję”). Silnik nie
wymusza dni wolnych; pilnuje obciążenia jak dotąd: **3–6 bezpośrednich serii roboczych na partię
tygodniowo** (cel 4; 8 dla pośladków i pleców), najwyżej 2 serie na partię dziennie, partia
z seriami roboczymi wczoraj lub dziś odpoczywa. Przy mniejszej liczbie dni treningowych
dzienny budżet czasu rośnie, żeby tygodniowa praca została podobna:
`cel dnia = clamp(140 min / liczba dni treningowych, 20, 30)`. Jeśli i tak się nie mieści,
raport pokrycia w kalendarzu pokaże, które partie wypadają pod 3 serie.

**Jakość tygodnia (później, jeśli symulacja pokaże potrzebę):** `planWeek` jest zachłanny dzień
po dniu. Gdy raport pokrycia wyjdzie słabo (np. przy 3–4 dniach w tygodniu), następny krok to
policzyć kilka wariantów tygodnia (inne rozstrzygnięcia remisów i wagi) i wybrać ten z najlepszym
pokryciem norm — to jest miejsce, gdzie silnik może „pomyśleć dłużej” za loaderem. Najpierw
mierzymy, potem komplikujemy.

**Warstwa aplikacji** (`src/features/plan/weekSync.ts`, zastępuje `computeToday`):

```
syncWeek(trigger) :
  źródło = loadPlannerSource() + zapisane dni + ograniczenia + wzorzec tygodnia
  przeszłe dni: z sesją → done; bez sesji → missed (→ tryb fresh od dziś)
  dziś zrobione / w trakcie → dziś zablokowane, planujemy od jutra
  planWeek(…) → diffWeeks(stary, nowy) → jedna transakcja: planned_days + plan_generations
  zapis dzisiejszego bloku (saveBlockAdvance, jak dziś)
  → { dziś: stan + plan (buildDay na żywo z zapisanego wyboru), jutro, tydzień, baner }
```

Kolejka (jak w `computeToday`) zostaje: dwa ekrany naraz nie zapiszą tygodnia dwa razy.
Czat (`getPlanExplanation`) czyta zapisany plan bez zapisu.

**Q-4 / Q-5 w silniku:** `buildDay` układa grupy bez jednoosobowych; `buildSessionSteps` rozbija
serię ćwiczenia `perSet` na kroki L/P i przeplata; `estimate.ts` liczy pracę `perSet` podwójnie;
`weeklyVolume` liczy serię jednej strony jako 0,5.


---

## 4. Etapy

| # | Gałąź | Zakres | Wielkość | Zależy od |
|---|---|---|---|---|
| Q1 | `fix/session-ux-round4` | Q-8 paski, Q-7 cofnij serię, Q-3 powiększenie klipu, Q-2 karty rozgrzewki | M | — |
| E1 | `feat/day-closed` | `dayStatus`, `recoveryOutlook`, karta „Dziś zrobione” + jutro (liczone na żywo, jeszcze bez zapisu tygodnia) | S–M | — |
| Q2 | `feat/sides-and-interleave` | Q-4 strony L/P (pole `sides`, kolumna `set_logs.side`, migracja), Q-5 bez serii pod rząd, Q-6 audyt opisów + poprawki danych | M | akceptacja dodatków A i B |
| E2 | `feat/week-plan-engine` | `planWeek`, `checkPlannedDay`, ograniczenia w `planDay`, nowe kody, testy właściwości, `simulate-plan.ts` z ograniczeniami | L | E1 |
| E3 | `feat/week-plan-storage` | migracja 0005, repozytoria, backup v3, korekty automatyczne (§3.4), „Przelicz tydzień”, baner zmian, „Dziś” czyta zapisany plan | L | E2 |
| E4 | `feat/calendar` | zakładka Kalendarz, arkusz dnia, „Dzień wolny” | M–L | E3 |
| E5 | `feat/report-soreness` | „Zgłoś zakwasy / ból” → ograniczenia → przeliczenie | S–M | E3 |
| E6 | `feat/extra-session` | „Dodatkowy trening” (`extraSessionOptions`, `planCustom`), FBW A/B znika z UI | M | E3 |
| E7 | `feat/ai-plan-tools` | kontrakt v3, `getWeekPlan`, `proposePlanChange`, `proposeExtraSession`, karta różnic, ewaluacje, prompt chat/v3 | L | E3, E5, E6 |

Po E2 i E3: symulacja 5 tygodni (`scripts/simulate-plan.ts`) z pominiętymi dniami i zgłoszonymi
zakwasami — do pokazania przed instalacją (jak przy M7). SPEC dostaje rozdział §11 (plan
tygodnia) w E2. Po E7: nowe APK + redeploy Workera razem.

---

## 5. Decyzje (zatwierdzone 2026-10-07)

1. **Kalendarz zamiast zakładki Trening.** Historia zostaje listą; szybki wpis cardio — do arkusza
   dnia w kalendarzu.
2. **Dni wolne konfigurowalne** (wzorzec tygodnia + pojedyncze dni); silnik pilnuje tylko
   obciążenia (§3.9).
3. **Korekta automatyczna** przy pominiętym / niebezpiecznym dniu, z banerem. Prośby i AI — po
   akceptacji.
4. **Strony:** seria = jedna strona, zaczynamy od strony słabszego kolana.
5. **Zakwasy 2 dni, lekki ból mięśnia 3 dni**, odwołanie w każdej chwili.
6. **Horyzont 7 dni, kroczący.** Liczenie jest szybkie, więc korekty idą automatycznie;
   „Przelicz tydzień” jest dodatkowo pod przyciskiem z loaderem.

---

## Dodatek A — ćwiczenia „na stronę” (propozycja, do akceptacji)

**`perSet` — seria = jedna strona, następna seria = druga:**
deska bokiem (`side-plank`), otwarta książka (`open-book`), muszelka (`clamshell`), unoszenie nogi
w leżeniu bokiem (`side-lying-leg-lifts`), rotacja zewnętrzna z gumą w leżeniu bokiem
(`side-lying-rotation-with-band`), rotacja zewnętrzna z hantlem w leżeniu bokiem
(`dumbbell-external-rotation`), wiosłowanie jednorącz (`one-arm-db-row`), uginanie z oparciem
o udo (`concentration-curl`), prostowanie ramienia w opadzie (`dumbbell-tricep-kickback`),
split squat (`split-squat`), wejście na stopień (`step-up`), wykrok boczny (`lateral-lunge`),
RDL jednonóż (`single-leg-rdl`), kickback z gumą (`band-hip-extension`), mostek jednonóż
(`single-leg-dumbbell-hip-thrust`), spacer z walizką (`suitcase-carry`), rozciąganie łydki
(`standing-calf-stretch`), figura 4 (`supine-figure-four`).

**`alternating` — na zmianę w każdej serii (bez zmian w przebiegu, tylko napis):**
bird dog, rowerek, martwy robak z hantlami, deska z dotykaniem barków, nożyce pionowe,
naprzemienny wyprost nóg (pilates), pływak, rotacja piersiowa w klęku, wykrok w tył,
naprzemienne wyciskanie nad głowę, wyciskanie jednorącz z podłogi (naprzemienne).

**Wykrok w tył** zostaje na zmianę w serii (tak jak teraz) — bez odpowiedzi przyjmuję stan obecny.

## Dodatek B — audyt opisów (zrobiony 2026-10-07)

Przejrzane wszystkie 130 klipów (klatka z każdego obok naszej nazwy, pozycji i pierwszego kroku), potem
podejrzane w powiększeniu, w kilku momentach ruchu.

**Poprawione dane** (`data/exercises.json` v5; nasze kroki w polu `steps` mają pierwszeństwo przed
tekstem YMove, a wtedy znikają też jego „wskazówki”):

| Ćwiczenie | Klip pokazuje | Było | Teraz |
|---|---|---|---|
| `y-raises`, `t-raises`, `w-raises` | leżenie przodem na macie, bez hantli | „Stań prosto…”, `Bilateral` | nazwa „… w leżeniu przodem”, `Prone`, własne kroki (najpierw bez hantli, potem lekkie) |
| `db-reverse-flyes` | siad na brzegu ławki, tułów pochylony | „Stań w rozkroku…” | `Seated`, kroki na siedząco (krzesło / kanapa) |
| `kneeling-band-face-pull`, `kneeling-shoulder-cars` | klęk jednonóż | „Uklęknij… biodra nad kolanami” | kroki w klęku jednonóż; krążenia barkiem — seria na jeden bark |
| `db-overhead-triceps-extension` | siad | `Bilateral` | `Seated` (tekst już mówił „usiądź”) |

**Ukryte klipy** (`hideClip`): klip pokazuje inne ćwiczenie niż nasze, więc aplikacja pokazuje zdjęcie
i nasze wskazówki:

| Ćwiczenie | Dlaczego |
|---|---|
| `split-squat` | klip to przysiad bułgarski (tylna stopa na ławce) — większe obciążenie kolana niż nasz wariant |
| `db-glute-bridge` | klip to hip thrust z oparciem o ławkę, nie mostek na podłodze (hip thrust ma własny klip) |
| `dumbbell-external-rotation` | klip to rotacja na stojąco; nasz opis — w leżeniu bokiem (stojąc grawitacja prawie nie obciąża rotatorów) |
| `plank` | klip — deska na dłoniach; nasz opis — na przedramionach |
| `back-extension-hold` | klip na ławce rzymskiej, której nie ma w sprzęcie |

Do Twojej decyzji: jeśli wolisz wariant z klipu (np. deskę na dłoniach), wystarczy zmienić opis
i zdjąć `hideClip`.

## Dodatek C — prompt do Gemini Deep Research (opcjonalny)

Silnik nie czeka na ten research: liczby z §3.9 i §5 są parametrami w `PLANNER_CONFIG` i dają się
zmienić bez przebudowy. Research ma sprawdzić, czy domyślne wartości są rozsądne.

```text
Jestem 100-kilogramowym, 178-centymetrowym, dotąd nietrenującym mężczyzną w deficycie kalorycznym
(lek GLP-1). Trenuję w domu (hantle, gumy, rower stacjonarny) prawie codziennie: 10–20 min roweru
+ 20–30 min ćwiczeń siłowych. Mam niestabilne kolano (brak więzadeł pobocznych, rekonstrukcja ACL),
więc ćwiczenia obciążające kolano są ograniczone. Moja aplikacja planuje trening regułami:
3–6 bezpośrednich serii roboczych (RIR 0–4) na partię mięśniową tygodniowo (cel 4), najwyżej
2 serie na partię dziennie, partia trenowana wczoraj lub dziś odpoczywa (czyli min. ~48 h
przerwy), zakwasy (DOMS) ≥ 4/5 wyłączają partię na dzień, zgłoszone zakwasy — na 2 dni,
lekki ból mięśnia — na 3 dni. Serie przy RIR 5 traktuję jako „ćwiczenie techniki”, nie serie robocze.

Sprawdź w literaturze naukowej (meta-analizy, przeglądy systematyczne, stanowiska ACSM/NSCA,
badania na osobach nietrenujących i z otyłością) i oceń każdy punkt:
1. Czy 3–6 bezpośrednich serii tygodniowo na partię to rozsądne minimum/maksimum dla początkującego
   w deficycie? Jak liczyć serie ćwiczeń jednostronnych (seria na każdą stronę = 1 seria czy 2)?
2. Ile czasu regeneracji między sesjami tej samej partii przy tak małej objętości (2 serie, RIR 2–3)?
   Czy trening tej samej partii dzień po dniu jest szkodliwy, neutralny czy korzystny?
3. Trening przy zakwasach (DOMS): przy jakim nasileniu omijać partię i jak długo? Czy lekki trening
   przyspiesza ustąpienie DOMS?
4. Lekki ból mięśnia (podejrzenie naciągnięcia I stopnia) vs zakwasy: jak odróżnić w prostym
   formularzu, jak długo omijać partię, jakie objawy wymagają konsultacji z fizjoterapeutą?
5. Czy osoba nietrenująca, ćwicząca codziennie z tak małą objętością, potrzebuje planowanych dni
   całkowicie wolnych? Jakie sygnały zmęczenia (sen, energia, spadek powtórzeń) uzasadniają dzień
   wolny lub deload?
6. Czy w ćwiczeniach jednostronnych zaczynać od strony słabszej (np. strona z niestabilnym kolanem)?

Dla każdej odpowiedzi: konkretna rekomendacja liczbowa, siła dowodów (mocne / umiarkowane / słabe
/ opinia ekspertów) i źródła z działającym DOI albo linkiem PubMed. Nie podawaj źródeł, których nie
możesz zweryfikować; jeśli dowodów brak, napisz to wprost.
```

## Dodatek D — wnioski z researchu (2026-10-07)

Źródło: `Documents/Gemini deep research docs/Naukowa Ocena Planu Treningowego.md`. Raport odpowiada
na wszystkie 6 pytań. DOI kluczowych prac zgadzają się z tym, co znam (nie sprawdzane online): Schoenfeld 2017
10.1080/02640414.2016.1210197, Krieger 2010, Schoenfeld 2019 10.1080/02640414.2018.1555906, konsensus
monachijski 10.1136/bjsports-2012-091448, Dupuy 2018, Cheung 2003. Siłę dowodów raport miejscami
zawyża — poniżej ocena własna.

| Pytanie | Wniosek raportu | Co robimy | Uwaga |
|---|---|---|---|
| 1. Objętość 3–6, RIR 5 | 3–6 rozsądne dla początkującego w deficycie; RIR 5 to nie seria robocza | bez zmian | „bezpieczne maksimum" uzasadnia mechanizmem (AMPK/mTOR), nie badaniem — traktujemy 6 nadal jako parametr do strojenia |
| 1. Ćwiczenia jednostronne | seria L + seria P = 1 seria dla partii | tak liczymy w Q-4 (strona = 0,5) | opinia ekspertów, nie metaanaliza |
| 2. Regeneracja | dla samego mięśnia dzień po dniu przy 2 seriach jest neutralny; 48 h chroni ścięgna i kolano | `recoveryDays` zostaje 1 (~48 h) | cytowana metaanaliza częstotliwości nie dowodzi potrzeby 48 h — argument tkanki łącznej to rozumowanie, nie dowód |
| 3. DOMS | 1–3/5: trenować można (lekki ruch pomaga); 4–5/5: omijać, aż spadnie do 2–3 | **zmiana w E5:** formularz pyta o nasilenie — lekkie zakwasy nie wyłączają partii, silne wyłączają na 2 dni (z dziennikiem DOMS ≥ 4 jak dotąd) | — |
| 4. Naciągnięcie vs DOMS | rozróżnia początek (nagły w trakcie serii vs narastający po 12–24 h), lokalizacja (punkt jednym palcem vs rozlany), reakcja na rozgrzewkę; czerwone flagi: obrzęk/krwiak, wyczuwalne wgłębienie, ból utrudniający chód, „uciekanie" kolana | **E5:** te trzy pytania w formularzu; podejrzenie naciągnięcia → partia (główna i pomocnicza) wyłączona na 3 dni; czerwona flaga → komunikat o fizjoterapeucie, bez „leczenia" planem | 3 dni to opinia, nie wynik badania |
| 5. Dni wolne | przy małej objętości niepotrzebne; dzień wolny/deload, gdy powtórzenia spadają o 15–20% przez 2–3 sesje albo pogarsza się sen | wzorzec tygodnia (decyzja 2), sygnały z SPEC §6.1 bez zmian — są zgodne | — |
| 6. Strona słabsza pierwsza | zaczynać od strony operowanej/niestabilnej; zdrowa robi tyle samo | tak w Q-4 | **odrzucone:** zalecenie „edukacji skrzyżowanej" (zdrowa noga intensywnie, do RIR 0) — dotyczy unieruchomienia po operacji, kłóci się z filtrem kolana i z RIR silnika; poza zakresem aplikacji |
| RIR u początkujących | początkujący zaniżają RIR (zostawiają 2–4 powt. w zapasie) — to bufor bezpieczeństwa | bez zmian | — |

Doprecyzowanie nie jest potrzebne do E1–E7. Jedyna rzecz warta osobnego pytania kiedyś: czy przy
`recoveryDays` = 1 dla mięśni niezwiązanych z kolanem (ramiona, core) można by skrócić przerwę —
raport mówi „neutralne", więc to kwestia strojenia, nie bezpieczeństwa.

## Dodatek E — stan prac (2026-10-07, koniec sesji)

**Zrobione i scalone do `main`** (każdy etap: `npm run verify` zielony, sprawdzony na emulatorze):

| Etap | Co |
|---|---|
| Q1 | cofnij serię (przerwa, karta „zrobione”, podsumowanie), powiększanie klipu, duże karty rozgrzewki, paski serii |
| E1 | „Dziś zrobione — czas na regenerację” + plan na jutro |
| Q2 | strony L/P (seria = jedna strona, słabsze kolano pierwsze; `set_logs.side`, migracja 0005, backup v3, katalog v5), brak serii tego samego ćwiczenia pod rząd, audyt 130 klipów (dodatek B) |
| E2 | silnik tygodnia: `selectDay` / `buildDay` / `checkSelection`, `planWeek`, prośby (`constraints.ts`), SPEC §11 |
| E3 | zapis tygodnia: tabele `planned_days`, `plan_generations`, `plan_constraints`, `user_profile.rest_weekdays` (migracja 0006, backup v4); `weekSync` (pominięty dzień → przeliczenie, niebezpieczny dzień → zmiana tylko jego, horyzont 7 dni); „Dziś” czyta zapisany plan; baner „Plan tygodnia się zmienił”; dzień wolny; „Przelicz tydzień” na ekranie „Dlaczego taki plan?”; dni treningowe w Ustawieniach |
| E4 | Kalendarz zamiast Treningu: siatka 7 × 6, strzałki i przesuwanie miesięcy, horyzont 7 dni, ikony sesji/jazd/planu, pominięcie i deload; arkusz dnia z historią, dziennikiem, prognozą i wyjaśnieniem konkretnej daty; wyjątek „Dzień wolny / Jednak trenuję”; start/wznowienie, FBW A/B i szybki wpis roweru przeniesione do arkusza dziś. Trasa `/(tabs)/workout` zachowana. |
| E5 | „Zgłoś zakwasy / ból” z kalendarza: wybór objawów, partii i przegląd prośby; lekkie zakwasy → dziennik bez nowej blokady, silne → ograniczenie domyślnie 2 dni, ból mięśnia → 3 pytania i domyślnie 3 dni; objawy alarmowe i ból stawu → konsultacja bez zmiany planu; aktywne zgłoszenia z odwołaniem i przeliczeniem; daty włącznie, od 1 do 3 dni. |
| E6 | „Dodatkowy trening” z „Dziś zrobione” i arkusza dziś w kalendarzu: dostępne ruchy z powodami pominięcia, wybór i podgląd recepty; ponowna kontrola przed startem, wznowienie po restarcie, zapis osobnej sesji `planned_days.seq >= 2`; FBW A/B pozostają w historii i backupie, bez przycisków startu i bez seeda na nowej instalacji. |
| E7 | Implementacja: kontrakt v3, prompt `chat/v3`, `getWeekPlan`, `proposePlanChange`, `proposeExtraSession`; lokalne karty różnic „Zastosuj / Odrzuć”, walidacja i zapis po akceptacji. APK ARM64 i bundle Workera gotowe; wspólne wdrożenie czeka na backup i podłączony telefon. |

**Weryfikacja E4 (2026-10-07):** `npm run verify` — 1813 testów, 89 zestawów, wymagane pokrycie domeny
i AI 100%. Build `release` x86_64 na Pixel_API36 z nawigacją trzyprzyciskową: sprawdzone siatka,
swipe, przyszły plan → wyjaśnienie daty, dzień wolny i przywrócenie treningu z banerem, dzisiejszy
zapis roweru → odczyt w arkuszu, miniona sesja → istniejące szczegóły historii, zamykanie „wstecz”.

**Poprawka wykryta przy E4:** callbacki transakcji Drizzle/Expo SQLite były `async`, choć sterownik
jest synchroniczny. Zapis tygodnia, rotacja bloku, seed i import backupu używają teraz synchronicznych
callbacków z `.run()` / `.all()` / `.get()`. Test integracyjny na prawdziwym SQLite wymusza błędy
w połowie operacji i potwierdza rollback; błąd importu nie usuwa dotychczasowych danych. To nie
wymaga migracji ani zmiany formatu backupu.

**Weryfikacja E5 (2026-10-07):** `npm run verify` — 1862 testy, 94 zestawy, wymagane pokrycie domeny
i AI 100%. Emulator Pixel_API36, `release` x86_64, nawigacja trzyprzyciskowa, jasny i ciemny motyw:
silne zakwasy → przegląd 2 dni → zapis → odwołanie; ból mięśnia → 3 odpowiedzi → przegląd 3 dni
→ zapis → odwołanie; lekkie zakwasy → wpis „barki · lekko” w dzienniku, bez ograniczenia;
czerwone flagi → komunikat bez przycisku zastosowania; ból kolana → Ustawienia → powrót;
powrót do kalendarza i baner zmian. Przy symulowanym 8.10 o 00:30 zgłoszenie i link do dziennika
nadal wskazują 7.10 (granica dnia treningowego); zegar emulatora został przywrócony.

**Doprecyzowania E5:** pełne pominięcie mięśni dotyczy każdego zgłoszenia bólu mięśnia, także przy
odpowiedziach przypominających DOMS — formularz nie wyklucza urazu. Daty ograniczenia to ustawienia
planera, nie czas leczenia. Replan po błędzie można ponowić bez ponownego zapisu zgłoszenia.
Odwołanie nie kasuje porannego DOMS ≥ 4; ekran wyjaśnia to i odsyła do właściwej daty dziennika.
Zmiana dotyczy planu siłowego; komunikat nie zezwala na bolesny rower ani rozgrzewkę.

Komunikaty konsultacyjne sprawdzone z [NHS — sprains and strains](https://www.nhs.uk/conditions/sprains-and-strains/).
Lista objawów alarmowych uwzględnia też bardzo silny lub szybko narastający ból.
Opis początku i lokalizacji objawów porównany z [konsensusem monachijskim](https://pmc.ncbi.nlm.nih.gov/articles/PMC3607100/)
(DOI 10.1136/bjsports-2012-091448, opinia ekspertów); trzy pytania nie są zwalidowanym testem diagnostycznym.

**Weryfikacja E6 (2026-10-08):** `npm run verify` — 1882 testy, 97 zestawów, wymagane pokrycie
domeny i AI 100%. Build `release` x86_64, Pixel_API36 z nawigacją trzyprzyciskową: wybór łydek,
podgląd 2 serii z receptą, start, restart aplikacji i wznowienie tej samej sesji, zapis 2 serii
i ukończenie; historia oraz arkusz kalendarza pokazują osobny dodatkowy trening, a kolejny wybór
nie proponuje już łydek. Jasny i ciemny motyw, wejście z obu miejsc, jedno „wstecz” do kalendarza.
Test wykonano na dacie 7.10, żeby wykorzystać wcześniejszy ukończony trening emulatora;
zegar został przywrócony. Odczyt SQLite potwierdza `seq = 2`, `status = done`, powiązaną sesję
i brak naruszeń kluczy obcych.

**Doprecyzowania E6:** `selectCustom` wykorzystuje `selectDay` tylko dla wskazanych slotów roboczych,
bez automatycznego dopełnienia. Wyraźny wybór może przekroczyć tygodniowy cel, ale nigdy maksimum;
krótki dodatkowy trening nie musi mieć 20 minut. Połączony wybór może zostać ograniczony limitem
partii, czasu lub liczby ćwiczeń — podgląd pokazuje faktyczną receptę i powody pominięcia.
Start ponownie czyta dane i sprawdza zgodność z podglądem oraz datę treningową. Trwająca sesja
ma pierwszeństwo przed nowym startem; dzień wolny i brak ukończonej sesji blokują tę ścieżkę.

Migracja `0007_extra_sessions` zmienia klucz `planned_days` na `(date, seq)` i dodaje `workoutId`;
stare wpisy otrzymują `seq = 1`. Synchronizacja tygodnia czyta i zmienia tylko `seq = 1`.
Dodatkowa recepta i jej wybór zapisują się atomowo, ukończenie/porzucenie zmienia status obu
wierszy. Backup v4 pozostaje zgodny: przechowuje receptę sesji z `kind: extra`, a odtwarzalny
`planned_days` nadal nie jest eksportowany. Test SQLite sprawdza migrację z istniejącym planem,
rollback startu, ponowienie bez duplikatu, ochronę dodatkowej sesji przed synchronizacją,
odczyt kalendarza, zachowanie starych szablonów oraz round-trip backupu.

**Weryfikacja E7 (2026-10-08):** `npm run verify` — 2000 testy, 101 zestawów, wymagane pokrycie
domeny i AI 100%; Worker — typecheck, 121 testów w workerd, bundle `build:dry`. Ewaluacja 26
przypadków czatu z modelem zastępczym: wszystkie wymagane reguły przechodzą; raport
`evals/reports/2026-10-08-chat-reference-v3-reference-chat-model.{json,md}`. To test pipeline'u,
nie ocena zachowania Gemini na nowym prompcie. Prompt v1/v2 pozostaje niezmieniony.

Emulator Pixel_API36, release x86_64, nawigacja trzyprzyciskowa: podgląd dnia wolnego bez zapisu
(SQLite: zero ograniczeń i generacji `coach`), odrzucenie, ponowne przygotowanie i zastosowanie
(SQLite: jeden zapis prośby i jedna generacja `coach`), odwołanie dnia wolnego przez „Jednak
trenuję”, podgląd dodatkowej sesji klatki → start tej sesji; ból kolana → stały komunikat i zero
nowych żądań do lokalnego Workera. Jasny i ciemny motyw. Test działał z lokalną atrapą, bez
wywołań Gemini; zegar został przywrócony. Gotowy APK ARM64 używa normalnego adresu Workera
i ustawień sieci, bez lokalnego endpointu ani konfiguracji atrapy.

**Doprecyzowania E7:** narzędzia wyłącznie czytają i liczą. Podglądy istnieją w pamięci rozmowy;
nowe pytanie, nowa rozmowa lub odrzucenie wygasza wcześniejsze niezaakceptowane propozycje.
Karty pojawiają się po pełnej, sprawdzonej odpowiedzi — nie po anulowaniu, błędzie, skróceniu
lub wycofaniu odpowiedzi. Akceptacja ponownie czyta dane, sprawdza ich zgodność z podglądem
i datę treningową; nie przelicza po cichu innego wyniku do zapisania. Podwójny start i
powtórne zastosowanie tej samej karty są blokowane. Błąd zapisu można ponowić; transakcja
obejmuje ograniczenia, blok treningowy, dni i generację `coach`. Synchronizacja i akceptacja
korzystają ze wspólnej kolejki.

Fakty, w tym data treningowa i stan skąpej historii, są odświeżane przed każdym pytaniem.
Zmiana daty podczas odpowiedzi modelu kończy narzędzie kodem `date_changed`; nie powstaje
propozycja z terminami przesuniętymi względem pytania. Anulowanie podczas ładowania danych
nie wysyła żądania do modelu. Te scenariusze sprawdza test hooka i kontrolera propozycji.

`avoid_muscle` dla zakwasów wymaga wyraźnie nazwanych, silnych DOMS w wiadomości i nasilenia
4–5/5; model nie może sam uznać lekkich lub nieokreślonych zakwasów za silne ani nazwać bólu
mięśnia zakwasami. Medyczne i receptowe teksty w notatce propozycji też są odrzucane. Model
nie dostaje ciężarów ani celów powtórzeń; do karty trafiają daty, ćwiczenia i liczby serii
wyliczone przez silnik, z oznaczeniem serii na stronę. Zaakceptowana dodatkowa sesja ma
`source: ai_accepted` i `coachProposalId` w zamrożonej recepcie; backup v4 zachowuje te pola.
Prośba o dodatkową sesję nie może omijać silnych lub nieokreślonych zakwasów wspomnianych
w wiadomości: najpierw trzeba doprecyzować lub zapisać zgłoszenie i przygotować nową prośbę.

Kalendarz może odwołać pojedynczy dzień z przyjętej prośby trenera o wolne, zachowując resztę
jej zakresu oraz ograniczenia mięśni. Sprawdzone również atomowe wycofanie zmian przy błędzie.

**Dalej — wdrożenie E7:** ADB widział tylko emulator, bez fizycznego telefonu; backup telefonu
nie został potwierdzony. Produkcyjny Worker pozostaje w dotychczasowej wersji. Po eksporcie
backupu i podłączeniu telefonu: sprawdzić identyfikator aplikacji i zgodność podpisu, zainstalować
gotowy `.expo/HomeWorkout-E7-arm64-release.apk`, wdrożyć Worker v3 w tej samej sesji i sprawdzić
rozmowę z prawdziwym modelem. Stary klient v2 otrzyma od Workera v3 `contract_mismatch`, dlatego
nie wdrażamy samego Workera przed aktualizacją aplikacji.

**Uwagi na następną sesję:** emulator ma testowe dane (czwartek odznaczony w dniach treningowych,
sesje testowe 7.10, testowy rower 20 min 7.10 i wyjątek „trenuję” 9.10 po sprawdzeniu przełączania;
lekkie zakwasy barków w dzienniku 7.10; testowe zgłoszenia silnych zakwasów i bólu zostały odwołane;
ukończony dodatkowy trening łydek 7.10, 2 serie przy RIR 4; dodatkowa testowa sesja pchania
7.10 bez serii, automatycznie porzucona po przywróceniu zegara; prośba trenera o wolne 9.10
odwołana przez kalendarz). Emulator ma lokalny build E7 do testów atrapy.
Na telefon nic jeszcze nie poszło — przed instalacją: eksport backupu, nowe APK (migracje 0005
i 0006 oraz 0007 wykonają się same).

**Środowisko Codex:** SDK ze wskazanej przez użytkownika ścieżki jest widoczne tutaj jako
`C:/Users/mmaje/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/Android/Sdk` (wirtualizacja
aplikacji Claude). AVD: `Pixel_API36`. Istniejący projekt natywny/APK ma identyfikator `com.homeworkout`,
i od 2026-10-08 tak samo `app.json` (wcześniej `pl.majewski.homeworkout`) — przed instalacją na telefonie
sprawdzić identyfikator zainstalowanej aplikacji i zachować go, żeby aktualizacja trafiła do jej bazy.

**Poprawki po audycie (2026-10-08):** przegląd architektury i jakości kodu E4–E7 (raport poza repo,
`Review-helper/reports/2026-10-08-homeworkout-audit.md`) i cztery etapy poprawek, każdy z zielonym
`npm run verify`: (1) `app.json` z identyfikatorem `com.homeworkout`, nieaktualny podgląd dodatkowej
sesji z czatu kończy się stanem „wygasła” zamiast „ponów”, komunikaty błędów zapisu serii, cofnięcia,
zamiany do końca bloku i startu planu, globalny `ErrorBoundary`; (2) jedno wejście silnika
(`buildPlanningSnapshot`, `extraSessionState`), reguły intencji trenera w `domain/coach/intentGuards`
pod bramką 100%, `overrideDay` w domenie, `WEEK_CONFIG` (horyzont, okna, długości próśb), testy
`computeToday`; (3) usunięty martwy kod po starcie FBW A/B, start bazy jako hook `useDatabaseStartup`
z ekranem w `features/startup` i regułą lint dla `src/db`, nazwane stałe czasu i granicy doby;
(4) logika aktywnej sesji w `features/workout/useActiveSession` z testami. Kształt schematów narzędzi
widzianych przez model się nie zmienił; Worker nie wymaga ponownego wdrożenia z tego powodu.
Nie sprawdzono jeszcze na emulatorze ani telefonie — przed instalacją przejść sesję treningową,
cofnięcie serii, zamianę ćwiczenia i dodatkową sesję z czatu.

**Etap E8 — trener układa dni (2026-10-08, ADR 0006), stan:** zmergowane: podział testu SQLite
na 15+ nazwanych przypadków; historia per sesja (`firstOfEachDay`, `byTrainingDay`, SPEC §11.8);
testy architektury ADR 0001 (`src/__tests__/architecture.test.ts`); ADR 0006; `compose_day`
(migracja 0008, backup v5), `getDayOptions` + `proposeDayPlan`, kontrakt v4, prompt `chat/v4`
(szkic), karta „Ułożony dzień”, 3 przypadki ewaluacji. `npm run verify` 2167 testów, Worker 121.
**Zostało:** w kalendarzu pokazać dzień ułożony z trenerem i przycisk „Przywróć plan silnika”
(odwołanie `compose_day`); README (sekcja AI); test na emulatorze; ewaluacja na prawdziwym modelu;
wdrożenie APK + Worker v4 razem (Worker v4 odrzuca klienta v3).
