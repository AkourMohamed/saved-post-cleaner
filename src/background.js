/**
 * Saved Post Cleaner — background service worker
 *
 * Two jobs, both tiny and stateless:
 *
 * 1. First install only: open the Settings page, which doubles as the
 *    "here's what this is and where to use it" page. Without it a fresh
 *    install gives a new toolbar icon and no other feedback — the most
 *    common way for an install to become an uninstall. (onInstalled is only
 *    available to extension pages, not content scripts.)
 *
 * 2. Toolbar icon click: take the user straight to their Instagram Saved
 *    posts and reveal the on-page panel. The panel never shows itself — this
 *    click is the only thing that brings it up.
 *
 *      - On a Saved page already      -> just reveal the panel.
 *      - On another instagram.com tab -> ask that tab's content script to
 *                                        navigate to Saved.
 *      - Anywhere else                -> open Saved in a new tab (or
 *                                        instagram.com if we don't yet know
 *                                        the username).
 *
 *    A "pending" marker in chrome.storage.local carries the intent across
 *    the page load: the content script in the destination page sees it and
 *    reveals the panel (or, if the username was still unknown, finishes the
 *    trip to Saved). Without it, a freshly loaded Saved page would stay
 *    hidden.
 */

const IGSC_PENDING_KEY = 'igscPending';
const IGSC_USER_KEY = 'igscUser';

// Keep in sync with SAVED_GRID_PATH / SAVED_ROOT_PATH in content.js.
const SAVED_PATH = /^\/[A-Za-z0-9._]+\/saved(\/(all-posts|[^/]+\/\d+))?\/?$/;

function isSavedUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'www.instagram.com' && SAVED_PATH.test(u.pathname);
  } catch (err) {
    return false;
  }
}

function isInstagramUrl(url) {
  try {
    return new URL(url).hostname === 'www.instagram.com';
  } catch (err) {
    return false;
  }
}

function savedUrlFor(username) {
  return 'https://www.instagram.com/' + encodeURIComponent(username) + '/saved/all-posts/';
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      // lastError is set when there's no listener (the tab's content script
      // predates this version of the extension, or the page isn't ready).
      resolve(chrome.runtime.lastError ? null : response || {});
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.storage.local.set({ [IGSC_PENDING_KEY]: { ts: Date.now() } });

  const data = await chrome.storage.local.get(IGSC_USER_KEY);
  const username = data[IGSC_USER_KEY];

  if (tab.id && tab.url && isSavedUrl(tab.url)) {
    if (await sendToTab(tab.id, { type: 'IGSC_SHOW_PANEL' })) return;
    // No listener: reloading re-injects the content script, which then
    // consumes the pending marker and reveals the panel.
    chrome.tabs.reload(tab.id);
    return;
  }

  if (tab.id && tab.url && isInstagramUrl(tab.url)) {
    const reply = await sendToTab(tab.id, { type: 'IGSC_GO_SAVED' });
    if (reply && reply.navigating) return;
    // Either the content script isn't there, or it couldn't work out the
    // username. Fall back to what we remember, else leave the pending marker
    // for the next load of instagram.com to finish the trip.
    chrome.tabs.update(tab.id, { url: username ? savedUrlFor(username) : tab.url });
    return;
  }

  chrome.tabs.create({ url: username ? savedUrlFor(username) : 'https://www.instagram.com/' });
});
