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
