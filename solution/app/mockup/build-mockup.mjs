#!/usr/bin/env node
/**
 * Build the Ember app-shell mockup.
 *
 * Wraps the REAL web resource (webresource/bvr_flowreview_app.html) in a Power
 * Apps model-driven-app chrome — top bar, left site map with the icons from
 * solution/app/icons, and a content region that renders the web resource in an
 * iframe. Because it embeds the actual shipped web resource (base64, decoded at
 * runtime) it never drifts: rebuild and it reflects whatever the web resource
 * currently is. Clicking a left-nav item drives the embedded app via the
 * window.EMBER_EMBED / window.EMBER_DATA hooks.
 *
 * USAGE
 *   node solution/app/mockup/build-mockup.mjs [outFile]
 *   # default outFile: solution/app/mockup/flow-review-mockup.html (git-ignored)
 *
 * The output is a single self-contained HTML file (~200 KB). To capture the
 * PNGs in screenshots/, see screenshot.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '..', '..', '..');
const iconsDir = join(repoRoot, 'solution', 'app', 'icons');
const outFile = process.argv[2] || join(__dir, 'flow-review-mockup.html');

const WR = readFileSync(join(repoRoot, 'webresource', 'bvr_flowreview_app.html'), 'utf8');
const WR_B64 = Buffer.from(WR, 'utf8').toString('base64'); // no </script>/quote/backslash pitfalls
const icon = (name) => readFileSync(join(iconsDir, name + '.svg'), 'utf8').trim();

const NAV = [
  ['Review', [['Dashboard', 'dash', 'ember-dashboard'], ['Flow Inventory', 'flowinventory', 'ember-flowinventory'],
    ['Review Runs', 'reviewruns', 'ember-reviewruns'], ['Flow Reviews', 'flowreviews', 'ember-flowreviews'], ['Findings', 'findings', 'ember-findings']]],
  ['Unit Testing', [['Test Coverage', 'testcoverage', 'ember-testcoverage'], ['Test Cases', 'testcases', 'ember-testcases'], ['Test Runs', 'testruns', 'ember-testruns']]],
  ['Configuration', [['Review Standards', 'standards', 'ember-standards'], ['Review Rules', 'rules', 'ember-rules'], ['Crawl Schedule', 'schedule', 'ember-schedule']]],
];
const navHtml = NAV.map(([group, items]) =>
  `<div class="nav-group"><div class="nav-g-h">${group}</div>` +
  items.map(([label, data, ic]) =>
    `<button class="nav-item${data === 'dash' ? ' active' : ''}" data-section="${data}"><span class="nav-ic">${icon(ic)}</span><span>${label}</span></button>`).join('') +
  `</div>`).join('\n');

const CSS = `
  :root{ --nav-border:#e3e6ec; --rail:#faf9f8; --bar:#fff; --ink:#1b1a19; --muted:#605e5c; --faint:#8a8886; --accent:#7a120c; --accent-bg:#fbecea; --content:#f3f2f1; }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;font-family:'Segoe UI',-apple-system,Roboto,sans-serif;background:var(--content);color:var(--ink)}
  .app{display:flex;flex-direction:column;height:100vh;overflow:hidden}
  .topbar{height:48px;flex:none;display:flex;align-items:center;gap:12px;background:var(--bar);border-bottom:1px solid var(--nav-border);padding:0 14px}
  .waffle{width:34px;height:34px;border-radius:5px;display:grid;place-items:center;color:var(--muted)}
  .brand{display:flex;align-items:center;gap:9px}
  .brand .flame{width:26px;height:26px;border-radius:6px;overflow:hidden;display:grid;place-items:center}
  .brand .flame svg{width:26px;height:26px}
  .brand b{font-size:15px;font-weight:600}
  .brand .env-badge{font-size:11px;color:var(--muted);background:#f3f2f1;border:1px solid var(--nav-border);border-radius:12px;padding:2px 9px;margin-left:4px}
  .topbar .sp{flex:1}
  .tb-btn{width:34px;height:34px;border-radius:5px;display:grid;place-items:center;color:var(--muted);border:0;background:transparent;cursor:pointer}
  .tb-btn:hover{background:#f0f0f0}
  .tb-user{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#2f5bff,#7b52d6);color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700}
  .body{flex:1;display:flex;min-height:0}
  .rail{width:224px;flex:none;background:var(--rail);border-right:1px solid var(--nav-border);overflow-y:auto;padding:8px 0}
  .nav-group{padding:6px 0}
  .nav-g-h{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);padding:8px 16px 4px}
  .nav-item{width:100%;display:flex;align-items:center;gap:10px;border:0;background:transparent;color:var(--ink);font-size:13px;font-family:inherit;padding:8px 16px;cursor:pointer;text-align:left;border-left:3px solid transparent}
  .nav-item:hover{background:#f0efee}
  .nav-item.active{background:var(--accent-bg);border-left-color:var(--accent);color:var(--accent);font-weight:600}
  .nav-ic{width:18px;height:18px;flex:none;color:var(--muted);display:grid;place-items:center}
  .nav-item.active .nav-ic{color:var(--accent)}
  .nav-ic svg{width:18px;height:18px}
  .content{flex:1;min-width:0;background:var(--content);overflow:hidden}
  iframe#wrframe{width:100%;height:100%;border:0;background:#fff}
  .hint{position:fixed;bottom:12px;right:16px;font-size:11px;color:#fff;background:rgba(30,30,30,.82);padding:6px 11px;border-radius:14px;z-index:20}
  @media (max-width:720px){ .rail{width:60px} .nav-item span:last-child,.nav-g-h{display:none} .nav-item{justify-content:center;padding:10px 0} .brand b,.brand .env-badge{display:none} }`;

const HTML =
`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ember - model-driven app (mockup)</title><style>${CSS}</style></head><body>
<div class="app">
  <div class="topbar">
    <div class="waffle"><svg viewBox="0 0 20 20" width="18" fill="currentColor"><circle cx="4" cy="4" r="1.6"/><circle cx="10" cy="4" r="1.6"/><circle cx="16" cy="4" r="1.6"/><circle cx="4" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="16" cy="10" r="1.6"/><circle cx="4" cy="16" r="1.6"/><circle cx="10" cy="16" r="1.6"/><circle cx="16" cy="16" r="1.6"/></svg></div>
    <div class="brand"><span class="flame">${icon('ember-logo')}</span><b>Ember</b><span class="env-badge">CMA - Production</span></div>
    <div class="sp"></div>
    <button class="tb-btn" title="Settings"><svg viewBox="0 0 20 20" width="17" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="2.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.4 1.4M14 14l1.5 1.5M4.5 15.5l1.4-1.4M14 6l1.5-1.5"/></svg></button>
    <button class="tb-btn" title="Help"><svg viewBox="0 0 20 20" width="17" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="8"/><path d="M8 8a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.6M10 14h.01"/></svg></button>
    <div class="tb-user" title="Greg Thomas">GT</div>
  </div>
  <div class="body"><nav class="rail" id="rail">${navHtml}</nav>
    <div class="content"><iframe id="wrframe" title="Ember web resource"></iframe></div></div>
</div>
<div class="hint">Mockup &mdash; the panel is the live web resource (sample data). Click the left nav.</div>
<script>
  var WR_B64 = "${WR_B64}";
  var WR = new TextDecoder().decode(Uint8Array.from(atob(WR_B64), function(c){ return c.charCodeAt(0); }));
  var frame = document.getElementById('wrframe');
  function load(section){
    var flags = '<scr'+'ipt>window.EMBER_EMBED=true;window.EMBER_DATA=' + JSON.stringify(section) + ';</scr'+'ipt>';
    frame.srcdoc = flags + WR;
  }
  document.getElementById('rail').addEventListener('click', function(e){
    var b = e.target.closest('.nav-item'); if(!b) return;
    var all = document.querySelectorAll('.nav-item');
    for (var i=0;i<all.length;i++) all[i].classList.toggle('active', all[i]===b);
    load(b.getAttribute('data-section'));
  });
  load('dash');
</script></body></html>`;

writeFileSync(outFile, HTML);
console.log('Wrote', outFile, '(' + HTML.length + ' bytes)');
