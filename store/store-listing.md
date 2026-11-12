# Chrome Web Store listing copy

Reference copy for the Developer Dashboard fields. Not used by the extension
itself — just kept here so it's versioned alongside the code and easy to
update later.

Listing version: **1.5.0** (the live listing was still on 1.2.0 when this was
written — English only, with the older description).

## Name

The Store title comes from `name` in `manifest.json`, so change it there, not
in the dashboard. It now includes the word people actually search for:

```
Saved Post Cleaner – Unsave Instagram Saved Posts
```

## Category

**Tools** (this is what the live listing already shows — keep the dashboard
and this file in step).

## Summary (short description, ≤132 characters)

Like the title, the Store takes this from `manifest.json` (the `description`
field) and it can't be edited in the dashboard — change it there. Current
text, 131 characters:

```
Unsaves your Instagram saved posts one at a time in your own logged-in session. Works in any Instagram language. No login, no APIs.
```

## Detailed description

```
Unsave hundreds of Instagram saved posts without tapping "Remove" on every one.

Saved Post Cleaner clears out a large Instagram "Saved" list for you, one post at a time, using your own logged-in session.

• One click to your Saved posts — click the toolbar icon from any tab and it takes you straight there
• Start / Stop panel on the page — drag it anywhere, minimize it, or close it
• Safe pacing — randomized delays, cooldown breaks and a per-run limit, all adjustable
• Works in any Instagram language — recognises Instagram's own buttons in 32 languages
• Stops and tells you why when something is wrong — it never fails silently
• Private — no password, no account, no network calls

HOW IT WORKS
1. Log into Instagram yourself, in a normal tab, the same way you always do.
2. Click the Saved Post Cleaner icon in your toolbar. It opens your Saved posts and shows a small control panel. (The panel never appears on its own.)
3. Click Start. It opens each saved post, clicks its own "remove from saved" control, closes the post and moves to the next one — the same clicks you'd make by hand, just automated.
4. Click Stop at any time.

Nothing is unsaved until you press Start.

WHAT IT DOESN'T DO
- It never asks for or stores your Instagram password — you log in yourself, normally.
- It makes no network or API calls of any kind. Everything happens by reading and clicking the page you're already on.
- It never unsaves anything on its own — only after you press Start.

BUILT-IN SAFETY
- Randomized delays between posts, plus an optional periodic cooldown break — both configurable in Settings — so activity doesn't look like a flat, continuous bot run.
- A per-run session limit, after which it pauses and waits for you to click Start again rather than running unattended for hours.
- If it can't confidently identify a post's "unsave" control, it skips that post and logs why instead of guessing.
- If Instagram shows its own rate-limit message — or simply starts ignoring the clicks, which is what throttling usually looks like — the extension stops immediately.
- Every stop explains itself in the panel. It never skips your whole list in silence and then reports success.

SETTINGS
Open the Settings page to adjust the interface language, the pacing delay, the cooldown break and the session limit, or restore the recommended defaults at any time. Presets (Careful, Balanced, Fast) fill them in with one click.

LANGUAGES
Works whatever language your Instagram is in — it recognises Instagram's own buttons in 32 languages, and if yours isn't among them you can enter the button's label once under Settings > Advanced.

The extension's own interface is available in English, French, Spanish, Portuguese, Italian, German, Dutch, Turkish, Arabic (right-to-left), Hindi, Indonesian and Russian — set automatically from your browser's language, or chosen manually in Settings.

SUPPORT
Something not working? Open an issue and include what the panel said — that message usually pinpoints the problem: https://github.com/AkourMohamed/saved-post-cleaner/issues
You can also use the developer email on this page.

This extension is not affiliated with, endorsed by, or sponsored by Instagram or Meta Platforms, Inc. Instagram is a trademark of Meta Platforms, Inc.
```

## Support / homepage URL fields

Homepage URL:

```
https://github.com/AkourMohamed/saved-post-cleaner
```

Support URL:

```
https://github.com/AkourMohamed/saved-post-cleaner/issues
```

The repository is public with Issues enabled. If it is ever made private
again, these links (and the description's SUPPORT section) 404 for everyone
but the owner — switch them back to the developer email first.

## Privacy tab — permission justification

**Single purpose description:**
```
Automates unsaving posts on the user's own Instagram Saved page via on-page DOM interaction, triggered manually by the user.
```

**Justification for `storage` permission:**
```
Used only to store the user's own pacing/settings preferences, local activity counters (posts unsaved/skipped), the panel's on-screen position, and the user's own Instagram username (so the toolbar button can open their Saved page) on-device via chrome.storage. No data is collected, transmitted, or shared with any server.
```

**Justification for `activeTab` permission:**
```
Used when the user clicks the toolbar button, to see whether the current tab is already their Instagram Saved page (in which case the on-page control panel is shown) or another page (in which case the tab or a new tab is taken to the user's Saved page). It is only used in response to that click and reads nothing from other sites.
```

**Justification for host access (`https://www.instagram.com/*`):**
```
The extension's on-page control panel and its unsave automation run as a content script on instagram.com, because Instagram is a single-page app and the user can reach their Saved page from any instagram.com URL without a full page load. The script does nothing on pages other than the user's own Saved page except remember their username and, after a toolbar click, navigate to it. It makes no network requests.
```

**Data disclosure:** None collected. All state stays in the user's local/synced Chrome storage.

## Graphic assets

Generated from HTML in `store/store-assets/v2/` — each page links the real
`src/overlay.css`, so the panel in every image is the shipped panel, not a
drawing of it. Upload these from `store/store-assets/v2/out/`:

| Dashboard slot | File |
| --- | --- |
| Screenshot 1 | `shot-1-one-click.png` — one click to your Saved posts |
| Screenshot 2 | `shot-2-running.png` — clearing hands-free, live count |
| Screenshot 3 | `shot-3-settings.png` — pacing presets and settings |
| Screenshot 4 | `shot-4-safety.png` — stops and says why |
| Screenshot 5 | `shot-5-languages.png` — French and Arabic panels |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Marquee promo tile (1400×560) | `marquee-1400x560.png` |

Screenshots are 1280×800, 24-bit PNG (no alpha), as the Store asks.

To change copy or regenerate after a UI change, edit the HTML and run:

```
node store/store-assets/v2/render.mjs
```

It uses your local Chrome, Edge or Brave in headless mode (set `CHROME` to
override). Delete the old `screenshot-1-panel.png` from the dashboard.
