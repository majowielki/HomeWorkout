# **Struktura i Taksonomia Bazy Wiedzy o Ćwiczeniach dla Aplikacji Offline-First: Bezpieczna Substytucja w Przypadku Złożonych Niestabilności Stawu Kolanowego**

## **Wprowadzenie do Architektury Systemów Rekomendacyjnych w Biomechanice Ortopedycznej**

Rozwój technologii cyfrowych w obszarze ochrony zdrowia, w tym aplikacji z zakresu telerehabilitacji oraz mobilnych asystentów treningowych, wymaga radykalnej ewolucji w sposobie modelowania danych medycznych i biomechanicznych1. Tradycyjne systemy rekomendacyjne oparte na mechanizmach filtrowania kolaboratywnego (collaborative filtering), które z powodzeniem funkcjonują w branży e-commerce czy rozrywkowej, są całkowicie nieodpowiednie w kontekście klinicznym2. Wymagają one zastąpienia przez zaawansowane systemy regułowe (rule-based expert systems), zdolne do przetwarzania twardych wykluczeń medycznych w czasie rzeczywistym3.  
Projektowanie zautomatyzowanego silnika substytucji ćwiczeń dla środowiska offline-first napotyka szczególne wyzwania, gdy system musi uwzględniać złożone, wielotkankowe patologie narządu ruchu. Omawiany przypadek kliniczny – brak więzadeł pobocznych (przyśrodkowego i bocznego), zrekonstruowane więzadło krzyżowe przednie (ACL) oraz obecność dynamicznej niestabilności pod postacią uciekania kolana do zewnątrz (zjawisko określane jako varus thrust) – stanowi ekstremalnie wymagające środowisko biomechaniczne5. Wymaga to stworzenia absolutnie rygorystycznej, bezbłędnej taksonomii kategoryzującej każdy ludzki ruch na fundamentalne wektory sił, płaszczyzny przestrzenne i wzorce aktywacji motorycznej7.  
Niniejszy raport wyczerpująco analizuje architekturę bazy danych offline-first, wprowadzając nowatorską taksonomię ćwiczeń umożliwiającą algorytmom bezpieczne odrzucanie ruchów stwarzających krytyczne ryzyko w płaszczyźnie czołowej i poprzecznej. Opracowana struktura opiera się na integracji zaawansowanej wiedzy ortopedycznej z nowoczesnymi rozwiązaniami inżynierii oprogramowania, takimi jak nierelacyjne nakładki na bazy SQLite czy standardy walidacji JSON Schema, umożliwiając urządzeniom brzegowym (edge computing) błyskawiczną i bezpieczną substytucję wzorców ruchowych9.

## **Patomechanika Stawu Kolanowego z Deficytem Więzadłowym**

Aby algorytm decyzyjny mógł skutecznie zapobiegać uszkodzeniom tkanek, jego reguły muszą stanowić cyfrowe odzwierciedlenie zasad anatomii prawidłowej i patologicznej. Staw kolanowy jest skomplikowaną strukturą o sześciu stopniach swobody, realizującą translacje i rotacje w trzech płaszczyznach12. Zrozumienie, w jaki sposób utrata kluczowych stabilizatorów wpływa na kinematykę tego stawu, pozwala precyzyjnie zdefiniować granice bezpieczeństwa dla silnika rekomendacyjnego.

### **Deficyt Kompleksu Pobocznego a Niestabilność Czołowa**

Więzadła poboczne stawu kolanowego odgrywają fundamentalną rolę w absorpcji obciążeń w płaszczyźnie czołowej5. Więzadło poboczne piszczelowe (MCL) jest głównym stabilizatorem powstrzymującym siły koślawiące (valgus stress), zabezpieczając kolano przed zapadaniem się do wewnątrz5. Jego wytrzymałość pozwala na bezpieczne przyjmowanie obciążeń rzędu kilkuset niutonów. Z kolei więzadło poboczne strzałkowe (LCL), znacznie mniejsze objętościowo, którego siła na zerwanie szacowana jest na około 750 N, stanowi barierę dla sił szpotawiących (varus stress) dążących do wychylenia kolana na zewnątrz5. Wyizolowane uszkodzenia LCL są niezwykle rzadkie i zazwyczaj korelują z destrukcją tzw. rogu tylno-bocznego (posterolateral corner \- PLC)14.  
W sytuacji pacjenta z jednoczesnym brakiem obu więzadeł pobocznych, układ kinematyczny kończyny dolnej zostaje całkowicie pozbawiony pasywnych struktur przeciwdziałających siłom w płaszczyźnie czołowej. W mechanice stawu kolanowego oznacza to podatność na patologiczne rozwarcie szczeliny stawowej (joint gapping) zarówno po stronie przyśrodkowej, jak i bocznej14.

### **Zrekonstruowane ACL i Katastrofalne Skutki Zjawiska Varus Thrust**

Więzadło krzyżowe przednie (ACL) odpowiada za ponad 80% oporu stawianego przedniemu przemieszczeniu (translacji) kości piszczelowej względem kości udowej, a także pełni rolę wtórnego stabilizatora przeciwko przeciążeniom koślawiącym i rotacyjnym5. Wymaga to niezwykle precyzyjnej adaptacji podczas rehabilitacji i treningu, ponieważ każdy nowo zrekonstruowany przeszczep (graft) musi przejść przez długotrwały, biologiczny proces rewaskularyzacji i przebudowy, znany jako ligamentyzacja, który w pełni kształtuje mechaniczne właściwości tkanki przez okres przekraczający rok18. Biomechaniczne właściwości przeszczepu po roku od operacji mogą stanowić zaledwie 50-60% wytrzymałości natywnego więzadła5.  
Problem przybiera na sile w obecności dynamicznego zjawiska zwanego "varus thrust". Jest to patologiczne, gwałtowne powiększenie kąta szpotawego kolana występujące w trakcie fazy obciążania kończyny (stance phase), wizualizujące się jako uciekanie kolana do zewnątrz6. Analizy laboratoryjne i badania na preparatach zwłok udowadniają, że niekontrolowana szpotawość geometrycznie zwiększa napięcie aplikowane na ACL. Podczas eksperymentalnej symulacji szpotawego obciążenia osiowego, napięcie w obrębie ACL wzrastało z poziomu 31 N (przy osi neutralnej) do wartości 53,9 N19. W uszkodzonym kolanie brak LCL sprawia, że cała siła powstrzymująca ten patologiczny wyłam spada bezpośrednio na przeszczep ACL oraz struktury torebkowe, co wprost prowadzi do jego nadmiernego rozciągnięcia (attenuation) lub ostatecznego zerwania21.  
Dla silnika w aplikacji offline oznacza to bezwzględną konieczność kategorycznego odrzucania wszystkich ćwiczeń generujących wektory boczne, ponieważ w zaistniałym środowisku patomechanicznym przeszczep ACL nie ma żadnego wsparcia ze strony nieistniejącego więzadła LCL w powstrzymywaniu rotacji i ucieczki kolana na zewnątrz.

## **Łańcuchy Kinematyczne i Generowanie Przednich Sił Ścinających**

