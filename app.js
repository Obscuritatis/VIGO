// "kleur": eigen kleur per site op het overzicht.
const SITES = [
  { id: "pz-tienen", naam: "Psychiatrisch ziekenhuis Tienen", kleur: "#2f6f62" },
  { id: "wzc-sint-alexius", naam: "WZC Sint-Alexius", kleur: "#c47a24" },
  { id: "wzc-passionisten", naam: "WZC-Passionisten", kleur: "#7b4f8f" },
  { id: "wzc-huize-nazareth", naam: "WZC-Huize Nazareth", kleur: "#a64a6a",
    afkortingen: "HH = Heilig Hart, STE = Sint-Elisabeth, STF = Sint-Franciscus, STJ = Sint-Jozef, TED = technische dienst" },
];
// Soorten hulpmiddelen. "kop": herkent de soort in een geplakte Excel-cel.
const SOORTEN = [
  { id: "rolstoel", naam: "Rolstoel", meervoud: "Rolstoelen", kop: /rolstoel/i },
  { id: "rollator", naam: "Rollator", meervoud: "Rollators", kop: /rollator/i },
  { id: "looprek", naam: "Looprek", meervoud: "Looprekken", kop: /looprek|loophulp|walker/i },
  { id: "kruk", naam: "Kruk", meervoud: "Krukken", kop: /kruk/i },
];
// Uitkomst van het nazicht door VIGO per toestel. "aandacht": er moet nog iets mee gebeuren.
const RESULTATEN = [
  { id: "ok", naam: "In orde", klasse: "ok" },
  { id: "hersteld", naam: "Hersteld", klasse: "ok" },
  { id: "herstel", naam: "Herstel nodig", klasse: "open", aandacht: true },
  { id: "afgekeurd", naam: "Afgekeurd", klasse: "open", aandacht: true },
  { id: "niet-gevonden", naam: "Niet gevonden", klasse: "weg", aandacht: true },
];
const BUCKET = "vigo-fotos";

let sb = null, sessie = null, ready = false;
let toestellen = [];  // inventaris: {id, site, soort, nummer, merk, serienummer, afdeling, omschrijving, foto, foto2, uitDienst, ongekend}
let nazichten = [];   // {id, site, datum, aangemaakt}
let items = [];       // toestellen in een nazicht: {id, nazichtId, toestelId, volgorde, soort, nummer, merk, serienummer, afdeling, omschrijving, resultaat, opmerkingen, fotos[]}
let state = { view: "sites", site: null, nazicht: null, filter: "alle", soort: "alle", edit: null, confirm: null, editNazicht: false, plakken: false, nieuwToestel: false, uitDienst: false };
// Bij herladen terug naar dezelfde pagina (en scrollpositie) als daarnet.
const PLEK_SLEUTEL = "vigo-nazicht-plek";
let scrollTerug = null;
try {
  const plek = JSON.parse(localStorage.getItem(PLEK_SLEUTEL) || "null");
  if (plek && SITES.some(x => x.id === plek.site) && (plek.view === "site" || (plek.view === "nazicht" && plek.nazicht))) {
    Object.assign(state, { view: plek.view, site: plek.site, nazicht: plek.nazicht || null, filter: plek.filter || "alle", soort: plek.soort || "alle", uitDienst: !!plek.uitDienst });
    scrollTerug = plek.scroll || 0;
  }
} catch {}
function bewaarPlek() {
  try { localStorage.setItem(PLEK_SLEUTEL, JSON.stringify({ view: state.view, site: state.site, nazicht: state.nazicht, filter: state.filter, soort: state.soort, uitDienst: state.uitDienst, scroll: Math.round(scrollY) })); } catch {}
}
addEventListener("scroll", () => { clearTimeout(bewaarPlek.t); bewaarPlek.t = setTimeout(bewaarPlek, 300); }, { passive: true });
addEventListener("pagehide", bewaarPlek);

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const fmtDate = iso => { if (!iso) return "—"; const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
// Het volgende nazicht: één jaar na het vorige.
const jaarLater = iso => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${+y + 1}-${m}-${d}`; };
const siteVan = id => SITES.find(s => s.id === id) || { id, naam: id };
const siteNaam = id => siteVan(id).naam;
const soortVan = id => SOORTEN.find(s => s.id === id) || { id, naam: id || "Onbekend", meervoud: id || "Onbekend" };
const resultaatVan = id => RESULTATEN.find(r => r.id === id) || null;
const aantal = (n, s) => `${n} ${(n === 1 ? s.naam : s.meervoud).toLowerCase()}`;
// Volgorde: per soort, dan op nummer (12 komt na 9), dan per afdeling.
const vergelijk = (a, b) => SOORTEN.findIndex(s => s.id === a.soort) - SOORTEN.findIndex(s => s.id === b.soort)
  || (a.nummer || "").localeCompare(b.nummer || "", "nl", { numeric: true })
  || (a.afdeling || "").localeCompare(b.afdeling || "", "nl", { numeric: true });
// Standaard alleen toestellen in dienst; met "alles" ook uit dienst en status ongekend.
const toestellenVan = (site, alles = false) => toestellen.filter(t => t.site === site && (alles || (!t.uitDienst && !t.ongekend))).sort(vergelijk);
// Status ongekend: vroeger gelabeld, maar niet aangeboden bij het nazicht. Komen niet in een nieuw nazicht.
const ongekendVan = site => toestellen.filter(t => t.site === site && t.ongekend && !t.uitDienst)
  .sort((a, b) => (a.afdeling || "").localeCompare(b.afdeling || "", "nl", { numeric: true }) || vergelijk(a, b));
const perAfdeling = lijst => { const m = new Map(); for (const t of lijst) { const k = t.afdeling || "Zonder afdeling"; if (!m.has(k)) m.set(k, []); m.get(k).push(t); } return [...m]; };
const nazichtenVan = site => nazichten.filter(n => n.site === site).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.aangemaakt || "").localeCompare(a.aangemaakt || ""));
const itemsVan = nazichtId => items.filter(p => p.nazichtId === nazichtId).sort((a, b) => a.volgorde - b.volgorde);
const nagekeken = p => !!resultaatVan(p.resultaat);
const aandacht = p => !!(resultaatVan(p.resultaat) || {}).aandacht;
const naam = p => [p.nummer ? `Nr. ${p.nummer}` : "", p.merk].filter(Boolean).join(" · ") || "(geen nummer)";
const plaats = p => [p.afdeling, p.serienummer ? `Serienr. ${p.serienummer}` : "", p.omschrijving].filter(Boolean).join(" · ");
// Een toestel heeft tot 2 foto's (kolommen foto en foto2), zodat je het herkent.
const MAX_TOESTEL_FOTOS = 2;
const toestelFotos = v => v ? [v.foto, v.foto2].filter(Boolean) : [];
const fotosVanItem = p => toestelFotos(toestellen.find(v => v.id === p.toestelId));

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200);
}
function banner(msg) { const b = $("#banner"); b.textContent = msg || ""; b.hidden = !msg; }
function voortgang(ps) {
  const n = ps.filter(nagekeken).length, a = ps.filter(aandacht).length;
  return `<span class="pill ${ps.length && n === ps.length ? "ok" : ""}">${n} van ${ps.length} nagekeken</span>${a ? `<span class="pill open">${a} met aandacht</span>` : ""}`;
}
function resultaatPill(id) {
  const r = resultaatVan(id);
  return r ? `<span class="pill ${r.klasse}">${esc(r.naam)}</span>` : '<span class="pill">Na te kijken</span>';
}
// Laatste uitkomst per toestel, over alle nazichten heen.
function laatsteResultaten() {
  const m = new Map();
  for (const p of items) {
    if (!p.toestelId || !nagekeken(p)) continue;
    const n = nazichten.find(x => x.id === p.nazichtId); if (!n) continue;
    const oud = m.get(p.toestelId);
    if (!oud || n.datum > oud.datum) m.set(p.toestelId, { datum: n.datum, resultaat: p.resultaat });
  }
  return m;
}

function go(view, extra = {}) {
  ["e", "n", "x"].forEach(wisKeuze);
  state = { ...state, view, edit: null, confirm: null, editNazicht: false, plakken: false, nieuwToestel: false, ...extra };
  render();
  window.scrollTo({ top: 0 });
}

/* ---------- Views ---------- */
let lastKey = "";
function render() {
  const v = $("#view");
  const key = [state.view, state.site, state.nazicht, state.edit, state.plakken, state.nieuwToestel].join(":");
  const keep = {};
  if (key === lastKey) v.querySelectorAll("form input[id]:not([type=file]), form textarea[id], form select[id]").forEach(el => keep[el.id] = el.type === "checkbox" || el.type === "radio" ? el.checked : el.value);
  if (state.view === "nazicht" && ready && !nazichten.find(r => r.id === state.nazicht)) state.view = "site";
  if (!sessie) { v.innerHTML = viewLogin(); lastKey = ""; return; }
  v.innerHTML = state.view === "site" ? viewSite() : state.view === "nazicht" ? viewNazicht() : viewSites();
  for (const id in keep) { const el = document.getElementById(id); if (el && el.closest("form")) { if (el.type === "checkbox" || el.type === "radio") el.checked = keep[id]; else el.value = keep[id]; } }
  if (state.plakken) toonPlakVoorbeeld();
  lastKey = key;
  toonFotos();
  bewaarPlek();
  // Pas terugscrollen als de gegevens er zijn, anders is de pagina nog te kort.
  if (scrollTerug !== null && ready) { const y = scrollTerug; scrollTerug = null; requestAnimationFrame(() => scrollTo(0, y)); }
}

function viewLogin() {
  if (!sb) return '<div class="empty">Laden…</div>';
  return `<form class="panel login" id="form-login">
    <h2>Aanmelden</h2>
    <p class="muted" style="margin:0">Vul je e-mailadres in. Je krijgt een mail met een link om je aan te melden.</p>
    <div class="field"><label class="lbl" for="l-mail">E-mailadres</label><input type="text" inputmode="email" autocomplete="email" id="l-mail" required></div>
    <button class="btn primary" type="submit">Stuur aanmeldlink</button>
  </form>`;
}

function crumbs(...delen) {
  return `<nav class="crumbs">${delen.map(([tekst, attr]) => attr ? `<button ${attr}>${esc(tekst)}</button>` : `<span>${esc(tekst)}</span>`).join("<span>/</span>")}</nav>`;
}

// Wanneer moet VIGO terugkomen? Eén jaar na het laatste nazicht.
function volgendNazicht(site) {
  const ns = nazichtenVan(site);
  if (!ns.length) return "";
  const volgend = jaarLater(ns[0].datum), te = volgend < today();
  return `<span class="pill ${te ? "open" : ""}">${te ? "Nazicht te laat sinds" : "Volgend nazicht vóór"} ${fmtDate(volgend)}</span>`;
}

function viewSites() {
  const cards = SITES.map(s => {
    const ts = toestellenVan(s.id), ns = nazichtenVan(s.id);
    const nOng = ongekendVan(s.id).length;
    const pills = SOORTEN.map(so => `<span class="pill soort-${so.id}">${aantal(ts.filter(t => t.soort === so.id).length, so)}</span>`).join("") + (nOng ? `<span class="pill open">${nOng} status ongekend</span>` : "");
    return `<button class="site" data-go-site="${s.id}" style="--k:${s.kleur}"><h3>${esc(s.naam)}</h3>
      ${!ready ? '<div class="last">laden…</div>' : `<div class="stats">${pills}</div>
      <div class="last">${ns.length ? `Laatste nazicht ${fmtDate(ns[0].datum)}` : "Nog geen nazicht"}</div>
      ${ns.length ? `<div class="stats">${volgendNazicht(s.id)}</div>` : ""}`}
    </button>`;
  }).join("");
  return `<div style="display:grid;gap:12px"><p class="muted" style="margin:0">Kies een site om de rolstoelen, rollators, looprekken en krukken bij te houden of het jaarlijkse nazicht door VIGO in te vullen.</p><div class="sites">${cards}</div></div>`;
}

function fotoDuims(paden, alt) {
  return paden.length ? `<div class="duims">${paden.map(f => fotoDuim(f, alt)).join("")}</div>` : "";
}
function fotoDuim(pad, alt) {
  return pad ? `<button type="button" class="duim-knop" data-groot="${esc(pad)}" aria-label="Foto vergroten"><img class="duim" data-foto="${esc(pad)}" alt="${esc(alt)}"></button>` : "";
}
function soortFilter(lijst) {
  return [["alle", `Alle (${lijst.length})`], ...SOORTEN.map(s => [s.id, `${s.meervoud} (${lijst.filter(t => t.soort === s.id).length})`])]
    .map(([f, lbl]) => `<button class="btn small" aria-pressed="${state.soort === f}" data-soort="${f}">${esc(lbl)}</button>`).join("");
}

function viewSite() {
  const s = state.site;
  const ts = toestellenVan(s), ns = nazichtenVan(s);
  const lijst = ns.map(n => `<button class="ronde" data-go-nazicht="${n.id}"><span class="date">${fmtDate(n.datum)}</span><span class="stats">${voortgang(itemsVan(n.id))}</span></button>`).join("");
  const nieuw = `<form class="panel" id="form-nazicht"><h3>Nieuw nazicht door VIGO</h3>
        <p class="muted" style="margin:0">${ts.length
          ? `Het nazicht krijgt de ${ts.length} toestellen uit de inventaris hieronder (${SOORTEN.map(so => aantal(ts.filter(t => t.soort === so.id).length, so)).join(", ")}). Toestellen die VIGO onderweg vindt, voeg je in het nazicht toe.${ongekendVan(s).length ? ` De ${ongekendVan(s).length} toestellen met status ongekend komen er niet in; vind je er een terug, tik dan in het nazicht op Teruggevonden.` : ""}`
          : "De inventaris is nog leeg. Start het nazicht en voeg de toestellen toe terwijl je met VIGO rondgaat: ze komen meteen ook in de inventaris."}</p>
        <div class="row">
          <div class="field" style="flex:0 1 180px"><label class="lbl" for="r-datum">Datum</label><input type="date" id="r-datum" required value="${today()}"></div>
          <button class="btn primary" type="submit">Start nazicht</button>
        </div></form>`;
  return `<div style="display:grid;gap:20px">
    ${crumbs(["Alle sites", "data-go-sites"], [siteNaam(s)])}
    <div class="head"><h2>${esc(siteNaam(s))}</h2><div class="stats">${volgendNazicht(s)}</div></div>
    ${nieuw}
    <div style="display:grid;gap:10px">
      <h3>Nazichten</h3>
      ${!ready ? '<div class="empty">Laden…</div>' : lijst ? `<div class="list">${lijst}</div>` : '<div class="empty">Nog geen nazicht.</div>'}
    </div>
    ${viewInventaris(s)}
  </div>`;
}

function toestelForm(p, pre) {
  const e = p || { soort: state.soort !== "alle" ? state.soort : SOORTEN[0].id };
  return `<div class="row">
      <div class="field" style="flex-basis:150px"><label class="lbl" for="${pre}-soort">Soort</label><select id="${pre}-soort">${SOORTEN.map(s => `<option value="${s.id}" ${e.soort === s.id ? "selected" : ""}>${esc(s.naam)}</option>`).join("")}</select></div>
      <div class="field" style="flex-basis:140px"><label class="lbl" for="${pre}-nummer">Nummer</label><input type="text" id="${pre}-nummer" value="${esc(e.nummer)}" placeholder="bv. RS-012"></div>
      <div class="field"><label class="lbl" for="${pre}-merk">Merk en type</label><input type="text" id="${pre}-merk" value="${esc(e.merk)}" placeholder="bv. Invacare Action 3"></div>
      <div class="field"><label class="lbl" for="${pre}-serienummer">Serienummer</label><input type="text" id="${pre}-serienummer" value="${esc(e.serienummer)}" placeholder="bv. 1234567890"></div>
      <div class="field"><label class="lbl" for="${pre}-afdeling">Afdeling</label><input type="text" id="${pre}-afdeling" value="${esc(e.afdeling)}" placeholder="bv. STE"></div>
      <div class="field wide"><label class="lbl" for="${pre}-omschrijving">Omschrijving</label><input type="text" id="${pre}-omschrijving" value="${esc(e.omschrijving)}" placeholder="bv. blauw, met beensteunen, staat in de berging"></div>
      <div class="field wide"><span class="lbl">Foto's van het toestel (maximaal ${MAX_TOESTEL_FOTOS})</span>
        <div class="foto-veld">
          ${fotoVoorbeelden(pre, { fotos: toestelFotos(p) })}
          <input type="file" accept="image/*" capture="environment" id="${pre}-camera" data-foto-input="${pre}" data-toestel>
          <label class="btn" for="${pre}-camera">Foto nemen</label>
          <input type="file" accept="image/*" multiple id="${pre}-bestand" data-foto-input="${pre}" data-toestel>
          <label class="btn" for="${pre}-bestand">Foto kiezen</label>
        </div></div>
    </div>`;
}
function leesToestelForm(pre) {
  return {
    soort: $(`#${pre}-soort`).value,
    nummer: $(`#${pre}-nummer`).value.trim(),
    merk: $(`#${pre}-merk`).value.trim(),
    serienummer: $(`#${pre}-serienummer`).value.trim(),
    afdeling: $(`#${pre}-afdeling`).value.trim(),
    omschrijving: $(`#${pre}-omschrijving`).value.trim(),
  };
}
const leegToestel = d => !d.nummer && !d.merk && !d.serienummer && !d.omschrijving;

