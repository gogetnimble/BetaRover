/**
 * The AI half of the hybrid review. Deterministic rules catch the mechanical,
 * unambiguous violations; the AI pass adds holistic judgement the rules can't
 * express (intent, readability, missed edge cases, over-complex branching).
 *
 * Two implementations are provided:
 *   - {@link NullAiReviewer}: returns nothing. Used offline and in tests.
 *   - {@link AzureOpenAiReviewer}: calls an Azure OpenAI chat deployment.
 */
import type { AiReviewer, Finding, FlowModel, RuleCategory, Ruleset } from './types.js';

export class NullAiReviewer implements AiReviewer {
  async review(): Promise<Finding[]> {
    return [];
  }
}

export interface AzureOpenAiConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion?: string;
  /** Cap on flow-definition characters sent to the model. */
  maxDefinitionChars?: number;
}

interface AiRawFinding {
  category?: string;
  severity?: string;
  status?: string;
  message?: string;
  evidence?: string;
  remediation?: string;
}

const VALID_CATEGORIES: RuleCategory[] = [
  'Naming',
  'ErrorHandling',
  'Logging',
  'Configuration',
  'Security',
  'Email',
  'General',
];

export class AzureOpenAiReviewer implements AiReviewer {
  constructor(
    private readonly cfg: AzureOpenAiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async review(flow: FlowModel, ruleset: Ruleset, deterministic: Finding[]): Promise<Finding[]> {
    const url =
      `${this.cfg.endpoint.replace(/\/$/, '')}/openai/deployments/${this.cfg.deployment}` +
      `/chat/completions?api-version=${this.cfg.apiVersion ?? '2024-06-01'}`;

    const body = {
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: this.buildUserPrompt(flow, ruleset, deterministic) },
      ],
    };

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': this.cfg.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Azure OpenAI request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? '{}';
    return this.parse(content);
  }

  private buildUserPrompt(flow: FlowModel, ruleset: Ruleset, deterministic: Finding[]): string {
    const cap = this.cfg.maxDefinitionChars ?? 24000;
    const def = JSON.stringify(flow.raw).slice(0, cap);
    const priorFindings = deterministic
      .filter((f) => f.status === 'fail' || f.status === 'warning')
      .map((f) => `- [${f.ruleCode}] ${f.message}`)
      .join('\n');

    return [
      `DELIVERY STANDARD:\n${ruleset.standardText ?? '(none supplied)'}`,
      `\nFLOW NAME: ${flow.displayName}`,
      `\nDETERMINISTIC FINDINGS ALREADY RAISED (do not repeat these):\n${priorFindings || '(none)'}`,
      `\nFLOW DEFINITION (truncated JSON):\n${def}`,
      `\nReturn additional findings not already covered above.`,
    ].join('\n');
  }

  private parse(content: string): Finding[] {
    let raw: { findings?: AiRawFinding[] };
    try {
      raw = JSON.parse(content);
    } catch {
      return [];
    }
    const items = Array.isArray(raw.findings) ? raw.findings : [];
    return items.map((r) => this.coerce(r)).filter((f): f is Finding => f !== null);
  }

  private coerce(r: AiRawFinding): Finding | null {
    if (!r.message) return null;
    const category = (VALID_CATEGORIES as string[]).includes(r.category ?? '')
      ? (r.category as RuleCategory)
      : 'General';
    const severity =
      r.severity === 'critical' || r.severity === 'error' || r.severity === 'warning'
        ? r.severity
        : 'info';
    const status =
      r.status === 'fail' || r.status === 'warning' || r.status === 'pass'
        ? r.status
        : severity === 'info'
          ? 'warning'
          : 'fail';
    return {
      ruleCode: 'AI_REVIEW',
      ruleName: 'AI holistic review',
      category,
      status,
      severity,
      message: r.message,
      evidence: r.evidence,
      remediation: r.remediation,
      aiGenerated: true,
    };
  }
}

const SYSTEM_PROMPT = `You are a senior Power Automate reviewer. You are given an
organisation's delivery standard, a cloud flow's definition JSON, and the
deterministic findings already raised by an automated rule engine. Identify
ADDITIONAL issues those rules could not detect: unclear intent, brittle logic,
missing edge-case handling, needless complexity, or standard violations not
covered above. Be specific and reference action names. Do not repeat findings
already listed. Respond ONLY as JSON of the form:
{"findings":[{"category":"General","severity":"warning","status":"fail","message":"...","evidence":"action name","remediation":"..."}]}
Valid categories: Naming, ErrorHandling, Logging, Configuration, Security, Email, General.
Valid severities: info, warning, error, critical. If there are no additional issues, return {"findings":[]}.`;
