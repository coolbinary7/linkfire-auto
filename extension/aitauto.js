// AIT (ait.umgapps.com) : brouillon d'ingestion audio, d'après l'enregistrement de Ced (11/11/2026).
// Fonction injectée par le panneau (chrome.scripting) : autonome.
// step : 'start' (New Draft + UPC + Submit) | 'state' (fichiers / pistes) | 'map' (associe chaque fichier à la bonne piste)
// Le « Submit Job » n'est JAMAIS cliqué : il reste à l'utilisateur.
async function lfaAitStep(step, o) {
  o = o || {};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const vis = (el) => !!el && el.getClientRects().length > 0;
  async function until(fn, ms = 10000, every = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { let v; try { v = fn(); } catch (e) { v = null; } if (v) return v; await sleep(every); } return null; }
  const secs = (t) => { const m = String(t || '').match(/(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : NaN; };
  const DUR = /\d{2}:\d{2}:\d{2}(?:\.\d+)?/;

  // --- lecture de l'écran ---
  function fileRowsLeft() { return [...document.querySelectorAll('table.audio-resource-list tbody tr')].filter(tr => !tr.classList.contains('filler-row') && /\.(wav|flac|aif+|mp3)\b/i.test(tr.innerText)); }
  function fileOf(tr) { const t = tr.innerText.replace(/\s+/g, ' '); return { name: (t.match(/\S+\.(?:wav|flac|aiff?|mp3)\b/i) || [''])[0], dur: secs((t.match(DUR) || [''])[0]), row: tr }; }
  function trackBlocks() {
    // chaque piste : un bloc (tbody) dans la liste virtualisée ; ligne 1 = la piste, ligne 2 = le fichier associé (s'il y en a un)
    return [...document.querySelectorAll('table.product-track-list tbody')].map(tb => {
      const rows = [...tb.querySelectorAll(':scope > tr')];
      const tr = rows.find(r => /[A-Z]{2}[A-Z0-9]{3}\d{7}/.test(r.innerText)) || rows[0];
      if (!tr) return null;
      const t = tr.innerText.replace(/\s+/g, ' ').trim();
      const isrc = (t.match(/[A-Z]{2}[A-Z0-9]{3}\d{7}/) || [''])[0];
      const n = +((t.match(/^\d+/) || [0])[0]);
      const title = t.replace(/^\d+\s*/, '').replace(DUR, '').replace(isrc, '').trim();
      const fr = rows.find(r => r !== tr && /\.(wav|flac|aiff?|mp3)\b/i.test(r.innerText));
      return { n, title, dur: secs((t.match(DUR) || [''])[0]), isrc, file: fr ? fileOf(fr).name : '', block: tb, numCell: tr.querySelector('td.center') || tr.cells[0] };
    }).filter(Boolean).filter(t => t.n || t.isrc);
  }
  async function allTracks() {
    // la liste est virtualisée : on la fait défiler pour tout lire
    const grid = document.querySelector('table.product-track-list .ReactVirtualized__Grid');
    const seen = new Map();
    const take = () => { for (const t of trackBlocks()) seen.set(t.n + '|' + t.isrc, t); };
    take();
    if (grid) { for (let y = 0; y <= grid.scrollHeight; y += Math.max(100, grid.clientHeight - 40)) { grid.scrollTop = y; await sleep(120); take(); } grid.scrollTop = 0; await sleep(120); }
    return [...seen.values()].sort((a, b) => a.n - b.n);
  }
  async function showTrack(n) {
    const grid = document.querySelector('table.product-track-list .ReactVirtualized__Grid');
    let t = trackBlocks().find(x => x.n === n);
    for (let y = 0; !t && grid && y <= grid.scrollHeight; y += 80) { grid.scrollTop = y; await sleep(100); t = trackBlocks().find(x => x.n === n); }
    if (t) t.numCell.scrollIntoView({ block: 'center' });
    return t;
  }

  // --- glisser-déposer HTML5 (comme à la main) ---
  function dragDrop(src, dst) {
    const dt = new DataTransfer();
    const at = (el) => { const r = el.getBoundingClientRect(); return { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }; };
    const fire = (el, type, pos) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, ...pos }));
    const ps = at(src), pd = at(dst);
    src.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ...ps }));
    fire(src, 'dragstart', ps);
    fire(src, 'drag', ps);
    fire(dst, 'dragenter', pd);
    fire(dst, 'dragover', pd);
    fire(dst, 'drop', pd);
    fire(src, 'dragend', pd);
  }

  // --- quel fichier pour quelle piste ---
  function plan(tracks, files) {
    const numIn = (name) => { const m = name.replace(/\.[^.]+$/, '').match(/(?:^|[^a-z0-9])(?:part(?:ie)?|snippet|extrait|track|piste|pt)?[\s_-]*0*(\d{1,3})(?:[^0-9]|$)/gi); if (!m) return null; const last = m[m.length - 1].match(/(\d{1,3})/); return last ? +last[1] : null; };
    const words = (s) => norm(s).replace(/snippet\s*\d+/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2);
    const score = (t, f) => {
      let s = 0;
      const fn = norm(f.name);
      if (t.isrc && fn.includes(t.isrc.toLowerCase())) s += 100;
      const snip = (t.title.match(/snippet\s*(\d+)/i) || [])[1];
      const want = snip ? +snip : t.n;
      const got = numIn(f.name);
      if (got !== null && got === want) s += 40;
      const tw = words(t.title); if (tw.length) s += 10 * tw.filter(w => fn.includes(w)).length / tw.length;
      if (!isNaN(t.dur) && !isNaN(f.dur)) { const d = Math.abs(t.dur - f.dur); s += d <= 1.5 ? 30 : d <= 3 ? 10 : -40; }
      return s;
    };
    const pairs = [];
    for (const t of tracks) for (const f of files) pairs.push({ t, f, s: score(t, f) });
    pairs.sort((a, b) => b.s - a.s);
    const usedT = new Set(), usedF = new Set(), out = new Map();
    for (const p of pairs) { if (usedT.has(p.t.n) || usedF.has(p.f.name)) continue; usedT.add(p.t.n); usedF.add(p.f.name); out.set(p.t.n, { file: p.f.name, score: p.s, durGap: Math.abs(p.t.dur - p.f.dur) }); }
    return out;
  }

  try {
    if (step === 'start') {
      if (document.querySelector('table.product-track-list')) {
        const txt = document.body.innerText;
        if (o.upc && !txt.includes(o.upc) && !txt.includes(o.upc.replace(/^0+/, ''))) return { ok: false, error: `un autre brouillon est ouvert dans AIT (UPC ${o.upc} absent) : ouvre « New Draft » ou le bon brouillon` };
        return { ok: true, already: true };
      }
      let inp = document.querySelector('input[name=upc]');
      if (!inp || !vis(inp)) {
        const nd = [...document.querySelectorAll('td, a, button')].filter(vis).find(e => norm(e.innerText) === 'new draft');
        if (nd) nd.click();
        inp = await until(() => { const i = document.querySelector('input[name=upc]'); return i && vis(i) ? i : null; }, 8000);
      }
      if (!inp) return { ok: false, error: 'champ « UPC or ISRC » introuvable (clique « New Draft »)' };
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, o.upc);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
      const sub = (inp.form && inp.form.querySelector('button[type=submit]')) || [...document.querySelectorAll('button')].find(b => norm(b.innerText) === 'submit');
      if (!sub) return { ok: false, error: 'bouton « Submit » introuvable' };
      sub.click();
      if (!await until(() => document.querySelector('table.product-track-list') && trackBlocks().length, 30000)) return { ok: false, error: 'la liste des pistes du produit ne s’affiche pas (UPC inconnu d’AIT ?)' };
      return { ok: true };
    }

    if (step === 'state') {
      const files = fileRowsLeft().map(fileOf);
      const tracks = (await allTracks()).map(t => ({ n: t.n, title: t.title, dur: t.dur, isrc: t.isrc, file: t.file }));
      const analyzing = /analyzing/i.test(document.body.innerText);
      const sj = [...document.querySelectorAll('button')].find(b => /submit job/i.test(b.innerText));
      const status = sj ? ((sj.parentElement && sj.parentElement.innerText) || '').replace(/\s+/g, ' ').replace(/submit job/i, '').trim().slice(0, 120) : '';
      return { ok: true, files: files.map(f => ({ name: f.name, dur: f.dur })), tracks, analyzing, status };
    }

    if (step === 'map') {
      const log = [];
      let tracks = await allTracks();
      const files = [...new Map([...document.querySelectorAll('table.audio-resource-list tbody tr, table.product-track-list tbody tr')].filter(tr => /\.(wav|flac|aiff?|mp3)\b/i.test(tr.innerText)).map(fileOf).map(f => [f.name, f])).values()];
      if (!files.length) return { ok: false, error: 'aucun fichier audio dans AIT' };
      if (files.length !== tracks.length) log.push(`⚠️ ${files.length} fichier(s) pour ${tracks.length} piste(s)`);
      const want = plan(tracks, files);
      for (let pass = 0; pass < 2; pass++) {
        for (const t of tracks) {
          const w = want.get(t.n); if (!w) continue;
          const cur = await showTrack(t.n);
          if (!cur || cur.file === w.file) continue;
          // la poignée du bon fichier, où qu'il soit (liste de gauche ou sous une autre piste)
          const fr = [...document.querySelectorAll('table.audio-resource-list tbody tr, table.product-track-list tbody tr')].find(tr => fileOf(tr).name === w.file);
          const handle = fr && (fr.querySelector('td.iconic svg') || fr.querySelector('td.iconic') || fr);
          if (!handle) { log.push(`fichier ${w.file} introuvable à l’écran`); continue; }
          dragDrop(handle, cur.numCell);
          await sleep(700);
        }
        tracks = await allTracks();
        if (tracks.every(t => !want.get(t.n) || t.file === want.get(t.n).file)) break;
      }
      const wrong = tracks.filter(t => want.get(t.n) && t.file !== want.get(t.n).file);
      const gaps = tracks.filter(t => want.get(t.n) && want.get(t.n).durGap > 2).map(t => `piste ${t.n} « ${t.title} » (${Math.round(t.dur)} s) ↔ ${want.get(t.n).file}`);
      if (gaps.length) log.push('⚠️ durées différentes : ' + gaps.join(' ; '));
      return { ok: !wrong.length, plan: tracks.map(t => ({ n: t.n, title: t.title, file: (want.get(t.n) || {}).file || '', now: t.file })), wrong: wrong.map(t => `piste ${t.n} « ${t.title} » ← ${want.get(t.n).file}`), log };
    }
    return { ok: false, error: 'étape inconnue' };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
