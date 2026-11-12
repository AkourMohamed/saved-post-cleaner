# Saved Post Cleaner

A small, local-only Chrome extension that helps you unsave posts you've saved on Instagram, by clicking through your own already-open, already-logged-in session. It does not store credentials, does not log in for you, and does not call any Instagram API — it only reads the page and dispatches clicks, the same as you would by hand.

## What it does

- Only activates on your Saved pages: the **All posts** grid, a **named collection**, and the collections overview (where it explains that you need to open one of the two grids). It stays out of the way everywhere else on Instagram.
- Injects a small floating panel with **Start**, **Stop**, a live status line, counters for posts unsaved/skipped, and **Settings**/**Reset** links. Drag it anywhere — it remembers where you put it — or **minimize** it to a title pill that still shows the live count.
- A **Settings page** (`options.html`, reachable via the panel's Settings link or the extension's "Details → Extension options" in `chrome://extensions`) lets you configure the interface language, the pacing delay, the periodic cooldown break, and the per-run session cap — see *Settings* below. It opens itself once on first install, so a fresh install isn't just a new toolbar icon and no explanation. Ships with a recommended default; you can override any of it.
- The panel, popup and Settings page are available in **12 languages** — see *Language support* below for the list, and for what is (and isn't) translated.
- Counters and the skip log persist across page reloads and the session cap (via `chrome.storage.local`, kept entirely on your machine — no network calls). Click **Reset** in the panel header to clear them.
- On **Start**: finds a saved post tile, opens it, finds its "remove from saved" control (matched by `aria-label`, not CSS classes — see *Why aria-label matching* below), clicks it, closes the post, and moves on. Scrolls to load more tiles once the visible ones are exhausted, and stops automatically when nothing new loads.
- Uses a randomized delay between posts, an optional periodic cooldown break, and a hard stop after N actions in a single run — all configurable from Settings (see *Rate limits* below for the recommended defaults and why they exist).
- If it can't confidently find the unsave control on a post (ambiguous or missing), it **skips and logs it** instead of guessing — you'll see the reason in the panel's log area and in the browser console. Three of those in a row stops the run with an explanation, rather than skipping your whole grid.
- After clicking, it **waits for Instagram to confirm** the change rather than checking once after a fixed pause — so a slow connection no longer gets counted as a failed unsave.
- Closing each post is **verified**, escalating through the close button, Escape, and browser-back. A post that refuses to close ends the run instead of leaving every later action pointed at the wrong post.
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
   - Clicking through to Saved from inside Instagram works too — the panel follows the app's own navigation, so no refresh is needed. (If the panel is ever missing after an extension update, one refresh of the tab reattaches it.)
3. A small "Saved Post Cleaner" panel appears in the bottom-right corner.
4. Click **Start**. Watch it work — it opens each saved post, unsaves it, closes it, and moves to the next, scrolling to load more as needed.
5. Click **Stop** at any time to halt after the current post finishes.
6. If it reaches the end of your saved posts, it stops itself and says "Done."

## Settings

Open the Settings page (panel → **Settings**, or `chrome://extensions` → Saved Post Cleaner → **Extension options**) to configure:

- **Language** — the interface language of the extension itself. Defaults to *Automatic*, which follows your browser's language preferences; pick a specific language to override that. Changing the dropdown re-renders the page immediately as a preview, so you can see a language before committing to it — nothing is stored until you press **Save**, and reloading the page gets you back if you picked one you can't read.
- **Pacing between posts** — minimum/maximum delay in seconds, randomized for every post rather than a fixed interval.
- **Cooldown break** — an optional longer randomized pause every N successful unsaves, on top of the per-post delay. Can be turned off entirely.
- **Session limit** — how many actions a single run performs before pausing and requiring you to click **Start** again.
- **Presets** — *Careful*, *Balanced* and *Fast* fill the three groups above in one click, for when you'd rather not reason about milliseconds. They only fill in the fields; nothing is stored until you press **Save**.
- **Advanced → button label** — the escape hatch for an Instagram language the built-in list doesn't cover. See *Reading Instagram in any language* below.

Settings are stored in `chrome.storage.sync` (so they follow you across your signed-in Chrome installs, nothing external) and take effect the next time you load or reload the Saved page. Use **Restore recommended defaults** to reset to the shipped values at any time.

The one exception to "takes effect on next reload" is **Language**: an already-open Saved tab re-labels its panel the moment you save, without a reload. A stale pacing value is invisible; a stale language is visible in every label at once, which would look broken.

## Language support

The extension's own interface — the on-page panel, the toolbar popup, and the Settings page — ships in:

| | | |
|---|---|---|
| English | Français (French) | Español (Spanish) |
| Português (Portuguese) | Italiano (Italian) | Deutsch (German) |
| Nederlands (Dutch) | Türkçe (Turkish) | العربية (Arabic) |
| हिन्दी (Hindi) | Bahasa Indonesia | Русский (Russian) |

Arabic renders right-to-left. The panel and Settings page set their own `dir` explicitly rather than inheriting it, because Instagram sets `dir="rtl"` on `<html>` for its own RTL locales — without that, an English panel would flip on an Arabic Instagram, and an Arabic panel would stay left-to-right on an English one.

Regional variants fold into the language they belong to, so `pt-BR` and `pt-PT` both get Portuguese, `fr-CA` gets French, and so on. A language tag we don't ship falls through to the next one in your browser's preference list, and to English only if none of them match.

### Reading Instagram in any language

Separately from the interface language above, the automation has to recognise Instagram's *own* wording — the `aria-label` on the bookmark button, the post dialog's close button, and Instagram's rate-limit messaging. Those are matched in **32 languages** (`IGSC_IG_LABELS` in `i18n.js`), so an Instagram account set to Turkish, Arabic, Japanese, Portuguese and so on works without any configuration.

The two settings are independent on purpose: you can run Chrome in English with Instagram in Arabic, or the reverse. Matching happens in three passes, most specific first, and each pass only wins if it matches exactly one element in the dialog:

1. A label you entered yourself under **Settings → Advanced**.
2. The language Instagram's own page declares in `<html lang>`.
3. The union of all 32 languages.

If none of them can identify the button on three posts in a row, the run **stops** and the panel tells you to enter the label under Settings → Advanced — rather than skipping your entire grid and reporting "Done", which is what it used to do.

To fix an unsupported language yourself: open a saved post on Instagram, hover the bookmark icon, and type what it says into **Settings → Advanced**. Several labels can be separated by commas. To fix it for everyone, add the wording to `IGSC_IG_LABELS` in `src/i18n.js` and open a PR.

Two deliberate exceptions:

- **"Saved Post Cleaner"** stays untranslated everywhere. It's the product name — what `chrome://extensions` and the Web Store listing call it in every locale.
- **Console messages stay in English** regardless of the interface language. They're the developer-facing surface, and an English message is what makes a pasted bug report searchable against this source.

### Translations

Everything except English was translated without a native speaker's review, so treat them as good-faith drafts rather than checked copy — the Latin-script European languages are the most reliable. A language can be flagged `reviewNeeded: true` in `IGSC_LANGUAGES`, which labels it in the dropdown itself so nobody mistakes a draft for a checked translation. Corrections are welcome — they're plain strings in one file, no build step involved.

### Adding or fixing a language

All of it lives in `src/i18n.js`:

1. Add an entry to `IGSC_LANGUAGES` — `code`, `name` (the language's own endonym, since that's what someone scans for), and `dir`. Add `reviewNeeded: true` if it hasn't been checked by a speaker.
2. Add a block to `IGSC_MESSAGES` with the same keys as `IGSC_MESSAGES.en`. Any key you leave out falls back to English rather than rendering blank, so a partial translation is perfectly usable.
3. Reload the extension in `chrome://extensions`.

Nothing else needs touching — the Settings dropdown is built from `IGSC_LANGUAGES`, and the options page fills itself in from the `data-i18n` attributes in `options.html`.

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

## If something goes wrong

The panel is designed to tell you what happened rather than fail quietly. Every one of these stops the run and says so, instead of continuing:

| What you see | What it means | What to do |
|---|---|---|
| *Can't find Instagram's unsave button* | Instagram is in a language the built-in list doesn't cover, or Instagram changed the wording. Stops after 3 posts, not after your whole grid. | Settings → Advanced → type the button's exact label |
| *Instagram showed a rate-limit message* | Either Instagram said so outright, or three clicks in a row were silently ignored — which is what throttling looks like from inside the page | Stop for a few hours; consider the **Careful** preset |
| *Open "All posts" or one of your collections* | You're on the collections overview, which has no post tiles | Open a grid |
| *Stopped due to an unexpected error* | A post dialog wouldn't close, so continuing would act on the wrong post | Reload the page and start again; check the console |

The counters distinguish **Unsaved** from **Skipped** precisely so a run that isn't working is visible immediately rather than after 200 posts.

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
- Recognises Instagram's own wording in 32 languages; on an Instagram set to anything outside that list you enter the button's label once under Settings → Advanced — see *Language support* above.
- Chrome throttles JavaScript timers in background tabs, which this extension's delays and polling run on — switching away from the Saved tab slows a run to a crawl until you switch back (the panel's status line says so while it's happening). To keep it running at full speed while you do something else, put the Saved page in its own separate Chrome **window** positioned somewhere visible on screen, rather than switching tabs inside the same window.

## Icon

`icons/icon16.png`, `icon48.png`, and `icon128.png` (referenced from `manifest.json`) are an original bookmark-ribbon mark on a blue→teal gradient circle — generated from scratch, not adapted from any existing logo, so there's no licensing question and no visual implication of an official Instagram affiliation. `icons/generate_icons.py` is the Pillow script that built them from one definition; `icons/icon-master.png` is the 1024px source if you want a high-res version for a Chrome Web Store promo image. Tweak the script and re-run (`python generate_icons.py` from inside `icons/`) to change the design — it's a one-off local tool, not something the extension itself loads.

## Support

If this saved you time, donations are welcome: **[Support this project](https://paypal.me/meedruoka)**.

The panel also shows a dismissible ask — a link to leave a review and a link to tip — but only once the extension has actually cleared 25 or more saved posts for you, and never after a run that failed or hit a rate limit. It appears when a run ends (Stop, Done, or the session cap) and clears when the next run starts, so it never sits underneath a live status line; each time it reappears it shows the current total. Following either link leaves it in place — opening the review page isn't the same as having written the review. Only the **✕** ends it for good. Both links are plain `href`s in `config.js` (`IGSC_SUPPORT_URL`, and a review URL built at runtime from the extension's own id): nothing is fetched, pinged or preloaded, so this doesn't affect the "no network calls" property or the Web Store data disclosure. On an unpacked development build the review link is hidden, since there's no listing to review.

This is entirely optional — the extension is free and fully functional without it. The same link appears at the bottom of the in-extension Settings page (`options.html`), since most users installing from the Chrome Web Store won't see this README.
