# Scheduled Unit Tests flow — `BR - Flow Review - Scheduled Unit Tests`

The **server-side** twin of the web resource's **Run tests** button. The button
mock-executes a flow's unit tests in the browser on demand; this flow does the
same for **every** flow that has enabled test cases, **on a nightly schedule**,
so the dashboard's unit-test health is fresh each morning without anyone
clicking anything.

Both run the *exact same* engine: the in-browser `EmberRunner` and this flow's
`bvr_RunFlowTests` Custom API are two ports of
[`engine/src/testing`](../../engine/src/testing) (TypeScript stays the spec +
vitest suite). Same flow definition + same cases ⇒ same pass/fail.

## How it works

```
Recurrence (nightly 02:00)
   └─ for each bvr_flowinventory with test cases (bvr_testcasecount > 0)
        ├─ Get the flow's live clientdata (workflows table)
        ├─ List the flow's enabled bvr_flowtestcase rows
        ├─ Select → array of the parsed bvr_casejson cases
        ├─ bvr_RunFlowTests(DisplayName, ClientData, TestCases)   ← Dataverse plug-in
        ├─ Create a bvr_flowtestrun row (passed / failed, counts, result JSON)
        └─ if all passed → stamp bvr_lasttestpassedon on the flow
```

`bvr_RunFlowTests` is the mock runner as a **Dataverse plug-in / Custom API** —
it ships in the one Ember solution, runs in the sandbox, and needs no Azure and
no custom connector. See [`../../plugin/README.md`](../../plugin/README.md).

## The Custom API call

**Dataverse → Perform an unbound action**, action `bvr_RunFlowTests`:

| Parameter | Value |
|-----------|-------|
| `DisplayName` | `@{items('Apply_to_each_flow')?['bvr_name']}` |
| `ClientData` | `@{body('Get_Flow_Definition')?['clientdata']}` |
| `TestCases` | `@{string(body('Select_Cases'))}` — a JSON array of the flow's cases |

Read the result back:

```
@{json(body('Run_Tests')?['Result'])}
```

with `passed` (bool), `total`, `passedCount`, and `results[]` (one
`{ caseName, passed, assertions, trace, unmockedExternal }` per case — the same
`TestResult` shape the browser shows).

## Building the `TestCases` array

Each `bvr_flowtestcase.bvr_casejson` is one case. A **Select** action turns the
list of rows into the array the API wants:

- **From**: `@outputs('Get_Test_Cases_For_Flow')?['body/value']`
- **Map** (switch to text/expression mode): `@json(item()?['bvr_casejson'])`

then pass `@string(body('Select_Cases'))` as `TestCases`.

## What it writes

- One **`bvr_flowtestrun`** per flow per night: `bvr_status` (passed/failed),
  `bvr_passed`, `bvr_failed`, `bvr_ranon`, and `bvr_resultjson` (the per-case
  results + traces, for drill-down in the app's **Test Runs** grid).
- **`bvr_lasttestpassedon`** on the flow inventory when every case passed —
  the same stamp the browser runner sets, feeding the dashboard's **Last test
  pass** / **Unit-test pass rate** KPIs.

## Error handling

Follows the standard's **Try / Catch / Finally**. A single flow's *test
failure* is a normal result (a `failed` test-run row), **not** a run failure —
only an unexpected error (unparseable clientdata, throttling) lands in `Catch`,
which logs via the shared logger child flow. One bad flow never stops the rest
of the nightly sweep.

## Build order

Build this **after** the `bvr_RunFlowTests` Custom API is registered
([`../../plugin/README.md`](../../plugin/README.md) §2) and shares the
Dataverse connection with the two review flows. See
[`../../docs/deployment.md`](../../docs/deployment.md) step 6.
