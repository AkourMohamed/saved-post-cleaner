# Saved Post Cleaner

A small, local-only Chrome extension that helps you unsave posts you've saved on Instagram, by clicking through your own already-open, already-logged-in session. It does not store credentials, does not log in for you, and does not call any Instagram API — it only reads the page and dispatches clicks, the same as you would by hand.

## What it does

- Only activates on `instagram.com/<username>/saved/...` pages.
- Injects a small floating panel with **Start**, **Stop**, a live status line, counters for posts unsaved/skipped, and **Settings**/**Reset** links.
- A **Settings page** (`options.html`, reachable via the panel's Settings link or the extension's "Details → Extension options" in `chrome://extensions`) lets you configure the pacing delay, the periodic cooldown break, and the per-run session cap — see *Settings* below. Ships with a recommended default; you can override any of it.
- Counters and the skip log persist across page reloads and the session cap (via `chrome.storage.local`, kept entirely on your machine — no network calls). Click **Reset** in the panel header to clear them.
- On **Start**: finds a saved post tile, opens it, finds its "remove from saved" control (matched by `aria-label`, not CSS classes — see *Why aria-label matching* below), clicks it, closes the post, and moves on. Scrolls to load more tiles once the visible ones are exhausted, and stops automatically when nothing new loads.
- Uses a randomized delay between posts, an optional periodic cooldown break, and a hard stop after N actions in a single run — all configurable from Settings (see *Rate limits* below for the recommended defaults and why they exist).
- If it can't confidently find the unsave control on a post (ambiguous or missing), it **skips and logs it** instead of guessing — you'll see the reason in the panel's log area and in the browser console.
- An unexpected error on any single post (unusual markup, a stray DOM quirk) is caught, logged as a skip, and the run continues — one bad post doesn't end the whole session.
- The tile currently being opened/unsaved gets a blue outline, so it's easy to see at a glance where a running session is.
- If you switch away from the tab while a run is active, the status line says so — Chrome throttles background tabs, which slows the run to a crawl (not a hang) until you switch back. See *Limitations* for how to avoid this if you want it running while you do something else.
- Does nothing until you click Start, and stops immediately when you click Stop.

## Installing (unpacked, dev mode)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this folder (the one containing `manifest.json`).
5. The extension is now installed. It only does something on the Saved page — see below — but you can open its Settings page any time from `chrome://extensions` → Saved Post Cleaner → **Extension options**, or from the panel's Settings link once you're on the Saved page.

## Using it

1. Log into Instagram yourself, normally, in a tab.
2. Navigate to your Saved page: `instagram.com/<your-username>/saved/all-posts/` (or open **Profile → Saved**).
   - Because Instagram is a single-page app, the extension only injects on an actual page load. If you got to Saved by clicking around inside Instagram rather than typing the URL or refreshing, **refresh the page once** so the content script attaches and the panel appears.
3. A small "Saved Post Cleaner" panel appears in the bottom-right corner.
4. Click **Start**. Watch it work — it opens each saved post, unsaves it, closes it, and moves to the next, scrolling to load more as needed.
5. Click **Stop** at any time to halt after the current post finishes.
6. If it reaches the end of your saved posts, it stops itself and says "Done."

## Settings

Open the Settings page (panel → **Settings**, or `chrome://extensions` → Saved Post Cleaner → **Extension options**) to configure:

- **Pacing between posts** — minimum/maximum delay in seconds, randomized for every post rather than a fixed interval.
- **Cooldown break** — an optional longer randomized pause every N successful unsaves, on top of the per-post delay. Can be turned off entirely.
- **Session limit** — how many actions a single run performs before pausing and requiring you to click **Start** again.

Settings are stored in `chrome.storage.sync` (so they follow you across your signed-in Chrome installs, nothing external) and take effect the next time you load or reload the Saved page. Use **Restore recommended defaults** to reset to the shipped values at any time.

## Rate limits — read this before running a big batch

Instagram doesn't publish exact automation thresholds, but based on widely observed behavior:

- **Identical, rapid-fire write actions on your own account** (follow/unfollow, like/unlike, save/unsave) can trigger a temporary "action blocked" / "Please wait a few minutes" state if done too fast or in too high a volume. This is account- and history-dependent — older, more established accounts tend to tolerate more than new ones.
- Unsave is a comparatively low-visibility action (it doesn't notify anyone, doesn't touch public counts, doesn't send requests to other users), so anecdotally it seems to get flagged less aggressively than follow/unfollow or comment automation — but it's still an authenticated write action tied to your account, and generic anti-automation heuristics (constant-interval clicking, very long unattended sessions) can still catch it.
- The **recommended defaults** (see `IGSC_DEFAULT_SETTINGS` in `config.js`, and shown on the Settings page) reflect that:
  - Randomized 1.2–2.8s delay between posts.
  - A cooldown break every 25 successful unsaves, pausing 15–30s.
  - A hard stop after **200 actions** in a single run, so you consciously restart rather than letting it run for hours unattended.
  - The panel also watches the page for Instagram's own "try again later" / "action blocked" messaging and stops immediately if it appears, regardless of your settings.
- If you do see a rate-limit message from Instagram (on this page or elsewhere in the app), **stop using the extension for a while** — a few hours is a reasonable default — before resuming. Repeatedly hitting the limit right after it clears tends to make things worse.
- If you have a very large number of saved posts, plan on running this in several sessions across a few days rather than one long unattended run.

Loosening these — shorter delays, a less frequent or disabled cooldown, a higher session cap — trades a faster cleanup for a traffic pattern that looks more like continuous automated activity, which is more likely to trip Instagram's rate-limiting. Turning the cooldown off entirely removes the one setting specifically meant to break up that pattern. **If you start seeing rate-limit messages, dial the Settings back** — don't just keep retrying. None of these numbers are guarantees; Instagram's actual enforcement can change at any time.

## Why aria-label matching (and what to do if it breaks)

Instagram's CSS class names are generated at build time and rotate frequently, so matching on them breaks within weeks. Accessibility attributes (`aria-label`, `role="dialog"`, `role="button"`) are much more stable because Instagram needs to keep them reasonably consistent for screen readers and other assistive tech — so the extension anchors its selectors there instead, along with the URL shape of post links (`/p/...`, `/reel/...`), which is a routing concern unlikely to change.

If Instagram changes its wording or markup and the extension starts skipping everything:

1. Open a saved post manually and inspect the unsave control (bookmark icon) in DevTools.
2. Check its `aria-label` (or its parent's) and compare against `UNSAVE_LABEL_PATTERN` near the top of `content.js`.
3. Update the regex to match the new wording, save, and click **Reload** on the extension in `chrome://extensions`.

## Limitations

- Settings changes apply on next page load/reload, not live mid-run (the content script does pick up changes made in another tab via `chrome.storage.onChanged`, but a run already past its next delay check won't retroactively rewind).
- The "already processed this session" tile tracking resets on reload (harmless — unsaved tiles vanish from the grid anyway), but the unsaved/skipped counters and skip log persist via `chrome.storage.local` until you hit **Reset**.
- Only handles the Saved page grid, not individual collections beyond what Instagram renders in that grid.
- Chrome throttles JavaScript timers in background tabs, which this extension's delays and polling run on — switching away from the Saved tab slows a run to a crawl until you switch back (the panel's status line says so while it's happening). To keep it running at full speed while you do something else, put the Saved page in its own separate Chrome **window** positioned somewhere visible on screen, rather than switching tabs inside the same window.

## Icon

`icons/icon16.png`, `icon48.png`, and `icon128.png` (referenced from `manifest.json`) are an original bookmark-ribbon mark on a blue→teal gradient circle — generated from scratch, not adapted from any existing logo, so there's no licensing question and no visual implication of an official Instagram affiliation. `icons/generate_icons.py` is the Pillow script that built them from one definition; `icons/icon-master.png` is the 1024px source if you want a high-res version for a Chrome Web Store promo image. Tweak the script and re-run (`python generate_icons.py` from inside `icons/`) to change the design — it's a one-off local tool, not something the extension itself loads.

## Support

If this saved you time, donations are welcome: **[Support this project](https://paypal.me/meedruoka)**.

This is entirely optional — the extension is free and fully functional without it. The same link appears at the bottom of the in-extension Settings page (`options.html`), since most users installing from the Chrome Web Store won't see this README.
