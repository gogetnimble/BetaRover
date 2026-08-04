# Rule catalog

Each rule maps a section of the delivery standard to a deterministic evaluator in
`engine/src/rules/evaluators.ts`. Every value in **Parameters** is configurable
per tenant via the `br_parametersjson` column on the Review Rule row — nothing is
hard-coded. The bundled defaults (which encode the sample CMA standard) live in
`engine/src/defaultRuleset.ts` and are emitted to
`solution/seed/default-ruleset.json`.

| Code | Category | Sev | Checks | Key parameters |
|------|----------|-----|--------|----------------|
| `NAMING_CONVENTION` | Naming | error | Flow name matches `<Prefix><sep><Area><sep><Function>` | `prefix`, `separator`, `minSegments`, or explicit `pattern` |
| `ERROR_HANDLING_SCOPES` | ErrorHandling | error | Top-level `Try`/`Catch`/`Finally` Scopes exist **and** `runAfter` is wired correctly | `tryName`, `catchName`, `finallyName`, `requireFinally`, `catchRunAfterStatuses`, `finallyRunAfterStatuses` |
| `LOGGING_PRESENT` | Logging | warning | A call to the shared logging child flow exists | `loggerNameContains`, `loggerWorkflowIds` |
| `CONFIG_LIST_TOP` | Configuration | warning | Every Dataverse `List rows` action sets a row count (`$top`) | `listOperationIds`, `topParamNames` |
| `APPROVED_EMAIL_SENDER` | Email | error | Outbound email uses an approved sender/connection, not a personal account | `emailOperationIds`, `emailApiIdContains`, `approvedSenders`, `fromParamNames` |
| `RUN_AS_SERVICE_PRINCIPAL` | Security | warning | Flow does not run as a user principal (uses inventory owner type) | *(none — reads inventory)* |
| `NO_HARDCODED_ENV` | Configuration | warning | No hard-coded environment URLs / GUIDs in action parameters | `ignoreHostSubstrings`, `guidCheck` |
| `AI_REVIEW` | General | info | Defers to the Azure OpenAI holistic pass | *(engine option `ai: true`)* |

## How the standard maps to rules

| Standard section | Rule(s) |
|------------------|---------|
| **Naming** (`"CMA - " + Area + " - " + Function`, WatchFox prefix) | `NAMING_CONVENTION` |
| **Security & Configuration** (run as app principal, scoped roles) | `RUN_AS_SERVICE_PRINCIPAL` |
| **Configuration & Constants** (Flow Configuration table, Row Count = 1, no per-env constants) | `CONFIG_LIST_TOP`, `NO_HARDCODED_ENV` |
| **Logging** (durable logs beyond 28 days via logger child flow) | `LOGGING_PRESENT` |
| **Error Handling** (Try/Catch/Finally via Scopes + configure run after) | `ERROR_HANDLING_SCOPES` |
| **Sending Emails** (`appdev-no-reply@cma.ca`, not personal) | `APPROVED_EMAIL_SENDER` |
| *(cross-cutting judgement)* | `AI_REVIEW` |

## Notable evaluator behaviour

- **`ERROR_HANDLING_SCOPES`** is the highest-signal check. It verifies not just
  that the scopes exist but that `Catch` runs after `Try` on
  `[Failed, TimedOut, Skipped]` and `Finally` runs after `Catch` on all four
  outcomes — exactly the "configure run after" wiring the standard mandates.
  Status comparison is case-insensitive and order-independent.

- **`APPROVED_EMAIL_SENDER`** returns a **warning, not a fail**, when an email
  action does not declare a `From` in its definition. That is expected for
  Office 365 `SendEmailV2`, where the sender is the *connection identity* and is
  not visible in `clientdata`. The finding tells the reviewer to verify the
  connection. An explicit personal `From` (e.g. a gmail address) is a hard fail.

- **`CONFIG_LIST_TOP`** and **`APPROVED_EMAIL_SENDER`** return
  `not_applicable` when the flow has no list / no email actions, so they never
  drag down the score for flows they don't apply to.

- **`RUN_AS_SERVICE_PRINCIPAL`** depends on inventory metadata from the crawl
  (owner principal type). Without it, the rule reports `not_applicable`.

## Adding or changing a rule

- **Change behaviour** (thresholds, names, lists): edit the `br_parametersjson`
  on the Review Rule row in Dataverse. No code change, no redeploy.
- **Add a new check type**: add an evaluator to
  `engine/src/rules/evaluators.ts`, register it in `evaluatorRegistry`, add a
  rule to `defaultRuleset.ts`, add a test, run `npm run emit-seed`.
