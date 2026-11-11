// Pitch : tableau PITCH (Google Sheets) et Spotify for Artists.
// Fonctions injectées par le panneau (chrome.scripting) : chacune reste autonome.

// --- RWS : les pistes de la sortie (tableau « Components ») ---
function lfaRwsTracks() {
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const table of document.querySelectorAll('table')) {
    const head = [...table.querySelectorAll('thead th, tr:first-child th')].map(th => norm(th.innerText).toLowerCase());
    const iT = head.indexOf('title'), iI = head.indexOf('isrc'), iA = head.indexOf('artist'), iN = head.indexOf('#'), iV = head.indexOf('version title');
    if (iT < 0 || iI < 0) continue;
    for (const tr of table.querySelectorAll('tbody tr')) {
      const td = [...tr.children];
      const isrc = norm(td[iI] && td[iI].innerText).replace(/[^A-Za-z0-9]/g, '');
      if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(isrc)) continue;
      out.push({ n: iN >= 0 ? norm(td[iN].innerText) : String(out.length + 1), title: norm(td[iT].innerText), version: iV >= 0 ? norm(td[iV].innerText) : '', artist: iA >= 0 ? norm(td[iA].innerText) : '', isrc: isrc.toUpperCase() });
    }
    if (out.length) break;
  }
  return out;
}