Każde ćwiczenie narządu ruchu można zaklasyfikować do pracy w określonym łańcuchu kinematycznym. Definicja ta określa układ segmentów ciała względem podłoża, co fundamentalnie zmienia dystrybucję sił wewnątrzstawowych. System kategoryzacji opierający się na tej zmiennej stanowi klucz do minimalizacji przedniej siły ścinającej (anterior tibial shear force), bezpośrednio odpowiedzialnej za niszczenie przeszczepów ACL23.  
Otwarte łańcuchy kinematyczne (Open Kinetic Chain \- OKC) charakteryzują się swobodnym przemieszczaniem dystalnego segmentu (np. stopy) w przestrzeni, podczas gdy ciało pozostaje ustabilizowane23. Klasycznym przykładem jest wyprost podudzia na maszynie w pozycji siedzącej. Badania biomechaniczne dowodzą, że aktywność mięśnia czworogłowego w OKC, zwłaszcza w bliskich pełnemu wyprostowi zakresach zgięcia kolana (od 0 do 30 stopni), generuje potężną siłę ciągnącą kość piszczelową w przód5. Brak naturalnego dociążenia stopy eliminuje zjawisko kompresji stawowej, wystawiając układ więzadłowy na czyste obciążenie ścinające, izolując całe napięcie na zrekonstruowanym ACL23. W konsekwencji ćwiczenia wyprostne w OKC u pacjentów w początkowych i środkowych fazach przebudowy przeszczepu uznawane są za wysoce ryzykowne bez zachowania drastycznych modyfikacji zaleconych przez fizjoterapeutów24.  
Zupełnie odmienna kaskada sił zachodzi w przypadku zamkniętych łańcuchów kinematycznych (Closed Kinetic Chain \- CKC), w których dystalny segment jest zablokowany, napotykając stały opór (np. stopa oparta o podłoże w trakcie przysiadu lub martwego ciągu)23. Charakterystyczną cechą ruchów CKC jest wymuszona, symultaniczna aktywacja mięśni agonistycznych i antagonistycznych, znana jako zjawisko ko-kontrakcji (co-contraction)23. Zgięcie stawu biodrowego i kolanowego w CKC indukuje silny skurcz grupy kulszowo-goleniowej (hamstrings), która z racji swojego przyczepu na kości piszczelowej działa jak wektor ciągnący piszczel ku tyłowi23. Ta naturalna kompensacja efektywnie neutralizuje wektor wywołany przez mięsień czworogłowy, dramatycznie redukując obciążenie aplikowane na więzadło krzyżowe przednie, często prowadząc do całkowitej supresji przedniej siły ścinającej28. Dodatkowo, obciążenie osiowe występujące w CKC wywołuje siły kompresyjne naciskające głowy kości udowej na kość piszczelową, co potęguje stabilność stawu poprzez mechaniczną kongruencję23.  
Z tego powodu system algorytmiczny musi nadawać najwyższy możliwy priorytet ćwiczeniom wielostawowym realizowanym w zamkniętym łańcuchu kinematycznym, systematycznie odrzucając ruchy izolowane kończyny dolnej w łańcuchach otwartych.

## **Wielowymiarowa Taksonomia Bazy Wiedzy o Ćwiczeniach**

Podstawą funkcjonowania skutecznego silnika rekomendacyjnego w środowisku medyczno-sportowym jest deterministyczna klasyfikacja danych. Silnik działający lokalnie musi być w stanie analizować dziesiątki zmiennych przypisanych do każdego ze zdefiniowanych ćwiczeń, wykraczając daleko poza tradycyjne przyporządkowanie do partii mięśniowych29. Klasyfikacja ta opiera się na rozkładzie ruchu na czynniki pierwsze: płaszczyzny, wzorce, postawę oraz zmienne wektorowe.

### **Modelowanie Płaszczyzn Ruchu (Planes of Motion)**

Zdefiniowanie dominującej płaszczyzny jest absolutnym fundamentem taksonomii. Ludzki aparat ruchu funkcjonuje trójwymiarowo w trzech przenikających się płaszczyznach kardynalnych7. Implementacja tego wymiaru w bazie danych pozwala na kategoryczne zastosowanie twardych filtrów medycznych.

| Płaszczyzna Klasyfikacyjna | Deskryptor Kinematyczny | Charakterystyczne Przykłady Ruchowe | Ocena Ryzyka dla Braku LCL/MCL i ACLR | Logika Decyzyjna Silnika |
| :---- | :---- | :---- | :---- | :---- |
| **Strzałkowa (Sagittal)** | Podział ciała na prawą i lewą połowę; obejmuje wyłącznie ruchy zgięcia i wyprostu, poruszanie się idealnie w przód/tył7. | Przysiad (Squat), Martwy ciąg, Wyciskanie nogami na suwnicy32. | **Niskie** – optymalna dystrybucja osiowa, brak stymulacji varus/valgus, kontrola translacji przez ko-kontrakcję. | Promowanie i Akceptacja |
| **Czołowa (Frontal)** | Podział ciała na przód i tył; obejmuje ruchy odwodzenia, przywodzenia oraz przemieszczenia boczne (lateralne)7. | Przysiad boczny (Cossack Squat / Lateral Lunge), Odwodzenie nogi z taśmą oporową7. | **Krytyczne** – bezpośrednie wywołanie wektora rozciągającego struktury poboczne; prowokowanie zjawiska pchnięcia szpotawego13. | Absolutne Wykluczenie |
| **Poprzeczna (Transverse)** | Podział ciała na górę i dół; obejmuje wszelkie rotacje osiowe, skręty miednicy oraz nagłe zmiany kierunku (pivoting)7. | Wykrok ze skrętem tułowia (Lunge Twist), Dynamiczne ćwiczenia kierunkowe (skater jumps)7. | **Bardzo Wysokie** – obwodowa rotacja piszczeli bez wsparcia stabilizatorów pobocznych tworzy moment zrywający dla przeszczepu ACL13. | Absolutne Wykluczenie |

### **Modelowanie Wzorców Ruchowych (Movement Patterns)**

Kategoryzacja pożądanej mechaniki narządu ruchu na podstawie zaangażowania dominujących stawów umożliwia znalezienie bezpiecznej substytucji poprzez dopasowanie cech biologicznych, bez konieczności kopiowania pierwotnego, ryzykownego ćwiczenia32.  
W kontekście kończyny dolnej baza wiedzy musi odróżniać:

