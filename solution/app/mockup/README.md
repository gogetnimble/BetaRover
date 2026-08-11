# Ember app-shell mockup

A "deployed view" of Ember: the Power Apps model-driven-app chrome (top bar +
left site map with the [icons](../icons)) wrapping the **real** web resource in
an iframe. Because it embeds the actual shipped
[`webresource/bvr_flowreview_app.html`](../../../webresource/bvr_flowreview_app.html)
(base64, decoded at runtime), it never drifts — rebuild and it shows whatever the
web resource currently is. Clicking a left-nav item drives the embedded app via
the `window.EMBER_EMBED` / `window.EMBER_DATA` hooks the web resource honors.

## Build

```bash
node solution/app/mockup/build-mockup.mjs            # → flow-review-mockup.html (git-ignored)
node solution/app/mockup/build-mockup.mjs /tmp/x.html # or a path of your choice
```

Open the output in a browser. The left nav switches sections; the panel is the
live web resource in **Preview** (sample data), so the dashboard, Unit Testing,
the global **Environment** filter, the WhoAmI card and **Run tests** all work.

> The generated HTML (~215 KB, it inlines the whole web resource) is **not**
> committed — it's a build artifact. `screenshots/` holds committed reference
> images.

## Screenshots

Committed under [`screenshots/`](screenshots):

| File | Shows |
|------|-------|
| `ember-dashboard.png` | The app shell + dashboard (both stat rows, trend, site map + icons). |
| `ember-environment-dropdown.png` | The global **Environment** filter open (All / CMA — Dev / Production / UAT). |

Regenerate them (needs Playwright + a Chromium build):

```bash
npm i -D playwright-core
node solution/app/mockup/build-mockup.mjs
CHROMIUM_PATH=/path/to/chromium node solution/app/mockup/screenshot.mjs
```
