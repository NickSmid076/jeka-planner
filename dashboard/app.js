"use strict";

/* ═══════════════════════════════════════════════════════════
   CONSTANTEN
═══════════════════════════════════════════════════════════ */
const DAYS      = ["MA","DI","WO","DO","VR"];
const DAY_LABEL = {MA:"Maandag",DI:"Dinsdag",WO:"Woensdag",DO:"Donderdag",VR:"Vrijdag"};
const FIELDS    = ["Veld 1","Veld 2","Veld 3"];

const START_MIN = 960;   // 16:00
const END_MIN   = 1350;  // 22:30
const TOTAL_MIN = END_MIN - START_MIN;  // 390 min
const SLOT_H    = 20;    // pixels per 15-min slot
const SLOTS     = 26;    // 16:00 → 22:30

const CAT_COLOR = {
  onderbouw: "#AED6F1", middenbouw: "#A9DFBF",
  bovenbouw: "#FAD7A0", senioren:   "#F1948A",
  bijzonder: "#D7BDE2",
};
const CAT_NL = {
  onderbouw:"Onderbouw",middenbouw:"Middenbouw",
  bovenbouw:"Bovenbouw",senioren:"Senioren",bijzonder:"Bijzonder"
};

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */
let roster       = null;   // roster_export.json
let availability = {};     // {MA:{Veld 1:{blocked,reden},...},...}
let lastSimResult = null;  // voor vergelijking
let roiChart = null;

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
const t2m = t => { const [h,m] = t.split(":").map(Number); return h*60+m; };
const m2t = m => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const fmt  = n => n.toLocaleString("nl-NL");
const pct  = n => (n*100).toFixed(1)+"%";
const eur  = n => "€ "+fmt(Math.round(n));

function sessionsFor(dag, veld) {
  return roster.sessies.filter(s => s.dag === dag && s.veld === veld);
}

/* Slot occupancy per (dag, veld) — array of 26 floats */
function occupancySlots(dag, veld) {
  const occ = new Float32Array(SLOTS);
  sessionsFor(dag, veld).forEach(s => {
    const a = Math.max(0, Math.round((t2m(s.start) - START_MIN) / 15));
    const b = Math.min(SLOTS, Math.round((t2m(s.eind)  - START_MIN) / 15));
    for (let i = a; i < b; i++) occ[i] += s.veldgebruik;
  });
  return occ;
}

/* Total veld-uren used on a given day */
function dayVeldUren(dag) {
  let used = 0;
  FIELDS.forEach(v => {
    sessionsFor(dag, v).forEach(s => {
      used += s.veldgebruik * (t2m(s.eind) - t2m(s.start)) / 60;
    });
  });
  return used;
}

/* Layout sessions into non-overlapping lanes */
function layoutSessions(sessions) {
  const sorted = [...sessions].sort((a,b) => t2m(a.start)-t2m(b.start) || a.team_id.localeCompare(b.team_id));
  const laneEnd = [];  // end-minute of last session in each lane
  sorted.forEach(s => {
    const sm = t2m(s.start);
    let lane = laneEnd.findIndex(e => e <= sm);
    if (lane === -1) { lane = laneEnd.length; laneEnd.push(0); }
    laneEnd[lane] = t2m(s.eind);
    s._lane = lane;
  });
  const nLanes = laneEnd.length || 1;
  sorted.forEach(s => s._nLanes = nLanes);
  return sorted;
}

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */
async function init() {
  await Promise.all([loadRoster(), loadAvailability()]);
  renderAll();

  document.querySelectorAll(".tab").forEach(btn =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  document.querySelectorAll(".stab").forEach(btn =>
    btn.addEventListener("click", () => switchStab(btn.dataset.stab)));

  document.getElementById("btn-refresh").addEventListener("click", refreshRoster);
  document.getElementById("btn-show-conflicts").addEventListener("click", () => {
    document.getElementById("conflicts-panel").classList.toggle("hidden");
  });
  document.getElementById("btn-save-avail").addEventListener("click", saveAvailability);
  document.getElementById("btn-reset-avail").addEventListener("click", resetAvailability);
  document.getElementById("btn-simulate").addEventListener("click", simulate);
  document.getElementById("btn-print").addEventListener("click", () => window.print());

  // Field type toggle
  document.getElementById("ftype-gras").addEventListener("click",  () => setVeldtype("gras"));
  document.getElementById("ftype-kunst").addEventListener("click", () => setVeldtype("kunst"));

  // Live recalc on every ROI input change
  ["roi-aanleg","roi-onderhoud","roi-escalatie","roi-reservering","roi-bezetting",
   "roi-contributie","roi-spelers","roi-groei","roi-behoud","roi-jaren"].forEach(id => {
    document.getElementById(id).addEventListener("input", calcROI);
  });
  document.getElementById("roi-gemeente-pct").addEventListener("input", calcROI);

  // Initial ROI render
  calcROI();

  setupTooltip();
}

async function loadRoster() {
  try {
    const r = await fetch("/api/roster");
    if (!r.ok) throw new Error("niet gevonden");
    roster = await r.json();
  } catch {
    document.getElementById("timeline-grid").innerHTML =
      '<div style="padding:30px;color:#c0392b;font-weight:600">⚠ roster_export.json niet gevonden.<br>Voer eerst planner.py uit.</div>';
  }
}

async function loadAvailability() {
  try {
    const r = await fetch("/api/availability");
    availability = await r.json();
  } catch { availability = {}; }
}

function renderAll() {
  if (!roster) return;
  const ts = new Date(roster.generated_at);
  document.getElementById("generated-at").textContent =
    "Gegenereerd: " + ts.toLocaleString("nl-NL");
  renderKPIs();
  renderTimeline();
  renderConflicts();
  renderVeldbeheer();
  renderCapaciteit();
  populateSimCat();
}

/* ═══════════════════════════════════════════════════════════
   TAB SWITCHING
═══════════════════════════════════════════════════════════ */
function switchTab(tab) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab===tab));
  document.querySelectorAll(".tab-content").forEach(c => {
    c.classList.toggle("hidden", c.id !== "tab-"+tab);
    c.classList.toggle("active", c.id === "tab-"+tab);
  });
}

