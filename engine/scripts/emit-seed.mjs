/**
 * Emits solution/seed/default-ruleset.json from the engine's DEFAULT_RULESET so
 * the Dataverse seed data can never drift from the code. Run: npm run emit-seed
 * (builds first). The seed shape matches the br_reviewstandard / br_reviewrule
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
    br_code: DEFAULT_RULESET.standardCode,
    br_name: DEFAULT_RULESET.standardName,
    br_version: DEFAULT_RULESET.version,
    br_standardtext: DEFAULT_RULESET.standardText,
  },
  rules: DEFAULT_RULESET.rules.map((r) => ({
    br_code: r.code,
    br_name: r.name,
    br_category: r.category,
    br_evaluator: r.evaluator,
    br_severity: r.severity,
    br_enabled: r.enabled,
    br_weight: r.weight,
    br_parametersjson: JSON.stringify(r.parameters),
    br_remediation: r.remediation ?? '',
    br_description: r.description ?? '',
  })),
};

const outFile = join(outDir, 'default-ruleset.json');
writeFileSync(outFile, JSON.stringify(seed, null, 2) + '\n');
console.log(`Wrote ${seed.rules.length} rules to ${outFile}`);
