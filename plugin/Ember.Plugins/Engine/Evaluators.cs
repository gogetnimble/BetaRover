using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using BetaRover.Ember.Json;

namespace BetaRover.Ember.Engine
{
    /// <summary>Port of engine/src/rules/helpers.ts + evaluators.ts.</summary>
    public static class Evaluators
    {
        // ---------------- helpers ----------------
        private static Dictionary<string, object> AsRecord(object v) => JsonUtil.AsObject(v);

        private static string StrParam(Dictionary<string, object> p, string key, string fallback)
        {
            object v; return (p.TryGetValue(key, out v) && v is string s) ? s : fallback;
        }

        private static List<string> ArrParam(Dictionary<string, object> p, string key, string[] fallback)
        {
            object v;
            if (p.TryGetValue(key, out v) && v is List<object> arr) return arr.Select(x => JsonUtil.Str(x)).ToList();
            return fallback.ToList();
        }

        private static bool BoolParam(Dictionary<string, object> p, string key, bool fallback)
        {
            object v; return (p.TryGetValue(key, out v) && v is bool b) ? b : fallback;
        }

        private static Dictionary<string, object> ActionHost(FlowAction a) => AsRecord(JsonUtil.Get(AsRecord(a.Inputs), "host"));
        private static Dictionary<string, object> ActionParameters(FlowAction a) => AsRecord(JsonUtil.Get(AsRecord(a.Inputs), "parameters"));
        private static string OperationId(FlowAction a) => JsonUtil.Str(JsonUtil.Get(ActionHost(a), "operationId"));
        private static string ApiId(FlowAction a) => JsonUtil.Str(JsonUtil.Get(ActionHost(a), "apiId"));

        private static bool SameStatusSet(List<string> a, List<string> b)
        {
            var sa = new HashSet<string>(a.Select(s => s.ToLowerInvariant()));
            var sb = new HashSet<string>(b.Select(s => s.ToLowerInvariant()));
            return sa.SetEquals(sb);
        }

        private static string EscapeRegex(string s) => Regex.Replace(s, @"[.*+?^${}()|[\]\\]", "\\$&");

        private static Finding MakeFinding(EvaluatorContext ctx, string status, string message, string evidence = null, string severity = null)
        {
            bool passLike = status == "pass" || status == "not_applicable";
            return new Finding
            {
                RuleCode = ctx.Rule.Code,
                RuleName = ctx.Rule.Name,
                Category = ctx.Rule.Category,
                Status = status,
                Severity = passLike ? "info" : (severity ?? ctx.Rule.Severity),
                Message = message,
                Evidence = evidence,
                Remediation = passLike ? null : ctx.Rule.Remediation,
            };
        }

        private static Dictionary<string, FlowAction> TopLevelScopes(EvaluatorContext ctx)
        {
            var map = new Dictionary<string, FlowAction>();
            foreach (var a in ctx.Flow.TopLevelActions)
                if (a.Type.ToLowerInvariant() == "scope") map[a.Name.ToLowerInvariant()] = a;
            return map;
        }

        // ---------------- evaluators ----------------
        public static List<Finding> NamingConvention(EvaluatorContext ctx)
        {
            var p = ctx.Rule.Parameters;
            string explicitPat = StrParam(p, "pattern", "");
            string prefix = StrParam(p, "prefix", "CMA");
            string separator = StrParam(p, "separator", " - ");
            object ms; int minSegments = (p.TryGetValue("minSegments", out ms) && ms is double d) ? (int)d : 3;

            Regex regex;
            if (!string.IsNullOrEmpty(explicitPat)) regex = new Regex(explicitPat);
            else
            {
                var tail = string.Join(EscapeRegex(separator), Enumerable.Repeat(".+", Math.Max(0, minSegments - 1)));
                regex = new Regex("^" + EscapeRegex(prefix) + EscapeRegex(separator) + tail + "$");
            }

            string name = ctx.Flow.DisplayName ?? "";
            if (regex.IsMatch(name))
                return new List<Finding> { MakeFinding(ctx, "pass", "Name \"" + name + "\" follows the naming convention.") };
            return new List<Finding> { MakeFinding(ctx, "fail",
                "Name \"" + name + "\" does not match the required pattern " + regex.ToString() + ". Expected e.g. \"" + prefix + separator + "<Area>" + separator + "<Function>\".",
                name) };
        }

