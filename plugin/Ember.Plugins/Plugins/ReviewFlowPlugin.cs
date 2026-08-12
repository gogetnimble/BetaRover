using System;
using Microsoft.Xrm.Sdk;
using Ember.Plugins.Engine;

namespace Ember.Plugins.Plugins
{
    /// <summary>
    /// Custom API handler: <c>bvr_ReviewFlow</c>. Reviews one flow against a ruleset
    /// and returns the score + findings as JSON. Registered as an unbound Custom API
    /// so the Crawl Orchestrator / On-Demand flows call it via the Dataverse
    /// connector's "Perform an unbound action" — no custom connector, no Azure.
    ///
    /// Request parameters (all String):
    ///   DisplayName  — the flow's display name (workflows.name)
    ///   ClientData   — the flow's clientdata (JSON string, as stored in Dataverse)
    ///   Ruleset      — the ruleset as JSON { standardCode, ..., rules:[...] }
    ///   Inventory    — optional inventory meta JSON { flowId, ownerType, environment, ... }
    /// Response property (String):
    ///   Result       — JSON { displayName, flowId, score:{...}, findings:[...] }
    /// </summary>
    public class ReviewFlowPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var tracing = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            try
            {
                string displayName = GetString(context, "DisplayName");
                string clientData = GetString(context, "ClientData");
                string rulesetJson = GetString(context, "Ruleset");
                string inventoryJson = GetString(context, "Inventory");

                var ruleset = Contract.RulesetFromJson(rulesetJson);
                var inventory = Contract.InventoryFromJson(inventoryJson);
                var result = Reviewer.ReviewFlow(displayName ?? string.Empty, clientData, inventory, ruleset);

                context.OutputParameters["Result"] = Contract.ResultToJson(result);
            }
            catch (InvalidPluginExecutionException) { throw; }
            catch (Exception ex)
            {
                if (tracing != null) tracing.Trace("Ember ReviewFlow error: {0}", ex.ToString());
                throw new InvalidPluginExecutionException("Ember ReviewFlow failed: " + ex.Message, ex);
            }
        }

        private static string GetString(IPluginExecutionContext ctx, string key)
        {
            object v;
            return ctx.InputParameters.TryGetValue(key, out v) && v != null ? v.ToString() : null;
        }
    }
}
