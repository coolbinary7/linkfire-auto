// Préparation d'une sortie dans RWS (apps.rws.umusic.net/releases/<UPC>), d'après l'enregistrement de Ced (11/11/2026).
// Fonction injectée dans l'onglet RWS par le panneau (chrome.scripting) : elle reste autonome.
// step : 'info' | 'dates' | 'post' | 'scope' | 'rush'
// opts : { date: 'AAAA-MM-JJ', rush: true|false }
// Le « Publish Release » n'est JAMAIS cliqué : il reste à l'utilisateur.
async function lfaRwsStep(step, opts) {
  opts = opts || {};
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const log = [];
  const say = (m) => log.push(m);

  async function until(fn, ms = 10000, every = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      let v; try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      await sleep(every);
    }
    return null;
  }
  function byText(root, sel, txt) {
    const want = norm(txt);
    return [...(root || document).querySelectorAll(sel)].filter(vis).find(e => norm(e.innerText || e.textContent) === want) || null;
  }
  function click(el) {
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    el.click();
    return true;
  }
  function setReactValue(inp, v) {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(inp, v);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const fmt = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${String(d).padStart(2, '0')}-${MONTHS[m - 1].slice(0, 3)}-${y}`; };

  // ---- Lecture de la page ----
  function pageInfo() {
    const text = document.body ? document.body.innerText : '';
    const upc = (location.pathname.match(/releases\/(\d{12,14})/) || [])[1] || '';
    let date = '';
    const m = text.match(/Global Release Date\s*:?\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/i);
    if (m && MON3[m[2].toLowerCase()]) date = `${m[3]}-${String(MON3[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const type = ((text.match(/Release Type\s*:\s*([^\n|]+?)\s*(?:Resolution|\n|\|)/i) || [])[1] || '').trim();
    const config = ((text.match(/R2 Config\s*:\s*([^\n|]+)/i) || [])[1] || '').trim();
    const head = document.querySelector('header.pageHeader');
    const lines = (head ? head.innerText : text).split('\n').map(l => l.trim()).filter(Boolean);
    const ui = lines.findIndex(l => /^UPC\b/i.test(l));
    const title = ui >= 1 ? lines[ui - 1] : '';
    const artists = ui >= 2 ? lines[ui - 2] : '';
    const mr = manage();
    const mrCount = mr ? +((mr.querySelector('header') || mr).innerText.match(/Countries\s*\((\d+)\)/i) || [0, 0])[1] : 0;
    const scopeBtn = document.querySelector('button.confirm-market-scope');
    const rush = document.querySelector('input#rush-yes');
    const pub = document.querySelector('button.publish-release');
    const postArt = article(mr, 'Post Release');
    return {
      ok: !!upc, upc, title, artists, date, type, config,
      snippet: /snippet/i.test(type + ' ' + config),
      hasDates: mrCount > 0,
      hasPost: !!postArt && /meta|tiktok|youtube/i.test(postArt.innerText),
      scopeDone: !!scopeBtn && /confirmed/i.test(scopeBtn.innerText),
      rushOn: !!rush && rush.checked,
      publishReady: !!pub && !pub.classList.contains('disabled')
    };
  }
  function manage() { return document.querySelector('#manage-release section.manage-release') || document.querySelector('#manage-release'); }
  function article(root, heading) {
    if (!root) return null;
    return [...root.querySelectorAll('article')].find(a => {
      const h = a.querySelector('h1,h2,h3,h4,h5,header,label,span');
      return [...a.querySelectorAll('h1,h2,h3,h4,h5')].some(x => norm(x.innerText) === norm(heading)) || (h && norm(h.innerText) === norm(heading));
    }) || null;
  }
  function headerBtn(section, txt) {
    const h = section && section.querySelector('header.expandable-section-header .edit-section, header .edit-section');
    return h ? byText(h, 'button', txt) : null;
  }
  async function busy() { await sleep(400); await until(() => !document.querySelector('.loading, .spinner, .loader:not([style*="none"])'), 15000); await sleep(300); }

  // ---- Calendrier (react-datetime) : on clique le bon jour, comme à la main ----
  async function pickDate(cell, iso) {
    const inp = cell.querySelector('div.rdt input, input');
    if (!inp) throw new Error('champ date introuvable');
    const want = fmt(iso);
    if (norm(inp.value) === norm(want)) return true;
    const [y, m, d] = iso.split('-').map(Number);
    const icon = cell.querySelector('.input-group-addon, .glyphicon-calendar');
    click(icon || inp); inp.focus();
    const picker = await until(() => { const p = cell.querySelector('.rdtPicker, .rdtDays'); return p && vis(p) ? p : null; }, 3000);
    if (picker) {
      for (let i = 0; i < 36; i++) {
        const sw = cell.querySelector('.rdtSwitch');
        if (!sw) break;
        const [mn, yr] = sw.innerText.trim().split(/\s+/);
        const cur = (+yr) * 12 + MONTHS.indexOf(mn);
        const tgt = y * 12 + (m - 1);
        if (cur === tgt) break;
        click(cell.querySelector(cur < tgt ? '.rdtNext span, .rdtNext' : '.rdtPrev span, .rdtPrev'));
        await sleep(120);
      }
      const day = [...cell.querySelectorAll('td.rdtDay')].find(td => !td.classList.contains('rdtOld') && !td.classList.contains('rdtNew') && +td.innerText.trim() === d);
      if (day) { click(day); await sleep(250); }
    }
    if (norm(inp.value) !== norm(want)) { setReactValue(inp, want); await sleep(250); }
    document.body.click();
    await sleep(150);
    return norm(inp.value) === norm(want);
  }

  async function openEdit(section, label) {
    if (headerBtn(section, 'save')) return true;
    const e = headerBtn(section, 'edit');
    if (!e) throw new Error(`bouton « edit » de ${label} introuvable`);
    click(e);
    if (!await until(() => headerBtn(section, 'save'), 8000)) throw new Error(`${label} ne passe pas en modification`);
    await sleep(300);
    return true;
  }
  async function saveSection(section, label) {
    const s = await until(() => { const b = headerBtn(section, 'save'); return b && !b.classList.contains('disabled') && !b.disabled ? b : null; }, 6000);
    if (!s) throw new Error(`« save » de ${label} reste grisé`);
    click(s);
    if (!await until(() => !headerBtn(section, 'save') && headerBtn(section, 'edit'), 15000)) throw new Error(`${label} : l’enregistrement ne se termine pas`);
    await busy();
  }
  function formRow(art) {
    const rows = [...art.querySelectorAll('form table tbody tr')].filter(vis);
    return rows[rows.length - 1] || null;
  }
  function addAll(row) { return byText(row, 'a', 'add all countries'); }

  // ---- Étapes ----
  try {
    if (step === 'info') return { ok: true, info: pageInfo(), log };

    if (step === 'dates') {
      const info = pageInfo();
      if (info.hasDates) { say('Dates et pays déjà en place : rien à faire.'); return { ok: true, skipped: true, log }; }
      const iso = opts.date || info.date;
      if (!iso) throw new Error('date de sortie inconnue');
      const mr = manage();
      if (!mr) throw new Error('section « Manage Release » introuvable');
      await openEdit(mr, 'Manage Release');
      const art = await until(() => article(mr, 'Release Date(s)'), 5000);
      if (!art) throw new Error('bloc « Release Date(s) » introuvable');
      if (!art.querySelector('form')) {
        click(byText(art, 'button', 'add'));
        if (!await until(() => art.querySelector('form table tbody tr'), 5000)) throw new Error('le formulaire de date ne s’ouvre pas');
      }
      const row = formRow(art);
      const cells = row.querySelectorAll(':scope > td');
      if (!await pickDate(cells[0], iso)) say('⚠️ date à vérifier');
      const all = addAll(cells[2] || row);
      if (!all) throw new Error('lien « add all countries » introuvable');
      click(all); await sleep(400);
      const add = byText(cells[3] || row, 'button', 'add');
      if (!add) throw new Error('bouton « add » de la date introuvable');
      click(add); await sleep(600);
      await saveSection(mr, 'Manage Release');
      say(`Date ${fmt(iso)} + tous les pays enregistrés.`);
      return { ok: true, log };
    }

    if (step === 'post') {
      const info = pageInfo();
      if (info.hasPost) { say('Post Release déjà en place : rien à faire.'); return { ok: true, skipped: true, log }; }
      const iso = opts.date || info.date;
      const mr = manage();
      await openEdit(mr, 'Manage Release');
      const art = await until(() => article(mr, 'Post Release'), 5000);
      if (!art) throw new Error('bloc « Post Release » introuvable');
      if (!art.querySelector('form table tbody tr')) {
        click(byText(art, 'button', 'add'));
        if (!await until(() => art.querySelector('form table tbody tr'), 5000)) throw new Error('le formulaire Post Release ne s’ouvre pas');
      }
      const row = formRow(art);
      const avail = art.querySelector('input#post-rule-1');
      if (avail && !avail.checked) click(avail);
      const cells = row.querySelectorAll(':scope > td');
      if (!await pickDate(cells[1], iso)) say('⚠️ date de début à vérifier');
      const all = addAll(cells[3] || row);
      if (!all) throw new Error('« add all countries » (Post Release) introuvable');
      click(all); await sleep(400);
      const pick = byText(cells[4] || row, 'a', 'select from list');
      if (!pick) throw new Error('« select from list » (partenaires) introuvable');
      click(pick);
      const ov = await until(() => { const o = (cells[4] || row).querySelector('.overlay') || document.querySelector('.overlay'); return o && vis(o) ? o : null; }, 5000);
      if (!ov) throw new Error('la liste des partenaires ne s’ouvre pas');
      const selAll = [...ov.querySelectorAll('label')].find(l => norm(l.innerText) === 'select all');
      const cb = selAll && selAll.querySelector('input');
      if (cb && !cb.checked) click(cb);
      await sleep(250);
      click(byText(ov, 'button', 'Save'));
      await until(() => !vis(ov), 4000);
      const partners = row.querySelector('input[placeholder="Partners"]');
      if (partners && !partners.value) throw new Error('aucun partenaire sélectionné');
      const add = byText(cells[7] || row, 'button', 'add') || [...row.querySelectorAll('button')].filter(b => norm(b.innerText) === 'add').pop();
      click(add); await sleep(600);
      await saveSection(mr, 'Manage Release');
      say(`Post Release : Available To dès le ${fmt(iso)}, tous pays, partenaires ${partners ? partners.value : ''}.`);
      return { ok: true, log };
    }

    if (step === 'scope') {
      const b = document.querySelector('button.confirm-market-scope');
      if (!b) throw new Error('bouton « Confirm Market Scope » introuvable');
      if (/confirmed/i.test(b.innerText)) { say('Market scope déjà confirmé.'); return { ok: true, skipped: true, log }; }
      click(b);
      if (!await until(() => /confirmed/i.test(document.querySelector('button.confirm-market-scope').innerText), 20000)) throw new Error('le market scope ne se confirme pas');
      await busy();
      say('Market scope confirmé.');
      return { ok: true, log };
    }

    if (step === 'rush') {
      const ds = document.querySelector('section.delivery-settings');
      if (!ds) throw new Error('section « Delivery Settings » introuvable');
      const want = !!opts.rush;
      const cur = document.querySelector('input#rush-yes');
      if (cur && cur.checked === want && !headerBtn(ds, 'save')) { say(`Rush delivery déjà sur ${want ? 'Yes' : 'No'}.`); return { ok: true, skipped: true, log }; }
      await openEdit(ds, 'Delivery Settings');
      const r = await until(() => ds.querySelector(want ? 'input#rush-yes' : 'input#rush-no') || ds.querySelector(`input[name=isRushDelivery]${want ? '' : ':not(#rush-yes)'}`), 5000);
      if (!r) throw new Error('option Rush delivery introuvable');
      if (!r.checked) click(r.closest('label') || r);
      await sleep(250);
      await saveSection(ds, 'Delivery Settings');
      say(`Rush delivery : ${want ? 'Yes' : 'No'}.`);
      return { ok: true, log };
    }

    throw new Error('étape inconnue : ' + step);
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), log };
  }
}
