# HomeWorkout — plan aplikacji treningowej z asystentem AI

> **Wersja 2** — po zebraniu odpowiedzi na pytania otwarte i po pięciu deep researchach Gemini.
> Data: 2026-09-10. Poprzednia wersja: v1 (szkic wstępny).
>
> Dokumenty źródłowe: `Documents/Gemini deep research docs/`
> Specyfikacja implementacyjna silnika: [SPEC-silnik-regul.md](SPEC-silnik-regul.md)
> Dokument implementacyjny: [IMPLEMENTACJA.md](IMPLEMENTACJA.md) — **tam, gdzie się różnią
> (monorepo → jedna aplikacja, Vitest → jest-expo, victory → gifted-charts, brak backendu .NET),
> obowiązuje IMPLEMENTACJA.md.** Uzasadnienie zmian w jego §1.

---

## 0. Co jest zamknięte, co zostaje otwarte

### Decyzje zamknięte

| Obszar | Decyzja |
|---|---|
| Platforma | **Android only** (MVP). Brak EAS/konta Apple w budżecie i zakresie. |
| Framework | Expo (dev build) + expo-router + TypeScript strict |
| UI | **NativeWind + własne komponenty w stylu shadcn/ui** (cva + cn; RNR odrzucone — IMPLEMENTACJA §0.2) |
| Baza | expo-sqlite + Drizzle ORM, offline-first, SQLite jako źródło prawdy |
| Backup | eksport JSON na MVP; docelowo własny backend .NET/Azure albo Turso |
| Zasięg | **single-user, lokalnie** — brak RODO, brak auth, brak backendu |
| Repozytorium | publiczne na GitHubie, jako projekt portfolio i nauka |
| Baza ćwiczeń | własna, ręcznie autorska; obrazy z **free-exercise-db** (Unlicense / domena publiczna) |
| Architektura AI | hybryda neuro-symboliczna: silnik reguł liczy, LLM komentuje |

### Pozostaje otwarte

1. Czy rower Hop-Sport Bravo pokazuje na komputerku kadencję (RPM) — pole opcjonalne, nie blokuje.
2. Rzeczywista masa krótkiego gryfu (zakładam ~2 kg z bilansu zestawu — **do zważenia**, patrz §1.4).
3. Akceptacja listy ćwiczeń na nogi przez fizjoterapeutę.

### Środowisko developerskie

Android Studio instalowane lokalnie → **build lokalny**, nie EAS. Szybsze iterowanie przy jednym urządzeniu,
brak limitów darmowego tieru. Wymagane: JDK 17, Android SDK, `adb` w PATH.

---

## 1. Profil użytkownika i twarde ograniczenia

Te dane są **wejściem do silnika reguł**, nie tłem narracyjnym. Każde z nich zamienia się na regułę w kodzie.

### 1.1 Cele (w kolejności priorytetu)

1. **Zachowanie masy mięśniowej podczas redukcji na tirzepatydzie (Mounjaro).** To jest cel nadrzędny
   i on determinuje architekturę treningu — patrz §4.
2. Redukcja tkanki tłuszczowej, ze szczególnym uwzględnieniem brzucha
   (uwaga: redukcja miejscowa nie istnieje — sterujemy bilansem, mierzymy obwodem talii).
3. Przeciwdziałanie skutkom siedzącej pracy: mobilność, plecy, ogólna sprawność.
4. Podstawa siłowa.

### 1.2 Ograniczenia czasowe

- Sesja siłowa: **30–45 minut**, blok zamknięty.
- Rower: 15–45 minut, osobno lub po treningu.
- Realistyczne założenie: **będą tygodnie z jedną sesją albo zerem.** Silnik musi to traktować
  jako normalny stan, nie jako awarię — patrz §9.4.

### 1.3 Sprzęt (finalny)

| Sprzęt | Specyfikacja | Konsekwencje dla modelu danych |
|---|---|---|
| Hantle regulowane | Decathlon: **2 krótkie gryfy + 12 obciążeń (8×1 kg + 4×2 kg)** | `weightKg`; drabinka dyskretna, skok **2 kg na hantel** — patrz §1.3.1 |
| Gumy oporowe | Fit.me, 5 pętli: **żółta 2–7, czerwona 8–11, czarna 12–17, fioletowa 17–26, zielona 27–45 kg** | `bandId` + `anchorPosition` (dyskretna) — **nie** `weightKg`; patrz §5 i SPEC |
| Kotwica do drzwi | do kupienia | odblokowuje wzorce pull/row; bez niej plecy są nie do wytrenowania w domu |
| Karimata | – | masa własna, core, mobilność |
| Rower stacjonarny | Hop-Sport Bravo (spinningowy) | opór = skala porządkowa właściwa temu rowerowi, **nie waty** |

#### 1.3.1 Sufit obciążenia — rozstrzygnięcie, które zmienia plan

Bilans zestawu: 16 kg obciążeń + 2 gryfy = 20 kg deklarowane, czyli gryf waży ok. 2 kg
(`[DO ZWAŻENIA]` — jeśli jest inaczej, cała drabinka przesuwa się o stałą).

**Potwierdziło się: to 20 kg łącznie, nie na rękę.** Raport Gemini o Mounjaro przyjął „20 kg żeliwa
na jedną rękę" i na tym oparł ocenę bodźca dla nóg. Rzeczywisty deficyt obciążenia jest **dwukrotnie
większy**, niż zakładał.

