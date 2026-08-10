# Solution package

Everything needed to stand up the **Ember** solution in a
Dataverse environment, in two pieces that reflect what each tool does best:

| Piece | What it delivers | How |
|-------|------------------|-----|
| [`package/`](package) | Publisher, solution container (**Ember**), the **web resource**, and the **model-driven app + site map** | import the `.zip` |
| [`provision/`](provision) | The **10 global choices** + **8 tables** (columns, lookups, alternate key) + optional seed data | run the browser console **or** Node script |
| [`app/`](app) | Reference for the app + site map (now baked into the zip; maker-portal fallback if the app component is rejected on import) | ships in the `.zip` |

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
zip -r -X ../Ember_1_0_1_0.zip . -x '.*'

# 2. Import Ember_1_0_1_0.zip via the maker portal
#    (make.powerapps.com → Solutions → Import solution) or:
#    pac solution import --path ../Ember_1_0_1_0.zip

# 3. Provision the tables (+ seed the default standard/rules).
#    Easiest: open your org (https://yourorg.crm.dynamics.com), F12 → Console,
#    optionally run  window.EMBER_SEED = true;  then paste provision/provision-console.js.
#    Or, from a terminal with a token:
cd ../provision
export DATAVERSE_URL="https://yourorg.crm.dynamics.com"
export DATAVERSE_TOKEN="$(az account get-access-token \
   --resource https://yourorg.crm.dynamics.com --query accessToken -o tsv)"
node provision.mjs --seed
```

See [`provision/README.md`](provision/README.md) for both provisioners. The
model-driven app + site map already came in with the zip — just publish and play
it. Then build the custom connector and the two flows per
[`../docs/deployment.md`](../docs/deployment.md).

## `package/` — the importable solution

Classic unmanaged solution layout, directly importable and also packable with
`pac solution pack`:

```
package/
  solution.xml            # manifest: solution Ember, publisher (bvr), root components
                          #   (web resource type 61, app module type 80, site map type 62)
  customizations.xml      # the web resource + the Ember app module & site map
                          #   (choices + tables are created by the provisioner)
  [Content_Types].xml
  WebResources/
    bvr_flowreview_app.html # the UI (kept in sync with ../../webresource/)
```

The app is self-contained — its only components are the site map and the web
resource, both in this zip — so it imports cleanly whether or not the tables
exist yet. The web resource reaches the `bvr_*` tables through the Web API at
runtime, so they don't need to be app components.

Re-pack after editing the web resource:

```bash
cp ../../webresource/bvr_flowreview_app.html package/WebResources/
cd package && zip -r -X ../Ember_1_0_1_0.zip . -x '.*'
```

Bump `<Version>` in `solution.xml` for each release.

> The XML is authored to the documented solution schema and validated as
> well-formed, but this sandbox has no `pac`/Dataverse to round-trip an import.
> If your environment rejects a single component, import still applies the
> rest; re-import after adjusting. The tables come from the script regardless.

## `provision/` — the tables

Two provisioners, same result — pick whichever fits how you work:

- **`provision-console.js`** — paste into the browser console on your org
  domain; authenticates with your signed-in session, so no install and no token.
- **`provision.mjs`** — Node 18+ (no dependencies), driven from a terminal with
  an access token.

Both create, idempotently:

- the **10 global choices** (option values `100000000…`, matching the web
  resource's `CHOICES` map);
- **8 entities** with their primary column, then every non-lookup column;
- lookups as one-to-many relationships (second pass, once both ends exist);
- the `bvr_flowid` alternate key;
- optional **seed**: the default standard + its 8 rules.

`schema/tables.json` is the source of truth for the table shapes; the Node
script reads it directly and the console script embeds the same spec inline (a
browser tab can't read the repo file). Anything that already exists is detected
and skipped, so both are safe to re-run. See
[`provision/README.md`](provision/README.md) for step-by-step instructions.
