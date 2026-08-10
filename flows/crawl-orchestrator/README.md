# Crawl Orchestrator flow

**`BR - Flow Review - Crawl Orchestrator`** — the scheduled cloud flow that
crawls the tenant and drives the review. It is itself written to comply with the
standard it enforces (Try/Catch/Finally, logging, bounded queries, service
principal) as a worked reference.

Because a full exported flow definition is environment-specific (connection
references, environment IDs), this folder documents the flow as **steps + the key
action inputs** rather than a `definition.json` that would only import into one
tenant. `steps.json` is a readable action-by-action contract.

## Trigger

**Recurrence** — daily (e.g. 06:00). Runs unattended as the application user.

## Steps

1. **Initialize `LogSource`** = `"BR - Flow Review - Crawl Orchestrator"`.
2. **Create Review Run** (`bvr_reviewrun`) with `bvr_status = Running`,
   `bvr_startedon = utcNow()`.
3. **Load active standard + rules**
   - `List rows` on `bvr_reviewstandard`, `$filter=bvr_isactive eq true`, `$top=1`.
   - `List rows` on `bvr_reviewrule`, `$filter=_bvr_standardid_value eq <id> and bvr_enabled eq true`.
   - Compose these into a `ruleset` object matching the engine's `Ruleset` shape
     (parse `bvr_parametersjson` per rule into `parameters`).
4. **Try** (Scope):
   1. **Enumerate flows — Dataverse.** `List rows` on `workflows`:
      - `$filter`: `category eq 5` (cloud flows), **plus** `and statecode eq 1`
        (activated only) unless the active standard's **`bvr_reviewallflows`** is
        on — when on, the `statecode` clause is dropped so draft/suspended flows
        are reviewed too. See `steps.json` for the exact expression.
      - `$select`: `workflowid,name,clientdata,modifiedon,statecode`
      - `$top`: a sensible page size (e.g. 5000); page with `@odata.nextLink`.
   2. **Enrich — Management API.** For each flow (or in bulk per environment),
      call the Power Automate Management API to resolve **owner principal type**,
      **environment**, and **state**. Map `creator`/`referencedResources` to
      `ownerType` (`user` | `application` | `team`).
   3. **Upsert Flow Inventory** keyed on `bvr_flowid` (`workflowid`). Compute
      `bvr_definitionhash` from `clientdata`; if unchanged since last run, mark
      the flow reviewed-from-cache and skip the engine call.
   4. **Apply to each flow:**
      - Call the **ReviewFlow** connector action with
        `{ displayName, clientData, inventory, ruleset, ai: true|false }`.
      - Create a **Flow Review** (`bvr_flowreview`) from `score`.
      - Create a **Review Finding** (`bvr_reviewfinding`) per item in `findings`.
5. **Catch** (Scope, run after Try = `Failed, TimedOut, Skipped`):
   - Call the logger child flow with `Level=Error`, `Source=@variables('LogSource')`,
     `EventDetail=@{string(result('Try'))}`.
   - Set Review Run `bvr_status = Failed`.
6. **Finally** (Scope, run after Catch = `Succeeded, Failed, TimedOut, Skipped`):
   - Update Review Run: `bvr_completedon`, `bvr_flowsscanned`, `bvr_findingscount`,
     `bvr_averagescore`, and `bvr_status = Completed` (if not already Failed).

## Building the `ruleset` for the connector

Each `bvr_reviewrule` row becomes a rule object; parse the JSON parameters:

```
{
  "standardCode": <standard.bvr_code>,
  "standardName": <standard.bvr_name>,
  "version":      <standard.bvr_version>,
  "standardText": <standard.bvr_standardtext>,
  "rules": [
    {
      "code": <rule.bvr_code>, "name": <rule.bvr_name>, "category": <rule.bvr_category>,
      "evaluator": <rule.bvr_evaluator>, "severity": <rule.bvr_severity>,
      "enabled": <rule.bvr_enabled>, "weight": <rule.bvr_weight>,
      "parameters": @{json(rule.bvr_parametersjson)},
      "remediation": <rule.bvr_remediation>, "description": <rule.bvr_description>
    }
  ]
}
```

Omitting `ruleset` makes the engine fall back to its bundled default (the sample
standard) — useful for a first smoke test before you configure rows.

## Notes

- **Both sources:** Dataverse supplies `clientdata` (the reviewable definition);
  the Management API supplies owner/env/state that the `workflows` table does not.
- **Child (solution) flows** live in `workflows` too; personal flows are reached
  only via the Management API. Set `bvr_source` accordingly.
- Keep the engine call inside the `Try` so any engine error is logged and the run
  still finalises in `Finally`.
