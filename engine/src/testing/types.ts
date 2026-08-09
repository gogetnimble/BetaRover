/**
 * Types for the mock-execution (unit-test) runner.
 *
 * A {@link TestCase} pins the trigger payload and the outputs of connector
 * actions, then asserts on the simulated run. No live connectors are ever
 * called — the flow's definition is interpreted in-process, which is the
 * Power Automate equivalent of Azure Logic Apps' mocked unit tests.
 */

export type ActionStatus = 'Succeeded' | 'Failed' | 'Skipped' | 'TimedOut';

/** Mocked outcome for one action, keyed by action name in {@link TestCase.mocks}. */
export interface MockAction {
  /**
   * The action's `outputs`. `body('name')` returns `outputs.body` when present,
   * otherwise the whole `outputs` value.
   */
  outputs?: unknown;
  /** Defaults to `Succeeded` (or `Failed` when {@link error} is set). */
  status?: ActionStatus;
  /** Convenience: sets status to `Failed` and records the message. */
  error?: string;
}

/** A single assertion evaluated after the run. */
export type Assertion =
  | { type: 'ran'; action: string }
  | { type: 'skipped'; action: string }
  | { type: 'status'; action: string; equals: ActionStatus }
  | { type: 'branchTaken'; condition: string; branch: 'yes' | 'no' }
  | { type: 'variableEquals'; name: string; equals: unknown }
  | { type: 'outputEquals'; expression: string; equals: unknown }
  | { type: 'expression'; expression: string; equals: unknown }
  | { type: 'noFailures' };

export interface TestCase {
  name: string;
  /** `triggerOutputs()` / `triggerBody()`. `body` falls back to `outputs.body`. */
  trigger?: { outputs?: unknown; body?: unknown };
  /** Mocked action outcomes, keyed by action name. */
  mocks?: Record<string, MockAction>;
  /** Optional seed values for variables (before InitializeVariable runs). */
  variables?: Record<string, unknown>;
  asserts: Assertion[];
}

export interface ActionTrace {
  name: string;
  type: string;
  status: ActionStatus;
  /** Present for actions that produce output (Compose, mocked connectors, …). */
  output?: unknown;
  /** For Condition actions: which branch executed. */
  branch?: 'yes' | 'no';
  /** Set when the action was mocked. */
  mocked?: boolean;
  note?: string;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  message: string;
}

export interface TestResult {
  caseName: string;
  passed: boolean;
  assertions: AssertionResult[];
  trace: ActionTrace[];
  /** Names of external (connector/child-flow/http) actions reached without a mock. */
  unmockedExternal: string[];
}