        public static List<Finding> ErrorHandlingScopes(EvaluatorContext ctx)
        {
            var p = ctx.Rule.Parameters;
            string tryName = StrParam(p, "tryName", "Try");
            string catchName = StrParam(p, "catchName", "Catch");
            string finallyName = StrParam(p, "finallyName", "Finally");
            bool requireFinally = BoolParam(p, "requireFinally", true);
            var catchStatuses = ArrParam(p, "catchRunAfterStatuses", new[] { "Failed", "TimedOut", "Skipped" });
            var finallyStatuses = ArrParam(p, "finallyRunAfterStatuses", new[] { "Succeeded", "Failed", "TimedOut", "Skipped" });

            var scopes = TopLevelScopes(ctx);
            FlowAction tryScope, catchScope, finallyScope;
            scopes.TryGetValue(tryName.ToLowerInvariant(), out tryScope);
            scopes.TryGetValue(catchName.ToLowerInvariant(), out catchScope);
            scopes.TryGetValue(finallyName.ToLowerInvariant(), out finallyScope);

            var problems = new List<string>();
            if (tryScope == null) problems.Add("missing a top-level \"" + tryName + "\" Scope");
            if (catchScope == null) problems.Add("missing a top-level \"" + catchName + "\" Scope");
            else
            {
                List<string> ra;
                if (!catchScope.RunAfter.TryGetValue(tryName, out ra))
                    catchScope.RunAfter.TryGetValue(tryScope != null ? tryScope.Name : tryName, out ra);
                if (ra == null) problems.Add("\"" + catchName + "\" does not run after \"" + tryName + "\"");
                else if (!SameStatusSet(ra, catchStatuses))
                    problems.Add("\"" + catchName + "\" runAfter is [" + string.Join(", ", ra) + "]; expected [" + string.Join(", ", catchStatuses) + "]");
            }
            if (requireFinally)
            {
                if (finallyScope == null) problems.Add("missing a top-level \"" + finallyName + "\" Scope");
                else
                {
                    List<string> ra;
                    finallyScope.RunAfter.TryGetValue(catchName, out ra);
                    if (ra == null) problems.Add("\"" + finallyName + "\" does not run after \"" + catchName + "\"");
                    else if (!SameStatusSet(ra, finallyStatuses))
                        problems.Add("\"" + finallyName + "\" runAfter is [" + string.Join(", ", ra) + "]; expected [" + string.Join(", ", finallyStatuses) + "]");
                }
            }

            if (problems.Count == 0)
                return new List<Finding> { MakeFinding(ctx, "pass", "Try / Catch / Finally scopes are present and correctly wired.") };
            string ev = scopes.Values.Count > 0 ? string.Join(", ", scopes.Values.Select(s => s.Name)) : "(no scopes)";
            return new List<Finding> { MakeFinding(ctx, "fail", "Error-handling pattern is incomplete: " + string.Join("; ", problems) + ".", ev) };
        }