Dostępne obciążenia (obciążniki muszą leżeć symetrycznie, więc rosną parami):

| Konfiguracja | Zakres | Skok | Zastosowanie |
|---|---|---|---|
| **Dwa hantle** (obciążenia dzielone po równo) | 2 → **10 kg na rękę** | 2 kg | wyciskanie, wiosłowanie, RDL, wznosy |
| **Jeden hantel** (wszystkie obciążenia na jednym gryfie) | 2 → **18 kg** | 2 kg | **goblet squat**, wiosłowanie jednorącz, pullover |

Drugi wiersz jest ważniejszy, niż wygląda: goblet squat to Twój podstawowy, bezpieczny dla kolana wzorzec
przysiadu i trzyma się w nim **jeden** hantel przy klatce. Możesz więc załadować na jeden gryf wszystko
i dostać 18 kg zamiast 10. To praktycznie podwaja dostępny bodziec w najważniejszym ćwiczeniu na nogi.

**Trzy konsekwencje, które przechodzą do silnika:**

1. **Skok 2 kg to duży skok procentowy.** Z 8 na 10 kg to +25%. Klasyczna klamra „maksymalnie 10%
   tydzień do tygodnia" jest przy tym sprzęcie niewykonalna — nie da się zrobić mniejszego kroku.
   Zamiast niej silnik egzekwuje regułę: *awans o jeden szczebel drabinki, wyłącznie po spełnieniu
   pełnego celu powtórzeń.* Szczegóły w [SPEC §8](SPEC-silnik-regul.md).
2. **Zakresy powtórzeń muszą być szerokie**, żeby zaabsorbowały skok obciążenia — 8–15 góra,
   10–20 dół. Zgodne z tym, co i tak zalecały badania przy retencji w deficycie.
3. **Gumy przechodzą z roli pomocniczej do podstawowej dla dolnych partii.** Przy 10 kg na rękę hantle
   nie dadzą bodźca pośladkom ani czworogłowym. Bodziec musi pochodzić z kombinacji
   *hantel + guma* albo z samej gumy — i to jest teraz rdzeń programu na nogi, nie dodatek.

### 1.4 Twarde przeciwwskazanie medyczne — prawe kolano

Stan: zerwane więzadła poboczne (brak MCL/LCL), zrekonstruowane ACL, klinicznie istotna tendencja
do uciekania kolana **do zewnątrz** (szpotawość dynamiczna, *varus thrust*).

Konsekwencje wprost dla silnika (pełna specyfikacja filtra w [SPEC](SPEC-silnik-regul.md)):

- **wykluczone:** płaszczyzna czołowa i poprzeczna dla ćwiczeń obciążających kolano
  (wykroki boczne, Cossack squat, wszelkie skręty pod obciążeniem),
- **wykluczone:** plyometria, wyskoki, lądowania,
- **wykluczone:** jednonóż bez podparcia (pistol squat, jednonożny RDL bez asekuracji),
- **wykluczone:** otwarty łańcuch kinematyczny na czworogłowy (prostowanie nogi w siadzie —
  także z gumą, patrz uwaga w §10.2),
- **promowane:** zamknięty łańcuch, obunóż, wzorzec zawiasu biodrowego (hamstringi chronią przeszczep
  przed przednim ślizgiem piszczeli).

> **To nie zastępuje konsultacji.** Powyższe reguły pochodzą z raportu wygenerowanego przez model
> językowy, nie od fizjoterapeuty, który widział Twoje kolano. Zanim wpiszemy je do kodu jako „twarde
> wykluczenia", zalecam pokazanie gotowej listy ćwiczeń na nogi fizjoterapeucie do akceptacji. To jedna
> wizyta, a różnica jest taka, że aplikacja przestaje zgadywać. Do tego czasu silnik działa w trybie
> konserwatywnym: tylko obunóż, tylko płaszczyzna strzałkowa.

---

## 2. Stack technologiczny — stan finalny

### 2.1 Rdzeń

```
expo (dev build)          – natywne moduły bez Xcode, OTA updates
expo-router               – routing plikowy, typed routes
typescript (strict)       – kontrakt danych = kontrakt z LLM
expo-sqlite + drizzle-orm – baza lokalna, migracje w kodzie, useLiveQuery
drizzle-kit               – generowanie migracji od pierwszego commita
zustand                   – stan UI i aktywnej sesji (dane trwałe idą do SQLite)
zod                       – walidacja formularzy ORAZ parsowanie wyjścia LLM
react-hook-form           – formularze
nativewind + react-native-reusables – UI
victory-native XL         – wykresy (Skia)
@gorhom/bottom-sheet      – logowanie serii bez wychodzenia z ekranu
expo-haptics              – potwierdzenie serii, koniec przerwy
expo-keep-awake           – ekran nie gaśnie w trakcie sesji
react-native-reanimated   – animacje UI
```

**Świadomie odrzucone:** Realm/Atlas Device SDK (wygaszany), React Native Paper (Material narzucałby wygląd,
którego i tak byś nadpisywał), WatermelonDB (nadmiarowe przy jednym użytkowniku), RxDB — mimo że raport
o taksonomii je rekomenduje (patrz §10.4).

### 2.2 Struktura repozytorium — to jest część portfolio

