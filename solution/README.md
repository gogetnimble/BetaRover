# Solution package

Everything needed to stand up the **Ember** solution in a
Dataverse environment, in two pieces that reflect what each tool does best:

| Piece | What it delivers | How |
|-------|------------------|-----|
| [`package/`](package) | Publisher, solution container (**Ember**), and the **web resource** | import the `.zip` |
| [`provision/`](provision) | The **9 global choices** + **6 tables** (columns, lookups, alternate key) + optional seed data | run the Node script |
| [`app/`](app) | The **model-driven app site map** — every menu item opens the web resource at a `?data=` section | build in the maker portal |

Choices and tables are provisioned by script rather than baked into the solution
XML on purpose: creating them through the Dataverse Web API auto-generates the
default forms/views and assigns choice option values in the publisher's
option-value-prefix range — whereas hand-authored option-set XML with low values
makes the importer throw `0x80048030` (an early build hit exactly that). The
script reads straight from [`schema/tables.json`](schema/tables.json) so the spec
stays the one source of truth, and the choice values it assigns (`100000000…`)
match the web resource's `CHOICES` map out of the box.

## Order of operations

```bash
# 1. Pack the importable zip (or use the one in package/, if committed)
cd solution/package
zip -r -X ../Ember_1_0_0_0.zip . -x '.*'

# 2. Import Ember_1_0_0_0.zip via the maker portal
#    (make.powerapps.com → Solutions → Import solution) or:
#    pac solution import --path ../Ember_1_0_0_0.zip

# 3. Provision the six tables (+ seed the default standard/rules)
cd ../provision
export DATAVERSE_URL="https://yourorg.crm.dynamics.com"
export DATAVERSE_TOKEN="$(az account get-access-token \
   --resource https://yourorg.crm.dynamics.com --query accessToken -o tsv)"
node provision.mjs --seed
```

Then build the model-driven app, the custom connector, and the two flows per
[`../docs/deployment.md`](../docs/deployment.md).

## `package/` — the importable solution

Classic unmanaged solution layout, directly importable and also packable with
`pac solution pack`:

```
package/
  solution.xml            # manifest: solution Ember, publisher (br), root components
  customizations.xml      # the web resource (choices are created by the script)
  [Content_Types].xml
  WebResources/
    bvr_flowreview_app.html # the UI (kept in sync with ../../webresource/)
```

Re-pack after editing the web resource:

```bash
cp ../../webresource/bvr_flowreview_app.html package/WebResources/
cd package && zip -r -X ../Ember_1_0_0_0.zip . -x '.*'
```

Bump `<Version>` in `solution.xml` for each release.

> The XML is authored to the documented solution schema and validated as
> well-formed, but this sandbox has no `pac`/Dataverse to round-trip an import.
> If your environment rejects a single component, import still applies the
> rest; re-import after adjusting. The tables come from the script regardless.

## `provision/` — the tables

`provision.mjs` (Node 18+, no dependencies) creates each table from
`schema/tables.json`, idempotently:

- entities with their primary column, then every non-lookup column;
- lookups as one-to-many relationships (second pass, once both ends exist);
- the `bvr_flowid` alternate key;
- choice columns bound to the global option sets from the imported solution;
- `--seed` also imports the default standard + its rules from
  [`seed/default-ruleset.json`](seed/default-ruleset.json).

Re-runnable: anything that already exists is detected and skipped. Requires a
bearer token for a user who can customise the environment (see the script
header for the `az` one-liner).