function switchStab(stab) {
  document.querySelectorAll(".stab").forEach(b => b.classList.toggle("active", b.dataset.stab===stab));
  document.querySelectorAll(".stab-content").forEach(c => {
    c.classList.toggle("hidden", c.id !== "stab-"+stab);
    c.classList.toggle("active", c.id === "stab-"+stab);
  });
  if (stab === "gevoeligheidsanalyse") calcTornado();
  if (stab === "risicoanalyse")        calcMonteCarlo();
}

/* ═══════════════════════════════════════════════════════════
   §1 — KPI's
═══════════════════════════════════════════════════════════ */
function renderKPIs() {
  // Bezettingsgraad: gemiddelde veldgebruik over alle dag×veld×slot
  let totSlots = 0, usedSlots = 0;
  DAYS.forEach(dag => {
    FIELDS.forEach(v => {
      const occ = occupancySlots(dag, v);
      totSlots += SLOTS;
      occ.forEach(o => usedSlots += Math.min(o, 1));
    });
  });
  const bezetting = totSlots ? usedSlots/totSlots : 0;
  document.getElementById("kpi-bezetting").querySelector(".kpi-value").textContent = pct(bezetting);

  // Sessies
  document.getElementById("kpi-ingepland").querySelector(".kpi-value").textContent =
    roster.stats.totaal_ingepland;

  // Niet ingepland
  document.getElementById("kpi-niet-ingepland").querySelector(".kpi-value").textContent =
    roster.stats.totaal_niet_ingepland;

  // Piekdag
  let piekDag = "—", piekVal = 0;
  DAYS.forEach(dag => {
    let sum = 0, cnt = 0;
    FIELDS.forEach(v => { occupancySlots(dag, v).forEach(o => { sum += Math.min(o,1); cnt++; }); });
    const avg = cnt ? sum/cnt : 0;
    if (avg > piekVal) { piekVal = avg; piekDag = DAY_LABEL[dag]; }
  });
  document.getElementById("kpi-piekdag").querySelector(".kpi-value").textContent = piekDag;

  // Restcapaciteit (veld-uren per dag)
  const MAX_VU = FIELDS.length * TOTAL_MIN / 60;  // 3 × 6.5 = 19.5 veld-uur/dag
  const totRestDay = DAYS.map(dag => MAX_VU - dayVeldUren(dag));
  const gemRest = totRestDay.reduce((a,b)=>a+b,0) / DAYS.length;
  document.getElementById("kpi-capaciteit").querySelector(".kpi-value").textContent =
    gemRest.toFixed(1) + " vh/dag";
}

