using System;
using System.Collections.Generic;
using System.Linq;
using BetaRover.Ember.Engine;
using BetaRover.Ember.Json;

namespace BetaRover.Ember.Testing
{
    /// <summary>
    /// Port of engine/src/testing/runner.ts — interprets a flow definition against a
    /// <see cref="TestCase"/> and evaluates its assertions. Connector / child-flow /
    /// HTTP actions are never called; their outputs come from the case's mocks, or
    /// default to an empty successful result (reported in
    /// <see cref="TestResult.UnmockedExternal"/>).
    ///
    /// Supported control flow: runAfter ordering + status gating, Scope, Condition
    /// (If), Foreach, Switch, Terminate, and the variable/Compose actions. Documented
    /// limits: Until runs its body once; parallel branches run in definition order;
    /// expression coverage is the subset in <see cref="Expr"/>.
    /// </summary>
    public static class Runner
    {
        private const string Succeeded = "Succeeded";
        private const string Failed = "Failed";
        private const string Skipped = "Skipped";
        private const string TimedOut = "TimedOut";

        private static readonly HashSet<string> ExternalTypes = new HashSet<string>
        {
            "openapiconnection", "openapiconnectionwebhook", "openapiconnectionnotification",
            "apiconnection", "apiconnectionwebhook", "http", "https", "workflow", "function",
            "sendemail", "sendemailv2", "response",
        };

        private sealed class State
        {
            public EvalContext Ctx;
            public List<ActionTrace> Trace = new List<ActionTrace>();
            public Dictionary<string, string> Statuses = new Dictionary<string, string>();
            public Dictionary<string, string> Branches = new Dictionary<string, string>();
            public Dictionary<string, MockAction> Mocks;
            public HashSet<string> Unmocked = new HashSet<string>();
            public string Terminated; // null, or the terminal status
        }

        private static Dictionary<string, object> AsRecord(object v) => JsonUtil.AsObject(v);
        private static List<object> AsArray(object v)
        {
            if (v is List<object> l) return l;
            if (v == null) return new List<object>();
            return new List<object> { v };
        }
        private static double ToNum(object v) => Expr.ToNum(v);

        /// <summary>Parse a flow's clientdata and run a batch of cases against it.</summary>
        public static List<TestResult> RunSuite(string displayName, object clientData, List<TestCase> cases)
        {
            var model = FlowParser.ParseFlow(displayName, clientData);
            return cases.Select(c => RunTestCase(model, c)).ToList();
        }

        public static TestResult RunTestCase(FlowModel model, TestCase testCase)
        {
            var def = AsRecord(model.Raw);
            var ctx = EvalContext.Empty();
            ctx.TriggerOutputs = testCase.TriggerOutputs;
            ctx.TriggerBody = testCase.HasTriggerBody ? testCase.TriggerBody : JsonUtil.Get(AsRecord(testCase.TriggerOutputs), "body");
            if (testCase.Variables != null) ctx.Variables = new Dictionary<string, object>(testCase.Variables);

            var state = new State { Ctx = ctx, Mocks = testCase.Mocks ?? new Dictionary<string, MockAction>() };
            RunScope(AsRecord(JsonUtil.Get(def, "actions")), state);

            var assertions = testCase.Asserts.Select(a => EvalAssertion(a, state)).ToList();
            return new TestResult
            {
                CaseName = testCase.Name,
                Passed = assertions.All(x => x.Passed),
                Assertions = assertions,
                Trace = state.Trace,
                UnmockedExternal = state.Unmocked.ToList(),
            };
        }

        private sealed class ScopeChild { public string Name; public string Status; public object Outputs; }
        private sealed class ScopeOutcome { public string Status; public List<ScopeChild> Children; }

        private static ScopeOutcome RunScope(Dictionary<string, object> actionsMap, State state)
        {
            var entries = actionsMap.ToList();
            var local = new Dictionary<string, string>();
            var done = new HashSet<string>();
            var children = new List<ScopeChild>();
            bool progress = true;
            while (done.Count < entries.Count && progress)
            {
                progress = false;
                foreach (var entry in entries)
                {
                    string name = entry.Key;
                    if (done.Contains(name)) continue;
                    var action = AsRecord(entry.Value);
                    var runAfter = AsRecord(JsonUtil.Get(action, "runAfter"));
                    var deps = runAfter.Keys.ToList();
                    if (!deps.All(d => done.Contains(d))) continue; // wait for predecessors

                    string status;
                    bool gated = deps.Any(d =>
                    {
                        var allowed = AsArray(JsonUtil.Get(runAfter, d)).Select(Expr.ToStr).ToList();
                        string prior = local.ContainsKey(d) ? local[d] : Skipped;
                        return !allowed.Contains(prior);
                    });
                    if (state.Terminated != null || gated)
                    {
                        status = Skipped;
                        PushTrace(state, new ActionTrace { Name = name, Type = Expr.ToStr(JsonUtil.Get(action, "type") ?? "Unknown"), Status = status });
                        MarkSkipped(action, state); // cascade Skipped into nested actions
                    }
                    else
                    {
                        status = ExecuteAction(name, action, state);
                    }
                    local[name] = status;
                    state.Statuses[name] = status;
                    done.Add(name);
                    object outp; state.Ctx.Outputs.TryGetValue(name, out outp);
                    children.Add(new ScopeChild { Name = name, Status = status, Outputs = outp });
                    progress = true;
                }
            }
            bool anyFailed = entries.Any(e => local.ContainsKey(e.Key) && (local[e.Key] == Failed || local[e.Key] == TimedOut));
            return new ScopeOutcome { Status = anyFailed ? Failed : Succeeded, Children = children };
        }

