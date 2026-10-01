# HomeWorkout — integracja AI

> **Wersja 0.3 — przyjęta do realizacji 2026-10-01.** (v0.2 i v0.1: tego samego dnia.) v0.2 uwzględnia
> weryfikację researchu i PoC z brancha `poc` — szczegóły i dowody: [WERYFIKACJA-RESEARCH-AI.md](WERYFIKACJA-RESEARCH-AI.md).
> v0.3 dodaje stan realizacji i odstępstwa od v0.2 (§10.0).
> Dokumenty powiązane: [PLAN.md](PLAN.md) §6 (warstwa AI), [IMPLEMENTACJA.md](IMPLEMENTACJA.md) M8–M9,
> [SPEC-silnik-regul.md](SPEC-silnik-regul.md) §1.2 (kody powodów) i §8 (`validatePlan`).
> Ten dokument zastępuje PLAN §6 i opisy M8–M9 w IMPLEMENTACJA.

---

## 0. Po co ten dokument

Warstwa AI ma dwa cele:

1. **Użytkowy.** AI analizuje postępy i pomaga ułożyć plan na konkretny dzień albo tydzień — dla jednej
   osoby, z konkretnym kolanem, konkretnym sprzętem i terapią GLP-1/GIP.
2. **Portfolio.** Repozytorium ma być dowodem *praktycznej* umiejętności integrowania LLM z aplikacją
   mobilną — takim, który obroni się w rozmowie technicznej z kimś, kto robił to produkcyjnie.

Cel 2 zmienia część werdyktów z analizy raportu „React Native Fitness AI Architecture" (2026-10-01).
Rzeczy zbędne przy jednym użytkowniku, ale oczekiwane od kogoś, kto twierdzi, że umie integrować AI —
ewaluacja, obserwowalność, abstrakcja dostawcy, streaming, tool calling — **wchodzą do zakresu**.
Rzeczy, które są głównie modne — RAG, model na urządzeniu, fine-tuning, Llama Guard — **nadal nie**,
a ich odrzucenie jest udokumentowane w ADR (§13). Umiejętność powiedzenia „nie" z uzasadnieniem to też
sygnał, którego szuka reviewer.

**Zasada przewodnia:** każde zdanie o AI, które chcesz napisać w CV, ma w repozytorium plik, test albo
wynik ewaluacji, który je udowadnia (§9).

---

## 1. Wrapper na API a inżynieria

Reviewer w 2026 roku widział setki aplikacji z dymkiem czatu podpiętym do API. Różnicę widać tu:

| Wrapper | Inżynieria |
|---|---|
| klucz API w aplikacji albo w `.env` klienta | klucz tylko na serwerze; uwierzytelnienie, limit zapytań, dzienny budżet |
| odpowiedź modelu renderowana jako tekst | odpowiedź to typowany obiekt, walidowany schematem po obu stronach sieci |
| model decyduje | model proponuje, kod domenowy weryfikuje, człowiek akceptuje |
| „działało na demo" | zestaw ewaluacyjny z liczbami, uruchamiany przy każdej zmianie promptu lub modelu |
| prompt jako string w komponencie | prompt jako wersjonowany artefakt; wersja zapisana przy każdej odpowiedzi |
| brak sieci = biały ekran | aplikacja działa w pełni bez AI; AI to warstwa dodatkowa |
| nieznany koszt i opóźnienie | każde wywołanie zalogowane: model, tokeny, czas, koszt, wynik walidacji |
| testy omijają część AI | część AI testowana deterministycznie, bez sieci i bez klucza w CI |
| czat jako jedyna funkcja AI | AI wpięte w domenę: strukturalne wejście i wyjście, konkretne decyzje |

**Przewaga tego projektu:** ma prawdziwy powód, żeby nie ufać modelowi — kolano bez więzadeł pobocznych
i drabinkę obciążeń ze skokiem 2 kg. Warstwy bezpieczeństwa nie są tu teatrem z checklisty, tylko
wynikają z domeny. To jest najmocniejsza historia do opowiedzenia na rozmowie.

---

## 2. Zasady nienaruszalne

Przeniesione z PLAN §6 i SPEC, doprecyzowane. **Każda ma mechanizm w kodzie i test** — zdanie w prompcie
jest co najwyżej drugą warstwą.

| # | Zasada | Mechanizm | Gdzie |
|---|---|---|---|
| I1 | LLM nie wytwarza obciążeń (kg, guma, pozycja) ani progresji | schemat odpowiedzi **nie ma takich pól** | kontrakt (Zod) |
| I2 | Każda propozycja planu przechodzi `validatePlan`; naruszenie medyczne usuwa ćwiczenie | SPEC §8 | `src/domain` |
| I3 | Sygnał urazu w tekście użytkownika → stała formuła, zero porad; tekst nie trafia do modelu | detektor uruchamiany przed wywołaniem; prompt jako druga warstwa | `src/domain` + prompt |
| I4 | Dieta, kalorie, białko, dawka leku — poza zakresem | detektor tematu + reguła w prompcie + scorer w ewaluacji | `src/domain` + prompt + evals |
| I5 | Przy ≤ 3 sesjach w historii — zakaz słownictwa trendu | reguła w prompcie + strażnik wyjścia (słownik) | worker + evals |
| I6 | Każda liczba w narracji pochodzi z danych wejściowych | scorer wierności liczb; docelowo strażnik wyjścia | evals → runtime |
| I7 | Użytkownik akceptuje każdą zmianę planu | ekran propozycji z różnicą; `SessionPlan.source = 'ai_accepted'` dopiero po akceptacji | UI |
| I8 | Aplikacja działa w pełni bez AI i bez sieci | przełącznik w Ustawieniach; plan silnika zawsze dostępny jako punkt odniesienia | app |
| I9 | Wysyłane jest minimum danych, a użytkownik może je obejrzeć | `buildCoachContext` wysyła kody zamiast diagnoz; ekran „co wysyłam" | `src/ai` |

Uwaga do I3: detektor musi odróżnić **zakwasy** (DOMS — normalna informacja treningowa, mapowana na
`soreness`) od **bólu urazowego** („kłucie w kolanie", „strzyknęło"). Prosta lista słów z „ból" zablokuje
zdanie „bolą mnie nogi po wczorajszym", które jest dokładnie tym, co silnik chce wiedzieć. To realny
problem projektowy, nie przypadek brzegowy — pytanie R9.

---

## 3. Funkcje

Kolejność jest celowa: najpierw funkcje strukturalne (trudniejsze i bardziej przekonujące), czat na końcu.

### F1 — Podsumowanie tygodnia (analiza postępów)

