#!/usr/bin/env node
/**
 * Capture the mockup screenshots in screenshots/ using Playwright + Chromium.
 *
 * Prereqs (not repo dependencies — install on demand):
 *   npm i -D playwright-core          # or: playwright
 *   # a Chromium build; set CHROMIUM_PATH, or rely on Playwright's default.
 *
 * USAGE
 *   node solution/app/mockup/build-mockup.mjs        # build the HTML first
 *   node solution/app/mockup/screenshot.mjs          # then capture PNGs
 *
 * Writes screenshots/ember-dashboard.png and screenshots/ember-environment-dropdown.png.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const mock = join(__dir, 'flow-review-mockup.html');
if (!existsSync(mock)) { console.error('Build it first: node build-mockup.mjs'); process.exit(1); }

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { try { ({ chromium } = await import('playwright')); } catch { console.error('Install playwright-core (npm i -D playwright-core).'); process.exit(1); } }

const launch = {};
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (existsSync(exe)) launch.executablePath = exe;
launch.args = ['--no-sandbox'];

const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
await page.goto('file://' + mock, { waitUntil: 'networkidle' });
const frame = page.frameLocator('#wrframe');
await frame.locator('#envFilter').waitFor({ state: 'attached', timeout: 20000 });
await page.waitForTimeout(1000);

await page.screenshot({ path: join(__dir, 'screenshots', 'ember-dashboard.png') });

// native <select> can't be screenshotted open, so mirror its options into a floating list for the shot
await frame.locator('.envfilter').evaluate((el) => { el.style.outline = '2px solid #e5484d'; el.style.outlineOffset = '3px'; el.style.borderRadius = '8px'; });
await frame.locator('#envFilter').evaluate((sel) => {
  const r = sel.getBoundingClientRect();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + (r.bottom + 4) + 'px;z-index:9999;background:#fff;border:1px solid #c3cbe0;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:4px;font:13px Segoe UI,sans-serif;min-width:190px';
  box.innerHTML = [...sel.options].map((o, i) => '<div style="padding:7px 12px;border-radius:5px;' + (i === 0 ? 'background:#e5ebff;color:#1b3ad1;font-weight:600' : 'color:#1b2233') + '">' + o.textContent + '</div>').join('');
  document.body.appendChild(box);
});
await page.waitForTimeout(200);
await page.screenshot({ path: join(__dir, 'screenshots', 'ember-environment-dropdown.png') });

await browser.close();
console.log('Wrote screenshots/ember-dashboard.png and screenshots/ember-environment-dropdown.png');
