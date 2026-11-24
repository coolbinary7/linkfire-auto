// Ouvre le panneau latéral quand on clique sur l'icône de l'extension.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

const LF_URL = 'https://app.linkfire.com/*';

// Le panneau demande d'ouvrir / trouver l'onglet Linkfire.
// separateWindow : Linkfire part dans sa propre fenêtre, pour continuer à travailler ailleurs.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ensureLinkfireTab') {
    (async () => {
      const tabs = await chrome.tabs.query({ url: LF_URL });
      let tab = tabs.find(t => t.active) || tabs[0];
      if (msg.separateWindow) {
        if (tab) {
          const win = await chrome.windows.get(tab.windowId, { populate: true });
          if (win.tabs.length > 1) {
            // sortir l'onglet Linkfire de la fenêtre principale
            await chrome.windows.create({ tabId: tab.id, width: 1200, height: 850, focused: true });
          } else {
            await chrome.windows.update(tab.windowId, { focused: true, state: 'normal' });
          }
        } else {
          const w = await chrome.windows.create({ url: 'https://app.linkfire.com/', width: 1200, height: 850, focused: true });
          tab = w.tabs[0];
        }
        tab = (await chrome.tabs.query({ url: LF_URL }))[0] || tab;
      } else if (!tab) {
        tab = await chrome.tabs.create({ url: 'https://app.linkfire.com/' });
      } else {
        await chrome.tabs.update(tab.id, { active: true });
      }
      if (tab) {
        // Chrome ne doit pas « endormir » cet onglet pendant la série
        chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
        if (msg.reload) await chrome.tabs.reload(tab.id);
        await chrome.storage.local.set({ lfa_tab: tab.id });
      }
      sendResponse({ tabId: tab && tab.id });
    })();
    return true;
  }
});

// ---------- Alertes : seulement en cas de souci, et à la fin ----------
function setBadge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  if (color) chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/128.png',
    title,
    message,
    priority: 2,
    requireInteraction: true
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.lfa) return;
  const before = changes.lfa.oldValue || {};
  const s = changes.lfa.newValue;
  if (!s) return;
  const job = s.queue && s.queue[s.current];
  const done = (s.queue || []).filter(j => j.status === 'done').length;
  const total = (s.queue || []).length;

  // nouveau blocage
  const blocked = s.running && s.paused && s.pauseKind === 'error';
  const wasBlocked = before.running && before.paused && before.pauseKind === 'error' && before.current === s.current && before.pauseReason === s.pauseReason;
  if (blocked && !wasBlocked) {
    setBadge('!', '#dc2626');
    notify('lfa-blocked', 'Auto Release a besoin de toi',
      `${job ? job.artists.join(', ') + ' — ' + job.title + ' : ' : ''}${s.pauseReason || 'blocage'}`);
    return;
  }

  // en cours : compteur sur l'icône
  if (s.running && !s.paused) {
    chrome.notifications.clear('lfa-blocked');
    setBadge(`${done}/${total}`, '#2563eb');
    return;
  }

  // fin de série
  if (!s.running && before.running) {
    chrome.notifications.clear('lfa-blocked');
    const skipped = (s.queue || []).filter(j => j.status === 'skipped').length;
    if (done === total && total) {
      setBadge('✓', '#059669');
      notify('lfa-done', 'Auto Release : liens Linkfire terminés', `${done} lien(s) créé(s). Ouvre le panneau pour les copier.`);
    } else {
      setBadge('', null);
      if (done || skipped) notify('lfa-done', 'Auto Release : série Linkfire arrêtée', `${done}/${total} lien(s) créé(s)${skipped ? `, ${skipped} passé(s)` : ''}.`);
    }
  }
});

// Clic sur la notification : on amène la fenêtre Linkfire devant
chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith('lfa-')) return;
  const { lfa_tab } = await chrome.storage.local.get('lfa_tab');
  let tab = null;
  try { if (lfa_tab) tab = await chrome.tabs.get(lfa_tab); } catch (e) { tab = null; }
  if (!tab) tab = (await chrome.tabs.query({ url: LF_URL }))[0];
  if (tab) {
    await chrome.windows.update(tab.windowId, { focused: true, state: 'normal' });
    await chrome.tabs.update(tab.id, { active: true });
  }
  chrome.notifications.clear(id);
});

// ---------- Surveillance RWS : attendre que tous les voyants soient verts, puis notifier ou publier ----------
// La surveillance tourne ici (en arrière-plan) : le panneau peut être fermé, mais Chrome et l'onglet RWS doivent rester ouverts.
try { importScripts('rwsauto.js'); } catch (e) { /* déjà chargé */ }
const WKEY = 'lfa-watch';
const NKEY = 'lfa-watch-notifs';
const PERIOD_MIN = 1;          // vérification chaque minute
const RELOAD_EVERY = 3;        // la page est rechargée toutes les 3 vérifications (les voyants se mettent à jour au rechargement)
const MAX_HOURS = 12;
const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));
const getWatch = async () => (await chrome.storage.local.get(WKEY))[WKEY] || [];
const setWatch = (l) => chrome.storage.local.set({ [WKEY]: l });
const lightsTxt = (ls) => (ls || []).map(l => `${l.state === 'green' ? '🟢' : l.state === 'red' ? '🔴' : '⚪'} ${l.name}`).join('  ');

