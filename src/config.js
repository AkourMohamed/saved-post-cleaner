/**
 * Shared settings schema for Saved Post Cleaner.
 *
 * Loaded as a plain script (no bundler/build step) by both the content
 * script (content.js, via manifest content_scripts) and the options page
 * (options.html, via a <script> tag) so the default values and storage key
 * only live in one place. Both contexts get their own isolated global scope
 * (content scripts run in an isolated world; the options page is a separate
 * extension page), so declaring these here doesn't leak into Instagram's
 * own page or collide with anything.
 */

// chrome.storage.sync so settings follow the user across their signed-in
// Chrome installs. It's a handful of numbers/booleans, well under sync's
// per-item and total quota.
const IGSC_SETTINGS_KEY = 'igscSettings';

// chrome.storage.local — activity counters/log, kept separate from settings
// and per-device on purpose (no real benefit to syncing a skip log).
const IGSC_STATE_KEY = 'igscState';

// These are the values shown as "Recommended" on the options page. They
// match the "Balanced" pacing profile: roughly 2x a fully conservative pace,
// while keeping a periodic cooldown break and a session cap so an unattended
// run doesn't look like flat, continuous automated traffic.
const IGSC_DEFAULT_SETTINGS = {
  // 'auto' follows the browser's language preferences; any other value is
  // a language code from IGSC_LANGUAGES in i18n.js. Lives alongside the
  // pacing settings (rather than in its own storage key) so one write
  // covers the whole options form and "restore defaults" resets language
  // too.
  language: 'auto',
  // Escape hatch for an Instagram language or wording the shipped table in
  // i18n.js doesn't cover: the exact aria-label of the button that removes
  // a post from saved, as the user reads it on their own Instagram.
  // Comma-separated if more than one. Empty means "use the shipped table",
  // which is the right answer for almost everyone.
  customUnsaveLabel: '',
  minDelayMs: 1200,
  maxDelayMs: 2800,
  cooldownEnabled: true,
  cooldownEvery: 25,
  cooldownMinMs: 15000,
  cooldownMaxMs: 30000,
  maxActionsPerSession: 200,
};

// Merges saved settings over the defaults so any field a user never touched
// (or that didn't exist yet when they last saved) still gets a sane value.
function igscResolveSettings(saved) {
  return Object.assign({}, IGSC_DEFAULT_SETTINGS, saved || {});
}

// ---------------------------------------------------------------------
// Outbound links
//
// Both of these are hrefs the user may choose to click. Nothing here is
// ever fetched, pinged or preloaded by the extension itself — following
// one is an ordinary navigation the person initiated, which is why this
// doesn't affect the "makes no network calls" property or the Web Store
// data disclosure.
// ---------------------------------------------------------------------

const IGSC_SUPPORT_URL = 'https://paypal.me/meedruoka';

// Built from the extension's own id at runtime rather than hardcoded, so
// it survives the listing slug changing and works for anyone who forks and
// publishes their own copy.
//
// Returns null when there's no listing to review: Chrome injects
// update_url into the manifest only for Web Store installs, so its absence
// means this is an unpacked development copy. Pointing a dev build at a
// review page for an id that isn't listed would just 404.
function igscReviewUrl() {
  try {
    if (!chrome.runtime.getManifest().update_url) return null;
    return 'https://chromewebstore.google.com/detail/' + chrome.runtime.id + '/reviews';
  } catch (err) {
    return null;
  }
}
