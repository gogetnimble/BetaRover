/* =============================================================================
 * Ember — browser-console provisioner
 * -----------------------------------------------------------------------------
 * Creates the Ember global choices + tables + columns + lookups + alternate keys
 * (and, optionally, seeds the default standard + rules) using the signed-in
 * user's session — NO Node, NO access token, NO env vars.
 *
 * WHY A CONSOLE SCRIPT?  Hand-authoring entity/optionset XML inside the solution
 * zip is fragile (it caused the earlier 0x80048030 import failure). Creating the
 * schema through the Web API is the supported path: it auto-generates default
 * forms/views and assigns choice values in the publisher's option-value-prefix
 * range. This is the same logic as provision.mjs, repackaged to run in a browser
 * tab so you don't need a terminal or a token.
 *
 * HOW TO RUN
 *   1. Import ../package/Ember_1_0_1_0.zip first (publisher + web resource).
 *   2. Open your environment in the browser and sign in — you MUST be on the org
 *      domain, e.g.  https://YOURORG.crm.dynamics.com  (open any model-driven
 *      app, or the "…/main.aspx" classic page). Do NOT run this from
 *      make.powerapps.com — that is a different domain and the API call would be
 *      cross-origin and blocked.
 *   3. Press F12 → Console. (If the console blocks paste, type: allow pasting)
 *   4. Optional: to also seed the default standard + rules, first run:
 *          window.EMBER_SEED = true;
 *   5. Paste this whole file and press Enter. Watch the log; re-runnable safely.
 *
 * The account you're signed in as must be able to customize the environment
 * (System Customizer / System Administrator).
 * ========================================================================== */
