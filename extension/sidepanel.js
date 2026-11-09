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

function slugPart(t) {
  return (t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean).map(cap).join('_');
}

function makeSlug(artists, title, format) {
  const t = slugPart(title);
  if (format === 'title') return t;
  const a = splitArtists(artists).map(slugPart).join('_');
  return a ? a + '_' + t : t;
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
  return { id: Math.random().toString(36).slice(2), artists: '', title: '', upc: '', date: '', slug: '', cover: '', coverName: '', ...v };
}

const settings = () => ({
  mode: document.querySelector('input[name=mode]:checked').value,
  slugFormat: $('#slugFormat').value,
  time: $('#time').value,
  tagArtist: $('#tagArtist').checked
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
        <label class="full">Artiste(s) <small>(séparer par virgule)</small><input data-f="artists" value=""></label>
        <label class="full">Titre<input data-f="title" value=""></label>
        <label>UPC<input data-f="upc" inputmode="numeric" value=""></label>
        <label>Date de sortie<input data-f="date" type="date" value=""></label>
        <label class="full">Fin du lien<input data-f="slug" class="slug" value=""></label>
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
        if ((f === 'artists' || f === 'title') && !slugTouched[r.id]) {
          r.slug = makeSlug(r.artists, r.title, $('#slugFormat').value);
          el.querySelector('input[data-f=slug]').value = r.slug;
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
    const r = newRow({ artists: c.artists || '', title: c.title || '', upc: (c.upc || '').replace(/\D/g, ''), date: c.date || '' });
    r.slug = makeSlug(r.artists, r.title, $('#slugFormat').value);
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

$('#slugFormat').addEventListener('change', () => {
  rows.forEach(r => { if (!slugTouched[r.id]) r.slug = makeSlug(r.artists, r.title, $('#slugFormat').value); });
  saveDraft(); renderRows();
});
document.querySelectorAll('input[name=mode], #time, #tagArtist').forEach(i => i.addEventListener('change', saveDraft));

// ---------- Lancement ----------
function validate() {
  const errs = [];
  rows.forEach((r, i) => {
    const n = `#${i + 1}`;
    if (!splitArtists(r.artists).length) errs.push(`${n} : artiste manquant`);
    if (!r.title.trim()) errs.push(`${n} : titre manquant`);
    if (!/^\d{12,14}$/.test((r.upc || '').trim())) errs.push(`${n} : UPC invalide (12 à 14 chiffres)`);
    if (!r.date) errs.push(`${n} : date de sortie manquante`);
    if (!r.slug.trim()) errs.push(`${n} : fin du lien vide`);
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
    slug: r.slug.trim(),
    tags: st.tagArtist ? splitArtists(r.artists) : [],
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
  chrome.runtime.sendMessage({ type: 'ensureLinkfireTab', reload: true });
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
    if (st.slugFormat) $('#slugFormat').value = st.slugFormat;
    if (st.time) $('#time').value = st.time;
    if (st.tagArtist === false) $('#tagArtist').checked = false;
  }
  if (!rows.length) rows = [newRow()];
  renderRows();
  renderState(d[KEY]);
})();