function viewInventaris(s) {
  const alle = toestellenVan(s, true).filter(t => !t.ongekend || t.uitDienst), actief = alle.filter(t => !t.uitDienst), nUit = alle.length - actief.length;
  if (state.plakken) return `<form class="panel" id="form-plak">
      <h3>Toestellen plakken uit Excel</h3>
      <p class="muted" style="margin:0">Selecteer in Excel de rijen met de toestellen, samen met de kolomtitels, kopieer ze en plak ze hieronder.
        Herkende kolommen: Soort, Nummer, Merk/type, Serienummer, Afdeling en Omschrijving. Een nummer dat al in de inventaris staat, wordt overgeslagen.</p>
      <div class="row"><div class="field" style="flex:0 1 260px"><label class="lbl" for="plak-soort">Soort als die niet in de rij staat</label>
        <select id="plak-soort">${SOORTEN.map(so => `<option value="${so.id}" ${state.soort === so.id ? "selected" : ""}>${esc(so.naam)}</option>`).join("")}</select></div></div>
      <div class="field wide"><label class="lbl" for="plak-tekst">Geplakt uit Excel</label><textarea id="plak-tekst" style="min-height:140px;font-family:ui-monospace,monospace;font-size:.85rem" placeholder="Plak hier (Ctrl+V)"></textarea></div>
      ${toestellenVan(s, true).length ? `<label class="check"><input type="checkbox" id="plak-vervang"> De ${toestellenVan(s, true).length} bestaande toestellen eerst verwijderen (hun foto's ook)</label>` : ""}
      <div id="plak-voorbeeld"></div>
      <div class="actions" style="justify-content:flex-end"><button type="button" class="btn" data-plakken-stop>Annuleren</button><button class="btn primary" type="submit">Toestellen opslaan</button></div>
    </form>`;
  const laatste = laatsteResultaten();
  const getoond = (state.uitDienst ? alle : actief).filter(t => state.soort === "alle" || t.soort === state.soort);
  const rijen = getoond.map(p => {
    if (state.edit === "toestel:" + p.id) return `<form class="panel" data-toestel-form="${p.id}"><h3>Toestel bewerken</h3>${toestelForm(p, "e")}
      <div class="actions" style="justify-content:flex-end"><button type="button" class="btn" data-cancel-edit>Annuleren</button><button class="btn primary" type="submit">Opslaan</button></div></form>`;
    const conf = state.confirm === "toestel:" + p.id, l = laatste.get(p.id);
    return `<article class="vast soort-${esc(p.soort)} ${p.uitDienst ? "uit" : ""}">
      <span class="soort soort-${esc(p.soort)}">${esc(soortVan(p.soort).naam)}</span>
      <div class="vast-tekst">
        <div class="subject">${esc(naam(p))}</div>
        ${plaats(p) ? `<div class="meta">${esc(plaats(p))}</div>` : ""}
        <div class="stats">${p.uitDienst ? '<span class="pill weg">Uit dienst</span>' : ""}${l ? `<span class="last">Nazicht ${fmtDate(l.datum)}:</span> ${resultaatPill(l.resultaat)}` : '<span class="last">Nog niet nagekeken</span>'}</div>
      </div>
      ${fotoDuims(toestelFotos(p), "Foto van het toestel")}
      <div class="actions vast-acties">${conf
        ? `<span class="muted" style="align-self:center">Uit de inventaris verwijderen? Oude nazichten blijven bewaard.</span><button class="btn small danger" data-del-toestel="${p.id}">Ja</button><button class="btn small" data-confirm="">Nee</button>`
        : `<button class="btn small" data-edit="toestel:${p.id}">Bewerken</button>
           <button class="btn small" data-uit-dienst="${p.id}" data-waarde="${p.uitDienst ? "" : "1"}">${p.uitDienst ? "Terug in dienst" : "Uit dienst"}</button>
           <button class="btn small danger" data-confirm="toestel:${p.id}">Verwijderen</button>`}</div>
    </article>`;
  }).join("");
  const af = siteVan(s).afkortingen;
  return `<div style="display:grid;gap:10px">
    <div class="head"><h3>Inventaris</h3>
      <div class="actions"><button class="btn small" data-lijst ${actief.length ? "" : "disabled"} title="Lijst van alle toestellen op deze site">Excel-lijst</button><button class="btn small" data-plakken>Plakken uit Excel</button><button class="btn small" data-nieuw-toestel>Toestel toevoegen</button></div></div>
    <div class="head"><div class="filters">${soortFilter(actief)}</div>
      ${nUit ? `<label class="check" style="font-size:.9rem"><input type="checkbox" data-toon-uit ${state.uitDienst ? "checked" : ""}> Ook uit dienst tonen (${nUit})</label>` : ""}</div>
    ${af ? `<p class="muted" style="margin:0">${esc(af)}</p>` : ""}
    ${state.nieuwToestel ? `<form class="panel" id="form-toestel"><h3>Nieuw toestel</h3>${toestelForm(null, "n")}
      <div class="actions" style="justify-content:flex-end"><button type="button" class="btn" data-nieuw-stop>Annuleren</button><button class="btn primary" type="submit">Toevoegen</button></div></form>` : ""}
    ${!ready ? '<div class="empty">Laden…</div>' : rijen ? `<div class="list">${rijen}</div>` : `<div class="empty">${alle.length ? "Geen toestellen van deze soort." : "Nog geen toestellen in de inventaris."}</div>`}
    ${ready ? viewOngekend(s, null) : ""}
  </div>`;
}

// Sectie "Status ongekend", per afdeling. In een nazicht zet Teruggevonden het toestel ook meteen in dat nazicht.
function viewOngekend(s, nazichtId) {
  const lijst = ongekendVan(s);
  if (!lijst.length) return "";
  const groepen = perAfdeling(lijst).map(([afd, ts]) => `<div style="display:grid;gap:6px"><h4 style="margin:6px 0 0">${esc(afd)} (${ts.length})</h4>
    <div class="list">${ts.map(p => `<article class="vast soort-${esc(p.soort)}">
      <span class="soort soort-${esc(p.soort)}">${esc(soortVan(p.soort).naam)}</span>
      <div class="vast-tekst"><div class="subject">${esc(naam(p))}</div>${p.serienummer || p.omschrijving ? `<div class="meta">${esc([p.serienummer ? `Serienr. ${p.serienummer}` : "", p.omschrijving].filter(Boolean).join(" · "))}</div>` : ""}
        <div class="stats"><span class="pill open">Status ongekend</span></div></div>
      ${fotoDuims(toestelFotos(p), "Foto van het toestel")}
      <div class="actions vast-acties"><button class="btn small primary" data-gevonden="${p.id}"${nazichtId ? ` data-nazicht-id="${nazichtId}"` : ""} title="${nazichtId ? "Komt in dit nazicht en terug in de inventaris" : "Komt terug in de inventaris"}">Teruggevonden</button>
        <button class="btn small" data-uit-dienst="${p.id}" data-waarde="1" title="Definitief weg">Uit dienst</button></div>
    </article>`).join("")}</div></div>`).join("");
  return `<details class="panel" ${nazichtId ? "" : "open"} style="display:grid;gap:10px">
    <summary><h3 style="display:inline">Status ongekend (${lijst.length})</h3></summary>
    <p class="muted" style="margin:0">Vroeger gelabeld, maar niet aangeboden bij het nazicht. Ze komen niet in een nieuw nazicht. Vind je er een terug, tik dan op Teruggevonden.</p>
    ${groepen}
  </details>`;
}

function resultaatKnoppen(p) {
  return `<div class="keuzes" role="group" aria-label="Resultaat">${RESULTATEN.map(r =>
    `<button type="button" class="keuze ${r.klasse}" data-resultaat="${p.id}" data-waarde="${r.id}" aria-pressed="${p.resultaat === r.id}">${esc(r.naam)}</button>`).join("")}</div>`;
}

function itemForm(p) {
  return `<div class="row">
      <fieldset class="field wide loc-set"><legend class="lbl">Resultaat</legend>
        <div class="checks">${RESULTATEN.map(r => `<label class="check"><input type="radio" name="e-resultaat" id="e-r-${r.id}" value="${r.id}" ${p.resultaat === r.id ? "checked" : ""}> ${esc(r.naam)}</label>`).join("")}</div>
      </fieldset>
      <div class="field wide"><label class="lbl" for="e-opmerkingen">Opmerkingen (wat werd nagekeken of hersteld, wat moet nog gebeuren)</label><textarea id="e-opmerkingen">${esc(p.opmerkingen)}</textarea></div>
      <div class="field wide"><span class="lbl">Foto's bij dit nazicht</span>
        <div class="foto-veld">
          ${fotoVoorbeelden("e", p)}
          <input type="file" accept="image/*" capture="environment" id="e-camera" data-foto-input="e">
          <label class="btn" for="e-camera">Foto nemen</label>
          <input type="file" accept="image/*" multiple id="e-bestand" data-foto-input="e">
          <label class="btn" for="e-bestand">Foto's kiezen</label>
        </div>
      </div>
    </div>
    <div class="actions" style="justify-content:flex-end"><button type="button" class="btn" data-cancel-edit>Annuleren</button><button class="btn primary" type="submit">Opslaan</button></div>`;
}

function viewNazicht() {
  const r = nazichten.find(x => x.id === state.nazicht);
  if (!r) return '<div class="empty">Nazicht laden…</div>';
  const all = itemsVan(r.id);
  const vanSoort = all.filter(p => state.soort === "alle" || p.soort === state.soort);
  const shown = vanSoort.filter(p => state.filter === "alle" ? true : state.filter === "te-doen" ? !nagekeken(p) : state.filter === "aandacht" ? aandacht(p) : nagekeken(p));
  const list = shown.map(p => {
    const refs = fotosVanItem(p), res = resultaatVan(p.resultaat);
    const titel = refs.length ? `<button type="button" class="titel-knop" data-groot="${esc(refs.join("|"))}" title="Foto van het toestel tonen">${esc(naam(p))}</button>` : esc(naam(p));
    if (state.edit === p.id) return `<form class="panel" data-edit-form="${p.id}"><h3><span class="soort soort-${esc(p.soort)}">${esc(soortVan(p.soort).naam)}</span> ${titel}</h3>${plaats(p) ? `<div class="meta">${esc(plaats(p))}</div>` : ""}${itemForm(p)}</form>`;
    const conf = state.confirm === "item:" + p.id;
    const t = toestellen.find(x => x.id === p.toestelId);
    return `<article class="staal ${res ? res.klasse : "te-doen"}">
      <div class="staal-top">
        <span class="subject"><span class="soort soort-${esc(p.soort)}">${esc(soortVan(p.soort).naam)}</span> ${titel}</span>
        <span class="stats">${resultaatPill(p.resultaat)}${p.resultaat === "afgekeurd" && p.meegenomen ? '<span class="pill weg">Meegenomen</span>' : ""}</span>
      </div>
      <div class="punt-midden">
        <div style="display:grid;gap:6px;min-width:0">
          ${plaats(p) ? `<div class="meta">${esc(plaats(p))}</div>` : ""}
          ${p.opmerkingen && p.resultaat !== "herstel" ? `<p>${esc(p.opmerkingen)}</p>` : ""}
        </div>
        ${fotoDuims(refs, "Foto van het toestel")}
      </div>
      ${p.fotos.length ? `<div class="fotos">${p.fotos.map(f => fotoDuim(f, "Foto bij nazicht")).join("")}</div>` : ""}
      ${resultaatKnoppen(p)}
      ${p.resultaat === "afgekeurd" ? `<div class="herstel"><span class="lbl">Meegenomen door VIGO?</span><div class="keuzes">
        <button type="button" class="keuze weg" data-meegenomen="${p.id}" data-waarde="ja" aria-pressed="${p.meegenomen === true}">Ja, meegenomen</button>
        <button type="button" class="keuze weg" data-meegenomen="${p.id}" data-waarde="nee" aria-pressed="${p.meegenomen === false}">Nee, blijft hier</button></div></div>` : ""}
      ${p.resultaat === "herstel" ? `<form class="herstel" data-herstel-form><label class="lbl" for="h-${p.id}">Wat moet vervangen of hersteld worden?</label>
        <textarea id="h-${p.id}" data-herstel="${p.id}" placeholder="bv. rem links vervangen, voetsteun rechts los">${esc(p.opmerkingen)}</textarea>
        <span class="meta">Wordt vanzelf bewaard terwijl je typt.</span></form>` : ""}
      <div class="actions" style="justify-content:flex-end">${conf
        ? `<span class="muted" style="align-self:center">Toestel uit dit nazicht verwijderen?</span><button class="btn small danger" data-del-item="${p.id}">Ja, verwijderen</button><button class="btn small" data-confirm="">Nee</button>`
        : `${(p.resultaat === "afgekeurd" || p.resultaat === "niet-gevonden") && !p.meegenomen && t && !t.uitDienst ? `<button class="btn small" data-uit-dienst="${t.id}" data-waarde="1" title="Komt dan niet meer in het volgende nazicht">Uit dienst zetten</button>` : ""}
           <button class="btn small" data-edit="${p.id}">Opmerking of foto</button><button class="btn small danger" data-confirm="item:${p.id}">Verwijderen</button>`}</div>
    </article>`;
  }).join("");
  const nKlaar = vanSoort.filter(nagekeken).length, nAandacht = vanSoort.filter(aandacht).length;
  const filt = [["alle", `Alle (${vanSoort.length})`], ["te-doen", `Na te kijken (${vanSoort.length - nKlaar})`], ["nagekeken", `Nagekeken (${nKlaar})`], ["aandacht", `Aandacht (${nAandacht})`]]
    .map(([f, lbl]) => `<button class="btn small" aria-pressed="${state.filter === f}" data-filter="${f}">${lbl}</button>`).join("");
  const confR = state.confirm === "nazicht";
  const head = state.editNazicht
    ? `<form class="panel" id="form-nazicht-edit"><h3>Nazicht bewerken</h3><div class="row">
        <div class="field" style="flex:0 1 180px"><label class="lbl" for="re-datum">Datum</label><input type="date" id="re-datum" required value="${esc(r.datum)}"></div>
        <div class="actions"><button type="button" class="btn" data-cancel-nazicht>Annuleren</button><button class="btn primary" type="submit">Opslaan</button></div>
      </div></form>`
    : `<div class="head">
        <div><div class="eyebrow">Nazicht VIGO · ${esc(siteNaam(r.site))}</div><h2>${fmtDate(r.datum)}</h2></div>
        <div class="actions">${confR
          ? `<span class="muted" style="align-self:center">Nazicht met ${all.length} toestellen verwijderen?</span><button class="btn small danger" data-del-nazicht>Ja, verwijderen</button><button class="btn small" data-confirm="">Nee</button>`
          : `<button class="btn small" data-export>Excel-export</button><button class="btn small" data-edit-nazicht>Bewerken</button><button class="btn small danger" data-confirm="nazicht">Verwijderen</button>`}</div>
      </div>`;
  const telling = RESULTATEN.map(x => [x, all.filter(p => p.resultaat === x.id).length]).filter(([, n]) => n)
    .map(([x, n]) => `<span class="pill ${x.klasse}">${esc(x.naam)}: ${n}</span>`).join("");
  const extra = `<form class="panel" id="form-extra"><h3>Toestel toevoegen</h3>
      <p class="muted" style="margin:0">Een toestel dat nog niet in de lijst staat, voeg je hier toe. Het komt in dit nazicht én in de inventaris van de site. Soort en afdeling blijven staan voor het volgende toestel.</p>
      ${toestelForm(null, "x")}
      <div class="actions" style="justify-content:flex-end"><button class="btn primary" type="submit">Toevoegen</button></div>
    </form>`;
  const af = siteVan(r.site).afkortingen;
  return `<div style="display:grid;gap:20px">
    ${crumbs(["Alle sites", "data-go-sites"], [siteNaam(r.site), `data-go-site="${esc(r.site)}"`], [fmtDate(r.datum)])}
    ${head}
    <div class="stats">${voortgang(all)}${telling}</div>
    <div style="display:grid;gap:10px">
      <div class="head"><h3>Toestellen</h3><div class="filters">${filt}</div></div>
      <div class="filters">${soortFilter(all)}</div>
      ${af ? `<p class="muted" style="margin:0">${esc(af)}</p>` : ""}
      ${shown.length ? `<div class="list">${list}</div>` : `<div class="empty">${all.length ? (state.filter === "te-doen" ? "Alle toestellen zijn nagekeken." : "Geen toestellen in deze selectie.") : "Nog geen toestellen in dit nazicht. Voeg ze hieronder toe terwijl je rondgaat."}</div>`}
      ${all.length ? "" : extra}
    </div>
    ${all.length ? extra : ""}
    ${viewOngekend(r.site, r.id)}
  </div>`;
}

/* ---------- Plakken uit Excel ---------- */
// Excel kopieert als tekst met tabs tussen de cellen; cellen met een regeleinde staan tussen aanhalingstekens.
function leesTabel(tekst) {
  tekst = tekst.replace(/\r\n?/g, "\n");
  const scheiding = tekst.includes("\t") ? "\t" : tekst.includes(";") ? ";" : "\t";
  const rijen = []; let rij = [], cel = "", q = false;
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst[i];
    if (q) { if (c === '"') { if (tekst[i + 1] === '"') { cel += '"'; i++; } else q = false; } else cel += c; }
    else if (c === '"' && cel === "") q = true;
    else if (c === scheiding) { rij.push(cel); cel = ""; }
    else if (c === "\n") { rij.push(cel); rijen.push(rij); rij = []; cel = ""; }
    else cel += c;
  }
  if (cel || rij.length) { rij.push(cel); rijen.push(rij); }
  return rijen.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean));
}
// Zet geplakte rijen om naar toestellen aan de hand van de kolomtitels.
function toestellenUitPlak(tekst, standaardSoort) {
  const rijen = leesTabel(tekst);
  if (!rijen.length) return { toestellen: [], fout: "" };
  const kop = rijen[0].map(k => k.toLowerCase());
  const zoek = (re, behalve = []) => kop.findIndex((k, i) => re.test(k) && !behalve.includes(i));
  const soort = zoek(/soort|hulpmiddel|toestel/);
  const kol = {
    soort,
    serienummer: zoek(/serie|^sn\b|s\/n/),
    merk: zoek(/merk|model|type/, [soort]),
    afdeling: zoek(/afdeling|gebouw|zone|dienst|locatie|plaats/),
    omschrijving: zoek(/omschrijving|opmerking|kleur|kamer|info|beschrijving/),
  };
  if (kol.nummer < 0 && kol.merk < 0 && kol.serienummer < 0 && kol.omschrijving < 0) return { toestellen: [], fout: "Geen kolom Nummer, Merk, Serienummer of Omschrijving gevonden. Kopieer ook de rij met de kolomtitels." };
  const cel = (r, i) => i >= 0 ? (r[i] || "") : "";
  const lijst = rijen.slice(1).map(r => ({
    soort: (SOORTEN.find(so => so.kop.test(cel(r, kol.soort))) || { id: standaardSoort }).id,
    nummer: cel(r, kol.nummer), merk: cel(r, kol.merk), serienummer: cel(r, kol.serienummer), afdeling: cel(r, kol.afdeling), omschrijving: cel(r, kol.omschrijving),
  })).filter(t => !leegToestel(t));
  return { toestellen: lijst, fout: "" };
}
// Nummers die al in de inventaris staan (per soort), worden niet opnieuw toegevoegd.
const bestaatAl = (t, lijst) => t.nummer && lijst.some(x => x.soort === t.soort && x.nummer.toLowerCase() === t.nummer.toLowerCase());
function toonPlakVoorbeeld() {
  const el = $("#plak-voorbeeld"); if (!el) return;
  const { toestellen: ts, fout } = toestellenUitPlak($("#plak-tekst").value, $("#plak-soort").value);
  if (fout) { el.innerHTML = `<div class="banner">${esc(fout)}</div>`; return; }
  const vervang = $("#plak-vervang") && $("#plak-vervang").checked, oud = vervang ? [] : toestellenVan(state.site, true);
  el.innerHTML = ts.length ? `<div style="display:grid;gap:6px"><span class="lbl">Voorbeeld: ${ts.length} toestellen${ts.some(t => bestaatAl(t, oud)) ? `, waarvan ${ts.filter(t => bestaatAl(t, oud)).length} al in de inventaris (overgeslagen)` : ""}</span>
    <div class="tabel-wrap"><table><thead><tr><th>Soort</th><th>Nummer</th><th>Merk en type</th><th>Serienummer</th><th>Afdeling</th><th>Omschrijving</th></tr></thead>
    <tbody>${ts.map(t => `<tr${bestaatAl(t, oud) ? ' class="muted" style="text-decoration:line-through"' : ""}><td>${esc(soortVan(t.soort).naam)}</td><td>${esc(t.nummer)}</td><td>${esc(t.merk)}</td><td>${esc(t.serienummer)}</td><td>${esc(t.afdeling)}</td><td>${esc(t.omschrijving)}</td></tr>`).join("")}</tbody></table></div></div>` : "";
}

/* ---------- Foto's (Supabase Storage, bucket "vigo-fotos") ---------- */
const fotoUrls = new Map();
async function fotoUrl(pad) {
  if (fotoUrls.has(pad)) return fotoUrls.get(pad);
  // Een foto die nog in de wachtrij staat, komt van dit toestel.
  const lokaal = wachtrij.find(it => it.actie === "foto" && it.pad === pad);
  if (lokaal) { const url = URL.createObjectURL(lokaal.blob); fotoUrls.set(pad, url); return url; }
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(pad, 60 * 60 * 12).catch(() => ({}));
  const url = data && data.signedUrl;
  if (url) fotoUrls.set(pad, url);
  // Zonder verbinding: de service worker geeft de foto uit zijn bewaarde kopie, als ze al eens getoond werd.
  return url || encodeURI(`${window.VIGO_CONFIG.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${pad}?offline=1`);
}
function bewaarFoto(pad, blob) { return sb.storage.from(BUCKET).upload(pad, blob, { upsert: true, contentType: "image/jpeg" }); }
async function wisFotos(paden) {
  paden = (paden || []).filter(Boolean); if (!paden.length) return;
  paden.forEach(p => fotoUrls.delete(p));
  try { await sb.storage.from(BUCKET).remove(paden); } catch (e) { console.error(e); }
}
function toonFotos() {
  document.querySelectorAll("img[data-foto]").forEach(async img => {
    const url = await fotoUrl(img.dataset.foto);
    if (url && img.isConnected) img.src = url;
  });
}
// Foto verkleinen tot max. 1600 px, JPEG: kleiner bestand, sneller opladen.
async function verklein(file) {
  const bron = await createImageBitmap(file).catch(() => null);
  if (!bron) return file;
  const k = Math.min(1, 1600 / Math.max(bron.width, bron.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bron.width * k); c.height = Math.round(bron.height * k);
  c.getContext("2d").drawImage(bron, 0, 0, c.width, c.height);
  return new Promise(ok => c.toBlob(b => ok(b || file), "image/jpeg", 0.8));
}
// Gekozen maar nog niet opgeslagen foto's in het formulier dat open staat.
// "e": formulier dat open staat om te bewerken, "n": nieuw toestel in de inventaris, "x": extra toestel in een nazicht.
const fotoNieuw = { e: [], n: [], x: [] };                          // [{ blob, url }]
const fotoWeg = { e: new Set(), n: new Set(), x: new Set() };       // bestaande paden die weg moeten
function fotoVoorbeelden(pre, p) {
  const bestaand = (p.fotos || []).filter(f => !fotoWeg[pre].has(f)).map(f =>
    `<div class="foto-keuze"><img class="duim" data-foto="${esc(f)}" alt="Huidige foto"><button type="button" data-foto-weg="${pre}" data-pad="${esc(f)}" aria-label="Foto verwijderen">×</button></div>`);
  const nieuw = fotoNieuw[pre].map((f, i) =>
    `<div class="foto-keuze"><img class="duim" src="${f.url}" alt="Gekozen foto"><button type="button" data-foto-weg="${pre}" data-i="${i}" aria-label="Foto verwijderen">×</button></div>`);
  return bestaand.concat(nieuw).join("");
}
function wisKeuze(pre) {
  fotoNieuw[pre].forEach(f => URL.revokeObjectURL(f.url));
  fotoNieuw[pre] = []; fotoWeg[pre] = new Set();
}
// Foto's die bij een nieuw toestel gekozen zijn: ze gaan mee in de wachtrij en komen in foto en foto2.
function nieuweToestelFotos(pre, t) {
  const fotos = fotoNieuw[pre].slice(0, MAX_TOESTEL_FOTOS).map((f, i) => ({ actie: "foto", pad: `${t.site}/toestellen/${t.id}-${Date.now()}-${i}.jpg`, blob: f.blob }));
  t.foto = fotos[0] ? fotos[0].pad : null; t.foto2 = fotos[1] ? fotos[1].pad : null;
  wisKeuze(pre);
  return fotos;
}
async function uploadNieuw(pre, map, id) {
  const paden = [];
  for (let i = 0; i < fotoNieuw[pre].length; i++) {
    const pad = `${map}/${id}-${Date.now()}-${i}.jpg`;
    const up = await bewaarFoto(pad, fotoNieuw[pre][i].blob).catch(err => ({ error: err }));
    if (up.error) { console.error(up.error); await wisFotos(paden); return null; }
    paden.push(pad);
  }
  return paden;
}

/* ---------- Excel-export ---------- */
const EXCELJS_URL = "vendor/exceljs-4.4.0.min.js";
function laadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((ok, nok) => {
    const sc = document.createElement("script");
    sc.src = EXCELJS_URL; sc.onload = () => ok(window.ExcelJS); sc.onerror = nok;
    document.head.appendChild(sc);
  });
}
// Kleine versie van de foto voor in Excel, zodat het bestand licht blijft.
async function fotoVoorExcel(pad) {
  const { data: blob } = await sb.storage.from(BUCKET).download(pad); if (!blob) return null;
  const bron = await createImageBitmap(blob).catch(() => null); if (!bron) return null;
  const k = Math.min(1, 160 / Math.max(bron.width, bron.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bron.width * k); c.height = Math.round(bron.height * k);
  c.getContext("2d").drawImage(bron, 0, 0, c.width, c.height);
  const b64 = c.toDataURL("image/jpeg", 0.8).split(",")[1];
  return { base64: b64, width: c.width, height: c.height };
}
const MAX_FOTOS_EXCEL = 4;
// Zet een foto in een cel (kolom k0 is 0-gebaseerd) en maakt de rij hoog genoeg.
async function fotoInCel(wb, ws, rij, rijNr, k0, pad) {
  const f = await fotoVoorExcel(pad).catch(() => null);
  if (!f) { rij.getCell(k0 + 1).value = "(foto niet beschikbaar)"; return; }
  const id = wb.addImage({ base64: f.base64, extension: "jpeg" });
  ws.addImage(id, { tl: { col: k0 + 0.05, row: rijNr - 1 + 0.05 }, ext: { width: f.width, height: f.height }, editAs: "oneCell" });
  rij.height = Math.max(rij.height || 15, f.height * 0.75 + 8);
}
function xlInfo(ws, info, n) {
  info.forEach(([k, v], i) => {
    const rij = ws.getRow(2 + i);
    rij.getCell(1).value = k; rij.getCell(1).font = { bold: true, color: { argb: XL.grijs } };
    ws.mergeCells(2 + i, 1, 2 + i, 2); ws.mergeCells(2 + i, 3, 2 + i, n);
    rij.getCell(3).value = v;
  });
  return 2 + info.length + 1;
}
async function exporteerNazicht(nazichtId) {
  const r = nazichten.find(x => x.id === nazichtId); if (!r) return;
  let ExcelJS;
  try { ExcelJS = await laadExcelJS(); } catch { toast("Excel-export kon niet geladen worden. Controleer je internetverbinding."); return; }
  const lijst = itemsVan(r.id);
  const nFoto = Math.min(MAX_FOTOS_EXCEL, Math.max(0, ...lijst.map(p => p.fotos.length)));
  const kolommen = [["Nr", 5], ["Soort", 11], ["Nummer", 12], ["Merk en type", 22], ["Serienummer", 16], ["Afdeling", 14], ["Omschrijving", 28], ["Resultaat", 15], ["Opmerkingen", 36]];
  const opmKol = kolommen.length, resKol = 8;
  const nTst = Math.max(0, ...lijst.map(p => fotosVanItem(p).length));
  for (let i = 0; i < nTst; i++) kolommen.push([nTst === 1 ? "Foto toestel" : `Foto toestel ${i + 1}`, 24]);
  for (let i = 0; i < nFoto; i++) kolommen.push([nFoto === 1 ? "Foto nazicht" : `Foto nazicht ${i + 1}`, 24]);
  const n = kolommen.length;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Nazicht VIGO"; wb.created = new Date();
  const ws = wb.addWorksheet("Nazicht", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  ws.columns = kolommen.map(([, w]) => ({ width: w }));
  xlTitel(ws, `Nazicht VIGO – ${siteNaam(r.site)}`, n);
  const telling = RESULTATEN.map(x => `${x.naam}: ${lijst.filter(p => p.resultaat === x.id).length}`).join(" · ");
  const KOP = xlInfo(ws, [["Site", siteNaam(r.site)], ["Datum", fmtDate(r.datum)], ["Nagekeken", `${lijst.filter(nagekeken).length} van ${lijst.length}`], ["Resultaat", telling], ["Geëxporteerd op", new Date().toLocaleString("nl-BE")]], n);
  xlKop(ws.getRow(KOP), kolommen, () => "left");
  ws.views = [{ state: "frozen", ySplit: KOP }];
  ws.pageSetup.printTitlesRow = `${KOP}:${KOP}`;
  const rand = { style: "thin", color: { argb: XL.rand } };

  for (let i = 0; i < lijst.length; i++) {
    const p = lijst[i], rijNr = KOP + 1 + i, rij = ws.getRow(rijNr), res = resultaatVan(p.resultaat);
    const waarden = [i + 1, soortVan(p.soort).naam, p.nummer, p.merk, p.serienummer, p.afdeling, p.omschrijving, res ? res.naam + (p.resultaat === "afgekeurd" && p.meegenomen !== null ? (p.meegenomen ? " – meegenomen door VIGO" : " – blijft op de site") : "") : "Niet nagekeken"];
    waarden.push(p.fotos.length > nFoto ? [p.opmerkingen, `(+${p.fotos.length - nFoto} foto's in de app)`].filter(Boolean).join("\n") : p.opmerkingen);
    for (let k = 0; k < nTst + nFoto; k++) waarden.push("");
    rij.values = waarden;
    rij.eachCell({ includeEmpty: true }, cel => {
      cel.alignment = { vertical: "top", horizontal: "left", wrapText: true };
      cel.border = { top: rand, bottom: rand, left: rand, right: rand };
      if (i % 2) cel.fill = xlVul(XL.zebra);
    });
    rij.getCell(1).font = { bold: true, color: { argb: XL.accent } };
    const rc = rij.getCell(resKol);
    rc.fill = xlVul(!res ? XL.zebra : res.klasse === "ok" ? XL.okBg : res.klasse === "open" ? XL.openBg : XL.wegBg);
    rc.font = { bold: true, color: { argb: !res ? XL.grijs : res.klasse === "ok" ? XL.ok : res.klasse === "open" ? XL.open : XL.grijs } };
    rij.height = Math.max(30, Math.ceil(Math.max((p.opmerkingen || "").length / 40, (p.omschrijving || "").length / 30)) * 15 + 6);
    const tst = fotosVanItem(p);
    for (let k = 0; k < tst.length; k++) await fotoInCel(wb, ws, rij, rijNr, opmKol + k, tst[k]);
    for (let k = 0; k < Math.min(nFoto, p.fotos.length); k++) await fotoInCel(wb, ws, rij, rijNr, opmKol + nTst + k, p.fotos[k]);
  }
  if (lijst.length) ws.autoFilter = { from: { row: KOP, column: 1 }, to: { row: KOP + lijst.length, column: opmKol } };
  else ws.getCell(`A${KOP + 1}`).value = "Geen toestellen in dit nazicht.";

  await tabNietGevonden(wb, r, lijst);
  await downloadExcel(wb, `Nazicht VIGO ${siteNaam(r.site)} ${r.datum}.xlsx`);
}
// Apart tabblad voor de dienst: wat niet gevonden werd bij dit nazicht en wat nog status ongekend heeft, per afdeling.
// De laatste kolom is leeg, zodat de dienst kan noteren waar het toestel teruggevonden werd.
async function tabNietGevonden(wb, r, lijst) {
  const zoek = [
    ...lijst.filter(p => p.resultaat === "niet-gevonden" && !(toestellen.find(t => t.id === p.toestelId) || {}).uitDienst).map(p => ({ ...p, status: "Niet gevonden bij dit nazicht", tst: fotosVanItem(p) })),
    ...ongekendVan(r.site).filter(t => !lijst.some(p => p.toestelId === t.id)).map(t => ({ ...t, status: "Status ongekend (vroeger gelabeld)", tst: toestelFotos(t) })),
  ].sort((a, b) => (a.afdeling || "").localeCompare(b.afdeling || "", "nl", { numeric: true }) || vergelijk(a, b));
  const kolommen = [["Nr", 5], ["Afdeling", 18], ["Soort", 11], ["Nummer", 12], ["Merk en type", 22], ["Serienummer", 16], ["Omschrijving", 26], ["Status", 22], ["Teruggevonden waar en wanneer?", 34]];
  const nTst = Math.max(0, ...zoek.map(p => p.tst.length));
  for (let i = 0; i < nTst; i++) kolommen.push([nTst === 1 ? "Foto toestel" : `Foto toestel ${i + 1}`, 24]);
  const n = kolommen.length, invulKol = 9;
  const ws = wb.addWorksheet("Niet gevonden", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  ws.columns = kolommen.map(([, w]) => ({ width: w }));
  xlTitel(ws, `Te zoeken toestellen – ${siteNaam(r.site)}`, n);
  ws.properties.tabColor = { argb: XL.open };
  const afd = perAfdeling(zoek).map(([a, ts]) => `${a}: ${ts.length}`).join(" · ");
  const KOP = xlInfo(ws, [["Site", siteNaam(r.site)], ["Nazicht", fmtDate(r.datum)], ["Aantal", `${zoek.length}${afd ? ` (${afd})` : ""}`],
    ["Vraag", "Zoek deze toestellen op je afdeling. Gevonden? Noteer waar en wanneer, en meld het aan de verantwoordelijke hulpmiddelen."]], n);
  xlKop(ws.getRow(KOP), kolommen, () => "left");
  ws.views = [{ state: "frozen", ySplit: KOP }];
  ws.pageSetup.printTitlesRow = `${KOP}:${KOP}`;
  const rand = { style: "thin", color: { argb: XL.rand } };
  for (let i = 0; i < zoek.length; i++) {
    const p = zoek[i], rijNr = KOP + 1 + i, rij = ws.getRow(rijNr);
    rij.values = [i + 1, p.afdeling, soortVan(p.soort).naam, p.nummer, p.merk, p.serienummer, p.omschrijving, p.status, "", ...Array(nTst).fill("")];
    rij.eachCell({ includeEmpty: true }, cel => {
      cel.alignment = { vertical: "top", horizontal: "left", wrapText: true };
      cel.border = { top: rand, bottom: rand, left: rand, right: rand };
      if (i % 2) cel.fill = xlVul(XL.zebra);
    });
    rij.getCell(1).font = { bold: true, color: { argb: XL.accent } };
    rij.getCell(2).font = { bold: true };
    rij.getCell(8).font = { bold: true, color: { argb: XL.open } };
    rij.getCell(invulKol).fill = xlVul("FFFFFDF0");
    rij.height = 30;
    for (let k = 0; k < p.tst.length; k++) await fotoInCel(wb, ws, rij, rijNr, invulKol + k, p.tst[k]);
  }
  if (zoek.length) ws.autoFilter = { from: { row: KOP, column: 1 }, to: { row: KOP + zoek.length, column: invulKol } };
  else ws.getCell(`A${KOP + 1}`).value = "Alle toestellen zijn gevonden.";
}
// Huisstijl van de Excel-bestanden: dezelfde kleuren als de app.
const XL = { accent: "FF2F6F62", accentLicht: "FFDFEEE8", zebra: "FFFBF7F1", rand: "FFE7DDD0", grijs: "FF776B5F", ok: "FF3D7A34", okBg: "FFE5F0DC", open: "FFB4492F", openBg: "FFF8E4DB", wegBg: "FFEDE8E1" };
const xlVul = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
function xlTitel(ws, tekst, n) {
  ws.properties.tabColor = { argb: XL.accent };
  ws.mergeCells(1, 1, 1, n);
  const c = ws.getCell("A1");
  c.value = tekst; c.font = { bold: true, size: 18, color: { argb: XL.accent } };
  c.alignment = { vertical: "middle" };
  ws.getRow(1).height = 32;
}
function xlKop(rij, kolommen, uitlijning) {
  kolommen.forEach(([titel], i) => {
    const cel = rij.getCell(i + 1);
    cel.value = titel; cel.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cel.fill = xlVul(XL.accent);
    cel.alignment = { vertical: "middle", horizontal: uitlijning(i), wrapText: true };
    cel.border = { bottom: { style: "thin", color: { argb: XL.accent } } };
  });
  rij.height = 30;
}
async function downloadExcel(wb, bestandsnaam) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const naam = bestandsnaam.replace(/[\\/:*?"<>|]/g, "-");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = naam;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast("Excel-bestand gedownload");
}

// Inventaris van een site (toestellen in dienst), bv. om door te sturen naar VIGO vóór het nazicht.
async function exporteerInventaris(site) {
  let ExcelJS;
  try { ExcelJS = await laadExcelJS(); } catch { toast("Excel-export kon niet geladen worden. Controleer je internetverbinding."); return; }
  const lijst = [...toestellenVan(site), ...ongekendVan(site)], laatste = laatsteResultaten();
  const kolommen = [["Nr", 5], ["Soort", 11], ["Nummer", 12], ["Merk en type", 24], ["Serienummer", 16], ["Afdeling", 14], ["Omschrijving", 32], ["Laatste nazicht", 14], ["Resultaat", 15], ["Status ongekend", 15]];
  const fotoKol = kolommen.length, nTst = Math.max(0, ...lijst.map(p => toestelFotos(p).length));
  for (let i = 0; i < nTst; i++) kolommen.push([nTst === 1 ? "Foto" : `Foto ${i + 1}`, 24]);
  const n = kolommen.length;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Nazicht VIGO"; wb.created = new Date();
  const ws = wb.addWorksheet("Inventaris", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  ws.columns = kolommen.map(([, w]) => ({ width: w }));
  xlTitel(ws, `Inventaris hulpmiddelen – ${siteNaam(site)}`, n);
  const KOP = xlInfo(ws, [["Site", siteNaam(site)], ["Aantal", [...SOORTEN.map(so => aantal(lijst.filter(t => t.soort === so.id).length, so)), `totaal ${lijst.length}`, ...(lijst.some(t => t.ongekend) ? [`waarvan ${lijst.filter(t => t.ongekend).length} status ongekend`] : [])].join(" · ")], ["Geëxporteerd op", new Date().toLocaleString("nl-BE")]], n);
  xlKop(ws.getRow(KOP), kolommen, () => "left");
  ws.views = [{ state: "frozen", ySplit: KOP }];
  ws.pageSetup.printTitlesRow = `${KOP}:${KOP}`;
  const rand = { style: "thin", color: { argb: XL.rand } };
  for (let i = 0; i < lijst.length; i++) {
    const p = lijst[i], rijNr = KOP + 1 + i, rij = ws.getRow(rijNr), l = laatste.get(p.id);
    rij.values = [i + 1, soortVan(p.soort).naam, p.nummer, p.merk, p.serienummer, p.afdeling, p.omschrijving, l ? fmtDate(l.datum) : "", l ? resultaatVan(l.resultaat).naam : "", p.ongekend ? "Ja" : "", ...Array(nTst).fill("")];
    rij.eachCell({ includeEmpty: true }, cel => {
      cel.alignment = { vertical: "top", horizontal: "left", wrapText: true };
      cel.border = { top: rand, bottom: rand, left: rand, right: rand };
      if (i % 2) cel.fill = xlVul(XL.zebra);
    });
    rij.getCell(1).font = { bold: true, color: { argb: XL.accent } };
    const fotos = toestelFotos(p);
    for (let k = 0; k < fotos.length; k++) await fotoInCel(wb, ws, rij, rijNr, fotoKol + k, fotos[k]);
  }
  if (lijst.length) ws.autoFilter = { from: { row: KOP, column: 1 }, to: { row: KOP + lijst.length, column: fotoKol } };

  await downloadExcel(wb, `Inventaris hulpmiddelen ${siteNaam(site)}.xlsx`);
}

/* ---------- Opslag (Supabase) ---------- */
const toestelRij = r => ({ id: r.id, site: r.site, soort: r.soort, nummer: r.nummer || "", merk: r.merk || "", serienummer: r.serienummer || "", afdeling: r.afdeling || "",
  omschrijving: r.omschrijving || "", foto: r.foto || null, foto2: r.foto2 || null, uitDienst: !!r.uit_dienst, ongekend: !!r.ongekend });
const nazichtRij = r => ({ id: r.id, site: r.site, datum: r.datum, aangemaakt: r.aangemaakt });
const itemRij = r => ({ id: r.id, nazichtId: r.nazicht_id, toestelId: r.toestel_id || null, volgorde: r.volgorde || 0, soort: r.soort, nummer: r.nummer || "",
  merk: r.merk || "", serienummer: r.serienummer || "", afdeling: r.afdeling || "", omschrijving: r.omschrijving || "", resultaat: r.resultaat || "", meegenomen: typeof r.meegenomen === "boolean" ? r.meegenomen : null,
  opmerkingen: r.opmerkingen || "", fotos: Array.isArray(r.fotos) ? r.fotos : [] });
// Kopie van een toestel in een nazicht: latere wijzigingen aan de inventaris veranderen oude nazichten niet.
const kopie = t => ({ toestel_id: t.id, soort: t.soort, nummer: t.nummer, merk: t.merk, serienummer: t.serienummer, afdeling: t.afdeling, omschrijving: t.omschrijving });

// Supabase geeft max. 1000 rijen per keer terug; haal alles op in stukken.
async function selectAlles(tabel) {
  const uit = [];
  for (let van = 0; ; van += 1000) {
    const { data, error } = await sb.from(tabel).select("*").order("id").range(van, van + 999);
    if (error) return { error };
    uit.push(...data);
    if (data.length < 1000) return { data: uit, error: null };
  }
}

const TABELLEN = ["vigo_toestellen", "vigo_nazichten", "vigo_nazicht_toestellen"];
async function laadAlles() {
  const res = await Promise.all(TABELLEN.map(selectAlles));
  const fout = res.map(x => x.error).find(Boolean);
  if (fout) {
    // Geen verbinding: verder werken met de gegevens die op dit toestel bewaard zijn.
    if (netwerkFout(fout)) { geenVerbinding = true; zetSync(); return; }
    banner("De gegevens konden niet geladen worden. Heb je toegang gekregen? Vraag het aan de beheerder."); return;
  }
  banner(""); geenVerbinding = false;
  TABELLEN.forEach((t, i) => raw[t] = res[i].data);
  try { localStorage.setItem(CACHE_SLEUTEL, JSON.stringify({ gebruiker: sessie && sessie.user && sessie.user.email, ...raw })); } catch (e) { console.error(e); }
  herbereken(); ready = true; zetSync();
  renderSafe();
}

/* ---------- Offline werken ----------
   Alles wat je tijdens een nazicht doet (resultaat aanduiden, opmerkingen, foto's, een extra toestel, een nieuw nazicht,
   een toestel uit dienst zetten) gaat eerst naar een wachtrij op dit toestel (IndexedDB, met de foto's erbij) en wordt
   verstuurd zodra er verbinding is. Het bewerken en verwijderen van toestellen in de inventaris vraagt wel verbinding. */
const raw = { vigo_toestellen: [], vigo_nazichten: [], vigo_nazicht_toestellen: [] };   // zoals laatst geladen uit Supabase
const CACHE_SLEUTEL = "vigo-nazicht-gegevens";
let wachtrij = [];          // [{k, actie: upsert|update|delete|foto|wis, tabel, rijen|id|data|pad|blob|paden}]
let versturen = null, geenVerbinding = false, laatsteFout = null, laatsteK = 0;

const netwerkFout = e => !navigator.onLine || !e || e.status === 0 || /fetch|network|load failed|timeout|abort/i.test(String(e.message || e));
// Fouten die bij een nieuwe poging niet weggaan (geen toegang, ongeldige gegevens): die wijziging valt weg.
const blijvendeFout = e => e && !netwerkFout(e) && /^(42501|22|23)/.test(String(e.code || ""));

function idb(modus, fn) {
  return new Promise((ok, nok) => {
    const open = indexedDB.open("vigo-nazicht", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("wachtrij", { keyPath: "k" });
    open.onerror = () => nok(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("wachtrij", modus), req = fn(tx.objectStore("wachtrij"));
      tx.oncomplete = () => { db.close(); ok(req && req.result); };
      tx.onerror = () => { db.close(); nok(tx.error); };
    };
  });
}

// Gegevens zoals laatst geladen + wat nog in de wachtrij staat.
function herbereken() {
  const d = {}; TABELLEN.forEach(t => d[t] = raw[t].slice());
  for (const it of wachtrij) {
    const t = d[it.tabel]; if (!t) continue;
    if (it.actie === "upsert") it.rijen.forEach(rij => { if (!t.some(x => x.id === rij.id)) t.push(rij); });
    else if (it.actie === "update") { const i = t.findIndex(x => x.id === it.id); if (i >= 0) t[i] = { ...t[i], ...it.data }; }
    else if (it.actie === "delete") {
      d[it.tabel] = t.filter(x => x.id !== it.id);
      if (it.tabel === "vigo_nazichten") d.vigo_nazicht_toestellen = d.vigo_nazicht_toestellen.filter(p => p.nazicht_id !== it.id);
    }
  }
  toestellen = d.vigo_toestellen.map(toestelRij); nazichten = d.vigo_nazichten.map(nazichtRij); items = d.vigo_nazicht_toestellen.map(itemRij);
}

// "stil": niet opnieuw tekenen, bv. terwijl iemand nog in een tekstvak typt.
async function wacht(lijst, okMsg, { stil = false } = {}) {
  lijst = lijst.map(it => ({ ...it, k: laatsteK = Math.max(Date.now(), laatsteK + 1) }));
  try { await idb("readwrite", st => { lijst.forEach(it => st.put(it)); }); }
  catch (e) { console.error(e); }   // geen IndexedDB (bv. privévenster): de wachtrij staat enkel in het geheugen
  wachtrij.push(...lijst);
  herbereken(); if (!stil) render();
  if (okMsg) toast(navigator.onLine && !geenVerbinding ? okMsg : "Bewaard op dit toestel; wordt verstuurd zodra er verbinding is");
  verstuur();
}

function voerUit(it) {
  if (it.actie === "foto") return bewaarFoto(it.pad, it.blob);
  if (it.actie === "wis") return sb.storage.from(BUCKET).remove(it.paden);
  const q = sb.from(it.tabel);
  if (it.actie === "upsert") return q.upsert(it.rijen, { ignoreDuplicates: true });   // nog eens versturen kan geen kwaad
  if (it.actie === "update") return q.update(it.data).eq("id", it.id);
  if (it.actie === "delete") return q.delete().eq("id", it.id);
  return { error: null };
}

// Verstuurt de wachtrij in volgorde. Lukt het niet door de verbinding, dan blijft alles staan voor later.
function verstuur() {
  if (versturen || !sb || !sessie || !wachtrij.length) { zetSync(); return versturen; }
  versturen = (async () => {
    zetSync();
    let fout = null;
    while (wachtrij.length) {
      const it = wachtrij[0];
      let res;
      try { res = await voerUit(it); } catch (e) { res = { error: e }; }
      if (res && res.error) {
        console.error(res.error);
        if (!blijvendeFout(res.error)) { fout = res.error; break; }
        toast(res.error.code === "42501" ? "Je hebt geen toegang om dit op te slaan." : "Een wijziging kon niet opgeslagen worden.");
      }
      wachtrij.shift();
      await idb("readwrite", st => { st.delete(it.k); }).catch(() => {});
    }
    versturen = null; laatsteFout = fout;
    if (fout && netwerkFout(fout)) geenVerbinding = true;
    // Geen verbindingsprobleem maar toch geweigerd: toon de reden, anders blijft de wachtrij onzichtbaar hangen.
    else if (fout) banner(`${wachtrij.length} ${wachtrij.length === 1 ? "wijziging kon" : "wijzigingen konden"} niet verstuurd worden: ${[fout.message || fout.error || String(fout), fout.code || fout.statusCode].filter(Boolean).join(" · ")}. Ze blijven bewaard op dit toestel en de app probeert het opnieuw. Stuur deze melding door als ze blijft staan.`);
    zetSync();
    if (!fout) await laadAlles();
  })();
  return versturen;
}

function zetSync() {
  const el = $("#sync"); if (!el) return;
  const n = wachtrij.length, offline = !navigator.onLine || geenVerbinding;
  el.hidden = !sessie || (!n && !offline);
  el.classList.toggle("wacht", n > 0);
  const wat = n ? ` · ${n} ${n === 1 ? "wijziging wacht" : "wijzigingen wachten"}` : "";
  el.textContent = offline ? `Offline${wat || " · je kan verder werken"}` : versturen ? `Versturen${wat}` : `Nog niet verstuurd${wat}`;
  el.title = laatsteFout && !offline ? String(laatsteFout.message || laatsteFout) : "";
}

// Bij het opstarten: de gegevens en wachtrij van de vorige keer, zodat de app ook zonder verbinding meteen werkt.
async function laadBewaard(s) {
  let bewaard = false;   // "ready" pas zetten na herbereken, anders lijkt een geopend nazicht even verdwenen
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_SLEUTEL) || "null");
    if (c && c.gebruiker === (s.user && s.user.email)) { TABELLEN.forEach(t => raw[t] = c[t] || []); bewaard = true; }
  } catch (e) { console.error(e); }
  try { wachtrij = ((await idb("readonly", st => st.getAll())) || []).sort((a, b) => a.k - b.k); } catch (e) { console.error(e); }
  laatsteK = Math.max(laatsteK, ...wachtrij.map(it => it.k));
  herbereken(); if (bewaard) ready = true; zetSync(); render();
}

async function write(fn, okMsg) {
  try {
    const { error } = await fn();
    if (error) throw error;
    if (okMsg) toast(okMsg);
    laadAlles();
    return true;
  } catch (e) {
    console.error(e);
    toast(e && (e.code === "42501" || /row-level security/i.test(e.message || "")) ? "Je hebt geen toegang om dit op te slaan." : "Opslaan mislukt. Controleer je verbinding en probeer opnieuw.");
    return false;
  }
}

document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  const knop = f.querySelector("button[type=submit]");
  if (f.id === "form-login") {
    const email = $("#l-mail").value.trim();
    if (!email) return;
    knop.disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
    knop.disabled = false;
    if (error) toast("Versturen mislukt: " + error.message);
    else f.innerHTML = `<h2>Kijk in je mailbox</h2><p style="margin:0">We stuurden een aanmeldlink naar <strong>${esc(email)}</strong>. Open die link op dit toestel.</p>`;
  } else if (f.id === "form-plak") {
    const { toestellen: ts, fout } = toestellenUitPlak($("#plak-tekst").value, $("#plak-soort").value);
    if (fout || !ts.length) { $("#plak-tekst").focus(); toast(fout || "Plak eerst de toestellen uit Excel"); return; }
    const oud = toestellenVan(state.site, true), vervang = $("#plak-vervang") && $("#plak-vervang").checked;
    const nieuw = vervang ? ts : ts.filter(t => !bestaatAl(t, oud));
    if (!nieuw.length) { toast("Al deze toestellen staan al in de inventaris"); return; }
    knop.disabled = true;
    if (vervang && oud.length) {
      const weg = await Promise.all(oud.map(p => sb.from("vigo_toestellen").delete().eq("id", p.id)));
      if (weg.some(x => x.error)) { knop.disabled = false; toast("De bestaande toestellen konden niet verwijderd worden."); laadAlles(); return; }
      wisFotos(oud.flatMap(toestelFotos));
    }
    const ok = await write(() => sb.from("vigo_toestellen").insert(nieuw.map(t => ({ id: crypto.randomUUID(), site: state.site, ...t }))),
      `${nieuw.length} ${nieuw.length === 1 ? "toestel" : "toestellen"} opgeslagen${ts.length > nieuw.length ? ` (${ts.length - nieuw.length} ${ts.length - nieuw.length === 1 ? "stond" : "stonden"} er al)` : ""}`);
    knop.disabled = false;
    if (ok) { state.plakken = false; render(); }
  } else if (f.id === "form-toestel") {
    const d = leesToestelForm("n");
    if (leegToestel(d)) { $("#n-nummer").focus(); toast("Vul een nummer, merk, serienummer of omschrijving in"); return; }
    const t = { id: crypto.randomUUID(), site: state.site, ...d }, fotos = nieuweToestelFotos("n", t);
    state.nieuwToestel = false;
    await wacht([...fotos, { actie: "upsert", tabel: "vigo_toestellen", rijen: [t] }], "Toestel toegevoegd");
  } else if (f.dataset.toestelForm) {
    const id = f.dataset.toestelForm, oud = toestellen.find(p => p.id === id); if (!oud) return;
    const d = leesToestelForm("e");
    if (leegToestel(d)) { $("#e-nummer").focus(); toast("Vul een nummer, merk, serienummer of omschrijving in"); return; }
    knop.disabled = true;
    const nieuw = await uploadNieuw("e", `${oud.site}/toestellen`, id);
    if (!nieuw) { knop.disabled = false; toast("De foto kon niet opgeslagen worden. Probeer opnieuw."); return; }
    const fotos = toestelFotos(oud).filter(f => !fotoWeg.e.has(f)).concat(nieuw);
    d.foto = fotos[0] || null; d.foto2 = fotos[1] || null;
    const ok = await write(() => sb.from("vigo_toestellen").update(d).eq("id", id), "Opgeslagen");
    knop.disabled = false;
    if (!ok) { wisFotos(nieuw); return; }
    // De oude foto blijft bewaard: oude nazichten kunnen er nog naar verwijzen via dit toestel.
    wisKeuze("e"); state.edit = null; render();
  } else if (f.id === "form-nazicht") {
    const datum = $("#r-datum").value, ts = toestellenVan(state.site);
    if (!datum) return;
    knop.disabled = true;
    const id = crypto.randomUUID();
    await wacht([
      { actie: "upsert", tabel: "vigo_nazichten", rijen: [{ id, site: state.site, datum }] },
      ...(ts.length ? [{ actie: "upsert", tabel: "vigo_nazicht_toestellen", rijen: ts.map((t, i) => ({ id: crypto.randomUUID(), nazicht_id: id, volgorde: i, ...kopie(t) })) }] : []),
    ], "Nazicht gestart");
    go("nazicht", { nazicht: id, filter: "alle", soort: "alle" });
  } else if (f.dataset.editForm) {
    const id = f.dataset.editForm, oud = items.find(p => p.id === id); if (!oud) return;
    const r = nazichten.find(x => x.id === oud.nazichtId) || {};
    const gekozen = f.querySelector("input[name=e-resultaat]:checked");
    const d = { resultaat: gekozen ? gekozen.value : "", opmerkingen: $("#e-opmerkingen").value.trim() };
    const nieuw = fotoNieuw.e.map((f, i) => ({ actie: "foto", pad: `${r.site}/${r.id}/${id}-${Date.now()}-${i}.jpg`, blob: f.blob }));
    const weg = oud.fotos.filter(p => fotoWeg.e.has(p));
    d.fotos = oud.fotos.filter(p => !fotoWeg.e.has(p)).concat(nieuw.map(f => f.pad));
    wisKeuze("e"); state.edit = null;
    await wacht([...nieuw, { actie: "update", tabel: "vigo_nazicht_toestellen", id, data: d }, ...(weg.length ? [{ actie: "wis", paden: weg }] : [])], "Opgeslagen");
  } else if (f.id === "form-extra") {
    const r = nazichten.find(x => x.id === state.nazicht); if (!r) return;
    const d = leesToestelForm("x");
    if (leegToestel(d)) { $("#x-nummer").focus(); toast("Vul een nummer, merk, serienummer of omschrijving in"); return; }
    // Nummer van een toestel met status ongekend: dat toestel is teruggevonden, geen nieuw toestel maken.
    const zonderNullen = n => n.replace(/^0+(?=.)/, "").toLowerCase();
    const terug = d.nummer && ongekendVan(r.site).find(x => x.soort === d.soort && zonderNullen(x.nummer) === zonderNullen(d.nummer));
    if (terug) {
      f.reset(); $("#x-soort").value = d.soort; $("#x-afdeling").value = d.afdeling;
      const volgorde = Math.max(-1, ...itemsVan(r.id).map(p => p.volgorde)) + 1;
      await wacht([{ actie: "update", tabel: "vigo_toestellen", id: terug.id, data: { ongekend: false } },
        { actie: "upsert", tabel: "vigo_nazicht_toestellen", rijen: [{ id: crypto.randomUUID(), nazicht_id: r.id, volgorde, ...kopie(terug) }] }],
        "Dit toestel had status ongekend: teruggevonden en toegevoegd aan het nazicht");
      return;
    }
    const t = { id: crypto.randomUUID(), site: r.site, ...d }, fotos = nieuweToestelFotos("x", t);
    const volgorde = Math.max(-1, ...itemsVan(r.id).map(p => p.volgorde)) + 1;
    // Leegmaken voor het volgende toestel; soort en afdeling blijven staan (vaak dezelfde bij een ronde).
    f.reset(); $("#x-soort").value = d.soort; $("#x-afdeling").value = d.afdeling;
    await wacht([...fotos,
      { actie: "upsert", tabel: "vigo_toestellen", rijen: [t] },
      { actie: "upsert", tabel: "vigo_nazicht_toestellen", rijen: [{ id: crypto.randomUUID(), nazicht_id: r.id, volgorde, ...kopie(t) }] },
    ], "Toestel toegevoegd aan nazicht en inventaris");
  } else if (f.id === "form-nazicht-edit") {
    const datum = $("#re-datum").value;
    state.editNazicht = false;
    await wacht([{ actie: "update", tabel: "vigo_nazichten", id: state.nazicht, data: { datum } }], "Opgeslagen");
  }
});

document.addEventListener("input", e => {
  if (e.target.id === "plak-tekst") toonPlakVoorbeeld();
  // Herstelvak: al tijdens het typen bewaren, zodat niets verloren gaat als je de app sluit zonder verder te tikken.
  if (e.target.dataset.herstel) { const vak = e.target; clearTimeout(vak.wacht); vak.wacht = setTimeout(() => bewaarHerstel(vak, false), 800); }
});
function bewaarHerstel(vak, melden) {
  clearTimeout(vak.wacht);
  const p = items.find(x => x.id === vak.dataset.herstel), tekst = vak.value.trim();
  if (!p || tekst === p.opmerkingen) return;
  return wacht([{ actie: "update", tabel: "vigo_nazicht_toestellen", id: p.id, data: { opmerkingen: tekst } }], melden ? "Opgeslagen" : "", { stil: document.activeElement === vak });
}
// App naar de achtergrond of gesloten terwijl je nog typt: meteen bewaren.
const bewaarOpenVak = () => { const a = document.activeElement; if (a && a.dataset && a.dataset.herstel) bewaarHerstel(a, false); };
document.addEventListener("visibilitychange", () => { if (document.hidden) bewaarOpenVak(); });
addEventListener("pagehide", bewaarOpenVak);

document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "plak-soort" || t.id === "plak-vervang") { toonPlakVoorbeeld(); return; }
  if ("toonUit" in t.dataset) { state.uitDienst = t.checked; render(); return; }
  if (t.dataset.herstel) { await bewaarHerstel(t, true); return; }
  if (!t.dataset.fotoInput) return;
  const pre = t.dataset.fotoInput, files = [...(t.files || [])];
  if (!files.length) return;
  let ruimte = files.length;
  if ("toestel" in t.dataset) {
    const oud = pre === "e" ? toestellen.find(p => "toestel:" + p.id === state.edit) : null;
    ruimte = MAX_TOESTEL_FOTOS - toestelFotos(oud).filter(f => !fotoWeg[pre].has(f)).length - fotoNieuw[pre].length;
    if (ruimte < files.length) toast(`Maximaal ${MAX_TOESTEL_FOTOS} foto's per toestel. Verwijder eerst een foto met ×.`);
  }
  for (const file of files.slice(0, Math.max(0, ruimte))) { const blob = await verklein(file); fotoNieuw[pre].push({ blob, url: URL.createObjectURL(blob) }); }
  t.value = "";
  render();
});

