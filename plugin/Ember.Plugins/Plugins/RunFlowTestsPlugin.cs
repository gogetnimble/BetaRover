using System;
using Microsoft.Xrm.Sdk;
using BetaRover.Ember.Testing;

namespace BetaRover.Ember.Plugins
{
    /// <summary>
    /// Custom API handler: <c>bvr_RunFlowTests</c>. Mock-executes one flow against a
    /// batch of unit-test cases and returns the per-case results + trace as JSON.
    /// This is the server-side twin of the in-browser <c>EmberRunner</c> (the
    /// <b>Run tests</b> button), so a scheduled flow can run the same suites nightly
    /// and write <c>bvr_testrun</c> rows — no external hosting, no custom connector.
    ///
    /// Request parameters (all String):
    ///   DisplayName  — the flow's display name (workflows.name)
    ///   ClientData   — the flow's clientdata (JSON string, as stored in Dataverse)
    ///   TestCases    — a JSON array of test cases { name, trigger, mocks, variables, asserts }
    /// Response property (String):
    ///   Result       — JSON { passed, total, passedCount, results:[ { caseName, passed, assertions, trace, unmockedExternal } ] }
    /// </summary>
    public class RunFlowTestsPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var tracing = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            try
            {
                string displayName = GetString(context, "DisplayName");
                string clientData = GetString(context, "ClientData");
                string testCasesJson = GetString(context, "TestCases");

                var cases = TestContract.CasesFromJson(testCasesJson);
                var results = Runner.RunSuite(displayName ?? string.Empty, clientData, cases);

                context.OutputParameters["Result"] = TestContract.ResultToJson(results);
            }
            catch (InvalidPluginExecutionException) { throw; }
            catch (Exception ex)
            {
                if (tracing != null) tracing.Trace("Ember RunFlowTests error: {0}", ex.ToString());
                throw new InvalidPluginExecutionException("Ember RunFlowTests failed: " + ex.Message, ex);
            }
        }

        private static string GetString(IPluginExecutionContext ctx, string key)
        {
            object v;
            return ctx.InputParameters.TryGetValue(key, out v) && v != null ? v.ToString() : null;
        }
    }
}