        private static string ExecuteAction(string name, Dictionary<string, object> action, State state)
        {
            string typeRaw = Expr.ToStr(JsonUtil.Get(action, "type") ?? "Unknown");
            string type = typeRaw.ToLowerInvariant();
            MockAction mock;
            if (state.Mocks.TryGetValue(name, out mock) && mock != null)
            {
                string mstatus = mock.Status ?? (mock.Error != null ? Failed : Succeeded);
                SetOutput(name, mock.Outputs, state);
                PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = mstatus, Output = mock.Outputs, HasOutput = true, Mocked = true, Note = mock.Error });
                return mstatus;
            }

            switch (type)
            {
                case "compose":
                {
                    var outp = Expr.ResolveValue(JsonUtil.Get(action, "inputs"), state.Ctx);
                    SetOutput(name, outp, state);
                    PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = Succeeded, Output = outp, HasOutput = true });
                    return Succeeded;
                }
                case "initializevariable":
                {
                    var inputs = AsRecord(JsonUtil.Get(action, "inputs"));
                    foreach (var v in AsArray(JsonUtil.Get(inputs, "variables")))
                    {
                        var vv = AsRecord(v);
                        object val = vv.ContainsKey("value") ? Expr.ResolveValue(vv["value"], state.Ctx) : DefaultForType(JsonUtil.Get(vv, "type"));
                        state.Ctx.Variables[Expr.ToStr(JsonUtil.Get(vv, "name"))] = val;
                    }
                    PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = Succeeded });
                    return Succeeded;
                }
                case "setvariable":
                {
                    var inp = AsRecord(JsonUtil.Get(action, "inputs"));
                    state.Ctx.Variables[Expr.ToStr(JsonUtil.Get(inp, "name"))] = Expr.ResolveValue(JsonUtil.Get(inp, "value"), state.Ctx);
                    PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = Succeeded });
                    return Succeeded;
                }
                case "incrementvariable":
                case "decrementvariable":
                {
                    var inp = AsRecord(JsonUtil.Get(action, "inputs"));
                    string key = Expr.ToStr(JsonUtil.Get(inp, "name"));
                    object curRaw; state.Ctx.Variables.TryGetValue(key, out curRaw);
                    double cur = ToNum(curRaw ?? (double)0);
                    object byRaw = inp.ContainsKey("value") ? inp["value"] : (double)1;
                    double by = ToNum(Expr.ResolveValue(byRaw, state.Ctx));
                    state.Ctx.Variables[key] = type == "incrementvariable" ? cur + by : cur - by;
                    PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = Succeeded });
                    return Succeeded;
                }
                case "appendtoarrayvariable":
                case "appendtostringvariable":
                {
                    var inp = AsRecord(JsonUtil.Get(action, "inputs"));
                    string key = Expr.ToStr(JsonUtil.Get(inp, "name"));
                    object val = Expr.ResolveValue(JsonUtil.Get(inp, "value"), state.Ctx);
                    if (type == "appendtoarrayvariable")
                    {
                        object cur; state.Ctx.Variables.TryGetValue(key, out cur);
                        var arr = cur as List<object> ?? new List<object>();
                        arr.Add(val); state.Ctx.Variables[key] = arr;
                    }
                    else
                    {
                        object cur; state.Ctx.Variables.TryGetValue(key, out cur);
                        state.Ctx.Variables[key] = Expr.ToStr(cur ?? "") + Expr.ToStr(val);
                    }
                    PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = Succeeded });
                    return Succeeded;
                }
                case "scope":
                {
                    var outcome = RunScope(AsRecord(JsonUtil.Get(action, "actions")), state);
                    state.Ctx.Results[name] = outcome.Children
                        .Select(c => (object)new Dictionary<string, object> { { "name", c.Name }, { "status", c.Status }, { "outputs", c.Outputs } })
                        .ToList();
                    PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = outcome.Status });
                    return outcome.Status;
                }
                case "if":
                {
                    bool yes = EvalCondition(JsonUtil.Get(action, "expression"), state.Ctx);
                    string branch = yes ? "yes" : "no";
                    state.Branches[name] = branch;
                    var body = yes ? AsRecord(JsonUtil.Get(action, "actions")) : AsRecord(JsonUtil.Get(AsRecord(JsonUtil.Get(action, "else")), "actions"));
                    PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = Succeeded, Branch = branch });
                    var outcome = RunScope(body, state);
                    state.Statuses[name] = outcome.Status;
                    return outcome.Status;
                }
                case "foreach":
                {
                    var arr = Expr.ResolveValue(JsonUtil.Get(action, "foreach"), state.Ctx);
                    var items = arr as List<object> ?? new List<object>();
                    string status = Succeeded;
                    foreach (var it in items)
                    {
                        state.Ctx.CurrentItem = it; state.Ctx.Items[name] = it;
                        var outcome = RunScope(AsRecord(JsonUtil.Get(action, "actions")), state);
                        if (outcome.Status == Failed) status = Failed;
                    }
                    PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = status });
                    return status;
                }
                case "switch":
                {
                    var val = Expr.ResolveValue(JsonUtil.Get(action, "expression"), state.Ctx);
                    var cases = AsRecord(JsonUtil.Get(action, "cases"));
                    var branch = AsRecord(JsonUtil.Get(AsRecord(JsonUtil.Get(action, "default")), "actions"));
                    foreach (var c in cases.Values)
                    {
                        var cr = AsRecord(c);
                        if (Expr.ToStr(Expr.ResolveValue(JsonUtil.Get(cr, "case"), state.Ctx)) == Expr.ToStr(val))
                        { branch = AsRecord(JsonUtil.Get(cr, "actions")); break; }
                    }
                    PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = Succeeded });
                    return RunScope(branch, state).Status;
                }
                case "terminate":
                {
                    string runStatus = Expr.ToStr(JsonUtil.Get(AsRecord(JsonUtil.Get(action, "inputs")), "runStatus") ?? "Cancelled");
                    string status = runStatus == "Failed" ? Failed : Succeeded;
                    state.Terminated = status;
                    PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = status });
                    return status;
                }
                default:
                {
                    if (ExternalTypes.Contains(type))
                    {
                        state.Unmocked.Add(name);
                        SetOutput(name, new Dictionary<string, object>(), state);
                        PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = Succeeded, Output = new Dictionary<string, object>(), HasOutput = true, Note = "external action assumed Succeeded — provide a mock for real coverage" });
                        return Succeeded;
                    }
                    PushTrace(state, new ActionTrace { Name = name, Type = typeRaw, Status = Succeeded });
                    return Succeeded;
                }
            }
        }

        /* structured OR string condition */
        private static bool EvalCondition(object expr, EvalContext ctx)
        {
            if (expr is string s) return Expr.ToBool(Expr.ResolveValue(s, ctx));
            var obj = AsRecord(expr);
            if (obj.Count == 0) return false;
            var key = obj.Keys.First();
            var raw = obj[key];
            var list = raw is List<object> l ? l : new List<object> { raw };
            switch (key)
            {
                case "and": return list.All(e => EvalCondition(e, ctx));
                case "or": return list.Any(e => EvalCondition(e, ctx));
                case "not": return !EvalCondition(list.Count > 0 ? list[0] : null, ctx);
                default:
                {
                    object a = Expr.ResolveValue(list.Count > 0 ? list[0] : null, ctx);
                    object b = Expr.ResolveValue(list.Count > 1 ? list[1] : null, ctx);
                    return Compare(key, a, b);
                }
            }
        }

        private static bool Compare(string op, object a, object b)
        {
            switch (op)
            {
                case "equals": return JsonUtil.Serialize(a) == JsonUtil.Serialize(b);
                case "notequals": return JsonUtil.Serialize(a) != JsonUtil.Serialize(b);
                case "greater": return ToNum(a) > ToNum(b);
                case "greaterorequals": return ToNum(a) >= ToNum(b);
                case "less": return ToNum(a) < ToNum(b);
                case "lessorequals": return ToNum(a) <= ToNum(b);
                case "contains": return a is List<object> l ? l.Any(x => JsonUtil.Serialize(x) == JsonUtil.Serialize(b)) : Expr.ToStr(a).IndexOf(Expr.ToStr(b), StringComparison.Ordinal) >= 0;
                case "startswith": return Expr.ToStr(a).StartsWith(Expr.ToStr(b), StringComparison.Ordinal);
                case "endswith": return Expr.ToStr(a).EndsWith(Expr.ToStr(b), StringComparison.Ordinal);
                default: return false;
            }
        }

        /* mark every nested action of a skipped block as Skipped so assertions see it */
        private static void MarkSkipped(Dictionary<string, object> action, State state)
        {
            var nested = new List<object>
            {
                JsonUtil.Get(action, "actions"),
                JsonUtil.Get(AsRecord(JsonUtil.Get(action, "else")), "actions"),
                JsonUtil.Get(AsRecord(JsonUtil.Get(action, "default")), "actions"),
            };
            foreach (var c in AsRecord(JsonUtil.Get(action, "cases")).Values)
                nested.Add(JsonUtil.Get(AsRecord(c), "actions"));
            foreach (var nAct in nested)
            {
                foreach (var kv in AsRecord(nAct))
                {
                    state.Statuses[kv.Key] = Skipped;
                    PushTrace(state, new ActionTrace { Name = kv.Key, Type = Expr.ToStr(JsonUtil.Get(AsRecord(kv.Value), "type") ?? "Unknown"), Status = Skipped });
                    MarkSkipped(AsRecord(kv.Value), state);
                }
            }
        }

        private static void SetOutput(string name, object outputs, State state)
        {
            state.Ctx.Outputs[name] = outputs;
            if (outputs is Dictionary<string, object> o && o.ContainsKey("body"))
                state.Ctx.Bodies[name] = o["body"];
            else
                state.Ctx.Bodies[name] = outputs;
        }

        private static void PushTrace(State state, ActionTrace t) => state.Trace.Add(t);

        private static object DefaultForType(object t)
        {
            switch (Expr.ToStr(t).ToLowerInvariant())
            {
                case "array": return new List<object>();
                case "object": return new Dictionary<string, object>();
                case "integer":
                case "float": return (double)0;
                case "boolean": return false;
                default: return "";
            }
        }

        /* ------------------------------ assertions ------------------------------ */
        private static AssertionResult EvalAssertion(Assertion a, State state)
        {
            Func<string, bool> ran = n => { string s; return state.Statuses.TryGetValue(n, out s) && s != Skipped; };
            Func<bool, string, AssertionResult> ok = (passed, message) => new AssertionResult { Assertion = a, Passed = passed, Message = message };
            string s0;
            switch (a.Type)
            {
                case "ran":
                    return ok(ran(a.Action), ran(a.Action) ? a.Action + " ran" : a.Action + " did not run (status " + (state.Statuses.TryGetValue(a.Action, out s0) ? s0 : "absent") + ")");
                case "skipped":
                {
                    string s = state.Statuses.TryGetValue(a.Action, out s0) ? s0 : Skipped;
                    bool sk = s == Skipped;
                    return ok(sk, sk ? a.Action + " was skipped" : a.Action + " ran (status " + s + ")");
                }
                case "status":
                {
                    string s = state.Statuses.TryGetValue(a.Action, out s0) ? s0 : null;
                    return ok(s == Expr.ToStr(a.Expected), a.Action + " status = " + (s ?? "absent") + " (expected " + Expr.ToStr(a.Expected) + ")");
                }
                case "branchTaken":
                {
                    string b = state.Branches.TryGetValue(a.Condition, out s0) ? s0 : null;
                    return ok(b == a.Branch, a.Condition + " took '" + (b ?? "none") + "' (expected '" + a.Branch + "')");
                }
                case "variableEquals":
                {
                    object v; state.Ctx.Variables.TryGetValue(a.Name, out v);
                    bool p = JsonUtil.Serialize(v) == JsonUtil.Serialize(a.Expected);
                    return ok(p, "variables('" + a.Name + "') = " + JsonUtil.Serialize(v) + " (expected " + JsonUtil.Serialize(a.Expected) + ")");
                }
                case "outputEquals":
                case "expression":
                {
                    object val = null; string err = null;
                    try { string e = a.Expression.StartsWith("@") ? a.Expression.Substring(1) : a.Expression; val = Expr.EvaluateExpression(e, state.Ctx); }
                    catch (Exception x) { err = x.Message; }
                    if (err != null) return ok(false, "expression '" + a.Expression + "' failed: " + err);
                    bool p = JsonUtil.Serialize(val) == JsonUtil.Serialize(a.Expected);
                    return ok(p, a.Expression + " = " + JsonUtil.Serialize(val) + " (expected " + JsonUtil.Serialize(a.Expected) + ")");
                }
                case "noFailures":
                {
                    var failed = state.Statuses.Where(kv => kv.Value == Failed || kv.Value == TimedOut).Select(kv => kv.Key).ToList();
                    return ok(failed.Count == 0, failed.Count > 0 ? "actions failed: " + string.Join(", ", failed) : "no actions failed");
                }
                default:
                    return ok(false, "unknown assertion type '" + a.Type + "'");
            }
        }
    }
}