Skoro projekt ma pokazywać, jak piszesz kod, to struktura jest tak samo ważna jak funkcje.
Kluczowa decyzja: **logika domenowa nie może wiedzieć o Reakcie.**

```
/apps/mobile             – aplikacja Expo (ekrany, komponenty, nawigacja)
/packages/domain         – CZYSTY TypeScript, zero importów z react/expo
    /exercises           – taksonomia, filtr bezpieczeństwa
    /progression         – double progression (hantle), progresja gum
    /volume              – objętość tygodniowa, MEV/deload
    /autoregulation      – RIR, sygnały zmęczenia
    /__tests__           – testy jednostkowe, cel: 100% pokrycia tego pakietu
/packages/db             – schemat Drizzle, migracje, repozytoria
/packages/ai             – budowa promptu, schematy Zod odpowiedzi, walidacja
/data/exercises.json     – baza ćwiczeń (wersjonowana, walidowana schematem)
/assets/exercise-media/  – obrazy z free-exercise-db + plik LICENSE
```

**Dlaczego to jest ważne dla portfolio:** rekruter otwierający `/packages/domain` widzi czysty,
testowalny kod dziedzinowy bez frameworka. To czytelniejszy sygnał niż ładny ekran. Dodatkowo ta
separacja jest tym, co później pozwoli przenieść silnik reguł 1:1 do backendu w C#/.NET, jeśli
zechcesz — logika nie jest zrośnięta z UI.

**CI od pierwszego tygodnia:** GitHub Actions → lint + typecheck + testy `packages/domain`.
Tanie w konfiguracji, a bardzo poprawia odbiór repozytorium.

---

## 3. Media ćwiczeń i licencje — rozstrzygnięte

Raport o licencjach daje jednoznaczną odpowiedź, a Twoja sytuacja dodatkowo ją upraszcza.

| Źródło | Licencja | Osadzenie w repo | Werdykt |
|---|---|---|---|
| **free-exercise-db** (yuhonas) | Unlicense / domena publiczna | **dozwolone bez warunków** | **wybieramy** |
| wger | dane CC-BY-SA 4.0 (kod AGPL) | dozwolone, ale atrybucja + ShareAlike zaraża utwory zależne | tylko awaryjnie |
| MuscleWiki | komercyjne API, tokeny 15 min | **zakazane** | odpada |
| ExerciseDB (RapidAPI) | komercyjne, „Strict Storage Limits" | **zakazane** | odpada |
| ExRx.net | pełne prawa zastrzeżone, zakaz scrapingu | **zakazane** (tylko link) | odpada |

**Decyzja:** obrazy bierzemy z free-exercise-db, całą warstwę metadanych piszemy sami.

**Dlaczego sami:** free-exercise-db ma ~800 ćwiczeń z ogólną taksonomią (partia, sprzęt, push/pull),
ale **nie ma pól, których potrzebuje Twój filtr bezpieczeństwa** — płaszczyzny ruchu, łańcucha
kinematycznego, bazy podparcia, flagi `provokes_valgus_varus`. Te pola i tak musisz uzupełnić ręcznie.
A skoro Twój sprzęt zawęża pulę do **50–60 ćwiczeń**, to autorska baza to dwa–trzy wieczory pracy i pełna
kontrola nad jakością. Przy okazji cały problem licencyjny znika, bo zostaje tylko warstwa graficzna
z domeny publicznej.

**Praktyka w repo:** `/assets/exercise-media/LICENSE` z tekstem Unlicense i notką o pochodzeniu —
mimo że atrybucja nie jest wymagana, to dobry obyczaj i dobrze wygląda w projekcie portfolio.

**Demonstracja ruchu na MVP:** obraz z free-exercise-db + 3–4 cue'y tekstowe (ustawienie, ruch, oddech,
najczęstszy błąd). Dla ćwiczeń na nogi cue dodatkowe i obowiązkowe: *kontrola osi kolana, kolano śledzi
palce stopy, brak ucieczki na zewnątrz*. Animacje Lottie — etap 4, jeśli w ogóle.

---

## 4. Architektura treningu — co wynika z badań

Źródło: `Trening Oporowy Podczas Terapii Mounjaro.md`. Wnioski przyjmuję z jedną istotną korektą
interpretacyjną, opisaną w §10.1.

### 4.1 Kluczowa zmiana względem v1

W v1 zakładałem klasyczną hipertrofię z rosnącą objętością. To było **błędne założenie** dla Twojej
sytuacji. Na tirzepatydzie, przy deficycie rzędu 500+ kcal, celem nie jest budowa masy — jest nią
**retencja**. To odwraca kilka standardowych zaleceń:

| Parametr | Klasyczny plan hipertroficzny | Twój plan (retencja w deficycie) |
|---|---|---|
| Objętość tygodniowa | 10–20 serii / partię | **3–6 serii roboczych / partię** |
| Częstotliwość | 2–3× partię, split | **2–3× w tygodniu Full Body** |
| Zakres powtórzeń | 6–12 | **8–15 góra, 10–20+ dół** (kompensacja lekkiego sprzętu) |
| Bliskość upadku | 0–2 RIR wszędzie | **2–3 RIR wielostawowe, 0–1 RIR izolacja** |
| Przerwy | 60–90 s | **90–180 s** (+ superserie antagonistyczne, by zmieścić się w czasie) |
| Deload | co 6–8 tyg. | **co 4–5 tyg.**, redukcja objętości 30–50%, ciężar bez zmian |

