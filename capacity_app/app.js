/* ================================================================
   JEKA Capaciteitsmanager v2 — App Logic
   ================================================================ */

'use strict';

// ── Constants ────────────────────────────────────────────────────
const DAGEN      = ['MA', 'DI', 'WO', 'DO', 'VR'];
const DAG_LABELS = { MA:'Maandag', DI:'Dinsdag', WO:'Woensdag', DO:'Donderdag', VR:'Vrijdag' };
const VELDEN     = ['Veld 6', 'Veld 7', 'Veld 1', 'Veld 2'];
const START_MIN  = 16 * 60;   // 16:00
const SLOT_MIN   = 15;
const N_SLOTS    = 27;         // 16:00 – 22:30

const CATEGORIE_MAP = [
  [/^JO7(?!\d)/i,              'JO7'],
  [/^JO8(?!\d)/i,              'JO8'],
  [/^JO9(?!\d)/i,              'JO9'],
  [/^JO10/i,                   'JO10'],
  [/^JO11/i,                   'JO11'],
  [/^JO12/i,                   'JO12'],
  [/^JO13/i,                   'JO13'],
  [/^JO14/i,                   'JO14'],
  [/^JO15/i,                   'JO15'],
  [/^JO17/i,                   'JO17'],
  [/^JO19/i,                   'JO19'],
  [/^MO13/i,                   'MO13'],
  [/^MO15/i,                   'MO15'],
  [/^MO17/i,                   'MO17'],
  [/^MO20/i,                   'MO20'],
  [/^(Heren|Dames|Vaders)/i,   'Senioren'],
  [/^(G-|Keeperstraining|4SKILLS|KT)/i, 'Bijzonder'],
  [/^Gehandicapt/i,            'Gehandicapt'],
];

// ── Utility helpers ───────────────────────────────────────────────
function detectCategorie(teamId) {
  for (const [re, cat] of CATEGORIE_MAP) {
    if (re.test(teamId)) return cat;
  }
  return 'Overig';
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function timeToSlot(t) {
  return Math.round((timeToMinutes(t) - START_MIN) / SLOT_MIN);
}

function slotToTime(s) {
  const total = START_MIN + s * SLOT_MIN;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function heatmapColor(pct) {
  if (pct <= 0)  return '#ffffff';
  if (pct < 50)  return '#C8E6C9';
  if (pct < 80)  return '#fff3cd';
  if (pct < 100) return '#fcd199';
  return '#f8d7da';
}

function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

function qs(sel) { return document.querySelector(sel); }

// ── Capacity grid ─────────────────────────────────────────────────
function buildGrid(sessies) {
  const grid = {};
  for (const dag of DAGEN) {
    grid[dag] = {};
    for (const veld of VELDEN) {
      grid[dag][veld] = new Array(N_SLOTS).fill(0);
    }
  }
  for (const s of sessies) {
    if (!grid[s.dag] || !grid[s.dag][s.veld]) continue;
    const startSlot = timeToSlot(s.start);
    const endSlot   = timeToSlot(s.eind);
    for (let i = startSlot; i < endSlot; i++) {
      if (i >= 0 && i < N_SLOTS) grid[s.dag][s.veld][i] += s.veldgebruik;
    }
  }
  return grid;
}

function getOccupancy(grid, dag, slot, veldFilter) {
  if (veldFilter && veldFilter !== 'all') {
    return (grid[dag][veldFilter] || [])[slot] || 0;
  }
  return VELDEN.reduce((sum, v) => sum + (grid[dag][v][slot] || 0), 0) / VELDEN.length;
}

// ── Find available slots for an unscheduled team ──────────────────
function findAvailableSlots(teamId, catRegels, grid, maxResults) {
  maxResults = maxResults || 6;
  const cat   = detectCategorie(teamId);
  const regel = catRegels[cat];
  if (!regel) return [];

  const duurSlots = Math.ceil((regel.duur_min || 60) / SLOT_MIN);
  const gebruik   = regel.veldgebruik || 0.5;
  const vanSlot   = Math.max(0, timeToSlot(regel.tijd_van || '16:00'));
  const totSlot   = Math.min(N_SLOTS, timeToSlot(regel.tijd_tot || '22:30'));
  const opties    = [];

  outer:
  for (const dag of DAGEN) {
    for (const veld of VELDEN) {
      for (let s = vanSlot; s + duurSlots <= totSlot; s++) {
        let fits = true;
        for (let i = s; i < s + duurSlots; i++) {
          if ((grid[dag][veld][i] || 0) + gebruik > 1.001) { fits = false; break; }
        }
        if (fits) {
          opties.push({
            dag, veld,
            start: slotToTime(s),
            eind:  slotToTime(s + duurSlots),
          });
          s += duurSlots - 1;
          if (opties.length >= maxResults) break outer;
        }
      }
    }
  }
  return opties;
}

// ── Seizoenen ─────────────────────────────────────────────────────
let _huidigSeizoen = '2025_2026';
let _roosterSessies = [];

async function _refreshSeizoensDropdown() {
  try {
    const resp    = await fetch('/api/seasons');
    const json    = await resp.json();
    const seasons = (json.seasons || []).sort((a, b) => a.slug.localeCompare(b.slug));
    const optsHtml = seasons.map(s =>
      `<option value="${escHtml(s.slug)}"${s.slug === _huidigSeizoen ? ' selected' : ''}>${escHtml(s.seizoen)}</option>`
    ).join('');
    ['seizoen-select', 'seizoen-select-teams'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = optsHtml;
    });
  } catch (e) {
    console.warn('Seizoenenlijst kon niet worden geladen:', e);
  }
}

async function loadSeasonRoster(slug) {
  _huidigSeizoen = slug;
  try {
    const resp = await fetch(`/api/seasons/${slug}/roster?t=` + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const newSessies = data.sessies || [];
    _roosterSessies = newSessies;
    window._updateRoosterSessies?.(newSessies);
    initTeamsTab(newSessies);
    const grid = buildGrid(newSessies);
    renderDashboard(data, grid);
    renderNietIngepland(data, grid);
    renderCriteriaCheck(data);
    initCategorieTab(data);
    initVrijeSlotsTab(data, grid);
    const ts = data.generated_at
      ? new Date(data.generated_at).toLocaleString('nl-NL')
      : '—';
    document.getElementById('last-update').textContent = `Gegenereerd: ${ts}`;
  } catch (e) {
    showToast('Fout bij laden seizoen: ' + e.message, 'red');
  }
}

function openNieuwSeizoenModal() {
  document.getElementById('nieuw-seizoen-modal')?.remove();

  const CATEGORIEEN = [
    { label: 'Jongens onderbouw',  cats: ['JO7','JO8','JO9','JO10','JO11'] },
    { label: 'Jongens middenbouw', cats: ['JO12','JO13','JO14','JO15'] },
    { label: 'Jongens bovenbouw',  cats: ['JO16','JO17','JO18','JO19','JO21','JO23'] },
    { label: 'Meisjes onderbouw',  cats: ['MO8','MO9','MO10','MO11'] },
    { label: 'Meisjes middenbouw', cats: ['MO12','MO13','MO14','MO15'] },
    { label: 'Meisjes bovenbouw',  cats: ['MO17','MO19','MO20'] },
    { label: 'Senioren',           cats: ['Heren','Dames','Vaders'] },
    { label: 'Overig',             cats: ['G-teams','Keeperstraining','4SKILLS'] },
  ];

  // Categorieën zonder selectie-onderscheid
  const GEEN_SELECTIE = new Set(['G-teams','Keeperstraining','4SKILLS','Vaders']);

  const catRows = CATEGORIEEN.map(groep => `
    <tr><td colspan="3" style="background:#f0f4f8;font-weight:700;padding:5px 10px;font-size:12px;color:#555;letter-spacing:.03em">${escHtml(groep.label)}</td></tr>
    ${groep.cats.map(cat => {
      const is4S    = cat === '4SKILLS';
      const noSel   = GEEN_SELECTIE.has(cat);
      const label   = is4S ? '4SKILLS <small style="color:#888">(vr 16–19:30, 1=aanwezig)</small>' : escHtml(cat);
      const maxVal  = is4S ? 1 : 30;
      return `
      <tr>
        <td style="padding:5px 10px;font-size:13px">${label}</td>
        <td style="padding:4px 10px;text-align:center">
          <input type="number" class="ns-totaal" data-cat="${escHtml(cat)}"
                 min="0" max="${maxVal}" value="0"
                 style="width:60px;text-align:center;padding:3px;border:1px solid #ccc;border-radius:3px"></td>
        <td style="padding:4px 10px;text-align:center">
          ${noSel
            ? '<span style="color:#bbb;font-size:12px">—</span>'
            : `<input type="number" class="ns-selectie" data-cat="${escHtml(cat)}"
                      min="0" max="${maxVal}" value="0"
                      style="width:60px;text-align:center;padding:3px;border:1px solid #ccc;border-radius:3px">`
          }</td>
      </tr>`;
    }).join('')}
  `).join('');

  const overlay = document.createElement('div');
  overlay.id = 'nieuw-seizoen-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:8px;padding:28px;max-width:520px;width:92%;
                max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.3)">
      <h2 style="margin:0 0 18px;font-size:18px;color:#1A252F">Nieuw seizoen aanmaken</h2>

      <div style="margin-bottom:16px">
        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:5px">Seizoen</label>
        <input id="ns-seizoen-input" type="text" placeholder="bijv. 2026/2027"
               style="width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box">
        <span id="ns-seizoen-fout" style="color:#c00;font-size:12px;display:none">Gebruik het formaat YYYY/YYYY</span>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px">
        <thead>
          <tr style="background:#eaf0f6">
            <th style="text-align:left;padding:6px 10px">Categorie</th>
            <th style="padding:6px 10px;text-align:center">Totaal teams</th>
            <th style="padding:6px 10px;text-align:center">Waarvan selectie</th>
          </tr>
        </thead>
        <tbody>${catRows}</tbody>
      </table>

      <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap">
        <span id="ns-status" style="font-size:12px;color:#555;flex:1;min-width:0"></span>
        <button id="ns-annuleer" style="padding:8px 16px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;font-size:13px">Annuleren</button>
        <button id="ns-aanmaken" class="btn-primary" style="padding:8px 20px;font-size:13px">Seizoen aanmaken →</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('ns-annuleer').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('ns-aanmaken').addEventListener('click', async () => {
    const seizoen = document.getElementById('ns-seizoen-input').value.trim();
    const fout    = document.getElementById('ns-seizoen-fout');

    if (!/^\d{4}\/\d{4}$/.test(seizoen)) {
      fout.style.display = 'block';
      return;
    }
    fout.style.display = 'none';

    const teams = {};
    document.querySelectorAll('.ns-totaal').forEach(inp => {
      const cat    = inp.dataset.cat;
      const totaal = parseInt(inp.value) || 0;
      const selInp = document.querySelector(`.ns-selectie[data-cat="${CSS.escape(cat)}"]`);
      const sel2   = selInp ? Math.min(parseInt(selInp.value) || 0, totaal) : 0;
      if (totaal > 0) teams[cat] = { totaal, selectie: sel2 };
    });

    if (Object.keys(teams).length === 0) {
      document.getElementById('ns-status').textContent = 'Vul minimaal één categorie in.';
      return;
    }

    const btn    = document.getElementById('ns-aanmaken');
    const status = document.getElementById('ns-status');
    btn.disabled = true;
    status.textContent = 'Rooster wordt aangemaakt…';

    try {
      const res  = await fetch('/api/seasons/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ seizoen, teams }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.detail || `HTTP ${res.status}`);

      overlay.remove();
      showToast(`Seizoen ${escHtml(seizoen)} aangemaakt — ${json.totaal_ingepland} sessies ingepland`, 'green');

      _huidigSeizoen = json.slug;
      await _refreshSeizoensDropdown();

      // Schakel naar rooster-tab en laad het nieuwe seizoen
      document.querySelector('.tab-btn[data-tab="rooster"]')?.click();
      await loadSeasonRoster(json.slug);
    } catch (e) {
      status.textContent = '✗ Fout: ' + e.message;
      btn.disabled = false;
    }
  });
}

// ── Tab navigation ────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById('tab-' + btn.dataset.tab);
      if (target) target.classList.add('active');
    });
  });
}

