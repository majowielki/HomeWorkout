# Weryfikacja raportu Gemini „Analiza Architektury Aplikacji Treningowej"

> Data: 2026-10-01. Branch: `poc`. Dokument nadrzędny: [AI-INTEGRACJA.md](AI-INTEGRACJA.md) §12 (pytania R1–R13).
> Raport traktowany jako drogowskaz: każde twierdzenie sprawdzone w oficjalnej dokumentacji,
> w typach / kodzie źródłowym zainstalowanych pakietów albo uruchomieniem PoC.
> Bez kluczy API — niczego nie wysłano do żadnego modelu (§4).

Legenda: ✅ potwierdzone · ⚠️ częściowo / nieaktualne · ❌ nieprawdziwe · ⚪ nie weryfikowane (bez wpływu na decyzje)

---

## 1. Podsumowanie

| # | Temat | Werdykt | Najważniejsze |
|---|---|---|---|
| R1 | Vercel AI SDK | ⚠️ | kierunek dobry (`generateText` + `Output.object`), ale `maxSteps` **nie istnieje** w v7, a `customProvider` służy do czego innego |
| R2 | Streaming `expo/fetch` na Androidzie | ✅ | potwierdzone w źródłach i **na emulatorze**: przyrostowo, z gzip też, abort dochodzi do serwera |
| R3 | Gemini: schematy i dane | ⚠️ / ❗ | ograniczenia schematów nieaktualne (`responseJsonSchema` obsługuje `anyOf`); raport **pominął klauzulę EOG**, która dotyczy Ciebie wprost |
| R4 | Claude / OpenAI | ⚠️ | nieaktualne modele; przepis `tool_choice: any` daje 400 na obecnych modelach; ZDR to umowa, nie domyślne zachowanie |
| R5 | Cloudflare AI Gateway / Workers | ✅ / ⚠️ | gateway i limity potwierdzone; biblioteka OTel nieutrzymywana, natywny eksport OTel jest płatny |
| R6 | Testy Workera, MSW | ⚠️ / ❌ | zgłoszony błąd jest **zamknięty** i nas nie dotyczy; MSW **nie działa** w jest-expo |
| R7 | Evalite + autoevals | ⚠️ | oba MIT i działają; Evalite stoi od listopada 2025 i jest na AI SDK 5 |
| R8 | LLM jako sędzia | ✅ | prace istnieją, zalecenia spójne z planem |
| R9 | Polski tekst bez modelu | ❌ (rekomendacja) | zmierzone: Levenshtein bez kontekstu 29/38, rdzenie + kontekst 37/38 |
| R10 | Play Integrity | ❌ | „od 1.4.0 obsługuje sideload" — w dokumentacji nie ma; aplikacja spoza Play dostaje `UNRECOGNIZED_VERSION` |
| R11 | Monorepo / współdzielony Zod | ✅ (z poprawką) | duplikacja Zoda w bundlu **realna** — naprawiona aliasem, 392 → 274 KiB gzip |
| R12 | Polski a tokeny | ✅ kierunek / ❌ źródła | zmierzone 1,55× (o200k); jeden cytat ma nieistniejący identyfikator arXiv |
| R13 | Gemini Nano (ML Kit) | ⚠️ | Pixel 10 Pro jest na liście; API beta, structured output alpha, brak integracji z Expo |

---

## 2. Szczegóły

### R1 — Vercel AI SDK

Stan na 2026-10-01: `ai` **7.0.126**, `@ai-sdk/react` 4.0.129, `@ai-sdk/google` 4.0.87.