async function notify(title, message, buttons, data) {
  const id = 'lfa-' + Date.now() + Math.random().toString(36).slice(2, 5);
  await chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/128.png', title, message, priority: 2, requireInteraction: !!buttons, buttons: buttons || [] });
  if (data) { const n = (await chrome.storage.local.get(NKEY))[NKEY] || {}; n[id] = data; await chrome.storage.local.set({ [NKEY]: n }); }
  return id;
}
async function runIn(tabId, step, opts) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: lfaRwsStep, args: [step, opts || {}] });
  return (res && res.result) || { ok: false, error: 'pas de réponse de la page' };
}
async function findTab(w) {
  try { const t = await chrome.tabs.get(w.tabId); if (t && (t.url || '').includes('/' + w.key)) return t; } catch (e) { /* fermé */ }
  const all = await chrome.tabs.query({ url: 'https://apps.rws.umusic.net/*' });
  return all.find(t => (t.url || '').includes('/' + w.key)) || null;
}
async function waitComplete(tabId) {
  for (let i = 0; i < 60; i++) { await sleepMs(500); try { const t = await chrome.tabs.get(tabId); if (t.status === 'complete') break; } catch (e) { return; } }
  await sleepMs(4000); // RWS charge ses données après la page
}
async function doPublish(w, tabId) {
  const r = await runIn(tabId, 'publish', {});
  if (r.ok) await notify('✅ Publié dans RWS', `${w.label} : Publish cliqué${r.published ? ' (statut mis à jour)' : ''}. Vérifie la page.`);
  else await notify('⚠️ Publication non faite', `${w.label} : ${r.error}. Ouvre RWS pour publier toi-même.`);
  return r;
}
let checking = false;
async function checkAll() {
  if (checking) return;
  checking = true;
  try {
    let list = await getWatch();
    for (const w of list) {
      if (w.done) continue;
      const tab = await findTab(w);
      if (!tab) { w.done = true; w.state = 'onglet fermé'; await notify('Surveillance RWS arrêtée', `${w.label} : l’onglet RWS a été fermé. Relance la surveillance depuis le panneau.`); continue; }
      w.tabId = tab.id;
      if (Date.now() - w.started > MAX_HOURS * 3600e3) { w.done = true; w.state = 'trop long'; await notify('Surveillance RWS arrêtée', `${w.label} : pas tout vert après ${MAX_HOURS} h. ${lightsTxt(w.lights)}`); continue; }
      w.n = (w.n || 0) + 1;
      if (w.n > 1 && w.n % RELOAD_EVERY === 0) { await chrome.tabs.reload(tab.id); await waitComplete(tab.id); }
      let r;
      try { r = await runIn(tab.id, 'lights'); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
      w.checked = Date.now();
      if (!r.ok) { w.state = 'lecture impossible : ' + r.error; continue; }
      w.lights = r.info.lights; w.state = r.info.allGreen ? 'tout est vert' : 'en attente';
      if (r.info.published) { w.done = true; w.state = 'publiée'; await notify('RWS : déjà publiée', `${w.label} est publiée.`); continue; }
      if (!r.info.lights.length) { w.state = 'voyants introuvables (envoie le diagnostic à Claude)'; continue; }
      if (r.info.allGreen) {
        w.done = true;
        if (w.action === 'publish') { w.state = 'publication…'; await setWatch(list); const p = await doPublish(w, tab.id); w.state = p.ok ? 'publiée' : 'publication refusée : ' + p.error; }
        else { w.state = 'notifiée'; await notify('🟢 Tout est vert dans RWS', `${w.label} : tous les voyants sont verts. Je publie ?`, [{ title: 'Publier maintenant' }, { title: 'Plus tard' }], { key: w.key, tabId: tab.id, label: w.label }); }
      }
    }
    list = list.filter(w => !w.done || Date.now() - (w.checked || w.started) < 24 * 3600e3);
    await setWatch(list);
    if (!list.some(w => !w.done)) chrome.alarms.clear('lfa-watch');
  } finally { checking = false; }
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'lfa-watch') checkAll(); });
chrome.notifications.onButtonClicked.addListener(async (id, idx) => {
  const n = (await chrome.storage.local.get(NKEY))[NKEY] || {};
  const d = n[id];
  chrome.notifications.clear(id);
  if (!d || idx !== 0) return;
  const w = { key: d.key, tabId: d.tabId, label: d.label };
  const tab = await findTab(w);
  if (!tab) return notify('⚠️ Publication non faite', `${d.label} : l’onglet RWS est fermé.`);
  await doPublish(w, tab.id);
  const list = await getWatch(); const x = list.find(y => y.key === d.key); if (x) { x.state = 'publiée (après notification)'; await setWatch(list); }
});
chrome.notifications.onClicked.addListener(async (id) => {
  const d = ((await chrome.storage.local.get(NKEY))[NKEY] || {})[id];
  if (d) { try { const t = await chrome.tabs.get(d.tabId); await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); } catch (e) { /* rien */ } }
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !/^watch/.test(msg.type || '')) return;
  (async () => {
    let list = await getWatch();
    if (msg.type === 'watchStart') {
      list = list.filter(w => w.key !== msg.key);
      list.push({ key: msg.key, tabId: msg.tabId, kind: msg.kind, label: msg.label || msg.key, action: msg.action === 'publish' ? 'publish' : 'notify', started: Date.now(), n: 0, state: 'démarrage' });
      await setWatch(list);
      await chrome.alarms.create('lfa-watch', { periodInMinutes: PERIOD_MIN, delayInMinutes: PERIOD_MIN });
      checkAll();
    } else if (msg.type === 'watchStop') {
      list = list.filter(w => w.key !== msg.key); await setWatch(list);
      if (!list.some(w => !w.done)) chrome.alarms.clear('lfa-watch');
    } else if (msg.type === 'watchNow') { await checkAll(); }
    sendResponse({ ok: true });
  })();
  return true;
});
// au redémarrage de Chrome : on reprend les surveillances en cours
chrome.runtime.onStartup.addListener(async () => { if ((await getWatch()).some(w => !w.done)) chrome.alarms.create('lfa-watch', { periodInMinutes: PERIOD_MIN }); });
