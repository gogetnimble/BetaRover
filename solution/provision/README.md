# Provisioning the Ember tables

The importable solution (`../package/Ember_1_0_0_0.zip`) carries the **publisher**
and the **web resource**. The tables and global choices are created through the
Dataverse Web API instead of being hand-authored into the solution XML — that is
the supported path (it auto-generates default forms/views and assigns choice
values in the publisher's option-value-prefix range), and it avoids the
`0x80048030` import failure that hand-authored entity/optionset XML caused.

Pick whichever provisioner fits how you work. Both create the same thing and are
safe to re-run (existing choices/tables/columns/keys are detected and skipped).

## Order of operations

1. **Import** `../package/Ember_1_0_0_0.zip` (adds the publisher + web resource).
2. **Run a provisioner** (below) to create 10 global choices + 8 tables +
   columns + lookups + alternate key, and optionally seed the default standard +
   rules.
3. **Build the app** in the maker portal (see `../app/README.md`), add the tables
   and the web resource, publish.

## Option A — browser console (no install, no token)

`provision-console.js` runs in a browser tab using your signed-in session, so
there is nothing to install and no access token to fetch.

1. Open your environment on the **org domain** — e.g.
   `https://YOURORG.crm.dynamics.com` (open any model-driven app, or the classic
   `…/main.aspx`). **Not** `make.powerapps.com` — that is a different domain and
   the API call would be cross-origin and blocked.
2. `F12` → **Console**. If the console blocks paste, type `allow pasting` first.
3. To also seed the default ruleset, run this line first:
   ```js
   window.EMBER_SEED = true;
   ```
4. Paste the whole contents of `provision-console.js` and press Enter. Progress
   is logged; re-run any time.

Your signed-in account must be able to customize the environment (System
Customizer / System Administrator).

## Option B — Node script (`provision.mjs`)

Same logic, driven from a terminal with an access token. Node 18+ (global
`fetch`), no npm dependencies.

```bash
export DATAVERSE_URL="https://yourorg.crm.dynamics.com"
export DATAVERSE_TOKEN="$(az account get-access-token \
   --resource https://yourorg.crm.dynamics.com --query accessToken -o tsv)"
node provision.mjs            # global choices + tables + columns + lookups + keys
node provision.mjs --seed     # ...and import the default standard + rules
```

The token must belong to a user who can customize the environment.

## What gets created

- **10 global choices** — `bvr_severity`, `bvr_rulecategory`, `bvr_findingstatus`,
  `bvr_ownertype`, `bvr_flowstate`, `bvr_flowsource`, `bvr_runstatus`,
  `bvr_flowreviewstatus`, `bvr_triggersource`, `bvr_teststatus`. Option values are
  deterministic (`100000000`+) and already match the web resource's `CHOICES`
  map, so there is no per-environment value hunting.
- **8 tables** (from `../schema/tables.json`): `bvr_reviewstandard`,
  `bvr_reviewrule`, `bvr_flowinventory`, `bvr_reviewrun`, `bvr_flowreview`,
  `bvr_reviewfinding`, `bvr_flowtestcase`, `bvr_flowtestrun` — with their columns,
  lookups, and the `bvr_flowid_key` alternate key.
- **Seed (optional)**: the CMA Power Automate Delivery Standard and its 8 rules.

`../schema/tables.json` is the single source of truth for the table shapes; the
console script embeds the same spec inline (a browser tab can't read the repo
file). If you change the schema, update both.
