const KEY = 'lfa';
const DRAFT = 'lfa_draft';
const $ = (s) => document.querySelector(s);

let rows = [];          // brouillon des sorties
let slugTouched = {};   // lignes dont la fin de lien a été modifiée à la main

// ---------- Outils ----------
function splitArtists(t) {
  return (t || '').split(/\s*(?:,|;|&|\/|\b(?:feat|ft)\b\.?|\s[xX]\s)\s*/i).map(a => a.trim()).filter(Boolean);
}

function cap(word) { return word ? word[0].toUpperCase() + word.slice(1) : ''; }

// lettres que la décomposition Unicode ne simplifie pas (ø de døpelym, etc.)
const TRANSLIT = { 'ø': 'o', 'Ø': 'O', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ß': 'ss', 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L', 'þ': 'th', 'ð': 'd', '$': 's', '&': 'x' };
function slugPart(t) {
  return (t || '')
    .replace(/[øØæÆœŒßđĐłŁþð$]/g, c => TRANSLIT[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean).map(cap).join('_');
}

// Sous-domaine : artistes collés et reliés par « x » → THBxOGMahilet
function makeSubdomain(artists) {
  return splitArtists(artists).map(n => slugPart(n).replace(/_/g, '')).join('x');
}

// Fin du lien : le titre seul, en minuscules → die, pourquoi_tu_mas_blesse
// Linkfire exige au moins 3 caractères : un titre court (« Go ») devient go_artiste
function makeSlug(title, artists) {
  let s = slugPart(title).toLowerCase();
  if (s.length < 3) {
    const a = splitArtists(artists || '').map(n => slugPart(n).replace(/_/g, '').toLowerCase())[0] || 'link';
    s = s ? s + '_' + a : a;
  }
  while (s.length < 3) s += '_';
  return s;
}

// Remplit automatiquement ce qui n'a pas été modifié à la main
function autoFill(r) {
  if (!slugTouched[r.id + ':sub']) r.subdomain = makeSubdomain(r.artists);
  if (!slugTouched[r.id]) r.slug = makeSlug(r.title, r.artists);
}

function parseDate(t) {
  t = (t || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return '';
}

function newRow(v = {}) {
  return { id: Math.random().toString(36).slice(2), artists: '', title: '', upc: '', date: '', subdomain: '', slug: '', cover: '', coverName: '', ...v };
}

const settings = () => ({
  mode: document.querySelector('input[name=mode]:checked').value,
  time: $('#time').value,
  sepWin: $('#sepWin').checked,
  tagArtist: false
});

function saveDraft() {
  chrome.storage.local.set({ [DRAFT]: { rows, slugTouched, settings: settings() } });
}

// ---------- Rendu des lignes ----------
function renderRows() {
  const box = $('#rows');
  box.innerHTML = '';
  rows.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'rel';
    el.innerHTML = `
      <div class="n">#${i + 1}</div>
      <button class="del" title="Supprimer">×</button>
      <div class="grid2">
        <label class="full">Artiste(s) <small>(principal en 1er, puis les feats, séparés par virgule)</small><input data-f="artists" value=""></label>
        <label class="full">Titre<input data-f="title" value=""></label>
        <label>UPC<input data-f="upc" inputmode="numeric" value=""></label>
        <label>Date de sortie<input data-f="date" type="date" value=""></label>
        <label class="full">Lien<span class="linkrow"><input data-f="subdomain" class="slug" value=""><span class="dom">.lnk.to/</span><input data-f="slug" class="slug" value=""></span></label>
      </div>
      <div class="cover">
        ${r.cover ? `<img src="${r.cover}">` : ''}
        <label class="pick ghost" style="border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;padding:4px 8px">${r.cover ? 'Changer la cover' : 'Ajouter une cover'}<input type="file" accept="image/*"></label>
        ${r.cover ? '<button class="rmc ghost" style="margin:0;padding:4px 8px">Retirer</button>' : '<span>facultatif</span>'}
      </div>`;
    for (const inp of el.querySelectorAll('input[data-f]')) {
      const f = inp.dataset.f;
      inp.value = r[f] || '';
      inp.addEventListener('input', () => {
        r[f] = inp.value;
        if (f === 'slug') slugTouched[r.id] = true;
        if (f === 'subdomain') slugTouched[r.id + ':sub'] = true;
        if (f === 'artists' || f === 'title') {
          autoFill(r);
          el.querySelector('input[data-f=slug]').value = r.slug;
          el.querySelector('input[data-f=subdomain]').value = r.subdomain;
        }
        saveDraft();
      });
    }
    el.querySelector('.del').addEventListener('click', () => { rows.splice(i, 1); saveDraft(); renderRows(); });
    el.querySelector('input[type=file]').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => { r.cover = rd.result; r.coverName = file.name; saveDraft(); renderRows(); };
      rd.readAsDataURL(file);
    });
    const rmc = el.querySelector('.rmc');
    if (rmc) rmc.addEventListener('click', () => { r.cover = ''; r.coverName = ''; saveDraft(); renderRows(); });
    box.appendChild(el);
  });
}

