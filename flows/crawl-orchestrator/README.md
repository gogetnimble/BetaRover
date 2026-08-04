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
2. **Create Review Run** (`br_reviewrun`) with `br_status = Running`,
   `br_startedon = utcNow()`.
3. **Load active standard + rules**
   - `List rows` on `br_reviewstandard`, `$filter=br_isactive eq true`, `$top=1`.
   - `List rows` on `br_reviewrule`, `$filter=_br_standardid_value eq <id> and br_enabled eq true`.
   - Compose these into a `ruleset` object matching the engine's `Ruleset` shape
     (parse `br_parametersjson` per rule into `parameters`).
4. **Try** (Scope):
   1. **Enumerate flows — Dataverse.** `List rows` on `workflows`:
      - `$filter`: `category eq 5 and statecode eq 1` (cloud flows, activated)
      - `$select`: `workflowid,name,clientdata,modifiedon,statecode`
      - `$top`: a sensible page size (e.g. 5000); page with `@odata.nextLink`.
   2. **Enrich — Management API.** For each flow (or in bulk per environment),
      call the Power Automate Management API to resolve **owner principal type**,
      **environment**, and **state**. Map `creator`/`referencedResources` to
      `ownerType` (`user` | `application` | `team`).
   3. **Upsert Flow Inventory** keyed on `br_flowid` (`workflowid`). Compute
      `br_definitionhash` from `clientdata`; if unchanged since last run, mark
      the flow reviewed-from-cache and skip the engine call.
   4. **Apply to each flow:**
      - Call the **ReviewFlow** connector action with
        `{ displayName, clientData, inventory, ruleset, ai: true|false }`.
      - Create a **Flow Review** (`br_flowreview`) from `score`.
      - Create a **Review Finding** (`br_reviewfinding`) per item in `findings`.
5. **Catch** (Scope, run after Try = `Failed, TimedOut, Skipped`):
   - Call the logger child flow with `Level=Error`, `Source=@variables('LogSource')`,
     `EventDetail=@{string(result('Try'))}`.
   - Set Review Run `br_status = Failed`.
6. **Finally** (Scope, run after Catch = `Succeeded, Failed, TimedOut, Skipped`):
   - Update Review Run: `br_completedon`, `br_flowsscanned`, `br_findingscount`,
     `br_averagescore`, and `br_status = Completed` (if not already Failed).

## Building the `ruleset` for the connector

Each `br_reviewrule` row becomes a rule object; parse the JSON parameters:

```
{
  "standardCode": <standard.br_code>,
  "standardName": <standard.br_name>,
  "version":      <standard.br_version>,
  "standardText": <standard.br_standardtext>,
  "rules": [
    {
      "code": <rule.br_code>, "name": <rule.br_name>, "category": <rule.br_category>,
      "evaluator": <rule.br_evaluator>, "severity": <rule.br_severity>,
      "enabled": <rule.br_enabled>, "weight": <rule.br_weight>,
      "parameters": @{json(rule.br_parametersjson)},
      "remediation": <rule.br_remediation>, "description": <rule.br_description>
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
  only via the Management API. Set `br_source` accordingly.
- Keep the engine call inside the `Try` so any engine error is logged and the run
  still finalises in `Finally`.
