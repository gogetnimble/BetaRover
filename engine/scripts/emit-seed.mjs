/**
 * Emits solution/seed/default-ruleset.json from the engine's DEFAULT_RULESET so
 * the Dataverse seed data can never drift from the code. Run: npm run emit-seed
 * (builds first). The seed shape matches the bvr_reviewstandard / bvr_reviewrule
 * tables described in docs/data-model.md.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_RULESET } from '../dist/defaultRuleset.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', 'solution', 'seed');
mkdirSync(outDir, { recursive: true });

const seed = {
  standard: {
    bvr_code: DEFAULT_RULESET.standardCode,
    bvr_name: DEFAULT_RULESET.standardName,
    bvr_version: DEFAULT_RULESET.version,
    bvr_standardtext: DEFAULT_RULESET.standardText,
  },
  rules: DEFAULT_RULESET.rules.map((r) => ({
    bvr_code: r.code,
    bvr_name: r.name,
    bvr_category: r.category,
    bvr_evaluator: r.evaluator,
    bvr_severity: r.severity,
    bvr_enabled: r.enabled,
    bvr_weight: r.weight,
    bvr_parametersjson: JSON.stringify(r.parameters),
    bvr_remediation: r.remediation ?? '',
    bvr_description: r.description ?? '',
  })),
};

const outFile = join(outDir, 'default-ruleset.json');
writeFileSync(outFile, JSON.stringify(seed, null, 2) + '\n');
console.log(`Wrote ${seed.rules.length} rules to ${outFile}`);