**Logika:** naprawa mikrouszkodzeń po dużej objętości kosztuje energię, której na Mounjaro po prostu nie ma.
Mniejsza objętość utrzymana blisko wysiłku granicznego daje bodziec, którego organizm nie musi „dopłacać".

### 4.2 Szablon sesji (45 min, Full Body)

Superserie antagonistyczne — bo przerwy muszą być długie, a czasu jest mało:

```
A1  wzorzec zawiasu biodrowego (RDL hantle / gumy)         2 serie
A2  wzorzec przyciągania (wiosłowanie gumą z kotwicy)      2 serie
B1  wzorzec przysiadu obunóż (goblet squat)                2 serie
B2  wzorzec pchania (wyciskanie hantli z podłogi)          2 serie
C   akcesoria / core (deska, martwy robak)                 2 serie
```

To daje 2–3 serie na partię w sesji × 2 sesje = 4–6 serii tygodniowo. Zgadza się z MEV.

### 4.3 Rower — Twój najbezpieczniejszy wolumen dla nóg

Warto to wyodrębnić, bo raporty tego nie łączą: rower spinningowy to ruch **w płaszczyźnie strzałkowej,
w zamkniętym łańcuchu, po prowadzonym torze, bez faz lotu i lądowania**. Z punktu widzenia filtra
bezpieczeństwa kolana to praktycznie idealne ćwiczenie — jedyne, przy którym możesz dawać nogom
objętość bez konfliktu z przeciwwskazaniami.

Zastrzeżenia praktyczne, które warto zapisać jako stałe zalecenia w aplikacji:

- **wysokość siodełka ma znaczenie kliniczne** — za niskie zwiększa kąt zgięcia i nacisk rzepkowo-udowy;
  ustawić raz, zmierzyć, zapisać w ustawieniach aplikacji, nie zmieniać przypadkiem,
- **jazda w siodle**, bez wstawania z siodełka — pozycja stojąca na rowerze spinningowym wprowadza
  boczne kołysanie miednicy i moment szpotawy, czyli dokładnie to, czego unikamy,
- opór umiarkowany, kadencja wyższa — mniej momentu na kolano przy tej samej pracy,
- opór to **skala porządkowa tego konkretnego roweru**, nie waty; porównywalna tylko sama ze sobą.

---

## 5. Gumy oporowe — od problemu do implementacji

Źródło: `Modelowanie Progresji Gum Oporowych.md`. Pełna specyfikacja algorytmu w [SPEC](SPEC-silnik-regul.md) §5.

### 5.1 Co realnie da się z tego wziąć

Raport zawiera dużo teorii hiperelastyczności (modele Mooney-Rivlina, Ogdena, Yeoha), która jest
**nadmiarowa dla tego projektu** — nie budujesz symulacji MES. Praktycznie użyteczne są cztery rzeczy:

1. **Dyskretyzacja pozycji kotwiczenia.** Nie mierzymy centymetrów w trakcie ćwiczenia. Definiujemy
   pozycje P0–P3 (naklejki/oznaczenia na podłodze) i logujemy pozycję, nie odległość. To zamienia
   ciągłą zmienną w policzalną.
2. **Progresja dwustopniowa:** mikro (ta sama guma, dalsza pozycja) → makro (bliższa pozycja, mocniejsza
   guma). To rozwiązuje problem „gumy nie mają skoku 2,5 kg".
3. **Efekt Mullinsa** — pierwsze 3–10 powtórzeń nowej/wypoczętej gumy stawia większy opór.
   Wniosek praktyczny: **seria rozgrzewkowa gumą jest obowiązkowa**, inaczej pierwsza seria robocza
   jest cięższa niż kolejne i log kłamie.
4. **Histereza** — faza ekscentryczna jest o 5–25% lżejsza niż koncentryczna. Wniosek: przy gumach
   **tempo ekscentryczne trzeba wydłużyć celowo** (3–4 s), żeby odzyskać bodziec, którego guma
   sama z siebie nie daje.

### 5.2 Czego z raportu NIE bierzemy

Tabela sił Thera-Band (0,8–8,9 kg) dotyczy **taśm rehabilitacyjnych**, nie Twoich pętli 2–45 kg.
Te liczby są dla Ciebie bezużyteczne i wpisanie ich do aplikacji dałoby fałszywe poczucie precyzji.

### 5.3 Zamiast tego — kalibracja własnym sprzętem

Raport sam to sugeruje i to jest najlepszy pomysł w całym dokumencie: **masz w domu zestaw znanych mas.**

Procedura (jednorazowa, ~30 minut):
1. zaczep gumę, zmierz długość spoczynkową `L0`,
2. podwieś kolejno 2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 kg (jeden gryf, obciążniki dokładane parami),
3. zapisz długość `L` przy każdej masie,
4. aplikacja dopasowuje krzywą (regresja liniowa lub kwadratowa) i zapamiętuje ją per guma.

**Ograniczenie jest teraz konkretne, a nie hipotetyczne.** Maksymalna masa, jaką dysponujesz, to 18 kg
na jednym gryfie (ok. 20 kg, jeśli podwiesisz cały zestaw). To wystarcza do skalibrowania trzech gum
z pięciu:

| Guma | Zakres nominalny | Kalibracja hantlami |
|---|---|---|
| żółta | 2–7 kg | **pełna** |
| czerwona | 8–11 kg | **pełna** |
| czarna | 12–17 kg | **pełna** |
| fioletowa | 17–26 kg | **częściowa** — tylko dolna część zakresu, ekstrapolacja wyżej |
| zielona | 27–45 kg | **niemożliwa** — 18 kg jej praktycznie nie rozciągnie |

Ironia sytuacji: **zielona guma jest jednocześnie tą, której nie da się skalibrować, i tą, która będzie
głównym źródłem obciążenia dla nóg** (bo hantle dają tylko 10 kg na rękę — §1.3.1). Wniosek: system
pozycji porządkowych P0–P3 nie jest awaryjną protezą dla przypadków brzegowych, tylko **podstawowym
mechanizmem progresji w najważniejszym ćwiczeniu**. Nie próbujemy pokazywać dla niej kilogramów w ogóle.
Progresja i tak opiera się na relacji „trudniej niż ostatnio", nie na wartościach bezwzględnych —
po prostu przy zielonej gumie to jedyne, co mamy.

### 5.4 Konflikt krzywych siły

Guma daje opór rosnący. Ludzka krzywa siły bywa malejąca. Skutek: przy **wiosłowaniu i przyciąganiach**
guma jest najcięższa dokładnie tam, gdzie jesteś najsłabszy (koniec skurczu) — mięsień zawodzi
przedwcześnie, a początek zakresu zostaje niedociążony. Przy **wyciskaniach i przysiadach** jest odwrotnie
i to działa świetnie.

Wniosek do modelu danych: każde ćwiczenie dostaje pole `bandSuitability: 'excellent' | 'ok' | 'poor'`.
Dla `poor` silnik albo preferuje hantle, albo zaleca większy pre-stretch przy krótszym zakresie ruchu.

---

## 6. Warstwa AI

Źródło: `Prompty dla aplikacji treningowej AI.md`. Ten raport jest najlepszy z całej piątki i można go
wdrożyć niemal wprost.

### 6.1 Podział ról — potwierdzony

```
Silnik reguł (deterministyczny)  →  JSON z policzonymi parametrami  →  LLM (tylko interpretacja)
```

LLM **nie liczy niczego**. Nie zaokrągla, nie estymuje, nie proponuje ciężarów. Cytuje liczby 1:1
z JSON-a. To była teza v1 i badania ją w pełni potwierdzają (błędy typu C — komputacyjne — są
nieusuwalne w architekturach transformerowych).

### 6.2 Cztery bloki promptu systemowego

Do zaimplementowania w `packages/ai`, w formacie znaczników XML (tak alokują uwagę modele):

| Blok | Zadanie |
|---|---|
| `<medical_guardrail>` | Lista słów zapalnych (ból, kontuzja, uraz, kłucie, strzyka, rwa, naciągnięcie). Przy trafieniu — sztywna, predefiniowana formuła odsyłająca do fizjoterapeuty, zakaz diagnozowania i proponowania rehabilitacji. |
| `<sparse_data_rules>` | Przy `historical_session_count <= 3` — zakaz słów „trend", „progres", „stagnacja", „adaptacja". Ton: „zbieramy dopiero dane". |
| `<load_encapsulation_rules>` | Zakaz arytmetyki. Wszystkie liczby ekstrahowane dosłownie z JSON. Na pytanie „ile w przyszłym tygodniu?" — odesłanie do silnika. |
| `<user_input_context>` | Notatki i JSON oznaczone jako dane niezaufane, nie instrukcje. |

**Uwaga o proporcjach:** raport proponuje też Input Guard, Output Guard, canary tokens, architekturę
sidecar i pipeline LLM-as-a-Judge. Dla aplikacji, w której **jedynym autorem notatek jesteś Ty**,
ochrona przed prompt injection jest zabezpieczeniem przed samym sobą. Nie jest to powód, żeby tego nie
robić — jest to powód, żeby zrobić to **na etapie 4 i z motywacją portfolio**, a nie na MVP z motywacją
bezpieczeństwa. Czysto zaimplementowana warstwa guardraili wygląda w repozytorium bardzo dobrze
i jest rzadka; po prostu nie jest pilna.

Co jest pilne i tanie: **`temperature: 0.0–0.3`** oraz **walidacja Zodem każdej odpowiedzi**.
To dwie linijki, a łapią większość realnych problemów.

### 6.3 Etapowanie (bez zmian względem v1)

**Etap 0 — ręcznie.** Aplikacja generuje brief w Markdown, wklejasz do Gemini z zapisanym promptem
systemowym. Zero kosztów, zero backendu. Cel: sprawdzić przez miesiąc, czy odpowiedzi są konkretne.

**Etap 1 — w aplikacji.** Proxy (Cloudflare Worker albo Azure Function — skoro znasz Azure, to naturalny
wybór i ładny akcent w portfolio) trzyma klucz. Gemini ze structured output, wynik przez Zoda.

### 6.4 Zastrzeżenie do treści porad