// ---------- Import (fichier Excel/CSV ou copier-coller) ----------
function addRecords(recs) {
  let added = 0;
  for (const c of recs) {
    if (!c.artists && !c.title) continue;
    const r = newRow({ artists: c.artists || '', title: c.title || '', upc: (c.upc || '').replace(/\D/g, ''), date: c.date || '', cover: c.cover || '', coverName: c.coverName || '' });
    autoFill(r);
    if (rows.length === 1 && !rows[0].artists && !rows[0].title) rows = []; // remplacer la ligne vide de départ
    rows.push(r);
    added++;
  }
  saveDraft();
  renderRows();
  return added;
}

$('#importBtn').addEventListener('click', () => {
  const lines = $('#paste').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const recs = [];
  for (const line of lines) {
    const c = line.split(/\t|\s*\|\s*|\s*;\s*/);
    if (c.length < 2) continue;
    if (/artist/i.test(c[0]) && /titre|title/i.test(c[1] || '')) continue; // ligne d'en-tête
    recs.push({ artists: c[0], title: c[1], upc: c[2] || '', date: parseDate(c[3] || '') });
  }
  const added = addRecords(recs);
  $('#paste').value = '';
  $('#formMsg').textContent = added ? '' : 'Aucune ligne reconnue. Vérifie l’ordre des colonnes.';
});

function isoFromCell(v) {
  if (v instanceof Date && !isNaN(v)) {
    const d = new Date(v.getTime() + 6 * 3600e3); // évite les décalages d'un jour liés aux fuseaux
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    const p = XLSX.SSF.parse_date_code(v);
    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }
  return parseDate(String(v || ''));
}

function upcFromCell(raw, txt) {
  let s = typeof raw === 'number'
    ? Math.round(raw).toLocaleString('fullwide', { useGrouping: false })
    : String(txt != null && txt !== '' ? txt : raw || '');
  s = s.replace(/\D/g, '');
  // Excel supprime les zéros du début quand l'UPC est saisi comme un nombre
  if (typeof raw === 'number' && s.length === 12) s = '00' + s;
  if (typeof raw === 'number' && s.length === 13) s = '0' + s;
  return s;
}

$('#xlsFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const txt = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    // repérer la ligne d'en-tête et les colonnes
    let col = { artists: 0, title: 1, upc: 2, date: 3 }, start = 0;
    const hi = raw.findIndex(r => r.some(c => /artist/i.test(c)) && r.some(c => /titre|title/i.test(c)));
    if (hi >= 0) {
      const h = raw[hi].map(c => String(c).toLowerCase());
      const find = (re, d) => { const i = h.findIndex(c => re.test(c)); return i >= 0 ? i : d; };
      col = {
        artists: find(/artist/, 0),
        title: find(/titre|title|track/, 1),
        upc: find(/upc|ean|barcode|code/, 2),
        date: find(/date|sortie|release/, 3)
      };
      start = hi + 1;
    }
    const recs = [];
    for (let i = start; i < raw.length; i++) {
      const r = raw[i], t = txt[i] || [];
      recs.push({
        artists: String(r[col.artists] || '').trim(),
        title: String(t[col.title] || r[col.title] || '').trim(),
        upc: upcFromCell(r[col.upc], t[col.upc]),
        date: isoFromCell(r[col.date])
      });
    }
    const added = addRecords(recs);
    $('#formMsg').textContent = added ? '' : 'Aucune sortie trouvée dans ce fichier.';
    if (added) { $('#formMsg').style.color = '#059669'; $('#formMsg').textContent = `${added} sortie(s) importée(s). Vérifie-les puis lance.`; setTimeout(() => { $('#formMsg').textContent = ''; $('#formMsg').style.color = ''; }, 5000); }
  } catch (err) {
    $('#formMsg').textContent = 'Impossible de lire ce fichier : ' + err.message;
  }
  e.target.value = '';
});