        public static List<Finding> LoggingPresent(EvaluatorContext ctx)
        {
            var p = ctx.Rule.Parameters;
            var names = ArrParam(p, "loggerNameContains", new[] { "Logger", "Log" }).Select(s => s.ToLowerInvariant()).ToList();
            var ids = ArrParam(p, "loggerWorkflowIds", new string[0]).Select(s => s.ToLowerInvariant()).ToList();

            FlowAction match = ctx.Flow.AllActions.FirstOrDefault(a =>
            {
                bool isChildFlow = a.Type.ToLowerInvariant() == "workflow";
                bool nameHit = names.Any(n => a.Name.ToLowerInvariant().Contains(n));
                var host = AsRecord(JsonUtil.Get(AsRecord(a.Inputs), "host"));
                string reference = JsonUtil.Str(JsonUtil.Get(host, "workflowReferenceName")).ToLowerInvariant();
                bool idHit = ids.Count > 0 && ids.Contains(reference);
                return (isChildFlow && (nameHit || idHit || ids.Count == 0)) || (nameHit && isChildFlow);
            });

            if (match != null)
                return new List<Finding> { MakeFinding(ctx, "pass", "Logging child flow invoked via \"" + match.Name + "\".", match.Path) };
            return new List<Finding> { MakeFinding(ctx, "fail",
                "No call to the shared logging child flow was found. Long-term history is lost after 28 days.") };
        }

        public static List<Finding> ConfigListTop(EvaluatorContext ctx)
        {
            var p = ctx.Rule.Parameters;
            var ops = ArrParam(p, "listOperationIds", new[] { "ListRecords" }).Select(s => s.ToLowerInvariant()).ToList();
            var topKeys = ArrParam(p, "topParamNames", new[] { "$top", "top" });

            var listActions = ctx.Flow.AllActions.Where(a => ops.Contains(OperationId(a).ToLowerInvariant())).ToList();
            if (listActions.Count == 0)
                return new List<Finding> { MakeFinding(ctx, "not_applicable", "No Dataverse list actions in this flow.") };

            var offenders = listActions.Where(a =>
            {
                var pr = ActionParameters(a);
                return !topKeys.Any(k => { object val; return pr.TryGetValue(k, out val) && val != null && !"".Equals(val); });
            }).ToList();

            if (offenders.Count == 0)
                return new List<Finding> { MakeFinding(ctx, "pass", "All " + listActions.Count + " list action(s) bound with a row count.") };
            return offenders.Select(a => MakeFinding(ctx, "fail",
                "List action \"" + a.Name + "\" has no row-count limit (" + string.Join("/", topKeys) + "). Open-ended queries raise Microsoft warnings.",
                a.Path)).ToList();
        }

        public static List<Finding> ApprovedEmailSender(EvaluatorContext ctx)
        {
            var p = ctx.Rule.Parameters;
            var ops = ArrParam(p, "emailOperationIds", new[] { "SendEmailV2", "SendEmail", "SharedMailboxSendEmailV2" }).Select(s => s.ToLowerInvariant()).ToList();
            var apiContains = ArrParam(p, "emailApiIdContains", new[] { "office365", "outlook", "gmail" }).Select(s => s.ToLowerInvariant()).ToList();
            var approved = ArrParam(p, "approvedSenders", new[] { "appdev-no-reply@cma.ca" }).Select(s => s.ToLowerInvariant()).ToList();
            var fromKeys = ArrParam(p, "fromParamNames", new[] { "emailMessage/From", "From", "MailboxAddress" });

            var emailActions = ctx.Flow.AllActions.Where(a =>
            {
                string op = OperationId(a).ToLowerInvariant();
                string api = ApiId(a).ToLowerInvariant();
                return ops.Contains(op) || (apiContains.Any(c => api.Contains(c)) && op.Contains("email"));
            }).ToList();

            if (emailActions.Count == 0)
                return new List<Finding> { MakeFinding(ctx, "not_applicable", "This flow does not send email.") };

            var findings = new List<Finding>();
            foreach (var a in emailActions)
            {
                var pr = ActionParameters(a);
                string fromKey = fromKeys.FirstOrDefault(k => { object v; return pr.TryGetValue(k, out v) && v is string sv && sv != ""; });
                if (fromKey == null)
                {
                    findings.Add(MakeFinding(ctx, "warning",
                        "Email action \"" + a.Name + "\" does not declare a sender in its definition. Verify the connection uses an approved sender (" + string.Join(", ", approved) + ").",
                        a.Path));
                    continue;
                }
                string from = JsonUtil.Str(pr[fromKey]).ToLowerInvariant();
                if (approved.Any(s => from.Contains(s)))
                    findings.Add(MakeFinding(ctx, "pass", "Email action \"" + a.Name + "\" uses an approved sender.", a.Path));
                else
                    findings.Add(MakeFinding(ctx, "fail",
                        "Email action \"" + a.Name + "\" sends from \"" + JsonUtil.Str(pr[fromKey]) + "\", which is not an approved sender (" + string.Join(", ", approved) + ").",
                        a.Path));
            }
            return findings;
        }

