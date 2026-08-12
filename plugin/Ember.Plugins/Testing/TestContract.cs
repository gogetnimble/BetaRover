using System.Collections.Generic;
using System.Linq;
using BetaRover.Ember.Json;

namespace BetaRover.Ember.Testing
{
    /// <summary>Maps the <c>bvr_RunFlowTests</c> Custom API JSON to/from test types.</summary>
    public static class TestContract
    {
        /// <summary>Parse the <c>TestCases</c> request parameter (a JSON array, or a
        /// JSON string of one) into <see cref="TestCase"/> objects.</summary>
        public static List<TestCase> CasesFromJson(object raw)
        {
            object root = raw;
            if (root is string s) { try { root = JsonUtil.Parse(s); } catch { root = null; } }
            var arr = JsonUtil.AsArray(root);
            return arr.Select(CaseFromObject).ToList();
        }

        private static TestCase CaseFromObject(object raw)
        {
            var o = JsonUtil.AsObject(raw);
            var tc = new TestCase { Name = JsonUtil.Str(JsonUtil.Get(o, "name")) };

            var trigger = JsonUtil.AsObject(JsonUtil.Get(o, "trigger"));
            tc.TriggerOutputs = JsonUtil.Get(trigger, "outputs");
            tc.HasTriggerBody = trigger.ContainsKey("body");
            tc.TriggerBody = JsonUtil.Get(trigger, "body");

            foreach (var kv in JsonUtil.AsObject(JsonUtil.Get(o, "mocks")))
            {
                var mo = JsonUtil.AsObject(kv.Value);
                var mock = new MockAction
                {
                    HasOutputs = mo.ContainsKey("outputs"),
                    Outputs = JsonUtil.Get(mo, "outputs"),
                    Status = mo.ContainsKey("status") ? JsonUtil.Str(JsonUtil.Get(mo, "status")) : null,
                    Error = mo.ContainsKey("error") ? JsonUtil.Str(JsonUtil.Get(mo, "error")) : null,
                };
                tc.Mocks[kv.Key] = mock;
            }

            var vars = JsonUtil.Get(o, "variables");
            if (vars is Dictionary<string, object> vd) tc.Variables = new Dictionary<string, object>(vd);

            foreach (var a in JsonUtil.AsArray(JsonUtil.Get(o, "asserts")))
            {
                var ao = JsonUtil.AsObject(a);
                tc.Asserts.Add(new Assertion
                {
                    Type = JsonUtil.Str(JsonUtil.Get(ao, "type")),
                    Action = JsonUtil.Str(JsonUtil.Get(ao, "action")),
                    Condition = JsonUtil.Str(JsonUtil.Get(ao, "condition")),
                    Branch = JsonUtil.Str(JsonUtil.Get(ao, "branch")),
                    Name = JsonUtil.Str(JsonUtil.Get(ao, "name")),
                    Expression = JsonUtil.Str(JsonUtil.Get(ao, "expression")),
                    Expected = JsonUtil.Get(ao, "equals"),
                    HasExpected = ao.ContainsKey("equals"),
                });
            }
            return tc;
        }

        /// <summary>Serialize the batch result to the <c>Result</c> response string:
        /// <c>{ passed, total, passedCount, results:[...] }</c>.</summary>
        public static string ResultToJson(List<TestResult> results)
        {
            var resultObjs = results.Select(r => (object)new Dictionary<string, object>
            {
                { "caseName", r.CaseName },
                { "passed", r.Passed },
                { "assertions", r.Assertions.Select(x => (object)new Dictionary<string, object>
                    {
                        { "type", x.Assertion.Type },
                        { "passed", x.Passed },
                        { "message", x.Message },
                    }).ToList() },
                { "trace", r.Trace.Select(t => (object)TraceToObject(t)).ToList() },
                { "unmockedExternal", r.UnmockedExternal.Cast<object>().ToList() },
            }).ToList();

            var outObj = new Dictionary<string, object>
            {
                { "passed", results.All(r => r.Passed) },
                { "total", (double)results.Count },
                { "passedCount", (double)results.Count(r => r.Passed) },
                { "results", resultObjs },
            };
            return JsonUtil.Serialize(outObj);
        }

        private static Dictionary<string, object> TraceToObject(ActionTrace t)
        {
            var d = new Dictionary<string, object>
            {
                { "name", t.Name },
                { "type", t.Type },
                { "status", t.Status },
            };
            if (t.HasOutput) d["output"] = t.Output;
            if (t.Branch != null) d["branch"] = t.Branch;
            if (t.Mocked) d["mocked"] = true;
            if (t.Note != null) d["note"] = t.Note;
            return d;
        }
    }
}
