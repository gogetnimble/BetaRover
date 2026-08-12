# Custom connector — superseded

`flow-review-connector.swagger.json` describes a custom connector that fronted an
**externally hosted** review engine (e.g. an Azure Function). That approach needed
infrastructure stood up per client.

**This is no longer the recommended path.** The review engine now runs **in
Dataverse** as a plug-in exposed as the **`bvr_ReviewFlow` Custom API**, so the
whole product ships as **one solution** with nothing external to host. The flows
call it via the built-in Dataverse connector ("Perform an unbound action").

See [`../plugin`](../plugin) for the plug-in, build/register steps, and the
request/response contract. The swagger is kept for reference only — use the
Custom API instead unless you specifically want to host the engine outside
Dataverse.
