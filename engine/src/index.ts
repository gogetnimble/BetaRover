/** Public entrypoint for the BetaRover flow-review engine. */
export * from './types.js';
export { parseFlow } from './flowModel.js';
export { reviewFlow, scoreFindings } from './reviewer.js';
export { evaluatorRegistry } from './rules/evaluators.js';
export { DEFAULT_RULESET } from './defaultRuleset.js';
export { NullAiReviewer, AzureOpenAiReviewer } from './ai.js';
export type { AzureOpenAiConfig } from './ai.js';
export { handleReviewRequest } from './http.js';
export type { ReviewRequestBody, HandlerResult } from './http.js';

import { reviewFlow } from './reviewer.js';
import { DEFAULT_RULESET } from './defaultRuleset.js';
import type { FlowReviewInput, FlowReviewResult, ReviewOptions } from './types.js';

/** Convenience: review a flow with the bundled default (CMA) ruleset. */
export function reviewFlowWithDefaults(
  input: FlowReviewInput,
  options?: ReviewOptions,
): Promise<FlowReviewResult> {
  return reviewFlow(input, DEFAULT_RULESET, options);
}
