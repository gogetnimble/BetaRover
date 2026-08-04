#!/usr/bin/env node
/**
 * Provision the six Flow Code Review tables into a Dataverse environment.
 *
 * The importable solution (../package) carries the publisher, the global choices,
 * and the web resource. Hand-authoring import-valid table + form + view XML is
 * fragile, so the tables are created here through the Dataverse Web API instead —
 * which auto-generates the default forms and views for you. Everything is read
 * from ../schema/tables.json, so the spec stays the single source of truth.
 *
 * Idempotent: existing tables/columns/keys are detected and skipped, so it is
 * safe to re-run after editing the schema.
 *
 * USAGE
 *   Import ../package/BetaRoverFlowReview_1_0_0_0.zip FIRST (creates the choices),
 *   then:
 *
 *     export DATAVERSE_URL="https://yourorg.crm.dynamics.com"
 *     export DATAVERSE_TOKEN="$(az account get-access-token \
 *        --resource https://yourorg.crm.dynamics.com --query accessToken -o tsv)"
 *     node provision.mjs            # create tables + columns + keys
 *     node provision.mjs --seed     # ...and import the default standard + rules
 *
 * The token must belong to a user who can customise the environment. No npm
 * dependencies — Node 18+ (global fetch) only.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const URL_BASE = (process.env.DATAVERSE_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.DATAVERSE_TOKEN || '';
const SOLUTION = process.env.SOLUTION_UNIQUE_NAME || 'BetaRoverFlowReview';
const LCID = 1033;
const SEED = process.argv.includes('--seed');

if (!URL_BASE || !TOKEN) {
  console.error('Set DATAVERSE_URL and DATAVERSE_TOKEN (see header of this file).');
  process.exit(1);
}
const API = `${URL_BASE}/api/data/v9.2`;

/* Map tables.json choice columns to the global option sets shipped in the solution. */
const GLOBAL_OPTIONSET = {
  br_category: 'br_rulecategory',
  br_severity: 'br_severity',
  br_status: null,            // resolved per-table below (finding vs run vs review)
  br_ownertype: 'br_ownertype',
  br_state: 'br_flowstate',
  br_source: 'br_flowsource',
  br_triggersource: 'br_triggersource',
};
const STATUS_OPTIONSET_BY_TABLE = {
  br_reviewrun: 'br_runstatus',
  br_flowreview: 'br_flowreviewstatus',
  br_reviewfinding: 'br_findingstatus',
};

async function api(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'OData-MaxVersion': '4.0', 'OData-Version': '4.0',
      Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || res.status === 201) return { ok: true, headers: res.headers };
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) { const e = new Error(json?.error?.message || text || res.statusText); e.status = res.status; e.body = json; throw e; }
  return json;
}
const solHeader = { 'MSCRM.SolutionUniqueName': SOLUTION };
const label = (t) => ({ '@odata.type': 'Microsoft.Dynamics.CRM.Label', LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: t, LanguageCode: LCID }] });

async function entityExists(logical) {
  try { await api('GET', `EntityDefinitions(LogicalName='${logical}')?$select=LogicalName`); return true; }
  catch (e) { if (e.status === 404) return false; throw e; }
}
async function attrExists(logical, attr) {
  try { await api('GET', `EntityDefinitions(LogicalName='${logical}')/Attributes(LogicalName='${attr}')?$select=LogicalName`); return true; }
  catch (e) { if (e.status === 404) return false; throw e; }
}

