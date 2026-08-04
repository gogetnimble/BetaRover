/**
 * Transport-agnostic request handler that backs the custom connector's
 * `POST /review` operation (see connector/flow-review-connector.swagger.json).
 * An Azure Function (or Express route, or CLI) is a thin wrapper: parse the JSON
 * body, call {@link handleReviewRequest}, return the result as JSON.
 */
import { reviewFlow } from './reviewer.js';
import { DEFAULT_RULESET } from './defaultRuleset.js';
import { AzureOpenAiReviewer, NullAiReviewer, type AzureOpenAiConfig } from './ai.js';
import type { AiReviewer, FlowInventoryMeta, Ruleset } from './types.js';

export interface ReviewRequestBody {
  displayName?: unknown;
  clientData?: unknown;
  inventory?: FlowInventoryMeta;
  ruleset?: Ruleset;
  ai?: boolean;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

/**
 * @param body   Parsed request body (from the connector).
 * @param aiCfg  Optional Azure OpenAI config, read from Function app settings.
 *               When absent, the AI pass is a no-op even if `ai: true`.
 */
export async function handleReviewRequest(
  body: ReviewRequestBody,
  aiCfg?: AzureOpenAiConfig,
): Promise<HandlerResult> {
  if (typeof body?.displayName !== 'string' || body.displayName.length === 0) {
    return { status: 400, body: { error: 'displayName is required.' } };
  }
  if (body.clientData === undefined || body.clientData === null) {
    return { status: 400, body: { error: 'clientData is required.' } };
  }

  const ruleset = body.ruleset ?? DEFAULT_RULESET;
  const aiReviewer: AiReviewer =
    body.ai && aiCfg ? new AzureOpenAiReviewer(aiCfg) : new NullAiReviewer();

  const result = await reviewFlow(
    { displayName: body.displayName, clientData: body.clientData, inventory: body.inventory },
    ruleset,
    { ai: Boolean(body.ai) && Boolean(aiCfg), aiReviewer },
  );

  return { status: 200, body: result };
}