$('#addRow').addEventListener('click', () => { rows.push(newRow()); saveDraft(); renderRows(); });

document.querySelectorAll('input[name=mode], #time, #sepWin').forEach(i => i.addEventListener('change', saveDraft));

// ---------- Lancement ----------
function validate() {
  const errs = [];
  rows.forEach((r, i) => {
    const n = `#${i + 1}`;
    if (!splitArtists(r.artists).length) errs.push(`${n} : artiste manquant`);
    if (!r.title.trim()) errs.push(`${n} : titre manquant`);
    if (!/^\d{12,14}$/.test((r.upc || '').trim())) errs.push(`${n} : UPC invalide (12 à 14 chiffres)`);
    if (!r.date) errs.push(`${n} : date de sortie manquante`);
    if (r.slug.trim().length < 3) errs.push(`${n} : fin du lien trop courte (3 caractères minimum)`);
    if (/[^A-Za-z0-9_\-]/.test(r.slug.trim())) errs.push(`${n} : fin du lien avec caractères interdits (lettres, chiffres, _ et - seulement)`);
    if (!(r.subdomain || '').trim()) errs.push(`${n} : sous-domaine vide`);
  });
  if (!rows.length) errs.push('Ajoute au moins une sortie.');
  return errs;
}

$('#startBtn').addEventListener('click', async () => {
  const cur = (await chrome.storage.local.get(KEY))[KEY];
  if (cur && cur.running) { $('#formMsg').textContent = 'Une série est déjà en cours. Arrête-la d’abord.'; return; }
  const errs = validate();
  if (errs.length) { $('#formMsg').textContent = errs.join(' · '); return; }
  $('#formMsg').textContent = '';
  const st = settings();
  const queue = rows.map(r => ({
    id: r.id,
    artists: splitArtists(r.artists),
    title: r.title.trim(),
    upc: r.upc.trim(),
    date: r.date,
    time: st.time || '',
    subdomain: (r.subdomain || '').trim(),
    slug: r.slug.trim(),
    tags: [],
    cover: r.cover || '',
    coverName: r.coverName || '',
    status: 'todo', link: '', error: ''
  }));
  const state = {
    running: true, paused: false, mode: st.mode, stepApproved: false,
    queue, current: 0, step: 'start', homeUrl: cur && cur.homeUrl || '',
    log: ['Démarrage : ' + queue.length + ' lien(s)']
  };
  await chrome.storage.local.set({ [KEY]: state });
  chrome.runtime.sendMessage({ type: 'ensureLinkfireTab', reload: true, separateWindow: $('#sepWin').checked });
});

$('#stopBtn').addEventListener('click', async () => {
  const s = (await chrome.storage.local.get(KEY))[KEY];
  if (!s) return;
  s.running = false; s.paused = false;
  await chrome.storage.local.set({ [KEY]: s });
});

// ---------- Résultats ----------
const LABEL = { todo: 'à faire', running: 'en cours', done: 'fait', error: 'erreur', skipped: 'passé' };

