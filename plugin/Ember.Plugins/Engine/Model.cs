using System.Collections.Generic;

namespace Ember.Plugins.Engine
{
    /// <summary>
    /// POCOs mirroring engine/src/types.ts. Severity and status are kept as strings
    /// (info|warning|error|critical / pass|warning|fail|not_applicable) so they map
    /// straight onto the Dataverse choice labels the crawl writes.
    /// </summary>
    public class ReviewRule
    {
        public string Code;
        public string Name;
        public string Category;
        public string Evaluator;
        public string Severity = "warning";
        public bool Enabled = true;
        public int Weight = 1;
        public Dictionary<string, object> Parameters = new Dictionary<string, object>();
        public string Remediation;
        public string Description;
    }

    public class Ruleset
    {
        public string StandardCode;
        public string StandardName;
        public string Version;
        public string StandardText;
        public List<ReviewRule> Rules = new List<ReviewRule>();
    }

    public class FlowInventoryMeta
    {
        public string FlowId;
        public string DisplayName;
        public string Environment;
        public string OwnerType;   // user | application | team | unknown
        public string OwnerName;
        public string State;
        public string Solution;
        public string Source;      // dataverse | managementapi
    }

    public class FlowAction
    {
        public string Name;
        public string Type;
        public Dictionary<string, List<string>> RunAfter = new Dictionary<string, List<string>>();
        public object Inputs;
        public string Path;
        public List<FlowAction> Children = new List<FlowAction>();
        public Dictionary<string, object> Raw = new Dictionary<string, object>();
    }

    public class FlowTrigger
    {
        public string Name;
        public string Type;
        public object Inputs;
        public Dictionary<string, object> Raw = new Dictionary<string, object>();
    }

    public class FlowModel
    {
        public string DisplayName;
        public List<FlowTrigger> Triggers = new List<FlowTrigger>();
        public List<FlowAction> TopLevelActions = new List<FlowAction>();
        public List<FlowAction> AllActions = new List<FlowAction>();
        public Dictionary<string, object> ConnectionReferences = new Dictionary<string, object>();
        public Dictionary<string, object> Raw = new Dictionary<string, object>();
    }

    public class Finding
    {
        public string RuleCode;
        public string RuleName;
        public string Category;
        public string Status;    // pass | warning | fail | not_applicable
        public string Severity;  // info | warning | error | critical
        public string Message;
        public string Evidence;
        public string Remediation;
        public bool AiGenerated;
    }

    public class ReviewScore
    {
        public int Score;
        public int Passed;
        public int Failed;
        public int Warnings;
        public int NotApplicable;
        public Dictionary<string, int> BySeverity = new Dictionary<string, int>
        {
            { "info", 0 }, { "warning", 0 }, { "error", 0 }, { "critical", 0 }
        };
    }

    public class FlowReviewResult
    {
        public string DisplayName;
        public string FlowId;
        public List<Finding> Findings = new List<Finding>();
        public ReviewScore Score = new ReviewScore();
    }

    public class EvaluatorContext
    {
        public FlowModel Flow;
        public FlowInventoryMeta Inventory;
        public ReviewRule Rule;
    }
}