// --- Google Sheets : insère une ligne en haut de l'onglet PITCH et la remplit ---
// row = { date:'20/11/2026', upc, isrc, artist, title } ; opts = { gid, sheetName }
async function lfaSheetAddRow(row, opts) {
  opts = opts || {};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const id = (location.pathname.match(/spreadsheets\/d\/([^/]+)/) || [])[1];
  if (!id) return { ok: false, error: 'cet onglet n’est pas un Google Sheets' };
  const mouse = (el) => {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0 };
    for (const t of ['mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o));
  };
  const key = (el, k, kc) => { for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: k, code: k, keyCode: kc, which: kc, bubbles: true, cancelable: true })); };
  const items = () => [...document.querySelectorAll('.goog-menuitem')].filter(e => e.offsetParent);
  async function until(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(150); } return null; }
  // l'onglet affiché est dans « ?gid= » (le « #gid= » peut être en retard)
  const curGid = () => new URLSearchParams(location.search).get('gid') || (location.hash.match(/gid=(\d+)/) || [])[1] || '';
  function csvParse(t) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  async function readSheet(gid) {
    const r = await fetch(`/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1&gid=${gid}`, { credentials: 'include' });
    if (!r.ok) throw new Error('lecture du tableau impossible (' + r.status + ')');
    return csvParse(await r.text());
  }
  const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
  const same = (r) => r && norm(r[5]) === norm(row.title) && (digits(r[2]) && digits(row.upc) ? digits(r[2]) === digits(row.upc) : norm(r[4]) === norm(row.artist));

  try {
    // 1. Le bon onglet (PITCH)
    // l'onglet s'affiche parfois avec un chiffre ou un symbole devant (« 1 PITCH ») : on le trouve par son identifiant (gid), sinon par son nom
    let gid = opts.gid || curGid();
    if (opts.gid && curGid() !== String(opts.gid)) {
      // nom exact, une fois retiré ce qui précède (« 1 PITCH » → « pitch ») ; jamais « Réponses Formulaire de Pitch »
      const want = norm(opts.sheetName || '');
      const label = (t) => norm(t.innerText).replace(/^[^a-z]*\s/, '').replace(/^\d+\s*/, '');
      const tab = [...document.querySelectorAll('.docs-sheet-tab')].find(t => label(t) === want);
      if (tab) { mouse(tab); await until(() => curGid() === String(opts.gid), 6000); }
      await sleep(1000);
      if (curGid() !== String(opts.gid)) return { ok: false, error: `impossible d’afficher l’onglet « ${opts.sheetName || opts.gid} » : clique dessus dans le tableau puis relance` };
    }
    // 2. Déjà dans le tableau ?
    const before = await readSheet(gid);
    const head = (before[0] || []).map(norm);
    if (head[1] !== 'date' || head[2] !== 'upc' || head[5] !== 'titre') return { ok: false, error: 'les colonnes ne sont pas celles attendues (B Date, C UPC, D ISRC, E Artiste, F Titre)' };
    const dup = before.findIndex((r, i) => i > 0 && same(r));
    if (dup > 0) return { ok: true, skipped: true, line: dup + 1 };
    // 3. Nouvelle ligne tout en haut (sous les titres)
    const nb = document.querySelector('#t-name-box');
    if (!nb) return { ok: false, error: 'zone de nom de Sheets introuvable' };
    const goto = async (ref) => { mouse(nb); nb.focus(); nb.value = ref; key(nb, 'Enter', 13); await sleep(500); };
    await goto('A2');
    mouse(document.querySelector('#docs-insert-menu'));
    const lignes = await until(() => items().find(e => /^(lignes|rows)\b/i.test(e.innerText.trim())));
    if (!lignes) return { ok: false, error: 'menu Insertion > Lignes introuvable' };
    mouse(lignes);
    const above = await until(() => items().find(e => /ligne au-dessus|row above/i.test(e.innerText)));
    if (!above) return { ok: false, error: '« Insérer une ligne au-dessus » introuvable' };
    mouse(above);
    await sleep(1200);
    // 4. Collage de la ligne : Date, UPC (texte, zéros gardés), ISRC, Artiste, Titre
    await goto('B2');
    const ed = document.activeElement && document.activeElement.id === 'waffle-rich-text-editor' ? document.activeElement : (document.querySelector('#waffle-rich-text-editor') || document.activeElement);
    const tsv = [row.date || '', row.upc ? "'" + row.upc : '', row.isrc || '', row.artist || '', row.title || ''].map(v => String(v).replace(/[\t\n]/g, ' ')).join('\t');
    const dt = new DataTransfer(); dt.setData('text/plain', tsv);
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    // 5. Vérification
    for (let i = 0; i < 12; i++) {
      await sleep(1000);
      const after = await readSheet(gid).catch(() => []);
      if (after[1] && same(after[1])) return { ok: true, line: 2 };
    }
    return { ok: false, error: 'la ligne n’apparaît pas dans le tableau après le collage', unsure: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// --- Spotify for Artists ---
// step : 'whoami' | 'findArtist' | 'findRelease' | 'wizard'
// Le bouton final « Pitch » n'est JAMAIS cliqué : on s'arrête sur « 5 of 5 - Review ».
async function lfaS4aStep(step, o) {
  o = o || {};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const vis = (el) => !!el && el.getClientRects().length > 0;
  const log = [];
  async function until(fn, ms = 10000, every = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { let v; try { v = fn(); } catch (e) { v = null; } if (v) return v; await sleep(every); } return null; }
  function click(el) { if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; }
  function setVal(inp, v) {
    const proto = inp.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(inp, v);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const btn = (txt) => [...document.querySelectorAll('button')].filter(vis).find(b => norm(b.innerText) === norm(txt) && !b.disabled);
  const stepTitle = () => { const h = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading],legend,button,span,p')].map(e => e.innerText || '').find(t => /^\d of 5 - /.test(t.trim())); return h ? h.trim() : ''; };
  async function next(wantStep) {
    const b = await until(() => btn('Next'), 8000);
    if (!b) throw new Error('bouton « Next » introuvable ou grisé (un champ obligatoire manque ?)');
    click(b);
    if (!await until(() => stepTitle().startsWith(wantStep), 10000)) throw new Error(`l’étape « ${wantStep} » ne s’affiche pas`);
    await sleep(600);
  }
  async function pickCombo(inp, text, matchFn) {
    inp.focus(); click(inp);
    setVal(inp, ''); await sleep(150);
    setVal(inp, text);
    const opt = await until(() => [...document.querySelectorAll('[role=option], [id*="-option-"]')].filter(vis).find(matchFn), 8000);
    if (!opt) return false;
    click(opt); await sleep(400);
    return true;
  }
  function toggle(prefix, name) {
    const el = document.getElementById(prefix + '-' + name) || [...document.querySelectorAll(`[id^="${prefix}-"]`)].find(b => norm(b.innerText) === norm(name));
    if (!el) return `« ${name} » introuvable`;
    const on = el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true';
    if (!on) click(el);
    return '';
  }
  function radio(id) { const r = document.getElementById(id); if (!r) return false; if (!r.checked) click(r.closest('label') || r); return true; }

  try {
    if (step === 'whoami') {
      const m = location.pathname.match(/artist\/([A-Za-z0-9]{22})/);
      return { ok: true, artistId: m ? m[1] : '', url: location.href, step: stepTitle() };
    }

    if (step === 'findArtist') {
      // sélecteur d'artiste : ouvrir, chercher, prendre le nom exact
      let inp = document.querySelector('#artist-switcher-search-input');
      if (!inp || !vis(inp)) {
        const opener = [...document.querySelectorAll('button, [role=button], a')].filter(vis).find(e => /view profile|switch artist|changer d.artiste/i.test(e.innerText + ' ' + (e.getAttribute('aria-label') || '')))
          || document.querySelector('[data-testid*="artist-switcher"], [aria-label*="artist" i][aria-haspopup]');
        if (opener) click(opener);
        inp = await until(() => { const i = document.querySelector('#artist-switcher-search-input'); return i && vis(i) ? i : null; }, 6000);
      }
      if (!inp) {
        // repli : la liste « roster »
        const a = [...document.querySelectorAll('a[href*="/artist/"]')].find(x => norm(x.innerText).split('\n')[0] === norm(o.artist));
        if (a) return { ok: true, artistId: (a.getAttribute('href').match(/artist\/([A-Za-z0-9]{22})/) || [])[1] };
        return { ok: false, error: 'sélecteur d’artiste introuvable' };
      }
      setVal(inp, o.artist);
      const want = norm(o.artist);
      const link = await until(() => { const l = [...document.querySelectorAll('a[id^="artist-search-link-"]')].filter(vis); return l.find(x => norm(x.innerText) === want) || (l.length && Date.now() && null); }, 8000);
      const all = [...document.querySelectorAll('a[id^="artist-search-link-"]')].filter(vis).map(x => x.innerText.trim());
      if (!link) return { ok: false, error: `artiste « ${o.artist} » introuvable dans ton accès Spotify for Artists`, choices: all.slice(0, 8) };
      return { ok: true, artistId: link.id.replace('artist-search-link-', '') };
    }

    if (step === 'findRelease') {
      await until(() => document.querySelector('a[href*="/submission/"]') || /no upcoming|aucune sortie/i.test(document.body.innerText), 15000);
      const links = [...document.querySelectorAll('a[href*="/submission/"][href*="/create"]')];
      const rows = links.map(a => { let r = a; for (let i = 0; i < 10 && r.parentElement && !(r.innerText && r.innerText.split('\n').length > 2); i++) r = r.parentElement; return { href: a.getAttribute('href'), text: (r.innerText || '').replace(/\s+/g, ' ').trim() }; });
      if (!rows.length) return { ok: false, error: 'aucune sortie à venir avec « Pitch a song » pour cet artiste (sortie pas encore livrée à Spotify, ou déjà pitchée ?)' };
      const want = norm(o.release || '');
      const pick = (want && rows.find(r => norm(r.text).includes(want))) || (rows.length === 1 ? rows[0] : null);
      if (!pick) return { ok: false, error: 'plusieurs sorties à venir : précise le titre de la sortie', choices: rows.map(r => r.text.slice(0, 80)) };
      return { ok: true, href: pick.href, text: pick.text.slice(0, 100) };
    }

    if (step === 'wizard') {
      if (!await until(() => stepTitle(), 15000)) throw new Error('le formulaire de pitch ne s’affiche pas');
      // 1. Chanson
      if (stepTitle().startsWith('1 of 5')) {
        const want = norm(o.track);
        const row = await until(() => [...document.querySelectorAll('[role=radio]')].filter(vis).find(r => { const t = norm(r.innerText).replace(/^\d+\s+/, ''); return t === want || t.startsWith(want + ' ') || t.replace(/\s+e(\s|$).*/, '') === want; }), 8000);
        if (!row) throw new Error(`titre « ${o.track} » introuvable dans la sortie (déjà sorti ou déjà pitché ?)`);
        if (row.getAttribute('aria-checked') !== 'true') click(row);
        const pin = document.querySelector('#nms-track-pinning-checkbox');
        if (pin && pin.checked !== !!o.pin) click(pin.closest('label') || pin);
        log.push('chanson : ' + row.innerText.replace(/\s+/g, ' ').trim());
        await next('2 of 5');
      }
      // 2. Lieu
      if (stepTitle().startsWith('2 of 5')) {
        if (o.city) {
          const inp = [...document.querySelectorAll('input[role=combobox]')].filter(vis)[0];
          const cityN = norm(o.city);
          if (inp && !norm(inp.value).startsWith(cityN)) {
            if (!await pickCombo(inp, o.city, (op) => norm(op.innerText).startsWith(cityN) && (!o.country || norm(op.innerText).includes(norm(o.country))))) throw new Error(`ville « ${o.city} » introuvable`);
          }
          log.push('lieu : ' + (inp ? inp.value : o.city));
        }
        await next('3 of 5');
      }
      // 3. Détails
      if (stepTitle().startsWith('3 of 5')) {
        const warn = [];
        const g = document.querySelector('#genre-select');
        for (const genre of (o.genres || []).slice(0, 3)) {
          const already = [...document.querySelectorAll('[class*="multiValue"], [class*="multi-value"]')].some(c => norm(c.innerText) === norm(genre));
          if (already) continue;
          if (!g || !await pickCombo(g, genre, (op) => norm(op.innerText) === norm(genre))) warn.push(`genre « ${genre} » introuvable`);
        }
        for (const s of o.styles || []) { const w = toggle('theme', s); if (w) warn.push(w); }
        for (const c of o.cultures || []) { const w = toggle('culture', c); if (w) warn.push(w); }
        for (const m of o.moods || []) { const w = toggle('mood', m); if (w) warn.push(w); }
        for (const i of o.instruments || []) { const w = toggle('instrument', i); if (w) warn.push(w); }
        radio(o.cover ? 'is-cover-yes' : 'is-cover-no');
        radio(o.remix ? 'is-remix-yes' : 'is-remix-no');
        radio(o.live ? 'recording-type-live' : 'recording-type-studio');
        radio(o.instrumental ? 'is-instrumental-yes' : 'is-instrumental-no');
        await sleep(300);
        if (!o.instrumental && o.language) {
          const langIn = [...document.querySelectorAll('input[role=combobox]')].filter(vis).find(i => /language|langue/i.test((i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '')));
          const has = [...document.querySelectorAll('[role=row], [role=gridcell], [class*="tag"], [class*="chip"]')].some(e => norm(e.innerText) === norm(o.language));
          if (langIn && !has) { if (!await pickCombo(langIn, o.language, (op) => norm(op.innerText) === norm(o.language))) warn.push(`langue « ${o.language} » introuvable`); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
        }
        if (warn.length) log.push('⚠️ ' + warn.join(' ; '));
        await next('4 of 5');
      }
      // 4. Description
      if (stepTitle().startsWith('4 of 5')) {
        const ta = document.querySelector('#song-info');
        if (!ta) throw new Error('champ Description introuvable');
        if (o.description && norm(ta.value) !== norm(o.description)) { ta.focus(); setVal(ta, o.description); await sleep(300); }
        if (!ta.value.trim()) throw new Error('la description est vide : ajoute le texte du pitch');
        await next('5 of 5');
      }
      if (stepTitle().startsWith('5 of 5')) return { ok: true, review: true, log };
      throw new Error('étape inattendue : ' + stepTitle());
    }
    throw new Error('étape inconnue');
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), step: stepTitle(), log };
  }
}

// --- Google Sheets : relit la ligne d'une sortie (pour reprendre le texte du pitch) ---
async function lfaSheetFindRow(row, opts) {
  opts = opts || {};
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const id = (location.pathname.match(/spreadsheets\/d\/([^/]+)/) || [])[1];
  if (!id) return { ok: false, error: 'cet onglet n’est pas un Google Sheets' };
  let gid = (location.href.match(/gid=(\d+)/) || [])[1] || '';
  if (opts.sheetName) {
    const r = await fetch(`/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(opts.sheetName)}`, { credentials: 'include' });
    if (r.ok) return pick(await r.text());
  }
  const r = await fetch(`/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1&gid=${gid}`, { credentials: 'include' });
  if (!r.ok) return { ok: false, error: 'lecture du tableau impossible (' + r.status + ')' };
  return pick(await r.text());
  function pick(t) {
    const rows = []; let rw = [], cell = '', q = false;
    for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; } else if (c === '"') q = true; else if (c === ',') { rw.push(cell); cell = ''; } else if (c === '\n') { rw.push(cell); rows.push(rw); rw = []; cell = ''; } else if (c !== '\r') cell += c; }
    if (cell || rw.length) { rw.push(cell); rows.push(rw); }
    const head = (rows[0] || []).map(norm);
    const col = (name) => head.indexOf(norm(name));
    const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
    const hit = rows.slice(1).find(r => norm(r[col('titre')]) === norm(row.title) && (!digits(row.upc) || !digits(r[col('upc')]) || digits(r[col('upc')]) === digits(row.upc)));
    if (!hit) return { ok: false, error: 'ligne introuvable dans le tableau' };
    const get = (n) => { const i = col(n); return i >= 0 ? (hit[i] || '').trim() : ''; };
    return { ok: true, pitchSpotify: get('pitch spotify'), pitchFr: get('pitch en fr'), pitchEn: get('pitch en eng'), genre: get('genre'), mood: get('mood du son') };
  }
}
