# On-Demand Review flow — `BR - Flow Review - On-Demand`

The **on-demand** counterpart to the nightly [Crawl Orchestrator](../crawl-orchestrator/README.md).
It reviews **one flow** when a user clicks **Run review now** in the web resource,
so a developer doesn't have to wait for the nightly crawl to see the effect of a
change.

## How it is triggered

The web resource (`webresource/bvr_flowreview_app.html`) does **not** call the
flow directly. Instead — per the "reuse the same cloud flow" decision — it
**creates a `bvr_reviewrun` row** with:

| Column | Value |
|--------|-------|
| `bvr_triggersource` | `ondemand` |
| `bvr_targetflowid` | the `workflowid` of the flow to review |
| `bvr_status` | `Queued` |
| `bvr_triggeredby` | the current user |
| `bvr_standardid` | the active standard (optional) |

This flow is a **Dataverse "When a row is added"** trigger on `bvr_reviewruns`,
filtered to `bvr_triggersource eq ondemand`. Creating the row is the trigger; the
web resource then polls the run's status and refreshes when it completes.

```
Web resource ── create bvr_reviewrun (ondemand) ──► Dataverse
                                                      │  row-added trigger
                                                      ▼
                                        BR - Flow Review - On-Demand
                                          → review the one target flow
                                          → write Flow Review + Findings
                                          → complete the run
Web resource ◄──────── poll run status, then reload the review
```

## Shared logic with the nightly crawl

The **body** of this flow (load standard + rules → get flow → call engine →
write Flow Review + Findings) is identical to the per-flow loop inside the Crawl
Orchestrator. To avoid maintaining it twice, factor it into a **child flow**:

- **`BR - Flow Review - Review One Flow`** — inputs: `runId`, `workflowid`,
  `ruleset` (or standard id). Does one flow's review and writes the rows.
- **Crawl Orchestrator** calls it once per flow in its `Apply to each`.
- **On-Demand** calls it once for `bvr_targetflowid`.

`steps.json` here shows the inline version for readability; the child-flow split
is the recommended production factoring and is noted inline.

## Error handling

Follows the same **Try / Catch / Finally** pattern the standard mandates:
`Catch` logs via the shared logger child flow and marks the run `Failed`;
`Finally` always completes the run so the web resource's poll never hangs.

## Build order

Build this **after** the Crawl Orchestrator (they share the connections, the
**`bvr_ReviewFlow` Custom API** — see [`../../plugin`](../../plugin) — and,
ideally, the child flow). See [`docs/deployment.md`](../../docs/deployment.md)
step 6.
