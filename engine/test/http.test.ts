import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handleReviewRequest } from '../src/http.js';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, 'fixtures', 'compliant-flow.json'), 'utf-8');

describe('handleReviewRequest (connector contract)', () => {
  it('returns 400 without displayName', async () => {
    const res = await handleReviewRequest({ clientData: raw });
    expect(res.status).toBe(400);
  });

  it('returns 400 without clientData', async () => {
    const res = await handleReviewRequest({ displayName: 'x' });
    expect(res.status).toBe(400);
  });

  it('reviews a flow and returns a score', async () => {
    const res = await handleReviewRequest({
      displayName: 'CMA - Membership - Add new Roles on Contact Creation',
      clientData: raw,
      inventory: { ownerType: 'application' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { score: { score: number }; findings: unknown[] };
    expect(body.score.score).toBe(100);
    expect(body.findings.length).toBeGreaterThan(0);
  });

  it('does not invoke AI when no config is supplied, even if ai:true', async () => {
    const res = await handleReviewRequest({
      displayName: 'CMA - System - X',
      clientData: raw,
      ai: true,
    });
    expect(res.status).toBe(200);
    const body = res.body as { findings: { aiGenerated?: boolean }[] };
    expect(body.findings.some((f) => f.aiGenerated)).toBe(false);
  });
});