function stringAttr(col, primary = false) {
  const isMemo = col.type === 'Multiline';
  return {
    '@odata.type': `Microsoft.Dynamics.CRM.${isMemo ? 'Memo' : 'String'}AttributeMetadata`,
    SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
    RequiredLevel: { Value: col.required ? 'ApplicationRequired' : 'None' },
    DisplayName: label(prettyName(col.schemaName)),
    MaxLength: col.maxLength || (isMemo ? 4000 : 200),
    ...(isMemo ? { Format: 'TextArea' } : { FormatName: { Value: 'Text' } }),
    ...(primary ? { IsPrimaryName: true } : {}),
  };
}
function intAttr(col) {
  return {
    '@odata.type': 'Microsoft.Dynamics.CRM.IntegerAttributeMetadata',
    SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
    RequiredLevel: { Value: 'None' }, DisplayName: label(prettyName(col.schemaName)),
    MinValue: col.min ?? -2147483648, MaxValue: col.max ?? 2147483647,
  };
}
function decimalAttr(col) {
  return {
    '@odata.type': 'Microsoft.Dynamics.CRM.DecimalAttributeMetadata',
    SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
    RequiredLevel: { Value: 'None' }, DisplayName: label(prettyName(col.schemaName)),
    Precision: col.precision ?? 2, MinValue: -100000000000, MaxValue: 100000000000,
  };
}
function boolAttr(col) {
  return {
    '@odata.type': 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata',
    SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
    RequiredLevel: { Value: 'None' }, DisplayName: label(prettyName(col.schemaName)),
    DefaultValue: col.default === true,
    OptionSet: {
      '@odata.type': 'Microsoft.Dynamics.CRM.BooleanOptionSetMetadata',
      TrueOption: { Value: 1, Label: label('Yes') }, FalseOption: { Value: 0, Label: label('No') },
    },
  };
}
function dateAttr(col) {
  return {
    '@odata.type': 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata',
    SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
    RequiredLevel: { Value: 'None' }, DisplayName: label(prettyName(col.schemaName)),
    Format: 'DateAndTime', DateTimeBehavior: { Value: 'UserLocal' },
  };
}
function picklistAttr(col, table) {
  const globalName = col.schemaName === 'br_status'
    ? STATUS_OPTIONSET_BY_TABLE[table]
    : GLOBAL_OPTIONSET[col.schemaName];
  if (!globalName) throw new Error(`No global option set mapped for ${table}.${col.schemaName}`);
  return {
    '@odata.type': 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata',
    SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
    RequiredLevel: { Value: 'None' }, DisplayName: label(prettyName(col.schemaName)),
    'GlobalOptionSet@odata.bind': `/GlobalOptionSetDefinitions(Name='${globalName}')`,
  };
}
function prettyName(schema) {
  return schema.replace(/^br_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function createEntity(table) {
  const primaryCol = table.columns.find((c) => c.isPrimary) || table.columns[0];
  const setName = table.schemaName.endsWith('y')
    ? table.schemaName.slice(0, -1) + 'ies'
    : table.schemaName + 's';
  const md = {
    '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
    SchemaName: table.schemaName, LogicalName: table.schemaName.toLowerCase(),
    DisplayName: label(table.displayName),
    DisplayCollectionName: label(table.displayName + 's'),
    Description: label(table.description || ''),
    OwnershipType: 'UserOwned', IsActivity: false, HasActivities: false, HasNotes: false,
    EntitySetName: setName,
    Attributes: [stringAttr(primaryCol, true)],
  };
  await api('POST', 'EntityDefinitions', md, solHeader);
}

async function createAttribute(table, col) {
  const logical = table.schemaName.toLowerCase();
  let attr;
  switch (col.type) {
    case 'Text': case 'Multiline': attr = stringAttr(col); break;
    case 'WholeNumber': attr = intAttr(col); break;
    case 'Decimal': attr = decimalAttr(col); break;
    case 'Boolean': attr = boolAttr(col); break;
    case 'DateTime': attr = dateAttr(col); break;
    case 'Choice': attr = picklistAttr(col, table.schemaName); break;
    case 'Lookup': return; // handled in the relationship pass
    default: throw new Error(`Unhandled column type ${col.type} for ${col.schemaName}`);
  }
  await api('POST', `EntityDefinitions(LogicalName='${logical}')/Attributes`, attr, solHeader);
}

async function createLookup(table, col) {
  const referencing = table.schemaName.toLowerCase();
  const referenced = col.target.toLowerCase();
  const relName = `${referencing}_${col.schemaName.toLowerCase()}_${referenced}`;
  try { await api('GET', `RelationshipDefinitions(SchemaName='${relName}')?$select=SchemaName`); return; }
  catch (e) { if (e.status !== 404) throw e; }
  const rel = {
    '@odata.type': 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
    SchemaName: relName,
    ReferencedEntity: referenced, ReferencingEntity: referencing,
    ReferencedAttribute: `${referenced}id`,
    Lookup: {
      '@odata.type': 'Microsoft.Dynamics.CRM.LookupAttributeMetadata',
      SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
      DisplayName: label(prettyName(col.schemaName)),
      RequiredLevel: { Value: col.required ? 'ApplicationRequired' : 'None' },
    },
    CascadeConfiguration: { Assign: 'NoCascade', Delete: 'RemoveLink', Merge: 'NoCascade', Reparent: 'NoCascade', Share: 'NoCascade', Unshare: 'NoCascade' },
  };
  await api('POST', 'RelationshipDefinitions', rel, solHeader);
}

async function createAltKey(table) {
  if (!table.alternateKeys) return;
  const logical = table.schemaName.toLowerCase();
  for (const key of table.alternateKeys) {
    try {
      const existing = await api('GET', `EntityDefinitions(LogicalName='${logical}')/Keys?$select=SchemaName&$filter=SchemaName eq '${key.name}'`);
      if (existing.value && existing.value.length) { console.log(`      key ${key.name} exists`); continue; }
    } catch { /* fall through to create */ }
    await api('POST', `EntityDefinitions(LogicalName='${logical}')/Keys`, {
      '@odata.type': 'Microsoft.Dynamics.CRM.EntityKeyMetadata',
      SchemaName: key.name, DisplayName: label(key.name),
      KeyAttributes: key.columns.map((c) => c.toLowerCase()),
    }, solHeader);
    console.log(`      + key ${key.name}`);
  }
}

async function main() {
  const spec = JSON.parse(await readFile(join(__dir, '..', 'schema', 'tables.json'), 'utf8'));
  console.log(`Provisioning ${spec.tables.length} tables into ${URL_BASE} (solution ${SOLUTION})\n`);

  // Pass 1: entities + non-lookup attributes
  for (const table of spec.tables) {
    const logical = table.schemaName.toLowerCase();
    if (await entityExists(logical)) { console.log(`= ${table.schemaName} (exists)`); }
    else { console.log(`+ ${table.schemaName}`); await createEntity(table); }
    for (const col of table.columns) {
      if (col.isPrimary || col.type === 'Lookup') continue;
      if (await attrExists(logical, col.schemaName.toLowerCase())) continue;
      try { await createAttribute(table, col); console.log(`      + ${col.schemaName} (${col.type})`); }
      catch (e) { console.error(`      ! ${col.schemaName}: ${e.message}`); }
    }
  }
  // Pass 2: lookups (both ends now exist) + alternate keys
  console.log('\nRelationships & keys');
  for (const table of spec.tables) {
    for (const col of table.columns.filter((c) => c.type === 'Lookup')) {
      try { await createLookup(table, col); console.log(`      + ${table.schemaName}.${col.schemaName} -> ${col.target}`); }
      catch (e) { console.error(`      ! ${table.schemaName}.${col.schemaName}: ${e.message}`); }
    }
    await createAltKey(table);
  }

  await api('POST', 'PublishAllXml');
  console.log('\nPublished all customizations.');

  if (SEED) { await seed(); }
  console.log('\nDone.');
}

async function seed() {
  console.log('\nSeeding standard + rules from ../seed/default-ruleset.json');
  const seedSpec = JSON.parse(await readFile(join(__dir, '..', 'seed', 'default-ruleset.json'), 'utf8'));
  const CAT = { Naming: 1, ErrorHandling: 2, Logging: 3, Configuration: 4, Security: 5, Email: 6, General: 7 };
  const SEV = { info: 1, warning: 2, error: 3, critical: 4 };

  // upsert standard by br_code (alternate key not defined, so filter-then-create)
  const existing = await api('GET', `br_reviewstandards?$select=br_reviewstandardid&$filter=br_code eq '${seedSpec.standard.br_code}'`);
  let standardId;
  if (existing.value && existing.value.length) { standardId = existing.value[0].br_reviewstandardid; console.log('= standard exists'); }
  else {
    const r = await api('POST', 'br_reviewstandards', {
      br_name: seedSpec.standard.br_name, br_code: seedSpec.standard.br_code,
      br_version: seedSpec.standard.br_version, br_standardtext: seedSpec.standard.br_standardtext, br_isactive: true,
    }, { Prefer: 'return=representation' });
    standardId = r.br_reviewstandardid; console.log('+ standard ' + seedSpec.standard.br_name);
  }
  for (const rule of seedSpec.rules) {
    const dup = await api('GET', `br_reviewrules?$select=br_reviewruleid&$filter=br_code eq '${rule.br_code}' and _br_standardid_value eq ${standardId}`);
    if (dup.value && dup.value.length) { console.log(`      = rule ${rule.br_code}`); continue; }
    await api('POST', 'br_reviewrules', {
      br_name: rule.br_name, br_code: rule.br_code, br_evaluator: rule.br_evaluator,
      br_category: CAT[rule.br_category] ?? null, br_severity: SEV[rule.br_severity] ?? null,
      br_enabled: rule.br_enabled, br_weight: rule.br_weight, br_parametersjson: rule.br_parametersjson,
      br_remediation: rule.br_remediation, br_description: rule.br_description,
      'br_standardid@odata.bind': `/br_reviewstandards(${standardId})`,
    });
    console.log(`      + rule ${rule.br_code}`);
  }
}

main().catch((e) => { console.error('\nFAILED:', e.message); if (e.body) console.error(JSON.stringify(e.body, null, 2)); process.exit(1); });
