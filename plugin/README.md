# Ember review engine — Dataverse plug-in (Custom API)

This is the review engine **and** the flow unit-test runner as **Dataverse
plug-ins** exposed as **Custom APIs**, so the whole product ships as **one
solution** — no Azure Function, no custom connector, nothing to host per client.
The Crawl Orchestrator and On-Demand Review flows call `bvr_ReviewFlow`, and the
nightly Scheduled Unit Tests flow calls `bvr_RunFlowTests`, all through the
**built-in Dataverse connector** ("Perform an unbound action").

Both are faithful C# ports of the TypeScript in [`../engine`](../engine) (kept as
the spec + tests): the flow parser, the seven rule evaluators, the scorer, the
mock-execution runner + WDL expression evaluator, and a dependency-free JSON
parser (the plug-in sandbox has no Newtonsoft, so there's nothing to ILMerge — a
single signed DLL is all that ships).

```
plugin/Ember.Plugins/
  Json/Json.cs                 dependency-free JSON parse + serialize
  Engine/Model.cs              POCOs (ReviewRule, Ruleset, Finding, FlowModel, …)
  Engine/FlowParser.cs         clientdata → FlowModel      (port of flowModel.ts)
  Engine/Evaluators.cs         7 rule evaluators + registry (port of evaluators.ts)
  Engine/Reviewer.cs           review + 0–100 scorer        (port of reviewer.ts)
  Engine/Contract.cs           bvr_ReviewFlow JSON ⇄ engine types
  Testing/Expr.cs              WDL expression evaluator     (port of testing/expr.ts)
  Testing/TestModel.cs         POCOs (TestCase, Assertion, TestResult, …)
  Testing/Runner.cs            mock-execution runner        (port of testing/runner.ts)
  Testing/TestContract.cs      bvr_RunFlowTests JSON ⇄ test types
  Plugins/ReviewFlowPlugin.cs  the bvr_ReviewFlow Custom API handler
  Plugins/RunFlowTestsPlugin.cs the bvr_RunFlowTests Custom API handler
  Ember.Plugins.csproj         net462, strong-named, no runtime deps
```

Two plug-in classes, **one assembly** — register the single DLL once, then wire
up both Custom APIs against it.

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
   - **Plugin Type** = `BetaRover.Ember.Plugins.ReviewFlowPlugin`.
   - **Request parameters** (all **String**):

     | Name | Unique name | Optional |
     |------|-------------|----------|
     | DisplayName | `DisplayName` | No |
     | ClientData | `ClientData` | No |
     | Ruleset | `Ruleset` | No |
     | Inventory | `Inventory` | Yes |

   - **Response property** (**String**): `Result`.
3. **Create the second Custom API** `bvr_RunFlowTests` (the server-side unit-test
   runner):
   - **Unique Name** `bvr_RunFlowTests`, **Binding Type** = Global (unbound),
     **Is Function** = No, **Enabled for Workflow** = No, **Allowed Custom
     Processing Step Type** = None.
   - **Plugin Type** = `BetaRover.Ember.Plugins.RunFlowTestsPlugin`.
   - **Request parameters** (all **String**):

     | Name | Unique name | Optional |
     |------|-------------|----------|
     | DisplayName | `DisplayName` | No |
     | ClientData | `ClientData` | No |
     | TestCases | `TestCases` | No |

   - **Response property** (**String**): `Result`.
4. **Add both Custom APIs + their parameters** to the **Ember** solution so they
   travel with the import.

> Custom API + parameter + response rows are ordinary solution components, so once
> added they export/import with Ember — that's what keeps this "one solution".

## 3. Call them from a flow

Both are **Dataverse → Perform an unbound action** calls (no custom connector).

**Review** — `bvr_ReviewFlow` (Crawl Orchestrator + On-Demand):

- **DisplayName**: `@{item()?['name']}`
- **ClientData**: `@{item()?['clientdata']}`
- **Ruleset**: `@{string(outputs('Compose_Ruleset'))}`
- **Inventory**: `@{string(...)}` — `{ flowId, ownerType, environment, … }`
- Read back: `@{json(body('Review_Flow')?['Result'])}` → `score/score`,
  `score/passed`, `findings[]`, …

**Unit tests** — `bvr_RunFlowTests` (Scheduled Unit Tests):

- **DisplayName**: `@{items('Apply_to_each_flow')?['bvr_name']}`
- **ClientData**: `@{body('Get_Flow_Definition')?['clientdata']}`
- **TestCases**: `@{string(body('Select_Cases'))}` — a JSON array of the flow's
  `bvr_flowtestcase.bvr_casejson` cases
- Read back: `@{json(body('Run_Tests')?['Result'])}` → `passed`, `total`,
  `passedCount`, `results[]`

All three flows' `steps.json` are already rewired to these shapes.

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

### `bvr_RunFlowTests`

**Request** — `TestCases` (JSON string, an array of engine `TestCase`s):

```json
[ { "name": "Happy path · row found",
    "trigger": { "outputs": { "body": { "id": 1 } } },
    "mocks": { "Get_a_row": { "status": "Succeeded", "outputs": { "body": { "id": 1 } } } },
    "variables": { "count": 0 },
    "asserts": [ { "type": "noFailures" },
                 { "type": "variableEquals", "name": "count", "equals": 2 },
                 { "type": "branchTaken", "condition": "Check_count", "branch": "yes" },
                 { "type": "ran", "action": "Compose_ok" } ] } ]
```

**Response** — `Result` (JSON string):

```json
{ "passed": true, "total": 3, "passedCount": 2,
  "results": [ { "caseName": "…", "passed": true,
    "assertions": [ { "type": "noFailures", "passed": true, "message": "no actions failed" } ],
    "trace": [ { "name": "Init_count", "type": "InitializeVariable", "status": "Succeeded" } ],
    "unmockedExternal": [ "Send_an_email" ] } ] }
```

Assertion types, mock shape, and expression coverage match the in-browser runner
exactly — see [`../engine/src/testing`](../engine/src/testing).

## AI pass

The plug-in runs the **deterministic** rules only (evaluator `ai` is skipped). If
you want the holistic AI pass, have the flow call **the client's** Azure OpenAI
over HTTP and append those findings — keeping secrets and outbound calls in the
flow, not the sandboxed plug-in.

## Parity with the TypeScript engine

The C# is a line-faithful port; [`../engine`](../engine) stays the reference with
its vitest suite — including [`engine/test/testing`](../engine/test/testing) for
the runner + expression evaluator that `Testing/` ports. When you change a rule
or a runner behaviour, change it in both and keep the fixtures
(`engine/test/fixtures`) and the parity test
([`engine/test/testing/port-parity.test.ts`](../engine/test/testing/port-parity.test.ts))
as the shared truth. A C# test project mirroring `engine/test` is the recommended
next addition.

## Server-side unit-test runs — built

The in-browser mock runner runs a flow's unit tests on demand (the **Run tests**
button); `bvr_RunFlowTests` is the *same* runner ported to C#, so a scheduled
flow runs every flow's suites nightly with no browser and no external hosting.
The **Scheduled Unit Tests** flow
([`../flows/scheduled-tests`](../flows/scheduled-tests/README.md)) drives it and
writes `bvr_flowtestrun` rows + stamps `bvr_lasttestpassedon`, feeding the
dashboard's unit-test health KPIs.
