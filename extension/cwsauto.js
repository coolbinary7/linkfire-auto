// CWS (graphics.cws.umgapps.com) : cover d'une sortie, d'après l'enregistrement de Ced (13/11/2026).
// Recherche par UPC → « Add Resource » → page de la ressource → dépôt du TIFF (par l'utilisateur) → « Upload ».
// Injecté dans toutes les frames de l'onglet CWS (la zone de dépôt est une frame cimediacloud.com).
async function lfaCwsStep(step, o) {
  o = o || {};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const vis = (el) => !!el && el.getClientRects().length > 0;
  async function until(fn, ms = 10000, every = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { let v; try { v = fn(); } catch (e) { v = null; } if (v) return v; await sleep(every); } return null; }
  const host = location.hostname;
  const isCws = /cws\.umgapps\.com$/.test(host);
  const isUpload = /cimediacloud\.com$/.test(host);
  try {
    if (step === 'where') {
      if (isCws) {
        const m = location.pathname.match(/\/resources\/(\d+)/);
        const head = [...document.querySelectorAll('h1,h2,h3,h4')].map(h => h.innerText.trim()).find(t => /\|/.test(t)) || '';
        return { ok: true, frame: 'cws', page: m ? 'resource' : (/\/search/.test(location.pathname) ? 'search' : 'home'), resourceId: m ? m[1] : '', head, noFiles: /no files/i.test(head) };
      }
      if (isUpload) {
        const t = document.body ? document.body.innerText : '';
        const up = [...document.querySelectorAll('a, button')].filter(vis).find(b => /^upload \d+ files?$/i.test(norm(b.innerText)));
        const files = (t.match(/[^\s/\\]+\.(?:tiff?|jpe?g|png|psd)\b/gi) || []);
        return { ok: true, frame: 'upload', hash: location.hash, ready: !!up, uploading: /uploading now/i.test(t), complete: /#\/comp/.test(location.hash) || /uploaded/i.test(t) && !/uploading now/i.test(t), files: [...new Set(files)] };
      }
      return { ok: true, frame: 'other' };
    }

    if (step === 'search' && isCws) {
      // une ressource existe déjà pour cet UPC ? sinon « Add Resource »
      await until(() => document.querySelector('input[name=searchQuery]') || document.querySelector('a[href*="/resources/"]'), 15000);
      await sleep(800);
      const link = [...document.querySelectorAll('a[href*="/resources/"]')].filter(vis).find(a => /\/resources\/\d+/.test(a.getAttribute('href')));
      const add = [...document.querySelectorAll('button')].filter(vis).find(b => norm(b.innerText) === 'add resource' && !b.disabled);
      if (link && !add) return { ok: true, href: new URL(link.getAttribute('href'), location.href).href, existing: true };
      if (!add) return { ok: false, error: 'ni ressource existante ni bouton « Add Resource » pour cet UPC (UPC inconnu de CWS ?)' };
      const mail = document.querySelector('input[name=sendFileRequestEmail]');
      if (mail && mail.checked) mail.click(); // comme dans l'enregistrement : pas de mail de demande de fichier
      add.click();
      return { ok: true, clicked: true };
    }

    if (step === 'upload' && isUpload) {
      const files = ((document.body.innerText || '').match(/[^\s/\\]+\.(?:tiff?|jpe?g|png|psd)\b/gi) || []);
      const bad = files.filter(f => !/\.tiff?$/i.test(f));
      if (bad.length && !o.force) return { ok: false, error: `fichier refusé par CWS (TIF/TIFF carré uniquement) : ${bad.join(', ')}` };
      const up = [...document.querySelectorAll('a, button')].filter(vis).find(b => /^upload \d+ files?$/i.test(norm(b.innerText)));
      if (!up) return { ok: false, error: 'bouton « Upload » introuvable' };
      up.click();
      return { ok: true, files };
    }
    return { ok: true, skipped: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