> 1. **Dominacja Kolana (Knee Dominant / Squat Pattern):** Wzorzec ten charakteryzuje się relatywnie głębokim zgięciem stawu kolanowego z wyraźnym przesunięciem rzepki w kierunku palców stopy. Podstawowym motorem napędowym w tym wzorcu jest praca mięśnia czworogłowego udowego (quadriceps) i pośladków7. Stanowi on podstawę do budowania masy mięśniowej uda, która ulega ekstremalnym zanikom (atrofii) po rekonstrukcji ACL34. Z uwagi na obecność sił kompresyjnych stawu rzepkowo-udowego (patellofemoral compression forces), które wzrastają wraz z pogłębieniem zgięcia, ćwiczenia te są wysoce bezpieczne dla zrekonstruowanych więzadeł, pod warunkiem rygorystycznego utrzymania osiowości w płaszczyźnie strzałkowej24.  
> 2. **Dominacja Biodra (Hip Dominant / Hinge Pattern):** Wzorzec zawiasu biodrowego opiera się na znacznym zgięciu stawu biodrowego (wypchnięciu miednicy ku tyłowi) przy minimalnym zgięciu w stawach kolanowych, które pozostają relatywnie stabilne7. Za ten ruch odpowiada układ mięśniowy tylnego łańcucha: grupa kulszowo-goleniowa, mięśnie pośladkowe i prostowniki grzbietu7. Ten wzorzec wykazuje fundamentalne znaczenie w protokołach telerehabilitacyjnych w patologiach ACL, ponieważ generuje potężną barierę dla patologicznego przedniego przesunięcia piszczeli poprzez systematyczne wzmacnianie izometrycznej i ekscentrycznej pracy hamstringów28.  
> 3. **Lunge (Wzorzec Asymetryczny):** Bazuje na wykroku. Mimo zachowania dominacji w płaszczyźnie strzałkowej wymaga znacznej równowagi i rekrutacji małych mięśni stabilizujących miednicę (gluteus medius). U pacjentów z tendencją do szpotawości, każda niestabilność w tym wzorcu może skutkować zapadaniem się kolana36.

### **Modelowanie Bazy Podparcia (Stance Mechanics)**

Stopień podparcia rzutuje na konieczność aktywacji mięśni stabilizujących oraz narażenie stawów na naturalne wektory destabilizujące wywoływane przez działanie siły grawitacji i pęd8.

| Baza Podparcia | Deskryptor Mechaniczny | Poziom Wyzwania dla Niestabilnego Kolana | Uwarunkowania Algorytmiczne |
| :---- | :---- | :---- | :---- |
| **Bilateral** (Obunóż) | Środek masy znajduje się stabilnie pomiędzy obiema opartymi symetrycznie o podłoże stopami33. | Minimalny \- wektory sił rozkładają się równomiernie, niemal całkowicie znosząc niepożądane momenty czołowe. | Optymalny wzorzec priorytetowy do wyboru przez silnik substytucyjny. |
| **Unilateral Supported** (Jednonóż ze Wsparciem) | Masa ciała przeniesiona głównie na nogę wykroczną, jednak stopa nogi zakrocznej ma kontakt z podłożem, dostarczając balans strukturalny (np. Split Squat)7. | Umiarkowany do wysokiego \- wymaga silnej stabilizacji miednicy w celu utrzymania obiektywnej osiowości kończyny podporowej36. | Akceptacja warunkowa. Konieczne unikanie w sytuacjach narastającego zmęczenia lub dodatkowych wektorów obciążenia. |
| **Unilateral Unsupported** (Jednonóż bez Wsparcia) | Całkowity ciężar i kontrola grawitacyjna spoczywają na jednym stawie skokowym, kolanowym i biodrowym; druga kończyna oderwana od podłoża (np. Pistol Squat, Single-leg RDL)7. | Ekstremalny \- potężne zapotrzebowanie na mikrostabilizację w płaszczyźnie czołowej i poprzecznej; potęguje objaw varus thrust6. | Z uwagi na brak MCL/LCL, system rekomendacyjny musi rygorystycznie i bezwarunkowo wykluczać tę bazę podparcia z programów. |

### **Zmienne Dynamiczne, Inercja i Plyometria**

Architektura pojęciowa w systemie rekomendacyjnym nie może ignorować zmiennych czasowych i faz ruchu. Dynamiczna natura sportu potęguje obciążenia kinetyczne do skali przekraczającej wytrzymałość tkankową28.  
Ruchy, które angażują zjawisko plyometrii – w szczególności powtarzalne wyskoki i asymetryczne lądowania – eksponują układ ruchu na gwałtowne hamowanie. Lądowanie o dużej sile impaktu, zwłaszcza gdy staw kolanowy ustawiony jest blisko pełnego wyprostu (minimalny kąt zgięcia), wielokrotnie potęguje wystąpienie niszczącej, przedniej siły ścinającej39. Podczas testów z asymetrycznym lądowaniem czy manewrami typu "sidestep cutting", obserwowany jest znaczny wzrost naprężeń na przeszczep, a zwiększona sztywność (stiffness) grupy kulszowo-goleniowej stanowi jedyny wrodzony mechanizm chroniący więzadło przed nagłą dekapitacją pod wpływem masy35.  
Z uwagi na te niezwykle ostre uwarunkowania, system rekomendacyjny dysponujący patologicznym profilem medycznym użytkownika (pchnięcie szpotawe bez mechanizmów pobocznych) powinien automatycznie desygnować obciążenie plyometryczne (tj. parametr bazy: "force\_profile": "plyometric") jako bezwarunkowo wykluczone.

## **Architektura Bazy Danych Offline-First i JSON Schema**

Koncepcja aplikacji offline-first bazuje na zapewnieniu bezawaryjnej pracy oprogramowania bez dostępu do sieci rozległej (internetu). Odpytywanie baz zewnętrznych, poprzez np. żądania REST API29, wiąże się z trudnym do oszacowania opóźnieniem w generowaniu rekomendacji na brzegu, zwłaszcza podczas trwania interaktywnej sesji treningowej11. Dlatego ciężar utrzymywania taksonomii i logiki decyzyjnej przesuwa się bezpośrednio na pamięć podręczną i trwałą (local storage) urządzenia mobilnego użytkownika (tzw. Edge Computing)10.  
Standardem defacto dla utrzymywania złożonych układów relacyjnych na aplikacjach mobilnych jest technologia SQLite – potężny, bezserwerowy silnik bazy danych operujący na pojedynczym pliku z gwarancją transakcyjności ACID10. Chociaż SQLite jest silnikiem z definicji relacyjnym, implementacja rozszerzenia JSON1 pozwala mu na asynchroniczne i ultra-wydajne parsowanie wielowymiarowych struktur zagnieżdżonych typowych dla środowisk NoSQL9. Nowocześniejsze architektury dla frameworków takich jak Flutter czy React Native implementują nakładki reaktywne, z których najbardziej zaawansowaną jest RxDB (Reactive Database). RxDB transformuje struktury dokumentowe (JSON) za pomocą zaawansowanych replikacji lokalnych, pozwalając definiować rygorystyczne schematy bazujące na standardzie JSON Schema9.  
Wykorzystanie formatu JSON Schema w technologii RxDB lub bezpośrednio podczas serializacji do SQLite jest nieocenione dla zapanowania nad chaosem ontologicznym – każdy z kilku tysięcy profilów ćwiczeń musi być sprawdzony przed zapisem pod kątem spójności struktur typowania statycznego29.

### **Zastosowanie JSON Schema w Modelowaniu Pojedynczego Ćwiczenia**

