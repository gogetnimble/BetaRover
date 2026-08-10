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

## It ships in the solution zip

The app module (`bvr_ember`) and its site map (`bvr_embersitemap`) are baked into
[`../package/customizations.xml`](../package/customizations.xml) and declared as
root components in [`../package/solution.xml`](../package/solution.xml), so
**importing `Ember_1_0_1_0.zip` creates the app** — no designer clicks. After
import, the app appears under **Apps** in the solution and in the Power Apps app
list as **Ember**; publish and play it.

The app is intentionally **self-contained**: its only declared components are the
site map and the web resource (both in the same zip), so import order doesn't
matter — you can import the zip before or after provisioning the tables. The web
resource talks to the `bvr_*` tables through the Web API directly, so the tables
don't need to be app components for the UI to work. If you later want native
table grids as extra pages, add the tables in the app designer.

## Fallback — build it in the maker portal

If your environment rejects the app-module component on import (app/site-map XML
is the most reference-heavy part of a solution and can't be import-tested here),
the rest of the zip still applies and you can build the app by hand:

1. **Solutions → your Ember solution → New → App → Model-driven app.** Name it
   **Ember**.
2. **Add pages / components:** the **`bvr_flowreview_app`** web resource (and,
   optionally, the eight `bvr_*` tables if you want native grids).
3. **Edit the site map.** In the app designer open the site map editor, choose
   **Switch to classic** (or edit the app's site map XML), and reproduce
   [`sitemap.xml`](sitemap.xml): two groups (Review, Configuration) with the eight
   subareas, each a **Web Resource** subarea whose **URL** is
   `/WebResources/bvr_flowreview_app.html?data=<section>` per the table below.
4. **Save & Publish.**

| Menu item | `data=` | Web-resource section |
|-----------|---------|----------------------|
| Dashboard | `dash` | Tenant dashboard |
| Flow Inventory | `flowinventory` | `bvr_flowinventory` grid |
| Review Runs | `reviewruns` | `bvr_reviewrun` grid |
| Flow Reviews | `flowreviews` | latest run's `bvr_flowreview` grid |
| Findings | `findings` | latest run's `bvr_reviewfinding` grid |
| Review Standards | `standards` | `bvr_reviewstandard` grid |
| Review Rules | `rules` | active standard + rules editor |
| Crawl Schedule | `schedule` | schedule / Review-all-flows summary |

Clicking a flow in any grid opens its **Flow Review** (drill-down inside the web
resource); clicking a run opens that run's Flow Reviews.

## Note on packaging

The app module + site map are hand-authored into the solution zip so a single
import stands up the whole app. Be aware that app/site-map XML is the most
reference-heavy part of a solution and can't be import-tested in this repo's
sandbox — if an environment rejects it, the tables/choices/web resource still
import fine and you fall back to building the app in the maker portal (above),
using `sitemap.xml` as the exact reference. Once built (either way), an
**export** of the solution carries the app + site map to the next environment.
