/**
 * Shared types for the BetaRover Power Automate flow review engine.
 *
 * The engine is intentionally data-driven: the *rules* it enforces are supplied
 * as configuration (a {@link Ruleset}) rather than baked into code, so the same
 * engine can enforce any organisation's delivery standard. The bundled default
 * ruleset encodes the sample CMA standard, but every parameter (naming prefix,
 * approved email senders, scope names, ...) is overridable per tenant.
 */

/** Severity of a finding. Ordered least → most serious. */
export type Severity = 'info' | 'warning' | 'error' | 'critical';

/** Outcome of evaluating a single rule against a single flow. */
export type FindingStatus = 'pass' | 'warning' | 'fail' | 'not_applicable';

/** Category groupings that mirror the sections of the delivery standard. */
export type RuleCategory =
  | 'Naming'
  | 'ErrorHandling'
  | 'Logging'
  | 'Configuration'
  | 'Security'
  | 'Email'
  | 'General';

export interface RuleParameters {
  [key: string]: unknown;
}

/**
 * A single configurable review criterion. In the deployed solution one of these
 * corresponds to a `bvr_reviewrule` row in Dataverse.
 */
export interface ReviewRule {
  /** Stable machine code, e.g. `NAMING_CONVENTION`. Maps to an evaluator. */
  code: string;
  name: string;
  category: RuleCategory;
  /**
   * Key into the deterministic evaluator registry, or the literal `ai` to defer
   * this rule to the AI reviewer.
   */
  evaluator: string;
  severity: Severity;
  enabled: boolean;
  /** Relative weight used when computing the run's compliance score. */
  weight: number;
  parameters: RuleParameters;
  remediation?: string;
  description?: string;
}

/** A named, versioned collection of rules — a `bvr_reviewstandard` row. */
export interface Ruleset {
  standardCode: string;
  standardName: string;
  version: string;
  /** Free-text of the human standard, handed to the AI reviewer for context. */
  standardText?: string;
  rules: ReviewRule[];
}

/**
 * Metadata about a flow that is *not* derivable from its definition JSON —
 * owner, environment, state. Sourced from the Dataverse `workflows` table and
 * enriched from the Power Automate Management API.
 */
export interface FlowInventoryMeta {
  flowId?: string;
  displayName?: string;
  environment?: string;
  /** Principal type the flow runs as. Drives the run-as-service-principal rule. */
  ownerType?: 'user' | 'application' | 'team' | 'unknown';
  ownerName?: string;
  state?: string;
  solution?: string;
  source?: 'dataverse' | 'managementapi';
}

/** Input to the engine for one flow. */
export interface FlowReviewInput {
  /** Display name of the flow (the `workflows.name` column). */
  displayName: string;
  /**
   * The flow's `clientdata`. Accepts either the parsed object or the raw JSON
   * string exactly as stored in Dataverse.
   */
  clientData: unknown;
  inventory?: FlowInventoryMeta;
}

/** A single action in the flow definition, normalised into a tree + flat list. */
export interface FlowAction {
  name: string;
  type: string;
  runAfter: Record<string, string[]>;
  inputs: unknown;
  /** Dot-path of enclosing scopes/conditions, e.g. `Try/Apply_to_each`. */
  path: string;
  children: FlowAction[];
  raw: Record<string, unknown>;
}

export interface FlowTrigger {
  name: string;
  type: string;
  inputs: unknown;
  raw: Record<string, unknown>;
}

/** Normalised, engine-friendly view of a flow definition. */
export interface FlowModel {
  displayName: string;
  triggers: FlowTrigger[];
  topLevelActions: FlowAction[];
  /** Every action, flattened depth-first (scopes and their children included). */
  allActions: FlowAction[];
  connectionReferences: Record<string, unknown>;
  raw: Record<string, unknown>;
}

/** One rule outcome for one flow. Corresponds to a `bvr_reviewfinding` row. */
export interface Finding {
  ruleCode: string;
  ruleName: string;
  category: RuleCategory;
  status: FindingStatus;
  severity: Severity;
  message: string;
  /** Where in the flow the finding was raised (action path / expression). */
  evidence?: string;
  remediation?: string;
  aiGenerated?: boolean;
}

/** Aggregate score for a single flow's review. */
export interface ReviewScore {
  /** 0–100, 100 = fully compliant. */
  score: number;
  passed: number;
  failed: number;
  warnings: number;
  notApplicable: number;
  bySeverity: Record<Severity, number>;
}

export interface FlowReviewResult {
  displayName: string;
  flowId?: string;
  findings: Finding[];
  score: ReviewScore;
}

/** Context passed to each evaluator. */
export interface EvaluatorContext {
  flow: FlowModel;
  inventory?: FlowInventoryMeta;
  rule: ReviewRule;
}

/**
 * A deterministic evaluator. Returns zero or more findings. Returning an empty
 * array means "this rule did not apply to this flow" (recorded as N/A).
 */
export type Evaluator = (ctx: EvaluatorContext) => Finding[];

/** Pluggable AI reviewer for the hybrid pass. */
export interface AiReviewer {
  review(
    flow: FlowModel,
    ruleset: Ruleset,
    deterministicFindings: Finding[],
  ): Promise<Finding[]>;
}

export interface ReviewOptions {
  /** Run the AI pass in addition to deterministic rules. Default false. */
  ai?: boolean;
  aiReviewer?: AiReviewer;
}
