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

## Build it (maker portal)

1. **Solutions → your Ember solution → New → App → Model-driven app.** Name it
   **Ember**.
2. **Add pages / components:**
   - the **`bvr_flowreview_app`** web resource, and
   - the six tables (`bvr_flowinventory`, `bvr_reviewrun`, `bvr_flowreview`,
     `bvr_reviewfinding`, `bvr_reviewstandard`, `bvr_reviewrule`) — needed so the
     web resource's Web API reads/writes are in the app's scope.
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

The app module + site map are built in the maker portal rather than hand-authored
into the solution zip on purpose: app/site-map XML is as import-fragile as the
option-set XML that failed an earlier build (`0x80048030`). Once you've built the
app, **export the solution** and the app + site map travel with it for the next
environment. `sitemap.xml` here is the exact reference to reproduce.
