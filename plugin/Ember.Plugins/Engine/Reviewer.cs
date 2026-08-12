using System;
using System.Collections.Generic;
using System.Linq;

namespace BetaRover.Ember.Engine
{
    /// <summary>Port of engine/src/reviewer.ts — deterministic review + scoring.
    /// The AI pass is intentionally omitted here; if wanted, the calling flow makes
    /// the Azure OpenAI HTTP call and appends its findings (keeps the plug-in free
    /// of outbound HTTP and secrets).</summary>
    public static class Reviewer
    {
        private static readonly Dictionary<string, int> SeverityWeight = new Dictionary<string, int>
        {
            { "info", 0 }, { "warning", 1 }, { "error", 3 }, { "critical", 6 }
        };

        private static readonly Dictionary<string, int> StatusOrder = new Dictionary<string, int>
        {
            { "not_applicable", 0 }, { "pass", 1 }, { "warning", 2 }, { "fail", 3 }
        };

        private static string WorstStatus(IEnumerable<Finding> findings)
        {
            string worst = "not_applicable";
            foreach (var f in findings)
                if (StatusOrder[f.Status] > StatusOrder[worst]) worst = f.Status;
            return worst;
        }

        public static ReviewScore ScoreFindings(List<Finding> findings, List<ReviewRule> rules)
        {
            var score = new ReviewScore();
            foreach (var f in findings)
            {
                switch (f.Status)
                {
                    case "pass": score.Passed++; break;
                    case "warning": score.Warnings++; score.BySeverity[f.Severity]++; break;
                    case "fail": score.Failed++; score.BySeverity[f.Severity]++; break;
                    case "not_applicable": score.NotApplicable++; break;
                }
            }

            var ruleByCode = new Dictionary<string, ReviewRule>();
            foreach (var r in rules) ruleByCode[r.Code] = r;

            var grouped = new Dictionary<string, List<Finding>>();
            foreach (var f in findings)
            {
                List<Finding> list;
                if (!grouped.TryGetValue(f.RuleCode, out list)) { list = new List<Finding>(); grouped[f.RuleCode] = list; }
                list.Add(f);
            }

            double penalty = 0, maxPenalty = 0;
            foreach (var kv in grouped)
            {
                string status = WorstStatus(kv.Value);
                if (status == "not_applicable") continue;
                ReviewRule rule; ruleByCode.TryGetValue(kv.Key, out rule);
                int weight = rule != null ? rule.Weight : 1;
                string sev = rule != null ? rule.Severity : "warning";
                double max = weight * SeverityWeight[sev];
                maxPenalty += max;
                if (status == "fail") penalty += max;
                else if (status == "warning") penalty += max / 2.0;
            }

            int computed = maxPenalty == 0 ? 100 : (int)Math.Round((1 - penalty / maxPenalty) * 100);
            score.Score = Math.Max(0, Math.Min(100, computed));
            return score;
        }

        /// <summary>Review one flow against a ruleset (deterministic rules only).</summary>
        public static FlowReviewResult ReviewFlow(string displayName, object clientData, FlowInventoryMeta inventory, Ruleset ruleset)
        {
            var flow = FlowParser.ParseFlow(displayName, clientData);
            var findings = new List<Finding>();

            foreach (var rule in ruleset.Rules)
            {
                if (!rule.Enabled) continue;
                if (rule.Evaluator == "ai") continue; // handled by the flow's AI pass, if any
                Func<EvaluatorContext, List<Finding>> evaluator;
                if (!Evaluators.Registry.TryGetValue(rule.Evaluator, out evaluator))
                {
                    findings.Add(new Finding
                    {
                        RuleCode = rule.Code, RuleName = rule.Name, Category = rule.Category,
                        Status = "not_applicable", Severity = "info",
                        Message = "No evaluator registered for \"" + rule.Evaluator + "\".",
                    });
                    continue;
                }
                findings.AddRange(evaluator(new EvaluatorContext { Flow = flow, Inventory = inventory, Rule = rule }));
            }

            return new FlowReviewResult
            {
                DisplayName = displayName,
                FlowId = inventory != null ? inventory.FlowId : null,
                Findings = findings,
                Score = ScoreFindings(findings, ruleset.Rules),
            };
        }
    }
}
