using System.Collections.Generic;

namespace BetaRover.Ember.Testing
{
    /// <summary>
    /// POCOs mirroring engine/src/testing/types.ts. ActionStatus is a string
    /// (Succeeded | Failed | Skipped | TimedOut) so it maps straight onto the trace
    /// the flow test-run rows store.
    /// </summary>
    public class MockAction
    {
        public object Outputs;         // action's outputs; body('name') returns outputs.body when present
        public bool HasOutputs;        // distinguishes "no outputs key" from "outputs: null"
        public string Status;          // null → Succeeded (or Failed when Error is set)
        public string Error;           // convenience: sets status Failed + records the message
    }

    public class TestCase
    {
        public string Name;
        public object TriggerOutputs;
        public object TriggerBody;
        public bool HasTriggerBody;
        public Dictionary<string, MockAction> Mocks = new Dictionary<string, MockAction>();
        public Dictionary<string, object> Variables;   // null when not supplied
        public List<Assertion> Asserts = new List<Assertion>();
    }

    /// <summary>
    /// One assertion. Kept as a tagged bag rather than a class-per-type so the JSON
    /// reader stays small; only the fields relevant to <see cref="Type"/> are set.
    /// </summary>
    public class Assertion
    {
        public string Type;        // ran | skipped | status | branchTaken | variableEquals | outputEquals | expression | noFailures
        public string Action;
        public string Condition;
        public string Branch;      // yes | no
        public string Name;
        public string Expression;
        public object Expected;
        public bool HasExpected;
    }

    public class ActionTrace
    {
        public string Name;
        public string Type;
        public string Status;
        public object Output;
        public bool HasOutput;
        public string Branch;      // yes | no (Condition actions)
        public bool Mocked;
        public string Note;
    }

    public class AssertionResult
    {
        public Assertion Assertion;
        public bool Passed;
        public string Message;
    }

    public class TestResult
    {
        public string CaseName;
        public bool Passed;
        public List<AssertionResult> Assertions = new List<AssertionResult>();
        public List<ActionTrace> Trace = new List<ActionTrace>();
        public List<string> UnmockedExternal = new List<string>();
    }
}
