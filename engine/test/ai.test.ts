import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AzureOpenAiReviewer, NullAiReviewer } from '../src/ai.js';
import { reviewFlow } from '../src/reviewer.js';
import { DEFAULT_RULESET } from '../src/defaultRuleset.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf-8'));

describe('AzureOpenAiReviewer', () => {
  it('parses model findings and marks them AI-generated', async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  findings: [
                    {
                      category: 'General',
                      severity: 'warning',
                      status: 'fail',
                      message: 'The Apply_to_each has no concurrency control.',
                      evidence: 'Apply_to_each',
                      remediation: 'Set concurrency.',
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const reviewer = new AzureOpenAiReviewer(
      { endpoint: 'https://example.openai.azure.com', apiKey: 'k', deployment: 'gpt-4o' },
      fakeFetch as unknown as typeof fetch,
    );

    const result = await reviewFlow(
      {
        displayName: 'CMA - Membership - Add new Roles on Contact Creation',
        clientData: fixture('compliant-flow.json'),
        inventory: { ownerType: 'application' },
      },
      DEFAULT_RULESET,
      { ai: true, aiReviewer: reviewer },
    );

    const ai = result.findings.filter((f) => f.aiGenerated);
    expect(ai).toHaveLength(1);
    expect(ai[0]!.message).toContain('concurrency');
    expect(ai[0]!.status).toBe('fail');
    expect(fakeFetch).toHaveBeenCalledOnce();

    // The prompt must not include deterministic passes, only the flow + standard.
    const [, requestInit] = fakeFetch.mock.calls[0]!;
    const body = JSON.parse((requestInit as RequestInit).body as string);
    expect(body.messages[1].content).toContain('DELIVERY STANDARD');
  });

  it('returns [] on malformed model output instead of throwing', async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }), {
        status: 200,
      }),
    );
    const reviewer = new AzureOpenAiReviewer(
      { endpoint: 'https://e', apiKey: 'k', deployment: 'd' },
      fakeFetch as unknown as typeof fetch,
    );
    const out = await reviewer.review(
      (await import('../src/flowModel.js')).parseFlow('x', fixture('compliant-flow.json')),
      DEFAULT_RULESET,
      [],
    );
    expect(out).toEqual([]);
  });

  it('NullAiReviewer contributes nothing', async () => {
    const out = await new NullAiReviewer().review();
    expect(out).toEqual([]);
  });
});