// ── Dashboard ─────────────────────────────────────────────────────
function renderDashboard(data, grid) {
  const sessies = data.sessies || [];
  const niet    = data.niet_ingepland || [];
  const stats   = data.stats || {};

  const totalIn  = stats.totaal_ingepland || sessies.length;
  const totalNiet = niet.length;
  const score    = (totalIn + totalNiet) > 0
    ? Math.round(totalIn / (totalIn + totalNiet) * 100)
    : 0;
  const nTeams   = new Set(sessies.map(s => s.team_id)).size;
  const velduren = (sessies.reduce((sum, s) =>
    sum + (timeToSlot(s.eind) - timeToSlot(s.start)) * s.veldgebruik, 0
  ) * SLOT_MIN / 60).toFixed(1);

  document.getElementById('kpi-row').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-val">${totalIn}</div>
      <div class="kpi-label">Sessies ingepland</div>
    </div>
    <div class="kpi-card ${totalNiet > 0 ? 'danger' : ''}">
      <div class="kpi-val">${totalNiet}</div>
      <div class="kpi-label">Niet ingepland</div>
    </div>
    <div class="kpi-card ${score < 95 ? 'warn' : ''}">
      <div class="kpi-val">${score}%</div>
      <div class="kpi-label">Inplanningsscore</div>
    </div>
    <div class="kpi-card info">
      <div class="kpi-val">${nTeams}</div>
      <div class="kpi-label">Actieve teams</div>
    </div>
    <div class="kpi-card info">
      <div class="kpi-val">${velduren}u</div>
      <div class="kpi-label">Totaal velduren</div>
    </div>`;

  // Category summary table
  const catMap = {};
  for (const s of sessies) {
    const cat = detectCategorie(s.team_id);
    if (!catMap[cat]) catMap[cat] = { sessies: 0, teams: new Set(), niet: 0 };
    catMap[cat].sessies++;
    catMap[cat].teams.add(s.team_id);
  }
  for (const n of niet) {
    const cat = detectCategorie(n.team_id);
    if (!catMap[cat]) catMap[cat] = { sessies: 0, teams: new Set(), niet: 0 };
    catMap[cat].niet++;
    catMap[cat].teams.add(n.team_id);
  }

  qs('#cat-table tbody').innerHTML = Object.keys(catMap).sort().map(cat => {
    const row  = catMap[cat];
    const tot  = row.sessies + row.niet;
    const pct  = tot > 0 ? Math.round(row.sessies / tot * 100) : 0;
    const cls  = pct < 70 ? 'danger' : (pct < 100 ? 'warn' : '');
    return `<tr>
      <td><strong>${cat}</strong></td>
      <td>${row.teams.size}</td>
      <td>${row.sessies}</td>
      <td>${row.niet > 0
        ? `<span class="pill pill-bad">${row.niet}</span>`
        : '<span class="pill pill-ok">0</span>'}</td>
      <td>
        <div class="pct-bar">
          <div class="pct-track">
            <div class="pct-fill ${cls}" style="width:${pct}%"></div>
          </div>
          <div class="pct-val">${pct}%</div>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Day bars
  const dagCount = {};
  DAGEN.forEach(d => { dagCount[d] = 0; });
  sessies.forEach(s => { if (dagCount[s.dag] !== undefined) dagCount[s.dag]++; });
  const maxN = Math.max(...Object.values(dagCount), 1);

  document.getElementById('dag-bars').innerHTML = DAGEN.map(dag => {
    const n = dagCount[dag];
    const pct = Math.round(n / maxN * 100);
    return `<div class="dag-bar-row">
      <div class="dag-bar-label">${dag}</div>
      <div class="dag-bar-track">
        <div class="dag-bar-fill" style="width:${pct}%">
          ${pct > 15 ? `<span>${n}</span>` : ''}
        </div>
      </div>
      <div class="dag-bar-num">${n}</div>
    </div>`;
  }).join('');
}