| Twierdzenie raportu | Werdykt | Dowód |
|---|---|---|
| `generateObject`/`streamObject` zdeprecjonowane w v6 i usunięte w nowszych | ⚠️ | w v7 nadal eksportowane z `@deprecated Use generateText with an output setting` (`ai/dist/index.d.ts`); przewodnik migracji 7.0 ich nie usuwa |
| standard: `generateText` + `output: Output.object()` | ✅ | typy + test PoC `worker/test/coach.test.ts` |
| `experimental_output` usunięte w v7 | ✅ | przewodnik migracji 7.0 |
| pętla narzędzi: `maxSteps` | ❌ | 0 wystąpień `maxSteps` w typach v7. v5/v6: `stopWhen: stepCountIs(n)`; **v7: `isStepCount(n)`**. Domyślny limit `ToolLoopAgent` w v6: 20 kroków |
| `customProvider` do nadpisania base URL na AI Gateway | ⚠️ | `customProvider` istnieje w v7, ale służy do aliasów modeli. Base URL i nagłówki ustawia się w `createGoogleGenerativeAI({ baseURL, headers })` (typy) |
| narzędzia po stronie klienta w `useChat` | ✅ | typy: `onToolCall`, `addToolOutput` (`addToolResult` zdeprecjonowane), `sendAutomaticallyWhen`, `DefaultChatTransport({ fetch })`. PoC: narzędzie bez `execute` kończy krok i oddaje wywołanie (1 wywołanie modelu) |
| `strict: true` w definicji narzędzia | ✅ | `@ai-sdk/provider-utils` — pole `strict?: boolean` |
| `inputTokenDetails` / `outputTokenDetails` | ✅ | przewodnik migracji 6.0 |

**Ustalenia ponad raport:**
- v7: tylko ESM, Node 22+, `system` → `instructions`, telemetria w `@ai-sdk/otel`, atrapa `MockLanguageModelV4` w `ai/test`.
- Provider Google wysyła **`responseJsonSchema`** i sam zamienia `const` na jednoelementowy `enum` (`sanitizeResponseJsonSchema` w `@ai-sdk/google`). To konkretny argument za SDK: różnice między dostawcami obsługuje adapter.
- Oficjalny przewodnik AI SDK dla Expo (52+) wymienia polyfille `structuredClone`, `TextEncoderStream`, `TextDecoderStream`. **W SDK 57 są zbędne** — Expo instaluje je samo (`expo/src/winter/runtime.native.ts`).

### R2 — `expo/fetch` i streaming na Androidzie

| Twierdzenie | Werdykt | Dowód |
|---|---|---|
| `expo/fetch` instalowany jako globalny `fetch` | ✅ | dokumentacja SDK 57 + `runtime.native.ts:40–52` |
| `EXPO_PUBLIC_USE_RN_FETCH=1` przywraca fetch RN | ✅ | jw. |
| `TextDecoder` tylko UTF-8 | ✅ | dokumentacja SDK 57 |
| `AbortController` przerywa strumień | ✅ | `fetch.ts`: abort zamyka strumień ciała, potem anuluje żądanie natywne; **PoC poniżej** |
| szczegóły „C++ JSI, natychmiastowe zwolnienie zasobów" | ⚪ | nieistotne dla decyzji |

**PoC na emulatorze** (`app/poc/stream.tsx` + `poc/sse-server.mjs`; Pixel_API36, Android 16, x86_64, build debug, `adb reverse`):

| Test | Wynik |
|---|---|
| SSE, 20 fragmentów co 300 ms | 20 osobnych odczytów, odstęp ~305 ms, całość 6,2 s — **bez buforowania** |
| to samo z `Content-Encoding: gzip` (`Z_SYNC_FLUSH`) | identycznie — gzip nie buforuje |
| abort po ~2,2 s | w aplikacji `AbortError`; serwer: `CLIENT CLOSED after 7/20 chunks` — **zerwanie dochodzi do serwera** |

Nie sprawdzone: build release, prawdziwy Pixel 10 Pro, TLS przez internet, Cloudflare po drodze.

### R3 — Gemini API

