# Chrome Web Store listing copy

Reference copy for the Developer Dashboard fields. Not used by the extension
itself — just kept here so it's versioned alongside the code and easy to
update later.

## Category

**Productivity**

## Summary (short description, ≤132 characters)

```
Bulk-unsaves your saved Instagram posts, one at a time, in your own browser session. No login stored, no API calls.
```

## Detailed description

```
Saved Post Cleaner helps you clear out a large Instagram "Saved" list without tapping "Remove" on every post by hand.

HOW IT WORKS
You log into Instagram yourself, in a normal tab, the same way you always do. Once you're on your Saved page, this extension adds a small on-page panel with a Start and Stop button. When you click Start, it opens each saved post, clicks its own "remove from saved" control, closes the post, and moves to the next one — the same clicks you'd make by hand, just automated. Nothing runs until you click Start, and you can click Stop at any time.

WHAT IT DOESN'T DO
- It never asks for or stores your Instagram password — you log in yourself, normally.
- It makes no network or API calls of any kind. Everything happens by reading and clicking the page you're already on.
- It doesn't run in the background or do anything automatically — only after you press Start.

BUILT-IN SAFETY
- Randomized delays between posts, plus an optional periodic cooldown break — both configurable in Settings — so activity doesn't look like a flat, continuous bot run.
- A per-run session limit, after which it pauses and waits for you to click Start again rather than running unattended for hours.
- If it can't confidently identify a post's "unsave" control, it skips that post and logs why instead of guessing.
- If Instagram shows its own rate-limit message, the extension stops immediately.

SETTINGS
Open the Settings page to adjust the pacing delay, the cooldown break, and the session limit, or restore the recommended defaults at any time.

This extension is not affiliated with, endorsed by, or sponsored by Instagram or Meta Platforms, Inc. Instagram is a trademark of Meta Platforms, Inc.
```

## Privacy tab — permission justification

**Single purpose description:**
```
Automates unsaving posts on the user's own Instagram Saved page via on-page DOM interaction, triggered manually by the user.
```

**Justification for `storage` permission:**
```
Used only to store the user's own pacing/settings preferences and local activity counters (posts unsaved/skipped) on-device via chrome.storage. No data is collected, transmitted, or shared with any server.
```

**Data disclosure:** None collected. All state stays in the user's local/synced Chrome storage.
