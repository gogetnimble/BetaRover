# Ember site-map icons

Line SVG icons for the model-driven app's site map — one per menu item, plus two
app marks:

- **`ember-logo.svg`** — the full-colour **app logo** (white flame on the dark-red
  gradient tile). Use this as the model-driven app's **icon** (App designer →
  Properties → Icon → Use web resource).
- **`ember-app.svg`** — a monochrome flame (`currentColor`) for use as a site-map
  *area* icon where a single colour is wanted.

They're single-colour and use `stroke="currentColor"` / `fill="currentColor"`, so
they inherit the menu text colour and adapt to light/dark and selection state in
Unified Interface — no separate dark variants needed.

## Add them to the app

1. **Add each `.svg` as a Web Resource** — type **SVG (Vector format)**, e.g.
   name `bvr_ember-dashboard.svg`, upload the file.
2. In the app's **site map**, open each subarea → **Icon** → **Web resource** →
   pick the matching icon. Set `ember-app.svg` as the app's own icon.
3. **Publish.**

## Icon ↔ menu item ↔ URL

| Icon file | Menu item | Subarea URL |
|-----------|-----------|-------------|
| `ember-dashboard.svg` | Dashboard | `/WebResources/bvr_flowreview_app.html?data=dash` |
| `ember-flowinventory.svg` | Flow Inventory | `/WebResources/bvr_flowreview_app.html?data=flowinventory` |
| `ember-reviewruns.svg` | Review Runs | `/WebResources/bvr_flowreview_app.html?data=reviewruns` |
| `ember-flowreviews.svg` | Flow Reviews | `/WebResources/bvr_flowreview_app.html?data=flowreviews` |
| `ember-findings.svg` | Findings | `/WebResources/bvr_flowreview_app.html?data=findings` |
| `ember-testcoverage.svg` | Test Coverage | `/WebResources/bvr_flowreview_app.html?data=testcoverage` |
| `ember-testcases.svg` | Test Cases | `/WebResources/bvr_flowreview_app.html?data=testcases` |
| `ember-testruns.svg` | Test Runs | `/WebResources/bvr_flowreview_app.html?data=testruns` |
| `ember-standards.svg` | Review Standards | `/WebResources/bvr_flowreview_app.html?data=standards` |
| `ember-rules.svg` | Review Rules | `/WebResources/bvr_flowreview_app.html?data=rules` |
| `ember-schedule.svg` | Crawl Schedule | `/WebResources/bvr_flowreview_app.html?data=schedule` |
| `ember-app.svg` | — (app icon) | — |

`_preview.html` is a local contact sheet of all twelve — open it in a browser to
see them rendered.