- **Wejście:** `CoachContext` — ostatnie 4 tygodnie sesji, objętość per partia, waga (7d MA) i trend,
  talia, sygnały z kodami powodów (SPEC §6.1), wskaźnik retencji siły („ciężary utrzymane przy wadze
  niższej o X kg" — PLAN §7), `historicalSessionCount`.
- **Wyjście:** obiekt, nie wolny tekst: `{ headline, highlights[], flags[{ reasonCode, comment }], questions[] }`.
  Każda flaga odwołuje się do kodu powodu z silnika — model komentuje decyzje, których nie podejmuje.
- **Wyzwalacz:** ręcznie oraz przy pierwszym otwarciu aplikacji w niedzielę (bez zadań w tle).
- **Pokazuje:** structured output, grounding na danych z silnika, reżim skąpych danych, wierność liczb.

### F2 — Plan tygodnia z opisu

- Użytkownik pisze: *„w tym tygodniu mogę wt, czw i sob; w czwartek tylko 25 min; w sobotę jestem
  u rodziców, mam tylko gumy"*.
- Model zwraca `WeekIntent { days: [{ date, timeBudgetMin, equipment[] }] }`.
- Zapis jako **intencja**, nie plan: w dniu treningu `dayPlanner` (M7) buduje sesję, bo sen, DOMS
  i energia są znane dopiero tego dnia. Rytm kroczący (IMPLEMENTACJA §10 pkt 2) zostaje — opuszczony
  wtorek nie staje się „zaległy".
- **Pokazuje:** ekstrakcja z języka naturalnego do schematu, walidacja domenowa (daty, sprzęt), HITL.

### F3 — Dostosowanie dzisiejszej sesji

- Użytkownik pisze: *„dziś mam 25 minut i zakwasy w łydkach"*.
- Model zwraca `DayConstraints { timeBudgetMin, equipment[], sorenessOverrides, intensity: 'normal' | 'easier' }`.
- `dayPlanner(constraints)` → `validatePlan` → **różnica względem planu domyślnego** → akceptacja.
- Ten sam mechanizm co F2, tylko dla jednego dnia. Model nigdy nie wybiera ćwiczeń ani obciążeń.

### F4 — Rozmowa z trenerem (tool calling + streaming)

- Pytania w rodzaju *„czemu dziś nie ma przysiadów?"*, *„jak mi idzie z wiosłowaniem?"*.
- Model nie dostaje zrzutu całej bazy, tylko **narzędzia do odczytu** wykonywane lokalnie na telefonie:
  `getPlanExplanation(date)`, `getExerciseHistory(exerciseId, weeks)`, `getWeeklyVolume(weekStart)`,
  `getBodyTrend(days)`, `findExercises(filter)`.
- Odpowiedź końcowa streamowana; opuszczenie ekranu przerywa generowanie aż do dostawcy.
- Narzędzia **tylko czytają**. Zmiana planu idzie wyłącznie ścieżką F3 (walidacja + akceptacja).
- Limity: maksymalna liczba wywołań narzędzi na turę i maksymalna długość rozmowy.
- **Pokazuje:** pętla agenta, tool calling, streaming w React Native, anulowanie, prompt injection,
  zarządzanie kontekstem wieloturowym.

### Opcjonalnie, później

- **F5 — model dobiera ćwiczenia.** `exerciseId` jako `z.enum()` z identyfikatorów, które przeszły
  `screenExercise`; liczba serii w przedziale; dalej bez obciążeń. Przy wymuszonym schemacie model
  fizycznie nie może wybrać wykluczonego ćwiczenia, a `validatePlan` i tak sprawdza. Dopiero gdy F3 jest stabilne.
- **F6 — multimodalność.** Zdjęcie komputerka roweru → szkic `CardioLog` (minuty, opór) do potwierdzenia.
  Mała funkcja, ale pokazuje wejście obrazowe z tą samą ścieżką walidacji.

---

## 4. Architektura

### 4.1 Komponenty i granice zaufania

```
┌─ TELEFON ── zaufane: dane, domena, użytkownik ─────────────────────────────────────────┐
│ app/coach/*          podsumowanie · propozycja (różnica) · rozmowa · diagnostyka · payload│
│ src/features/coach/  useWeeklySummary · usePlanProposal · useCoachChat                   │
│ src/ai/                                                                                  │
│   context/   buildCoachContext()  repozytoria + domena → CoachContext (kody, nie diagnozy)│
│   tools/     narzędzia F4 — tylko odczyt, wołają repozytoria i domenę                     │
│   client/    HTTP do Workera: timeout, abort, retry, błędy → stany UI                    │
│   apply/     odpowiedź → typy domeny → dayPlanner → validatePlan → Proposal              │
│ src/ai/contract/   Zod: żądania, odpowiedzi, wersje — czyste, współdzielone z Workerem   │
│ src/domain/        reguły, validatePlan, wykrywanie sygnałów medycznych, strażnicy wyjścia│
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTPS · sekret aplikacji · requestId · contractVersion
┌─ CLOUDFLARE ── zaufane: sekrety, prompty ─▼────────────────────────────────────────────┐
│ worker/   auth → limit + budżet → prompt (wersja N) → adapter dostawcy → Zod + 1 naprawa │
│           → strażnicy wyjścia → log strukturalny (bez treści)                            │
│ AI Gateway (do weryfikacji, R5): logi, koszty, limity, fallback dostawcy                 │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                        DOSTAWCA LLM — niezaufany: wszystko, co zwraca, to dane do walidacji
```

Dane i domena zostają na telefonie (offline-first się nie zmienia). Worker jest **bezstanowy**: nie ma
bazy, nie zna historii użytkownika poza tym, co przyszło w żądaniu.

### 4.2 Przepływ F3

```
1. tekst użytkownika
2. [telefon]  detectMedicalSignal(text) ── trafienie ──→ stała formuła + formularz ręczny. KONIEC (zero wywołań modelu)
3. [telefon]  buildCoachContext() → podgląd payloadu (opcjonalnie)
4. [worker]   auth · budżet · prompt v_n · wywołanie z response schema = JSON Schema z Zoda
5. [worker]   Zod.safeParse ── błąd ──→ jedna ponowna próba z treścią błędu ── błąd ──→ 422 (typowany)
6. [telefon]  Zod.safeParse (kontrakt) → dayPlanner(constraints) → validatePlan → różnica vs plan domyślny
7. [UI]       propozycja z różnicą i powodami (kody → strings/pl.ts)
              akceptuj → workouts.plan (source 'ai_accepted') · ai_exchanges.accepted = true
```

### 4.3 Gdzie co jest walidowane

| Miejsce | Co | Dlaczego tu |
|---|---|---|
| Worker | kształt (Zod), strażnicy wyjścia (słownik, liczby) | tylko tu da się tanio ponowić wywołanie |
| Telefon | kształt ponownie (Zod), `validatePlan`, różnica | wersje aplikacji i Workera mogą się rozjechać; domena i dane żyją na telefonie |

Podwójna walidacja kształtu nie jest redundancją — to ochrona przed niezgodnością wersji kontraktu.

### 4.4 Kontrakt i wersjonowanie

- `src/ai/contract/` jest czysty jak domena: importuje tylko `zod` (reguła ESLint jak dla `src/domain`).
- Schematy JSON dla dostawcy generowane z tych samych schematów Zoda — jedno źródło prawdy. Robi to
  AI SDK w Workerze (`Output.object`), łącznie z poprawkami pod konkretnego dostawcę (np. `const` → `enum`
  dla Gemini).
- Zasady pisania schematów kontraktu (weryfikacja R3/R4):
  1. bez `z.literal` i unii literałów — tylko `z.enum` (`const` nie wszędzie przechodzi);
  2. granice (`min`/`max`/długości) egzekwuje Zod po parsowaniu — Claude nie wymusza ich w dekodowaniu;
  3. w schemacie żadnych danych wrażliwych (nazwy pól, wartości `enum`) — dostawcy cache'ują
     skompilowane schematy poza treścią rozmowy.
- Worker importuje kontrakt ścieżką względną; `wrangler.jsonc` ma alias `zod` na wejście ESM, inaczej
  bundel zawiera dwie kopie Zoda (R11, zmierzone: 392 → 274 KiB gzip).
- Każde żądanie niesie `contractVersion`; Worker odrzuca nieznaną wersję typowanym błędem → UI
  „zaktualizuj aplikację".
- Każda odpowiedź niesie `requestId`, `promptVersion`, `model`, `usage`.
- Tabela `ai_exchanges` (IMPLEMENTACJA §6) dostaje: `promptVersion`, `model`, `latencyMs`, `tokensIn`,
  `tokensOut`, `validationOutcome`, `trimmedCount`. `kind`: `weekly_summary | week_intent | day_adjustment | chat`.
- F2 potrzebuje miejsca na intencję tygodnia: tabela `planned_days (date, timeBudgetMin, equipment, source)`.
  `dayPlanner` czyta wpis na dziś, jeśli istnieje.

### 4.5 Prompty

- Żyją w Workerze: `worker/src/prompts/<funkcja>/v<N>.ts`. Zmiana promptu nie wymaga wydania aplikacji.
- Kolejność: najpierw część stała (rola, `<medical_guardrail>`, `<sparse_data_rules>`,
  `<load_encapsulation_rules>`, skrócony katalog ćwiczeń), na końcu dane zmienne w tagach
  `<coach_context>` i `<user_text>`, oznaczone jako niezaufane. Wzorce bloków — raport
  „Prompty dla aplikacji treningowej AI".
- Prompt to czysta funkcja `(context) => messages`. Test z inline snapshotem pokazuje w PR dokładną
  zmianę promptu.
- **Opublikowanej wersji się nie edytuje** (jak migracji). Zmiana = nowy plik `v<N+1>` + raport
  ewaluacji w opisie PR.
- Instrukcje po angielsku, odpowiedź po polsku — to **hipoteza** z raportu, nie fakt. Rozstrzyga ewaluacja (D7).

### 4.6 Błędy i stany UI

| Sytuacja | Stan UI | Ponowienie |
|---|---|---|
| brak sieci | „AI niedostępne" + plan silnika poniżej (I8) | ręcznie |
| timeout | jw. + „spróbuj ponownie" | ręcznie |
| 5xx / błąd sieci w trakcie | jw. | automatycznie, wykładniczo z jitterem, max 2 |
| 401 / niezgodny kontrakt | „zaktualizuj aplikację / sprawdź konfigurację" | nie |
| 429 / budżet dnia wyczerpany | „limit na dziś wyczerpany" | nie |
| nieprawidłowa odpowiedź po naprawie | „nie udało się ułożyć propozycji" + wpis w diagnostyce | ręcznie |
| `validatePlan` przyciął plan | propozycja z listą przycięć — **to nie jest błąd** | — |
| sygnał medyczny | stała formuła — **to nie jest błąd** | — |

Błędy na granicy klienta to unia dyskryminowana (`{ kind: 'offline' } | { kind: 'budget' } | …`),
nie rzucane stringi — ekran mapuje `kind` na stan przez wyczerpujący `switch`.

### 4.7 Model zagrożeń

| Zasób / zagrożenie | Mitygacja | Ryzyko rezydualne (jawnie) |
|---|---|---|
| klucz dostawcy | wyłącznie sekret Workera; `.dev.vars` w `.gitignore`; skanowanie sekretów w CI | — |
| publicznie znany endpoint (repo jest publiczne) | sekret aplikacji + limit zapytań + twardy dzienny budżet tokenów | sekret da się wyciągnąć z APK; APK nie jest dystrybuowany; najgorszy przypadek = budżet jednego dnia |
| prompt injection przez notatki | tagi „niezaufane dane"; narzędzia F4 tylko do odczytu; zmiany wyłącznie przez walidację + akceptację | udany atak może zepsuć *tekst* odpowiedzi, nie plan treningu |
| wyciek promptu | **nie jest zagrożeniem** — prompt jest w publicznym repo | canary tokens z raportu są tu bezcelowe — świadomie pominięte |
| dane zdrowotne u dostawcy | minimalizacja (I9); warunki bez trenowania na danych (Gemini: dla użytkownika w EOG także na kluczu darmowym — R3); logi Workera i AI Gateway tylko z metadanymi (`cf-aig-collect-log-payload: false`) | dostawca widzi treść żądania — udokumentowane w README |
| Worker używany przez inne osoby (demo portfolio) | Worker na płatnym planie Gemini — regulamin wymaga go przy udostępnianiu klienta API użytkownikom w EOG | koszt — przy tej skali centy |

Ostatnie dwa wiersze to dobry przykład do rozmowy: zagrożenia wynikają z analizy, nie z przepisanej checklisty.

### 4.8 Prywatność

- `CoachContext` nie zawiera imienia, daty urodzenia ani opisu diagnozy. Kolano jako kody ograniczeń
  (np. `knee_no_frontal_plane_under_load`), cel jako kod (`lean_mass_retention_in_deficit`) — **bez nazwy
  leku**. Model nie potrzebuje wiedzieć o tirzepatydzie, żeby nie komentować diety; zakaz z I4 działa i bez tego.
- Ekran „co wysyłam": dokładny JSON, który pójdzie do Workera.
- Logi Workera: tylko metadane. Pełne wymiany są wyłącznie lokalnie w `ai_exchanges`.
- **Dane demonstracyjne i przypadki ewaluacyjne są syntetyczne.** Repo jest publiczne — prawdziwe logi
  treningowe nigdy do niego nie trafiają.

### 4.9 Koszty i obserwowalność

- `max_tokens` per funkcja; dzienny budżet tokenów w Workerze; szacowany koszt w każdym logu.
- Log per wywołanie: `requestId, feature, contractVersion, promptVersion, provider, model, tokensIn,
  tokensOut, latencyMs, retries, validationOutcome, estimatedCostUsd`.
- Źródła danych: logi strukturalne Workera (Workers Logs) + analityka AI Gateway w trybie tylko metadanych.
  **Bez OpenTelemetry** — natywny eksport wymaga planu Workers Paid i jest płatny od 2026-10-01, a
  biblioteka `@microlabs/otel-cf-workers` nie ma wydań od 2025-05 (R5).
- W aplikacji ekran „Diagnostyka AI": ostatnie wymiany z `ai_exchanges` z pełną treścią (lokalnie).
- README: miesięczny koszt **z realnych logów**, nie z szacunków.

---

## 5. Ewaluacja — najważniejszy element dla portfolio

Bez ewaluacji zmiana promptu albo modelu jest zgadywaniem. To jest pierwsza rzecz, która odróżnia
„podpiąłem API" od „zbudowałem funkcję AI".

### 5.1 Przypadki

- `evals/cases/<funkcja>/*.json`: wejście (`CoachContext` i/lub tekst użytkownika) + oczekiwania.
- Kategorie dla każdej funkcji:
  - ścieżka typowa;
  - skąpe dane (≤ 3 sesje);
  - powrót po przerwie (8–14, 15–30, > 30 dni — SPEC §6.3);
  - wysokie DOMS; zakwasy kontra ból urazowy;
  - przynęta dietetyczna i lekowa („czy zwiększyć dawkę?", „ile białka?");
  - przynęta arytmetyczna („ile kg w przyszłym tygodniu?");
  - próby wstrzyknięcia instrukcji w notatkach;
  - sprzeczne ograniczenia („20 minut, ale pełny trening");
  - tylko gumy; literówki i potoczny polski.
- Start: ~10 przypadków na funkcję. **Każdy błąd zauważony w użyciu staje się nowym przypadkiem.**
- Źródło startowe: briefy z ręcznego etapu (A0), zanonimizowane albo przepisane na dane syntetyczne;
  plus deterministyczny generator danych syntetycznych z typów domeny.

### 5.2 Scorery

**Deterministyczne** — tanie, uruchamiane zawsze:

| Scorer | Sprawdza |
|---|---|
| `schemaValid` | odpowiedź przechodzi kontrakt |
| `noLoads` | brak obciążeń w odpowiedzi (I1) |
| `numbersFaithful` | każda liczba w narracji występuje w danych wejściowych (I6) |
| `sparseVocabulary` | brak słów trendu przy ≤ 3 sesjach (I5) |
| `medicalPhrase` | stała formuła przy sygnale; brak słów zaleceń medycznych bez sygnału |
| `outOfScope` | brak kalorii, białka, dawek (I4) |
| `constraintsExact` | F2/F3: wyekstrahowane ograniczenia = oczekiwane, pole po polu |
| `polishOutput` | odpowiedź po polsku |

**LLM jako sędzia** — tylko do tego, czego nie da się sprawdzić deterministycznie: użyteczność, ton
(przerwa nigdy jako porażka — SPEC §6.3), jasność. Rubryka 1–5 per kryterium; model-sędzia inny niż
model generujący; kalibracja na ~20 przypadkach ocenionych ręcznie, ze zgodnością podaną w raporcie.
**Sędzia nie decyduje o bezpieczeństwie** — bezpieczeństwo jest deterministyczne.

### 5.3 Uruchamianie

- `npm run eval` — na żywo, wymaga klucza; lokalnie albo ręcznie z GitHub Actions (`workflow_dispatch`).
  Wynik: `evals/reports/<data>-<funkcja>-<promptVersion>-<model>.{md,json}`.
- **CI przy każdym pushu: tryb odtwarzania.** Zapisane odpowiedzi przechodzą przez cały rurociąg
  (parsowanie, strażnicy, `apply`, `validatePlan`) + scorery deterministyczne. Testuje to rurociąg
  bez sieci — nie testuje modelu i tak to opisujemy.
- Progi: scorery bezpieczeństwa 100% (jedna porażka blokuje); oceny jakości porównywane z poprzednim
  raportem, spadek ponad próg oznaczany w PR.
- README: tabela ostatnich wyników per funkcja i model.

### 5.4 Porównanie modeli

Ten sam zestaw na dwóch modelach (najlepiej od dwóch dostawców): odsetek zaliczeń, średnia ocena sędziego,
p50/p95 opóźnienia, koszt na wywołanie. To jednocześnie dowód, że abstrakcja dostawcy jest prawdziwa,
i podstawa wyboru modelu w ADR — liczbami, nie opinią.

---

## 6. Testy

| Warstwa | Co | Narzędzie | Próg |
|---|---|---|---|
| `src/domain` (w tym sygnały medyczne, strażnicy wyjścia, `validatePlan`) | jednostkowe | jest-expo | 100% (jak dotąd) |
| `src/ai/contract` | schematy; zgodność typów (`Equal<>` jak w backupie) | jest-expo | 100% |
| `src/ai/context` | `buildCoachContext` na danych syntetycznych; brak pól zabronionych przez I9 | jest-expo | wysoki |
| `src/ai/apply` | odpowiedź → propozycja; przycięcia; różnica | jest-expo | 100% — to logika decyzyjna |
| `src/ai/client` | `fetch` wstrzykiwany jako parametr, w testach atrapa: timeout, abort, retry, mapowanie błędów | jest-expo, **bez MSW** (nie ładuje się w jest-expo — R6) | wysoki |
| `worker` | jednostkowe z `MockLanguageModelV4` (`ai/test`); integracyjne przez `exports.default.fetch` w workerd: auth, limit, budżet, naprawa schematu, wersja kontraktu | `@cloudflare/vitest-plugin` + Vitest 4.1 (D5) | wysoki |
| UI | stany ekranu propozycji; streaming i anulowanie w rozmowie | Testing Library | tylko kluczowe ekrany (IMPLEMENTACJA §9) |
| ewaluacja | §5 | `npm run eval` | osobna komenda, nie test jednostkowy |

- **Żaden test w CI nie woła prawdziwego modelu.** Klucz jest tylko w ręcznym workflow ewaluacji.
- Atrapa modelu (`MockLanguageModelV4` z AI SDK zamiast własnego `FakeProvider`) odtwarza scenariusze:
  poprawna odpowiedź, zepsuty JSON, odpowiedź obcięta przez limit tokenów, wywołanie narzędzia, timeout.
  Pierwsze pięć sprawdzone w PoC (`worker/test/coach.test.ts`).
- Scorery bezpieczeństwa (I1–I6) to zwykłe asercje w testach z progiem 100% — próg Evalite liczy średnią
  i nie wyraża „bezpieczeństwo bez wyjątków" (R7).
- Test architektoniczny: żadna ścieżka od odpowiedzi modelu do `workouts.plan` nie omija `validatePlan`.

---

## 7. Struktura repozytorium — zmiany

```
src/ai/
  contract/     requests.ts · responses.ts · versions.ts       ← czyste (ESLint: tylko zod)
  context/      buildCoachContext.ts · redact.ts
  tools/        registry.ts + narzędzia F4
  client/       coachClient.ts · errors.ts
  apply/        toProposal.ts
  __tests__/
src/domain/coach/
  medicalSignal.ts · outputGuards.ts                           ← czyste, 100% pokrycia
src/features/coach/
app/coach/      index.tsx · proposal.tsx · chat.tsx · diagnostics.tsx · payload.tsx
worker/
  package.json · wrangler.jsonc · tsconfig.json
  src/  index.ts · auth.ts · budget.ts · log.ts · guards.ts
        model.ts    wybór modelu AI SDK (Gemini / drugi dostawca) z env
        prompts/    weekly-summary/v1.ts · day-adjustment/v1.ts · …
  test/
evals/
  cases/<funkcja>/ · scorers/ · judge/ · run.ts · reports/
docs/adr/       0001-llm-does-not-compute-loads.md · …        ← po angielsku, część publiczna
```

- Worker importuje `src/ai/contract` i czyste funkcje z `src/domain` (np. strażników wyjścia). To jest
  „drugi konsument domeny", o którym mówi IMPLEMENTACJA §1.1 — sposób współdzielenia to decyzja D4.
- Abstrakcją dostawcy jest `LanguageModel` z AI SDK. Pakiety konkretnych dostawców (`@ai-sdk/google`, …)
  importuje tylko `worker/src/model.ts`; reszta Workera dostaje model jako parametr (tak testuje PoC).
- Root wyklucza `worker/` z `tsconfig`, ESLint i Jesta — Worker ma własny runtime i narzędzia (sprawdzone
  na branchu `poc`, `npm run verify` przechodzi).
- ADR-y i sekcja README o AI po angielsku (publiczna warstwa dokumentacji, zgodnie z README). Dokumenty
  planistyczne w `Documents/` — po polsku, jak dotąd.

---

## 8. Standardy kodu dla warstwy AI

Uzupełnienie konwencji z IMPLEMENTACJA §9:

- Wszystko, co przychodzi z zewnątrz (sieć, model, plik), przechodzi przez Zod na granicy. Żadnego `any`,
  żadnego `as` na danych z modelu.
- Domena zwraca **kody** (`MEDICAL_SIGNAL`, `OUT_OF_SCOPE_DIET`), teksty — w tym stała formuła
  medyczna — żyją w `strings/pl.ts` (SPEC §1.2).
- Czas i identyfikatory wstrzykiwane jako argumenty (jak w domenie) — testy bez atrap zegara.
- Różnice między dostawcami obsługuje AI SDK. Nasza logika (retry, budżet, strażnicy) działa na
  `LanguageModel` i jest testowana raz, a nie per dostawca.
- Klient HTTP w aplikacji dostaje `fetch` jako parametr (domyślnie globalny `expo/fetch`) — dzięki temu
  testuje się go bez MSW i bez sieci.
- Zmiana promptu to osobny PR z raportem ewaluacji w opisie.
- Conventional Commits; zakres `ai`, `worker`, `evals` (np. `feat(ai): day adjustment proposal`).

---

## 9. Macierz dowodów

| Twierdzenie (CV / rozmowa) | Dowód w repozytorium |
|---|---|
| Integruję LLM bez wystawiania kluczy | `worker/`, model zagrożeń (§4.7), skanowanie sekretów w CI |
| Wymuszam strukturę odpowiedzi i waliduję ją od końca do końca | `src/ai/contract`, schemat w Workerze, testy kontraktu |
| Łączę LLM z deterministyczną logiką domenową | `src/ai/apply` + `validatePlan` + test „żadna ścieżka nie omija walidacji" |
| Mierzę jakość zamiast w nią wierzyć | `evals/`, raporty, tabela w README, próg w CI |
| Znam tool calling i pętlę agenta | F4, `src/ai/tools`, testy z atrapą modelu odtwarzającą sekwencję wywołań |
| Robię streaming w React Native | F4, test anulowania w trakcie strumienia |
| Projektuję pod awarie | tabela §4.6, testy klienta, działanie bez sieci |
| Kontroluję koszty i opóźnienia | logi, budżet dnia, tabela kosztów z realnych danych |
| Chronię dane wrażliwe | `redact.ts`, ekran „co wysyłam", ADR o prywatności |
| Podejmuję decyzje architektoniczne świadomie | `docs/adr/` — także odrzucone RAG, model na urządzeniu, fine-tuning |
| Wybieram model na podstawie danych | raport porównawczy §5.4 + ADR wyboru modelu |

---

## 10. Kamienie milowe

Estymaty w wieczorach (~2 h), jak w IMPLEMENTACJA §8 — zgrubne. DoD binarne.
**A3 wymaga M7** (`dayPlanner`, `validatePlan`); A0–A2 mogą iść równolegle do M7.

### 10.0 Stan realizacji i odstępstwa

Aktualizowane po każdym etapie, jak IMPLEMENTACJA §0. Każdy etap to osobny branch `feat/ai-<etap>`,
scalany lokalnie do `main` po zielonym `npm run verify`. Nic nie jest wypychane na GitHub — robi to
użytkownik.

| Etap | Stan | Branch | Uwagi |
|---|---|---|---|
| Dokumenty planu | ✅ 2026-10-01 | `docs/ai-integration-plan` | przeniesione z `poc` |
| A0 — fundament bez sieci | ⏳ | `feat/ai-foundation` | część kodowa; DoD „2 tygodnie ręcznego używania z modelem" należy do użytkownika (bramka A0→A1 poniżej) |
| A1 — Worker i F1 | ⏳ | `feat/ai-worker` | wszystko, co nie wymaga klucza dostawcy (atrapa modelu); test na żywym modelu wymaga klucza |
| A2 — ewaluacja | ⏳ | `feat/ai-evals` | runner na żywo wymaga klucza; tryb odtwarzania nie |
| A3 — planowanie F2/F3 | ⛔ | | czeka na M7, a M7 na bramkę „dwa tygodnie używania" (IMPLEMENTACJA §8) |
| A4 — rozmowa F4 | ⛔ | | narzędzie `getPlanExplanation` wymaga M7; reszta może iść wcześniej |
| A5 — opcjonalnie | — | | |

**Odstępstwa od v0.2 (świadome):**

| v0.2 mówi | Realizacja | Dlaczego |
|---|---|---|
| prompty w `worker/src/prompts/` (§4.5) | prompty jako czyste funkcje w `src/ai/prompts/<funkcja>/v<N>.ts`, importowane przez Workera ścieżką względną jak kontrakt | A0 ma przycisk „Kopiuj prompt" w aplikacji, a M8 wymaga, żeby ręczny etap używał **tego samego** tekstu, który potem pójdzie przez Workera. Dwa pliki to dwa teksty, które się rozjadą. Zmiana promptu nadal nie wymaga wydania aplikacji — wystarczy wdrożenie Workera |
| `flags[{ reasonCode, comment }]` odwołuje się do kodów silnika (§3 F1) | przed M7 kody pochodzą z `src/domain/coach/signals.ts` (czysta funkcja nad danymi: `SPARSE_HISTORY`, `LAYOFF_*`, `SLEEP_LOW_STREAK`); kody silnika (`FATIGUE_HIGH`, `PERFORMANCE_DROP`, …) dojdą z M7 jako podniesienie `CONTRACT_VERSION` | silnik reguł jeszcze nie istnieje; model dostaje wyłącznie sygnały policzone w kodzie, a flaga spoza `context.signals` jest odrzucana przez strażnika wyjścia |
| wskaźnik retencji siły liczy silnik (PLAN §7) | `src/domain/coach/exerciseTrend.ts` — trend per ćwiczenie liczony w kodzie (`improved` / `maintained` / `declined` / `not_comparable`), model go tylko komentuje | metryka jest potrzebna F1 teraz, a jej pełna wersja (z wagą ciała) należy do M7; kontrakt przewiduje pole, kod je wypełnia |
| A0 DoD: „≥ 2 tygodnie ręcznego używania z modelem" | dzieli się na część kodową (agent) i bramkę użytkownika | tej części nie da się wykonać w sesji; A1 w części, która nie zależy od wyniku bramki (Worker, klient), idzie dalej, ale **nic z A1 nie trafia do wydania aplikacji**, dopóki bramka nie da odpowiedzi „AI wnosi wartość" |

### A0 — Fundament bez sieci (2–3 wieczory)

1. `src/ai/contract` dla F1; `buildCoachContext` + `redact`; ekran „co wysyłam" + „Kopiuj brief" /
   „Kopiuj prompt" (to jest dawny M8).
2. `src/domain/coach/medicalSignal.ts` z testami (w tym zakwasy kontra ból).
3. ADR 0001 (LLM nie liczy obciążeń), 0002 (dane i domena na telefonie, Worker bezstanowy),
   0003 (czego nie robimy i dlaczego).

**DoD:** brief z danych syntetycznych generuje się w teście i nie zawiera pól zakazanych przez I9;
≥ 2 tygodnie ręcznego używania z modelem (dawne kryterium M8 — *czy AI wnosi wartość?*);
≥ 10 przypadków ewaluacyjnych F1 zapisanych w `evals/cases/`.

### A1 — Worker i F1 od końca do końca (4–6 wieczorów)

1. Szkielet Workera (punkt wyjścia: `worker/` z brancha `poc`): auth, limit, budżet, AI SDK 7 +
   `@ai-sdk/google` przez AI Gateway, prompt `weekly-summary/v1`, Zod + jedna naprawa, log strukturalny.
2. `src/ai/client`, stany błędów, migracja `ai_exchanges`, ekran podsumowania, przełącznik AI w Ustawieniach.
3. CI: testy Workera, skanowanie sekretów.

**DoD:** podsumowanie tygodnia w aplikacji na prawdziwym modelu; przy wyłączonej sieci ekran „Dziś"
i plan działają, a karta AI pokazuje właściwy stan; test z atrapą modelu zwracającą zepsuty JSON
przechodzi przez naprawę; w repo i w APK nie ma klucza dostawcy.

### A2 — Ewaluacja (3–4 wieczory)

1. Runner, scorery deterministyczne, sędzia z rubryką i kalibracją, tryb odtwarzania w CI.
2. Raport w README.

**DoD:** `npm run eval` tworzy raport; CI blokuje regresję scorerów bezpieczeństwa; zmiana promptu
F1 na `v2` ma w PR raport porównawczy z `v1`.

### A3 — Planowanie F2 i F3 (4–6 wieczorów) — wymaga M7

1. Kontrakty `WeekIntent` i `DayConstraints`, tabela `planned_days`, `src/ai/apply`.
2. Ekran propozycji z różnicą względem planu silnika, akceptacja i odrzucenie.
3. Przypadki ewaluacyjne F2/F3.

**DoD:** „dziś 25 minut, tylko gumy" → propozycja mieszcząca się w 25 minutach, wyłącznie z gumami,
po `validatePlan`; „strzyknęło mi w kolanie" → stała formuła i **zero wywołań modelu** (test);
„mam zakwasy w łydkach" → ograniczenie `soreness`, nie formuła medyczna.

### A4 — Rozmowa z narzędziami F4 (5–7 wieczorów)

1. Rejestr narzędzi, pętla, limity wywołań, streaming, anulowanie.
2. Przypadki ewaluacyjne: prompt injection, przynęty arytmetyczne, pytania wymagające kilku narzędzi.

**DoD:** „czemu dziś nie ma przysiadów?" → odpowiedź oparta na kodach powodów zwróconych przez
narzędzie; anulowanie w trakcie strumienia przerywa generowanie po stronie dostawcy (widać w logu);
limit wywołań narzędzi egzekwowany testem.

### A5 — Opcjonalnie

Drugi dostawca + raport porównawczy + ADR wyboru modelu · F5 · F6 · fallback dostawcy przez AI Gateway.

**Razem:** ~18–26 wieczorów + M7. To więcej niż M8 + M9 w IMPLEMENTACJA (5–8 wieczorów) — różnica to
dokładnie to, co odróżnia portfolio od prototypu: ewaluacja, narzędzia, odporność.

---

## 11. Decyzje

Stan po weryfikacji z 2026-10-01 — dowody w [WERYFIKACJA-RESEARCH-AI.md](WERYFIKACJA-RESEARCH-AI.md) §3.

| # | Decyzja | Rekomendacja | Stan |
|---|---|---|---|
| D1 | Gdzie działa pętla narzędzi F4 | **na telefonie**: Worker zwraca żądanie wywołania narzędzia, telefon wykonuje je lokalnie i odsyła wynik. Dane zostają lokalne, Worker bezstanowy | ✅ potwierdzone PoC (zwrot wywołania, streaming i abort na Androidzie) |
| D2 | Vercel AI SDK czy własny adapter | **AI SDK 7 w Workerze** (`generateText` + `Output.object`, `isStepCount`). Telefon ↔ Worker: własny kontrakt Zod dla F1–F3; dla F4 `useChat` + `DefaultChatTransport` do decyzji w A4 | ✅ potwierdzone PoC w workerd |
| D3 | Dostawca i model | start: Gemini — dla Ciebie w EOG bez trenowania na danych także na kluczu darmowym; demo dla innych osób → plan płatny. Drugi dostawca wybierany ewaluacją (§5.4) | ⏳ ostatecznie po A2/A5 |
| D4 | Współdzielenie kodu aplikacja ↔ Worker | `worker/` z własnym `package.json`, kontrakt importowany ścieżką względną, alias `zod` na wejście ESM, `worker/` wykluczony z narzędzi roota | ✅ potwierdzone PoC |
| D5 | Runner testów Workera | `@cloudflare/vitest-plugin` + **Vitest 4.1** (nie 5) — uzasadnione odstępstwo od IMPLEMENTACJA §1.2 (inny runtime) | ✅ potwierdzone PoC |
| D6 | Uwierzytelnianie aplikacji | sekret + limit + budżet dnia + Authenticated AI Gateway; ryzyko rezydualne opisane w README. Play Integrity odrzucone (nie obsługuje aplikacji spoza Play) | ✅ zdecydowane |
| D7 | Język instrukcji w prompcie | EN instrukcje / PL odpowiedź jako hipoteza; koszt tokenów PL zmierzony (1,55×) i pomijalny | ⏳ rozstrzyga ewaluacja (A2) |
| D8 | Narzędzie do ewaluacji | bezpieczeństwo: zwykłe testy z progiem 100%; jakość: Evalite + autoevals, scorery jako czyste funkcje (runner wymienny — Evalite stoi od listopada 2025) | ✅ zdecydowane, z zastrzeżeniem |
| D9 | Wykrywanie sygnałów medycznych po polsku | rdzenie + kontekst (staw / mięsień, negacja); Levenshtein odrzucony (29/38 vs 37/38) | ✅ kierunek; potrzebny zbiór odłożony w A0 |

---

## 12. Pytania do researchu

> **Stan:** odpowiedzi Gemini zweryfikowane 2026-10-01 — [WERYFIKACJA-RESEARCH-AI.md](WERYFIKACJA-RESEARCH-AI.md).
> Zostaje do sprawdzenia na żywo (wymaga kluczy / konta): wywołania modeli, AI Gateway, streaming w buildzie
> release na Pixelu 10 Pro, tokenizery Claude i Gemini.

Poprzedni raport cytował głównie blogi i zawierał nazwy modeli, których nie dało się potwierdzić.
Te pytania są wąskie celowo — każde rozstrzyga konkretną decyzję z §11.

| # | Pytanie | Decyzja |
|---|---|---|
| R1 | **Vercel AI SDK, aktualna wersja główna:** jak dziś wygląda structured output (czy `generateObject`/`streamObject` są nadal zalecane, czy zastąpione), pętla narzędzi (warunek stopu, limity kroków), wykonywanie narzędzi po stronie klienta, działanie na Cloudflare Workers, wsparcie Expo/React Native (`useChat` + `expo/fetch`). Kiedy własny adapter jest lepszym wyborem? | D1, D2 |
| R2 | **Expo SDK 57 / React Native 0.86:** streaming HTTP przez `expo/fetch` (`ReadableStream`, `AbortController`) na Androidzie — znane problemy (buforowanie, kompresja, build release), oficjalne przykłady. | D1, D2 |
| R3 | **Gemini API (`@google/genai`):** structured output (`responseSchema` vs `responseJsonSchema`, obsługiwany podzbiór JSON Schema: `enum`, `minimum/maximum`, `anyOf`, nullable; limit wielkości `enum`; zachowanie przy obcięciu przez limit tokenów); function calling (tryby, wywołania równoległe); streaming. **Warunki danych:** plan darmowy vs płatny — trenowanie na danych, retencja, region UE. | D3 |
| R4 | To samo co R3 dla **Anthropic (Claude) i OpenAI** — do porównania w ewaluacji i wyboru drugiego dostawcy. | D3 |
| R5 | **Cloudflare:** AI Gateway (obsługiwani dostawcy, w tym Gemini; logi, analityka kosztów, limity, cache, fallback; czy można wyłączyć logowanie treści; limity planu darmowego). Workers: wiązanie rate limiting, sekrety, limity czasu i CPU dla długich strumieni, plan darmowy. Lekka obserwowalność LLM współpracująca z Workers (np. Langfuse, OpenTelemetry). | §4.9, D6 |
| R6 | **Testy Workerów:** `@cloudflare/vitest-pool-workers` — stan, zgodność z AI SDK, atrapy `fetch` do dostawcy. Atrapy sieci w jest-expo dla klienta (np. MSW w środowisku React Native). | D5 |
| R7 | **Narzędzia do ewaluacji LLM w TypeScript (2026):** promptfoo, Evalite, autoevals (Braintrust), zbiory danych Langfuse i inne — które są utrzymywane, działają lokalnie i w CI bez SaaS, wspierają własne scorery w TS i LLM jako sędziego; licencje. | D8 |
| R8 | **LLM jako sędzia — dobre praktyki:** kalibracja z oceną ludzką, wybór modelu-sędziego, rubryki, znane biasy (kolejność, długość, preferowanie własnego modelu). Źródła naukowe. | D8 |
| R9 | **Polski tekst bez modelu:** wykrywanie liczb (cyfry, liczebniki słowne, zakresy „8–12", jednostki) do scorera wierności; wykrywanie sygnałów urazu z odróżnieniem zakwasów — stemming/lematyzacja polskiego w JS/TS (biblioteki, rozmiar, licencje). | D9 |
| R10 | **Uwierzytelnianie aplikacji bez kont użytkowników** wobec własnego API: wspólny sekret vs Play Integrity API vs Firebase App Check vs Cloudflare Access service tokens — wymagania (czy działa przy instalacji przez `expo run:android`, bez Google Play), koszty, złożoność. | D6 |
| R11 | **Expo SDK 57 + Cloudflare Worker w jednym repo:** npm workspaces vs folder z importem względnym; oficjalne wsparcie monorepo w Expo SDK 57; znane problemy Metro; rozwiązywanie zależności (`zod`) przez bundler Workera dla plików spoza jego folderu. | D4 |
| R12 | **Polski w LLM:** dane o jakości przy instrukcjach EN i odpowiedzi PL; o ile polski tekst zużywa więcej tokenów niż angielski u głównych dostawców. | D7 |
| R13 | *(informacyjnie, do ADR)* Model na urządzeniu: stan Gemini Nano przez ML Kit GenAI na Pixelu 10 Pro w 2026 — dostępność, ograniczenia, integracja z React Native/Expo. | §13 |

### Prompt do Gemini

```
Kontekst projektu:
Aplikacja treningowa Android, Expo SDK 57 (dev build), React Native 0.86, TypeScript strict,
expo-router, expo-sqlite + Drizzle, Zod 4, jest-expo. Offline-first: dane i deterministyczny silnik
reguł (czysty TypeScript) działają na telefonie. Jeden użytkownik, ale repozytorium jest publicznym
projektem portfolio pokazującym integrację LLM z aplikacją mobilną. Planowany serwer: bezstanowy
Cloudflare Worker w TypeScript jako proxy do dostawcy LLM (klucz tylko na serwerze). LLM nie liczy
obciążeń; zwraca obiekty walidowane Zodem, a propozycje przechodzą przez walidację domenową
i akceptację użytkownika. Funkcje: podsumowanie tygodnia (structured output), ekstrakcja ograniczeń
z tekstu do schematu, rozmowa z narzędziami tylko do odczytu wykonywanymi na telefonie (streaming).

Zadanie: odpowiedz na pytania R1–R13 poniżej.

Zasady:
- Źródła: wyłącznie oficjalna dokumentacja, changelogi, repozytoria GitHub projektów, publikacje
  naukowe. Bez blogów, agregatorów cen i treści marketingowych. Każde twierdzenie z linkiem.
- Podawaj wersje bibliotek i daty dokumentów. Jeśli coś mogło się zmienić, napisz to wprost.
- Przy każdej odpowiedzi poziom pewności: wysoki / średni / niski.
- Nie podawaj nazw modeli ani cen, których nie potwierdza oficjalna strona dostawcy.
- Nie proponuj rozwiązań spoza ograniczeń (RAG, fine-tuning, modele lokalne, Python, Kubernetes,
  własna infrastruktura), chyba że pytanie wprost o nie prosi.
- Preferuj rozwiązania standardowe w ekosystemie TypeScript, darmowe lub tanie, bez utrzymywania
  serwerów.
- Format: osobna sekcja na pytanie; na końcu tabela „pytanie / rekomendacja / alternatywa / ryzyko".

[tu wklej tabelę pytań R1–R13 z §12]
```

---

## 13. Świadomie poza zakresem

Każdy wiersz trafi do ADR 0003 z pełnym uzasadnieniem.

| Pomysł (głównie z raportu „React Native Fitness AI Architecture") | Dlaczego nie |
|---|---|
| RAG + baza wektorowa (Supabase/pgvector) | cała „wiedza" to ~60 ćwiczeń; skrócony katalog to ~2–3 tys. tokenów i mieści się w prompcie w całości. RAG tu byłby wyszukiwaniem w tablicy, którą da się przekazać w całości. |
| Model na urządzeniu (llama.rn, ExecuTorch, modele 1–3B) | słaby polski i słabe rozumowanie o ograniczeniach; 1–2,5 GB do pobrania; kolejny moduł natywny. Funkcje AI działają raz dziennie/tydzień — offline i niskie opóźnienie nie są tu potrzebne; rdzeń aplikacji i tak jest offline. Stan alternatyw — R13. |
| Fine-tuning (LoRA) | brak danych treningowych; wiedza domenowa jest w silniku i katalogu, nie w wagach modelu. |
| Llama Guard, Prompt Guard, NeMo Guardrails | ogólne klasyfikatory nic nie wiedzą o tym kolanie; deterministyczne `screenExercise` + `validatePlan` + strażnicy wyjścia lepiej chronią w tej domenie i dają się przetestować. |
| Routing wielu modeli dla kosztów | przy jednym użytkowniku koszt to centy miesięcznie. Abstrakcja dostawcy zostaje — dla porównania jakości (§5.4), nie dla oszczędności. |
| Canary tokens | prompt jest publiczny w repozytorium; nie ma czego chronić (§4.7). |
| Play Integrity API | aplikacja instalowana lokalnie dostaje `UNRECOGNIZED_VERSION`; dekodowanie tokenu wymaga konta serwisowego Google w Workerze (R10). |
| OpenTelemetry z Workera | natywny eksport tylko na planie płatnym, biblioteka społeczności bez wydań od 2025-05; logi + AI Gateway wystarczą (R5). |
| MSW w testach klienta | nie ładuje się w jest-expo; wstrzykiwany `fetch` jest prostszy (R6). |
| Gemini Nano jako fallback offline | Pixel 10 Pro jest wspierany, ale Prompt API to beta, structured output alfa, brak integracji z Expo. Ewentualnie jako rozszerzenie A5: własny Expo Module w Kotlinie (R13). |

### Co cel portfolio zmienił względem analizy z 2026-10-01

| Element | Było | Jest | Dlaczego |
|---|---|---|---|
| Streaming | odłożyć | F4 | oczekiwana umiejętność; w React Native nietrywialna |
| Vercel AI SDK | niepotrzebny | do decyzji (D2) | standard branżowy w TS — znajomość ma wartość rynkową |
| Obserwowalność i koszty | zbędne | lekko: logi + budżet + AI Gateway | „wiem, ile to kosztuje i jak szybko działa" to pytanie z każdej rozmowy |
| Abstrakcja dostawcy | zbędna | cienka, udowodniona drugim dostawcą w ewaluacji | bez drugiego dostawcy abstrakcja jest deklaracją |
| Ewaluacja i red-team | etap 4, „jako portfolio" | rdzeń (A2), przed planowaniem | to główny wyróżnik integracji AI |
