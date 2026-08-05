/**
 * Saved Post Cleaner — options page
 *
 * Reads/writes the same chrome.storage.sync settings object the content
 * script uses (see config.js for the shape and defaults). Pure vanilla JS,
 * no build step — this is a small enough form that a framework wouldn't
 * earn its keep.
 */

(() => {
  const form = document.getElementById('settings-form');
  const statusEl = document.getElementById('options-status');
  const restoreBtn = document.getElementById('restore-btn');

  const fields = {
    minDelaySec: document.getElementById('minDelaySec'),
    maxDelaySec: document.getElementById('maxDelaySec'),
    cooldownEnabled: document.getElementById('cooldownEnabled'),
    cooldownEvery: document.getElementById('cooldownEvery'),
    cooldownMinSec: document.getElementById('cooldownMinSec'),
    cooldownMaxSec: document.getElementById('cooldownMaxSec'),
    maxActionsPerSession: document.getElementById('maxActionsPerSession'),
  };

  function updateCooldownFieldsDisabled() {
    const disabled = !fields.cooldownEnabled.checked;
    fields.cooldownEvery.disabled = disabled;
    fields.cooldownMinSec.disabled = disabled;
    fields.cooldownMaxSec.disabled = disabled;
  }

  function applySettingsToForm(settings) {
    fields.minDelaySec.value = settings.minDelayMs / 1000;
    fields.maxDelaySec.value = settings.maxDelayMs / 1000;
    fields.cooldownEnabled.checked = settings.cooldownEnabled;
    fields.cooldownEvery.value = settings.cooldownEvery;
    fields.cooldownMinSec.value = settings.cooldownMinMs / 1000;
    fields.cooldownMaxSec.value = settings.cooldownMaxMs / 1000;
    fields.maxActionsPerSession.value = settings.maxActionsPerSession;
    updateCooldownFieldsDisabled();
  }

  function readSettingsFromForm() {
    return {
      minDelayMs: Math.round(parseFloat(fields.minDelaySec.value) * 1000),
      maxDelayMs: Math.round(parseFloat(fields.maxDelaySec.value) * 1000),
      cooldownEnabled: fields.cooldownEnabled.checked,
      cooldownEvery: parseInt(fields.cooldownEvery.value, 10),
      cooldownMinMs: Math.round(parseFloat(fields.cooldownMinSec.value) * 1000),
      cooldownMaxMs: Math.round(parseFloat(fields.cooldownMaxSec.value) * 1000),
      maxActionsPerSession: parseInt(fields.maxActionsPerSession.value, 10),
    };
  }

  function validate(settings) {
    const errors = [];
    if (!(settings.minDelayMs > 0)) errors.push('Minimum delay must be greater than 0.');
    if (!(settings.maxDelayMs >= settings.minDelayMs)) errors.push('Maximum delay must be ≥ minimum delay.');
    if (settings.cooldownEnabled) {
      if (!(settings.cooldownEvery >= 1)) errors.push('Cooldown frequency must be at least 1.');
      if (!(settings.cooldownMinMs > 0)) errors.push('Cooldown minimum break must be greater than 0.');
      if (!(settings.cooldownMaxMs >= settings.cooldownMinMs)) errors.push('Cooldown maximum break must be ≥ minimum break.');
    }
    if (!(settings.maxActionsPerSession >= 1)) errors.push('Session limit must be at least 1.');
    return errors;
  }

  let statusTimer = null;
  function showStatus(text) {
    statusEl.textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.textContent = '';
    }, 4000);
  }

  async function load() {
    const data = await chrome.storage.sync.get(IGSC_SETTINGS_KEY);
    applySettingsToForm(igscResolveSettings(data[IGSC_SETTINGS_KEY]));
  }

  fields.cooldownEnabled.addEventListener('change', updateCooldownFieldsDisabled);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const settings = readSettingsFromForm();
    const errors = validate(settings);
    if (errors.length > 0) {
      showStatus(errors[0]);
      return;
    }
    await chrome.storage.sync.set({ [IGSC_SETTINGS_KEY]: settings });
    showStatus('Saved. Reload your Instagram Saved page to pick up the new settings.');
  });

  restoreBtn.addEventListener('click', async () => {
    applySettingsToForm(IGSC_DEFAULT_SETTINGS);
    await chrome.storage.sync.set({ [IGSC_SETTINGS_KEY]: IGSC_DEFAULT_SETTINGS });
    showStatus('Restored recommended defaults.');
  });

  load();
})();
