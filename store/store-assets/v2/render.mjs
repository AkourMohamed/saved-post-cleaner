// Renders every v2 page to a PNG at its exact Web Store size, using a local
// Chrome/Edge/Brave in headless mode with a throwaway profile.
//
//   node store/store-assets/v2/render.mjs            # all pages
//   node store/store-assets/v2/render.mjs shot-1     # names containing "shot-1"
//
// Output: store/store-assets/v2/out/<page>.png

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  ['shot-1-one-click', 1280, 800],
  ['shot-2-running', 1280, 800],
  ['shot-3-settings', 1280, 800],
  ['shot-4-safety', 1280, 800],
  ['shot-5-languages', 1280, 800],
  ['promo-small-440x280', 440, 280],
  ['marquee-1400x560', 1400, 560],
];

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const browser = process.env.CHROME || BROWSERS.find((p) => existsSync(p));
if (!browser) {
  console.error('No Chrome/Edge/Brave found. Set CHROME=/path/to/chrome.');
  process.exit(1);
}

const filter = process.argv[2];
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'spc-render-'));

let failed = 0;
for (const [name, w, h] of PAGES) {
  if (filter && !name.includes(filter)) continue;
  const page = join(here, name + '.html');
  if (!existsSync(page)) {
    console.log('skip (missing)', name);
    continue;
  }
  const out = join(outDir, name + '.png');
  const r = spawnSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--allow-file-access-from-files',
    '--user-data-dir=' + profile,
    '--window-size=' + w + ',' + h,
    '--virtual-time-budget=2000',
    '--screenshot=' + out,
    pathToFileURL(page).href,
  ], { encoding: 'utf8' });
  if (r.status === 0 && existsSync(out)) {
    console.log('ok  ', name, w + 'x' + h);
  } else {
    failed++;
    console.log('FAIL', name, r.status, (r.stderr || '').split('\n').slice(-3).join(' '));
  }
}

rmSync(profile, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
