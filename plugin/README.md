# Ember review engine — Dataverse plug-in (Custom API)

This is the review engine as a **Dataverse plug-in** exposed as a **Custom API**,
so the whole product ships as **one solution** — no Azure Function, no custom
connector, nothing to host per client. The Crawl Orchestrator and On-Demand
Review flows call it through the **built-in Dataverse connector**
("Perform an unbound action").

It's a faithful C# port of the TypeScript engine in [`../engine`](../engine)
(kept as the spec + tests): the flow parser, the seven rule evaluators, the
scorer, and a dependency-free JSON parser (the plug-in sandbox has no Newtonsoft,
so there's nothing to ILMerge — a single signed DLL is all that ships).

```
plugin/Ember.Plugins/
  Json/Json.cs               dependency-free JSON parse + serialize
  Engine/Model.cs            POCOs (ReviewRule, Ruleset, Finding, FlowModel, …)
  Engine/FlowParser.cs       clientdata → FlowModel      (port of flowModel.ts)
  Engine/Evaluators.cs       7 rule evaluators + registry (port of evaluators.ts)
  Engine/Reviewer.cs         review + 0–100 scorer        (port of reviewer.ts)
  Engine/Contract.cs         Custom API JSON ⇄ engine types
  Plugins/ReviewFlowPlugin.cs  the bvr_ReviewFlow Custom API handler
  Ember.Plugins.csproj       net462, strong-named, no runtime deps
```

## 1. Build

Needs the .NET SDK. First create a strong-name key (required to register a
plug-in), then build:

```bash
# one-time: a signing key next to the csproj
sn -k plugin/Ember.Plugins/Ember.Plugins.snk        # or: dotnet tool + `sn`, or VS
dotnet build plugin/Ember.Plugins/Ember.Plugins.csproj -c Release
# → plugin/Ember.Plugins/bin/Release/net462/Ember.Plugins.dll
```

## 2. Register the assembly + Custom API

Use the **Plugin Registration Tool** (`pac tool prt`) or `pac plugin`:

1. **Register the assembly** `Ember.Plugins.dll` (Isolation = **Sandbox**,
   Location = **Database**). Add it to the **Ember** solution.
2. **Create the Custom API** `bvr_ReviewFlow`:
   - **Unique Name** `bvr_ReviewFlow`, **Binding Type** = Global (unbound),
     **Is Function** = No, **Enabled for Workflow** = No, **Allowed Custom
     Processing Step Type** = None.
   - **Plugin Type** = `Ember.Plugins.Plugins.ReviewFlowPlugin`.
   - **Request parameters** (all **String**):

     | Name | Unique name | Optional |
     |------|-------------|----------|
     | DisplayName | `DisplayName` | No |
     | ClientData | `ClientData` | No |
     | Ruleset | `Ruleset` | No |
     | Inventory | `Inventory` | Yes |

   - **Response property** (**String**): `Result`.
3. **Add the Custom API + its parameters** to the **Ember** solution so they
   travel with the import.

> Custom API + parameter + response rows are ordinary solution components, so once
> added they export/import with Ember — that's what keeps this "one solution".

## 3. Call it from a flow

Replace the old custom-connector `ReviewFlow` action with **Dataverse →
Perform an unbound action**:

- **Action Name**: `bvr_ReviewFlow`
- **DisplayName**: `@{item()?['name']}`
- **ClientData**: `@{item()?['clientdata']}`
- **Ruleset**: `@{string(outputs('Compose_Ruleset'))}`
- **Inventory**: `@{string(...)}` — `{ flowId, ownerType, environment, … }`

Read the result back:

```
@{json(body('Perform_an_unbound_action')?['Result'])}
```

…and its `score/score`, `score/passed`, `findings[]`, etc. The two flows'
`steps.json` are already rewired to this shape.

## Request / response contract

**Request** — `Ruleset` (JSON string):

```json
{ "standardCode": "CMA-PA-STD", "standardName": "…", "version": "1.0.0", "standardText": "…",
  "rules": [ { "code": "NAMING_CONVENTION", "name": "…", "category": "Naming",
    "evaluator": "namingConvention", "severity": "error", "enabled": true, "weight": 3,
    "parameters": { "prefix": "CMA", "separator": " - ", "minSegments": 3 },
    "remediation": "…", "description": "…" } ] }
```

**Response** — `Result` (JSON string):

```json
{ "displayName": "…", "flowId": "…",
  "score": { "score": 78, "passed": 4, "failed": 1, "warnings": 2, "notApplicable": 1,
             "bySeverity": { "info": 0, "warning": 2, "error": 1, "critical": 0 } },
  "findings": [ { "ruleCode": "…", "ruleName": "…", "category": "…", "status": "fail",
    "severity": "error", "message": "…", "evidence": "…", "remediation": "…", "aiGenerated": false } ] }
```

## AI pass

The plug-in runs the **deterministic** rules only (evaluator `ai` is skipped). If
you want the holistic AI pass, have the flow call **the client's** Azure OpenAI
over HTTP and append those findings — keeping secrets and outbound calls in the
flow, not the sandboxed plug-in.

## Parity with the TypeScript engine

The C# is a line-faithful port; [`../engine`](../engine) stays the reference with
its vitest suite. When you change a rule, change it in both and keep the fixtures
(`engine/test/fixtures`) as the shared truth. A C# test project mirroring
`engine/test` is the recommended next addition.

## What about server-side unit-test runs?

The in-browser mock runner already runs a flow's unit tests on demand (the
**Run tests** button). A second Custom API `bvr_RunFlowTests` (the same runner
ported to C#) would enable **scheduled** server-side test runs — a clean
follow-up that reuses this project.
