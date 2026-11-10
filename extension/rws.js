// Lecture d'une page de sortie RWS (apps.rws.umusic.net/releases/<UPC>).
// Cette fonction est injectée dans l'onglet RWS par le panneau (chrome.scripting),
// elle doit donc rester autonome (aucune variable extérieure).
async function lfaScanRwsPage() {
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const text = document.body ? document.body.innerText : '';
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  // UPC : d'abord dans l'adresse, sinon dans la page
  let upc = (location.pathname.match(/releases\/(\d{12,14})/) || [])[1] || '';
  let upcIdx = lines.findIndex(l => /^UPC\s*:?\s*\d{12,14}$/i.test(l));
  if (upcIdx < 0) upcIdx = lines.findIndex(l => /^UPC\b/i.test(l) && /\d{12,14}/.test(l));
  if (!upc && upcIdx >= 0) upc = (lines[upcIdx].match(/\d{12,14}/) || [])[0] || '';

  // Titre et artiste(s) : les deux lignes juste au-dessus de « UPC … »
  let title = '', artists = '';
  if (upcIdx >= 2) {
    title = lines[upcIdx - 1];
    artists = lines[upcIdx - 2];
  }

  // Date de sortie : « Global Release Date: 19-Nov-2026 23:50 »
  let date = '', time = '';
  const m = text.match(/Global Release Date\s*:?\s*(\d{1,2})[-\s\/]([A-Za-z]{3})[A-Za-z]*[-\s\/](\d{4})(?:\s+(\d{1,2}:\d{2}))?/i);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) date = `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    time = m[4] || '';
  }

  // Cover : la plus grande image carrée affichée (celle qu'on obtient avec « Enregistrer l'image sous »)
  let cover = '', coverUrl = '', coverSize = '', coverNote = '';
  try {
    const imgs = [...document.images].filter(i => {
      const r = i.getBoundingClientRect();
      const w = i.naturalWidth, h = i.naturalHeight;
      return i.complete && w >= 150 && h >= 150 && Math.abs(w / h - 1) < 0.15 && r.width > 40 && (i.currentSrc || i.src);
    });
    const hint = (i) => /cover|artwork|art|packshot|image/i.test([i.alt, i.className, i.id, i.currentSrc || i.src].join(' ')) ? 1 : 0;
    imgs.sort((a, b) => (hint(b) - hint(a)) || (b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight));
    const img = imgs[0];
    if (img) {
      coverUrl = img.currentSrc || img.src;
      coverSize = img.naturalWidth + ' × ' + img.naturalHeight;
      const toDataUrl = (blob) => new Promise((ok, ko) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = ko; f.readAsDataURL(blob); });
      try {
        const res = await fetch(coverUrl, { credentials: 'include' });
        const blob = await res.blob();
        if (res.ok && /^image\//.test(blob.type) && blob.size < 15e6) cover = await toDataUrl(blob);
      } catch (e) { /* image d'un autre site : on essaie autrement */ }
      if (!cover) {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          cover = c.toDataURL('image/jpeg', 0.95);
        } catch (e) { coverNote = 'image protégée'; }
      }
    } else coverNote = 'pas d’image de cover sur la page';
  } catch (e) { coverNote = String(e && e.message || e); }
  const ext = (cover.match(/^data:image\/(\w+)/) || [])[1] || 'jpg';
  const coverName = cover ? `${artists} - ${title}.${ext === 'jpeg' ? 'jpg' : ext}`.replace(/[\\/:*?"<>|]/g, '') : '';

  return { ok: !!(upc && title && artists && date), upc, title, artists, date, time, url: location.href, cover, coverName, coverUrl, coverSize, coverNote };
}