function renderState(s) {
  const res = $('#results');
  res.innerHTML = '';
  if (!s) { $('#status').textContent = 'Rien en cours.'; return; }
  const done = s.queue.filter(j => j.status === 'done').length;
  $('#status').textContent = s.running
    ? (s.paused ? `En pause (${done}/${s.queue.length}) — regarde le bandeau en bas à gauche de Linkfire` : `En cours… ${done}/${s.queue.length}`)
    : `Terminé : ${done}/${s.queue.length} lien(s) créé(s)`;
  $('#startBtn').disabled = !!s.running;
  s.queue.forEach((j, i) => {
    let status = j.status;
    if (s.running && s.paused && i === s.current && s.pauseKind === 'error') status = 'error';
    const d = document.createElement('div');
    d.className = 'res';
    d.innerHTML = `<div class="l">
        <div><span class="b ${status}">${LABEL[status] || status}</span><b></b></div>
        ${j.link ? `<a href="${j.link}" target="_blank"></a>` : ''}
        ${status === 'error' && j.error ? `<div class="err"></div>` : ''}
      </div>
      ${j.link ? '<button>Copier</button>' : ''}`;
    d.querySelector('b').textContent = j.artists.join(', ') + ' — ' + j.title;
    if (j.link) d.querySelector('a').textContent = j.link.replace(/^https:\/\//, '');
    const er = d.querySelector('.err'); if (er) er.textContent = j.error;
    const b = d.querySelector('button');
    if (b) b.addEventListener('click', () => { navigator.clipboard.writeText(j.link); b.textContent = 'Copié ✓'; });
    res.appendChild(d);
  });
  $('#log').textContent = (s.log || []).slice().reverse().join('\n');
}

$('#copyAll').addEventListener('click', async () => {
  const s = (await chrome.storage.local.get(KEY))[KEY];
  if (!s) return;
  const txt = s.queue.filter(j => j.link).map(j => `${j.artists.join(', ')} – ${j.title} : ${j.link}`).join('\n');
  await navigator.clipboard.writeText(txt);
  $('#copyAll').textContent = 'Copié ✓';
  setTimeout(() => { $('#copyAll').textContent = 'Copier tous les liens'; }, 1500);
});

$('#csvBtn').addEventListener('click', async () => {
  const s = (await chrome.storage.local.get(KEY))[KEY];
  if (!s) return;
  const q = (v) => '"' + String(v || '').replace(/"/g, '""') + '"';
  const lines = [['Artiste', 'Titre', 'UPC', 'Date de sortie', 'Lien', 'Statut'].join(';')]
    .concat(s.queue.map(j => [q(j.artists.join(', ')), q(j.title), q(j.upc), q(j.date), q(j.link), q(LABEL[j.status])].join(';')));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'liens-linkfire-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
});

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch[KEY]) renderState(ch[KEY].newValue);
});

// ---------- Chargement ----------
(async () => {
  const d = await chrome.storage.local.get([DRAFT, KEY]);
  const draft = d[DRAFT];
  if (draft) {
    rows = draft.rows || [];
    slugTouched = draft.slugTouched || {};
    const st = draft.settings || {};
    if (st.mode) document.querySelector(`input[name=mode][value=${st.mode}]`).checked = true;
    if (st.time) $('#time').value = st.time;
    if (st.sepWin === false) $('#sepWin').checked = false;
  }
  if (!rows.length) rows = [newRow()];
  // recalculer les fins de lien non modifiées à la main (nouveau format)
  rows.forEach(autoFill);
  renderRows();
  renderState(d[KEY]);
})();

// ---------- Scan RWS ----------
function scanMsg(t, ok) {
  const el = $('#scanMsg');
  el.style.color = ok ? '#059669' : '';
  el.textContent = t;
}

async function scanTabs(tabs) {
  const recs = [], problems = [], noCover = [], smallCover = [];
  for (const tab of tabs) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: lfaScanRwsPage });
      const d = res && res.result;
      if (d && d.ok) {
        let cover = d.cover || '';
        // l'image vient d'un autre site : le panneau la récupère lui-même
        if (!cover && d.coverUrl) {
          try {
            const res = await fetch(d.coverUrl, { credentials: 'include' });
            const blob = await res.blob();
            if (res.ok && /^image\//.test(blob.type)) cover = await new Promise((ok, ko) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = ko; f.readAsDataURL(blob); });
          } catch (e) { /* tant pis : la cover reste facultative */ }
        }
        const small = cover && d.coverSize && parseInt(d.coverSize, 10) < 1000;
        if (!cover) noCover.push(d.title);
        else if (small) smallCover.push(`${d.title} (${d.coverSize} px)`);
        recs.push({ artists: d.artists, title: d.title, upc: d.upc, date: d.date, cover, coverName: cover ? (d.coverName || 'cover.jpg') : '' });
      }
      else problems.push((d && d.upc) || tab.title || 'onglet');
    } catch (e) {
      problems.push(tab.title || 'onglet');
    }
  }
  // pas de doublon : on saute les UPC déjà dans la liste
  const known = new Set(rows.map(r => (r.upc || '').trim()));
  const fresh = recs.filter(r => !known.has(r.upc));
  const added = addRecords(fresh);
  let msg = added ? `${added} sortie(s) ajoutée(s) depuis RWS. Vérifie-les puis « Lancer la création ».` : '';
  if (recs.length > fresh.length) msg += ` ${recs.length - fresh.length} déjà dans la liste.`;
  if (problems.length) msg += ` Lecture impossible : ${problems.join(', ')} (recharge la page RWS et réessaie).`;
  if (added && !noCover.length) msg += ' Cover récupérée sur RWS.';
  if (noCover.length) msg += ` Cover introuvable pour : ${noCover.join(', ')} (ajoute-la à la main si tu l’as, sinon Linkfire la reprendra au rescan).`;
  if (smallCover.length) msg += ` Cover en petite taille sur RWS : ${smallCover.join(', ')}.`;
  scanMsg(msg.trim() || 'Rien à ajouter.', added > 0 && !problems.length);
  if (added) document.querySelector('#rows').scrollIntoView({ behavior: 'smooth' });
}