| Twierdzenie | Werdykt | Dowód |
|---|---|---|
| głównym mechanizmem jest `responseSchema` | ⚠️ | `@google/genai` 2.25 ma też **`responseJsonSchema`** (JSON Schema). Komentarz w typach: „If `response_schema` doesn't process your schema correctly, try using `response_json_schema`". Nowe przykłady w dokumentacji używają `response_format` (Interactions API) |
| `anyOf`/`oneOf` odrzucane (`INVALID_ARGUMENT`) | ❌ dla `responseJsonSchema` | obsługiwane: `$ref`, `$defs`, `enum`, `anyOf`, `oneOf` (jako `anyOf`), `minimum`/`maximum`, `minItems`/`maxItems`, `prefixItems`. Raport opiera się na wątkach forum z lat 2024–2025 |
| `const` nieobsługiwane | ✅ | tak wynika z sanitizera AI SDK; nasz kontrakt i tak unika `z.literal` |
| obcięcie przez limit tokenów → uszkodzony JSON | ✅ (ogólne) | AI SDK rzuca `NoObjectGeneratedError`; PoC to obsługuje (test „truncated"). `jsonchunk`/`vectorjson` niepotrzebne |
| równoległe wywołania funkcji | ⚪ | niepotrzebne w F1–F4 |
| plan darmowy: dane do ulepszania produktów + recenzenci ludzcy | ✅ | regulamin, wersja z 2026-04-28 |
| płatny plan = podpięty Cloud Billing | ✅ | jw. |

**❗ Pominięte przez raport** (regulamin, cytaty dosłowne):

> „If you're in the European Economic Area, Switzerland, or the United Kingdom, the terms under 'How Google uses Your Data' in 'Paid Services' apply to all Services, including Google AI Studio and unpaid quota in the Gemini API, even though they are offered free of charge."

> „You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom."

Skutek: **dla Ciebie w Polsce darmowy klucz nie oznacza trenowania na danych.** Jeśli jednak aplikację będzie używał ktoś inny w EOG (np. demo z Twoim Workerem dla rekrutera), Worker musi działać na płatnym planie.

### R4 — Anthropic (Claude) i OpenAI

Źródło: referencja Claude API (stan 2026-09-25) + dokumentacja „API and data retention".

| Twierdzenie | Werdykt | Dowód |
|---|---|---|
| modele „Claude 3.5 Sonnet / 3.7" | ❌ nieaktualne | obecne: Opus 5.5, Sonnet 5.5, Haiku 4.5 |
| structured output przez `tool_choice: {type: "any"}` + `strict: true` | ❌ na obecnych modelach | wymuszone `tool_choice` `any`/`tool` zwraca **400** na Opus 5.5 / Sonnet 5.5 / Fable 5.1. Poprawnie: `output_config.format` (JSON Schema) albo `strict: true` przy `tool_choice: auto` |
| schemat cache'owany 24 h | ✅, ale inny sens | to cache **skompilowanej gramatyki**, nie cecha ZDR. Dokumentacja: schematy są cache'owane osobno od treści i nie mają tych samych zabezpieczeń — **w schematach (nazwy pól, wartości `enum`) nie umieszczać danych wrażliwych** |
| cytowania + structured outputs → 400 | ✅, ale inny powód | ogólna niezgodność funkcji, niezwiązana z ZDR |
| ZDR jako standard Anthropic | ⚠️ | ZDR to **umowa** (kontrakt / przedstawiciel handlowy), nie zachowanie domyślne. Domyślnie: „Retained data is never used for model training without your express permission" |
| — | ℹ️ | structured outputs Claude **nie egzekwują** `minimum`/`maximum`/`minLength`/`maxLength` (SDK usuwa je ze schematu i sprawdza po stronie klienta) |
| polityka danych OpenAI | ⚪ | bez wpływu na decyzje |

### R5 — Cloudflare

| Twierdzenie | Werdykt | Dowód |
|---|---|---|
| AI Gateway obsługuje Gemini, Anthropic, OpenAI | ✅ | dokumentacja (provider `google-ai-studio`, przykład z `@google/genai` i `baseUrl`) |
| logi, cache, limity, fallback | ✅ | jw. |
| logowanie treści można wyłączyć | ✅ | `cf-aig-collect-log: false` albo **`cf-aig-collect-log-payload: false`** (tylko metadane — dokładnie nasz przypadek) |
| „Identity-aware controls chronią adres IP bramy" | ⚪ | właściwy mechanizm to **Authenticated Gateway** (`cf-aig-authorization`). Uwaga: tokeny są na poziomie konta, nie pojedynczej bramy |
| Workers Free: 10 ms CPU; czekanie na `fetch` się nie wlicza | ✅ | „Limits" — dodatkowo: brak limitu czasu, dopóki klient jest połączony; 100 tys. żądań/dzień; 50 podżądań |
| OTel przez `@microlabs/otel-cf-workers` | ⚠️ | ostatnia wersja `1.0.0-rc.52` z 2025-05. Natywny eksport OTel istnieje, ale **tylko na Workers Paid i płatny od 2026-10-01** |
| — | ℹ️ | bramy utworzone od 2026-09-24 podlegają cenom i retencji Workers Logs — sprawdzić przed A1 |

### R6 — testy Workera i klienta

| Twierdzenie | Werdykt | Dowód |
|---|---|---|
| `@cloudflare/vitest-pool-workers` + Vitest 4 | ⚠️ | dokumentacja używa teraz **`@cloudflare/vitest-plugin`** 1.3.5 (`cloudflareTest()`), wymaga Vitest **^4.1** (najnowszy Vitest 5.0.3 **nie** pasuje) |
| błąd „Network connection lost" od 0.13.0 — bieżący, wysokiej wagi | ❌ nieaktualne | issue cloudflare/workers-sdk#13306 **zamknięte 2026-08-27**; dotyczyło zdalnych wiązań AI (`env.AI` w trybie remote) — nas nie dotyczy |
| MSW bez problemu przechwytuje `expo/fetch` w jest-expo | ❌ | MSW 3: wyłącznie ESM i Node ≥ 22.12 (mamy 22.11). MSW 2: `msw/node` ma w eksportach `"react-native": null` → jest-expo nie ładuje (`SyntaxError`). Dodatkowo w jest-expo globalny `fetch` to `expo/fetch` z atrapą modułu natywnego: żądanie na zamknięty port **„rozwiązuje się"** fikcyjną odpowiedzią |

**PoC Workera** (`worker/`): 9 testów w runtime workerd przechodzi w 5,9 s — AI SDK 7 + `MockLanguageModelV4` + kontrakt Zod z `src/ai/contract` + `exports.default.fetch`. Typ `exports.default` pojawia się dopiero po `wrangler types`.

**Wniosek:** klient przyjmuje `fetch` jako parametr, testy podają atrapę. Bez MSW.

### R7 — narzędzia do ewaluacji

| Twierdzenie | Werdykt | Dowód |
|---|---|---|
| Evalite: MIT, Vitest, lokalny SQLite | ✅ | plik LICENSE (MIT; pole `license` w npm jest puste); próba: działa na Windows / Node 22.11 z Vitest 4.1, baza w `node_modules/.evalite/cache.sqlite`, `--threshold` zwraca exit 1 |
| autoevals: MIT, wsparcie Zod 4 (PR #155) | ✅ | PR „Allow autoevals to support both zod 3 and zod 4" scalony 2026-06-08; `Levenshtein` działa offline |
| „rynek zdominowały" | ⚠️ opinia | Evalite: ostatni commit na `main` **2025-11-10**, wersja 0.19 (beta), 65 otwartych zgłoszeń, zależność `@ai-sdk/provider ^2` (era AI SDK 5) — pomocniki śledzenia AI SDK nie pasują do v7 |
| — | ℹ️ | próg `--threshold` dotyczy **średniej** wszystkich scorerów — nie da się nim wyrazić „bezpieczeństwo musi mieć 100%" |

### R8 — LLM jako sędzia

✅ Prace istnieją i mówią to, co podaje raport: arXiv 2306.05685 (MT-Bench), 2406.07791 (position bias), 2410.02736 (CALM). Zalecenia (rubryka, uzasadnienie przed oceną, kalibracja z oceną ludzką, sędzia z innej rodziny modeli) są zgodne z AI-INTEGRACJA §5.2. „Provenance bias" jest opisany zbyt ogólnie, żeby go weryfikować.

### R9 — polski tekst bez modelu

Raport zaleca Levenshteina na rdzeniach. **PoC** `poc/medical-signal-bench.mjs`: 38 zdań z etykietami (uraz / zakwasy / nic), w tym bez polskich znaków i z literówkami.

| Detektor | Poprawnie | Przeoczone urazy | Fałszywe alarmy |
|---|---|---|---|
| A: rdzenie + kontekst (staw vs mięsień, negacja „bez") | 37/38 | 0 | 1 (idiom „bolesna prawda") |
| B: Levenshtein ≤ 1, bez kontekstu (raport) | 29/38 | 0 | 9 |

B myli **wszystkie** zakwasy opisane słowem „bolą" z urazem, łapie „raz" jako „uraz", „kolano" jako „ból" (`kol`↔`bol`) i nie rozumie „bez bólu". To błędy wynikające z samej metody, nie z korpusu.

**Zastrzeżenie:** korpus pisałem razem z regułami A, więc wynik A jest zawyżony. Przed A0 potrzebny jest zbiór odłożony: Twoje prawdziwe notatki albo warianty wygenerowane osobno.

### R10 — Play Integrity

| Twierdzenie | Werdykt | Dowód |
|---|---|---|
| od wersji 1.4.0 obsługuje sideload / `expo run:android` | ❌ | dokumentacja wspomina 1.4.0 wyłącznie przy werdykcie *app access risk*. Aplikacja spoza Play dostaje `appRecognitionVerdict = UNRECOGNIZED_VERSION` („certificate or package name does not match Google Play records") |
| działa bez Play Console | ⚠️ | da się włączyć z samym projektem Cloud, ale bez konfiguracji i zwiększenia limitu; samodzielne odszyfrowanie tokenów wymaga aplikacji w Play |
| bez kosztów | ✅ | 10 000 żądań dziennie domyślnie |
| wspólny sekret da się wyciągnąć z APK | ✅ | zgodne z modelem zagrożeń AI-INTEGRACJA §4.7 |

Dla aplikacji instalowanej lokalnie Play Integrity nie potwierdzi integralności aplikacji, a dekodowanie tokenu wymaga konta serwisowego Google w Workerze. **Odrzucone.**

### R11 — monorepo i współdzielony Zod

| Twierdzenie | Werdykt | Dowód |
|---|---|---|
| Expo konfiguruje Metro dla monorepo automatycznie od SDK 52 | ✅ | dokumentacja Expo |
| `autolinkingModuleResolution` domyślnie od SDK 55 | ✅ | „From SDK 55, this is enabled automatically for apps in monorepos" |
| ryzyko zdublowanego Zoda | ✅ **potwierdzone w praktyce** | bundel Workera miał dwie kopie: root (CJS) i `worker/` (ESM) — 2345 KiB / 392 KiB gzip |

**Poprawka sprawdzona w PoC:** `wrangler.jsonc` → `"alias": { "zod": "./node_modules/zod/index.js" }` daje jedną kopię ESM: 1576 KiB / **274 KiB gzip**, testy przechodzą. Alias na katalog (`./node_modules/zod`) rozwiązuje się do wejścia CJS i duplikat **zostaje**. npm workspaces nie testowane — wciągnęłyby zależności Workera do `node_modules` aplikacji.

### R12 — polski a tokeny

- ✅ Kierunek: pomiar na trzech równoległych tekstach (polecenie systemowe, podsumowanie, notatka) — PL/EN = **1,78×** (`cl100k_base`), **1,55×** (`o200k_base`). Przy naszej skali to centy miesięcznie.
- ❌ Źródła: `arXiv 2609.0378` **nie istnieje** (zły format identyfikatora); 2607.24276 dotyczy języków indyjskich, nie polskiego.
- ⚠️ „Instrukcje po angielsku dają lepszą jakość" — bez dowodu; dalej hipoteza D7 do rozstrzygnięcia ewaluacją. Tokenizery Claude i Gemini wymagają API (`count_tokens`) — nie mierzone.

### R13 — Gemini Nano przez ML Kit GenAI

| Twierdzenie | Werdykt | Dowód |
|---|---|---|
| Pixel 10 Pro obsługuje Prompt API | ✅ | lista urządzeń: Pixel 10, 10 Pro, 10 Pro XL, 10 Pro Fold (nano-v3) |
| Expo/RN „pozwala wykorzystać" | ⚠️ | brak integracji — potrzebny własny Expo Module w Kotlinie |
| — | ℹ️ | Prompt API w becie, **Structured Output w alfie**; inferencja tylko na pierwszym planie; dzienny limit baterii per aplikacja; obsługa polskiego nieokreślona |

Ciekawe jako opcja rozszerzenia (Expo Module w Kotlinie to mocny punkt portfolio), ale nie jako rdzeń ani fallback F1–F3.

---

## 3. Wpływ na decyzje (AI-INTEGRACJA §11)

| # | Było | Jest | Na podstawie |
|---|---|---|---|
| D1 | narzędzia na telefonie | **potwierdzone** — wykonalne i przetestowane: zwrot wywołania, streaming, abort | R1, R2 |
| D2 | AI SDK w Workerze (wstępnie) | **AI SDK 7 w Workerze**: działa w workerd, ma atrapy do testów, sam obsługuje różnice schematów. Klient F1–F3: własny `fetch` (wstrzykiwany). F4: `useChat` + `DefaultChatTransport` do decyzji w A4 | R1, R6 |
| D3 | Gemini na start | Gemini na start bez obaw o trenowanie na danych (klauzula EOG); demo dla innych osób → plan płatny. Drugi dostawca wybierany ewaluacją; przy Claude pamiętać o braku `min`/`max` w schemacie i o 400 dla wymuszonego `tool_choice` | R3, R4 |
| D4 | `worker/` + import względny | **potwierdzone**, wymaga aliasu Zoda na wejście ESM oraz wykluczenia `worker/` w root `tsconfig`, ESLint i Jest | R11 |
| D5 | Vitest w runtime Workera | **`@cloudflare/vitest-plugin` + Vitest 4.1** (nie 5) | R6 |
| D6 | sekret + limit + budżet | bez zmian; Play Integrity odrzucone. Dodać: Authenticated Gateway + `cf-aig-collect-log-payload: false` | R5, R10 |
| D7 | EN/PL jako hipoteza | bez zmian; koszt tokenów 1,55× zmierzony i pomijalny | R12 |
| D8 | własny runner albo narzędzie | **bezpieczeństwo jako zwykłe testy (100%)**; jakość przez Evalite + autoevals, scorery jako czyste funkcje, żeby runner dało się wymienić | R7 |
| D9 | reguły + rdzenie | **rdzenie + kontekst**, Levenshtein odrzucony liczbami; potrzebny zbiór odłożony | R9 |

**Nowe zasady dla schematów kontraktu** (z R3 i R4):
1. Bez `z.literal` i unii literałów (→ `const`) — tylko `z.enum`.
2. Granice (`min`/`max`/długości) zawsze sprawdzane po parsowaniu — nie każdy dostawca egzekwuje je w dekodowaniu.
3. W schemacie żadnych danych wrażliwych (nazwy pól, wartości `enum`) — schematy są cache'owane poza treścią.

**Obserwowalność:** bez OTel (płatny). Wystarczą logi strukturalne Workera, analityka AI Gateway w trybie tylko metadanych i `ai_exchanges` lokalnie.

---

## 4. Czego nie sprawdzono i dlaczego

| Co | Dlaczego | Kiedy |
|---|---|---|
| jakiekolwiek wywołanie prawdziwego modelu (Gemini / Claude) | brak kluczy API w środowisku | A1 — wymaga Twojego klucza |
| streaming w buildzie release, na Pixelu 10 Pro, przez TLS i Cloudflare | PoC na emulatorze w trybie debug przez `adb reverse` | A4 |
| `useChat` na urządzeniu | sprawdzone tylko typy i dokumentacja | A4 |
| AI Gateway na żywo | wymaga konta Cloudflare | A1 |
| tokenizery Claude i Gemini | wymagają API | A2 |
| promptfoo jako alternatywa dla Evalite | poza zakresem pytania | przy decyzji D8 |

---

## 5. Uboczne ustalenie

Folder `android/` (w `.gitignore`) jest nieaktualny względem `app.json`: ma pakiet `com.homeworkout` zamiast `pl.majewski.homeworkout` i nie ma schematu `homeworkout://`. Linki głębokie przez schemat nie działają w lokalnym buildzie. Naprawa: `npx expo prebuild --clean` (zmienia identyfikator pakietu — na urządzeniu zainstaluje się obok starej wersji). *Od 2026-10-08 `app.json` też ma `com.homeworkout`, więc prebuild nie zmienia już pakietu.*

---

## 6. Jak powtórzyć

```bash
# R2 — streaming na emulatorze
node poc/sse-server.mjs
adb reverse tcp:8787 tcp:8787
npx expo start            # potem w aplikacji trasa /poc/stream

# R6, R11 — Worker
cd worker && npm install && npx vitest run && npx wrangler deploy --dry-run --outdir dist

# R9 — sygnały medyczne
node poc/medical-signal-bench.mjs
```