Reprezentacja cyfrowego obciążenia biomechanicznego, dedykowana odpytywaniu logicznemu, przyjmie następującą rygorystycznie ukształtowaną postać dokumentu JSON45. W poniższej strukturze każda zmienna kategoryzacyjna jest narzuconym wymogiem.

JSON  
{  
  "$id": "https://biomechanics.schema.local/exercise.json",  
  "title": "Exercise Taxonomic Definition",  
  "description": "JSON Schema mapping the exhaustive biomechanical and risk factors for the offline database.",  
  "type": "object",  
  "properties": {  
    "exercise\_id": { "type": "string" },  
    "name": { "type": "string" },  
    "target\_muscles": {  
      "type": "array",  
      "items": { "type": "string" }  
    },  
    "biomechanics": {  
      "type": "object",  
      "properties": {  
        "movement\_pattern": {  
          "type": "string",  
          "enum": \["Squat", "Hinge", "Lunge", "Push", "Pull", "Isolation"\]  
        },  
        "planes\_of\_motion": {  
          "type": "array",  
          "items": {  
            "type": "string",  
            "enum": \["Sagittal", "Frontal", "Transverse"\]  
          }  
        },  
        "is\_closed\_kinetic\_chain": { "type": "boolean" },  
        "stance\_mechanics": {  
          "type": "string",  
          "enum": \["Bilateral", "Unilateral\_Supported", "Unilateral\_Unsupported", "Seated"\]  
        },  
        "force\_profile": {  
          "type": "string",  
          "enum": \["Concentric\_Eccentric", "Isometric", "Plyometric"\]  
        }  
      },  
      "required": \["movement\_pattern", "planes\_of\_motion", "is\_closed\_kinetic\_chain", "stance\_mechanics", "force\_profile"\]  
    },  
    "pathology\_risk\_factors": {  
      "type": "object",  
      "properties": {  
        "provokes\_valgus\_varus": { "type": "boolean" },  
        "high\_anterior\_tibial\_shear": { "type": "boolean" }  
      }  
    }  
  },  
  "required": \["exercise\_id", "name", "target\_muscles", "biomechanics", "pathology\_risk\_factors"\]  
}

Otagowanie bezpośrednich właściwości ryzyka (takich jak "provokes\_valgus\_varus": true) działa jak uproszczony przełącznik bezpieczeństwa (kill switch), przyspieszając proces odrzucania ryzykownych ruchów bez konieczności rozpatrywania wektora płaszczyznowego u każdego rekordu przez silnik decyzyjny46.

### **Skalowanie, Optymalizacja Wydajności i Indeksowanie Danych**

Przeszukiwanie i filtrowanie zbioru tysięcy rekordów JSON w poszukiwaniu odpowiedniego ćwiczenia zastępczego na urządzeniu mobilnym wymaga zastosowania głębokich optymalizacji bazy48. W bazie SQLite operacje wyszukiwania tekstowego czy parsowania JSON (np. w przypadku zapytań o płaszczyznę ruchu) w procesie opartym na skanowaniu całych tabel (Full Table Scan) skutkują wykładniczym spadkiem wydajności i drenażem akumulatora urządzenia brzegowego49.  
Dlatego inżynierowie bazodanowi muszą wykorzystywać kompozytowe indeksy (B-Tree Indexes) ustrukturyzowane wirtualnie ponad kolumnami JSON110. Co więcej, środowiska takie jak RxDB udostępniają plugin o nazwie *JSON Key-Compression*. Skrypt kompresji w locie (przed utrwaleniem na dysku) analizuje zagnieżdżone obiekty i zamienia wysoce elokwentne klucze, na przykład z "pathology\_risk\_factors" na zminifikowane reprezentacje jak "prf", a wartości wyliczeniowe do reprezentacji heksadecymalnych. Mechanizm ten diametralnie zmniejsza objętość wagową i przestrzenie adresowe plików na fizycznym nośniku (local storage), dzięki czemu zapytania filtracji medycznej ładują setki wyników w czasie krótszym niż kilkanaście milisekund, a dekompresja następuje natychmiastowo przed wyprowadzeniem na interfejs użytkownika9.

## **Architektura Silnika Substytucji (Rules-Based Expert System)**

Opracowany silnik substytucyjny to system deterministyczny oparty na twardych i miękkich regułach (Expert System), który odrzuca metodologie predykcyjne uczenia maszynowego (np. rekomendacje oparte na popularności wśród innych bywalców siłowni), ponieważ margines błędu uczenia statystycznego w obliczu patologii fizjologicznych mógłby prowadzić do trwałych kontuzji3. Logika systemu opiera się na procesach kaskadowego eliminowania wektorów obciążeń niefizjologicznych.

### **Faza Pierwsza: Nakładanie Medycznych Kryteriów Wykluczenia (Hard Constraints)**

Z profilu użytkownika (zdeklarowany brak więzadeł MCL/LCL, rzuty szpotawości, rekonstruowane ACL) system generuje zbiór restrykcji operacyjnych, odpytujących ustrukturyzowaną matrycę bazy ćwiczeń3. Ustalany jest zbiór wykluczeń bezwzględnych, oznaczanych jako HEC (Hard Exclusion Constraints):

> 1. **HEC\_A:** Jeżeli biomechanics.planes\_of\_motion zawiera węzeł Frontal (czołowa) LUB Transverse (poprzeczna) \-\> Odrzuć zbiór. Całkowity zakaz ekspozycji bocznej i rotacyjnej na rzepkę i struktury boczne13.  
> 2. **HEC\_B:** Jeżeli pathology\_risk\_factors.provokes\_valgus\_varus przyjmuje wartość true \-\> Odrzuć zbiór. Prewencja wtórnego pchnięcia szpotawego (varus thrust)6.  
> 3. **HEC\_C:** Jeżeli biomechanics.stance\_mechanics równa się Unilateral\_Unsupported \-\> Odrzuć zbiór. Wyeliminowanie niestabilności wynikającej z nieobecności balansu kontralateralnego i słabości stabilizatorów pośladkowych36.  
> 4. **HEC\_D:** Jeżeli biomechanics.force\_profile równa się Plyometric \-\> Odrzuć zbiór. Zapobieganie skokowym skokom momentów ścinających na zrekonstruowane struktury torebkowo-więzadłowe podczas lądowania39.  
> 5. **HEC\_E:** Jeżeli biomechanics.is\_closed\_kinetic\_chain równa się false ORAZ celem są mięśnie uda (tj. ćwiczenie izolowane w otwartym łańcuchu) \-\> Odrzuć zbiór. Uniknięcie naprężeń zrywających wywoływanych brakiem ko-kontrakcji antagonistycznej5.

Tłumacząc powyższą logikę do formatu zapytania (przykład abstrakcyjny na składni SQL dla SQLite z JSON1), silnik na poziomie systemu weryfikuje tysiące ćwiczeń, kategorycznie blokując naruszające warunki krotki10:

SQL  
SELECT json\_extract(exercise\_data, '$.id'), json\_extract(exercise\_data, '$.name')   
FROM exercises   
WHERE NOT (  
    json\_extract(exercise\_data, '$.pathology\_risk\_factors.provokes\_valgus\_varus') \= 1  
    OR json\_extract(exercise\_data, '$.biomechanics.stance\_mechanics') \= 'Unilateral\_Unsupported'  
    OR json\_extract(exercise\_data, '$.biomechanics.force\_profile') \= 'Plyometric'  
    OR json\_extract(exercise\_data, '$.biomechanics.is\_closed\_kinetic\_chain') \= 0  
    OR EXISTS (  
        SELECT 1 FROM json\_each(json\_extract(exercise\_data, '$.biomechanics.planes\_of\_motion'))   
        WHERE value IN ('Frontal', 'Transverse')  
    )  
);

Rezultatem przefiltrowanego na urządzeniu stosu (edge computation) jest ostateczna tzw. "Lista Białych Flag", z której można bezpiecznie czerpać zastępstwa dla poszczególnych modułów zaplanowanego programu treningowego.

### **Faza Druga: Rankingowanie Podobieństwa (Scoring and Soft Constraints)**

Dla bezpiecznej Listy Białych Flag uaktywnia się system oceny miękkiej (Soft Constraints). Odrzucone przez wbudowane filtry ćwiczenie użytkownika analizowane jest pod kątem priorytetu rekrutacyjnego (np. mięsień docelowy). Algorytm nadaje wagę systematyzującą zastępstwa z naciskiem na maksymalizację stabilności i terapeutycznej skuteczności biomechanicznej.  
Proces obliczania wyniku substytucji (Similarity Score) kładzie najwyższy nacisk na indukowanie zjawiska ko-kontrakcji, która naturalnie odciąża słabnący aparat torebkowy i rekonstruowane ACL28:

* Dopasowanie głównych mięśni (target\_muscles) nadaje fundament decyzyjny (+50 punktów).  
* Obecność wzorca dominacji biodra (movement\_pattern: Hinge) uzyskuje masową premię systemową (+30 punktów), z uwagi na to, iż praca tylnego łańcucha (kulszowo-goleniowego) jest bezdyskusyjnym zabezpieczeniem przeciwdziałającym destrukcyjnej przedniej sile ścinającej podczas obciążeń pionowych23.  
* Identyfikacja wsparcia podwójnego (stance\_mechanics: Bilateral) zyskuje kolejne premie (+20 punktów). W układzie dwunożnym grawitacja rozkłada się równomiernie na obręcz miedniczną i kończyny dolne, w efekcie czego ramię dźwigni dla sił bocznych i przyśrodkowych maleje niemal do zera, skutecznie wymrażając zjawisko *varus thrust*6.

Ruch zbierający najwyższą wartość staje się ostateczną rekomendacją przekazaną na interfejs aplikacji w czasie rzędu kilku milisekund, pozwalając na nieprzerwany rytm treningowy.

## **Implementacja Decyzyjna w Praktyce: Zestawienie Studiów Przypadków**

Zrozumienie działania systemu w rzeczywistych warunkach wymaga prześledzenia zapytań substytucyjnych. Kiedy pacjent, realizujący predefiniowany cykl z ogólnodostępnego programu fitness, spotyka w swoim planie ćwiczenia o niedopuszczalnych parametrach, algorytm działa automatycznie. Poniższe przypadki obrazują uzasadnienie biomechaniczne dokonywanych podmian.

### **Studium 1: Izolowany Wyprost Podudzia (Leg Extension Machine)**

* **Charakterystyka Pierwotnego Ćwiczenia:** Oparty na maszynie wyprost w otwartym łańcuchu (OKC), angażujący jeden staw (Single\_Joint), izolujący pracę wyłącznie do mięśnia czworogłowego w płaszczyźnie strzałkowej23.  
* **Ocena Logiczna Algorytmu:** Ćwiczenie zostaje błyskawicznie wychwycone i usunięte z kolejki poprzez filtr absolutny zdefiniowany w regulacji HEC\_E (Izolowane OKC dla nóg).  
* **Fundament Patomechaniczny:** W pozycji siedzącej i pracując pod oporem generowanym na obwodzie przy wyprostowanym podudziu, potężny skurcz mięśnia czworogłowego transmitowany przez więzadło właściwe rzepki ciągnie kość piszczelową z niszczycielską siłą ku przodowi. Całkowity brak zaangażowania mięśni z grupy tylnej w trakcie otwartego obciążenia (brak fizjologicznej ko-kontrakcji) czyni układ bezbronnym na obciążenia ścinające. Przednia siła ścinająca kumuluje się na wątłym przeszczepie więzadła krzyżowego, co przy zgięciu w przedziale od 0 do 30 stopni (końcowy wyprost) stanowi najgroźniejsze możliwe narażenie integralności na uszkodzenie biomechaniczne lub wydłużenie struktury5.  
* **Wybrana Rekomendacja Substytucyjna:** Przysiad Goblet (Goblet Squat)33.  
* **Przesłanki Terapeutyczne:** Wzorzec dominacji kolana realizowany przy obustronnym podparciu i zamkniętym łańcuchu biomechanicznym (CKC). Mięśnie tylnej strony uda (hamstrings) pracują izometrycznie w odpowiedzi na napięcie pośladków w końcowej fazie, stanowiąc siłę naciskającą w dół oraz kompresującą staw, co w pełni neutralizuje siły rozrywające nakładane przez czworogłowe na niestabilną łękotkę i zrekonstruowane pasma ACL23. W rezultacie system zachowuje docelową hipertrofię czworogłowych, neutralizując 100% obciążeń patologicznych.

### **Studium 2: Przysiad Boczny (Cossack Squat / Lateral Lunge)**

* **Charakterystyka Pierwotnego Ćwiczenia:** Głębokie zejście na jedną stronę w asymetrycznym wsparciu, angażujące ruch hybrydowo w płaszczyznach czołowej i strzałkowej. Odnotowany wskaźnik "provokes\_valgus\_varus": true7.  
* **Ocena Logiczna Algorytmu:** Bezwzględnie usunięte z użycia przez równoległe zapalenie barier HEC\_A (obecność płaszczyzny czołowej) oraz HEC\_B (rejestr uwarunkowań koślawiąco/szpotawiących).  
* **Fundament Patomechaniczny:** Wypad boczny indukuje kolosalny rzut grawitacyjny i asymetryczny nacisk podłużny skierowany pod ostrym kątem. W przypadku patologii z utraconą funkcjonalnością LCL i MCL (kompletny brak więzadeł pobocznych), obciążenie nie napotyka oporu tkankowego. Spadek środka grawitacji na przyśrodkową lub boczną chrząstkę pociąga za sobą ekstremalne wychylenie kości ku zewnątrz, zjawisko pchnięcia szpotawego (varus thrust)6. Bez więzadeł pobocznych i w asymetrycznym rozkroku rotacyjnym, staw rzepkowo-udowy (PFJ) wraz z ACL ulega skrajnemu stresowi zrywającemu, który przy masie własnej ćwiczącego może zniszczyć stabilność w kilkaset milisekund13.  
* **Wybrana Rekomendacja Substytucyjna:** Martwy Ciąg Klasyczny (RDL/Hinge)32.  
* **Przesłanki Terapeutyczne:** Wzorzec zawiasu biodrowego wymusza ścisłą, statyczną pozycję dwunóżną. Całkowite oddzielenie płaszczyzny czołowej z ontologii ćwiczenia uniemożliwia rzut ciężaru na boki. Silna praca miednicy w zgięciu angażuje pośladki, a sztywność wykształcana przez dwugłowe uda i półścięgniste przykleja dosłownie podudzie do uda (mechaniczna stabilizacja powięziowa). Badania dowodzą, że naturalnie podwyższona sztywność (stiffness) grupy kulszowo-goleniowej stanowi fundamentalny bufor w profilaktyce stabilizacyjnej w przypadku rozluźnionych, nie w pełni wyleczonych patologii torebkowych stawu, zapobiegając patologicznemu zjawisku "tibial translation"28.

