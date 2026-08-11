/**
 * Tenant environment enumeration.
 *
 * The crawl tags every discovered flow with the environment it lives in
 * (`bvr_flowinventory.bvr_environment`), which is what the web resource's global
 * Environment filter lists. To crawl the whole tenant — and to know about
 * environments up front rather than only after a flow turns up in one — the
 * orchestrator calls the Power Platform (BAP) environments API:
 *
 *   GET https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/environments?api-version=2020-06-01
 *
 * {@link parseEnvironments} shapes that response into a stable list, and
 * {@link environmentLabel} is the exact string the crawl should write to
 * `bvr_environment` so the label matches across runs.
 */

/** A Power Platform environment, normalised from the BAP environments API. */
export interface PowerPlatformEnvironment {
  /** Stable environment id (the BAP `name`), e.g. a GUID or `Default-<tenant>`. */
  id: string;
  /** Friendly display name, e.g. "Contoso (default)". */
  displayName: string;
  /** Dataverse instance URL, when the environment has a database. */
  url?: string;
  /** SKU: Default | Production | Sandbox | Trial | Developer | Teams … */
  sku?: string;
  /** True for the tenant's default environment. */
  isDefault: boolean;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Normalise the BAP environments response into a stable list. Accepts the raw
 * `{ value: [...] }` envelope or an already-unwrapped array. Entries without a
 * resolvable id are skipped; the result is sorted by display name with the
 * default environment first.
 */
export function parseEnvironments(payload: unknown): PowerPlatformEnvironment[] {
  const root = asRecord(payload);
  const list = Array.isArray(payload) ? payload : Array.isArray(root.value) ? root.value : [];
  const out: PowerPlatformEnvironment[] = [];
  for (const raw of list) {
    const item = asRecord(raw);
    const props = asRecord(item.properties);
    // id: prefer `name`; else the last segment of the resource `id` path.
    let id = typeof item.name === 'string' ? item.name : '';
    if (!id && typeof item.id === 'string') id = item.id.split('/').filter(Boolean).pop() ?? '';
    if (!id) continue;
    const linked = asRecord(props.linkedEnvironmentMetadata);
    const displayName =
      (typeof props.displayName === 'string' && props.displayName) ||
      (typeof linked.friendlyName === 'string' && linked.friendlyName) ||
      id;
    const instanceUrl = typeof linked.instanceUrl === 'string' ? linked.instanceUrl.replace(/\/+$/, '') : undefined;
    out.push({
      id,
      displayName,
      url: instanceUrl || undefined,
      sku: typeof props.environmentSku === 'string' ? props.environmentSku : undefined,
      isDefault: props.isDefault === true,
    });
  }
  out.sort((a, b) => (a.isDefault === b.isDefault ? a.displayName.localeCompare(b.displayName) : a.isDefault ? -1 : 1));
  return out;
}

/** The label the crawl writes to `bvr_flowinventory.bvr_environment` for a flow. */
export function environmentLabel(env: PowerPlatformEnvironment): string {
  return env.displayName || env.id;
}
