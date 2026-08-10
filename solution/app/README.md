# Ember model-driven app + site map

The left-nav in the mockup is a **model-driven app site map**. Each item opens
the one Ember web resource at the right section via a `?data=` value — the web
resource reads it on load and routes (see `webresource/bvr_flowreview_app.html`
→ `PAGE_MAP`). This is the "all in the web resource" design: the native site map
drives the whole Ember UI, and the web resource owns every section (dashboard,
the four grids, standards/rules, crawl schedule) plus the drill-downs.

## How the parameter reaches the web resource

A web-resource subarea accepts a query string on the **`/WebResources/…` URL
form** (the `$webresource:` token form does not). So each subarea's URL is:

```
/WebResources/bvr_flowreview_app.html?data=<section>
```

On load the web resource does `new URLSearchParams(location.search).get('data')`,
maps it through `PAGE_MAP`, and calls `switchView(...)`. When it detects it's
embedded (Live), it hides its own in-page tab bar so only the native site map
shows; opened standalone (preview) it keeps the tab bar so you can still browse.

## Build it in the maker portal (the reliable path)

The app is built in the maker portal rather than shipped in the solution zip. A
**modern** model-driven app isn't fully described by the app-module + site-map
XML alone — it also carries an app descriptor/metadata the platform generates —
so a hand-authored app module in `customizations.xml` is rejected on import (a
2026-08 attempt failed at 0% / rolled back). Building it in the designer is ~5
minutes and always works. Once built, an **export** of the solution carries the
app + site map to the next environment cleanly.

1. **Solutions → your Ember solution → New → App → Model-driven app.** Name it
   **Ember**.
2. **Add pages / components:** the **`bvr_flowreview_app`** web resource (and,
   optionally, the eight `bvr_*` tables if you want native grids — not required,
   the web resource reads/writes them through the Web API directly).
3. **Edit the site map.** In the app designer open the site map editor, choose
   **Switch to classic** (or edit the app's site map XML), and reproduce
   [`sitemap.xml`](sitemap.xml): three groups (Review, Unit Testing, Configuration)
   with the eleven subareas, each a **Web Resource** subarea whose **URL** is
   `/WebResources/bvr_flowreview_app.html?data=<section>` per the table below.
4. **Save & Publish.**

| Group | Menu item | `data=` | Web-resource section |
|-------|-----------|---------|----------------------|
| Review | Dashboard | `dash` | Tenant dashboard |
| Review | Flow Inventory | `flowinventory` | `bvr_flowinventory` grid |
| Review | Review Runs | `reviewruns` | `bvr_reviewrun` grid |
| Review | Flow Reviews | `flowreviews` | latest run's `bvr_flowreview` grid |
| Review | Findings | `findings` | latest run's `bvr_reviewfinding` grid |
| Unit Testing | Test Coverage | `testcoverage` | flows by env · last review vs last test pass |
| Unit Testing | Test Cases | `testcases` | `bvr_flowtestcase` grid |
| Unit Testing | Test Runs | `testruns` | `bvr_flowtestrun` grid |
| Configuration | Review Standards | `standards` | `bvr_reviewstandard` grid |
| Configuration | Review Rules | `rules` | active standard + rules editor |
| Configuration | Crawl Schedule | `schedule` | schedule / Review-all-flows summary |

Clicking a flow in any grid opens its **Flow Review** (drill-down inside the web
resource); clicking a run opens that run's Flow Reviews.

## Note on packaging

The app module + site map are **not** hand-authored into the solution zip: a
modern model-driven app carries a platform-generated descriptor that a
hand-written app module in `customizations.xml` doesn't reproduce, so such an
import is rejected (an attempt failed at 0% and rolled back). Build the app in
the maker portal per the steps above — `sitemap.xml` is the exact reference —
then **export** the solution and the app + site map travel with it to the next
environment.