const RWS_URL = 'https://apps.rws.umusic.net/releases/*';

$('#scanOne').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !/^https:\/\/apps\.rws\.umusic\.net\/releases\//.test(tab.url || '')) {
    const any = await chrome.tabs.query({ url: RWS_URL });
    if (any.length === 1) return scanTabs(any);
    return scanMsg('Ouvre d’abord la page d’une sortie sur RWS (apps.rws.umusic.net/releases/…), puis clique à nouveau.');
  }
  scanTabs([tab]);
});

$('#scanAll').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: RWS_URL });
  if (!tabs.length) return scanMsg('Aucun onglet de sortie RWS ouvert.');
  scanTabs(tabs);
});

// ---------- Préparer la sortie dans RWS ----------
let rwsTabId = null, rwsInfo = null;
function rwsMsg(t, ok) { const el = $('#rwsMsg'); el.style.color = ok ? '#059669' : ''; el.textContent = t; }
async function findRwsTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab && /^https:\/\/apps\.rws\.umusic\.net\/releases\/\d/.test(tab.url || '')) return tab;
  const any = (await chrome.tabs.query({ url: RWS_URL })).filter(t => /releases\/\d/.test(t.url || ''));
  return any.length === 1 ? any[0] : null;
}
async function rwsRun(step, opts) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId: rwsTabId }, func: lfaRwsStep, args: [step, opts || {}] });
  return (res && res.result) || { ok: false, error: 'pas de réponse de la page' };
}
const frDate = (iso) => iso ? iso.split('-').reverse().join('/') : '?';
// Rush delivery : seulement si la sortie est dans moins de 5 jours (ou déjà passée)
function rushAuto() {
  const v = $('#rwsDate').value;
  if (!v) return;
  const [y, m, d] = v.split('-').map(Number);
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((new Date(y, m - 1, d) - today) / 864e5);
  $('#rwsRush').checked = days < 5;
  $('#rwsRushHint').textContent = days < 0 ? '(sortie déjà passée)' : days < 5 ? `(sortie dans ${days} j)` : `(sortie dans ${days} j : pas besoin)`;
}
$('#rwsDate').addEventListener('change', rushAuto);

$('#rwsRead').addEventListener('click', async () => {
  rwsMsg(''); $('#rwsSteps').innerHTML = '';
  const tab = await findRwsTab();
  if (!tab) { $('#rwsBox').hidden = true; return rwsMsg('Ouvre d’abord la page de la sortie sur RWS (apps.rws.umusic.net/releases/…), puis clique à nouveau.'); }
  rwsTabId = tab.id;
  try {
    const r = await rwsRun('info');
    if (!r.ok || !r.info.ok) throw new Error(r.error || 'page illisible');
    rwsInfo = r.info;
    const i = rwsInfo;
    const todo = [];
    todo.push(i.hasDates ? '✓ dates et pays déjà faits' : '• date + tous les pays');
    if (i.snippet) todo.push(i.hasPost ? '✓ Post Release déjà fait' : '• Post Release (partenaires snippet)');
    todo.push(i.scopeDone ? '✓ market scope déjà confirmé' : '• Confirm Market Scope');
    todo.push('• Rush delivery si sortie dans moins de 5 jours');
    if (!i.snippet) todo.push('<i>Sortie classique : seules ces étapes sont prises en charge pour l’instant (enregistrement à venir).</i>');
    $('#rwsSum').innerHTML = `<b>${i.artists || '?'} – ${i.title || '?'}</b><br>UPC ${i.upc} · ${i.type || 'type ?'}${i.snippet ? ' (snippet)' : ''}<br>${todo.join('<br>')}`;
    $('#rwsDate').value = i.date || '';
    rushAuto();
    await loadTracks();
    $('#rwsBox').hidden = false;
    if (!i.date) rwsMsg('Pas de date de sortie lue sur la page : mets-la ci-dessus.');
  } catch (e) {
    $('#rwsBox').hidden = true;
    rwsMsg('Lecture impossible (' + (e.message || e) + '). Recharge la page RWS et réessaie.');
  }
});