Guardrail medyczny musi obejmować **także zalecenia dietetyczne i dawkowanie leku**. Raport o Mounjaro
rekomenduje „diet break" zsynchronizowany z deloadem — czyli okresowe podniesienie kalorii, a nawet
sugeruje „przy konsultacji z lekarzem modyfikację dawek". **Aplikacja nie może tego proponować.**
Może zasugerować deload treningowy (to jest w jej kompetencji), ale wszystko, co dotyczy kalorii,
podaży białka i dawki tirzepatydu, to rozmowa z Twoim lekarzem prowadzącym, nie z Twoim telefonem.
Wpisujemy to jako jawną regułę do `<medical_guardrail>`.

---

## 7. Skład ciała — bez zmian, z jednym doprecyzowaniem

Waga codziennie rano + średnia krocząca 7-dniowa, obwody raz w tygodniu, zdjęcia raz na dwa tygodnie.

**Doprecyzowanie z badań:** DXA i wagi bioimpedancyjne **systematycznie zawyżają utratę mięśni**
w deficycie, bo glikogen i związaną z nim wodę (1 g glikogenu ≈ 3 g wody) liczą jako masę beztłuszczową.
Przy Mounjaro spadek glikogenu jest gwarantowany.

Wniosek praktyczny: jeśli kupisz wagę z bioimpedancją, **traktuj odczyt „% mięśni" jako szum**.
Aplikacja powinna to jawnie komunikować przy pierwszym wpisie z takiego źródła — inaczej zobaczysz
spadek masy mięśniowej, wpadniesz w panikę i zaczniesz zwiększać objętość treningu, czyli zrobisz
dokładnie to, co jest przeciwskuteczne.

Najbardziej wiarygodne sygnały dla Ciebie, w tej kolejności:
1. **utrzymanie ciężarów roboczych i powtórzeń przy spadającej wadze** — najlepszy dowód retencji mięśni,
2. obwód talii (redukcja tłuszczu brzusznego),
3. średnia krocząca wagi,
4. dopiero potem cokolwiek z bioimpedancji.

Punkt 1 jest ważny architektonicznie: **aplikacja ma to liczyć i pokazywać jako główną metrykę** —
„siła utrzymana / waga spadła o X kg" to Twój prawdziwy wskaźnik sukcesu, nie liczba na wadze.

---

## 8. Model danych — aktualizacja po researchu

Zmiany względem v1 zaznaczone `[NOWE]`.

```
Exercise
  id, name
  movementPattern      Squat | Hinge | Lunge | Push | Pull | Carry | Isolation | Core
  planesOfMotion[]     Sagittal | Frontal | Transverse                         [NOWE]
  isClosedKineticChain boolean                                                  [NOWE]
  stanceMechanics      Bilateral | UnilateralSupported | UnilateralUnsupported
                       | Seated | Prone | Supine                                [NOWE]
  forceProfile         ConcentricEccentric | Isometric | Plyometric             [NOWE]
  loadsKnee            boolean   -- czy filtr kolana ma to w ogóle rozpatrywać  [NOWE, krytyczne]
  provokesValgusVarus  boolean                                                  [NOWE]
  highAnteriorTibialShear boolean                                              [NOWE]
  primaryMuscles[], secondaryMuscles[]
  equipment[]          dumbbell | band | mat | bike | bodyweight
  bandSuitability      excellent | ok | poor                                    [NOWE]
  mediaRef, cues[], substituteIds[]

Band                                                                            [NOWE]
  id, colorLabel, nominalRangeKg, restLengthCm
  calibrationPoints[]  { massKg, lengthCm }
  calibrationFit       { type: 'linear'|'quadratic', coeffs[] } | null

SetLog
  id, workoutId, exerciseId, order, setIndex
  reps, rir, tempo
  weightKg?            -- hantle
  bandId?, anchorPosition?  0|1|2|3                                             [NOWE]
  estimatedLoadKg?     -- wyliczone z kalibracji, null gdy brak                 [NOWE]

Workout       id, date, type, status, durationMin, sessionRPE, notes
CardioLog     id, workoutId, minutes, resistanceLevel, avgCadence?, avgHr?, rpe
BodyMetric    id, date, weightKg, bodyFatPct?, source(manual|scale|navy)
Measurement   id, date, waist, hips, chest, arm, thigh, neck
DailyLog      id, date, sleepHours?, stress?, soreness{}, energy?, steps?, note
Plan / PlanDay
```

**Pole `loadsKnee` jest najważniejszą pojedynczą zmianą w tym modelu** — powód w §10.2.

---

## 9. Ryzyka — aktualizacja

### 9.1 Porzucenie aplikacji po trzech tygodniach
Bez zmian — nadal ryzyko numer jeden. Mitygacja: etap 1 to nudny dziennik, a kryterium przejścia dalej
to dwa tygodnie realnego używania.

### 9.2 Zakodowanie zaleceń medycznych z raportu LLM jako twardych reguł
**Nowe i poważne.** Filtr kolana pochodzi z dokumentu wygenerowanego przez Gemini. Jest napisany
przekonująco i najprawdopodobniej jest merytorycznie w porządku, ale jest to nadal tekst modelu
językowego o Twoim konkretnym kolanie, którego nikt nie zbadał. Mitygacja: tryb konserwatywny
domyślnie + jedna konsultacja fizjoterapeutyczna zatwierdzająca listę ćwiczeń na nogi.

