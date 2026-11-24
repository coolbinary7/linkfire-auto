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

  // une section repliée cache son bouton « edit » : on la déplie d'abord (clic sur son titre, comme à la main)
  async function expand(section) {
    if (headerBtn(section, 'edit') || headerBtn(section, 'save')) return;
    const head = section.querySelector('header.expandable-section-header, header');
    const title = head && (head.querySelector('ul > li:first-child') || head.querySelector('h1,h2,h3') || head);
    if (title) { click(title.querySelector('h1,h2,h3') || title); await until(() => headerBtn(section, 'edit') || headerBtn(section, 'save'), 5000); await sleep(300); }
  }
  async function openEdit(section, label) {
    await expand(section);
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
      if (manage()) await expand(manage());
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
      if (manage()) await expand(manage());
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

    if (step === 'expire') {
      // date d'expiration sur chaque ligne de « Release Date(s) » (enregistrement de Ced, 11/11/2026)
      const iso = opts.expiry;
      if (!iso) throw new Error('date d’expiration manquante');
      const mr = manage();
      if (!mr) throw new Error('section « Manage Release » introuvable');
      await expand(mr);
      const art0 = article(mr, 'Release Date(s)');
      const viewRows = (a) => [...a.querySelectorAll('table tbody tr')].filter(tr => vis(tr) && !tr.closest('form') && /\d{2}-[A-Za-z]{3}-\d{4}/.test(tr.innerText));
      const expOf = (tr) => ((tr.cells[1] && tr.cells[1].innerText) || '').trim();
      if (art0 && viewRows(art0).length && viewRows(art0).every(tr => norm(expOf(tr)) === norm(fmt(iso)))) { say('Expiration déjà en place.'); return { ok: true, skipped: true, log }; }
      await openEdit(mr, 'Manage Release');
      const art = await until(() => article(mr, 'Release Date(s)'), 5000);
      if (!art) throw new Error('bloc « Release Date(s) » introuvable');
      const n = viewRows(art).length;
      if (!n) throw new Error('aucune date de sortie à expirer');
      let done = 0;
      for (let k = 0; k < n; k++) {
        const tr = viewRows(art)[k];
        if (!tr || norm(expOf(tr)) === norm(fmt(iso))) continue;
        const ed = byText(tr, 'a', 'edit') || byText(tr, 'button', 'edit');
        if (!ed) throw new Error('lien « edit » de la date introuvable');
        click(ed);
        const row = await until(() => { const f = [...art.querySelectorAll('form table tbody tr')].filter(vis); return f[f.length - 1]; }, 5000);
        if (!row) throw new Error('la ligne ne passe pas en modification');
        const cells = row.querySelectorAll(':scope > td');
        if (!await pickDate(cells[1], iso)) say('⚠️ date d’expiration à vérifier');
        const up = byText(cells[3] || row, 'button', 'update') || [...row.querySelectorAll('button')].find(b => norm(b.innerText) === 'update');
        if (!up) throw new Error('bouton « update » introuvable');
        click(up);
        await until(() => !art.querySelector('form table tbody tr') || !vis(art.querySelector('form')), 5000);
        await sleep(500); done++;
      }
      await saveSection(mr, 'Manage Release');
      say(`Expiration au ${fmt(iso)} sur ${done} ligne(s).`);
      return { ok: true, log };
    }

    // ---- Ressource (Resource Workspace) : ISRC vidéo — enregistrement de Ced du 23/11/2026 ----
    // /resources/<ISRC> → Manage Resource : edit → Release Date(s) : add → date + add all countries → add → save → Confirm Market Scope
    if (step === 'resInfo' || step === 'resDates') {
      const isrc = ((location.pathname.match(/resources\/([A-Z]{2}[A-Z0-9]{3}\d{7})/i) || [])[1] || '').toUpperCase();
      const mrs = [...document.querySelectorAll('section.manage-resource, section.expandManage, section.expandable-section')]
        .find(x => { const h = x.querySelector('header'); return h && /manage resource/i.test(h.innerText); }) || null;
      const heads = [...document.querySelectorAll('header.pageHeader h1, header.pageHeader h2, header.pageHeader h3')].map(h => h.innerText.trim()).filter(Boolean);
      const dateRows = (sec) => { const a = sec && article(sec, 'Release Date(s)'); return a ? [...a.querySelectorAll('table tbody tr')].filter(tr => vis(tr) && !tr.closest('form') && /\d{2}-[A-Za-z]{3}-\d{4}/.test(tr.innerText)) : []; };
      const cnt = mrs ? +(((mrs.querySelector('header') || mrs).innerText.match(/Countries\s*\((\d+)\)/i) || [])[1] || 0) : 0;
      const sc = document.querySelector('button.confirm-market-scope');
      const info = { ok: !!isrc && !!mrs, isrc, artists: heads[0] || '', title: heads[1] || '', countries: cnt, hasDates: cnt > 0 || dateRows(mrs).length > 0, scopeDone: !!sc && /confirmed/i.test(sc.innerText) };
      if (step === 'resInfo') return { ok: true, info, log };
      if (!mrs) throw new Error('section « Manage Resource » introuvable (la page de la ressource est-elle chargée ?)');
      await expand(mrs);
      if (dateRows(mrs).length || info.countries > 0) { say('Date et pays déjà en place sur la ressource : rien à faire.'); return { ok: true, skipped: true, log }; }
      const iso = opts.date;
      if (!iso) throw new Error('date de sortie de la vidéo inconnue');
      await openEdit(mrs, 'Manage Resource');
      const art = await until(() => article(mrs, 'Release Date(s)'), 5000);
      if (!art) throw new Error('bloc « Release Date(s) » introuvable');
      if (!art.querySelector('form table tbody tr')) {
        const addBtn = byText(art, 'button', 'add');
        if (!addBtn) throw new Error('bouton « add » de Release Date(s) introuvable');
        click(addBtn);
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
      await saveSection(mrs, 'Manage Resource');
      say(`Ressource ${isrc} : date ${fmt(iso)} + tous les pays enregistrés.`);
      return { ok: true, log };
    }

    // ---- Voyants (milestones) : Label Copy, Rights, Market Scope, Assets, Clearance ----
    if (step === 'lights' || step === 'publish') {
      // Voyants du haut de page : des petits ronds (vert / gris / rouge) sous des libellés inclinés
      // (Label Copy, Rights, Market Scope, Assets, Pricing ou Clearance). On lit les ronds par position, de gauche à droite.
      const box = [...document.querySelectorAll('header.pageHeader div.milestones-and-publish, div.milestones-and-publish')]
        .find(x => /label\s*copy|rights|assets|pricing|clearance/i.test(x.textContent)) || null;
      const rgbOf = (v) => { const m = (v || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/); if (!m || m[4] === '0') return null; return [+m[1], +m[2], +m[3]]; };
      const hexRgb = (h) => { const m = (h || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i); if (!m) return null; let x = m[1]; if (x.length === 3) x = x.split('').map(c => c + c).join(''); return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]; };
      const kind = (c) => { if (!c) return ''; const [r, g, b2] = c; if (g > 100 && g > r + 30 && g >= b2) return 'green'; if (r > 150 && r > g + 50) return 'red'; if (r > 180 && g > 120 && b2 < 90) return 'orange'; return 'grey'; };
      const colorOf = (e) => {
        if (!e) return '';
        const cs = getComputedStyle(e);
        const vals = /^(circle|ellipse|path|rect|svg)$/i.test(e.tagName) ? [e.getAttribute('fill'), cs.fill, cs.stroke, cs.color] : [cs.backgroundColor, cs.borderTopColor, e.getAttribute('fill'), cs.color];
        for (const v of vals) { const k = kind(rgbOf(v) || hexRgb(v)); if (k) return k; }
        return '';
      };
      const lights = [];
      if (box) {
        const zone = (e) => !e.closest('button, a, .publish, .rws-status');
        // ronds : cercles SVG, ou petits éléments ronds/colorés sans texte
        let dots = [...box.querySelectorAll('circle, ellipse')].filter(zone);
        if (!dots.length) dots = [...box.querySelectorAll('*')].filter(e => {
          if (!zone(e) || e.children.length || e.textContent.trim()) return false;
          const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || r.width > 26 || r.height > 26) return false;
          const cs = getComputedStyle(e); return parseFloat(cs.borderTopLeftRadius) >= r.width / 3 || e.tagName === 'svg' || /dot|circle|status|milestone|indicator|light/i.test(e.getAttribute('class') || '');
        });
        dots = dots.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        // libellés : textes courts (y compris <text> SVG)
        const labels = [...box.querySelectorAll('*')].filter(e => zone(e) && !e.children.length && /^(label\s*copy|rights|market\s*scope|assets|pricing|clearance|metadata|label copy)$/i.test(e.textContent.trim()));
        const cx = (e) => { const r = e.getBoundingClientRect(); return r.left + r.width / 2; };
        dots.sort((a, b2) => cx(a) - cx(b2));
        for (const d of dots) {
          const lab = labels.slice().sort((a, b2) => Math.abs(cx(a) - cx(d)) - Math.abs(cx(b2) - cx(d)))[0];
          const name = lab && Math.abs(cx(lab) - cx(d)) < 60 ? lab.textContent.trim() : `voyant ${lights.length + 1}`;
          if (lights.some(l => l.name === name)) continue;
          const st = colorOf(d) || colorOf(d.parentElement) || '?';
          lights.push({ name, state: st === 'orange' ? 'red' : st, why: (d.getAttribute('class') || d.tagName).toString().slice(0, 40) });
        }
      }
      // Market Scope : le bouton fait foi
      const sc = document.querySelector('button.confirm-market-scope');
      if (sc) {
        const ms = lights.find(l => /market\s*scope/i.test(l.name));
        const st = /confirmed/i.test(sc.innerText) ? 'green' : 'red';
        if (ms) { if (st === 'red') ms.state = 'red'; } else lights.push({ name: 'Market Scope', state: st, why: sc.innerText.trim() });
      }
      const pub = document.querySelector('button.publish-release, button.publish-resource');
      const st = document.querySelector('.rws-status');
      const stCls = st ? st.className : '';
      const published = /(^|\s)(Published|Live|Delivered)(\s|$)/.test(stCls) && !/Unpublished/.test(stCls);
      const allGreen = lights.length >= 4 && lights.every(l => l.state === 'green');
      const boxHtml = [...document.querySelectorAll('div.milestones-and-publish')].map(x => x.outerHTML).join('\n').slice(0, 8000);
      const info = { lights, allGreen, published, status: stCls.replace('rws-status', '').trim(), canPublish: !!pub && !pub.classList.contains('disabled') && !pub.disabled, key: (location.pathname.match(/(releases|resources)\/([A-Z0-9]+)/i) || [])[2] || '', kind: /resources\//.test(location.pathname) ? 'resource' : 'release', title: [...document.querySelectorAll('header.pageHeader h1, header.pageHeader h2')].map(h => h.innerText.trim()).filter(Boolean).slice(0, 2).join(' – ') || document.title, html: boxHtml };
      if (step === 'lights') return { ok: true, info, log };
      // publish : seulement si tout est vert (re-vérifié ici, au moment du clic)
      if (published) { say('Déjà publiée.'); return { ok: true, skipped: true, info, log }; }
      if (!allGreen && !opts.force) throw new Error('tous les voyants ne sont pas verts : publication annulée');
      if (!pub || !info.canPublish) throw new Error('bouton Publish indisponible');
      click(pub);
      await sleep(1500);
      // fenêtre de confirmation éventuelle
      const conf = await until(() => [...document.querySelectorAll('.overlay button, .modal button, [role=dialog] button, .overlay-footer button')].find(b => vis(b) && /^(publish( release| resource)?|confirm|yes|ok|continue|oui)$/i.test(b.innerText.trim())), 4000);
      if (conf) { say('Confirmation : ' + conf.innerText.trim()); click(conf); }
      const okPub = await until(() => { const s2 = document.querySelector('.rws-status'); return s2 && !/Unpublished/.test(s2.className) ? s2 : null; }, 30000);
      say(okPub ? 'Publish cliqué : statut ' + okPub.className.replace('rws-status', '').trim() : 'Publish cliqué (statut pas encore mis à jour)');
      return { ok: true, info, published: !!okPub, log };
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
      await expand(ds);
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