document.addEventListener("click", async e => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (b.id === "logout") {
    if (wachtrij.length) { toast("Er wachten nog wijzigingen. Meld je pas af als alles verstuurd is."); return; }
    try { localStorage.removeItem(CACHE_SLEUTEL); } catch {}
    await sb.auth.signOut(); return;
  }
  if ("lijst" in d) { b.disabled = true; const t = b.textContent; b.textContent = "Bezig…"; try { await exporteerInventaris(state.site); } finally { b.disabled = false; b.textContent = t; } return; }
  if ("export" in d) { b.disabled = true; const t = b.textContent; b.textContent = "Bezig…"; try { await exporteerNazicht(state.nazicht); } finally { b.disabled = false; b.textContent = t; } return; }
  if (d.fotoWeg) {
    const pre = d.fotoWeg;
    if (d.pad) fotoWeg[pre].add(d.pad);
    else { const [f] = fotoNieuw[pre].splice(+d.i, 1); if (f) URL.revokeObjectURL(f.url); }
    render(); return;
  }
  if (d.groot) {
    const urls = (await Promise.all(d.groot.split("|").map(fotoUrl))).filter(Boolean); if (!urls.length) return;
    const ov = document.createElement("div"); ov.className = "groot" + (urls.length > 1 ? " twee" : "");
    urls.forEach(url => { const img = document.createElement("img"); img.alt = "Foto"; img.src = url; ov.appendChild(img); });
    ov.addEventListener("click", () => ov.remove()); document.body.appendChild(ov);
    return;
  }
  if (d.resultaat) {
    // Nog eens op het gekozen resultaat tikken maakt het weer leeg.
    const p = items.find(x => x.id === d.resultaat); if (!p) return;
    const nieuw = p.resultaat === d.waarde ? "" : d.waarde;
    await wacht([{ actie: "update", tabel: "vigo_nazicht_toestellen", id: p.id, data: { resultaat: nieuw } }]);
    // Bij "Herstel nodig" meteen het vak openen om te schrijven wat er moet gebeuren.
    if (nieuw === "herstel") { const vak = document.getElementById("h-" + p.id); if (vak) { vak.focus(); vak.setSelectionRange(vak.value.length, vak.value.length); } }
    return;
  }
  if (d.meegenomen) {
    // Meegenomen door VIGO: het toestel is weg, dus meteen uit dienst. Nog eens tikken maakt de keuze leeg.
    const p = items.find(x => x.id === d.meegenomen); if (!p) return;
    const waarde = d.waarde === "ja", nieuw = p.meegenomen === waarde ? null : waarde;
    const t = toestellen.find(x => x.id === p.toestelId);
    await wacht([{ actie: "update", tabel: "vigo_nazicht_toestellen", id: p.id, data: { meegenomen: nieuw } },
      ...(nieuw === true && t && !t.uitDienst ? [{ actie: "update", tabel: "vigo_toestellen", id: t.id, data: { uit_dienst: true } }] : [])],
      nieuw === true ? "Meegenomen: het toestel staat nu uit dienst" : "");
    return;
  }
  if (d.gevonden) {
    // Teruggevonden: terug in de inventaris, en in een open nazicht meteen ook in dat nazicht.
    const t = toestellen.find(x => x.id === d.gevonden); if (!t) return;
    const r = d.nazichtId && nazichten.find(x => x.id === d.nazichtId);
    const volgorde = r ? Math.max(-1, ...itemsVan(r.id).map(p => p.volgorde)) + 1 : 0;
    await wacht([{ actie: "update", tabel: "vigo_toestellen", id: t.id, data: { ongekend: false } },
      ...(r ? [{ actie: "upsert", tabel: "vigo_nazicht_toestellen", rijen: [{ id: crypto.randomUUID(), nazicht_id: r.id, volgorde, ...kopie(t) }] }] : [])],
      r ? "Teruggevonden: het toestel staat nu in dit nazicht" : "Teruggevonden: terug in de inventaris");
    return;
  }
  if (d.uitDienst) {
    const uit = !!d.waarde;
    await wacht([{ actie: "update", tabel: "vigo_toestellen", id: d.uitDienst, data: { uit_dienst: uit } }], uit ? "Uit dienst: komt niet meer in een nieuw nazicht" : "Terug in dienst");
    return;
  }
  if ("goSites" in d) go("sites");
  else if (d.goSite) go("site", { site: d.goSite, soort: "alle" });
  else if (d.goNazicht) go("nazicht", { nazicht: d.goNazicht, filter: "alle", soort: "alle" });
  else if (d.filter) { state.filter = d.filter; render(); }
  else if (d.soort) { state.soort = d.soort; render(); }
  else if ("confirm" in d) { state.confirm = d.confirm || null; render(); }
  else if (d.edit) { wisKeuze("e"); state.edit = d.edit; state.confirm = null; render(); }
  else if ("cancelEdit" in d) { wisKeuze("e"); state.edit = null; render(); }
  else if ("editNazicht" in d) { state.editNazicht = true; state.confirm = null; render(); }
  else if ("cancelNazicht" in d) { state.editNazicht = false; render(); }
  else if ("plakken" in d) { state.plakken = true; state.nieuwToestel = false; render(); $("#plak-tekst").focus(); }
  else if ("plakkenStop" in d) { state.plakken = false; render(); }
  else if ("nieuwToestel" in d) { state.nieuwToestel = true; render(); $("#n-nummer").focus(); }
  else if ("nieuwStop" in d) { wisKeuze("n"); state.nieuwToestel = false; render(); }
  else if (d.delToestel) {
    // De foto blijft bewaard: oude nazichten kunnen er nog naar verwijzen.
    if (await write(() => sb.from("vigo_toestellen").delete().eq("id", d.delToestel), "Toestel verwijderd")) { state.confirm = null; render(); }
  }
  else if (d.delItem) {
    const fotos = (items.find(p => p.id === d.delItem) || {}).fotos;
    state.confirm = null;
    await wacht([{ actie: "delete", tabel: "vigo_nazicht_toestellen", id: d.delItem }, ...(fotos && fotos.length ? [{ actie: "wis", paden: fotos }] : [])], "Toestel uit nazicht verwijderd");
  }
  else if ("delNazicht" in d) {
    const r = nazichten.find(x => x.id === state.nazicht);
    // toestellen van het nazicht verdwijnen mee (on delete cascade)
    const fotos = itemsVan(r.id).flatMap(p => p.fotos);
    go("site", { site: r.site });
    await wacht([{ actie: "delete", tabel: "vigo_nazichten", id: r.id }, ...(fotos.length ? [{ actie: "wis", paden: fotos }] : [])], "Nazicht verwijderd");
  }
});

