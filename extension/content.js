/* Linkfire Auto Pre-save — moteur qui pilote l'interface Linkfire.
 * Tout l'état vit dans chrome.storage.local (clé "lfa"), donc si la page
 * se recharge en cours de route, le moteur reprend à la bonne étape.
 */
(() => {
  if (window.__lfaLoaded) return;
  window.__lfaLoaded = true;

  const KEY = 'lfa';
  const STEPS = [
    'start', 'chooseType', 'fillSetup', 'fillLink', 'createDraft',
    'openRescan', 'fillRescan', 'scheduleRescan', 'publish', 'collect'
  ];
  const STEP_LABELS = {
    start: 'Ouvrir « Create link »',
    chooseType: 'Choisir « Pre-release »',
    fillSetup: 'Remplir cover, titre et artiste',
    fillLink: 'Remplir le lien (domaine + fin du lien)',
    createDraft: 'Cliquer « Create draft »',
    openRescan: 'Ouvrir « Rescan link »',
    fillRescan: 'Mettre l’UPC et la date de sortie',
    scheduleRescan: 'Programmer le rescan',
    publish: 'Publier',
    collect: 'Récupérer le lien'
  };

  // ---------- Stockage ----------
  const getState = () => new Promise(r => chrome.storage.local.get(KEY, d => r(d[KEY] || null)));
  const setState = (s) => new Promise(r => chrome.storage.local.set({ [KEY]: s }, r));
  async function patch(fn) {
    const s = await getState();
    if (!s) return null;
    fn(s);
    await setState(s);
    return s;
  }
  async function log(msg) {
    await patch(s => {
      s.log = s.log || [];
      s.log.push(new Date().toLocaleTimeString('fr-FR') + ' — ' + msg);
      if (s.log.length > 200) s.log = s.log.slice(-200);
    });
  }

  // ---------- Outils DOM ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (t) => (t || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('#lfa-host')) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }

  // Texte "propre" d'un élément (sans les sous-champs de saisie)
  function ownText(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Trouve les éléments visibles dont le texte correspond, du plus précis au plus large
  function findByText(re, root = document, selector = '*') {
    const out = [];
    for (const el of root.querySelectorAll(selector)) {
      if (!visible(el)) continue;
      if (['SCRIPT', 'STYLE', 'HTML', 'BODY'].includes(el.tagName)) continue;
      const t = ownText(el);
      if (!t || t.length > 120) continue;
      if (re.test(t)) out.push(el);
    }
    // garder les plus profonds (pas les parents qui contiennent le même texte)
    return out.filter(el => !out.some(o => o !== el && el.contains(o)));
  }

  const CLICKABLE = 'button, a, [role=button], [role=option], [role=menuitem], [role=tab], [role=radio], label, li, [tabindex]';

  function clickable(el) {
    return el.closest(CLICKABLE) || el;
  }

  function realClick(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
  }

  async function waitFor(fn, timeout = 15000, interval = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const v = await fn();
        if (v) return v;
      } catch (e) { /* on réessaie */ }
      await sleep(interval);
    }
    return null;
  }

  async function clickText(re, { timeout = 15000, prefer = 'button', within = document } = {}) {
    const el = await waitFor(() => {
      const hits = findByText(re, within);
      if (!hits.length) return null;
      // préférer un vrai bouton
      const btn = hits.map(clickable).find(c => c.matches && c.matches(prefer));
      return btn || clickable(hits[0]);
    }, timeout);
    if (!el) return false;
    realClick(el);
    return true;
  }

  function pageHas(re) {
    return re.test(document.body.innerText || '');
  }

  // Écrit une valeur dans un champ React (contourne le "state" contrôlé)
  function setNativeValue(input, value) {
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressKey(el, key) {
    const code = key === 'Enter' ? 13 : key === 'Tab' ? 9 : key === 'Escape' ? 27 : 0;
    const o = { key, code: key, keyCode: code, which: code, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keypress', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
  }

  // Ferme une liste déroulante ouverte SANS touche Échap (Échap ferme l'écran Linkfire)
  async function closeMenus() {
    const ae = document.activeElement;
    if (ae && ae.blur) ae.blur();
    const head = findByText(/^(set ?up your pre-?release link|rescan link|choose link type)$/i)[0];
    const target = head || document.querySelector('h1, h2, h3');
    if (target) {
      const r = target.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + 2, clientY: r.top + 2 };
      target.dispatchEvent(new MouseEvent('mousedown', o));
      target.dispatchEvent(new MouseEvent('mouseup', o));
    }
    await sleep(250);
  }

  // Vérifie qu'on est toujours sur l'écran de création (sinon on s'arrête proprement)
  function onSetupScreen() {
    return /set ?up your pre-?release link/i.test(document.body.innerText || '');
  }

  const INPUTS = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, [contenteditable=true], select';

  // Libellés de champs connus : sert à ne jamais déborder sur le champ d'à côté
  const FIELD_LABELS = /^(title|artists?|tags?|link|scan using|date|time|service to rescan)(\s|\*|ⓘ|\?|$)/i;

  // Champ "présent" : visible, ou caché mais dans un bloc visible (ex. listes à recherche)
  function present(el) {
    return visible(el) || (el.parentElement && visible(el.parentElement));
  }

  // Le libellé de champ connu qui précède directement un élément dans la page
  function ownerLabel(el, labels) {
    let owner = null;
    for (const l of labels) {
      if (l.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) owner = l; else break;
    }
    return owner;
  }

  // Trouve le bloc (label + champ) correspondant à un libellé, ex. "Title"
  function fieldBlock(labelRe, root = document) {
    const labels = findByText(labelRe, root).filter(l => !l.matches('button, a'));
    const allLabels = findByText(FIELD_LABELS).filter(l => !l.matches('button, a, option, [role=option]'));
    for (const lab of labels) {
      if (lab.tagName === 'LABEL' && lab.htmlFor) {
        const t = document.getElementById(lab.htmlFor);
        if (t) return { label: lab, container: t.parentElement, input: t, inputs: [t] };
      }
      let node = lab;
      for (let i = 0; i < 5 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        // seulement les champs qui appartiennent à CE libellé (pas au suivant)
        const inputs = [...node.querySelectorAll(INPUTS)].filter(present)
          .filter(inp => (lab.compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_FOLLOWING))
          .filter(inp => { const o = ownerLabel(inp, allLabels); return !o || o === lab || lab.contains(o) || o.contains(lab); });
        const control = [...node.querySelectorAll('[role=combobox], [class*="control" i], [class*="select" i], [class*="placeholder" i]')]
          .filter(visible)
          .find(c => (lab.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) && (() => { const o = ownerLabel(c, allLabels); return !o || o === lab || lab.contains(o) || o.contains(lab); })());
        if (inputs.length || control) {
          return { label: lab, container: node, input: inputs[0] || null, inputs, control };
        }
      }
    }
    return null;
  }

  // Ouvre une liste à recherche (ex. "Select an artist") et renvoie la case où taper
  async function openCombobox(block) {
    const target = block.control || block.input;
    if (!target) return null;
    realClick(target);
    await sleep(300);
    const ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT' && block.container.contains(ae)) return ae;
    const inp = block.container.querySelector('input:not([type=hidden]):not([type=checkbox])');
    if (inp) { inp.focus(); return inp; }
    return ae && ae.tagName === 'INPUT' ? ae : null;
  }

  function visibleOptions() {
    const sel = '[role=option], [class*="option" i]:not([class*="options" i]), [class*="menu" i] li, [role=listbox] > *';
    return [...document.querySelectorAll(sel)].filter(visible).filter(o => ownText(o));
  }

  function pickOption(options, wanted) {
    const w = norm(wanted);
    return options.find(o => norm(ownText(o)) === w)
      || options.find(o => norm(ownText(o)).startsWith(w))
      || options.find(o => norm(ownText(o)).includes(w))
      || null;
  }

  // Tape dans une liste déroulante "avec recherche" et choisit la bonne option
  async function selectInCombobox(input, wanted, { allowCreate = false, timeout = 8000 } = {}) {
    input.focus();
    await sleep(100);
    setNativeValue(input, wanted);
    let opt = await waitFor(() => pickOption(visibleOptions(), wanted), timeout);
    if (!opt && allowCreate) {
      opt = visibleOptions().find(o => /create|add|cr[eé]er|ajouter/i.test(ownText(o)));
    }
    if (!opt) return false;
    realClick(opt);
    await sleep(400);
    return true;
  }

  // Choisit une valeur dans un menu déroulant sans recherche (ex. None → UPC)
  async function chooseFromDropdown(trigger, wantedRe) {
    if (trigger.tagName === 'SELECT') {
      const o = [...trigger.options].find(op => wantedRe.test(op.textContent));
      if (!o) return false;
      trigger.value = o.value;
      trigger.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    realClick(trigger);
    const opt = await waitFor(() => visibleOptions().find(o => wantedRe.test(ownText(o)))
      || findByText(wantedRe).find(e => e !== trigger && !trigger.contains(e)), 5000);
    if (!opt) return false;
    realClick(clickable(opt));
    await sleep(300);
    return true;
  }

  function dataUrlToFile(dataUrl, name) {
    const [head, b64] = dataUrl.split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name || 'cover.jpg', { type: mime });
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateVariants(iso) {
    const [y, m, d] = iso.split('-');
    const mi = parseInt(m, 10) - 1;
    return [
      `${d} ${MONTHS[mi]} ${y}`,
      `${parseInt(d, 10)} ${MONTHS[mi]} ${y}`,
      `${MONTHS[mi]} ${parseInt(d, 10)}, ${y}`,
      `${y}-${m}-${d}`,
      `${d}/${m}/${y}`,
      `${m}/${d}/${y}`
    ];
  }

  function looksLikeDate(value, iso) {
    if (!value) return false;
    const [y, m, d] = iso.split('-');
    const v = value.toLowerCase();
    const hasYear = v.includes(y);
    const hasDay = new RegExp('(^|\\D)0?' + parseInt(d, 10) + '(\\D|$)').test(v);
    const hasMonth = v.includes(MONTHS[parseInt(m, 10) - 1].toLowerCase()) || new RegExp('(^|\\D)0?' + parseInt(m, 10) + '(\\D|$)').test(v);
    return hasYear && hasDay && hasMonth;
  }

  // Lien court affiché sur la page (ex. Miedjia.lnk.to/Pourquoi_Tu_Mas_Blesse)
  function findShortLink(slug) {
    const text = document.body.innerText || '';
    const all = text.match(/[A-Za-z0-9.-]+\.lnk\.to\/[A-Za-z0-9_\-%.]+/g) || [];
    const bySlug = slug ? all.find(l => l.toLowerCase().endsWith('/' + slug.toLowerCase())) : null;
    return bySlug || all[0] || null;
  }

  // ---------- Étapes ----------
  class StepError extends Error {}
  const fail = (msg) => { throw new StepError(msg); };

  const steps = {
    async start(job, s) {
      if (pageHas(/choose link type/i)) return; // déjà sur le bon écran
      // revenir à l'accueil si besoin
      const CREATE = /^\+?\s*create (a )?(new )?link$/i;
      const homeHere = await waitFor(() => findByText(CREATE).length, 3000);
      if (homeHere) await patch(st => { st.homeUrl = location.href; });
      let ok = await clickText(CREATE, { timeout: 4000 });
      if (!ok) {
        // 1) boutons de retour de l'interface
        for (const re of [/^exit$/i, /^back to home$/i, /^dashboard$/i, /^links$/i]) {
          if (await clickText(re, { timeout: 1500 })) {
            await sleep(2000);
            const dlg = [...document.querySelectorAll('[role=dialog], [class*="modal" i]')].find(visible);
            if (dlg) await clickText(/^(exit|leave|discard|yes|ok|continue)$/i, { timeout: 2000, within: dlg });
            ok = await clickText(CREATE, { timeout: 5000 });
            if (ok) break;
          }
        }
      }
      if (!ok && s.homeUrl && (s.startReloads || 0) < 2) {
        // 2) recharger l'accueil mémorisé (le moteur reprendra tout seul après le rechargement)
        await patch(st => { st.startReloads = (st.startReloads || 0) + 1; });
        location.href = s.homeUrl;
        setTimeout(() => location.reload(), 300);
        await sleep(20000);
      }
      if (!ok) fail('Je ne trouve pas le bouton « Create link ». Ouvre l’accueil Linkfire, clique dessus toi-même, puis « Continuer ».');
      await patch(st => { st.homeUrl = st.homeUrl || location.href; st.startReloads = 0; });
      if (!await waitFor(() => pageHas(/choose link type/i), 15000)) {
        fail('L’écran « Choose link type » ne s’est pas affiché.');
      }
    },

    async chooseType() {
      const ok = await clickText(/^pre-?\s?release$/i, { timeout: 10000, prefer: 'button, [role=button], [role=radio], label, li, a' });
      if (!ok) fail('Je ne trouve pas l’option « Pre-release ».');
      if (!await waitFor(() => pageHas(/set ?up your pre-?release link/i), 15000)) {
        // certains écrans demandent un clic sur "Next"/"Continue"
        await clickText(/^(next|continue|select)$/i, { timeout: 2000 });
        if (!await waitFor(() => pageHas(/set ?up your pre-?release link/i), 10000)) {
          fail('L’écran « Setup your pre-release link » ne s’est pas affiché.');
        }
      }
    },

    async fillSetup(job) {
      const warnings = [];

      // 1. Cover
      if (job.cover) {
        let fileInput = [...document.querySelectorAll('input[type=file]')][0];
        if (!fileInput) {
          await clickText(/^(add|upload|change) image$/i, { timeout: 2000 });
          fileInput = await waitFor(() => document.querySelector('input[type=file]'), 3000);
        }
        if (fileInput) {
          const dt = new DataTransfer();
          dt.items.add(dataUrlToFile(job.cover, job.coverName));
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('input', { bubbles: true }));
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(1500);
          // fenêtre de recadrage éventuelle
          const dlg = document.querySelector('[role=dialog], [class*="modal" i]');
          if (dlg && visible(dlg)) await clickText(/^(save|apply|crop|done|upload|confirm|ok)$/i, { timeout: 3000, within: dlg });
        } else {
          warnings.push('cover non ajoutée (champ introuvable)');
        }
      }

      // 2. Titre
      const title = fieldBlock(/^title\s*\*?\s*[?ⓘi]?$/i);
      if (!title) fail('Champ « Title » introuvable.');
      setNativeValue(title.input, job.title);
      await sleep(200);

      // 3. Artiste(s)
      for (const a of job.artists.slice(0, 1)) { // artiste principal uniquement
        const blk = fieldBlock(/^artists?\s*\*?$/i);
        if (!blk) fail('Champ « Artist » introuvable.');
        const inp = await openCombobox(blk);
        if (!inp) fail('Je n’arrive pas à ouvrir la liste « Artist ». Choisis l’artiste à la main, puis « Continuer ».');
        const ok = await selectInCombobox(inp, a);
        if (!ok) {
          setNativeValue(inp, '');
          await closeMenus();
          fail(`Artiste « ${a} » introuvable dans la liste Linkfire. Choisis-le à la main, puis « C’est fait à la main → suite ».`);
        }
      }
      await closeMenus();
      if (!onSetupScreen()) fail('L’écran de création s’est fermé. Supprime le brouillon vide « Untitled link » puis clique « Arrêter » et relance.');
      if (warnings.length) await log('⚠️ ' + job.title + ' : ' + warnings.join(', '));
    },

    async fillLink(job) {
      const warnings = [];
      if (!onSetupScreen()) fail('Je ne suis plus sur l’écran « Setup your pre-release link ». S’il reste un brouillon vide « Untitled link », supprime-le, puis « Arrêter » et relance.');
      // Lien : domaine + fin d'URL
      const lb = fieldBlock(/^link$/i);
      if (!lb) fail('Champ « Link » introuvable.');
      const linkInputs = (lb.inputs || [lb.input]).filter(i => i.tagName !== 'SELECT');
      // domaine : on tente de choisir celui de l'artiste (ex. Miedjia.lnk.to)
      try {
        const domainTrigger = lb.container.querySelector('select, [role=combobox], [class*="select" i], [class*="control" i]');
        if (domainTrigger && job.artists[0]) {
          const want = norm(job.artists[0]).replace(/ /g, '');
          const before = ownText(domainTrigger);
          if (!norm(before).replace(/ /g, '').includes(want)) {
            const re = new RegExp('^' + want.split('').join('[^a-z0-9]*') + '[^a-z0-9]*\\.?lnk\\.to', 'i');
            const okDomain = await chooseFromDropdown(domainTrigger, { test: (t) => re.test(norm(t).replace(/ /g, '').replace('lnkto', '.lnk.to')) || norm(t).replace(/ /g, '').startsWith(want + 'lnk') });
            if (!okDomain) { await closeMenus(); warnings.push('domaine de l’artiste absent, domaine par défaut gardé'); }
          }
        }
      } catch (e) { warnings.push('domaine non modifié'); }
      await sleep(300);
      const lb2 = fieldBlock(/^link$/i);
      const slugInput = [...lb2.container.querySelectorAll('input:not([type=hidden]):not([role=combobox])')]
        .filter(visible).filter(i => !i.closest('[class*="select" i]')).pop() || linkInputs.pop();
      if (!slugInput) fail('Champ de fin de lien introuvable.');
      setNativeValue(slugInput, job.slug);
      slugInput.dispatchEvent(new Event('blur', { bubbles: true }));
      await sleep(1500);
      if (/not available|unavailable|already (in use|taken|exists)|is taken/i.test(lb2.container.innerText || '')) {
        fail(`Le lien « ${job.slug} » est déjà pris. Change la fin du lien à la main, puis « Continuer ».`);
      }
      if (warnings.length) await log('⚠️ ' + job.title + ' : ' + warnings.join(', '));
    },

    async createDraft() {
      const ok = await clickText(/^create draft$/i, { timeout: 8000 });
      if (!ok) fail('Bouton « Create draft » introuvable.');
      const ready = await waitFor(() => findByText(/^rescan link$/i).length || pageHas(/pre-?release services/i), 30000);
      if (!ready) fail('Le brouillon ne s’est pas ouvert (pas d’écran d’édition après « Create draft »).');
      await sleep(1000);
    },

    async openRescan() {
      const ok = await clickText(/^rescan link$/i, { timeout: 10000, prefer: 'a, button, [role=button], [role=tab], li' });
      if (!ok) fail('Menu « Rescan link » introuvable.');
      if (!await waitFor(() => pageHas(/scan using/i), 15000)) fail('La section « Rescan link » ne s’est pas affichée.');
      await sleep(500);
    },

    async fillRescan(job) {
      // Scan using : None → UPC, puis le code
      const sb = fieldBlock(/^scan using$/i);
      if (!sb) fail('« Scan using » introuvable.');
      const trig = sb.container.querySelector('select, [role=combobox], [class*="select" i], [class*="control" i], button');
      if (trig && !/\bupc\b/i.test(ownText(trig) + ' ' + (trig.value || ''))) {
        const ok = await chooseFromDropdown(trig, /^upc$/i);
        if (!ok) fail('Je n’arrive pas à choisir « UPC » dans « Scan using ».');
      }
      await sleep(500);
      const sb2 = fieldBlock(/^scan using$/i);
      const upcInput = [...sb2.container.querySelectorAll('input:not([type=hidden]):not([type=checkbox])')]
        .filter(visible).filter(i => !i.closest('[class*="select" i]') && i.getAttribute('role') !== 'combobox').pop();
      if (!upcInput) fail('Champ UPC introuvable.');
      setNativeValue(upcInput, job.upc);
      upcInput.dispatchEvent(new Event('blur', { bubbles: true }));
      await sleep(400);

      // Case "Schedule rescan"
      const cbs = [...document.querySelectorAll('input[type=checkbox], [role=checkbox]')];
      const cb = cbs.find(c => {
        const box = c.closest('label') || c.parentElement;
        return box && /schedule rescan/i.test(box.innerText || '');
      }) || cbs.find(c => {
        let n = c;
        for (let i = 0; i < 3 && n; i++) { n = n.parentElement; if (n && /^\s*schedule rescan/i.test(n.innerText || '')) return true; }
        return false;
      });
      if (!cb) fail('Case « Schedule rescan » introuvable.');
      const checked = cb.checked ?? (cb.getAttribute('aria-checked') === 'true');
      if (!checked) { realClick(cb.closest('label') || cb); await sleep(500); }

      // Date
      const db = await waitFor(() => fieldBlock(/^date$/i), 5000);
      if (!db) fail('Champ « Date » introuvable.');
      const dateInput = db.input;
      let dateOk = false;
      if (dateInput.type === 'date') {
        setNativeValue(dateInput, job.date);
        dateOk = dateInput.value === job.date;
      } else {
        for (const v of dateVariants(job.date)) {
          realClick(dateInput);
          setNativeValue(dateInput, v);
          await sleep(250);
          pressKey(dateInput, 'Enter');
          await sleep(350);
          dateInput.dispatchEvent(new Event('blur', { bubbles: true }));
          await sleep(250);
          const cur = fieldBlock(/^date$/i).input.value;
          if (looksLikeDate(cur, job.date)) { dateOk = true; break; }
        }
        await closeMenus();
      }
      if (!dateOk) {
        const [y, m, d] = job.date.split('-');
        fail(`Je n’ai pas réussi à mettre la date. Choisis le ${d}/${m}/${y} dans le calendrier, puis « Continuer ».`);
      }

      // Heure (seulement si précisée)
      if (job.time) {
        const tb = fieldBlock(/^time$/i);
        if (tb) {
          setNativeValue(tb.input, job.time);
          pressKey(tb.input, 'Enter');
          tb.input.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      }
      await sleep(400);
    },

    async scheduleRescan() {
      // bouton du bas « Schedule rescan » (pas la case à cocher)
      const btn = await waitFor(() => findByText(/^schedule rescan$/i)
        .map(clickable)
        .find(c => c.matches('button, a, [role=button]') && !c.querySelector('input[type=checkbox]') && !c.disabled), 5000);
      if (btn) {
        realClick(btn);
        await sleep(2000);
      } else {
        await log('ℹ️ Pas de bouton « Schedule rescan » séparé : la programmation sera enregistrée avec la publication.');
      }
    },

    async publish() {
      const ok = await clickText(/^publish$/i, { timeout: 8000 });
      if (!ok) fail('Bouton « Publish » introuvable.');
      await sleep(1200);
      // fenêtre de confirmation éventuelle
      const dlg = [...document.querySelectorAll('[role=dialog], [class*="modal" i]')].find(visible);
      if (dlg) await clickText(/^(publish|confirm|yes|ok)$/i, { timeout: 3000, within: dlg });
      const done = await waitFor(() => pageHas(/published|changes saved|successfully|saved/i) || !findByText(/^publish$/i).length, 15000);
      if (!done) fail('Je n’ai pas vu de confirmation de publication. Vérifie et clique « Publish » si besoin, puis « Continuer ».');
      await sleep(800);
    },

    async collect(job) {
      const link = await waitFor(() => findShortLink(job.slug), 8000);
      await patch(s => {
        const j = s.queue[s.current];
        j.link = link ? 'https://' + link : '';
        j.status = 'done';
      });
      await log('✅ ' + job.title + (link ? ' → ' + link : ' (lien à récupérer à la main)'));
    }
  };

  // ---------- Boucle ----------
  let busy = false;

  async function run() {
    if (busy) return;
    busy = true;
    try {
      while (true) {
        const s = await getState();
        if (!s || !s.running || s.paused) break;
        const job = s.queue[s.current];
        if (!job) {
          await patch(st => { st.running = false; st.step = null; });
          await log('🏁 Terminé.');
          break;
        }
        if (job.status === 'done' || job.status === 'skipped') {
          await patch(st => { st.current++; st.step = 'start'; });
          continue;
        }
        const step = s.step || 'start';
        if (s.mode === 'guide' && !s.stepApproved) {
          await patch(st => { st.paused = true; st.pauseKind = 'guide'; st.pauseReason = 'Prochaine étape : ' + STEP_LABELS[step]; });
          break;
        }
        await patch(st => { st.queue[st.current].status = 'running'; st.stepApproved = false; });
        render();
        try {
          await steps[step](job, s);
          const idx = STEPS.indexOf(step);
          await patch(st => {
            if (idx === STEPS.length - 1) { st.current++; st.step = 'start'; }
            else st.step = STEPS[idx + 1];
          });
        } catch (e) {
          const msg = e instanceof StepError ? e.message : ('Erreur inattendue : ' + (e && e.message));
          await patch(st => { st.paused = true; st.pauseKind = 'error'; st.pauseReason = msg; st.queue[st.current].error = msg; });
          await log('⛔ ' + job.title + ' — ' + STEP_LABELS[step] + ' : ' + msg);
          break;
        }
      }
    } finally {
      busy = false;
      render();
    }
  }

  // ---------- Diagnostic (à copier pour Claude si quelque chose casse) ----------
  function diagnostic(s) {
    const items = [];
    const sel = 'button, a, label, input, textarea, select, [role], h1, h2, h3, h4, [class*="label" i]';
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const d = {
        tag: el.tagName.toLowerCase(),
        text: ownText(el).slice(0, 60),
        type: el.getAttribute('type') || undefined,
        role: el.getAttribute('role') || undefined,
        name: el.getAttribute('name') || undefined,
        ph: el.getAttribute('placeholder') || undefined,
        aria: el.getAttribute('aria-label') || undefined,
        id: el.id || undefined,
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80) || undefined,
        val: el.value !== undefined && el.tagName !== 'BUTTON' ? String(el.value).slice(0, 40) : undefined
      };
      items.push(JSON.stringify(d));
      if (items.length > 400) break;
    }
    return [
      'LINKFIRE AUTO — DIAGNOSTIC',
      'URL : ' + location.href,
      'Étape : ' + (s && s.step) + ' / ' + (s && s.pauseReason),
      '---',
      ...items
    ].join('\n');
  }

  // ---------- Bandeau sur la page ----------
  let host, shadow;
  function ensureOverlay() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'lfa-host';
    host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
  }

  async function render() {
    const s = await getState();
    if (!s || (!s.running && !s.paused)) { if (host) host.remove(); host = null; return; }
    ensureOverlay();
    const job = s.queue[s.current];
    const total = s.queue.length;
    const doneCount = s.queue.filter(j => j.status === 'done').length;
    const isErr = s.paused && s.pauseKind === 'error';
    shadow.innerHTML = `
      <style>
        .box{font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;background:#111827;color:#f9fafb;border-radius:12px;padding:12px 14px;width:320px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
        .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
        .t{font-weight:700}
        .pill{font-size:11px;background:#374151;border-radius:99px;padding:2px 8px}
        .job{color:#d1d5db;margin-bottom:6px}
        .step{color:#93c5fd}
        .msg{margin:8px 0;padding:8px;border-radius:8px;background:${isErr ? '#7f1d1d' : '#1e3a8a'}}
        .row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
        button{font:600 12px system-ui;border:0;border-radius:8px;padding:7px 10px;cursor:pointer;background:#374151;color:#fff}
        button.p{background:#2563eb}
        button.d{background:#4b5563}
      </style>
      <div class="box">
        <div class="top"><span class="t">Linkfire Auto</span><span class="pill">${doneCount}/${total}</span></div>
        ${job ? `<div class="job">${escapeHtml(job.artists.join(', '))} — <b>${escapeHtml(job.title)}</b></div>` : ''}
        ${s.step && job ? `<div class="step">▶ ${STEP_LABELS[s.step]}</div>` : ''}
        ${s.paused ? `<div class="msg">${escapeHtml(s.pauseReason || 'En pause')}</div>` : ''}
        <div class="row">
          ${s.paused && s.pauseKind === 'guide' ? '<button class="p" data-a="go">Continuer</button>' : ''}
          ${isErr ? '<button class="p" data-a="retry">Réessayer</button><button data-a="manual">C’est fait à la main → suite</button><button data-a="skip">Passer ce titre</button>' : ''}
          ${!s.paused ? '<button data-a="pause">Pause</button>' : ''}
          <button class="d" data-a="stop">Arrêter</button>
          <button class="d" data-a="diag">Copier le diagnostic</button>
        </div>
      </div>`;
    shadow.querySelectorAll('button').forEach(b => b.addEventListener('click', () => onAction(b.dataset.a)));
  }

  function escapeHtml(t) {
    return String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function onAction(a) {
    if (a === 'diag') {
      const s = await getState();
      const txt = diagnostic(s);
      try { await navigator.clipboard.writeText(txt); alertBox('Diagnostic copié. Colle-le à Claude.'); }
      catch (e) { const w = window.open('', '_blank'); if (w) w.document.body.innerText = txt; }
      return;
    }
    await patch(s => {
      if (a === 'go') { s.paused = false; s.stepApproved = true; }
      if (a === 'retry') { s.paused = false; s.stepApproved = true; }
      if (a === 'manual') {
        const idx = STEPS.indexOf(s.step || 'start');
        if (idx === STEPS.length - 1) { s.queue[s.current].status = 'done'; s.current++; s.step = 'start'; }
        else s.step = STEPS[idx + 1];
        s.paused = false; s.stepApproved = true;
      }
      if (a === 'skip') { s.queue[s.current].status = 'skipped'; s.current++; s.step = 'start'; s.paused = false; s.stepApproved = true; }
      if (a === 'pause') { s.paused = true; s.pauseKind = 'guide'; s.pauseReason = 'En pause. Prochaine étape : ' + STEP_LABELS[s.step || 'start']; }
      if (a === 'stop') { s.running = false; s.paused = false; }
    });
    render();
    run();
  }

  function alertBox(t) {
    ensureOverlay();
    const d = document.createElement('div');
    d.textContent = t;
    d.style.cssText = 'font:13px system-ui;background:#065f46;color:#fff;padding:8px 10px;border-radius:8px;margin-top:6px';
    shadow.appendChild(d);
    setTimeout(() => d.remove(), 3000);
  }

  // ---------- Démarrage ----------
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    const nv = changes[KEY].newValue;
    render();
    if (nv && nv.running && !nv.paused) run();
  });

  // Si on arrive sur la page en cours de série (rechargement), on reprend.
  setTimeout(async () => {
    const s = await getState();
    render();
    if (s && s.running && !s.paused) run();
  }, 1200);

  // exposé pour les tests
  window.__lfa = { steps, run, fieldBlock, findByText, findShortLink, dateVariants, looksLikeDate };
})();
