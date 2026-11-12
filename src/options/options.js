/**
 * Saved Post Cleaner — options page
 *
 * Reads/writes the same chrome.storage.sync settings object the content
 * script uses (see config.js for the shape and defaults). Pure vanilla JS,
 * no build step — this is a small enough form that a framework wouldn't
 * earn its keep.
 *
 * All visible text comes from the catalogs in i18n.js, keyed off the
 * data-i18n attributes in options.html. The language dropdown re-renders
 * the page the moment it changes — without saving — so you can see what a
 * language looks like before committing to it, and can find your way back
 * if you pick one by mistake.
 */

(() => {
  const form = document.getElementById('settings-form');
  const statusEl = document.getElementById('options-status');
  const restoreBtn = document.getElementById('restore-btn');

  const fields = {
    language: document.getElementById('language'),
    customUnsaveLabel: document.getElementById('customUnsaveLabel'),
    minDelaySec: document.getElementById('minDelaySec'),
    maxDelaySec: document.getElementById('maxDelaySec'),
    cooldownEnabled: document.getElementById('cooldownEnabled'),
    cooldownEvery: document.getElementById('cooldownEvery'),
    cooldownMinSec: document.getElementById('cooldownMinSec'),
    cooldownMaxSec: document.getElementById('cooldownMaxSec'),
    maxActionsPerSession: document.getElementById('maxActionsPerSession'),
  };

  // Rebuilt by render() whenever the selected language changes.
  let t = igscMakeT(IGSC_DEFAULT_LOCALE);

  // Pacing presets. These only touch the pacing/cooldown/session numbers —
  // language and the custom label are the user's own choices and are left
  // alone. "Balanced" is deliberately the same as the shipped defaults, so
  // there's exactly one recommended pace rather than two that disagree.
  const PRESETS = {
    careful: { minDelayMs: 2500, maxDelayMs: 5000, cooldownEnabled: true, cooldownEvery: 15, cooldownMinMs: 30000, cooldownMaxMs: 60000, maxActionsPerSession: 100 },
    balanced: {
      minDelayMs: IGSC_DEFAULT_SETTINGS.minDelayMs,
      maxDelayMs: IGSC_DEFAULT_SETTINGS.maxDelayMs,
      cooldownEnabled: IGSC_DEFAULT_SETTINGS.cooldownEnabled,
      cooldownEvery: IGSC_DEFAULT_SETTINGS.cooldownEvery,
      cooldownMinMs: IGSC_DEFAULT_SETTINGS.cooldownMinMs,
      cooldownMaxMs: IGSC_DEFAULT_SETTINGS.cooldownMaxMs,
      maxActionsPerSession: IGSC_DEFAULT_SETTINGS.maxActionsPerSession,
    },
    fast: { minDelayMs: 700, maxDelayMs: 1500, cooldownEnabled: true, cooldownEvery: 40, cooldownMinMs: 8000, cooldownMaxMs: 15000, maxActionsPerSession: 300 },
  };

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  // The dropdown's own option labels are the one thing that must *not* be
  // translated: each language is listed under its own name, so someone who
  // has landed on a language they can't read can still find theirs.
  function buildLanguageOptions() {
    const select = fields.language;
    select.innerHTML = '';

    const auto = document.createElement('option');
    auto.value = 'auto';
    select.appendChild(auto);

    IGSC_LANGUAGES.forEach((lang) => {
      const option = document.createElement('option');
      option.value = lang.code;
      option.textContent = lang.name;
      option.lang = lang.code;
      select.appendChild(option);
    });
  }

  function render() {
    const locale = igscResolveLocale(fields.language.value);
    t = igscMakeT(locale);

    document.documentElement.lang = locale;
    document.documentElement.dir = igscDirFor(locale);
    document.title = t('optTitle');

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });

    // Set from config.js rather than hardcoded in the markup, so the panel
    // and this page can never drift to different destinations.
    document.getElementById('support-link').href = IGSC_SUPPORT_URL;

    // "Automatic" is the only dropdown entry that needs translating — it
    // names a behaviour, not a language. It also shows which language the
    // browser actually resolves to, since that's otherwise invisible.
    const autoOption = fields.language.querySelector('option[value="auto"]');
    const autoResolved = IGSC_LANGUAGES.find((lang) => lang.code === igscResolveLocale('auto'));
    autoOption.textContent = autoResolved
      ? t('optLangAuto') + ' — ' + autoResolved.name
      : t('optLangAuto');

    // Flag unreviewed translations in the list itself rather than only in
    // the README, so nobody mistakes a first draft for a checked one.
    IGSC_LANGUAGES.forEach((lang) => {
      if (!lang.reviewNeeded) return;
      const option = fields.language.querySelector('option[value="' + lang.code + '"]');
      if (option) option.textContent = lang.name + ' (' + t('optLangReviewNote') + ')';
    });
  }

  function updateCooldownFieldsDisabled() {
    const disabled = !fields.cooldownEnabled.checked;
    fields.cooldownEvery.disabled = disabled;
    fields.cooldownMinSec.disabled = disabled;
    fields.cooldownMaxSec.disabled = disabled;
  }

  function applySettingsToForm(settings) {
    // A stored code we no longer ship (a language dropped from the list, or
    // a synced value from a newer version) would leave the <select> with an
    // empty value and no visible selection — fall back to 'auto' instead.
    const hasOption = Boolean(fields.language.querySelector('option[value="' + settings.language + '"]'));
    fields.language.value = hasOption ? settings.language : 'auto';
    fields.minDelaySec.value = settings.minDelayMs / 1000;
    fields.maxDelaySec.value = settings.maxDelayMs / 1000;
    fields.cooldownEnabled.checked = settings.cooldownEnabled;
    fields.cooldownEvery.value = settings.cooldownEvery;
    fields.cooldownMinSec.value = settings.cooldownMinMs / 1000;
    fields.cooldownMaxSec.value = settings.cooldownMaxMs / 1000;
    fields.maxActionsPerSession.value = settings.maxActionsPerSession;
    fields.customUnsaveLabel.value = settings.customUnsaveLabel || '';
    updateCooldownFieldsDisabled();
    render();
  }

  function readSettingsFromForm() {
    return {
      language: fields.language.value,
      minDelayMs: Math.round(parseFloat(fields.minDelaySec.value) * 1000),
      maxDelayMs: Math.round(parseFloat(fields.maxDelaySec.value) * 1000),
      cooldownEnabled: fields.cooldownEnabled.checked,
      cooldownEvery: parseInt(fields.cooldownEvery.value, 10),
      cooldownMinMs: Math.round(parseFloat(fields.cooldownMinSec.value) * 1000),
      cooldownMaxMs: Math.round(parseFloat(fields.cooldownMaxSec.value) * 1000),
      maxActionsPerSession: parseInt(fields.maxActionsPerSession.value, 10),
      customUnsaveLabel: fields.customUnsaveLabel.value.trim(),
    };
  }

  // Returns message *keys*, not finished text, so the caller renders them
  // in whichever language is currently selected.
  function validate(settings) {
    const errors = [];
    if (!(settings.minDelayMs > 0)) errors.push('errMinDelay');
    if (!(settings.maxDelayMs >= settings.minDelayMs)) errors.push('errMaxDelay');
    if (settings.cooldownEnabled) {
      if (!(settings.cooldownEvery >= 1)) errors.push('errCooldownEvery');
      if (!(settings.cooldownMinMs > 0)) errors.push('errCooldownMin');
      if (!(settings.cooldownMaxMs >= settings.cooldownMinMs)) errors.push('errCooldownMax');
    }
    if (!(settings.maxActionsPerSession >= 1)) errors.push('errSession');
    return errors;
  }

  let statusTimer = null;
  function showStatus(key) {
    statusEl.textContent = t(key);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.textContent = '';
    }, 4000);
  }

  async function load() {
    const data = await chrome.storage.sync.get(IGSC_SETTINGS_KEY);
    applySettingsToForm(igscResolveSettings(data[IGSC_SETTINGS_KEY]));
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------

  fields.cooldownEnabled.addEventListener('change', updateCooldownFieldsDisabled);

  // Preview only — nothing is written until Save, so a mis-click is
  // undone by reloading the page rather than by finding your way back
  // through a language you can't read.
  fields.language.addEventListener('change', render);

  // A preset fills the form but does not save — same reasoning as the
  // language preview: you see what you're about to commit to first.
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = PRESETS[btn.dataset.preset];
      if (!preset) return;
      fields.minDelaySec.value = preset.minDelayMs / 1000;
      fields.maxDelaySec.value = preset.maxDelayMs / 1000;
      fields.cooldownEnabled.checked = preset.cooldownEnabled;
      fields.cooldownEvery.value = preset.cooldownEvery;
      fields.cooldownMinSec.value = preset.cooldownMinMs / 1000;
      fields.cooldownMaxSec.value = preset.cooldownMaxMs / 1000;
      fields.maxActionsPerSession.value = preset.maxActionsPerSession;
      updateCooldownFieldsDisabled();
      showStatus('optProfileApplied');
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const settings = readSettingsFromForm();
    const errors = validate(settings);
    if (errors.length > 0) {
      showStatus(errors[0]);
      return;
    }
    await chrome.storage.sync.set({ [IGSC_SETTINGS_KEY]: settings });
    showStatus('optSaved');
  });

  restoreBtn.addEventListener('click', async () => {
    applySettingsToForm(IGSC_DEFAULT_SETTINGS);
    await chrome.storage.sync.set({ [IGSC_SETTINGS_KEY]: IGSC_DEFAULT_SETTINGS });
    showStatus('optRestored');
  });

  buildLanguageOptions();
  render();
  load();
})();