/* ---------- Opstart ---------- */
let kanaal = null;
function zetSessie(s) {
  const was = !!sessie;
  sessie = s;
  $("#who").hidden = !s;
  $("#who-mail").textContent = s ? s.user.email : "";
  if (s && !was) {
    laadBewaard(s).then(() => { laadAlles(); verstuur(); });
    kanaal = sb.channel("vigo-wijzigingen");
    TABELLEN.forEach(table => kanaal.on("postgres_changes", { event: "*", schema: "public", table }, () => laadAlles()));
    kanaal.subscribe();
  }
  if (!s) { toestellen = []; nazichten = []; items = []; ready = false; TABELLEN.forEach(t => raw[t] = []); if (kanaal) { sb.removeChannel(kanaal); kanaal = null; } }
  render();
}

function bewaardeSessie() {
  try {
    const ref = new URL(window.VIGO_CONFIG.supabaseUrl).hostname.split(".")[0];
    const s = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`) || "null");
    return s && s.user ? s : null;
  } catch { return null; }
}

/* ---------- App installeren ----------
   Chrome en Edge (Android, computer) geven een eigen installatievenster. Op iPhone/iPad (Safari) en in browsers zonder dat
   venster tonen we hoe het via het menu van de browser gaat. Is de app al geïnstalleerd, dan verdwijnt de knop. */
let installVraag = null;
const alsApp = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(navigator.userAgent);
function toonInstalleer() { $("#installeer").hidden = alsApp() || !(installVraag || isIos || isAndroid); }
function installUitleg(html) {
  const el = $("#install-uitleg");
  el.innerHTML = html ? `<span>${html}</span><button class="btn small" type="button" data-install-sluit>Sluiten</button>` : "";
  el.hidden = !html;
}
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installVraag = e; toonInstalleer(); });
addEventListener("appinstalled", () => { installVraag = null; installUitleg(""); toonInstalleer(); toast("App geïnstalleerd"); });
document.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if ("installSluit" in b.dataset) { installUitleg(""); return; }
  if (b.id !== "installeer") return;
  if (installVraag) {
    installVraag.prompt();
    await installVraag.userChoice.catch(() => null);
    installVraag = null; toonInstalleer();
  } else if (isIos) installUitleg("Tik in Safari op <strong>Deel</strong> (het vierkantje met de pijl omhoog) en kies <strong>Zet op beginscherm</strong>. Werk je in een andere browser, open deze pagina dan eerst in Safari.");
  else installUitleg("Open het menu van je browser (<strong>⋮</strong> rechtsboven) en kies <strong>App installeren</strong> of <strong>Toevoegen aan startscherm</strong>.");
});
toonInstalleer();

if ("serviceWorker" in navigator && !window.VIGO_DEMO) navigator.serviceWorker.register("sw.js").catch(e => console.error(e));
render();
(async () => {
  const cfg = window.VIGO_CONFIG || {};
  if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) { banner("De app kon niet starten: de koppeling met de database ontbreekt (config.js)."); return; }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { data, error } = await sb.auth.getSession().catch(e => ({ data: {}, error: e }));
  // Zonder verbinding kan de aanmelding niet vernieuwd worden; werk dan verder met de bewaarde aanmelding.
  zetSessie(data.session || (netwerkFout(error) ? bewaardeSessie() : null));
  sb.auth.onAuthStateChange((ev, s) => {
    if (!s && ev !== "SIGNED_OUT") return;
    if (!!s !== !!sessie) zetSessie(s); else sessie = s;
  });
  // Bij terugkeer naar de app (gsm) of als de verbinding terug is: gegevens verversen en de wachtrij versturen.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && sessie) { laadAlles(); verstuur(); } });
  addEventListener("online", () => { if (sessie) { laadAlles(); verstuur(); } });
  addEventListener("offline", zetSync);
  setInterval(() => { if (sessie && wachtrij.length) verstuur(); }, 30000);
})();

// Niet opnieuw tekenen terwijl iemand een formulier invult; dat zou getypte tekst wissen.
function renderSafe() {
  const a = document.activeElement;
  const typing = a && a.matches && a.matches("input[type=text], textarea, select, input[type=date]") && (a.value || a.dataset.herstel);
  if (typing) { clearTimeout(renderSafe.t); renderSafe.t = setTimeout(renderSafe, 1500); return; }
  render();
}
