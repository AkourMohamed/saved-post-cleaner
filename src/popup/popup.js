/**
 * Saved Post Cleaner — toolbar popup
 *
 * The panel that actually controls the automation lives on the page itself
 * (content.js), not here — this popup only brings that panel back if you've
 * closed it (its ✕ button hides it until the page is reloaded or this runs).
 * On the Saved page it reveals the panel and closes itself; everywhere else
 * it just tells you where to go.
 */

(() => {
  const messageEl = document.getElementById('igsc-popup-message');

  function isSavedPageUrl(url) {
    try {
      const u = new URL(url);
      // Keep in sync with isSavedPage() in content.js — only the "All posts"
      // grid, not the bare /saved/ collections overview.
      return u.hostname === 'www.instagram.com' && /^\/[A-Za-z0-9._]+\/saved\/all-posts\/?$/.test(u.pathname);
    } catch {
      return false;
    }
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.id && isSavedPageUrl(tab.url || '')) {
      chrome.tabs.sendMessage(tab.id, { type: 'IGSC_SHOW_PANEL' }, () => {
        // No listener yet — confirmed via testing to mean this tab's content
        // script predates the extension's current version (e.g. it was open
        // before a reload/update). chrome.runtime.lastError is set in that
        // case; a plain refresh of the page fixes it.
        if (chrome.runtime.lastError) {
          messageEl.textContent = 'Refresh your Instagram Saved Posts page, then try again.';
          return;
        }
        window.close();
      });
    } else {
      messageEl.textContent = 'Go to your Instagram Saved Posts page to use this extension.';
    }
  });
})();