// ── Heatmap ───────────────────────────────────────────────────────
function renderHeatmap(grid, veldFilter) {
  const tbl = document.getElementById('heatmap-table');
  const head = `<thead><tr><th>Tijd</th>${DAGEN.map(d =>
    `<th title="${DAG_LABELS[d]}">${DAG_LABELS[d]}</th>`).join('')}</tr></thead>`;

  const rows = [];
  for (let slot = 0; slot < N_SLOTS; slot++) {
    const time  = slotToTime(slot);
    const cells = DAGEN.map(dag => {
      const occ = getOccupancy(grid, dag, slot, veldFilter);
      const pct = Math.min(100, Math.round(occ * 100));
      const bg  = heatmapColor(pct);
      return `<td style="background:${bg}"
                  title="${DAG_LABELS[dag]} ${time} — ${pct}% bezet">${pct > 0 ? pct + '%' : ''}</td>`;
    }).join('');
    rows.push(`<tr><td>${time}</td>${cells}</tr>`);
  }
  tbl.innerHTML = head + `<tbody>${rows.join('')}</tbody>`;
}

function initHeatmap(grid) {
  renderHeatmap(grid, 'all');
  const sel = document.getElementById('heatmap-veld-select');
  sel.addEventListener('change', () => renderHeatmap(grid, sel.value));
}

// ── Niet ingepland ────────────────────────────────────────────────
function renderNietIngepland(data, grid) {
  const niet      = data.niet_ingepland || [];
  const catRegels = data.categorie_regels || {};

  document.getElementById('badge-niet').textContent = niet.length > 0 ? niet.length : '';

  const intro = document.getElementById('niet-ingepland-intro');
  const list  = document.getElementById('niet-ingepland-list');

  if (niet.length === 0) {
    intro.innerHTML = '<strong>Alle teams zijn ingepland.</strong>';
    list.innerHTML  = '';
    return;
  }

  intro.innerHTML = `<strong>${niet.length} team(s)</strong> konden niet worden ingepland. Zie hieronder de reden en mogelijke alternatieven.`;

  list.innerHTML = niet.map(item => {
    const cat   = detectCategorie(item.team_id);
    const opties = findAvailableSlots(item.team_id, catRegels, grid);
    const optiesHTML = opties.length > 0
      ? opties.map(o =>
          `<span class="slot-optie">${DAG_LABELS[o.dag]} ${o.start}–${o.eind} · ${o.veld}</span>`
        ).join('')
      : `<span class="no-opties">Geen vrije slots in het tijdvenster van ${cat}.</span>`;

    return `<div class="niet-card">
      <div class="niet-card-header">
        <div class="niet-card-team">${item.team_id}</div>
        <span class="cat-badge">${cat}</span>
      </div>
      <div class="niet-card-reden">${item.reden}</div>
      <div class="niet-card-opties">
        <h4>Mogelijke alternatieve slots</h4>
        ${optiesHTML}
      </div>
    </div>`;
  }).join('');
}

// ── Per categorie ─────────────────────────────────────────────────
function initCategorieTab(data) {
  const sessies   = data.sessies || [];
  const catRegels = data.categorie_regels || {};
  const cats      = [...new Set(sessies.map(s => detectCategorie(s.team_id)))].sort();

  const sel = document.getElementById('cat-select');
  sel.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');

  function render() {
    const cat   = sel.value;
    const regel = catRegels[cat] || {};
    const van   = regel.tijd_van || '—';
    const tot   = regel.tijd_tot || '—';

    qs('#cat-info').textContent =
      `Venster: ${van}–${tot} · Duur: ${regel.duur_min || '—'} min · Sessies/week: ${regel.sessies || '—'}`;

    const filtered = sessies
      .filter(s => detectCategorie(s.team_id) === cat)
      .sort((a, b) => a.team_id.localeCompare(b.team_id, 'nl') || DAGEN.indexOf(a.dag) - DAGEN.indexOf(b.dag));

    qs('#cat-sessions tbody').innerHTML = filtered.map(s => {
      let pill = '';
      if (van !== '—') {
        const sMin  = timeToMinutes(s.start);
        const inWin = sMin >= timeToMinutes(van) && sMin <= timeToMinutes(tot);
        pill = inWin
          ? '<span class="pill pill-ok">✓ In venster</span>'
          : '<span class="pill pill-warn">! Buiten venster</span>';
      }
      return `<tr>
        <td><strong>${s.team_id}</strong></td>
        <td>${DAG_LABELS[s.dag]}</td>
        <td>${s.start}</td>
        <td>${s.eind}</td>
        <td>${s.veld}</td>
        <td>${s.subveld}</td>
        <td>${pill}</td>
      </tr>`;
    }).join('');
  }

  sel.addEventListener('change', render);
  if (cats.length) render();
}

// ── Vrije slots ───────────────────────────────────────────────────
function initVrijeSlotsTab(data, grid) {
  const catRegels = data.categorie_regels || {};

  const catSel = document.getElementById('vrij-cat-select');
  catSel.innerHTML = '<option value="">Alle tijden</option>' +
    Object.keys(catRegels).sort().map(c => `<option value="${c}">${c}</option>`).join('');

  function render() {
    const catFilter  = catSel.value;
    const veldFilter = document.getElementById('vrij-veld-select').value;
    const dagFilter  = document.getElementById('vrij-dag-select').value;

    let vanSlot = 0;
    let totSlot = N_SLOTS;
    if (catFilter && catRegels[catFilter]) {
      vanSlot = Math.max(0, timeToSlot(catRegels[catFilter].tijd_van || '16:00'));
      totSlot = Math.min(N_SLOTS, timeToSlot(catRegels[catFilter].tijd_tot || '22:30'));
    }

    const velden = veldFilter ? [veldFilter] : VELDEN;
    const dagen  = dagFilter  ? [dagFilter]  : DAGEN;
    const rows   = [];

    for (const dag of dagen) {
      for (const veld of velden) {
        let blockStart = null;
        let blockOccMax = 0;

        const flush = (endSlot) => {
          if (blockStart === null) return;
          const durMin = (endSlot - blockStart) * SLOT_MIN;
          const freePct = Math.round((1 - blockOccMax) * 100);
          if (freePct > 0 && durMin >= 15) {
            rows.push({ dag, veld, start: slotToTime(blockStart), eind: slotToTime(endSlot), durMin, freePct });
          }
          blockStart = null;
          blockOccMax = 0;
        };

        for (let s = vanSlot; s <= totSlot; s++) {
          if (s === totSlot) { flush(s); break; }
          const occ = grid[dag][veld][s] || 0;
          if (occ < 0.999) {
            if (blockStart === null) blockStart = s;
            blockOccMax = Math.max(blockOccMax, occ);
          } else {
            flush(s);
          }
        }
      }
    }

    rows.sort((a, b) => b.freePct - a.freePct || DAGEN.indexOf(a.dag) - DAGEN.indexOf(b.dag));

    const tbody = qs('#vrij-tabel tbody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#999;padding:20px">Geen vrije slots gevonden.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const ruimte = r.freePct >= 100 ? '<span class="pill pill-ok">heel veld</span>'
        : r.freePct >= 50  ? '<span class="pill pill-ok">halve groep</span>'
        : r.freePct >= 25  ? '<span class="pill pill-info">deel vrij</span>'
        : '<span class="pill pill-warn">klein deel</span>';
      return `<tr>
        <td>${DAG_LABELS[r.dag]}</td>
        <td>${r.veld}</td>
        <td>${r.start} – ${r.eind} <small style="color:#999">(${r.durMin} min)</small></td>
        <td>
          <div class="pct-bar">
            <div class="pct-track">
              <div class="pct-fill" style="width:${r.freePct}%;background:${r.freePct > 60 ? 'var(--green-light)' : 'var(--orange)'}"></div>
            </div>
            <div class="pct-val">${r.freePct}%</div>
          </div>
        </td>
        <td>${ruimte}</td>
      </tr>`;
    }).join('');
  }

  ['vrij-cat-select', 'vrij-veld-select', 'vrij-dag-select']
    .forEach(id => document.getElementById(id).addEventListener('change', render));
  render();
}