(async () => {
  'use strict';

  const SOLUTION = window.EMBER_SOLUTION || 'Ember';
  const SEED = window.EMBER_SEED === true;
  const COL_FAIL = [];   // columns that failed to create (surfaced in the summary)
  const LCID = 1033;

  /* ---- resolve the Web API base from the current page ---------------------- */
  let clientUrl = '';
  try { clientUrl = window.Xrm?.Utility?.getGlobalContext?.().getClientUrl?.() || ''; } catch { /* ignore */ }
  const base = (clientUrl || window.location.origin).replace(/\/+$/, '');
  const API = `${base}/api/data/v9.2`;
  if (!/\/api\/data\/v9\.2$/.test(API) || /make\.powerapps\.com/i.test(base)) {
    console.error('%cRun this from your ORG domain (https://YOURORG.crm.dynamics.com), not make.powerapps.com.', 'color:#b32717;font-weight:bold');
    return;
  }
  console.log(`%cEmber provisioner → ${API}  (solution ${SOLUTION}${SEED ? ', seeding' : ''})`, 'color:#7a120c;font-weight:bold');

  /* ---- tiny Web API client (cookie auth, same-origin) ---------------------- */
  const solHeader = { 'MSCRM.SolutionUniqueName': SOLUTION };
  async function api(method, path, body, extra = {}) {
    const res = await fetch(`${API}/${path}`, {
      method,
      credentials: 'include',
      headers: {
        'OData-MaxVersion': '4.0', 'OData-Version': '4.0',
        Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8',
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204 || res.status === 201) return { ok: true, headers: res.headers };
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) { const e = new Error(json?.error?.message || text || res.statusText); e.status = res.status; e.body = json; throw e; }
    return json;
  }
  const label = (t) => ({ '@odata.type': 'Microsoft.Dynamics.CRM.Label', LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: t, LanguageCode: LCID }] });
  const pretty = (s) => s.replace(/^bvr_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  /* ---- global choices (values in the publisher option-value-prefix range) -- */
  const OPTIONSETS = {
    bvr_severity:         { label: 'Severity',           opts: [['Info',100000000],['Warning',100000001],['Error',100000002],['Critical',100000003]] },
    bvr_rulecategory:     { label: 'Rule category',      opts: [['Naming',100000000],['ErrorHandling',100000001],['Logging',100000002],['Configuration',100000003],['Security',100000004],['Email',100000005],['General',100000006]] },
    bvr_findingstatus:    { label: 'Finding status',     opts: [['pass',100000000],['warning',100000001],['fail',100000002],['not_applicable',100000003]] },
    bvr_ownertype:        { label: 'Owner type',         opts: [['user',100000000],['application',100000001],['team',100000002],['unknown',100000003]] },
    bvr_flowstate:        { label: 'Flow state',         opts: [['Draft',100000000],['Activated',100000001],['Suspended',100000002]] },
    bvr_flowsource:       { label: 'Inventory source',   opts: [['dataverse',100000000],['managementapi',100000001],['both',100000002]] },
    bvr_runstatus:        { label: 'Run status',         opts: [['Queued',100000000],['Running',100000001],['Completed',100000002],['Failed',100000003]] },
    bvr_flowreviewstatus: { label: 'Flow review status', opts: [['Pass',100000000],['Warning',100000001],['Fail',100000002]] },
    bvr_triggersource:    { label: 'Trigger source',     opts: [['schedule',100000000],['ondemand',100000001]] },
    bvr_teststatus:       { label: 'Test status',        opts: [['passed',100000000],['failed',100000001],['error',100000002]] },
  };
  const GLOBAL_OPTIONSET = {
    bvr_category: 'bvr_rulecategory', bvr_severity: 'bvr_severity', bvr_status: null,
    bvr_ownertype: 'bvr_ownertype', bvr_state: 'bvr_flowstate', bvr_source: 'bvr_flowsource',
    bvr_triggersource: 'bvr_triggersource',
  };
  const STATUS_OPTIONSET_BY_TABLE = {
    bvr_reviewrun: 'bvr_runstatus', bvr_flowreview: 'bvr_flowreviewstatus',
    bvr_reviewfinding: 'bvr_findingstatus', bvr_flowtestrun: 'bvr_teststatus',
  };

  /* ---- table spec (mirrors solution/schema/tables.json) -------------------- */
  const TABLES = [
    { schemaName: 'bvr_reviewstandard', displayName: 'Review Standard', description: 'A named, versioned collection of review rules.', columns: [
      { schemaName: 'bvr_name', type: 'Text', maxLength: 200, required: true, isPrimary: true },
      { schemaName: 'bvr_code', type: 'Text', maxLength: 50, required: true },
      { schemaName: 'bvr_version', type: 'Text', maxLength: 20 },
      { schemaName: 'bvr_standardtext', type: 'Multiline', maxLength: 100000 },
      { schemaName: 'bvr_isactive', type: 'Boolean', default: true },
      { schemaName: 'bvr_reviewallflows', type: 'Boolean', default: false },
    ]},
    { schemaName: 'bvr_reviewrule', displayName: 'Review Rule', description: 'A single configurable review criterion.', columns: [
      { schemaName: 'bvr_name', type: 'Text', maxLength: 200, required: true, isPrimary: true },
      { schemaName: 'bvr_code', type: 'Text', maxLength: 50, required: true },
      { schemaName: 'bvr_category', type: 'Choice' },
      { schemaName: 'bvr_evaluator', type: 'Text', maxLength: 100 },
      { schemaName: 'bvr_severity', type: 'Choice' },
      { schemaName: 'bvr_enabled', type: 'Boolean', default: true },
      { schemaName: 'bvr_weight', type: 'WholeNumber', min: 0, max: 100 },
      { schemaName: 'bvr_parametersjson', type: 'Multiline', maxLength: 10000 },
      { schemaName: 'bvr_remediation', type: 'Multiline', maxLength: 4000 },
      { schemaName: 'bvr_description', type: 'Multiline', maxLength: 4000 },
      { schemaName: 'bvr_standardid', type: 'Lookup', target: 'bvr_reviewstandard', required: true },
    ]},
    { schemaName: 'bvr_flowinventory', displayName: 'Flow Inventory', description: 'One row per discovered cloud flow.', columns: [
      { schemaName: 'bvr_name', type: 'Text', maxLength: 300, required: true, isPrimary: true },
      { schemaName: 'bvr_flowid', type: 'Text', maxLength: 50 },
      { schemaName: 'bvr_environment', type: 'Text', maxLength: 200 },
      { schemaName: 'bvr_ownertype', type: 'Choice' },
      { schemaName: 'bvr_ownername', type: 'Text', maxLength: 200 },
      { schemaName: 'bvr_state', type: 'Choice' },
      { schemaName: 'bvr_solution', type: 'Text', maxLength: 200 },
      { schemaName: 'bvr_source', type: 'Choice' },
      { schemaName: 'bvr_lastmodifiedon_src', type: 'DateTime' },
      { schemaName: 'bvr_definitionhash', type: 'Text', maxLength: 64 },
      { schemaName: 'bvr_triggertype', type: 'Text', maxLength: 100 },
      { schemaName: 'bvr_actioncount', type: 'WholeNumber' },
      { schemaName: 'bvr_lastreviewedon', type: 'DateTime' },
      { schemaName: 'bvr_lasttestpassedon', type: 'DateTime' },
      { schemaName: 'bvr_testcasecount', type: 'WholeNumber' },
    ], alternateKeys: [{ name: 'bvr_flowid_key', columns: ['bvr_flowid'] }]},
    { schemaName: 'bvr_reviewrun', displayName: 'Review Run', description: 'One crawl + review execution.', columns: [
      { schemaName: 'bvr_name', type: 'Text', maxLength: 200, required: true, isPrimary: true },
      { schemaName: 'bvr_startedon', type: 'DateTime' },
      { schemaName: 'bvr_completedon', type: 'DateTime' },
      { schemaName: 'bvr_status', type: 'Choice' },
      { schemaName: 'bvr_standardid', type: 'Lookup', target: 'bvr_reviewstandard' },
      { schemaName: 'bvr_flowsscanned', type: 'WholeNumber' },
      { schemaName: 'bvr_findingscount', type: 'WholeNumber' },
      { schemaName: 'bvr_averagescore', type: 'Decimal', precision: 2 },
      { schemaName: 'bvr_triggeredby', type: 'Text', maxLength: 200 },
      { schemaName: 'bvr_triggersource', type: 'Choice' },
      { schemaName: 'bvr_targetflowid', type: 'Text', maxLength: 50 },
    ]},
    { schemaName: 'bvr_flowreview', displayName: 'Flow Review', description: 'The review of one flow within one run.', columns: [
      { schemaName: 'bvr_name', type: 'Text', maxLength: 400, required: true, isPrimary: true },
      { schemaName: 'bvr_runid', type: 'Lookup', target: 'bvr_reviewrun', required: true },
      { schemaName: 'bvr_flowinventoryid', type: 'Lookup', target: 'bvr_flowinventory', required: true },
      { schemaName: 'bvr_score', type: 'WholeNumber', min: 0, max: 100 },
      { schemaName: 'bvr_passed', type: 'WholeNumber' },
      { schemaName: 'bvr_failed', type: 'WholeNumber' },
      { schemaName: 'bvr_warnings', type: 'WholeNumber' },
      { schemaName: 'bvr_status', type: 'Choice' },
    ]},
    { schemaName: 'bvr_reviewfinding', displayName: 'Review Finding', description: 'A single rule outcome for a single flow in a single run.', columns: [
      { schemaName: 'bvr_name', type: 'Text', maxLength: 400, required: true, isPrimary: true },
      { schemaName: 'bvr_flowreviewid', type: 'Lookup', target: 'bvr_flowreview', required: true },
      { schemaName: 'bvr_ruleid', type: 'Lookup', target: 'bvr_reviewrule' },
      { schemaName: 'bvr_rulecode', type: 'Text', maxLength: 50 },
      { schemaName: 'bvr_status', type: 'Choice' },
      { schemaName: 'bvr_severity', type: 'Choice' },
      { schemaName: 'bvr_category', type: 'Choice' },
      { schemaName: 'bvr_message', type: 'Multiline', maxLength: 4000 },
      { schemaName: 'bvr_evidence', type: 'Multiline', maxLength: 4000 },
      { schemaName: 'bvr_remediation', type: 'Multiline', maxLength: 4000 },
      { schemaName: 'bvr_aigenerated', type: 'Boolean', default: false },
    ]},
    { schemaName: 'bvr_flowtestcase', displayName: 'Flow Test Case', description: 'A mocked unit test for a flow.', columns: [
      { schemaName: 'bvr_name', type: 'Text', maxLength: 300, required: true, isPrimary: true },
      { schemaName: 'bvr_flowinventoryid', type: 'Lookup', target: 'bvr_flowinventory', required: true },
      { schemaName: 'bvr_casejson', type: 'Multiline', maxLength: 100000 },
      { schemaName: 'bvr_enabled', type: 'Boolean', default: true },
      { schemaName: 'bvr_description', type: 'Multiline', maxLength: 4000 },
    ]},
    { schemaName: 'bvr_flowtestrun', displayName: 'Flow Test Run', description: 'One mock-execution of a flow’s test cases.', columns: [
      { schemaName: 'bvr_name', type: 'Text', maxLength: 300, required: true, isPrimary: true },
      { schemaName: 'bvr_flowinventoryid', type: 'Lookup', target: 'bvr_flowinventory', required: true },
      { schemaName: 'bvr_status', type: 'Choice' },
      { schemaName: 'bvr_passed', type: 'WholeNumber' },
      { schemaName: 'bvr_failed', type: 'WholeNumber' },
      { schemaName: 'bvr_durationms', type: 'WholeNumber' },
      { schemaName: 'bvr_ranon', type: 'DateTime' },
      { schemaName: 'bvr_resultjson', type: 'Multiline', maxLength: 100000 },
    ]},
  ];

  /* ---- attribute builders (identical shapes to provision.mjs) -------------- */
  const stringAttr = (col, primary = false) => {
    const isMemo = col.type === 'Multiline';
    return {
      '@odata.type': `Microsoft.Dynamics.CRM.${isMemo ? 'Memo' : 'String'}AttributeMetadata`,
      SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
      RequiredLevel: { Value: col.required ? 'ApplicationRequired' : 'None' },
      DisplayName: label(pretty(col.schemaName)),
      MaxLength: col.maxLength || (isMemo ? 4000 : 200),
      ...(isMemo ? { Format: 'TextArea' } : { FormatName: { Value: 'Text' } }),
      ...(primary ? { IsPrimaryName: true } : {}),
    };
  };
  const intAttr = (col) => ({
    '@odata.type': 'Microsoft.Dynamics.CRM.IntegerAttributeMetadata',
    SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
    RequiredLevel: { Value: 'None' }, DisplayName: label(pretty(col.schemaName)),
    MinValue: col.min ?? -2147483648, MaxValue: col.max ?? 2147483647,
  });
  const decimalAttr = (col) => ({
    '@odata.type': 'Microsoft.Dynamics.CRM.DecimalAttributeMetadata',
    SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
    RequiredLevel: { Value: 'None' }, DisplayName: label(pretty(col.schemaName)),
    Precision: col.precision ?? 2, MinValue: -100000000000, MaxValue: 100000000000,
  });
  const boolAttr = (col) => ({
    '@odata.type': 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata',
    SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
    RequiredLevel: { Value: 'None' }, DisplayName: label(pretty(col.schemaName)),
    DefaultValue: col.default === true,
    OptionSet: {
      '@odata.type': 'Microsoft.Dynamics.CRM.BooleanOptionSetMetadata',
      TrueOption: { Value: 1, Label: label('Yes') }, FalseOption: { Value: 0, Label: label('No') },
    },
  });
  const dateAttr = (col) => ({
    '@odata.type': 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata',
    SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
    RequiredLevel: { Value: 'None' }, DisplayName: label(pretty(col.schemaName)),
    Format: 'DateAndTime', DateTimeBehavior: { Value: 'UserLocal' },
  });
  // Resolve a global option set's MetadataId (GUID) once; binding a picklist
  // column by MetadataId is reliable, whereas binding by the Name alternate key
  // is rejected on many environments (which silently skipped every choice column).
  const _osId = {};
  const optionSetId = async (name) => {
    if (_osId[name]) return _osId[name];
    const r = await api('GET', `GlobalOptionSetDefinitions(Name='${name}')?$select=MetadataId`);
    _osId[name] = r.MetadataId;
    return r.MetadataId;
  };
  const picklistAttr = async (col, table) => {
    const g = col.schemaName === 'bvr_status' ? STATUS_OPTIONSET_BY_TABLE[table] : GLOBAL_OPTIONSET[col.schemaName];
    if (!g) throw new Error(`No global option set mapped for ${table}.${col.schemaName}`);
    const id = await optionSetId(g);
    return {
      '@odata.type': 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata',
      SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
      RequiredLevel: { Value: 'None' }, DisplayName: label(pretty(col.schemaName)),
      'GlobalOptionSet@odata.bind': `/GlobalOptionSetDefinitions(${id})`,
    };
  };

  /* ---- existence probes ---------------------------------------------------- */
  const exists = async (path) => { try { await api('GET', path); return true; } catch (e) { if (e.status === 404) return false; throw e; } };
  const optionSetExists = (n) => exists(`GlobalOptionSetDefinitions(Name='${n}')?$select=Name`);
  const entityExists = (l) => exists(`EntityDefinitions(LogicalName='${l}')?$select=LogicalName`);
  const attrExists = (l, a) => exists(`EntityDefinitions(LogicalName='${l}')/Attributes(LogicalName='${a}')?$select=LogicalName`);

  /* ---- pass 0: global choices --------------------------------------------- */
  console.log('%cGlobal choices', 'font-weight:bold');
  for (const [name, def] of Object.entries(OPTIONSETS)) {
    if (await optionSetExists(name)) { console.log(`  = ${name}`); continue; }
    await api('POST', 'GlobalOptionSetDefinitions', {
      '@odata.type': 'Microsoft.Dynamics.CRM.OptionSetMetadata',
      Name: name, OptionSetType: 'Picklist', IsGlobal: true, IsCustomizable: { Value: true },
      DisplayName: label(def.label),
      Options: def.opts.map(([lbl, val]) => ({ '@odata.type': 'Microsoft.Dynamics.CRM.OptionMetadata', Value: val, Label: label(lbl) })),
    }, solHeader);
    console.log(`  + ${name}`);
  }

  /* ---- pass 1: entities + non-lookup attributes --------------------------- */
  console.log('%cTables & columns', 'font-weight:bold');
  for (const table of TABLES) {
    const logical = table.schemaName.toLowerCase();
    if (await entityExists(logical)) {
      console.log(`  = ${table.schemaName} (exists)`);
    } else {
      const primaryCol = table.columns.find((c) => c.isPrimary) || table.columns[0];
      const setName = table.schemaName.endsWith('y') ? table.schemaName.slice(0, -1) + 'ies' : table.schemaName + 's';
      await api('POST', 'EntityDefinitions', {
        '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
        SchemaName: table.schemaName, LogicalName: logical,
        DisplayName: label(table.displayName), DisplayCollectionName: label(table.displayName + 's'),
        Description: label(table.description || ''),
        OwnershipType: 'UserOwned', IsActivity: false, HasActivities: false, HasNotes: false,
        EntitySetName: setName, Attributes: [stringAttr(primaryCol, true)],
      }, solHeader);
      console.log(`  + ${table.schemaName}`);
    }
    for (const col of table.columns) {
      if (col.isPrimary || col.type === 'Lookup') continue;
      if (await attrExists(logical, col.schemaName.toLowerCase())) continue;
      let attr;
      switch (col.type) {
        case 'Text': case 'Multiline': attr = stringAttr(col); break;
        case 'WholeNumber': attr = intAttr(col); break;
        case 'Decimal': attr = decimalAttr(col); break;
        case 'Boolean': attr = boolAttr(col); break;
        case 'DateTime': attr = dateAttr(col); break;
        case 'Choice': attr = await picklistAttr(col, table.schemaName); break;
        default: console.error(`      ! ${col.schemaName}: unhandled type ${col.type}`); continue;
      }
      try { await api('POST', `EntityDefinitions(LogicalName='${logical}')/Attributes`, attr, solHeader); console.log(`      + ${col.schemaName} (${col.type})`); }
      catch (e) { COL_FAIL.push(`${table.schemaName}.${col.schemaName}: ${e.message}`); console.error(`      ! ${col.schemaName}: ${e.message}`); }
    }
  }

  /* ---- pass 2: lookups + alternate keys ----------------------------------- */
  console.log('%cRelationships & keys', 'font-weight:bold');
  for (const table of TABLES) {
    const referencing = table.schemaName.toLowerCase();
    for (const col of table.columns.filter((c) => c.type === 'Lookup')) {
      const referenced = col.target.toLowerCase();
      const relName = `${referencing}_${col.schemaName.toLowerCase()}_${referenced}`;
      if (await exists(`RelationshipDefinitions(SchemaName='${relName}')?$select=SchemaName`)) { console.log(`  = ${table.schemaName}.${col.schemaName}`); continue; }
      try {
        await api('POST', 'RelationshipDefinitions', {
          '@odata.type': 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata',
          SchemaName: relName, ReferencedEntity: referenced, ReferencingEntity: referencing,
          ReferencedAttribute: `${referenced}id`,
          Lookup: {
            '@odata.type': 'Microsoft.Dynamics.CRM.LookupAttributeMetadata',
            SchemaName: col.schemaName, LogicalName: col.schemaName.toLowerCase(),
            DisplayName: label(pretty(col.schemaName)),
            RequiredLevel: { Value: col.required ? 'ApplicationRequired' : 'None' },
          },
          CascadeConfiguration: { Assign: 'NoCascade', Delete: 'RemoveLink', Merge: 'NoCascade', Reparent: 'NoCascade', Share: 'NoCascade', Unshare: 'NoCascade' },
        }, solHeader);
        console.log(`  + ${table.schemaName}.${col.schemaName} -> ${col.target}`);
      } catch (e) { console.error(`  ! ${table.schemaName}.${col.schemaName}: ${e.message}`); }
    }
    for (const key of table.alternateKeys || []) {
      let has = false;
      try { const r = await api('GET', `EntityDefinitions(LogicalName='${referencing}')/Keys?$select=SchemaName&$filter=SchemaName eq '${key.name}'`); has = !!(r.value && r.value.length); } catch { /* create below */ }
      if (has) { console.log(`  = key ${key.name}`); continue; }
      try {
        await api('POST', `EntityDefinitions(LogicalName='${referencing}')/Keys`, {
          '@odata.type': 'Microsoft.Dynamics.CRM.EntityKeyMetadata',
          SchemaName: key.name, DisplayName: label(key.name), KeyAttributes: key.columns.map((c) => c.toLowerCase()),
        }, solHeader);
        console.log(`  + key ${key.name}`);
      } catch (e) { console.error(`  ! key ${key.name}: ${e.message}`); }
    }
  }

  await api('POST', 'PublishAllXml');
  console.log('%cPublished all customizations.', 'color:#1a7f37;font-weight:bold');

  /* ---- optional seed: default standard + rules ---------------------------- */
  if (SEED) {
    console.log('%cSeeding default standard + rules', 'font-weight:bold');
    const CAT = { Naming: 100000000, ErrorHandling: 100000001, Logging: 100000002, Configuration: 100000003, Security: 100000004, Email: 100000005, General: 100000006 };
    const SEV = { info: 100000000, warning: 100000001, error: 100000002, critical: 100000003 };
    const standard = {
      bvr_code: 'CMA-PA-STD', bvr_name: 'CMA Power Automate Delivery Standard', bvr_version: '1.0.0',
      bvr_standardtext: 'Cloud flows are named "CMA - <Area> - <Function>". Flows run as application/service principals, never user principals. Environment-specific configuration is loaded from the CMA Flow Configuration table (Row Count = 1), not hard-coded. Errors are logged to the CMA Flow Logs table via the shared logger child flow. Error handling uses Try/Catch/Finally scopes wired with "configure run after". Email is sent from appdev-no-reply@cma.ca, never a personal account.',
    };
    const rules = [
      { bvr_code: 'NAMING_CONVENTION', bvr_name: 'Flow naming convention', bvr_category: 'Naming', bvr_evaluator: 'namingConvention', bvr_severity: 'error', bvr_enabled: true, bvr_weight: 3, bvr_parametersjson: '{"prefix":"CMA","separator":" - ","minSegments":3}', bvr_remediation: 'Rename the flow to "<Prefix> - <Area> - <Function>", e.g. "CMA - Membership - Add new Roles on Contact Creation". Use "System" as the area for system/child flows.', bvr_description: 'Flows must be named "<Prefix> - <Area> - <Function>". The prefix also drives WatchFox auto-enable monitoring.' },
      { bvr_code: 'ERROR_HANDLING_SCOPES', bvr_name: 'Try/Catch/Finally error handling', bvr_category: 'ErrorHandling', bvr_evaluator: 'errorHandlingScopes', bvr_severity: 'error', bvr_enabled: true, bvr_weight: 3, bvr_parametersjson: '{"tryName":"Try","catchName":"Catch","finallyName":"Finally","requireFinally":true,"catchRunAfterStatuses":["Failed","TimedOut","Skipped"],"finallyRunAfterStatuses":["Succeeded","Failed","TimedOut","Skipped"]}', bvr_remediation: 'Wrap the flow body in a "Try" Scope. Add a "Catch" Scope configured to run after Try on Failed/TimedOut/Skipped, and a "Finally" Scope that runs after Catch on all outcomes.', bvr_description: 'Implements Try/Catch/Finally using Scopes and "configure run after" to emulate native error handling.' },
      { bvr_code: 'LOGGING_PRESENT', bvr_name: 'Long-term logging present', bvr_category: 'Logging', bvr_evaluator: 'loggingPresent', bvr_severity: 'warning', bvr_enabled: true, bvr_weight: 2, bvr_parametersjson: '{"loggerNameContains":["Logger","Log","Validate Logger"],"loggerWorkflowIds":[]}', bvr_remediation: 'Call the shared logging child flow (e.g. "CMA - System - Validate Logger") from your Catch scope, passing Level, Source and Event Details, so history outlives the 28-day Power Automate retention.', bvr_description: 'Power Automate keeps run history for only 28 days; durable logs must be written to the CMA Flow Logs table.' },
      { bvr_code: 'CONFIG_LIST_TOP', bvr_name: 'Bounded list queries (Row Count)', bvr_category: 'Configuration', bvr_evaluator: 'configListTop', bvr_severity: 'warning', bvr_enabled: true, bvr_weight: 1, bvr_parametersjson: '{"listOperationIds":["ListRecords"],"topParamNames":["$top","top"]}', bvr_remediation: 'Set a row count (Top Count / $top) on every "List rows" action. When loading the Flow Configuration record, use Row Count = 1.', bvr_description: 'Open-ended Dataverse queries raise Microsoft warnings; configuration is loaded from the Flow Configuration table with Row Count = 1.' },
      { bvr_code: 'APPROVED_EMAIL_SENDER', bvr_name: 'Approved email sender', bvr_category: 'Email', bvr_evaluator: 'approvedEmailSender', bvr_severity: 'error', bvr_enabled: true, bvr_weight: 2, bvr_parametersjson: '{"emailOperationIds":["SendEmailV2","SendEmail","SharedMailboxSendEmailV2"],"emailApiIdContains":["office365","outlook","gmail"],"approvedSenders":["appdev-no-reply@cma.ca"],"fromParamNames":["emailMessage/From","From","MailboxAddress"]}', bvr_remediation: 'Send email using the approved connection (appdev-no-reply@cma.ca). Never send from a personal account.', bvr_description: 'Outbound email must use the licensed no-reply connection, not a personal account.' },
      { bvr_code: 'RUN_AS_SERVICE_PRINCIPAL', bvr_name: 'Runs as service principal', bvr_category: 'Security', bvr_evaluator: 'runAsServicePrincipal', bvr_severity: 'warning', bvr_enabled: true, bvr_weight: 2, bvr_parametersjson: '{}', bvr_remediation: 'Re-own the flow to an application user / service principal governed by an application security role (e.g. "App-Membership"), not a named user.', bvr_description: 'Flows should run as application principals with a scoped application security role, never as a user principal.' },
      { bvr_code: 'NO_HARDCODED_ENV', bvr_name: 'No hard-coded environment values', bvr_category: 'Configuration', bvr_evaluator: 'noHardcodedEnv', bvr_severity: 'warning', bvr_enabled: true, bvr_weight: 1, bvr_parametersjson: '{"ignoreHostSubstrings":["schema.management.azure.com","schemas.microsoft.com","login.microsoftonline.com"],"guidCheck":true}', bvr_remediation: 'Move environment-specific URLs/IDs into the Flow Configuration table and load them at runtime, keyed by Environment / EnvironmentUrl.', bvr_description: 'Per-environment values must not be hard-coded; they belong in the Flow Configuration table.' },
      { bvr_code: 'AI_REVIEW', bvr_name: 'AI holistic review', bvr_category: 'General', bvr_evaluator: 'ai', bvr_severity: 'info', bvr_enabled: true, bvr_weight: 1, bvr_parametersjson: '{}', bvr_remediation: 'Review the AI observations and address any that apply.', bvr_description: 'Adds holistic judgement (intent, readability, edge cases) that deterministic rules cannot express. Requires the AI pass to be enabled.' },
    ];
    const found = await api('GET', `bvr_reviewstandards?$select=bvr_reviewstandardid&$filter=bvr_code eq '${standard.bvr_code}'`);
    let standardId;
    if (found.value && found.value.length) { standardId = found.value[0].bvr_reviewstandardid; console.log('  = standard exists'); }
    else {
      const r = await api('POST', 'bvr_reviewstandards', { bvr_name: standard.bvr_name, bvr_code: standard.bvr_code, bvr_version: standard.bvr_version, bvr_standardtext: standard.bvr_standardtext, bvr_isactive: true }, { Prefer: 'return=representation' });
      standardId = r.bvr_reviewstandardid; console.log('  + standard ' + standard.bvr_name);
    }
    for (const rule of rules) {
      const dup = await api('GET', `bvr_reviewrules?$select=bvr_reviewruleid&$filter=bvr_code eq '${rule.bvr_code}' and _bvr_standardid_value eq ${standardId}`);
      if (dup.value && dup.value.length) { console.log(`  = rule ${rule.bvr_code}`); continue; }
      await api('POST', 'bvr_reviewrules', {
        bvr_name: rule.bvr_name, bvr_code: rule.bvr_code, bvr_evaluator: rule.bvr_evaluator,
        bvr_category: CAT[rule.bvr_category] ?? null, bvr_severity: SEV[rule.bvr_severity] ?? null,
        bvr_enabled: rule.bvr_enabled, bvr_weight: rule.bvr_weight, bvr_parametersjson: rule.bvr_parametersjson,
        bvr_remediation: rule.bvr_remediation, bvr_description: rule.bvr_description,
        'bvr_standardid@odata.bind': `/bvr_reviewstandards(${standardId})`,
      });
      console.log(`  + rule ${rule.bvr_code}`);
    }
  }

  if (COL_FAIL.length) {
    console.error(`%c${COL_FAIL.length} column(s) FAILED — the app will error on these. Fix and re-run:`, 'color:#b32717;font-weight:bold');
    COL_FAIL.forEach((m) => console.error('   ! ' + m));
  } else {
    console.log('%cAll columns created (0 failures).', 'color:#1a7f37;font-weight:bold');
  }
  console.log('%cDone. ' + (SEED ? '' : 'Set window.EMBER_SEED = true and re-run to seed the default ruleset. ') + 'Add the tables to the Ember app in the maker portal.', 'color:#7a120c;font-weight:bold');
})().catch((e) => { console.error('FAILED:', e.message, e.body || ''); });
