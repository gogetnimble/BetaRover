# Unit testing — mock executions

Power Automate cloud flows have no native way to *run* a flow against mocked
connector responses (Azure Logic Apps Standard does; cloud flows don't expose
it). Ember fills that gap: because it already parses a flow's `clientdata` into an
action graph, it can **simulate** the flow in-process against mocked outputs and
assert on the result — a true unit test with **no live connectors** and no side
effects.

## The runner (`engine/src/testing/`)

```ts
import { runTestSuite } from '@betarover/flow-review-engine';

const { passed, results } = runTestSuite('CMA - Membership - …', clientData, [
  {
    name: 'config lookup fails → Catch runs',
    trigger: { body: { contactid: '1' } },
    mocks: {
      Get_Flow_Configuration: { error: 'Dataverse 500' },  // force a failure
    },
    asserts: [
      { type: 'status',  action: 'Get_Flow_Configuration', equals: 'Failed' },
      { type: 'skipped', action: 'Send_notification' },     // runAfter Succeeded → gated
      { type: 'status',  action: 'Try',   equals: 'Failed' },
      { type: 'ran',     action: 'Catch' },                 // runAfter Failed → runs
      { type: 'ran',     action: 'Log_Error' },
    ],
  },
]);
```

- **`mocks`** — per action name, either `{ outputs }` (success) or `{ error }` /
  `{ status }` (failure). `body('name')` returns `outputs.body` when present.
- **Assertions** — `ran` / `skipped` / `status` (per action), `branchTaken`
  (Condition yes/no), `variableEquals`, `outputEquals` (a WDL expression like
  `outputs('Compose')`), `expression`, and `noFailures`. Each result carries a
  message explaining a failure.
- **`TestResult`** — `passed`, per-assertion results, an action `trace`
  (name/type/status/output/branch), and `unmockedExternal` (connector/child-flow
  actions reached without a mock — surfaced, never silently ignored).

### What it interprets

`runAfter` ordering + status gating (so Try/Catch/Finally works), **Scope**,
**Condition** (string and structured `and`/`or`/`not`/comparison expressions),
**Foreach**, **Switch**, **Terminate**, and the Compose / variable actions. The
WDL expression evaluator (`expr.ts`) covers references (`variables`, `outputs`,
`body`, `triggerBody/Outputs`, `item(s)`, `result`, `parameters`), `?[…]`/`.`
indexing, `@{…}` interpolation, and ~35 common functions. Unknown functions
**throw**, so a test surfaces a gap rather than passing on a wrong value.

### Documented limits (MVP)

- `Until` runs its body once; parallel branches run in a deterministic order.
- `utcNow()`/`guid()` return fixed values so runs are repeatable.
- The function library and locale formatting are a subset — extend
  `FUNCTIONS` in `expr.ts` as needed (add a test alongside).

## Storing tests + results (Dataverse)

| Table | Holds |
|-------|-------|
| `bvr_flowtestcase` | one test case per flow — `bvr_casejson` is the engine `TestCase` (`{ trigger, mocks, variables, asserts }`), linked to `bvr_flowinventory` |
| `bvr_flowtestrun` | one mock-execution — status (`passed`/`failed`/`error`), pass/fail counts, duration, `bvr_resultjson` (the `TestResult[]`) |

A flow (or the engine host) reads the enabled test cases for a flow, calls
`runTestSuite`, writes a `bvr_flowtestrun`, and — when green — stamps
`bvr_lasttestpassedon` on the flow.

## "Last validated" — two independent signals

Per the design decision, the **Flow Coverage** view shows two columns, because
they answer different questions:

- **`bvr_lastreviewedon`** — last **static review** against the standard (naming,
  scopes, bounded queries…). Available today from the review engine.
- **`bvr_lasttestpassedon`** — last time the flow's **mocked unit tests** all
  passed (behavioral). Comes from the mock runner.

A flow can be review-clean but behaviorally untested, or vice-versa; showing both
makes that explicit.

## Status

Built and unit-tested (`engine/test/testing/`). Next steps: promote the Unit
Testing sections (Flow Coverage / Test Cases / Test Runs) into the web resource +
site map, and add an engine host endpoint / cloud flow that runs a flow's cases
and writes the run + last-validated stamp.
