# Data model

Six Dataverse tables, publisher prefix `br_`. The full deployable spec (columns,
types, choices, keys) is in [`../solution/schema/tables.json`](../solution/schema/tables.json);
this page explains the relationships and how a run flows through them.

```
Review Standard ─1──*─ Review Rule           (the criteria you configure)

Review Run ─1──*─ Flow Review ─1──*─ Review Finding
                       │                    │
                       └─*─1─ Flow Inventory └─*─1─ Review Rule
```

## Configuration tables (you edit these)

### Review Standard (`br_reviewstandard`)
A named, versioned bundle of rules. `br_standardtext` holds the human-readable
standard and is passed to the AI reviewer as context. Mark one `br_isactive`.

### Review Rule (`br_reviewrule`)
One configurable criterion. The engine maps `br_evaluator` to a deterministic
evaluator (or `ai`). `br_parametersjson` is the per-tenant configuration
(prefix, approved senders, scope names, …). `br_severity` and `br_weight` drive
scoring. Toggle `br_enabled` to turn a rule on/off without deleting it.

## Result tables (the crawl writes these)

### Flow Inventory (`br_flowinventory`)
One row per discovered flow, keyed on `br_flowid` (the `workflowid` GUID).
`br_source` records whether it came from Dataverse, the Management API, or both.
`br_ownertype` is what `RUN_AS_SERVICE_PRINCIPAL` evaluates.
`br_definitionhash` lets a run skip flows whose `clientdata` is unchanged.

### Review Run (`br_reviewrun`)
One crawl execution. Rolls up `br_flowsscanned`, `br_findingscount`, and
`br_averagescore`. `br_triggersource` distinguishes the nightly `schedule` run
from an `ondemand` run; on-demand runs also carry `br_targetflowid` (the single
`workflowid` to review). Creating an `ondemand` row is what the web resource's
**Run review now** button does — it is the trigger for the On-Demand flow
([`flows/on-demand-review`](../flows/on-demand-review/README.md)).

### Flow Review (`br_flowreview`)
The review of one flow within one run. Carries the per-flow `br_score` (0–100)
and pass/warn/fail counts. Parent of the findings.

### Review Finding (`br_reviewfinding`)
One rule outcome for one flow: `br_status` (pass / warning / fail /
not_applicable), `br_severity`, `br_message`, `br_evidence` (the action
path/expression), `br_remediation`, and `br_aigenerated`.

## Mapping to the engine

The engine's output types map 1:1 onto the result tables:

| Engine type (`engine/src/types.ts`) | Table |
|-------------------------------------|-------|
| `Ruleset` | `br_reviewstandard` |
| `ReviewRule` | `br_reviewrule` |
| `FlowInventoryMeta` | `br_flowinventory` |
| `FlowReviewResult` + `ReviewScore` | `br_flowreview` |
| `Finding` | `br_reviewfinding` |

So the orchestration flow reads Rule rows into a `Ruleset`, calls the engine, and
writes each `Finding` back as a row — no impedance mismatch.

## Retention

Per the standard's note about pruning logs, add `br_reviewrun` (and its cascade)
to your nightly purge after a retention window (e.g. 6 months). Keep the latest
run indefinitely for trend baselines.