/* ═══════════════════════════════════════════════════════════
   §2 — TIMELINE
═══════════════════════════════════════════════════════════ */
function renderTimeline() {
  const grid = document.getElementById("timeline-grid");
  grid.innerHTML = "";

  // Time column
  const timeCol = el("div", "tl-time-col");
  timeCol.appendChild(el("div", "tl-time-header"));
  for (let i = 0; i < SLOTS; i++) {
    const min = START_MIN + i * 15;
    const isHour = min % 60 === 0;
    const lbl = el("div", "tl-time-label" + (isHour ? " hour" : ""));
    if (isHour) lbl.textContent = m2t(min);
    timeCol.appendChild(lbl);
  }
  grid.appendChild(timeCol);

  // Day groups
  const daysWrap = el("div", "tl-days");
  DAYS.forEach(dag => {
    const grp = el("div", "tl-day-group");

    // Day name header
    const dayHead = el("div", "tl-day-header");
    const dayName = el("div", "tl-day-name");
    dayName.textContent = DAY_LABEL[dag];
    dayHead.appendChild(dayName);
    grp.appendChild(dayHead);

    // Veld headers
    const veldHeads = el("div", "tl-veld-headers");
    FIELDS.forEach(v => {
      const h = el("div", "tl-veld-head");
      h.textContent = v.replace("Veld ","V");
      veldHeads.appendChild(h);
    });
    grp.appendChild(veldHeads);

    // Field columns
    const fieldsRow = el("div", "tl-fields");
    const totalH = SLOTS * SLOT_H;

    FIELDS.forEach(veld => {
      const col = el("div", "tl-field-col");
      col.style.height = totalH + "px";
      col.dataset.dag = dag;
      col.dataset.veld = veld;

      // Check availability
      const blocked = availability[dag]?.[veld]?.blocked;
      if (blocked) {
        const ov = el("div","blocked-overlay");
        ov.textContent = availability[dag][veld].reden || "Geblokkeerd";
        col.appendChild(ov);
        fieldsRow.appendChild(col);
        return;
      }

      // Grid rows
      for (let i = 0; i < SLOTS; i++) {
        const row = el("div","grid-row"+(i%4===0?" hour":""));
        row.style.top = (i*SLOT_H)+"px";
        col.appendChild(row);
      }

      // Occupancy overlay
      const occ = occupancySlots(dag, veld);
      occ.forEach((o, i) => {
        if (o <= 0) return;
        const ov = el("div","occ-row");
        ov.style.top = (i*SLOT_H)+"px";
        const conflict = o > 1.0001;
        if (conflict) {
          ov.style.background = "rgba(231,76,60,.25)";
          ov.style.border = "1px solid rgba(192,57,43,.5)";
        } else {
          const intensity = Math.min(o, 1) * 0.22;
          ov.style.background = `rgba(39,174,96,${intensity})`;
        }
        col.appendChild(ov);
      });

      // Sessions
      const laid = layoutSessions(sessionsFor(dag, veld));
      laid.forEach(ses => {
        const sm = t2m(ses.start);
        const em = t2m(ses.eind);
        const top    = (sm - START_MIN) / 15 * SLOT_H;
        const height = Math.max((em - sm) / 15 * SLOT_H - 1, 4);
        const colW   = 88;
        const laneW  = colW / ses._nLanes;
        const left   = ses._lane * laneW;

        const blk = el("div","session-block");
        blk.style.top    = top+"px";
        blk.style.height = height+"px";
        blk.style.left   = left+"px";
        blk.style.width  = laneW+"px";
        blk.style.background = CAT_COLOR[ses.prioriteit] || "#EEE";

        const lbl = el("div","sess-label");
        lbl.textContent = ses.team_id;
        blk.appendChild(lbl);

        // Tooltip data
        blk.dataset.tip = JSON.stringify({
          team_id: ses.team_id,
          dag: DAY_LABEL[ses.dag],
          start: ses.start, eind: ses.eind,
          veld: ses.subveld || ses.veld,
          gebruik: ses.veldgebruik,
          prio: CAT_NL[ses.prioriteit] || ses.prioriteit,
        });

        col.appendChild(blk);
      });

      fieldsRow.appendChild(col);
    });

    grp.appendChild(fieldsRow);
    daysWrap.appendChild(grp);
  });

  grid.appendChild(daysWrap);
}

/* ═══════════════════════════════════════════════════════════
   §3 — CONFLICTEN
═══════════════════════════════════════════════════════════ */
function renderConflicts() {
  const conflicts = [];
  DAYS.forEach(dag => {
    FIELDS.forEach(veld => {
      const occ = occupancySlots(dag, veld);
      occ.forEach((o, i) => {
        if (o > 1.0001) {
          const t = m2t(START_MIN + i*15);
          const teams = roster.sessies
            .filter(s => s.dag===dag && s.veld===veld &&
                    t2m(s.start) <= START_MIN+i*15 && t2m(s.eind) > START_MIN+i*15)
            .map(s => s.team_id).join(", ");
          conflicts.push(`${DAY_LABEL[dag]} ${t} — ${veld}: ${teams} (${(o*100).toFixed(0)}%)`);
        }
      });
    });
  });

  const banner = document.getElementById("conflicts-banner");
  if (conflicts.length) {
    banner.classList.remove("hidden");
    document.getElementById("conflicts-count").textContent = conflicts.length;
    const list = document.getElementById("conflicts-list");
    list.innerHTML = conflicts.map(c => `<li>⚠ ${c}</li>`).join("");
  } else {
    banner.classList.add("hidden");
  }
}

/* ═══════════════════════════════════════════════════════════
   §4 — TOOLTIP
═══════════════════════════════════════════════════════════ */
function setupTooltip() {
  const tip = document.getElementById("tooltip");
  document.addEventListener("mouseover", e => {
    const blk = e.target.closest(".session-block");
    if (!blk || !blk.dataset.tip) { tip.classList.add("hidden"); return; }
    const d = JSON.parse(blk.dataset.tip);
    tip.innerHTML = `<strong>${d.team_id}</strong>
      ${d.dag} ${d.start}–${d.eind}<br>
      ${d.veld}<br>
      Categorie: ${d.prio}<br>
      Veldgebruik: ${(d.gebruik*100).toFixed(0)}%`;
    tip.classList.remove("hidden");
  });
  document.addEventListener("mousemove", e => {
    tip.style.left = (e.clientX+14)+"px";
    tip.style.top  = (e.clientY-10)+"px";
  });
  document.addEventListener("mouseout", e => {
    if (!e.target.closest(".session-block")) tip.classList.add("hidden");
  });
}