        public static List<Finding> RunAsServicePrincipal(EvaluatorContext ctx)
        {
            string owner = ctx.Inventory != null ? ctx.Inventory.OwnerType : null;
            if (string.IsNullOrEmpty(owner) || owner == "unknown")
                return new List<Finding> { MakeFinding(ctx, "not_applicable", "Owner principal type unknown; cannot evaluate.") };
            if (owner == "user")
                return new List<Finding> { MakeFinding(ctx, "fail",
                    "Flow runs as a user principal (" + (ctx.Inventory != null && ctx.Inventory.OwnerName != null ? ctx.Inventory.OwnerName : "user") + "). It should run as an application / service principal.") };
            return new List<Finding> { MakeFinding(ctx, "pass", "Flow runs as a " + owner + " principal.") };
        }

        private static readonly Regex UrlRe = new Regex(@"https?://[^\s""'\\)]+", RegexOptions.IgnoreCase);
        private static readonly Regex GuidRe = new Regex(@"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", RegexOptions.IgnoreCase);

        public static List<Finding> NoHardcodedEnv(EvaluatorContext ctx)
        {
            var p = ctx.Rule.Parameters;
            var ignore = ArrParam(p, "ignoreHostSubstrings", new[] { "schema.management.azure.com", "schemas.microsoft.com", "login.microsoftonline.com" }).Select(s => s.ToLowerInvariant()).ToList();
            bool checkGuid = BoolParam(p, "guidCheck", true);

            var hits = new List<string>();
            foreach (var a in ctx.Flow.AllActions)
            {
                string paramsJson = JsonUtil.Serialize(ActionParameters(a));
                foreach (Match m in UrlRe.Matches(paramsJson))
                    if (!ignore.Any(ig => m.Value.ToLowerInvariant().Contains(ig))) hits.Add(a.Name + ": " + m.Value);
                if (checkGuid)
                    foreach (Match m in GuidRe.Matches(paramsJson)) hits.Add(a.Name + ": " + m.Value);
            }

            if (hits.Count == 0)
                return new List<Finding> { MakeFinding(ctx, "pass", "No hard-coded environment-specific literals detected.") };
            string more = hits.Count > 5 ? " (+" + (hits.Count - 5) + " more)" : "";
            return new List<Finding> { MakeFinding(ctx, "warning",
                "Possible hard-coded environment-specific value(s) found; consider loading from the Flow Configuration table: " + string.Join("; ", hits.Take(5)) + more + ".",
                hits[0]) };
        }

        /// <summary>Registry keyed by ReviewRule.Evaluator (matches evaluatorRegistry).</summary>
        public static readonly Dictionary<string, Func<EvaluatorContext, List<Finding>>> Registry =
            new Dictionary<string, Func<EvaluatorContext, List<Finding>>>
            {
                { "namingConvention", NamingConvention },
                { "errorHandlingScopes", ErrorHandlingScopes },
                { "loggingPresent", LoggingPresent },
                { "configListTop", ConfigListTop },
                { "approvedEmailSender", ApprovedEmailSender },
                { "runAsServicePrincipal", RunAsServicePrincipal },
                { "noHardcodedEnv", NoHardcodedEnv },
            };
    }
}