### 9.3 Nadmierna wiara w precyzję liczb dla gum
Kalibracja 18 kilogramami pokrywa gumę żółtą, czerwoną i czarną; fioletową tylko częściowo,
zielonej wcale (§5.3). Jeśli aplikacja pokaże „obciążenie: 31,4 kg" dla zielonej gumy, będzie to liczba
wzięta z ekstrapolacji poza zakres pomiarowy — a uwierzysz jej, bo ma część dziesiętną.
Mitygacja: przedziały zamiast wartości punktowych, brak kilogramów przy braku kalibracji,
**zakaz ekstrapolacji poza najwyższy zmierzony punkt** (twardo w kodzie, nie w komentarzu).

### 9.4 Nieregularność treningów łamiąca logikę progresji
Sam zaznaczyłeś, że będą tygodnie prawie bez ćwiczeń. Klasyczna progresja liniowa się na tym wykłada
(„nie zrobiłeś sesji → brak danych → co teraz?"). Mitygacja: silnik musi mieć jawne reguły powrotu —
przerwa 7–14 dni → powtórz ostatnią sesję bez progresji; >14 dni → zejdź o jeden stopień;
>30 dni → tryb rekalibracji. Bez tego aplikacja będzie karać Cię za życie.

### 9.5 Gumy zużywają się i tracą sztywność
Po tysiącach cykli moduł sprężystości spada — kalibracja się dezaktualizuje. Mitygacja: licznik cykli
per guma i przypomnienie o rekalibracji co ~6 miesięcy lub po X seriach.

### 9.6 Rozpełzanie zakresu
Bez zmian, ale ryzyko wzrosło — po pięciu researchach lista „fajnych rzeczy do zrobienia" jest dłuższa.
Twarda zasada: **etap 1 nie zawiera silnika reguł ani AI.**

### 9.7 Migracje bazy
Drizzle Kit od pierwszego commita. Model danych po researchu urósł i jeszcze urośnie.

---

## 10. Krytyczna ocena raportów — gdzie warto zachować dystans

Raporty są wartościowe, ale to dokumenty wygenerowane przez model językowy. Cztery miejsca wymagają korekty.

### 10.1 „Zbyt duża objętość jest kataboliczna" — teza postawiona za mocno

Raport o Mounjaro twierdzi, że wyższa objętość treningowa *paradoksalnie potęguje utratę mięśni*.
To mocniejsze zdanie, niż uzasadniają cytowane źródła (a część z nich to blogi i Scribd, nie recenzowane
publikacje). Ostrożniejsza i lepiej ugruntowana wersja brzmi: **w deficycie niska objętość
w zupełności wystarcza do retencji, a wyższa nie daje przewagi przy wyższym koszcie regeneracyjnym.**

Dla Ciebie praktyczna różnica jest niewielka — 3–6 serii tygodniowo na partię i tak jest właściwym
startem przy 30–45 minutach i dwóch–trzech sesjach. Różnica jest w tym, **jak to zapisujemy w kodzie**:
te wartości trafiają do pliku konfiguracyjnego jako parametr do strojenia, a nie do stałych w kodzie
jako prawo fizjologiczne. Jeśli za pół roku okaże się, że dobrze znosisz 8 serii — chcesz móc to zmienić
w jednym miejscu.

### 10.2 Sprzeczność między podsumowaniem Gemini a jego własnym raportem

W wiadomości podsumowującej Gemini zarekomendowało *„leg extensions z gumą"* jako bezpieczną opcję.
Jego własny raport o taksonomii **zakazuje tego wprost** regułą HEC_E: prostowanie nogi to otwarty
łańcuch kinematyczny, który generuje maksymalną przednią siłę ścinającą na przeszczep ACL w zakresie
0–30° zgięcia — dokładnie to, czego przy Twoim kolanie unikamy. Guma nic tu nie zmienia; wręcz pogarsza,
bo daje największy opór na końcu wyprostu, czyli w najgorszym miejscu.

**Nie wdrażamy tego ćwiczenia.** Odnotowuję to nie po to, żeby punktować Gemini, tylko jako ilustrację
czemu wszystko idzie przez walidację: te dwa zdania powstały w tej samej sesji, kilkanaście minut od siebie.

Podobnie „Bulgarian split squats" z podsumowania — to `UnilateralSupported`, więc formalnie dopuszczone
warunkowo, ale przy braku obu więzadeł pobocznych wymaga stabilizacji w płaszczyźnie czołowej, której
Twoje kolano nie ma pasywnie. Wniosek: **zaczynamy obunóż**, split squat wchodzi dopiero po akceptacji
fizjoterapeuty i tylko przy niskim zmęczeniu.

### 10.3 Filtr kolana zaimplementowany dosłownie zablokuje pół górnej partii ciała

To jest realny błąd implementacyjny czyhający w raporcie. Reguła HEC_A brzmi: *„jeżeli
`planes_of_motion` zawiera Frontal lub Transverse → odrzuć"*. Zapisana dosłownie odrzuca też:

- wznosy bokiem (płaszczyzna czołowa),
- rozpiętki / flye (poprzeczna),
- wszystkie rotacje i wyciskania nad głowę z odwiedzeniem,

czyli ćwiczenia, które z Twoim kolanem nie mają absolutnie nic wspólnego. Aplikacja odrzuciłaby połowę
sensownych ćwiczeń na barki i klatkę.

**Poprawka:** wykluczenia dotyczące kolana obowiązują wyłącznie dla ćwiczeń z `loadsKnee === true`.
Dlatego to pole trafiło do modelu danych i dlatego filtr w [SPEC](SPEC-silnik-regul.md) §3 jest napisany
inaczej niż w raporcie.

### 10.4 Rekomendacje techniczne raportów są przeskalowane

Raport o taksonomii rekomenduje RxDB, kompresję kluczy JSON i indeksy kompozytowe „dla tysięcy rekordów".
Ty będziesz mieć **50–60 ćwiczeń**. To mieści się w pamięci telefonu jako zwykła tablica i przefiltrujesz
ją w pętli w czasie nie do zmierzenia. Zostajemy przy SQLite + Drizzle, bez RxDB.

Analogicznie raport o gumach proponuje modele Ogdena i całkowanie pracy mechanicznej — dla aplikacji,
która ma powiedzieć „dziś odejdź krok dalej od drzwi". Bierzemy dyskretyzację i regresję z kalibracji,
resztę zostawiamy.

**Wspólny mianownik:** raporty odpowiadają na pytania tak, jakby projekt był komercyjnym produktem
dla tysięcy użytkowników. Twój projekt ma jednego użytkownika i cel edukacyjny. Prostsze rozwiązania
są tu nie kompromisem, tylko poprawną odpowiedzią.

---

## 11. Roadmapa

### Etap 1 — dziennik (2–3 tygodnie) — *bez silnika reguł, bez AI*

- [ ] Szkielet: Expo + expo-router + NativeWind + reusables, monorepo, CI (lint/typecheck/test)
- [ ] Schemat Drizzle + pierwsza migracja
- [ ] `data/exercises.json` — 50–60 ćwiczeń z pełną taksonomią, walidowane Zodem
- [ ] Import obrazów z free-exercise-db + plik LICENSE
- [ ] **Ekran aktywnej sesji**: ćwiczenie → seria (reps / ciężar lub guma+pozycja / RIR) → timer 90–180 s
      → następna. Haptics, keep-awake, „powtórz poprzednią serię" jednym tapnięciem
- [ ] Ekran wagi + obwodów, wykres ze średnią kroczącą 7-dniową
- [ ] Dziennik dnia: sen, DOMS, energia (trzy suwaki)
- [ ] Log roweru: minuty, opór, kadencja, RPE
- [ ] Eksport JSON + Markdown

**Kryterium przejścia dalej:** dwa tygodnie codziennego używania bez irytacji.

### Etap 1.5 — kalibracja gum (1 wieczór)
- [ ] Ekran kalibracji: gumа → seria mas → dopasowanie krzywej → zapis
- [ ] Definicja pozycji kotwiczenia P0–P3, oznaczenia na podłodze

### Etap 2 — silnik reguł (2–3 tygodnie) — `packages/domain`
- [ ] Filtr bezpieczeństwa kolana (z poprawką `loadsKnee`)
- [ ] Objętość tygodniowa per partia, kontrola MEV
- [ ] Double progression dla hantli
- [ ] Progresja mikro/makro dla gum
- [ ] Autoregulacja RIR, reguły powrotu po przerwie
- [ ] Deload co 4–5 tygodni (tylko treningowy — bez zaleceń dietetycznych)
- [ ] Widok „co dziś"
- [ ] **Testy jednostkowe — cel 100% pokrycia tego pakietu.** To jest logika wpływająca na Twoje
      kolano i jednocześnie najlepszy element portfolio w całym projekcie.

### Etap 3 — AI
- [ ] Generator briefu Markdown → ręczny Gemini (**weryfikacja, czy AI wnosi wartość**)
- [ ] Proxy (Azure Function) + structured output + walidacja Zod + `temperature: 0.2`
- [ ] Cztery bloki promptu systemowego z §6.2
- [ ] Ekran „trener": podsumowanie tygodnia, pytania, propozycje do akceptacji

### Etap 4 — rozbudowa
- [ ] Warstwa guardraili (Input/Output Guard, testy red-team) — jako element portfolio
- [ ] Zdjęcia progresu (lokalnie), Health Connect, notyfikacje
- [ ] Backend synchronizacyjny w .NET/Azure — naturalne rozszerzenie i mocny punkt w CV
- [ ] Ewentualnie F-Droid (wymaga wyłącznie wolnych zasobów — free-exercise-db to zapewnia)

---

## 12. Co robimy najbliżej

1. **Kupić kotwicę do drzwi.** Przy 10 kg na rękę to nie jest udogodnienie — bez kotwicy nie ma wzorca
   przyciągania ani sensownego obciążenia nóg zieloną gumą. To pojedynczy zakup o największym wpływie
   na jakość programu.
2. Zważyć krótki gryf (kalibruje całą drabinkę obciążeń).
3. Zainstalować Android Studio + JDK 17, ustawić `adb` w PATH.
4. Rozważyć wizytę u fizjoterapeuty z listą ćwiczeń na nogi do akceptacji.
5. Postawić szkielet repozytorium i zacząć od ekranu aktywnej sesji.

Baza ćwiczeń (50–60 pozycji z pełną taksonomią) jest najlepszą inwestycją czasu w całym projekcie —
to ona zasila filtr bezpieczeństwa, substytucje i kontekst dla AI. Warto ją zrobić starannie i raz.