/* ═══════════════════════════════════════════════════════════
   §5 — VELDBEHEER
═══════════════════════════════════════════════════════════ */
function renderVeldbeheer() {
  const grid = document.getElementById("avail-grid");
  grid.innerHTML = "";
  DAYS.forEach(dag => {
    const col = el("div","avail-day-col");
    const head = el("div","avail-day-head"); head.textContent = DAY_LABEL[dag];
    col.appendChild(head);
    FIELDS.forEach(veld => {
      const row = el("div","avail-field-row");
      const nm = el("div","avail-field-name"); nm.textContent = veld;
      const blocked = availability[dag]?.[veld]?.blocked || false;
      const reden   = availability[dag]?.[veld]?.reden   || "";

      const tog = el("div","avail-toggle");
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = blocked; cb.id = `avail-${dag}-${veld.replace(" ","")}`;
      const lbl = document.createElement("label");
      lbl.htmlFor = cb.id; lbl.textContent = blocked ? "Onbeschikbaar" : "Beschikbaar";
      cb.addEventListener("change", () => {
        lbl.textContent = cb.checked ? "Onbeschikbaar" : "Beschikbaar";
        reasonInput.disabled = !cb.checked;
        updateImpact();
      });
      tog.appendChild(cb); tog.appendChild(lbl);

      const reasonInput = document.createElement("input");
      reasonInput.className = "avail-reason";
      reasonInput.placeholder = "Reden (onderhoud, toernooi…)";
      reasonInput.value = reden;
      reasonInput.disabled = !blocked;
      reasonInput.dataset.dag = dag;
      reasonInput.dataset.veld = veld;

      row.appendChild(nm); row.appendChild(tog); row.appendChild(reasonInput);
      col.appendChild(row);
    });
    grid.appendChild(col);
  });
  updateImpact();
}

function getAvailState() {
  const state = {};
  DAYS.forEach(dag => {
    state[dag] = {};
    FIELDS.forEach(veld => {
      const id = `avail-${dag}-${veld.replace(" ","")}`;
      const cb = document.getElementById(id);
      const reden = document.querySelector(`input[data-dag="${dag}"][data-veld="${veld}"]`);
      state[dag][veld] = { blocked: cb?.checked || false, reden: reden?.value || "" };
    });
  });
  return state;
}

function updateImpact() {
  const state = getAvailState();
  let affected = 0;
  roster.sessies.forEach(s => {
    if (state[s.dag]?.[s.veld]?.blocked) affected++;
  });
  const bar  = document.getElementById("avail-impact");
  const text = document.getElementById("avail-impact-text");
  if (affected > 0) {
    bar.classList.remove("hidden");
    text.textContent = `${affected} sessies worden geraakt door de huidige blokkades.`;
  } else {
    bar.classList.add("hidden");
  }
}

async function saveAvailability() {
  availability = getAvailState();
  try {
    await fetch("/api/availability", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(availability),
    });
    renderTimeline();
    renderKPIs();
    alert("Veldbeschikbaarheid opgeslagen.");
  } catch { alert("Fout bij opslaan."); }
}

function resetAvailability() {
  availability = {};
  renderVeldbeheer();
}

/* ═══════════════════════════════════════════════════════════
   §6 — CAPACITEIT
═══════════════════════════════════════════════════════════ */
function renderCapaciteit() {
  renderCapCards();
  renderCapCharts();
  renderNietIngepland();
}

function renderCapCards() {
  const MAX_VU_WEEK = FIELDS.length * TOTAL_MIN / 60 * DAYS.length;
  let usedVU = 0;
  roster.sessies.forEach(s => { usedVU += s.veldgebruik * (t2m(s.eind)-t2m(s.start))/60; });
  const freeVU = MAX_VU_WEEK - usedVU;
  const bezetting = usedVU / MAX_VU_WEEK;

  const wrap = document.getElementById("cap-cards");
  wrap.innerHTML = [
    ["Totale capaciteit", fmt(MAX_VU_WEEK.toFixed(0)) + " veld-uur/week"],
    ["Gebruikt",   usedVU.toFixed(1) + " vh (" + pct(bezetting) + ")"],
    ["Beschikbaar", freeVU.toFixed(1) + " veld-uur"],
    ["Ingepland",  roster.stats.totaal_ingepland + " sessies"],
    ["Niet ingepland", roster.stats.totaal_niet_ingepland + " teams"],
  ].map(([lbl,val]) => `<div class="cap-card"><div class="cap-val">${val}</div><div class="cap-sub">${lbl}</div></div>`).join("");
}