$('#rwsGo').addEventListener('click', async () => {
  if (!rwsTabId || !rwsInfo) return;
  const date = $('#rwsDate').value;
  if (!date) return rwsMsg('Indique la date de sortie.');
  const rush = $('#rwsRush').checked;
  const steps = [['dates', `Date ${frDate(date)} + tous les pays`]];
  if (rwsInfo.snippet) steps.push(['post', 'Post Release : partenaires snippet']);
  steps.push(['scope', 'Confirm Market Scope'], ['rush', `Rush delivery : ${rush ? 'Yes' : 'No'}`]);
  const ol = $('#rwsSteps'); ol.innerHTML = '';
  const lis = steps.map(([, t]) => { const li = document.createElement('li'); li.textContent = t; ol.appendChild(li); return li; });
  $('#rwsGo').disabled = true; rwsMsg('');
  chrome.tabs.update(rwsTabId, { active: true }).catch(() => {});
  try {
    for (let k = 0; k < steps.length; k++) {
      lis[k].className = 'run'; lis[k].textContent = steps[k][1] + ' …';
      const r = await rwsRun(steps[k][0], { date, rush });
      if (!r.ok) {
        lis[k].className = 'ko'; lis[k].textContent = steps[k][1] + ' ✗';
        rwsMsg(`Arrêt : ${r.error}. Fais cette étape à la main dans RWS, puis relance : ce qui est déjà fait sera sauté.`);
        return;
      }
      lis[k].className = r.skipped ? 'skip' : 'ok';
      lis[k].textContent = steps[k][1] + (r.skipped ? ' (déjà fait)' : ' ✓');
    }
    rwsMsg('Terminé ✓ Vérifie la page, puis clique toi-même « Publish Release ».', true);
  } finally { $('#rwsGo').disabled = false; }
});


// ---------- Pitch : tableau PITCH + Spotify for Artists ----------
const PITCH_SHEET_ID = '1NYTqBuEYuV_E7UVyXTKf7vMmJXCbXtQpB3KLEXfYwu8';
const PITCH_SHEET_URL = `https://docs.google.com/spreadsheets/d/${PITCH_SHEET_ID}/edit#gid=2067107217`;
const PITCH_SHEET_NAME = 'PITCH';
const PDEF = { city: 'Abidjan', lang: 'French', genres: 'Hip Hop, Rap Ivoire', styles: '', cultures: 'African', moods: 'Energetic', instr: 'Samples, Drum Kit', pin: true };
let rwsTracks = [];
const list = (t) => (t || '').split(/\s*[,;]\s*/).map(x => x.trim()).filter(Boolean);
function msgIn(sel, t, ok) { const el = $(sel); el.style.color = ok ? '#059669' : ''; el.textContent = t; }

