# Delivery standard (baseline)

This is the formalised source standard the default ruleset encodes. It is a
**baseline** — the engine reads the criteria from Dataverse, so any organisation
can adjust the parameters or add rules without touching code. Sample text below
uses the CMA conventions supplied with the brief.

## Purpose

A delivery standard for configuration and code changes across Dynamics 365,
Power Apps and Power Automate, including the creation and development of Power
Automate **cloud flows**. It applies to future development from the date of
acceptance, to ensure consistency, and is the standard against which code
reviews are completed.

## Sections

### Naming
Cloud flows are named:

```
<Prefix> - <Area> - <Function>
```

e.g. `CMA - Membership - Add new Roles on Contact Creation`. Use `System` as the
area for system/child flows (data pruning, shared child flows, …).
→ enforced by **`NAMING_CONVENTION`**.

**Monitoring:** flows prefixed `CMA - ` are picked up by the *WatchFox* flow
(every 4 hours), which re-enables any that were turned off. To develop without
WatchFox interference, temporarily change the prefix.

### Security & configuration
- Flows run as **application / service principal** users, never named user
  principals. → **`RUN_AS_SERVICE_PRINCIPAL`**.
- Access is governed by a **scoped application security role** (e.g.
  `App-RealTime-Marketing`, `App-Membership`). Specifically: **never** System
  Admin; **read-only** on the Flow Configuration table; **no** access to the
  Flow Logs table.

### Configuration & constants
Per-environment configuration is **not** hard-coded. It is loaded from the **Flow
Configuration** table (one record per environment, found via the `Environment` /
`EnvironmentUrl` constants). Load only the fields you need, and set **Row
Count = 1** to avoid open-ended query warnings.
→ **`CONFIG_LIST_TOP`** (bounded queries) and **`NO_HARDCODED_ENV`**
(no per-env literals).

### Logging
Power Automate keeps run history for only **28 days**. Durable logs are written
to the **Flow Logs** table via the shared logger child flow (e.g.
`CMA - System - Validate Logger`), with `Level`, `Source` and `Event Details`.
→ **`LOGGING_PRESENT`**.

### Error handling
Power Automate has no native error handling; implement **Try / Catch / Finally**
using **Scopes** and *configure run after*:

- **Catch** runs after **Try** on `Failed`, `TimedOut`, `Skipped`.
- **Finally** runs after **Catch** on `Succeeded`, `Failed`, `TimedOut`,
  `Skipped`.

The `Catch` scope logs the error with a generic expression
`string(result('Try'))` and a `LogSource` variable naming the flow.
→ **`ERROR_HANDLING_SCOPES`**.

### Sending emails
Send via the licensed connection **`appdev-no-reply@cma.ca`** (present in all
environments). Never send from a personal account.
→ **`APPROVED_EMAIL_SENDER`**.

## FAQ (from the source standard)

**How does this apply to previous code?** When updating a cloud flow that doesn't
follow the pattern, bring it into line so everything follows one standard.

**How do I use this guide?** It captures the good practices we want in the Power
Automate environment; the most value comes from everyone helping each other
follow the standards.
