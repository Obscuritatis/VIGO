# Nazicht VIGO

Webapp om per site de rolstoelen, rollators en krukken bij te houden die VIGO één keer per jaar nakijkt.
Per site staat een **inventaris** van de toestellen (soort, nummer, merk en type, serienummer, afdeling, omschrijving, tot 2 foto's).
Komt VIGO langs, dan start je een **nieuw nazicht**: dat krijgt alle toestellen die in dienst zijn. Per toestel tik je het
resultaat aan (*In orde*, *Hersteld*, *Herstel nodig*, *Afgekeurd* of *Niet gevonden*) en vul je zo nodig opmerkingen en
foto's in. Een nazicht is te exporteren naar Excel (met foto's).

Sites: Psychiatrisch ziekenhuis Tienen, WZC Sint-Alexius, WZC-Passionisten en WZC-Huize Nazareth.
Sites, soorten toestellen en resultaten staan bovenaan in [`app.js`](app.js) (`SITES`, `SOORTEN`, `RESULTATEN`).

**Inventaris**: plak de toestellen vanuit Excel (met kolomtitels: Soort, Nummer, Merk/type, Serienummer, Afdeling, Omschrijving) of
voeg ze één voor één toe. Staat de soort niet in de rij, dan kies je ze boven het plakvak. Een nummer dat al in de
inventaris staat, wordt overgeslagen. Met *Excel-lijst* download je de inventaris van de site, bv. om vooraf naar VIGO
te sturen. Een afgekeurd toestel zet je *Uit dienst*: het komt dan niet meer in een volgend nazicht, maar blijft
zichtbaar in de oude nazichten.

**Tijdens het nazicht**: vond VIGO een toestel dat nog niet in de lijst stond, voeg het onderaan toe; het komt dan in het
nazicht én in de inventaris. Bij *Afgekeurd* of *Niet gevonden* verschijnt een knop om het toestel meteen uit dienst te zetten.
Op het overzicht zie je per site wanneer het volgende nazicht ten laatste moet gebeuren (één jaar na het vorige).

**Zonder verbinding**: een nazicht kan offline verder. Resultaten, opmerkingen, foto's, extra toestellen en zelfs een
nieuw nazicht starten worden op het toestel bewaard (IndexedDB) en vanzelf verstuurd zodra er weer verbinding is.
Het beheer van de inventaris en de Excel-export vragen wel verbinding.

De app is een statische pagina (GitHub Pages), gebouwd op dezelfde basis als
[staalnamen](https://github.com/Obscuritatis/staalnamen). Ze gebruikt hetzelfde Supabase-project
en dezelfde aanmelding met een link per e-mail, maar eigen tabellen (`vigo_toestellen`, `vigo_nazichten`,
`vigo_nazicht_toestellen`) en een eigen fotobucket (`vigo-fotos`). De gegevens van de andere apps worden niet aangeraakt.

## Eenmalige opzet

1. **Database**: open in het bestaande Supabase-project *SQL Editor*, plak de inhoud van
   [`supabase/schema.sql`](supabase/schema.sql) en klik *Run*. Het script maakt enkel nieuwe onderdelen aan en mag
   opnieuw uitgevoerd worden.
2. **Toegang**: de app gebruikt dezelfde toegangslijst (`toegang`) als de veiligheidsrondes en de staalnamen.
3. **Aanmeldlink**: voeg onder *Authentication > URL Configuration* een extra *Redirect URL* toe voor het adres
   van deze app, bv. `https://obscuritatis.github.io/VIGO/`. Laat de bestaande staan.
4. **GitHub Pages**: repository > *Settings > Pages* > *Deploy from a branch* > `main` / `(root)`.

De koppeling met Supabase staat in [`config.js`](config.js). De app laadt niets van andere sites: de bibliotheken staan
in [`vendor/`](vendor/), de lettertypes in [`fonts/`](fonts/). Een Content Security Policy bovenaan
[`index.html`](index.html) laat enkel code van de site zelf toe en verbindingen met het Supabase-project.