// ── Criteria check ────────────────────────────────────────────────
function renderCriteriaCheck(data) {
  const catRegels   = data.categorie_regels || {};
  const afwijkingen = [];

  for (const s of (data.sessies || [])) {
    const cat   = detectCategorie(s.team_id);
    const regel = catRegels[cat];
    if (!regel) continue;
    const vanMin = timeToMinutes(regel.tijd_van || '00:00');
    const totMin = timeToMinutes(regel.tijd_tot || '23:59');
    const sMin   = timeToMinutes(s.start);
    if (sMin < vanMin || sMin > totMin) {
      const diff = sMin < vanMin
        ? `${vanMin - sMin} min te vroeg`
        : `${sMin - totMin} min te laat`;
      afwijkingen.push({ ...s, cat, regel, diff });
    }
  }

  const tbody  = qs('#criteria-tabel tbody');
  const okMsg  = document.getElementById('criteria-ok');

  if (!afwijkingen.length) {
    tbody.innerHTML  = '';
    okMsg.style.display = 'block';
    return;
  }
  okMsg.style.display = 'none';

  const prioOrder = { onderbouw:1, middenbouw:2, bovenbouw:3, senioren:4, bijzonder:5 };
  afwijkingen.sort((a, b) =>
    (prioOrder[a.prioriteit] || 9) - (prioOrder[b.prioriteit] || 9)
  );

  tbody.innerHTML = afwijkingen.map(a => {
    const venster = `${a.regel.tijd_van || '?'}–${a.regel.tijd_tot || '?'}`;
    return `<tr>
      <td><strong>${a.team_id}</strong></td>
      <td>${a.cat}</td>
      <td>${DAG_LABELS[a.dag]} ${a.start}–${a.eind} (${a.veld})</td>
      <td>${venster}</td>
      <td><span class="pill pill-warn">${a.diff}</span></td>
      <td><span class="pill pill-info">${a.prioriteit || '—'}</span></td>
    </tr>`;
  }).join('');
}

// ── Weekrooster — Excel-stijl tabel ──────────────────────────────
const PRIO_COLORS = {
  onderbouw:  '#AED6F1',
  middenbouw: '#A9DFBF',
  bovenbouw:  '#F9E79F',
  senioren:   '#F1948A',
  bijzonder:  '#D7BDE2',
};
const PRIO_TEXT = {
  onderbouw:  '#154360',
  middenbouw: '#145A32',
  bovenbouw:  '#7D6608',
  senioren:   '#641E16',
  bijzonder:  '#4A235A',
};
const DAG_COLORS = ['#E8F5E9','#E3F2FD','#FFF8E1','#F3E5F5','#FBE9E7'];

// C→A en D→B: rooster toont altijd max 2 kolommen per veld
const ROOSTER_SUBS = ['A', 'B'];
function subToCol(sub) { return (sub === 'C' || sub === 'A') ? 'A' : 'B'; }

function buildRoosterRegistry(sessies) {
  const veldSubs = {};
  for (const v of VELDEN) veldSubs[v] = ROOSTER_SUBS;

  const reg = {};
  for (const dag of DAGEN) {
    reg[dag] = {};
    for (const veld of VELDEN) {
      reg[dag][veld] = {
        A: new Array(N_SLOTS).fill(null),
        B: new Array(N_SLOTS).fill(null),
      };
    }
  }

  for (const s of sessies) {
    const rawSub    = s.subveld.slice(-1);
    const sub       = subToCol(rawSub);   // C→A, D→B
    const startSlot = timeToSlot(s.start);
    const endSlot   = timeToSlot(s.eind);
    const span      = endSlot - startSlot;
    const col       = reg[s.dag]?.[s.veld]?.[sub];
    if (!col) continue;

    if (col[startSlot] === 'skip') {
      // Cel al bezet door rowspan — voeg toe aan de eerste sessie in de groep
      for (let i = startSlot - 1; i >= 0; i--) {
        if (col[i] && col[i] !== 'skip') { col[i].sessions.push(s); break; }
      }
      continue;
    }

    if (col[startSlot] === null) {
      col[startSlot] = { sessions: [s], span };
      for (let i = startSlot + 1; i < endSlot && i < N_SLOTS; i++) {
        if (col[i] === null) col[i] = 'skip';
      }
    } else {
      col[startSlot].sessions.push(s);
    }
  }
  return { reg, veldSubs };
}

