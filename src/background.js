/**
 * Saved Post Cleaner — background service worker
 *
 * Exists for exactly one reason: chrome.runtime.onInstalled is only
 * available to an extension page, not to a content script, and without it
 * a fresh install does nothing visible at all. The extension only shows
 * itself on one specific Instagram URL, so someone who installs it and
 * doesn't already know that gets a new toolbar icon and no other feedback
 * — the most common way for an install to become an uninstall.
 *
 * On first install (and only then — not on updates or browser restarts)
 * this opens the Settings page, which doubles as the "here's what this is
 * and where to use it" page. That is the whole worker; it registers no
 * other listeners and holds no state, so it stays unloaded the rest of
 * the time.
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  chrome.runtime.openOptionsPage();
});