### **Studium 3: Plyometryczny Wykrok Boczny (Skater Jumps)**

* **Charakterystyka Pierwotnego Ćwiczenia:** Skok odstawno-dostawny łączący skurcz plyometryczny, skrajną asymetrię (Unilateral Unsupported w fazie lotu) oraz płaszczyznę czołową/poprzeczną.  
* **Ocena Logiczna Algorytmu:** Ekstremalne naruszenie reguł HEC\_A, HEC\_C, i HEC\_D naraz. Baza odrzuca rekord przed uruchomieniem kalkulacji podobieństw.  
* **Fundament Patomechaniczny:** Jakiekolwiek loty i nagłe zderzenia stóp z podłożem uderzają w układ ze spotęgowanym współczynnikiem wagi grawitacyjnej39. Podczas lądowania i hamowania masy w płaszczyźnie bocznej (Frontal) bez zintegrowanych stabilizatorów statycznych bocznych (kompleks PLC, więzadła poboczne), kolano może dosłownie się zapaść (buckling)13. Siła ścinająca przenosi na rzepkę i przeszczep tętno energii, której mięsień czworogłowy w stanie wyprostu (najczęstsza patologia przyzwyczajeń \- lądowanie na prostych nogach) nie jest w stanie zakumulować27.  
* **Wybrana Rekomendacja Substytucyjna:** Brak alternatywy z powodu ekstremalnego oddalenia biomechanicznego, silnik przekierowuje użytkownika na izolowaną izometrię grupy strzałkowej (Plank na prostych rękach dla tułowia) lub proponuje pominięcie sekwencji dynamicznej na rzecz statycznych odwodzeń z najlżejszą taśmą siedząc (aby uniknąć kompresji stawowej podczas prowokowania mięśni miednicy).

## **Integracja Śledzenia Zmęczenia (Fatigue Variables)**

Przyszłościowa iteracja tak systematyzowanej ontologii wiedzy zakłada mapowanie czynników dynamicznego wyczerpania układu nerwowego w trakcie trwania rutyny, stanowiące o stateczności kolana34. Zmęczenie mięśni centralnych (tzw. "core") i dystalnych (m. pośladkowy średni) koreluje z dramatycznym upośledzeniem propriocepcji; zmęczone ciało podświadomie zatraca mechanikę odizolowania stawów z osi środkowej i wpada w koślawienie lub pchnięcie szpotawe pod koniec treningu36.  
Odpowiedzią na tę degradację w strukturach aplikacji offline-first jest zaprojektowanie reguł dynamicznych – na przykład ograniczenie puli wyboru do bezwzględnych ćwiczeń bilateralnych (obunóż) stance\_mechanics: Bilateral zawsze wtedy, gdy wskaźnik zmęczenia jednostki motorycznej (zliczany z ilości zaaplikowanych obciążeń oraz szacowanej hipertrofii dla każdej grupy docelowej) przekroczy ustalony limit ostrożności3. To proaktywne rozwiązanie drastycznie minimalizuje ryzyko powikłań. Pamięć podręczna systemu operacyjnego z technologią RxDB wspieraną lokalnym modelem optymalizacji SQLite udźwignie nawet stałą re-ewaluację puli, jako że odświeżanie opiera się o subskrypcje zdarzeń reaktywnych na wyselekcjonowanej liście wygenerowanej asynchronicznie już podczas startu ekranu głównego10.

## **Konkluzje i Paradygmaty Systemowe w Aplikacjach Medyczno-Sportowych**

Zaproponowana i zbadana struktura logiki oprogramowania kładzie zdefiniowane ramy dla tworzenia autonomicznych, lokalnych baz wiedzy asystujących w rehabilitacji i doborze sportowych ćwiczeń substytucyjnych. Oparcie się na JSON Schema w środowisku SQLite to fundamentalna ścieżka umożliwiająca ucieczkę od naiwnego tagowania, zastępując go wszechstronną, niefalsyfikowalną strukturą wektorów biomechanicznych.  
Najważniejsze ustalenia z przeglądu literatury oraz mechaniki ludzkiego układu ruchu wyznaczają rygorystyczny paradygmat: pacjent z niestabilnością kolana pozbawionego bocznych ograniczeń więzadłowych (MCL i LCL) z rekonstruowanym więzadłem ACL nie ma prawa funkcjonować w asymetrycznym polu sił i rotacji. Algorytmy muszą implementować twarde wykluczenia odrzucające wszystkie aktywności stymulujące pracę w płaszczyźnie czołowej i poprzecznej, promując bezwzględnie zamknięte łańcuchy kinematyczne (CKC). Jedynie izolowanie ciała w strefie osiowych, strzałkowych sił i wywoływanie naturalnej obrony za pośrednictwem ko-kontrakcji (jednoczesnego skurczu uda przedniego i potężnie działającej tylnej grupy zginaczy biodra we wzorcu Hinge) daje oprogramowaniu pewność, iż nie doprowadzi do mechanicznego pogłębienia patologii i ostatecznego zerwania biologicznych graftów więzadłowych. Z perspektywy inżynierii danych i bezpieczeństwa oprogramowania prozdrowotnego (eHealth/telerehabilitation), taka hermetyzacja logiki to absolutna konieczność w systemach operujących w środowisku z medycznymi wyjątkami operacyjnymi.  
> *Niniejszy dokument ma charakter wyłącznie informacyjny. W celu uzyskania porady medycznej lub postawienia diagnozy należy skonsultować się z odpowiednim profesjonalistą z zakresu ochrony zdrowia.*

#### **Cytowane prace**

