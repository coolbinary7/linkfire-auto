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
