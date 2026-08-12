using System.Collections.Generic;
using System.Linq;
using Ember.Plugins.Json;

namespace Ember.Plugins.Engine
{
    /// <summary>Maps the Custom API's JSON request/response to/from engine types.</summary>
    public static class Contract
    {
        public static Ruleset RulesetFromJson(object raw)
        {
            object root = raw;
            if (root is string s) { try { root = JsonUtil.Parse(s); } catch { root = null; } }
            var obj = JsonUtil.AsObject(root);
            var rs = new Ruleset
            {
                StandardCode = JsonUtil.Str(JsonUtil.Get(obj, "standardCode")),
                StandardName = JsonUtil.Str(JsonUtil.Get(obj, "standardName")),
                Version = JsonUtil.Str(JsonUtil.Get(obj, "version")),
                StandardText = JsonUtil.Str(JsonUtil.Get(obj, "standardText")),
            };
            foreach (var r in JsonUtil.AsArray(JsonUtil.Get(obj, "rules")))
            {
                var ro = JsonUtil.AsObject(r);
                object paramsRaw = JsonUtil.Get(ro, "parameters");
                if (paramsRaw is string ps) { try { paramsRaw = JsonUtil.Parse(ps); } catch { paramsRaw = null; } }
                object weightRaw = JsonUtil.Get(ro, "weight");
                object enabledRaw = JsonUtil.Get(ro, "enabled");
                rs.Rules.Add(new ReviewRule
                {
                    Code = JsonUtil.Str(JsonUtil.Get(ro, "code")),
                    Name = JsonUtil.Str(JsonUtil.Get(ro, "name")),
                    Category = JsonUtil.Str(JsonUtil.Get(ro, "category")),
                    Evaluator = JsonUtil.Str(JsonUtil.Get(ro, "evaluator")),
                    Severity = string.IsNullOrEmpty(JsonUtil.Str(JsonUtil.Get(ro, "severity"))) ? "warning" : JsonUtil.Str(JsonUtil.Get(ro, "severity")),
                    Enabled = !(enabledRaw is bool b) || b,
                    Weight = weightRaw is double d ? (int)d : 1,
                    Parameters = JsonUtil.AsObject(paramsRaw),
                    Remediation = JsonUtil.Str(JsonUtil.Get(ro, "remediation")),
                    Description = JsonUtil.Str(JsonUtil.Get(ro, "description")),
                });
            }
            return rs;
        }

        public static FlowInventoryMeta InventoryFromJson(object raw)
        {
            if (raw == null) return null;
            object root = raw;
            if (root is string s) { try { root = JsonUtil.Parse(s); } catch { root = null; } }
            var o = JsonUtil.AsObject(root);
            if (o.Count == 0) return null;
            return new FlowInventoryMeta
            {
                FlowId = JsonUtil.Str(JsonUtil.Get(o, "flowId")),
                DisplayName = JsonUtil.Str(JsonUtil.Get(o, "displayName")),
                Environment = JsonUtil.Str(JsonUtil.Get(o, "environment")),
                OwnerType = JsonUtil.Str(JsonUtil.Get(o, "ownerType")),
                OwnerName = JsonUtil.Str(JsonUtil.Get(o, "ownerName")),
                State = JsonUtil.Str(JsonUtil.Get(o, "state")),
                Solution = JsonUtil.Str(JsonUtil.Get(o, "solution")),
                Source = JsonUtil.Str(JsonUtil.Get(o, "source")),
            };
        }

        public static string ResultToJson(FlowReviewResult r)
        {
            var findings = r.Findings.Select(f => (object)new Dictionary<string, object>
            {
                { "ruleCode", f.RuleCode }, { "ruleName", f.RuleName }, { "category", f.Category },
                { "status", f.Status }, { "severity", f.Severity }, { "message", f.Message },
                { "evidence", f.Evidence }, { "remediation", f.Remediation }, { "aiGenerated", f.AiGenerated },
            }).ToList();

            var score = new Dictionary<string, object>
            {
                { "score", (double)r.Score.Score }, { "passed", (double)r.Score.Passed },
                { "failed", (double)r.Score.Failed }, { "warnings", (double)r.Score.Warnings },
                { "notApplicable", (double)r.Score.NotApplicable },
                { "bySeverity", new Dictionary<string, object> {
                    { "info", (double)r.Score.BySeverity["info"] }, { "warning", (double)r.Score.BySeverity["warning"] },
                    { "error", (double)r.Score.BySeverity["error"] }, { "critical", (double)r.Score.BySeverity["critical"] } } },
            };

            var outObj = new Dictionary<string, object>
            {
                { "displayName", r.DisplayName }, { "flowId", r.FlowId },
                { "score", score }, { "findings", findings },
            };
            return JsonUtil.Serialize(outObj);
        }
    }
}