async function loadTracks() {
  rwsTracks = [];
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: rwsTabId }, func: lfaRwsTracks });
    rwsTracks = (res && res.result) || [];
  } catch (e) { /* pas de pistes lisibles */ }
  const sel = $('#pTrack'); sel.innerHTML = '';
  const tracks = rwsTracks.length ? rwsTracks : [{ title: rwsInfo.title, artist: rwsInfo.artists, isrc: '' }];
  tracks.forEach((t, k) => { const o = document.createElement('option'); o.value = k; o.textContent = `${t.n ? t.n + '. ' : ''}${t.title}${t.version ? ' (' + t.version + ')' : ''}${t.isrc ? ' · ' + t.isrc : ''}`; sel.appendChild(o); });
  if (!rwsTracks.length) rwsTracks = tracks;
}
function currentPitch() {
  if (!rwsInfo) return null;
  const t = rwsTracks[+$('#pTrack').value || 0] || { title: rwsInfo.title, artist: rwsInfo.artists };
  const iso = $('#rwsDate').value || rwsInfo.date;
  // un single garde le titre de la sortie ; un projet (EP, album, deluxe) prend le titre choisi
  return { date: iso ? iso.split('-').reverse().join('/') : '', upc: rwsInfo.upc, isrc: t.isrc || '', artist: t.artist || rwsInfo.artists, title: t.title || rwsInfo.title, release: rwsInfo.title, mainArtist: (rwsInfo.artists || '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\sx\s)\s*/i)[0] };
}
async function sheetTab(open) {
  let tabs = await chrome.tabs.query({ url: `https://docs.google.com/spreadsheets/d/${PITCH_SHEET_ID}/*` });
  if (tabs.length) return tabs[0];
  if (!open) return null;
  const tab = await chrome.tabs.create({ url: PITCH_SHEET_URL, active: false });
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 500)); const t = await chrome.tabs.get(tab.id); if (t.status === 'complete') break; }
  await new Promise(r => setTimeout(r, 5000));
  return tab;
}

$('#pSheet').addEventListener('click', async () => {
  const row = currentPitch();
  if (!row) return msgIn('#pSheetMsg', 'Lis d’abord la sortie RWS (🔎 plus haut).');
  $('#pSheet').disabled = true; msgIn('#pSheetMsg', 'Ouverture du tableau PITCH…', true);
  try {
    const tab = await sheetTab(true);
    await chrome.tabs.update(tab.id, { active: true });
    msgIn('#pSheetMsg', 'Ajout de la ligne…', true);
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: lfaSheetAddRow, args: [{ date: row.date, upc: row.upc, isrc: row.isrc, artist: row.artist, title: row.title }, { sheetName: PITCH_SHEET_NAME }] });
    const r = (res && res.result) || {};
    if (r.ok && r.skipped) msgIn('#pSheetMsg', `Déjà dans le tableau (ligne ${r.line}) : rien ajouté.`, true);
    else if (r.ok) msgIn('#pSheetMsg', `Ligne ajoutée en haut du tableau PITCH : ${row.date} · ${row.upc} · ${row.artist} · ${row.title}. Complète le pitch (FR/ENG), les liens et le genre.`, true);
    else msgIn('#pSheetMsg', 'Arrêt : ' + (r.error || 'erreur inconnue') + (r.unsure ? ' Vérifie le haut du tableau.' : ''));
  } catch (e) { msgIn('#pSheetMsg', 'Arrêt : ' + (e.message || e)); }
  finally { $('#pSheet').disabled = false; }
});

// réglages du pitch Spotify (mémorisés)
const PF = { pCity: 'city', pLang: 'lang', pGenres: 'genres', pStyles: 'styles', pCultures: 'cultures', pMoods: 'moods', pInstr: 'instr' };
async function loadPitchPrefs() {
  const d = (await chrome.storage.local.get('lfa_pitch')).lfa_pitch || {};
  const v = { ...PDEF, ...d };
  for (const [id, k] of Object.entries(PF)) $('#' + id).value = v[k] || '';
  $('#pPin').checked = v.pin !== false;
}
function savePitchPrefs() {
  const v = { pin: $('#pPin').checked };
  for (const [id, k] of Object.entries(PF)) v[k] = $('#' + id).value;
  chrome.storage.local.set({ lfa_pitch: v });
}
loadPitchPrefs();
for (const id of [...Object.keys(PF), 'pPin']) $('#' + id).addEventListener('change', savePitchPrefs);