function renderCapCharts() {
  // 1. Per categorie
  const catCounts = {};
  roster.sessies.forEach(s => {
    const p = s.prioriteit;
    catCounts[p] = (catCounts[p]||0) + 1;
  });
  const cats = Object.keys(catCounts);
  renderBarChart("chart-categorie", cats.map(c => CAT_NL[c]||c), cats.map(c => catCounts[c]),
    cats.map(c => CAT_COLOR[c]||"#ccc"));

  // 2. Per dag
  const dagVU = DAYS.map(dag => +dayVeldUren(dag).toFixed(1));
  renderBarChart("chart-dag", DAYS.map(d => DAY_LABEL[d].slice(0,2)), dagVU,
    dagVU.map(v => `rgba(46,117,182,${0.4 + 0.5*v/Math.max(...dagVU)})`));

  // 3. Per tijdblok (uurvak)
  const blocks = [16,17,18,19,20,21,22];
  const blockOcc = blocks.map(h => {
    let sum = 0, cnt = 0;
    const sm = h*60, em = Math.min((h+1)*60, END_MIN);
    for (let m = sm; m < em; m += 15) {
      const si = Math.round((m - START_MIN)/15);
      if (si < 0 || si >= SLOTS) continue;
      DAYS.forEach(dag => FIELDS.forEach(v => {
        const occ = occupancySlots(dag, v);
        sum += Math.min(occ[si]||0, 1); cnt++;
      }));
    }
    return cnt ? +(sum/cnt*100).toFixed(1) : 0;
  });
  renderBarChart("chart-tijd", blocks.map(h => h+":00"), blockOcc,
    blockOcc.map(v => `rgba(39,174,96,${0.3 + 0.6*v/100})`));
}

let chartInstances = {};
let tornadoChart = null;
let mcChart = null;

function renderBarChart(id, labels, data, colors) {
  if (chartInstances[id]) chartInstances[id].destroy();
  const ctx = document.getElementById(id).getContext("2d");
  chartInstances[id] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4 }] },
    options: {
      responsive: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { beginAtZero: true, ticks: { font: { size: 10 } } },
      },
    },
  });
}

function renderNietIngepland() {
  const tbody = document.querySelector("#tbl-niet-ingepland tbody");
  if (!roster.niet_ingepland.length) {
    tbody.innerHTML = "<tr><td colspan='2' style='text-align:center;color:#27ae60'>✓ Alle teams ingepland</td></tr>";
    return;
  }
  tbody.innerHTML = roster.niet_ingepland
    .map(t => `<tr><td><strong>${t.team_id}</strong></td><td>${t.reden}</td></tr>`)
    .join("");
}

/* ═══════════════════════════════════════════════════════════
   §7 — SCENARIO: nieuwe teams
═══════════════════════════════════════════════════════════ */
function populateSimCat() {
  const sel = document.getElementById("sim-cat");
  sel.innerHTML = "";
  const cats = Object.keys(roster.categorie_regels || {});
  cats.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c + " (" + (CAT_NL[roster.categorie_regels[c].prioriteit]||"") + ")";
    sel.appendChild(opt);
  });
}

function simulate() {
  const cat    = document.getElementById("sim-cat").value;
  const count  = parseInt(document.getElementById("sim-count").value) || 1;
  const days   = [...document.querySelectorAll("#sim-days input:checked")].map(i => i.value);
  if (!days.length) { alert("Selecteer minimaal één dag."); return; }

  const regels = roster.categorie_regels?.[cat];
  if (!regels) { alert("Categorie niet gevonden."); return; }

  const { duur_min, veldgebruik } = regels;
  const nSlots = duur_min / 15;

  // Per dag: check how many hypothetical sessions can fit
  const results = [];
  let totalFit = 0, totalNeeded = count;

  days.forEach(dag => {
    const slotsAvail = [];
    FIELDS.forEach(veld => {
      const occ = occupancySlots(dag, veld);
      for (let s = 0; s + nSlots <= SLOTS; s++) {
        let fits = true;
        for (let k = s; k < s+nSlots; k++) {
          if ((occ[k]||0) + veldgebruik > 1.0001) { fits = false; break; }
        }
        if (fits) slotsAvail.push({ veld, slot: s });
      }
    });
    const canFit = slotsAvail.length;
    results.push({ dag: DAY_LABEL[dag], canFit, needed: count });
    totalFit += Math.min(canFit, count);
  });

  lastSimResult = { cat, count, days, duur_min, veldgebruik, results, totalFit };

  const sumDiv = document.getElementById("sim-summary");
  const cls = totalFit >= totalNeeded ? "sim-ok" : totalFit > 0 ? "sim-warn" : "sim-err";
  sumDiv.innerHTML = `<span class="${cls}">
    ${totalFit >= totalNeeded ? "✓" : totalFit > 0 ? "⚠" : "✗"}
    ${count} ${cat}-team(s) op ${days.join("+")} —
    ${totalFit >= totalNeeded
      ? "Voldoende capaciteit beschikbaar."
      : `Slechts ruimte voor ~${totalFit} extra ${cat}-sessie(s). Onvoldoende.`}
  </span>`;

  const tbody = results.map(r =>
    `<tr><td>${r.dag}</td><td>${r.canFit} beschikbare slots</td>
    <td>${r.canFit >= r.needed ? "✓ Past" : "✗ Onvoldoende"}</td></tr>`
  ).join("");
  document.getElementById("sim-detail").innerHTML =
    `<table><thead><tr><th>Dag</th><th>Vrije slots</th><th>Status</th></tr></thead><tbody>${tbody}</tbody></table>`;

  document.getElementById("sim-result").classList.remove("hidden");
  updateVergelijking();
}

