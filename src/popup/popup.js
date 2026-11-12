/**
 * Saved Post Cleaner — toolbar popup
 *
 * The panel that actually controls the automation lives on the page itself
 * (content.js), not here — this popup only brings that panel back if you've
 * closed it (its ✕ button hides it until the page is reloaded or this runs).
 * On the Saved page it reveals the panel and closes itself; everywhere else
 * it just tells you where to go.
 *
 * Its two sentences are localized like the rest of the UI (see i18n.js).
 * The language setting is read before anything is rendered, so the popup
 * never flashes English first and then swaps — at this size that flash
 * would be most of the popup's visible lifetime.
 */

(() => {
  const messageEl = document.getElementById('igsc-popup-message');

  function isSavedPageUrl(url) {
    try {
      const u = new URL(url);
      // Keep in sync with isSavedPage() in content.js: the "All posts"
      // grid, a named collection, or the collections overview — the panel
      // shows on all three, so the popup should be able to bring it back
      // on all three.
      return (
        u.hostname === 'www.instagram.com' &&
        /^\/[A-Za-z0-9._]+\/saved(\/(all-posts|[^/]+\/\d+))?\/?$/.test(u.pathname)
      );
    } catch {
      return false;
    }
  }

  async function resolveT() {
    let saved = null;
    try {
      const data = await chrome.storage.sync.get(IGSC_SETTINGS_KEY);
      saved = data[IGSC_SETTINGS_KEY];
    } catch (err) {
      // Storage being unavailable is not worth failing the popup over —
      // igscResolveSettings(null) falls back to the defaults, which means
      // 'auto', which means the browser's own language.
      console.warn('[Saved Post Cleaner] Could not load settings, using recommended defaults:', err);
    }
    const locale = igscResolveLocale(igscResolveSettings(saved).language);
    document.documentElement.lang = locale;
    document.documentElement.dir = igscDirFor(locale);
    return igscMakeT(locale);
  }

  resolveT().then((t) => {
    messageEl.textContent = t('popupChecking');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.id && isSavedPageUrl(tab.url || '')) {
        chrome.tabs.sendMessage(tab.id, { type: 'IGSC_SHOW_PANEL' }, () => {
          // No listener yet — confirmed via testing to mean this tab's content
          // script predates the extension's current version (e.g. it was open
          // before a reload/update). chrome.runtime.lastError is set in that
          // case; a plain refresh of the page fixes it.
          if (chrome.runtime.lastError) {
            messageEl.textContent = t('popupRefresh');
            return;
          }
          window.close();
        });
      } else {
        messageEl.textContent = t('popupGoToSaved');
      }
    });
  });
})();