$('#pFromSheet').addEventListener('click', async () => {
  const row = currentPitch();
  if (!row) return msgIn('#pMsg', 'Lis d’abord la sortie RWS (🔎 plus haut).');
  try {
    const tab = await sheetTab(true);
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: lfaSheetFindRow, args: [row, { sheetName: PITCH_SHEET_NAME }] });
    const r = (res && res.result) || {};
    if (!r.ok) return msgIn('#pMsg', 'Tableau : ' + (r.error || 'lecture impossible'));
    const txt = r.pitchSpotify || r.pitchFr || r.pitchEn;
    if (!txt) return msgIn('#pMsg', 'Pas encore de texte de pitch sur cette ligne du tableau (colonnes « Pitch Spotify » ou « Pitch en FR »).');
    $('#pDesc').value = txt;
    msgIn('#pMsg', `Texte repris du tableau (${r.pitchSpotify ? 'Pitch Spotify' : r.pitchFr ? 'Pitch en FR' : 'Pitch en ENG'}).`, true);
  } catch (e) { msgIn('#pMsg', 'Tableau : ' + (e.message || e)); }
});

async function s4aRun(tabId, step, o) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: lfaS4aStep, args: [step, o] });
  return (res && res.result) || { ok: false, error: 'pas de réponse de la page' };
}
async function s4aGoto(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 500)); const t = await chrome.tabs.get(tabId); if (t.status === 'complete' && t.url.startsWith(url.split('?')[0].slice(0, 40))) break; }
  await new Promise(r => setTimeout(r, 2500));
}

$('#pGo').addEventListener('click', async () => {
  const row = currentPitch();
  if (!row) return msgIn('#pMsg', 'Lis d’abord la sortie RWS (🔎 plus haut).');
  savePitchPrefs();
  const o = {
    artist: row.mainArtist, release: row.release, track: row.title,
    city: $('#pCity').value.trim(), language: $('#pLang').value.trim(),
    genres: list($('#pGenres').value).slice(0, 3), styles: list($('#pStyles').value).slice(0, 2), cultures: list($('#pCultures').value).slice(0, 2),
    moods: list($('#pMoods').value).slice(0, 2), instruments: list($('#pInstr').value),
    pin: $('#pPin').checked, live: $('#pLive').checked, cover: $('#pCover').checked, remix: $('#pRemix').checked, instrumental: $('#pInstrumental').checked,
    description: $('#pDesc').value.trim()
  };
  if (!o.description) return msgIn('#pMsg', 'Ajoute la description du pitch (ou « reprendre du tableau »).');
  if (!o.genres.length) return msgIn('#pMsg', 'Indique au moins un genre.');
  $('#pGo').disabled = true;
  try {
    let [tab] = await chrome.tabs.query({ url: 'https://artists.spotify.com/*' });
    if (!tab) tab = await chrome.tabs.create({ url: 'https://artists.spotify.com/c/roster', active: true });
    else await chrome.tabs.update(tab.id, { active: true });
    msgIn('#pMsg', `Spotify for Artists : recherche de ${o.artist}…`, true);
    await s4aGoto(tab.id, 'https://artists.spotify.com/c/roster');
    const a = await s4aRun(tab.id, 'findArtist', o);
    if (!a.ok) return msgIn('#pMsg', 'Arrêt : ' + a.error + (a.choices && a.choices.length ? ' (proposés : ' + a.choices.join(', ') + ')' : ''));
    msgIn('#pMsg', 'Sorties à venir…', true);
    await s4aGoto(tab.id, `https://artists.spotify.com/c/artist/${a.artistId}/music/upcoming`);
    const rel = await s4aRun(tab.id, 'findRelease', o);
    if (!rel.ok) return msgIn('#pMsg', 'Arrêt : ' + rel.error + (rel.choices ? ' : ' + rel.choices.join(' / ') : ''));
    msgIn('#pMsg', `Pitch de « ${o.track} »…`, true);
    await s4aGoto(tab.id, 'https://artists.spotify.com' + (rel.href.startsWith('/c/') ? '' : '/c') + rel.href);
    const w = await s4aRun(tab.id, 'wizard', o);
    if (!w.ok) return msgIn('#pMsg', `Arrêt (${w.step || 'pitch'}) : ${w.error}. Termine à la main dans Spotify for Artists.`);
    const warn = (w.log || []).filter(l => l.startsWith('⚠️')).join(' ');
    msgIn('#pMsg', `Prêt ✓ Le pitch est sur l’écran « Review » : vérifie, puis clique toi-même « Pitch ».${warn ? ' ' + warn : ''}`, !warn);
  } catch (e) { msgIn('#pMsg', 'Arrêt : ' + (e.message || e)); }
  finally { $('#pGo').disabled = false; }
});