/* ═══════════════════════════════════════════════════════════
   §8 — SCENARIO: nieuw veld / ROI (uitgebreid)
═══════════════════════════════════════════════════════════ */

const VELDTYPE = {
  gras:  { aanleg: 120000, bezetting: 70, escalatie: 3,  reservering: 0 },
  kunst: { aanleg: 220000, bezetting: 95, escalatie: 8,  reservering: Math.round(220000/15) },
};

function setVeldtype(type) {
  const d = VELDTYPE[type];
  document.getElementById("roi-aanleg").value      = d.aanleg;
  document.getElementById("roi-bezetting").value   = d.bezetting;
  document.getElementById("roi-escalatie").value   = d.escalatie;
  document.getElementById("roi-reservering").value = d.reservering;
  document.querySelectorAll(".ftype-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("ftype-"+type).classList.add("active");
  calcROI();
}

function getROIParams() {
  return {
    aanleg:      +document.getElementById("roi-aanleg").value      || 0,
    onderhoud:   +document.getElementById("roi-onderhoud").value   || 0,
    escalatie:  (+document.getElementById("roi-escalatie").value   || 0) / 100,
    reservering: +document.getElementById("roi-reservering").value || 0,
    bezPct:     (+document.getElementById("roi-bezetting").value   || 70) / 100,
    contrib:     +document.getElementById("roi-contributie").value || 175,
    spelers:     +document.getElementById("roi-spelers").value     || 14,
    groei:      (+document.getElementById("roi-groei").value       || 5)  / 100,
    behoud:     (+document.getElementById("roi-behoud").value      || 88) / 100,
    jaren:       Math.min(15, Math.max(3, +document.getElementById("roi-jaren").value || 10)),
    gemeentePct:(+document.getElementById("roi-gemeente-pct").value || 40) / 100,
  };
}

function calcROIRows(p) {
  const { aanleg, onderhoud, escalatie, reservering, bezPct,
          contrib, spelers, groei, behoud, jaren, gemeentePct } = p;

  const veldUurWeek    = (TOTAL_MIN / 60) * 5 * bezPct;
  const avgUsePerTeam  = 0.5 * 1.25;
  const extraTeamsBase = Math.max(1, Math.floor(veldUurWeek / avgUsePerTeam));
  const clubAandeel    = aanleg * (1 - gemeentePct);

  const rows = [];
  let cumRev = 0, cumCost = 0, breakevenJaar = null;
  let activeTeams = 0;

  for (let j = 1; j <= jaren; j++) {
    const newTeams   = Math.round(extraTeamsBase * Math.pow(1 + groei, j - 1));
    activeTeams      = Math.round(activeTeams * behoud) + newTeams;
    const rev        = activeTeams * spelers * contrib;
    const onderhoudJ = j <= 5 ? onderhoud : onderhoud * Math.pow(1 + escalatie, j - 5);
    const capex      = j === 1 ? clubAandeel : 0;
    const cost       = capex + onderhoudJ + reservering;
    const netto      = rev - onderhoudJ - reservering;
    cumRev  += rev;
    cumCost += cost;
    const cumNet = cumRev - cumCost;
    if (cumNet >= 0 && !breakevenJaar) breakevenJaar = j;
    rows.push({ j, newTeams, activeTeams, rev, onderhoudJ, reservering, netto, cumNet });
  }
  return { rows, breakevenJaar, extraTeamsBase };
}

function updateFinancingDisplay(p) {
  if (!p) p = getROIParams();
  document.getElementById("gemeente-pct-label").textContent = Math.round(p.gemeentePct * 100) + "%";
  const gEur = p.aanleg * p.gemeentePct;
  const cEur = p.aanleg * (1 - p.gemeentePct);
  document.getElementById("fin-gemeente").textContent = eur(gEur);
  document.getElementById("fin-club").textContent     = eur(cEur);
  const revPerTeam = p.spelers * p.contrib;
  const min = revPerTeam > 0 ? Math.ceil(cEur / revPerTeam) : "—";
  document.getElementById("min-teams-num").textContent = min;
}

function calcROI() {
  const p = getROIParams();
  updateFinancingDisplay(p);
  const { rows, breakevenJaar } = calcROIRows(p);

  const sign = n => (n >= 0 ? "+" : "") + eur(n);

  const html = `<table>
    <thead><tr>
      <th>Jaar</th><th>Nieuwe teams</th><th>Actieve spelers</th>
      <th>Contributie-inkomsten</th><th>Onderhoud</th><th>Reservering</th>
      <th>Netto jaar</th><th>Netto cumulatief</th>
    </tr></thead>
    <tbody>${rows.map(r => {
      const isBE = r.j === breakevenJaar;
      const cls  = isBE ? "breakeven" : r.cumNet >= 0 ? "in-profit" : "";
      return `<tr class="${cls}">
        <td>${isBE ? "✓ " : ""}Jaar ${r.j}</td>
        <td>+${r.newTeams}</td>
        <td>${r.activeTeams * p.spelers}</td>
        <td>${eur(r.rev)}</td>
        <td>${eur(r.onderhoudJ)}</td>
        <td>${eur(r.reservering)}</td>
        <td style="color:${r.netto>=0?"var(--teal)":"var(--coral)"}">${sign(r.netto)}</td>
        <td style="color:${r.cumNet>=0?"var(--teal)":"var(--coral)"}">${sign(r.cumNet)}</td>
      </tr>`;
    }).join("")}</tbody></table>
    <p class="breakeven-msg${breakevenJaar ? "" : " no-be"}">
      ${breakevenJaar
        ? `✓ Break-even bereikt in <strong>jaar ${breakevenJaar}</strong>`
        : `✗ Geen break-even binnen ${p.jaren} jaar bij huidige parameters`}
    </p>`;

  document.getElementById("roi-table-wrap").innerHTML = html;

  if (roiChart) roiChart.destroy();
  const ctx = document.getElementById("chart-roi").getContext("2d");
  const cumRev  = rows.map((_, i) => rows.slice(0,i+1).reduce((a,x) => a+x.rev, 0));
  const cumCost = rows.map((_, i) => rows.slice(0,i+1).reduce((a,x) => a+x.onderhoudJ+x.reservering, 0));
  roiChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: rows.map(r => "Jaar "+r.j),
      datasets: [
        { label: "Cumulatieve inkomsten", data: cumRev,
          borderColor: "#0D8C5C", backgroundColor: "rgba(13,140,92,.1)", fill: true, tension: .3 },
        { label: "Cumulatieve kosten (excl. capex)", data: cumCost,
          borderColor: "#E55A4E", backgroundColor: "rgba(229,90,78,.08)", fill: true, tension: .3 },
      ],
    },
    options: {
      responsive: false,
      plugins: { legend: { position: "bottom", labels: { font: { size: 11 } } } },
      scales: { y: { ticks: { callback: v => "€"+Math.round(v/1000)+"k" } } },
    },
  });
}