function renderRoosterTabel(sessies, veldFilter) {
  const velden = veldFilter
    ? [veldFilter]
    : VELDEN;

  const { reg, veldSubs } = buildRoosterRegistry(sessies);

  // Column spec: ordered (dag, veld, sub) triples — only used subvelden
  const colSpec = [];
  for (const dag of DAGEN) {
    for (const veld of velden) {
      for (const sub of (veldSubs[veld] || ['A'])) {
        colSpec.push({ dag, veld, sub });
      }
    }
  }

  // ── Header row 1: Tijd + dag headers ──
  let hdr1 = '<tr><th class="r-th-tijd" rowspan="2">Tijd</th>';
  DAGEN.forEach((dag, di) => {
    const bg    = DAG_COLORS[di];
    const nCols = velden.reduce((sum, v) => sum + (veldSubs[v] || ['A']).length, 0);
    hdr1 += `<th colspan="${nCols}" class="r-th-dag" style="background:${bg}">${DAG_LABELS[dag]}</th>`;
  });
  hdr1 += '</tr>';

  // ── Header row 2: subveld labels ──
  let hdr2 = '<tr>';
  DAGEN.forEach((dag, di) => {
    const bg = DAG_COLORS[di];
    for (const veld of velden) {
      const vNum = veld.slice(-1);
      for (const sub of (veldSubs[veld] || ['A'])) {
        hdr2 += `<th class="r-th-sub" style="background:${bg}">V${vNum}${sub}</th>`;
      }
    }
  });
  hdr2 += '</tr>';

  // ── Body rows ──
  const rows = [];
  for (let slot = 0; slot < N_SLOTS; slot++) {
    const time        = slotToTime(slot);
    const isHalfHour  = (slot * 15) % 30 === 0;
    const isFullHour  = (slot * 15) % 60 === 0;
    const rowCls      = isFullHour ? 'r-full-hour' : (isHalfHour ? 'r-half-hour' : '');

    let row = `<tr class="${rowCls}">`;
    row += `<td class="r-td-tijd${isFullHour ? ' r-full-hr-td' : ''}">${isHalfHour ? time : ''}</td>`;

    for (const { dag, veld, sub } of colSpec) {
      const cell = reg[dag][veld][sub][slot];

      if (cell === 'skip') continue;   // covered by rowspan — omit td

      if (cell === null) {
        row += `<td class="r-td-leeg"></td>`;
      } else {
        const prio     = cell.sessions[0]?.prioriteit || 'bijzonder';
        const bg       = PRIO_COLORS[prio]  || '#E0E0E0';
        const txtColor = PRIO_TEXT[prio]    || '#333';
        const teamHTML = cell.sessions
          .map(s => `<span class="r-team-naam">${escHtml(s.team_id)}</span>`)
          .join('');
        const tijd     = `${cell.sessions[0].start}–${cell.sessions[0].eind}`;
        const cellH    = cell.span * 20;   // 20px per slot
        const tooltip  = cell.sessions.map(s => s.team_id).join(' + ') + ' · ' + tijd;
        const idxsAttr = cell.sessions.map(s => sessies.indexOf(s)).join(',');

        row += `<td class="r-td-sessie" rowspan="${cell.span}"
            data-idxs="${idxsAttr}"
            data-slot="${slot}"
            data-span="${cell.span}"
            style="background:${bg};color:${txtColor};vertical-align:top;cursor:grab"
            title="${escHtml(tooltip)}">
          <div class="r-cell-inner">
            <div class="r-teams">${teamHTML}</div>
            ${cellH >= 34 ? `<div class="r-sessie-tijd">${tijd}</div>` : ''}
          </div>
        </td>`;
      }
    }

    row += '</tr>';
    rows.push(row);
  }

  _colSpec = colSpec;
  return `<table class="rooster-tabel">
    <colgroup>
      <col class="col-tijd">
      ${colSpec.map(() => '<col class="col-sub">').join('')}
    </colgroup>
    <thead>${hdr1}${hdr2}</thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

// ── Drag-and-drop state (module-level so document listeners are added once) ──
let _rDrag     = null;   // active drag object
let _rDragInit = false;  // document listeners added?
let _colSpec   = [];     // current column layout, set by renderRoosterTabel
let _undoStack = [];     // undo history [{dag,start,eind,veld,subveld,_modified}[]]

function _saveUndoState(sessies) {
  _undoStack.push(sessies.map(s => ({
    dag: s.dag, start: s.start, eind: s.eind,
    veld: s.veld, subveld: s.subveld, _modified: s._modified,
  })));
  if (_undoStack.length > 20) _undoStack.shift();
}

function _checkCapaciteit(sessies) {
  const grid = buildGrid(sessies);
  for (const dag of DAGEN) {
    for (const veld of VELDEN) {
      for (let i = 0; i < N_SLOTS; i++) {
        if ((grid[dag]?.[veld]?.[i] || 0) > 1.001) return false;
      }
    }
  }
  return true;
}

function _kolomVanX(x, wrap) {
  const ths = [...wrap.querySelectorAll('thead tr:nth-child(2) th')];
  let best = 0;
  for (let i = 0; i < ths.length; i++) {
    if (x >= ths[i].getBoundingClientRect().left) best = i;
  }
  return best;
}

function setupRoosterDrag(sessies, wrap, onchange) {
  // Replace mousedown listener on wrap each time the table is re-rendered
  if (wrap._rdHandler) wrap.removeEventListener('mousedown', wrap._rdHandler);

  wrap._rdHandler = e => {
    const td = e.target.closest('.r-td-sessie[data-idxs]');
    if (!td) return;
    e.preventDefault();

    const rect = td.getBoundingClientRect();
    const idxs = td.dataset.idxs.split(',').map(Number);
    const span = parseInt(td.dataset.span, 10);

    const clone = td.cloneNode(true);
    Object.assign(clone.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '1000',
      width: rect.width + 'px', height: rect.height + 'px',
      top: rect.top + 'px', left: rect.left + 'px',
      opacity: '0.88', boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
      cursor: 'grabbing',
    });
    document.body.appendChild(clone);
    td.style.opacity = '0.2';

    // Meet echte slot-hoogte via de tijdkolom (heeft nooit rowspan)
    const tbody = wrap.querySelector('tbody');
    const tbodyTop = tbody ? tbody.getBoundingClientRect().top : 0;
    const timeCells = tbody ? [...tbody.querySelectorAll('td.r-td-tijd')] : [];
    const slotHeight = timeCells.length >= 2
      ? timeCells[1].getBoundingClientRect().top - timeCells[0].getBoundingClientRect().top
      : (timeCells.length === 1 ? timeCells[0].getBoundingClientRect().height : 20);

    _rDrag = { td, clone, rect, idxs, span, startY: e.clientY, startX: e.clientX,
               wrap, sessies, onchange, tbodyTop, slotHeight };
  };
  wrap.addEventListener('mousedown', wrap._rdHandler);

  if (_rDragInit) return;
  _rDragInit = true;

  document.addEventListener('mousemove', e => {
    if (!_rDrag) return;
    _rDrag.clone.style.top  = (_rDrag.rect.top  + (e.clientY - _rDrag.startY)) + 'px';
    _rDrag.clone.style.left = (_rDrag.rect.left + (e.clientX - _rDrag.startX)) + 'px';
  });

  document.addEventListener('mouseup', e => {
    if (!_rDrag) return;
    const { td, clone, startX, wrap: _wrap, idxs, sessies: _s, onchange: _oc } = _rDrag;

    // Relatieve beweging t.o.v. klikpunt (zelfde principe als origineel, maar met gemeten rijhoogte)
    const { startY, slotHeight } = _rDrag;
    const slotDelta = Math.round((e.clientY - startY) / slotHeight);
    const colIdx    = _kolomVanX(e.clientX, _wrap);
    const newKolom  = _colSpec[colIdx];
    clone.remove();
    td.style.opacity = '';
    _rDrag = null;

    // Check of er iets verandert
    const wouldChange = idxs.some(i => {
      const s = _s[i];
      return slotDelta !== 0 ||
        (newKolom && (newKolom.dag !== s.dag || newKolom.sub !== (s.subveld?.slice(-1))));
    });
    if (!wouldChange) return;

    // Sla huidige staat op vóór wijziging (voor undo)
    _saveUndoState(_s);

    // Sla originelen op voor terugval bij capaciteitsconflict
    const originals = idxs.map(i => {
      const s = _s[i];
      return { dag: s.dag, start: s.start, eind: s.eind, veld: s.veld, subveld: s.subveld };
    });

    // Pas wijzigingen toe
    idxs.forEach(i => {
      const s = _s[i];
      if (slotDelta !== 0) {
        const sSlot    = timeToSlot(s.start);
        const dur      = timeToSlot(s.eind) - sSlot;
        const newStart = Math.max(0, Math.min(sSlot + slotDelta, N_SLOTS - 1 - dur));
        s.start = slotToTime(newStart);
        s.eind  = slotToTime(newStart + dur);
      }
      if (newKolom && (newKolom.dag !== s.dag || newKolom.sub !== (s.subveld?.slice(-1)))) {
        s.dag     = newKolom.dag;
        s.veld    = newKolom.veld;
        s.subveld = newKolom.veld + newKolom.sub;
      }
    });

    // Capaciteitscheck — terug naar origineel als het niet past
    if (!_checkCapaciteit(_s)) {
      _undoStack.pop(); // undo-entry niet nodig, we reverten direct
      idxs.forEach((i, j) => Object.assign(_s[i], originals[j]));
      // Rode flits op het blok als visuele feedback
      td.style.transition = 'box-shadow 0.15s, outline 0.15s';
      td.style.outline    = '3px solid #e53935';
      setTimeout(() => { td.style.outline = ''; td.style.transition = ''; }, 500);
      return;
    }

    idxs.forEach(i => { _s[i]._modified = true; });
    _oc();
  });
}

function initRoosterTab(sessies) {
  _roosterSessies = sessies;
  const wrap      = document.getElementById('rooster-outer');
  const controls  = document.getElementById('rooster-veld-toggle').closest('.rooster-controls');

  // ── Seizoenselector (eenmalig aanmaken) ──────────────────────────
  if (!document.getElementById('seizoen-bar')) {
    const seizoenBar = document.createElement('div');
    seizoenBar.id = 'seizoen-bar';
    seizoenBar.style.cssText = 'padding:6px 0 4px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e8e8e8;margin-bottom:4px';
    seizoenBar.innerHTML = `
      <span style="font-size:12px;font-weight:600;color:#666">Seizoen:</span>
      <select id="seizoen-select"
              style="font-size:13px;padding:3px 8px;border-radius:4px;border:1px solid #ccc;color:#1A252F"></select>`;
    controls.parentElement.insertBefore(seizoenBar, controls);

    document.getElementById('seizoen-select').addEventListener('change', async e => {
      await loadSeasonRoster(e.target.value);
    });
  }
  _refreshSeizoensDropdown();

  // ── Save bar (eenmalig aanmaken) ─────────────────────────────────
  if (!document.getElementById('rooster-save-bar')) {
    const saveBar = document.createElement('div');
    saveBar.id    = 'rooster-save-bar';
    saveBar.style.cssText = 'padding:4px 0 6px;display:flex;gap:10px;align-items:center';
    saveBar.innerHTML = `
      <button id="btn-rooster-undo" title="Ctrl+Z" disabled
              style="padding:5px 12px;font-size:12px;border:1px solid #ccc;border-radius:4px;background:#f5f5f5;cursor:pointer;color:#555">↩ Ongedaan</button>
      <button id="btn-rooster-export"
              style="padding:5px 12px;font-size:12px;border:1px solid #ccc;border-radius:4px;background:#f5f5f5;cursor:pointer;color:#555">↓ Excel</button>
      <button id="btn-rooster-save" class="btn-primary" style="display:none">Wijziging opslaan</button>
      <span id="rooster-save-status" style="font-size:12px;color:#555"></span>`;
    controls.parentElement.insertBefore(saveBar, controls.nextSibling);

    document.getElementById('btn-rooster-save').addEventListener('click', async () => {
      const btn    = document.getElementById('btn-rooster-save');
      const status = document.getElementById('rooster-save-status');
      btn.disabled = true;
      status.textContent = 'Opslaan…';
      try {
        const payload = _roosterSessies.map(({ _modified, ...s }) => s);
        const res = await fetch(`/api/seasons/${_huidigSeizoen}/roster/save`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ sessies: payload }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        status.textContent = '✓ Opgeslagen';
        btn.style.display = 'none';
        _roosterSessies.forEach(s => delete s._modified);
        _undoStack = [];
        document.getElementById('btn-rooster-undo').disabled = true;
      } catch (err) {
        status.textContent = '✗ Opslaan mislukt — ' + err.message;
        btn.disabled = false;
      }
    });
  }

  function activeVeld() {
    return document.querySelector('#rooster-veld-toggle .veld-btn.active')?.dataset.veld || '';
  }

  function rerender() {
    wrap.innerHTML = renderRoosterTabel(_roosterSessies, activeVeld());
    setupRoosterDrag(_roosterSessies, wrap, markChanged);
  }

  function markChanged() {
    document.getElementById('btn-rooster-save').style.display = '';
    document.getElementById('rooster-save-status').textContent = 'Wijzigingen niet opgeslagen';
    document.getElementById('btn-rooster-undo').disabled = _undoStack.length === 0;
    rerender();
    window._refreshTeamsRender?.();
  }

  // ── Undo logica ──────────────────────────────────────────────────
  function doUndo() {
    if (_undoStack.length === 0) return;
    const snapshot = _undoStack.pop();
    _roosterSessies.forEach((s, i) => {
      if (!snapshot[i]) return;
      s.dag      = snapshot[i].dag;
      s.start    = snapshot[i].start;
      s.eind     = snapshot[i].eind;
      s.veld     = snapshot[i].veld;
      s.subveld  = snapshot[i].subveld;
      s._modified = snapshot[i]._modified;
    });
    const hasModified = _roosterSessies.some(s => s._modified);
    document.getElementById('btn-rooster-save').style.display = hasModified ? '' : 'none';
    document.getElementById('rooster-save-status').textContent = hasModified ? 'Wijzigingen niet opgeslagen' : '';
    document.getElementById('btn-rooster-undo').disabled = _undoStack.length === 0;
    rerender();
    window._refreshTeamsRender?.();
  }

  document.getElementById('btn-rooster-undo').addEventListener('click', doUndo);

  document.getElementById('btn-rooster-export').addEventListener('click', () => {
    window.location = `/api/seasons/${_huidigSeizoen}/export-excel`;
  });

  if (!window._undoKeyBound) {
    window._undoKeyBound = true;
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      }
    });
  }

  // ── Veld-toggle (eenmalig binden) ────────────────────────────────
  const toggle = document.getElementById('rooster-veld-toggle');
  if (!toggle._initDone) {
    toggle._initDone = true;
    toggle.querySelectorAll('.veld-btn').forEach(b => b.classList.remove('active'));
    const defaultBtn = toggle.querySelector('[data-veld="Veld 6"]');
    if (defaultBtn) defaultBtn.classList.add('active');

    toggle.addEventListener('click', e => {
      const btn = e.target.closest('.veld-btn');
      if (!btn) return;
      toggle.querySelectorAll('.veld-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rerender();
    });
  }

  // Bij seizoenswisseling: undo stack resetten + herrender
  window._updateRoosterSessies = newSessies => {
    _roosterSessies = newSessies;
    _undoStack = [];
    document.getElementById('btn-rooster-save').style.display = 'none';
    document.getElementById('rooster-save-status').textContent = '';
    document.getElementById('btn-rooster-undo').disabled = true;
    rerender();
    window._refreshTeamsRender?.();
  };

  rerender();
}

// ── Teams tab ─────────────────────────────────────────────────────
let teamsData  = [];           // alle teams (incl. inactief) van /api/teams
let _teamPrefs = {};           // voorkeurs-instellingen per team_id
let rosterSessies = [];       // ingeplande sessies van /api/roster
let herplanNodig = false;

async function laadTeams() {
  const resp = await fetch('/api/teams?t=' + Date.now());
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(json.error);
  teamsData = json.teams || [];
}

function initTeamsTab(sessies) {
  rosterSessies = sessies;

  // ── Seizoensbalk (eenmalig) ───────────────────────────────────────
  const banner = document.getElementById('teams-herplan-banner');
  if (!document.getElementById('seizoen-bar-teams')) {
    const bar = document.createElement('div');
    bar.id = 'seizoen-bar-teams';
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap';
    bar.innerHTML = `
      <label style="font-size:13px;color:#555;font-weight:600">Seizoen:</label>
      <select id="seizoen-select-teams"
              style="font-size:13px;padding:4px 8px;border:1px solid #ccc;border-radius:4px;cursor:pointer"></select>
      <button id="btn-verwijder-seizoen"
              style="font-size:12px;padding:4px 10px;border:1px solid #e55;border-radius:4px;
                     background:#fff;color:#c33;cursor:pointer">Verwijder seizoen</button>`;
    banner.parentElement.insertBefore(bar, banner);

    document.getElementById('seizoen-select-teams').addEventListener('change', function () {
      loadSeasonRoster(this.value);
    });

    document.getElementById('btn-verwijder-seizoen').addEventListener('click', async () => {
      const selEl = document.getElementById('seizoen-select-teams');
      const label = selEl.options[selEl.selectedIndex]?.text || _huidigSeizoen;
      if (!confirm(`Seizoen "${label}" definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;

      const res  = await fetch(`/api/seasons/${_huidigSeizoen}/delete`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) { alert('Fout: ' + (json.detail || 'onbekend')); return; }

      const r2        = await fetch('/api/seasons');
      const d2        = await r2.json();
      const remaining = (d2.seasons || []).sort((a, b) => a.slug.localeCompare(b.slug));
      if (remaining.length > 0) {
        await loadSeasonRoster(remaining[0].slug);
      } else {
        _roosterSessies = [];
        window._updateRoosterSessies?.([]);
        initTeamsTab([]);
      }
      showToast(`Seizoen "${label}" verwijderd`);
    });

    _refreshSeizoensDropdown();
  }

  // ── "Nieuw seizoen aanmaken" knop (eenmalig) ─────────────────────
  if (!document.getElementById('btn-nieuw-seizoen')) {
    const btn = document.createElement('button');
    btn.id = 'btn-nieuw-seizoen';
    btn.className = 'btn-primary';
    btn.style.cssText = 'margin-bottom:12px;font-size:13px';
    btn.textContent = '+ Nieuw seizoen aanmaken';
    btn.addEventListener('click', () => openNieuwSeizoenModal());
    banner.parentElement.insertBefore(btn, banner);
  }

  // Bouw sessie-index per team_id
  const sessieMap = {};
  for (const s of sessies) {
    if (!sessieMap[s.team_id]) sessieMap[s.team_id] = [];
    sessieMap[s.team_id].push(s);
  }

  // Categorieën voor filter
  const cats = [...new Set(teamsData.map(t => t.categorie).filter(Boolean))].sort();
  const catSel = document.getElementById('teams-cat-select');
  catSel.innerHTML = '<option value="">Alle categorieën</option>' +
    cats.map(c => `<option value="${c}">${c}</option>`).join('');

  function render() {
    const catFilter    = catSel.value;
    const statusFilter = document.getElementById('teams-status-select').value;
    const zoek         = document.getElementById('teams-zoek').value.toLowerCase();

    const filtered = teamsData.filter(t => {
      if (catFilter && t.categorie !== catFilter) return false;
      if (statusFilter === 'actief'   && !t.actief) return false;
      if (statusFilter === 'inactief' &&  t.actief) return false;
      if (zoek && !t.team_id.toLowerCase().includes(zoek) &&
                  !t.team_naam.toLowerCase().includes(zoek)) return false;
      return true;
    });

    const tbody = qs('#teams-tabel tbody');
    tbody.innerHTML = filtered.map(team => {
      const sessies = sessieMap[team.team_id] || [];
      const trClass = team.actief ? '' : 'inactief';

      let trainingHTML;
      if (!team.actief) {
        trainingHTML = '<span class="training-pill niet">Inactief</span>';
      } else if (sessies.length > 0) {
        trainingHTML = '<div class="training-slots">' +
          sessies.map(s =>
            `<span class="training-pill">${DAG_LABELS[s.dag]} ${s.start}–${s.eind} · ${s.veld}</span>`
          ).join('') + '</div>';
      } else {
        trainingHTML = '<span class="training-pill niet">Niet ingepland</span>';
      }

      const checked  = team.actief ? 'checked' : '';
      const labelTxt = team.actief ? 'Actief' : 'Inactief';
      const labelCls = team.actief ? 'on' : 'off';

      const pref            = _teamPrefs[team.team_id] || {};
      const prefDag         = pref.voorkeur_dag  || '';
      const prefTijd        = pref.voorkeur_tijd || '';
      const nietBeschikbaar = pref.niet_beschikbaar || [];
      const dagOpties       = ['MA','DI','WO','DO','VR'];
      const tijdOpties      = [];
      for (let h = 16; h <= 22; h++) {
        tijdOpties.push(`${String(h).padStart(2,'0')}:00`);
        if (h < 22) tijdOpties.push(`${String(h).padStart(2,'0')}:30`);
      }
      const dagSelHTML = `<select class="pref-dag" style="font-size:12px;padding:3px 6px;border:1px solid #ccc;border-radius:4px">
        <option value="">Geen voorkeur</option>
        ${dagOpties.map(d => `<option value="${d}"${prefDag===d?' selected':''}>${d}</option>`).join('')}
      </select>`;
      const tijdSelHTML = `<select class="pref-tijd" style="font-size:12px;padding:3px 6px;border:1px solid #ccc;border-radius:4px">
        <option value="">Geen voorkeur</option>
        ${tijdOpties.map(t => `<option value="${t}"${prefTijd===t?' selected':''}>${t}</option>`).join('')}
      </select>`;
      const cbHTML = dagOpties.map(d =>
        `<label style="font-size:12px;display:inline-flex;align-items:center;gap:3px;margin-right:8px">
          <input type="checkbox" class="pref-niet" value="${d}"${nietBeschikbaar.includes(d)?' checked':''}> ${d}
        </label>`).join('');

      return `<tr class="${trClass}" data-team-id="${escHtml(team.team_id)}">
        <td><strong>${escHtml(team.team_id)}</strong><br>
            <small style="color:#999">${escHtml(team.team_naam)}</small></td>
        <td>${escHtml(team.categorie)}</td>
        <td>${trainingHTML}</td>
        <td>
          <div class="toggle-wrap">
            <label class="toggle">
              <input type="checkbox" ${checked} data-team="${escHtml(team.team_id)}">
              <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label ${labelCls}">${labelTxt}</span>
          </div>
          <button class="btn-pref-toggle" data-team="${escHtml(team.team_id)}"
            style="margin-top:5px;font-size:11px;padding:2px 8px;border:1px solid #ccc;border-radius:4px;background:#f9f9f9;cursor:pointer;color:#555">⚙ Voorkeur</button>
        </td>
      </tr>
      <tr class="pref-row" data-pref-for="${escHtml(team.team_id)}" style="display:none;background:#f5f7fa">
        <td colspan="4" style="padding:12px 16px">
          <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end">
            <div>
              <label style="font-size:11px;color:#888;display:block;margin-bottom:3px">Voorkeurs&shy;dag</label>
              ${dagSelHTML}
            </div>
            <div>
              <label style="font-size:11px;color:#888;display:block;margin-bottom:3px">Voorkeurs&shy;tijdstip</label>
              ${tijdSelHTML}
            </div>
            <div>
              <label style="font-size:11px;color:#888;display:block;margin-bottom:4px">Niet beschikbaar</label>
              <div>${cbHTML}</div>
            </div>
            <button class="btn-pref-save btn-primary" data-team="${escHtml(team.team_id)}"
              style="font-size:12px;padding:5px 14px;align-self:flex-end">Opslaan</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    // Toggle event listeners
    tbody.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => toggleTeam(cb));
    });

    // ⚙ Voorkeur toggle
    tbody.querySelectorAll('.btn-pref-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const teamId = btn.dataset.team;
        const row = tbody.querySelector(`tr[data-pref-for="${CSS.escape(teamId)}"]`);
        if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
      });
    });

    // Voorkeur opslaan
    tbody.querySelectorAll('.btn-pref-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const teamId  = btn.dataset.team;
        const prefRow = tbody.querySelector(`tr[data-pref-for="${CSS.escape(teamId)}"]`);
        const dag     = prefRow.querySelector('.pref-dag').value;
        const tijd    = prefRow.querySelector('.pref-tijd').value;
        const niet    = [...prefRow.querySelectorAll('.pref-niet:checked')].map(c => c.value);

        btn.disabled = true;
        try {
          const res = await fetch('/api/team-preferences', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ team_id: teamId, voorkeur_dag: dag, voorkeur_tijd: tijd, niet_beschikbaar: niet }),
          });
          const j = await res.json();
          if (j.ok) {
            _teamPrefs[teamId] = { voorkeur_dag: dag, voorkeur_tijd: tijd, niet_beschikbaar: niet };
            showToast(`Voorkeur opgeslagen voor ${teamId}`, 'green');
          } else {
            showToast('Fout bij opslaan: ' + (j.detail || 'onbekend'), 'red');
          }
        } catch (e) {
          showToast('Verbindingsfout: ' + e.message, 'red');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  ['teams-cat-select', 'teams-status-select'].forEach(id =>
    document.getElementById(id).addEventListener('change', render)
  );
  document.getElementById('teams-zoek').addEventListener('input', render);
  window._refreshTeamsRender = render;
  render();
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function toggleTeam(checkbox) {
  const teamId = checkbox.dataset.team;
  const actief  = checkbox.checked;

  // Optimistisch: label direct bijwerken
  const row = checkbox.closest('tr');
  const label = row.querySelector('.toggle-label');
  label.textContent = actief ? 'Actief' : 'Inactief';
  label.className = 'toggle-label ' + (actief ? 'on' : 'off');
  row.className = actief ? '' : 'inactief';
  checkbox.disabled = true;

  try {
    const resp = await fetch('/api/teams/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, actief }),
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Onbekende fout');

    // Update lokale data
    const team = teamsData.find(t => t.team_id === teamId);
    if (team) team.actief = actief;

    // Toon herplan-banner
    if (!herplanNodig) {
      herplanNodig = true;
      document.getElementById('teams-herplan-banner').style.display = 'block';
    }
    showToast(`${teamId} ${actief ? 'geactiveerd' : 'gedeactiveerd'}`, actief ? 'green' : '');
  } catch (e) {
    // Terugdraaien bij fout
    checkbox.checked = !actief;
    const label2 = row.querySelector('.toggle-label');
    label2.textContent = !actief ? 'Actief' : 'Inactief';
    label2.className = 'toggle-label ' + (!actief ? 'on' : 'off');
    row.className = !actief ? '' : 'inactief';
    showToast('Fout: ' + e.message, 'red');
  } finally {
    checkbox.disabled = false;
  }
}

// ── Logica tab ────────────────────────────────────────────────────
const PRIO_LABELS = {
  bijzonder:          'Bijzonder',
  onderbouw:          'Onderbouw',
  middenbouw:         'Middenbouw',
  'senioren-selectie':'Senioren-selectie',
  bovenbouw:          'Bovenbouw',
  senioren:           'Senioren',
};
const PRIO_CHIP_COLORS = {
  bijzonder:          '#8E44AD',
  onderbouw:          '#2980B9',
  middenbouw:         '#27AE60',
  'senioren-selectie':'#E67E22',
  bovenbouw:          '#D4AC0D',
  senioren:           '#C0392B',
};

function renderLogicaTab(catRegels) {
  const tbody = document.getElementById('logica-cat-tbody');
  if (!tbody) return;
  if (!catRegels || !Object.keys(catRegels).length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Geen categorieregels beschikbaar (vereist roster_export.json met categorie_regels)</td></tr>';
    return;
  }
  const prio_volgorde = ['bijzonder','onderbouw','middenbouw','senioren-selectie','bovenbouw','senioren'];
  const gesorteerd = Object.entries(catRegels).sort(([,a],[,b]) => {
    const ai = prio_volgorde.indexOf(a.prioriteit ?? '');
    const bi = prio_volgorde.indexOf(b.prioriteit ?? '');
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const PRIO_OPTIES = ['bijzonder','onderbouw','middenbouw','senioren-selectie','bovenbouw','senioren'];
  tbody.innerHTML = gesorteerd.map(([cat, r]) => {
    const prioSel = PRIO_OPTIES.map(p =>
      `<option value="${p}"${r.prioriteit === p ? ' selected' : ''}>${PRIO_LABELS[p] || p}</option>`
    ).join('');
    return `<tr data-cat="${escHtml(cat)}">
      <td><strong>${escHtml(cat)}</strong></td>
      <td>
        <select class="lc-prio"
          style="font-size:12px;padding:3px 5px;border:1px solid #ccc;border-radius:4px;max-width:130px">
          ${prioSel}
        </select>
      </td>
      <td style="text-align:center">${r.sessies ?? '—'}</td>
      <td style="text-align:center;white-space:nowrap">
        <input type="number" class="lc-duur" min="15" max="180" step="15"
          value="${r.duur_min ?? 60}"
          style="width:58px;text-align:center;padding:3px 4px;border:1px solid #ccc;border-radius:4px;font-size:12px"> min
      </td>
      <td style="text-align:center">${r.veldgebruik != null ? r.veldgebruik.toFixed(2) : '—'}</td>
      <td style="text-align:center;white-space:nowrap">
        <input type="time" class="lc-van" value="${escHtml(r.tijd_van || '16:00')}"
          style="padding:2px 4px;border:1px solid #ccc;border-radius:4px;font-size:12px">
        –
        <input type="time" class="lc-tot" value="${escHtml(r.tijd_tot || '22:30')}"
          style="padding:2px 4px;border:1px solid #ccc;border-radius:4px;font-size:12px">
      </td>
      <td>
        <button class="lc-save btn-primary" data-cat="${escHtml(cat)}"
          style="font-size:11px;padding:3px 10px;white-space:nowrap">Opslaan</button>
      </td>
    </tr>`;
  }).join('');

  tbody.addEventListener('click', async e => {
    const btn = e.target.closest('.lc-save');
    if (!btn) return;
    const row     = btn.closest('tr');
    const cat     = btn.dataset.cat;
    const prio    = row.querySelector('.lc-prio').value;
    const duur    = parseInt(row.querySelector('.lc-duur').value);
    const tijdVan = row.querySelector('.lc-van').value;
    const tijdTot = row.querySelector('.lc-tot').value;
    btn.disabled = true;
    try {
      const res = await fetch('/api/logica-regels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cat, prioriteit: prio, duur_min: duur, tijd_van: tijdVan, tijd_tot: tijdTot }),
      });
      const j = await res.json();
      if (j.ok) showToast(`Regel opgeslagen voor ${cat}. Klik ↻ Herplan om toe te passen.`, 'green');
      else showToast('Fout: ' + (j.detail || 'onbekend'), 'red');
    } catch (err) {
      showToast('Verbindingsfout: ' + err.message, 'red');
    } finally {
      btn.disabled = false;
    }
  }, { once: false });
}

// ── Load and render all data ──────────────────────────────────────
async function loadAndRender() {
  try {
    const [rosterResp, teamsResp, prefsResp, logicaResp] = await Promise.all([
      fetch('/api/roster?t=' + Date.now()),
      fetch('/api/teams?t=' + Date.now()),
      fetch('/api/team-preferences?t=' + Date.now()),
      fetch('/api/logica-regels?t=' + Date.now()),
    ]);

    if (!rosterResp.ok) throw new Error(`Roster HTTP ${rosterResp.status}`);
    const data = await rosterResp.json();
    const grid = buildGrid(data.sessies || []);

    if (teamsResp.ok) {
      const tj = await teamsResp.json();
      teamsData = tj.teams || [];
    }
    if (prefsResp.ok) {
      _teamPrefs = await prefsResp.json();
    }

    // Standaardseizoen instellen bij initiële lading
    _huidigSeizoen = '2025_2026';

    // Reset herplan banner on fresh load
    herplanNodig = false;
    const banner = document.getElementById('teams-herplan-banner');
    if (banner) banner.style.display = 'none';

    const ts = data.generated_at
      ? new Date(data.generated_at).toLocaleString('nl-NL')
      : '—';
    document.getElementById('last-update').textContent = `Gegenereerd: ${ts}`;

    renderDashboard(data, grid);
    initHeatmap(grid);
    renderNietIngepland(data, grid);
    initRoosterTab(data.sessies || []);
    initCategorieTab(data);
    initVrijeSlotsTab(data, grid);
    renderCriteriaCheck(data);
    initTeamsTab(data.sessies || []);
    const logicaRegels = logicaResp.ok ? await logicaResp.json() : (data.categorie_regels || {});
    renderLogicaTab(logicaRegels);

    return { data, grid };
  } catch (e) {
    showToast('Fout bij laden: ' + e.message, 'red');
    document.getElementById('kpi-row').innerHTML =
      `<div class="kpi-card danger">
         <div class="kpi-val">!</div>
         <div class="kpi-label">Roosterdata niet beschikbaar. Start de server opnieuw.</div>
       </div>`;
    throw e;
  }
}

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();

  // Refresh button
  document.getElementById('btn-refresh').addEventListener('click', async function () {
    this.disabled  = true;
    this.textContent = '↻ Bezig…';
    showToast('Rooster wordt opnieuw gegenereerd…');
    try {
      const r = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seizoen: _huidigSeizoen }),
      });
      const j = await r.json();
      if (j.ok) {
        showToast('Rooster bijgewerkt!', 'green');
        await loadAndRender();
      } else {
        showToast('Fout bij herplannen: ' + (j.error || 'onbekend'), 'red');
        console.error(j);
      }
    } catch (e) {
      showToast('Verbindingsfout: ' + e.message, 'red');
    } finally {
      this.disabled  = false;
      this.textContent = '↻ Herplan';
    }
  });

  // Initial load
  loadAndRender().catch(console.error);
});
