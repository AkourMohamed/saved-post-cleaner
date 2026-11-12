/**
 * Saved Post Cleaner — content script
 *
 * Pure DOM automation. No credentials, no fetch/XHR calls, no background
 * script. Everything here just reads the page you're already looking at and
 * dispatches clicks a human could have made. It only runs the automation
 * loop after you press "Start", and it stops the moment you press "Stop",
 * hit the session cap, or Instagram shows a rate-limit message.
 */

(() => {
  // ---------------------------------------------------------------------
  // Guard: never run twice in the same page
  //
  // This script now matches all of instagram.com (needed so it's already
  // present before you navigate to Saved — see the entry point at the
  // bottom). Chrome/Brave can re-inject a declarative content script on
  // History API navigation that (still) matches its pattern, which is
  // exactly what happens on every in-app navigation here. Without this
  // guard, each re-injection stacks another full copy of this script —
  // another message listener, another URL poll, eventually another panel —
  // in the same page. A pile of duplicate chrome.runtime.onMessage
  // listeners is consistent with the "message port closed before a
  // response was received" error seen when messaging this tab.
  const w = window;
  if (w.__igscInjected) return;
  w.__igscInjected = true;

  // ---------------------------------------------------------------------
  // Guard: only activate on a saved-posts page
  // ---------------------------------------------------------------------

  // A grid of saved post tiles we can actually work on: either the "All
  // posts" grid, or a named collection (/<user>/saved/<collection>/<id>/).
  // Collections were previously excluded, which meant anyone who organises
  // their saves into collections installed the extension, opened one, saw
  // no panel at all, and had nothing telling them why.
  const SAVED_GRID_PATH = /^\/[A-Za-z0-9._]+\/saved\/(all-posts|[^/]+\/\d+)\/?$/;

  // The bare /<username>/saved/ root: the collections overview. There are
  // no post tiles here, so there's nothing to run — but this is exactly
  // where "Profile → Saved" lands you, so it's the most likely place for
  // someone to go looking for the panel. Showing it here with an
  // explanation beats showing nothing and looking broken.
  const SAVED_ROOT_PATH = /^\/[A-Za-z0-9._]+\/saved\/?$/;

  function isSavedGridPage() {
    return SAVED_GRID_PATH.test(window.location.pathname);
  }

  function isSavedPage() {
    return isSavedGridPage() || SAVED_ROOT_PATH.test(window.location.pathname);
  }

  // ---------------------------------------------------------------------
  // Tunables — adjust here if Instagram's tolerance or your patience changes
  // ---------------------------------------------------------------------

  // Pacing/cooldown/session-cap are user-configurable now (options page) —
  // see config.js for defaults and settings.* usage below. CONFIG here is
  // only for fixed technical waits that aren't a rate-limit tradeoff, just
  // time for Instagram's own UI to catch up.
  const CONFIG = {
    MODAL_WAIT_TIMEOUT_MS: 8000, // how long to wait for a post to open
    SCROLL_WAIT_TIMEOUT_MS: 6000, // how long to wait for more tiles after scrolling
    // How long to keep checking that an unsave actually took effect, and
    // how often. Polled rather than waited out, so a fast confirmation
    // costs one poll interval instead of the full budget — see
    // verifyUnsaved for why the old single fixed check was a problem.
    ACTION_CONFIRM_TIMEOUT_MS: 3000,
    ACTION_CONFIRM_POLL_MS: 100,
    DIALOG_CLOSE_TIMEOUT_MS: 2000, // how long to confirm a post actually closed

    // Small fixed pauses purely so Instagram's own animations/DOM updates
    // finish before we query it again — not part of the human-pacing
    // strategy, so these are trimmed to the minimum that stays reliable.
    PRE_CLICK_SETTLE_MS: 100,
    DIALOG_RENDER_SETTLE_MS: 150,
    POST_CLOSE_SETTLE_MS: 100,
  };

  // Phrasing Instagram uses for the "unsave" toggle's aria-label, the post
  // dialog's close button, and its own rate-limit messaging — in every
  // language we know (see IGSC_IG_LABELS in i18n.js for the table and the
  // reasoning). As of 2026 the bookmark icon on an already-saved English
  // post is labeled with a bare "Remove" (confirmed via DevTools against
  // the live dialog markup); older releases used fuller phrasing like
  // "Remove from your saved items", so both shapes are covered.
  //
  // Built once here rather than per post: the union is ~30 languages wide
  // and this feeds a loop over hundreds of tiles.
  const UNSAVE_LABEL_PATTERN = igscBuildLabelPattern('unsave');
  const CLOSE_LABEL_PATTERN = igscBuildLabelPattern('close');
  const RATE_LIMIT_TEXT_PATTERN = igscBuildLabelPattern('rate');

  // The same three, narrowed to whatever language Instagram says the page
  // is in. Tried before the union so a precise match wins outright — see
  // findUnsaveControl.
  const pageLanguage = igscPageLanguageCode(document.documentElement.getAttribute('lang'));
  const PAGE_UNSAVE_PATTERN = pageLanguage ? igscBuildLabelPattern('unsave', [pageLanguage]) : null;
  const PAGE_CLOSE_PATTERN = pageLanguage ? igscBuildLabelPattern('close', [pageLanguage]) : null;

  // STORAGE_KEY/MAX_PERSISTED_LOG_ENTRIES: this only ever holds counters and
  // a short skip log — never credentials or anything Instagram-account-scoped
  // beyond your own tallies — so progress survives reloads and the session
  // cap without you losing track of where you were. (IGSC_STATE_KEY and the
  // settings defaults/key come from config.js, loaded before this file.)
  const STORAGE_KEY = IGSC_STATE_KEY;
  const MAX_PERSISTED_LOG_ENTRIES = 50;

  // Pacing/cooldown/session-cap settings, configurable from the options
  // page. Starts at the recommended defaults and is overwritten by
  // loadSettings() during init() before Start becomes meaningful, and kept
  // in sync afterward via the storage.onChanged listener below so an
  // already-open Saved tab picks up changes without a reload.
  let settings = IGSC_DEFAULT_SETTINGS;

  // Current UI language and its translate function (see i18n.js). Both are
  // rebuilt by applyLocale() whenever the language setting changes, so a
  // Saved tab that's already open re-renders in the new language instead
  // of waiting for a reload — unlike the pacing settings, a stale language
  // is visible in every label at once.
  let locale = igscResolveLocale(IGSC_DEFAULT_SETTINGS.language);
  let t = igscMakeT(locale);

  // Compiled from settings.customUnsaveLabel — see findUnsaveControl.
  // null whenever the setting is empty, which is the normal case.
  let customUnsavePattern = null;

  // The setting holds literal button labels the user copied off their own
  // Instagram, not a regex, so every character is escaped before it goes
  // near RegExp — otherwise a perfectly reasonable label containing "("
  // would throw and take the whole run with it. Matching is exact
  // (ignoring case and surrounding space) for the same reason the shipped
  // single words are anchored: a loose match could click the wrong
  // control.
  function buildCustomUnsavePattern(raw) {
    const labels = String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => '^\\s*' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$');
    if (labels.length === 0) return null;
    try {
      return new RegExp(labels.join('|'), 'i');
    } catch (err) {
      console.warn('[Saved Post Cleaner] Ignoring unusable custom unsave label:', err);
      return null;
    }
  }

  function applyLocale() {
    locale = igscResolveLocale(settings.language);
    t = igscMakeT(locale);
    customUnsavePattern = buildCustomUnsavePattern(settings.customUnsaveLabel);
    if (panelEl) renderPanelText();
  }

  async function loadSettings() {
    try {
      const data = await chrome.storage.sync.get(IGSC_SETTINGS_KEY);
      settings = igscResolveSettings(data[IGSC_SETTINGS_KEY]);
    } catch (err) {
      console.warn('[Saved Post Cleaner] Could not load settings, using recommended defaults:', err);
      settings = igscResolveSettings(null);
    }
    applyLocale();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes[IGSC_SETTINGS_KEY]) {
      settings = igscResolveSettings(changes[IGSC_SETTINGS_KEY].newValue);
      applyLocale();
    }
  });

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  const state = {
    running: false,
    stopRequested: false,
    unsavedCount: 0,
    skippedCount: 0,
    actionsThisSession: 0,
    processedHrefs: new Set(),
    skipLog: [], // { href, reasonKey, ts } — newest first
    // The message currently on the status line, kept as a key + params
    // rather than as finished text so it can be re-rendered in a new
    // language mid-run (see renderPanelText).
    statusKey: 'statusIdle',
    statusParams: null,
    // Run of consecutive posts where the unsave control couldn't be
    // identified. Reset by any success. See BAIL_OUT_AFTER_NO_CONTROL.
    consecutiveNoControl: 0,
    // Run of consecutive posts where the button was found and clicked but
    // the change never took. See BAIL_OUT_AFTER_UNCONFIRMED.
    consecutiveUnconfirmed: 0,
    // Set when the run hits something it cannot safely continue past —
    // currently only a post dialog that refuses to close, which would
    // otherwise make every later tile operate on the wrong post.
    fatal: false,
  };

  // If this many posts in a row yield no identifiable unsave control, the
  // problem is systemic — Instagram in a language we don't have wording
  // for, or markup that has changed — not a quirk of those particular
  // posts. Previously the run would plough through the entire grid
  // skipping every post and finish reporting "Done", which reads exactly
  // like a broken extension. Stopping early with an explanation, and a
  // pointer at the setting that fixes it, is the difference between a
  // support question and an uninstall.
  const BAIL_OUT_AFTER_NO_CONTROL = 3;

  // Finding the button, clicking it, and having nothing happen — repeatedly
  // — is what being rate-limited actually looks like from in here, whether
  // or not Instagram bothers to render a banner saying so. Treating a run of
  // these as a rate limit catches the case in any language and even when the
  // message is a silently-dropped request, which is the situation where
  // continuing is most likely to make things worse for the account.
  const BAIL_OUT_AFTER_UNCONFIRMED = 3;

  // ---------------------------------------------------------------------
  // Persistence (chrome.storage.local only — no network, no Instagram API)
  // ---------------------------------------------------------------------

  async function loadPersistedState() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      return data[STORAGE_KEY] || null;
    } catch (err) {
      console.warn('[Saved Post Cleaner] Could not load persisted stats:', err);
      return null;
    }
  }

  // Writes are chained onto this promise so they always land in the order
  // they were called, never in the order their underlying storage.set()
  // calls happen to resolve. Without this, a save queued just before a
  // Reset could in theory resolve just after it and silently restore the
  // old (pre-reset) numbers.
  let saveChain = Promise.resolve();

  function savePersistedState() {
    // Snapshot now — the write must reflect state as of *this* call, not
    // whatever state happens to be current when its turn comes up.
    const snapshot = {
      unsavedCount: state.unsavedCount,
      skippedCount: state.skippedCount,
      skipLog: state.skipLog.slice(), // copy — state.skipLog mutates in place
    };
    saveChain = saveChain
      .then(() => chrome.storage.local.set({ [STORAGE_KEY]: snapshot }))
      .catch((err) => console.warn('[Saved Post Cleaner] Could not save stats:', err));
    return saveChain;
  }

  // ---------------------------------------------------------------------
  // Panel UI
  // ---------------------------------------------------------------------

  let els = {};
  let panelEl = null;
  let dragOffset = null;

  // Where the panel sits and whether it's minimized. Kept in its own
  // storage key rather than alongside the counters, because Reset clears
  // those and there's no reason for "reset my stats" to also throw the
  // panel back into the corner. chrome.storage.local, so it's per-device
  // — a window position is not something worth syncing across machines
  // with different screens.
  const UI_KEY = 'igscUi';
  let ui = { left: null, top: null, minimized: false, promptDone: false };

  async function loadUiPrefs() {
    try {
      const data = await chrome.storage.local.get(UI_KEY);
      if (data[UI_KEY]) ui = Object.assign(ui, data[UI_KEY]);
    } catch (err) {
      console.warn('[Saved Post Cleaner] Could not load panel position:', err);
    }
  }

  let uiSaveTimer = null;
  function saveUiPrefs() {
    // Debounced: dragging fires mousemove continuously, and each write
    // would otherwise be a storage round-trip during the drag.
    if (uiSaveTimer) clearTimeout(uiSaveTimer);
    uiSaveTimer = setTimeout(() => {
      chrome.storage.local
        .set({ [UI_KEY]: ui })
        .catch((err) => console.warn('[Saved Post Cleaner] Could not save panel position:', err));
    }, 400);
  }

  // Re-applies a remembered position, clamped back into the viewport.
  // Without the clamp, a panel dragged to the edge of a wide monitor and
  // reopened on a laptop would restore off-screen and look like it had
  // stopped working.
  function applyUiPrefs() {
    if (!panelEl) return;
    if (typeof ui.left === 'number' && typeof ui.top === 'number') {
      const maxLeft = Math.max(0, window.innerWidth - 120);
      const maxTop = Math.max(0, window.innerHeight - 60);
      panelEl.style.left = Math.min(Math.max(0, ui.left), maxLeft) + 'px';
      panelEl.style.top = Math.min(Math.max(0, ui.top), maxTop) + 'px';
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';
    }
    setMinimized(ui.minimized, true);
  }

  // ---------------------------------------------------------------------
  // The one ask
  //
  // A dismissible offer to review or tip, shown in the panel after the
  // extension has actually done the job — never on install, never during a
  // run, never after a run that failed. Asking before delivering anything
  // is how an extension collects reviews from people who have no evidence
  // yet; asking after a failed run collects the bad ones.
  //
  // Its life cycle is tied to the run: it appears when a run ends and is
  // cleared when the next one starts, so the panel is always showing either
  // a run in progress or the result of the last one — never last run's
  // footer over this run's status.
  //
  // Following a link does *not* hide it. Opening the review page in a new
  // tab is not the same as having written a review, and someone who tipped
  // may well want the link again — so the ask stays until the next Start.
  // Only ✕ ends it for good.
  // ---------------------------------------------------------------------

  // Enough cleared posts that the extension has demonstrably saved real
  // time — that being the only thing that earns the right to ask. Counted
  // cumulatively across runs (the counter persists), so someone working
  // through a big list in several short sessions still reaches it.
  const PROMPT_AFTER_UNSAVED = 25;

  // ✕ only: the explicit "leave me alone", honoured permanently.
  function retirePrompt() {
    ui.promptDone = true;
    hidePrompt();
    saveUiPrefs();
  }

  // Temporary — clears the ask for the duration of a run. It comes back
  // when that run ends, with an updated count.
  function hidePrompt() {
    if (els.prompt) els.prompt.hidden = true;
  }

  function maybeShowPrompt() {
    if (!els.prompt || ui.promptDone) return;
    if (state.unsavedCount < PROMPT_AFTER_UNSAVED) return;

    // No listing to review on an unpacked dev build — offer only the tip
    // link there rather than a link that would 404.
    const reviewUrl = igscReviewUrl();
    els.promptRate.hidden = !reviewUrl;
    if (reviewUrl) els.promptRate.href = reviewUrl;
    els.promptSupport.href = IGSC_SUPPORT_URL;

    els.promptText.textContent = t('promptDone', { count: state.unsavedCount });
    els.prompt.hidden = false;
  }

  function setMinimized(minimized, skipSave) {
    ui.minimized = Boolean(minimized);
    if (!panelEl) return;
    panelEl.classList.toggle('igsc-minimized', ui.minimized);
    els.minimizeBtn.textContent = ui.minimized ? '+' : '–';
    els.minimizeBtn.title = t(ui.minimized ? 'panelRestoreTitle' : 'panelMinimizeTitle');
    updateCounts();
    if (!skipSave) saveUiPrefs();
  }
  // True once the user has explicitly closed the panel with ✕ — suppresses
  // re-showing it when navigating back to the All posts grid, until the
  // toolbar popup's IGSC_SHOW_PANEL message clears it again.
  let dismissedByUser = false;

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'igsc-panel';
    // Named and marked as a region so it's reachable and identifiable to a
    // screen reader, rather than being an anonymous div floating over
    // Instagram's own landmarks.
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Saved Post Cleaner');
    // Text content is filled in by renderPanelText() rather than written
    // here, so switching language re-renders the same nodes instead of
    // rebuilding the panel (which would drop its dragged position and any
    // in-flight run). "Saved Post Cleaner" is the product name and stays
    // untranslated on purpose — it's what the Chrome Web Store listing and
    // chrome://extensions call it in every locale.
    panel.innerHTML = `
      <div class="igsc-header" id="igsc-drag-handle">
        <span class="igsc-title">Saved Post Cleaner<b id="igsc-min-count"></b></span>
        <span class="igsc-header-actions">
          <button id="igsc-settings" class="igsc-reset-btn"></button>
          <button id="igsc-reset" class="igsc-reset-btn"></button>
          <button id="igsc-minimize" class="igsc-reset-btn igsc-icon-btn">–</button>
          <button id="igsc-close" class="igsc-reset-btn igsc-icon-btn">✕</button>
        </span>
      </div>
      <div class="igsc-status" id="igsc-status" role="status" aria-live="polite"></div>
      <div class="igsc-counts">
        <span><span id="igsc-label-unsaved"></span> <b id="igsc-count-unsaved">0</b></span>
        <span><span id="igsc-label-skipped"></span> <b id="igsc-count-skipped">0</b></span>
      </div>
      <div class="igsc-buttons">
        <button id="igsc-start"></button>
        <button id="igsc-stop" disabled></button>
      </div>
      <div class="igsc-prompt" id="igsc-prompt" hidden>
        <span id="igsc-prompt-text"></span>
        <span class="igsc-prompt-actions">
          <a id="igsc-prompt-rate" target="_blank" rel="noopener noreferrer"></a>
          <a id="igsc-prompt-support" target="_blank" rel="noopener noreferrer"></a>
          <button id="igsc-prompt-dismiss" class="igsc-reset-btn igsc-icon-btn">✕</button>
        </span>
      </div>
      <div class="igsc-log" id="igsc-log"></div>
    `;
    document.body.appendChild(panel);
    panelEl = panel;

    els = {
      status: panel.querySelector('#igsc-status'),
      countUnsaved: panel.querySelector('#igsc-count-unsaved'),
      countSkipped: panel.querySelector('#igsc-count-skipped'),
      startBtn: panel.querySelector('#igsc-start'),
      stopBtn: panel.querySelector('#igsc-stop'),
      resetBtn: panel.querySelector('#igsc-reset'),
      settingsBtn: panel.querySelector('#igsc-settings'),
      closeBtn: panel.querySelector('#igsc-close'),
      labelUnsaved: panel.querySelector('#igsc-label-unsaved'),
      labelSkipped: panel.querySelector('#igsc-label-skipped'),
      minimizeBtn: panel.querySelector('#igsc-minimize'),
      minCount: panel.querySelector('#igsc-min-count'),
      prompt: panel.querySelector('#igsc-prompt'),
      promptText: panel.querySelector('#igsc-prompt-text'),
      promptRate: panel.querySelector('#igsc-prompt-rate'),
      promptSupport: panel.querySelector('#igsc-prompt-support'),
      promptDismiss: panel.querySelector('#igsc-prompt-dismiss'),
      log: panel.querySelector('#igsc-log'),
    };

    applyUiPrefs();
    renderPanelText();

    els.startBtn.addEventListener('click', startAutomation);
    els.stopBtn.addEventListener('click', requestStop);
    els.resetBtn.addEventListener('click', resetStats);
    // chrome.runtime.openOptionsPage() isn't available from a content script
    // (only from extension pages like a background script or the popup) —
    // it fails silently there, so open the options page directly by URL
    // instead. chrome.runtime.getURL() *is* available to content scripts.
    els.settingsBtn.addEventListener('click', () => window.open(chrome.runtime.getURL('src/options/options.html'), '_blank'));
    // Minimize is the gentle version of closing: the panel shrinks to a
    // draggable title pill that still shows the running count, and one
    // click brings it back. ✕ still hides it outright for people who want
    // it gone — but that now needs the toolbar popup to undo, which is
    // exactly why it shouldn't be the only way to get it out of the way.
    els.minimizeBtn.addEventListener('click', () => setMinimized(!ui.minimized));
    els.closeBtn.addEventListener('click', () => {
      dismissedByUser = true;
      hidePanel();
    });

    // Only ✕ retires the ask. The two links are ordinary outbound links
    // that open in a new tab and leave the panel exactly as it was.
    els.promptDismiss.addEventListener('click', retirePrompt);

    const handle = panel.querySelector('#igsc-drag-handle');
    handle.addEventListener('mousedown', startDrag);
  }

  function showPanel() {
    if (panelEl) panelEl.classList.remove('igsc-hidden');
  }

  function hidePanel() {
    if (panelEl) panelEl.classList.add('igsc-hidden');
  }

  // Popup -> here: bring the panel back after it's been closed with ✕ (there's
  // no other way to reveal it again short of reloading the page). Clears
  // dismissedByUser (see syncWithLocation below) so leaving and returning to
  // the All posts grid shows it again too, not just this one time.
  //
  // sendResponse() is called explicitly (even though the popup doesn't use
  // the response) — testing showed that leaving it implicit produced "The
  // message port closed before a response was received" on the sender's
  // side even though this listener ran fine, so don't rely on the sender
  // inferring "no response coming" from a listener that returns nothing.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'IGSC_SHOW_PANEL') {
      dismissedByUser = false;
      showPanel();
    }
    sendResponse();
  });

  function startDrag(e) {
    // Let header buttons (Settings/Reset/Close) work normally instead of
    // starting a drag every time one is clicked.
    if (e.target.closest('button')) return;
    const rect = panelEl.getBoundingClientRect();
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  }

  document.addEventListener('mousemove', (e) => {
    if (!dragOffset || !panelEl) return;
    // Clamped so the panel can't be dragged off-screen and lost — there's
    // no "reset window position" affordance to recover from that.
    const left = Math.min(Math.max(0, e.clientX - dragOffset.x), Math.max(0, window.innerWidth - 120));
    const top = Math.min(Math.max(0, e.clientY - dragOffset.y), Math.max(0, window.innerHeight - 60));
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
    ui.left = left;
    ui.top = top;
  });

  document.addEventListener('mouseup', () => {
    if (dragOffset) saveUiPrefs();
    dragOffset = null;
  });

  // Writes every translatable string in the panel. Called once when the
  // panel is built and again on any language change, so the panel is
  // re-labelled in place — its dragged position, counters and running
  // state all survive.
  //
  // An explicit dir is set rather than inherited: Instagram sets
  // dir="rtl" on <html> for its own RTL locales, which would otherwise
  // flip this panel even when it's showing English, and vice versa.
  function renderPanelText() {
    if (!panelEl) return;
    panelEl.dir = igscDirFor(locale);
    panelEl.lang = locale;
    els.settingsBtn.textContent = t('panelSettings');
    els.settingsBtn.title = t('panelSettingsTitle');
    els.resetBtn.textContent = t('panelReset');
    els.resetBtn.title = t('panelResetTitle');
    els.closeBtn.title = t('panelCloseTitle');
    els.minimizeBtn.title = t(ui.minimized ? 'panelRestoreTitle' : 'panelMinimizeTitle');
    els.labelUnsaved.textContent = t('panelUnsaved');
    els.labelSkipped.textContent = t('panelSkipped');
    els.startBtn.textContent = t('panelStart');
    els.stopBtn.textContent = t('panelStop');
    els.status.textContent = t(state.statusKey, state.statusParams);
    els.promptText.textContent = t('promptDone', { count: state.unsavedCount });
    els.promptRate.textContent = t('promptRate');
    els.promptSupport.textContent = t('promptSupport');
    els.promptDismiss.title = t('promptDismissTitle');
    renderPersistedLog();
  }

  // Statuses that mean "this needs you to do something", as opposed to
  // ordinary progress. These get visual weight so a stopped run doesn't
  // read the same as a running one at a glance — the panel is small and
  // easy to ignore in the corner of a page.
  const ATTENTION_STATUSES = new Set(['statusNoControlHelp', 'statusRateLimit', 'statusError']);

  // Takes a message key (not finished text) so the current status can be
  // re-rendered if the language changes while it's showing.
  function setStatus(key, params) {
    state.statusKey = key;
    state.statusParams = params || null;
    if (els.status) els.status.textContent = t(key, params);
    if (panelEl) panelEl.classList.toggle('igsc-attention', ATTENTION_STATUSES.has(key));
  }

  function updateCounts() {
    if (els.countUnsaved) els.countUnsaved.textContent = String(state.unsavedCount);
    if (els.countSkipped) els.countSkipped.textContent = String(state.skippedCount);
    // Minimized, the counters are hidden — but a run still needs to look
    // alive, or a minimized panel is indistinguishable from a stalled one.
    if (els.minCount) els.minCount.textContent = ui.minimized ? ' · ' + state.unsavedCount : '';
  }

  // The panel only ever shows the newest few entries; the rest stay in
  // state.skipLog (capped at MAX_PERSISTED_LOG_ENTRIES) for the console.
  const VISIBLE_LOG_ENTRIES = 6;

  // Entries are stored as message keys, so an old skip logged in one
  // language still renders in whatever language is selected now.
  // `entry.reason` is the pre-i18n shape: entries persisted by an earlier
  // version hold finished English text instead of a key, so fall back to
  // showing that verbatim rather than dropping them.
  function skipReasonText(entry) {
    return entry.reasonKey ? t(entry.reasonKey) : entry.reason || '';
  }

  function toggleButtons() {
    if (!els.startBtn || !els.stopBtn) return;
    // Start is also unavailable on the collections overview, which has no
    // post tiles — the status line says so rather than leaving a live
    // button that would do nothing.
    els.startBtn.disabled = state.running || !isSavedGridPage();
    els.stopBtn.disabled = !state.running;
  }

  // Keeps the panel honest about the page it's currently sitting on.
  // Called on every SPA navigation, since moving between the collections
  // overview and a grid changes whether Start means anything.
  function refreshPageContext() {
    if (!panelEl) return;
    toggleButtons();
    if (state.running) return;
    setStatus(isSavedGridPage() ? 'statusIdle' : 'statusNeedGrid');
  }

  function logSkip(href, reasonKey) {
    state.skippedCount++;
    state.skipLog.unshift({ href, reasonKey, ts: Date.now() });
    if (state.skipLog.length > MAX_PERSISTED_LOG_ENTRIES) {
      state.skipLog.length = MAX_PERSISTED_LOG_ENTRIES;
    }
    updateCounts();
    // The console line stays English regardless of the UI language — it's
    // the developer-facing surface, and an English message is what makes a
    // pasted bug report searchable against this source.
    console.warn(`[Saved Post Cleaner] Skipped ${href}: ${IGSC_MESSAGES.en[reasonKey] || reasonKey}`);
    renderPersistedLog();
    savePersistedState();
  }

  function renderPersistedLog() {
    if (!els.log) return;
    els.log.innerHTML = '';
    state.skipLog.slice(0, VISIBLE_LOG_ENTRIES).forEach((entry) => {
      const line = document.createElement('div');
      line.textContent = t('logSkipped', { reason: skipReasonText(entry) });
      els.log.appendChild(line);
    });
  }

  async function resetStats() {
    if (state.running) return; // don't clear stats mid-run
    const confirmed = window.confirm(t('resetConfirm'));
    if (!confirmed) return;
    state.unsavedCount = 0;
    state.skippedCount = 0;
    state.skipLog = [];
    updateCounts();
    if (els.log) els.log.innerHTML = '';
    await savePersistedState();
  }

  // ---------------------------------------------------------------------
  // Small async utilities
  // ---------------------------------------------------------------------

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomDelay(minMs, maxMs) {
    const ms = minMs + Math.random() * (maxMs - minMs);
    return sleep(ms);
  }

  // Polls conditionFn every `intervalMs` until it returns a truthy value or
  // `timeoutMs` elapses. Used instead of MutationObserver for simplicity —
  // everything here already runs on a multi-second cadence.
  function waitFor(conditionFn, timeoutMs, intervalMs = 200) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function tick() {
        let result;
        try {
          result = conditionFn();
        } catch (err) {
          result = null;
        }
        if (result) {
          resolve(result);
        } else if (Date.now() - start >= timeoutMs) {
          resolve(null);
        } else {
          setTimeout(tick, intervalMs);
        }
      })();
    });
  }

  // ---------------------------------------------------------------------
  // DOM selector logic
  //
  // Instagram's class names are generated/obfuscated at build time and
  // rotate between deploys, so nothing here matches on a class. Instead we
  // anchor on things that are much more stable: URL shape (post links start
  // with /p/ or /reel/) and accessibility metadata (aria-label / role),
  // which Instagram has to keep reasonably consistent for screen readers.
  // ---------------------------------------------------------------------

  function getGridContainer() {
    return document.querySelector('main') || document.body;
  }

  function findNextTile() {
    const container = getGridContainer();
    const anchors = container.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]');
    for (const a of anchors) {
      if (!a.dataset.igscProcessed && !state.processedHrefs.has(a.href)) {
        return a;
      }
    }
    return null;
  }

  // Returns the single element in `scope` whose aria-label matches, or
  // null. Zero matches means the control wasn't found; more than one means
  // we can't tell which is the real one — and guessing risks clicking the
  // wrong control, so both cases decline rather than pick.
  function soleLabelMatch(scope, pattern) {
    if (!pattern) return null;
    let found = null;
    // The label can live on an <svg>, a wrapping <button>, or a
    // <div role="button"> depending on the current markup, so don't assume
    // a tag — just the label text.
    for (const el of scope.querySelectorAll('[aria-label]')) {
      if (!pattern.test(el.getAttribute('aria-label') || '')) continue;
      if (found) return null; // ambiguous
      found = el;
    }
    return found;
  }

  function findUnsaveControl(dialog) {
    // Three passes, most specific first. Each one only wins if it matches
    // exactly one element, so a narrower pass that finds nothing simply
    // hands over to the next.
    //
    //   1. A label the user typed in Settings, for an Instagram language or
    //      wording we don't ship. This is the escape hatch that turns "the
    //      extension is broken for me" into something the user can fix
    //      themselves without waiting for a release.
    //   2. The language Instagram's own page declares — the precise match,
    //      which avoids ever having to disambiguate between two languages
    //      that share a word.
    //   3. The union of every language we know, for when the page doesn't
    //      declare a language we recognise.
    return (
      soleLabelMatch(dialog, customUnsavePattern) ||
      soleLabelMatch(dialog, PAGE_UNSAVE_PATTERN) ||
      soleLabelMatch(dialog, UNSAVE_LABEL_PATTERN)
    );
  }

  function findCloseControl(dialog) {
    // Same idea, but this one may return an ambiguous-but-usable match:
    // failing to close a dialog strands the run, and every candidate here
    // is a close button, so the first hit is fine when there are several.
    const precise = soleLabelMatch(dialog, PAGE_CLOSE_PATTERN);
    if (precise) return precise;
    return Array.from(dialog.querySelectorAll('[aria-label]')).find((el) =>
      CLOSE_LABEL_PATTERN.test(el.getAttribute('aria-label') || '')
    );
  }

  function clickElement(el) {
    // aria-label often sits on an inner <svg>; walk up to the actual
    // clickable ancestor so the click lands where React's handler expects.
    const target = el.closest('button, [role="button"], a') || el;
    target.click();
  }

  // Closes the open post and confirms it actually closed, escalating
  // through three independent mechanisms. Returns false only if the dialog
  // is still there after all of them.
  //
  // The verification matters more than it looks: a dialog left open is not
  // a cosmetic problem. The next tile's waitFor() for "a dialog exists"
  // would match the *stale* one immediately, so the run would go on
  // inspecting the previous post over and over — skipping every remaining
  // tile with a control it already used. One unrecognised close label used
  // to be enough to end a run after a single post, with no indication why.
  async function closeDialog(dialog) {
    const closed = () => (document.body.contains(dialog) ? null : true);
    if (closed()) return true;

    const closeBtn = findCloseControl(dialog);
    if (closeBtn) {
      clickElement(closeBtn);
      if (await waitFor(closed, CONFIG.DIALOG_CLOSE_TIMEOUT_MS, 60)) return true;
    }

    // Instagram's post modal also closes on Escape. keyCode/which are set
    // alongside key because handlers in the wild still read them.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true })
    );
    if (await waitFor(closed, CONFIG.DIALOG_CLOSE_TIMEOUT_MS, 60)) return true;

    // Last resort, and the only one that doesn't depend on recognising any
    // wording or key handler: opening a post pushes a history entry
    // (the address bar shows /p/<code>/ while the dialog is up), so going
    // back unwinds it. Guarded on the URL actually being a post overlay so
    // this can never navigate away from the grid.
    if (isPostOverlayPath(window.location.pathname)) {
      window.history.back();
      if (await waitFor(closed, CONFIG.DIALOG_CLOSE_TIMEOUT_MS, 60)) return true;
    }

    console.error('[Saved Post Cleaner] Could not close the post dialog; stopping so the run does not act on a stale post.');
    return false;
  }

  function unsaveTookEffect(dialog, previousControl) {
    // On success Instagram swaps the control's aria-label from "unsave"
    // phrasing back to something like "Save". If the dialog itself closed
    // as a side effect, or the element was replaced entirely, treat that as
    // success too rather than failing to confirm a real action.
    if (!document.body.contains(dialog)) return true;
    if (!document.body.contains(previousControl)) return true;
    const label = previousControl.getAttribute('aria-label') || '';
    return !UNSAVE_LABEL_PATTERN.test(label);
  }

  // Waits for the label swap instead of checking once after a fixed pause.
  //
  // The old fixed 500ms was a race: the unsave genuinely succeeded, but on
  // a slow connection Instagram hadn't re-rendered the button yet, so the
  // check ran too early and the post was logged as "clicked but couldn't
  // confirm". That inflates the skip counter with posts that were in fact
  // unsaved, which is the most confidence-destroying thing the panel can
  // do — the numbers say it failed while the grid says it worked. Polling
  // returns as soon as the swap lands (usually well under the old fixed
  // wait, so this is also faster in the common case) and only reports
  // failure after genuinely giving up.
  function verifyUnsaved(dialog, previousControl) {
    return waitFor(
      () => (unsaveTookEffect(dialog, previousControl) ? true : null),
      CONFIG.ACTION_CONFIRM_TIMEOUT_MS,
      CONFIG.ACTION_CONFIRM_POLL_MS
    );
  }

  // Looks for Instagram's own "you're going too fast" messaging.
  //
  // This used to test RATE_LIMIT_TEXT_PATTERN against document.body.innerText
  // on every iteration, which had two problems that both got worse once the
  // pattern covered 32 languages:
  //
  //   * False positives. The body text of a Saved page includes captions
  //     and comments, so an ordinary comment reading "I'll try again later"
  //     would stop the run and announce a rate limit that never happened.
  //     Across 32 languages of phrases, on a grid with hundreds of posts
  //     loaded, that stops being a remote possibility.
  //   * Cost. Reading innerText forces a layout of the whole page, once per
  //     post, on a page that grows as it scrolls.
  //
  // Instagram renders these messages as a small alert or modal, so scanning
  // only short alert/dialog nodes is both cheaper and far more precise. The
  // length cap is what separates them from the post dialog, which carries a
  // caption and comment thread.
  const RATE_LIMIT_MAX_TEXT_LENGTH = 400;

  function detectRateLimitBanner() {
    for (const node of document.querySelectorAll('[role="alert"], div[role="dialog"]')) {
      const text = node.textContent || '';
      if (text.length > RATE_LIMIT_MAX_TEXT_LENGTH) continue;
      if (RATE_LIMIT_TEXT_PATTERN.test(text)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Automation core
  // ---------------------------------------------------------------------

  async function processTile(tile) {
    // A dialog left over from the previous post must be gone before this
    // one is opened, or the waitFor below would match the old one on its
    // first poll and this post would never actually be inspected.
    const stale = document.querySelector('div[role="dialog"]');
    if (stale && !(await closeDialog(stale))) {
      state.fatal = true;
      return;
    }

    tile.dataset.igscProcessed = 'true';
    state.processedHrefs.add(tile.href);
    const label = tile.href;

    // Visual-only marker so it's obvious at a glance which tile is currently
    // being handled while watching a run. Purely cosmetic — safe to remove
    // even if the tile is later detached from the DOM (e.g. Instagram pulls
    // it from the grid right after a successful unsave).
    tile.classList.add('igsc-processing');

    try {
      tile.scrollIntoView({ block: 'center' });
      await sleep(CONFIG.PRE_CLICK_SETTLE_MS);
      tile.click();

      const dialog = await waitFor(
        () => document.querySelector('div[role="dialog"]'),
        CONFIG.MODAL_WAIT_TIMEOUT_MS
      );

      if (!dialog) {
        logSkip(label, 'skipNotOpened');
        return;
      }

      await sleep(CONFIG.DIALOG_RENDER_SETTLE_MS); // let the dialog finish rendering its controls

      const unsaveControl = findUnsaveControl(dialog);
      if (!unsaveControl) {
        state.consecutiveNoControl++;
        logSkip(label, 'skipNoControl');
        if (!(await closeDialog(dialog))) state.fatal = true;
        return;
      }

      clickElement(unsaveControl);

      if (await verifyUnsaved(dialog, unsaveControl)) {
        state.consecutiveNoControl = 0;
        state.consecutiveUnconfirmed = 0;
        state.unsavedCount++;
        state.actionsThisSession++;
        updateCounts();
        savePersistedState();
      } else {
        state.consecutiveUnconfirmed++;
        logSkip(label, 'skipUnconfirmed');
      }

      if (!(await closeDialog(dialog))) state.fatal = true;
      await sleep(CONFIG.POST_CLOSE_SETTLE_MS);
    } finally {
      tile.classList.remove('igsc-processing');
    }
  }

  async function cooldownPause() {
    setStatus('statusCooldown');
    await randomDelay(settings.cooldownMinMs, settings.cooldownMaxMs);
    if (!state.stopRequested) setStatus('statusRunning');
  }

  async function scrollAndWaitForMore() {
    const container = getGridContainer();
    const before = container.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]').length;

    window.scrollTo(0, document.body.scrollHeight);

    const grew = await waitFor(() => {
      const now = container.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]').length;
      return now > before ? now : null;
    }, CONFIG.SCROLL_WAIT_TIMEOUT_MS);

    return Boolean(grew);
  }

  async function runLoop() {
    let consecutiveEmptyScrolls = 0;

    while (!state.stopRequested) {
      if (state.actionsThisSession >= settings.maxActionsPerSession) {
        setStatus('statusSessionCap', { count: settings.maxActionsPerSession });
        break;
      }

      if (detectRateLimitBanner()) {
        setStatus('statusRateLimit');
        break;
      }

      // Several posts in a row with no identifiable unsave button is a
      // systemic problem, not bad luck — stop and say what to do about it
      // rather than skipping the entire grid and reporting "Done".
      if (state.consecutiveNoControl >= BAIL_OUT_AFTER_NO_CONTROL) {
        setStatus('statusNoControlHelp');
        break;
      }

      if (state.consecutiveUnconfirmed >= BAIL_OUT_AFTER_UNCONFIRMED) {
        setStatus('statusRateLimit');
        break;
      }

      if (state.fatal) {
        setStatus('statusError');
        break;
      }

      const tile = findNextTile();

      if (!tile) {
        const grew = await scrollAndWaitForMore();
        if (grew) {
          consecutiveEmptyScrolls = 0;
        } else {
          consecutiveEmptyScrolls++;
          if (consecutiveEmptyScrolls >= 2) {
            setStatus('statusDone');
            break;
          }
        }
        continue;
      }

      consecutiveEmptyScrolls = 0;
      const unsavedBefore = state.unsavedCount;

      // One post's unexpected DOM quirk shouldn't take down an otherwise
      // healthy run — isolate failures here so they're logged as a skip
      // and the loop moves on, rather than throwing all the way up to
      // startAutomation() and ending the whole session early.
      try {
        await processTile(tile);
      } catch (err) {
        console.error('[Saved Post Cleaner] Unexpected error processing a post — skipping and continuing:', err);
        logSkip(tile.href, 'skipUnexpected');
        // Best-effort recovery: if a dialog got left open, close it so the
        // next tile isn't blocked by it.
        const strandedDialog = document.querySelector('div[role="dialog"]');
        if (strandedDialog && !(await closeDialog(strandedDialog))) state.fatal = true;
      }

      if (state.stopRequested) break;
      if (state.fatal) {
        setStatus('statusError');
        break;
      }

      const justUnsaved = state.unsavedCount > unsavedBefore;
      if (settings.cooldownEnabled && justUnsaved && state.unsavedCount % settings.cooldownEvery === 0) {
        await cooldownPause();
      } else {
        setStatus('statusRunning');
      }

      if (state.stopRequested) break;
      await randomDelay(settings.minDelayMs, settings.maxDelayMs);
    }
  }

  async function startAutomation() {
    if (state.running) return;
    state.running = true;
    state.stopRequested = false;
    state.actionsThisSession = 0;
    // A fresh run gets a fresh benefit of the doubt: whatever made the
    // last one bail out may have been fixed in Settings since.
    state.consecutiveNoControl = 0;
    state.consecutiveUnconfirmed = 0;
    state.fatal = false;
    // Clear last run's ask so it can't sit under this run's status line.
    hidePrompt();
    toggleButtons();
    setStatus('statusRunning');

    try {
      await runLoop();
    } catch (err) {
      console.error('[Saved Post Cleaner] Stopped due to an unexpected error:', err);
      setStatus('statusError');
    } finally {
      state.running = false;
      state.stopRequested = false;
      toggleButtons();
      // Only after a run that actually worked. state.fatal means the run
      // died on a stuck dialog, and a run that ended on the rate-limit or
      // can't-find-the-button paths leaves an attention status up — asking
      // for a review over the top of either is asking for a bad one.
      if (!state.fatal && !ATTENTION_STATUSES.has(state.statusKey)) maybeShowPrompt();
    }
  }

  function requestStop() {
    if (!state.running) return;
    state.stopRequested = true;
    setStatus('statusStopping');
  }

  // Chrome throttles setTimeout/setInterval in background tabs to save
  // power — everything here (the per-post delay, waitFor's polling) runs on
  // those timers, so a backgrounded run doesn't stop, it just slows to a
  // crawl until the tab is visible again. Surface that so it doesn't look
  // like it silently died. The loop's own setStatus('statusRunning') calls will
  // naturally overwrite this once it's ticking again at full speed.
  function handleVisibilityChange() {
    if (!state.running) return;
    if (document.hidden) {
      setStatus('statusBackground');
    } else {
      setStatus('statusRunning');
    }
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  async function init() {
    await loadSettings();
    await loadUiPrefs();
    createPanel();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const persisted = await loadPersistedState();
    if (persisted) {
      state.unsavedCount = persisted.unsavedCount || 0;
      state.skippedCount = persisted.skippedCount || 0;
      state.skipLog = persisted.skipLog || [];
    }
    updateCounts();
    renderPersistedLog();
    refreshPageContext();
  }

  // ---------------------------------------------------------------------
  // Entry point
  //
  // The content script now runs on all of instagram.com (not just /saved/
  // URLs) so it's already present by the time you navigate to Saved.
  // That's needed because Instagram is a single-page app: clicking to Saved
  // from elsewhere in the app changes the URL via the History API rather
  // than a full page load, and this script only executes once per actual
  // page load — without watching for History API navigation too, the panel
  // would only appear after a manual refresh.
  // ---------------------------------------------------------------------

  let started = false;

  // Opening a post/reel from the grid (including our own automation
  // clicking a tile — see processTile) shows it as a dialog *over* the grid,
  // but Instagram still points the address bar at /p/<code>/ or
  // /reel/<code>/ while it's open via the History API. That's not actually
  // leaving the All posts page, so it must not count as "navigated away"
  // below, or every single post the automation opens would look like a
  // navigation and immediately stop the run.
  function isPostOverlayPath(pathname) {
    return /^\/(p|reel)\/[^/]+\/?$/.test(pathname);
  }

  // Called on the initial load and every SPA navigation (see the URL poll
  // and popstate listener below) to keep the panel's
  // presence in sync with whether you're actually on the All posts grid —
  // creating/revealing it there, and hiding it (and halting any active run,
  // since its DOM queries would otherwise be running blind against whatever
  // unrelated page you've navigated to) if you genuinely navigate elsewhere.
  function syncWithLocation() {
    if (isSavedPage()) {
      if (!started) {
        started = true;
        init();
      } else {
        if (!dismissedByUser) showPanel();
        refreshPageContext();
      }
    } else if (!isPostOverlayPath(window.location.pathname)) {
      if (state.running) requestStop();
      hidePanel();
    }
  }

  // Monkey-patching history.pushState/replaceState was tried here first, but
  // Instagram's own router captured a direct reference to the native
  // functions before this content script runs, so it never actually calls
  // our wrapped versions — the panel just stayed visible on every other
  // page. A plain poll can't be bypassed that way: it doesn't care *how*
  // the URL changed, only that it did. popstate (back/forward) is kept too
  // since it fires instantly rather than waiting for the next tick.
  let lastPathname = window.location.pathname;
  setInterval(() => {
    if (window.location.pathname !== lastPathname) {
      lastPathname = window.location.pathname;
      syncWithLocation();
    }
  }, 500);
  window.addEventListener('popstate', syncWithLocation);

  syncWithLocation();
})();
