# Solution package

Everything needed to stand up the **Flare** solution in a
Dataverse environment, in two pieces that reflect what each tool does best:

| Piece | What it delivers | How |
|-------|------------------|-----|
| [`package/`](package) | Publisher, solution container, the **9 global choices**, and the **web resource** | import the `.zip` |
| [`provision/`](provision) | The **6 tables** (columns, lookups, alternate key) + optional seed data | run the Node script |

Tables are provisioned by script rather than baked into the solution XML on
purpose: creating them through the Dataverse Web API auto-generates the default
forms and views (which hand-authored solution XML would have to carry and get
exactly right), and it reads straight from
[`schema/tables.json`](schema/tables.json) so the spec stays the one source of
truth. The choices ship in the solution so their **option values are
deterministic** (Info=1, Warning=2, … — matching the web resource's `CHOICES`
map out of the box) instead of environment-assigned.

## Order of operations

```bash
# 1. Pack the importable zip (or use the one in package/, if committed)
cd solution/package
zip -r -X ../BetaRoverFlowReview_1_0_0_0.zip . -x '.*'

# 2. Import BetaRoverFlowReview_1_0_0_0.zip via the maker portal
#    (make.powerapps.com → Solutions → Import solution) or:
#    pac solution import --path ../BetaRoverFlowReview_1_0_0_0.zip

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
  solution.xml            # manifest: publisher (br), version, root components
  customizations.xml      # 9 global choices + the web resource
  [Content_Types].xml
  WebResources/
    br_flowreview_app.html # the UI (kept in sync with ../../webresource/)
```

Re-pack after editing the web resource:

```bash
cp ../../webresource/br_flowreview_app.html package/WebResources/
cd package && zip -r -X ../BetaRoverFlowReview_1_0_0_0.zip . -x '.*'
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
- the `br_flowid` alternate key;
- choice columns bound to the global option sets from the imported solution;
- `--seed` also imports the default standard + its rules from
  [`seed/default-ruleset.json`](seed/default-ruleset.json).

Re-runnable: anything that already exists is detected and skipped. Requires a
bearer token for a user who can customise the environment (see the script
header for the `az` one-liner).
