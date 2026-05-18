# NYX

NYX je osebni sledilnik premoženja. Na enem mestu vidiš vse — vzajemne sklade, ETF-je, delnice in kripto — s cenami v realnem času in pregledom, kako se tvoje premoženje razvija skozi čas.

---

## Kaj znaš narediti

**Portfelj**
Dodaš sredstvo, vpišeš koliko enot imaš in po kateri povprečni ceni si kupil. NYX ti nato pokaže trenutno vrednost, dnevno spremembo in skupen P/L.

**Analitika**
Graf neto vrednosti premoženja, ki raste skupaj s tabo — vsak dan se doda nova točka. Pod grafom je razporeditev po kategorijah, da vidiš, kje si največ izpostavljen.

**Podprta sredstva**
- Vzajemni skladi: Triglav in Infond (NAV se osvežuje vsak delovnik)
- ETF-ji: VWCE in drugi prek Yahoo Finance
- Slovenske delnice: KRKG in vse ostale z Ljubljanske borze
- Kripto: Bitcoin, Ethereum in ostale prek CoinGecko

---

## Kako deluje

Aplikacija teče v brskalniku — ni namestitve, ni aplikacije za prenos. Podatki se shranjujejo varno pri vsakem uporabniku posebej prek Supabase, cene pa se osvežujejo samodejno vsak delovnik prek GitHub Actions.

Registracija je enostavna: vpišeš e-mail in geslo, to je vse.

---

## Za razvijalce

Zgrajena z vanilla JS, brez ogrodij. Backend je Supabase (avtentikacija + baza), hosting je GitHub Pages.

```
index.html   — struktura
nyx.css      — videz
nyx.js       — logika
data/        — cene skladov (osvežuje GitHub Actions)
.github/     — avtomatizacija cen
```

Lokalno poganjanje: samo odpri `index.html` v brskalniku. Za polno delovanje potrebuješ Supabase projekt in ustrezne ključe v `nyx.js`.

---

## Za investitorje

NYX rešuje preprosto težavo: ni dobre, lahke aplikacije za sledenje mešanemu slovensko-globalnemu portfelju. Večina orodij ne pozna Triglava ali LJSE. NYX to zna.

Trg je vsakdo, ki varčuje — bodisi prek vzajemnih skladov, prek VWCE, prek delnic NLB ali kripta. Aplikacija je brezplačna za uporabo in zasnovana tako, da z njim raste — tako po funkcionalnostih kot po številu uporabnikov.

Trenutno v razvoju. Odprto za pogovor.

---

*NYX — ker premoženje zasluži pregled.*