> 1. Novel Approaches of Physical Therapy-Based Rehabilitation \- MDPI, [https://mdpi-res.com/bookfiles/book/12953/Novel\_Approaches\_of\_Physical\_TherapyBased\_Rehabilitation.pdf?v=1788657332](https://mdpi-res.com/bookfiles/book/12953/Novel_Approaches_of_Physical_TherapyBased_Rehabilitation.pdf?v=1788657332)  
> 2. Online Recommendation Engines with CockroachDB, [https://www.cockroachlabs.com/blog/recommendation-engines-cockroachdb/](https://www.cockroachlabs.com/blog/recommendation-engines-cockroachdb/)  
> 3. A New Robotic Knee Impedance Control Parameter Optimization, [https://par.nsf.gov/servlets/purl/10356684](https://par.nsf.gov/servlets/purl/10356684)  
> 4. AI in Pediatric Physiotherapy Review | PDF | Artificial Intelligence, [https://www.scribd.com/document/842567912/A-systematic-review-of-artificial-intelligence-for-pediatric-past-present-future](https://www.scribd.com/document/842567912/A-systematic-review-of-artificial-intelligence-for-pediatric-past-present-future)  
> 5. Knee Ligament Injuries: Assessment and Management \- Patient.info, [https://patient.info/doctor/orthopaedics/knee-ligament-injuries-pro](https://patient.info/doctor/orthopaedics/knee-ligament-injuries-pro)  
> 6. High tibial osteotomy in the ACL-deficient knee with medial ... \- PMC, [https://pmc.ncbi.nlm.nih.gov/articles/PMC4999379/](https://pmc.ncbi.nlm.nih.gov/articles/PMC4999379/)  
> 7. What Is Functional Training? — FrancheskaFit | Move More, [https://www.francheskamartinez.com/articles/2020/11/5/functionaltraining](https://www.francheskamartinez.com/articles/2020/11/5/functionaltraining)  
> 8. An Objective Biomechanics Model for Better Program Design, [https://simplifaster.com/articles/biomechanics-model/](https://simplifaster.com/articles/biomechanics-model/)  
> 9. JSON-Based Databases \- Why NoSQL and RxDB Simplify App, [https://rxdb.info/articles/json-based-database.html](https://rxdb.info/articles/json-based-database.html)  
> 10. SQLite Database Development Services \- TAV Tech Solutions, [https://tavtechsolutions.com/technology/sqlite-database-development/](https://tavtechsolutions.com/technology/sqlite-database-development/)  
> 11. 5 reasons SQLite Is the WRONG Database for Edge AI \- Couchbase, [https://www.couchbase.com/blog/5-reasons-sqlite-is-the-wrong-database-for-edge-ai/](https://www.couchbase.com/blog/5-reasons-sqlite-is-the-wrong-database-for-edge-ai/)  
> 12. Rehabilitation of Knee Injuries | Musculoskeletal Key, [https://musculoskeletalkey.com/rehabilitation-of-knee-injuries/](https://musculoskeletalkey.com/rehabilitation-of-knee-injuries/)  
> 13. A 'Plane' Explanation of Anterior Cruciate Ligament Injury Mechanisms, [https://www.ovid.com/journals/spome/fulltext/10.2165/11534950-000000000-00000\~a-plane-explanation-of-anterior-cruciate-ligament-injury](https://www.ovid.com/journals/spome/fulltext/10.2165/11534950-000000000-00000~a-plane-explanation-of-anterior-cruciate-ligament-injury)  
> 14. Collateral Ligament Injuries Of The Knee \- OrthoPaedia, [https://www.orthopaedia.com/collateral-ligament-injuries-of-the-knee/](https://www.orthopaedia.com/collateral-ligament-injuries-of-the-knee/)  
> 15. Medial and Lateral Collateral Ligament Injuries, [https://now.aapmr.org/medial-and-lateral-collateral-ligament-injuries/](https://now.aapmr.org/medial-and-lateral-collateral-ligament-injuries/)  
> 16. Combined ACL–MCL Injuries: Anatomy, Biomechanics, and Clinical, [https://pmc.ncbi.nlm.nih.gov/articles/PMC12566525/](https://pmc.ncbi.nlm.nih.gov/articles/PMC12566525/)  
> 17. Biomechanics of the anterior cruciate ligament: Physiology, rupture, [https://pmc.ncbi.nlm.nih.gov/articles/PMC4757662/](https://pmc.ncbi.nlm.nih.gov/articles/PMC4757662/)  
> 18. (PDF) Graft Intra-Articular Remodeling and Bone Incorporation in, [https://www.researchgate.net/publication/365384104\_Graft\_Intra-Articular\_Remodeling\_and\_Bone\_Incorporation\_in\_ACL\_Reconstruction\_The\_State\_of\_the\_Art\_and\_Clinical\_Implications](https://www.researchgate.net/publication/365384104_Graft_Intra-Articular_Remodeling_and_Bone_Incorporation_in_ACL_Reconstruction_The_State_of_the_Art_and_Clinical_Implications)  
> 19. Varus Alignment Leads to Increased Forces in the Anterior Cruciate, [https://www.researchgate.net/publication/23668986\_Varus\_Alignment\_Leads\_to\_Increased\_Forces\_in\_the\_Anterior\_Cruciate\_Ligament](https://www.researchgate.net/publication/23668986_Varus_Alignment_Leads_to_Increased_Forces_in_the_Anterior_Cruciate_Ligament)  
> 20. Varus alignment leads to increased forces in the anterior cruciate, [https://pubmed.ncbi.nlm.nih.gov/19088054/](https://pubmed.ncbi.nlm.nih.gov/19088054/)  
> 21. Management of Combined Anterior Cruciate Ligament, [https://www.researchgate.net/publication/258501369\_Management\_of\_Combined\_Anterior\_Cruciate\_Ligament-Posterolateral\_Corner\_Tears\_A\_Systematic\_Review](https://www.researchgate.net/publication/258501369_Management_of_Combined_Anterior_Cruciate_Ligament-Posterolateral_Corner_Tears_A_Systematic_Review)  
> 22. Underappreciated Factors to Consider in Revision Anterior Cruciate, [https://pmc.ncbi.nlm.nih.gov/articles/PMC5788104/](https://pmc.ncbi.nlm.nih.gov/articles/PMC5788104/)  
> 23. Anterior Cruciate Ligament Reconstruction \- BrianMac Sports Coach, [https://www.brianmac.co.uk/kneeinj.htm?pagewanted=all](https://www.brianmac.co.uk/kneeinj.htm?pagewanted=all)  
> 24. Closed Kinetic Chain Exercise \- Benefits, Biomechanics \- Mobile, [https://mobilephysiotherapyclinic.in/closed-kinetic-chain-exercise/](https://mobilephysiotherapyclinic.in/closed-kinetic-chain-exercise/)  
> 25. Biomechanics of The Knee During Closed Kinetic Chain and Open, [https://www.scribd.com/document/332543148/Biomechanics-of-the-Knee-During-Closed-Kinetic-Chain-and-Open-Kinetic](https://www.scribd.com/document/332543148/Biomechanics-of-the-Knee-During-Closed-Kinetic-Chain-and-Open-Kinetic)  
> 26. The biomechanics of anterior cruciate ligament rehabilitation and, [https://pubmed.ncbi.nlm.nih.gov/6703185/](https://pubmed.ncbi.nlm.nih.gov/6703185/)  
> 27. The anterior cruciate ligament injury controversy: is “valgus ... \- PMC, [https://pmc.ncbi.nlm.nih.gov/articles/PMC4003572/](https://pmc.ncbi.nlm.nih.gov/articles/PMC4003572/)  
> 28. Voluntary Enhanced Cocontraction of Hamstring Muscles During, [https://www.researchgate.net/publication/263013966\_Voluntary\_Enhanced\_Cocontraction\_of\_Hamstring\_Muscles\_During\_Open\_Kinetic\_Chain\_Leg\_Extension\_Exercise\_Its\_Potential\_Unloading\_Effect\_on\_the\_Anterior\_Cruciate\_Ligament](https://www.researchgate.net/publication/263013966_Voluntary_Enhanced_Cocontraction_of_Hamstring_Muscles_During_Open_Kinetic_Chain_Leg_Extension_Exercise_Its_Potential_Unloading_Effect_on_the_Anterior_Cruciate_Ligament)  
> 29. Free Exercise Db | APIs.io Providers, [https://apis.io/providers/free-exercise-db/](https://apis.io/providers/free-exercise-db/)  
> 30. ExerciseDB Alternative — Direct Exercise API Without RapidAPI, [https://workoutxapp.com/blog/exercisedb-alternative.html](https://workoutxapp.com/blog/exercisedb-alternative.html)  
> 31. Planes, Axes and Primal Movements \- Power Athlete, [https://powerathletehq.com/planes-of-motion-and-axis/](https://powerathletehq.com/planes-of-motion-and-axis/)  
> 32. strength training \- how to categorize exercises (movement patterns), [https://www.tokinesiology.ca/blog/movement-patterns](https://www.tokinesiology.ca/blog/movement-patterns)  
> 33. 6 Foundational Movement Patterns Guide | PDF | Shoulder \- Scribd, [https://www.scribd.com/document/574389641/1-The-6-Foundational-Movement-Patterns](https://www.scribd.com/document/574389641/1-The-6-Foundational-Movement-Patterns)  
> 34. (PDF) Effects of 8-Week Exhausting Deep Knee Flexion Flywheel, [https://www.researchgate.net/publication/364439755\_Effects\_of\_8-Week\_Exhausting\_Deep\_Knee\_Flexion\_Flywheel\_Training\_on\_Persistent\_Quadriceps\_Weakness\_in\_Well-Trained\_Athletes\_Following\_Anterior\_Cruciate\_Ligament\_Reconstruction](https://www.researchgate.net/publication/364439755_Effects_of_8-Week_Exhausting_Deep_Knee_Flexion_Flywheel_Training_on_Persistent_Quadriceps_Weakness_in_Well-Trained_Athletes_Following_Anterior_Cruciate_Ligament_Reconstruction)  
> 35. Hamstrings Stiffness and Landing Biomechanics Linked to Anterior, [https://www.researchgate.net/publication/259199870\_Hamstrings\_Stiffness\_and\_Landing\_Biomechanics\_Linked\_to\_Anterior\_Cruciate\_Ligament\_Loading](https://www.researchgate.net/publication/259199870_Hamstrings_Stiffness_and_Landing_Biomechanics_Linked_to_Anterior_Cruciate_Ligament_Loading)  
> 36. Gender Differences in Neuromuscular Control during the ... \- MDPI, [https://www.mdpi.com/2077-0383/12/9/3296](https://www.mdpi.com/2077-0383/12/9/3296)  
> 37. Single-leg vertical jump test as a functional test after anterior, [https://www.researchgate.net/publication/327016779\_Single-leg\_vertical\_jump\_test\_as\_a\_functional\_test\_after\_anterior\_cruciate\_ligament\_reconstruction](https://www.researchgate.net/publication/327016779_Single-leg_vertical_jump_test_as_a_functional_test_after_anterior_cruciate_ligament_reconstruction)  
> 38. The effect of modelling parameters in the development and ... \- PMC, [https://pmc.ncbi.nlm.nih.gov/articles/PMC8794118/](https://pmc.ncbi.nlm.nih.gov/articles/PMC8794118/)  
> 39. The relationship between anterior tibial shear force during a jump, [https://www.researchgate.net/publication/5252548\_The\_relationship\_between\_anterior\_tibial\_shear\_force\_during\_a\_jump\_landing\_task\_and\_quadriceps\_and\_hamstring\_strength](https://www.researchgate.net/publication/5252548_The_relationship_between_anterior_tibial_shear_force_during_a_jump_landing_task_and_quadriceps_and_hamstring_strength)  
> 40. (PDF) Effects of Two Competitive Soccer Matches on Landing, [https://www.researchgate.net/publication/337270903\_Effects\_of\_Two\_Competitive\_Soccer\_Matches\_on\_Landing\_Biomechanics\_in\_Female\_Division\_I\_Soccer\_Players](https://www.researchgate.net/publication/337270903_Effects_of_Two_Competitive_Soccer_Matches_on_Landing_Biomechanics_in_Female_Division_I_Soccer_Players)  
> 41. SQLite DB Viewer \- Obsidian Plugin, [https://community.obsidian.md/plugins/sqlite-db-viewer](https://community.obsidian.md/plugins/sqlite-db-viewer)  
> 42. SQLite is not a toy database : r/programming \- Reddit, [https://www.reddit.com/r/programming/comments/1fdntj3/sqlite\_is\_not\_a\_toy\_database/](https://www.reddit.com/r/programming/comments/1fdntj3/sqlite_is_not_a_toy_database/)  
> 43. RxDB SQLite RxStorage for Hybrid Apps, [https://rxdb.info/rx-storage-sqlite.html](https://rxdb.info/rx-storage-sqlite.html)  
> 44. Supercharge Flutter Apps with the RxDB Database, [https://rxdb.info/articles/flutter-database.html](https://rxdb.info/articles/flutter-database.html)  
> 45. RxDB Quickstart, [https://rxdb.info/quickstart.html](https://rxdb.info/quickstart.html)  
> 46. How RxDB embraces JSON Schema to build its NoSQL Database, [https://json-schema.org/blog/posts/rxdb-case-study](https://json-schema.org/blog/posts/rxdb-case-study)  
> 47. GitHub \- yuhonas/free-exercise-db, [https://github.com/yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db)  
> 48. Database Performance Tuning – FME Support Center, [https://support.safe.com/hc/en-us/articles/25407716865677-Performance-Tuning-FME-Database-Performance-Tuning](https://support.safe.com/hc/en-us/articles/25407716865677-Performance-Tuning-FME-Database-Performance-Tuning)  
> 49. Implementing SQLite Database Storage in Flutter \- Stackademic, [https://blog.stackademic.com/implementing-sqlite-database-storage-in-flutter-a-complete-guide-with-crud-operations-c57956b671bc](https://blog.stackademic.com/implementing-sqlite-database-storage-in-flutter-a-complete-guide-with-crud-operations-c57956b671bc)  
> 50. GitHub \- russellromney/turbolite: SQLite VFS with sub-100ms cold, [https://github.com/russellromney/turbolite](https://github.com/russellromney/turbolite)  
> 51. Cartilage Rehabilitation: Global Concepts for Successful Joint, [http://tk-vector.ru/wp-content/uploads/2016/11/rehablitation.pdf](http://tk-vector.ru/wp-content/uploads/2016/11/rehablitation.pdf)