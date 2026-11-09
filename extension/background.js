// Ouvre le panneau latéral quand on clique sur l'icône de l'extension.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Le panneau demande d'ouvrir / trouver l'onglet Linkfire.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ensureLinkfireTab') {
    (async () => {
      const tabs = await chrome.tabs.query({ url: 'https://app.linkfire.com/*' });
      let tab = tabs.find(t => t.active) || tabs[0];
      if (!tab) {
        tab = await chrome.tabs.create({ url: 'https://app.linkfire.com/' });
      } else {
        await chrome.tabs.update(tab.id, { active: true });
        // On recharge pour être sûr que le script de l'extension est bien présent
        if (msg.reload) await chrome.tabs.reload(tab.id);
      }
      sendResponse({ tabId: tab.id });
    })();
    return true;
  }
});
