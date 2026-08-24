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

  function isSavedPage() {
    // Only the "All posts" grid — /<username>/saved/all-posts/. The bare
    // /<username>/saved/ root is just the collections overview (no post
    // tiles to act on), and named collections have their own separate
    // grids this hasn't been taught to handle, so neither should show the
    // panel.
    return /^\/[A-Za-z0-9._]+\/saved\/all-posts\/?$/.test(window.location.pathname);
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
    ACTION_CONFIRM_WAIT_MS: 500, // pause after clicking unsave before checking it worked

    // Small fixed pauses purely so Instagram's own animations/DOM updates
    // finish before we query it again — not part of the human-pacing
    // strategy, so these are trimmed to the minimum that stays reliable.
    PRE_CLICK_SETTLE_MS: 100,
    DIALOG_RENDER_SETTLE_MS: 150,
    POST_CLOSE_SETTLE_MS: 100,
  };

  // Known phrasing Instagram has used for the "unsave" toggle's aria-label.
  // As of 2026 the bookmark icon on an already-saved post is labeled with a
  // bare "Remove" (confirmed via DevTools against the live dialog markup) —
  // no "saved" wording at all. Older Instagram releases used fuller phrasing
  // like "Remove from your saved items", so both are matched here since
  // this has changed before and will likely change again. `^remove$`
  // requires an *exact* match (not just "remove" as a substring) so this
  // doesn't accidentally match unrelated controls like "Remove tag".
  const UNSAVE_LABEL_PATTERN = /^remove$|remove from (your )?saved|unsave/i;

  // Wording Instagram shows when it's throttling an action on your account.
  const RATE_LIMIT_TEXT_PATTERN = /try again later|please wait a few minutes|action blocked|we restrict certain activity/i;

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

  async function loadSettings() {
    try {
      const data = await chrome.storage.sync.get(IGSC_SETTINGS_KEY);
      settings = igscResolveSettings(data[IGSC_SETTINGS_KEY]);
    } catch (err) {
      console.warn('[Saved Post Cleaner] Could not load settings, using recommended defaults:', err);
      settings = igscResolveSettings(null);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes[IGSC_SETTINGS_KEY]) {
      settings = igscResolveSettings(changes[IGSC_SETTINGS_KEY].newValue);
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
    skipLog: [], // { href, reason, ts } — newest first
  };

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
  // True once the user has explicitly closed the panel with ✕ — suppresses
  // re-showing it when navigating back to the All posts grid, until the
  // toolbar popup's IGSC_SHOW_PANEL message clears it again.
  let dismissedByUser = false;

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'igsc-panel';
    panel.innerHTML = `
      <div class="igsc-header" id="igsc-drag-handle">
        <span>Saved Post Cleaner</span>
        <span class="igsc-header-actions">
          <button id="igsc-settings" class="igsc-reset-btn" title="Open settings">Settings</button>
          <button id="igsc-reset" class="igsc-reset-btn" title="Reset saved stats and skip log">Reset</button>
          <button id="igsc-close" class="igsc-reset-btn" title="Close panel">✕</button>
        </span>
      </div>
      <div class="igsc-status" id="igsc-status">Idle. Click Start to begin.</div>
      <div class="igsc-counts">
        <span>Unsaved: <b id="igsc-count-unsaved">0</b></span>
        <span>Skipped: <b id="igsc-count-skipped">0</b></span>
      </div>
      <div class="igsc-buttons">
        <button id="igsc-start">Start</button>
        <button id="igsc-stop" disabled>Stop</button>
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
      log: panel.querySelector('#igsc-log'),
    };

    els.startBtn.addEventListener('click', startAutomation);
    els.stopBtn.addEventListener('click', requestStop);
    els.resetBtn.addEventListener('click', resetStats);
    // chrome.runtime.openOptionsPage() isn't available from a content script
    // (only from extension pages like a background script or the popup) —
    // it fails silently there, so open the options page directly by URL
    // instead. chrome.runtime.getURL() *is* available to content scripts.
    els.settingsBtn.addEventListener('click', () => window.open(chrome.runtime.getURL('src/options/options.html'), '_blank'));
    els.closeBtn.addEventListener('click', () => {
      dismissedByUser = true;
      hidePanel();
    });

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
    panelEl.style.left = `${e.clientX - dragOffset.x}px`;
    panelEl.style.top = `${e.clientY - dragOffset.y}px`;
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    dragOffset = null;
  });

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  function updateCounts() {
    if (els.countUnsaved) els.countUnsaved.textContent = String(state.unsavedCount);
    if (els.countSkipped) els.countSkipped.textContent = String(state.skippedCount);
  }

  function appendLogLine(text) {
    if (!els.log) return;
    const line = document.createElement('div');
    line.textContent = text;
    els.log.prepend(line);
    // Keep the log short so it doesn't grow unbounded during a long run.
    while (els.log.children.length > 6) {
      els.log.removeChild(els.log.lastChild);
    }
  }

  function toggleButtons() {
    if (!els.startBtn || !els.stopBtn) return;
    els.startBtn.disabled = state.running;
    els.stopBtn.disabled = !state.running;
  }

  function logSkip(href, reason) {
    state.skippedCount++;
    state.skipLog.unshift({ href, reason, ts: Date.now() });
    if (state.skipLog.length > MAX_PERSISTED_LOG_ENTRIES) {
      state.skipLog.length = MAX_PERSISTED_LOG_ENTRIES;
    }
    updateCounts();
    console.warn(`[Saved Post Cleaner] Skipped ${href}: ${reason}`);
    appendLogLine(`Skipped: ${reason}`);
    savePersistedState();
  }

  function renderPersistedLog() {
    if (!els.log) return;
    els.log.innerHTML = '';
    state.skipLog.slice(0, 6).forEach((entry) => {
      const line = document.createElement('div');
      line.textContent = `Skipped: ${entry.reason}`;
      els.log.appendChild(line);
    });
  }

  async function resetStats() {
    if (state.running) return; // don't clear stats mid-run
    const confirmed = window.confirm(
      'Reset Saved Post Cleaner stats and skip log? This only clears the counters/log this extension stores locally — it does not re-save any posts.'
    );
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

  function findUnsaveControl(dialog) {
    // Search only within the open post dialog for an element whose
    // aria-label matches "unsave" phrasing. The label can live on a <svg>,
    // a wrapping <button>, or a <div role="button"> depending on the
    // current markup, so we don't assume a tag — just the label text.
    const candidates = Array.from(dialog.querySelectorAll('[aria-label]')).filter((el) =>
      UNSAVE_LABEL_PATTERN.test(el.getAttribute('aria-label') || '')
    );

    if (candidates.length !== 1) {
      // Zero matches means the control wasn't found (markup likely changed).
      // More than one match means we can't tell which is the real one.
      // Either way, guessing risks clicking the wrong control, so skip.
      return null;
    }
    return candidates[0];
  }

  function findCloseControl(dialog) {
    return Array.from(dialog.querySelectorAll('[aria-label]')).find((el) =>
      /^close$/i.test(el.getAttribute('aria-label') || '')
    );
  }

  function clickElement(el) {
    // aria-label often sits on an inner <svg>; walk up to the actual
    // clickable ancestor so the click lands where React's handler expects.
    const target = el.closest('button, [role="button"], a') || el;
    target.click();
  }

  function closeDialog(dialog) {
    const closeBtn = findCloseControl(dialog);
    if (closeBtn) {
      clickElement(closeBtn);
      return;
    }
    // Fallback if no close button was found: Instagram's post modal also
    // closes on Escape.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }

  function verifyUnsaved(dialog, previousControl) {
    // On success Instagram swaps the control's aria-label from "unsave"
    // phrasing back to something like "Save". If the dialog itself closed
    // as a side effect, or the element was replaced entirely, treat that as
    // success too rather than failing to confirm a real action.
    if (!document.body.contains(dialog)) return true;
    if (!document.body.contains(previousControl)) return true;
    const label = previousControl.getAttribute('aria-label') || '';
    return !UNSAVE_LABEL_PATTERN.test(label);
  }

  function detectRateLimitBanner() {
    return RATE_LIMIT_TEXT_PATTERN.test(document.body.innerText || '');
  }

  // ---------------------------------------------------------------------
  // Automation core
  // ---------------------------------------------------------------------

  async function processTile(tile) {
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
        logSkip(label, 'Post did not open in time');
        return;
      }

      await sleep(CONFIG.DIALOG_RENDER_SETTLE_MS); // let the dialog finish rendering its controls

      const unsaveControl = findUnsaveControl(dialog);
      if (!unsaveControl) {
        logSkip(label, 'Could not confidently identify the unsave control');
        closeDialog(dialog);
        return;
      }

      clickElement(unsaveControl);
      await sleep(CONFIG.ACTION_CONFIRM_WAIT_MS);

      if (verifyUnsaved(dialog, unsaveControl)) {
        state.unsavedCount++;
        state.actionsThisSession++;
        updateCounts();
        savePersistedState();
      } else {
        logSkip(label, 'Clicked unsave but could not confirm it took effect');
      }

      closeDialog(dialog);
      await sleep(CONFIG.POST_CLOSE_SETTLE_MS);
    } finally {
      tile.classList.remove('igsc-processing');
    }
  }

  async function cooldownPause() {
    setStatus('Cooling down for a bit before continuing (keeps a human-like pace)…');
    await randomDelay(settings.cooldownMinMs, settings.cooldownMaxMs);
    if (!state.stopRequested) setStatus('Running…');
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
        setStatus(`Paused after ${settings.maxActionsPerSession} actions this session. Click Start to continue.`);
        break;
      }

      if (detectRateLimitBanner()) {
        setStatus('Instagram showed a rate-limit message — stopping to be safe. Try again later.');
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
            setStatus('Done — no more saved posts found.');
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
        logSkip(tile.href, 'Unexpected error — see browser console');
        // Best-effort recovery: if a dialog got left open, close it so the
        // next tile isn't blocked by it.
        const strandedDialog = document.querySelector('div[role="dialog"]');
        if (strandedDialog) closeDialog(strandedDialog);
      }

      if (state.stopRequested) break;

      const justUnsaved = state.unsavedCount > unsavedBefore;
      if (settings.cooldownEnabled && justUnsaved && state.unsavedCount % settings.cooldownEvery === 0) {
        await cooldownPause();
      } else {
        setStatus('Running…');
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
    toggleButtons();
    setStatus('Running…');

    try {
      await runLoop();
    } catch (err) {
      console.error('[Saved Post Cleaner] Stopped due to an unexpected error:', err);
      setStatus('Stopped due to an unexpected error — see the browser console.');
    } finally {
      state.running = false;
      state.stopRequested = false;
      toggleButtons();
    }
  }

  function requestStop() {
    if (!state.running) return;
    state.stopRequested = true;
    setStatus('Stopping…');
  }

  // Chrome throttles setTimeout/setInterval in background tabs to save
  // power — everything here (the per-post delay, waitFor's polling) runs on
  // those timers, so a backgrounded run doesn't stop, it just slows to a
  // crawl until the tab is visible again. Surface that so it doesn't look
  // like it silently died. The loop's own setStatus('Running…') calls will
  // naturally overwrite this once it's ticking again at full speed.
  function handleVisibilityChange() {
    if (!state.running) return;
    if (document.hidden) {
      setStatus('Paused — tab is in the background. Chrome slows this down; switch back to speed it up.');
    } else {
      setStatus('Running…');
    }
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  async function init() {
    await loadSettings();
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
      } else if (!dismissedByUser) {
        showPanel();
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
