# Data model

Six Dataverse tables, publisher prefix `bvr_`. The full deployable spec (columns,
types, choices, keys) is in [`../solution/schema/tables.json`](../solution/schema/tables.json);
this page explains the relationships and how a run flows through them.

```
Review Standard ─1──*─ Review Rule           (the criteria you configure)

Review Run ─1──*─ Flow Review ─1──*─ Review Finding
                       │                    │
                       └─*─1─ Flow Inventory └─*─1─ Review Rule
```

## Configuration tables (you edit these)

### Review Standard (`bvr_reviewstandard`)
A named, versioned bundle of rules. `bvr_standardtext` holds the human-readable
standard and is passed to the AI reviewer as context. Mark one `bvr_isactive`.
`bvr_reviewallflows` controls crawl scope: off (default) reviews only activated
flows; on reviews every flow including draft/suspended ones. It is toggled from
the web resource's Standard & Rules tab and read by the Crawl Orchestrator.

### Review Rule (`bvr_reviewrule`)
One configurable criterion. The engine maps `bvr_evaluator` to a deterministic
evaluator (or `ai`). `bvr_parametersjson` is the per-tenant configuration
(prefix, approved senders, scope names, …). `bvr_severity` and `bvr_weight` drive
scoring. Toggle `bvr_enabled` to turn a rule on/off without deleting it.

## Result tables (the crawl writes these)

### Flow Inventory (`bvr_flowinventory`)
One row per discovered flow, keyed on `bvr_flowid` (the `workflowid` GUID).
`bvr_source` records whether it came from Dataverse, the Management API, or both.
`bvr_ownertype` is what `RUN_AS_SERVICE_PRINCIPAL` evaluates.
`bvr_definitionhash` lets a run skip flows whose `clientdata` is unchanged.
`bvr_lastreviewedon` and `bvr_lasttestpassedon` are the two "last validated"
signals shown in Flow Coverage (static review vs. mocked unit tests).

### Flow Test Case / Flow Test Run (`bvr_flowtestcase`, `bvr_flowtestrun`)
The unit-testing tables. A **Flow Test Case** stores an engine `TestCase`
(`bvr_casejson` = trigger + mocked outputs + assertions) against a flow; a **Flow
Test Run** records one mock-execution (status, pass/fail counts, `bvr_resultjson`).
See [`unit-testing.md`](unit-testing.md).

### Review Run (`bvr_reviewrun`)
One crawl execution. Rolls up `bvr_flowsscanned`, `bvr_findingscount`, and
`bvr_averagescore`. `bvr_triggersource` distinguishes the nightly `schedule` run
from an `ondemand` run; on-demand runs also carry `bvr_targetflowid` (the single
`workflowid` to review). Creating an `ondemand` row is what the web resource's
**Run review now** button does — it is the trigger for the On-Demand flow
([`flows/on-demand-review`](../flows/on-demand-review/README.md)).

### Flow Review (`bvr_flowreview`)
The review of one flow within one run. Carries the per-flow `bvr_score` (0–100)
and pass/warn/fail counts. Parent of the findings.

### Review Finding (`bvr_reviewfinding`)
One rule outcome for one flow: `bvr_status` (pass / warning / fail /
not_applicable), `bvr_severity`, `bvr_message`, `bvr_evidence` (the action
path/expression), `bvr_remediation`, and `bvr_aigenerated`.

## Mapping to the engine

The engine's output types map 1:1 onto the result tables:

| Engine type (`engine/src/types.ts`) | Table |
|-------------------------------------|-------|
| `Ruleset` | `bvr_reviewstandard` |
| `ReviewRule` | `bvr_reviewrule` |
| `FlowInventoryMeta` | `bvr_flowinventory` |
| `FlowReviewResult` + `ReviewScore` | `bvr_flowreview` |
| `Finding` | `bvr_reviewfinding` |

So the orchestration flow reads Rule rows into a `Ruleset`, calls the engine, and
writes each `Finding` back as a row — no impedance mismatch.

## Retention

Per the standard's note about pruning logs, add `bvr_reviewrun` (and its cascade)
to your nightly purge after a retention window (e.g. 6 months). Keep the latest
run indefinitely for trend baselines.