/* ═══════════════════════════════════════════════════════════
   §9 — GEVOELIGHEIDSANALYSE (tornado)
═══════════════════════════════════════════════════════════ */
function calcTornado() {
  const p = getROIParams();
  const baseBE = calcROIRows(p).breakevenJaar || (p.jaren + 2);

  const vars = [
    { key: "gemeentePct", label: "Gemeentelijke bijdrage %", positive: true  },
    { key: "escalatie",   label: "Onderhoud escalatie",      positive: false },
    { key: "behoud",      label: "Ledenbehoud %",            positive: true  },
    { key: "aanleg",      label: "Aanlegkosten",             positive: false },
    { key: "bezPct",      label: "Bezettingsgraad %",        positive: true  },
  ];

  const results = vars.map(v => {
    const cap = v.key === "behoud" ? 0.99 : Infinity;
    const pH  = { ...p, [v.key]: Math.min(p[v.key] * 1.2, cap) };
    const pL  = { ...p, [v.key]: p[v.key] * 0.8 };
    const beH = calcROIRows(pH).breakevenJaar || (p.jaren + 2);
    const beL = calcROIRows(pL).breakevenJaar || (p.jaren + 2);
    const pessBE = v.positive ? beL  : beH;
    const optBE  = v.positive ? beH  : beL;
    return { label: v.label, pessBE, optBE, impact: Math.abs(pessBE - optBE) };
  }).sort((a, b) => b.impact - a.impact);

  if (tornadoChart) tornadoChart.destroy();
  const ctx = document.getElementById("chart-tornado").getContext("2d");
  tornadoChart = new Chart(ctx, {
    type: "bar",
    indexAxis: "y",
    data: {
      labels: results.map(r => r.label),
      datasets: [
        {
          label: "Pessimistisch (+jaren)",
          data: results.map(r => r.pessBE - baseBE),
          backgroundColor: "#E55A4E",
          borderRadius: 3,
        },
        {
          label: "Optimistisch (−jaren)",
          data: results.map(r => -(baseBE - r.optBE)),
          backgroundColor: "#0D8C5C",
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const r = results[ctx.dataIndex];
              return ctx.datasetIndex === 0
                ? `Pessimistisch: jaar ${r.pessBE}`
                : `Optimistisch: jaar ${r.optBE}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Afwijking break-even t.o.v. basisscenario (jaar)", font: { size: 10 } },
          ticks: { callback: v => (v > 0 ? "+" : "") + v },
        },
        y: { ticks: { font: { size: 12 } } },
      },
    },
  });
}

/* ═══════════════════════════════════════════════════════════
   §10 — MONTE CARLO risicoanalyse
═══════════════════════════════════════════════════════════ */
function calcMonteCarlo() {
  const p = getROIParams();
  const maxJ = p.jaren + 2;

  function randn() {
    const u = Math.random() || 1e-9, v = Math.random() || 1e-9;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const breakevens = [];
  for (let i = 0; i < 1000; i++) {
    const std = 0.20;
    const sim = {
      ...p,
      onderhoud:   p.onderhoud   * (1 + std * randn()),
      behoud:      Math.min(0.99, Math.max(0.5, p.behoud      * (1 + std * randn()))),
      gemeentePct: Math.min(0.95, Math.max(0,   p.gemeentePct * (1 + std * randn()))),
    };
    breakevens.push(calcROIRows(sim).breakevenJaar || maxJ);
  }
  breakevens.sort((a, b) => a - b);

  const p10 = breakevens[Math.floor(1000 * 0.10)];
  const p50 = breakevens[Math.floor(1000 * 0.50)];
  const p90 = breakevens[Math.floor(1000 * 0.90)];
  const fmt_be = v => v >= maxJ ? ">" + p.jaren : String(v);

  document.getElementById("mc-p10").textContent = fmt_be(p10);
  document.getElementById("mc-p50").textContent = fmt_be(p50);
  document.getElementById("mc-p90").textContent = fmt_be(p90);

  const targetJaar = 8;
  const pctBefore  = Math.round(100 * breakevens.filter(b => b < targetJaar).length / 1000);
  document.getElementById("mc-headline").textContent =
    `${pctBefore}% kans op break-even vóór jaar ${targetJaar}`;

  const spread = p90 - p10;
  const verdictEl = document.getElementById("mc-verdict");
  if (spread <= 3) {
    verdictEl.textContent = "Laag risico";
    verdictEl.className   = "mc-verdict verdict-laag";
  } else if (spread <= 6) {
    verdictEl.textContent = "Gemiddeld risico";
    verdictEl.className   = "mc-verdict verdict-midden";
  } else {
    verdictEl.textContent = "Hoog risico";
    verdictEl.className   = "mc-verdict verdict-hoog";
  }

  // Histogram
  const allJ = Array.from({ length: maxJ }, (_, i) => i + 1);
  const bins  = {};
  breakevens.forEach(b => { bins[b] = (bins[b] || 0) + 1; });

  if (mcChart) mcChart.destroy();
  const ctx = document.getElementById("chart-mc").getContext("2d");
  mcChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: allJ.map(j => "Jaar " + j),
      datasets: [{
        label: "Simulaties",
        data: allJ.map(j => bins[j] || 0),
        backgroundColor: allJ.map(j =>
          j <= p10 ? "#0D8C5C" : j <= p50 ? "#2E75B6" : j <= p90 ? "#E8B84B" : "#E55A4E"),
        borderRadius: 3,
      }],
    },
    options: {
      responsive: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: "Break-even jaar", font: { size: 10 } } },
        y: { title: { display: true, text: "# simulaties", font: { size: 10 } }, beginAtZero: true },
      },
    },
  });
}

/* ═══════════════════════════════════════════════════════════
   §9 — VERGELIJKING
═══════════════════════════════════════════════════════════ */
function updateVergelijking() {
  // Huidige situatie
  const usedCat = {};
  roster.sessies.forEach(s => { usedCat[s.prioriteit] = (usedCat[s.prioriteit]||0)+1; });
  const huidig = Object.entries(usedCat).map(([c,n]) =>
    `<tr><td>${CAT_NL[c]||c}</td><td>${n} sessies</td></tr>`).join("") +
    `<tr><td>Niet ingepland</td><td>${roster.stats.totaal_niet_ingepland}</td></tr>`;
  document.getElementById("verg-huidig").innerHTML =
    `<table>${huidig}</table>`;

  // Scenario
  if (!lastSimResult) {
    document.getElementById("verg-scenario").innerHTML =
      '<p style="color:#999">Simuleer eerst nieuwe teams.</p>';
    return;
  }
  const s = lastSimResult;
  const scenTxt = `<table>
    <tr><td>Categorie</td><td>${s.cat}</td></tr>
    <tr><td>Gewenst</td><td>${s.count} extra teams</td></tr>
    <tr><td>Passen</td><td>${s.totalFit >= s.count ? "✓ Ja" : "⚠ Gedeeltelijk ("+s.totalFit+")"}</td></tr>
    <tr><td>Voorkeursdagen</td><td>${s.days.join(", ")}</td></tr>
    <tr><td>Duur</td><td>${s.duur_min} min, ${(s.veldgebruik*100).toFixed(0)}% veld</td></tr>
  </table>`;
  document.getElementById("verg-scenario").innerHTML = scenTxt;
}

/* ═══════════════════════════════════════════════════════════
   REFRESH ROSTER
═══════════════════════════════════════════════════════════ */
async function refreshRoster() {
  const btn = document.getElementById("btn-refresh");
  btn.textContent = "⏳ Genereren…";
  btn.disabled = true;
  try {
    const r = await fetch("/api/refresh", { method: "POST" });
    const data = await r.json();
    if (data.ok) {
      await loadRoster();
      renderAll();
      btn.textContent = "✓ Klaar";
    } else {
      alert("Fout bij genereren:\n" + data.error);
      btn.textContent = "✗ Mislukt";
    }
  } catch {
    alert("Server niet bereikbaar.");
    btn.textContent = "↻ Genereer rooster";
  }
  setTimeout(() => { btn.textContent = "↻ Genereer rooster"; btn.disabled = false; }, 2500);
}

/* ═══════════════════════════════════════════════════════════
   UTILITY
═══════════════════════════════════════════════════════════ */
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/* ═══════════════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", init);
