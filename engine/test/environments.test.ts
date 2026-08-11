import { describe, it, expect } from 'vitest';
import { parseEnvironments, environmentLabel } from '../src/index.js';

// A trimmed BAP /environments response (two environments, one default).
const BAP = {
  value: [
    {
      id: '/providers/Microsoft.BusinessAppPlatform/environments/11111111-1111-1111-1111-111111111111',
      name: '11111111-1111-1111-1111-111111111111',
      type: 'Microsoft.BusinessAppPlatform/environments',
      properties: {
        displayName: 'Contoso (default)',
        isDefault: true,
        environmentSku: 'Default',
        linkedEnvironmentMetadata: { instanceUrl: 'https://contoso.crm.dynamics.com/', friendlyName: 'Contoso' },
      },
    },
    {
      id: '/providers/Microsoft.BusinessAppPlatform/environments/22222222-2222-2222-2222-222222222222',
      name: '22222222-2222-2222-2222-222222222222',
      properties: {
        displayName: 'Contoso — UAT',
        isDefault: false,
        environmentSku: 'Sandbox',
        linkedEnvironmentMetadata: { instanceUrl: 'https://contoso-uat.crm.dynamics.com' },
      },
    },
  ],
};

describe('parseEnvironments', () => {
  it('normalises the BAP envelope, default first', () => {
    const envs = parseEnvironments(BAP);
    expect(envs.map((e) => e.displayName)).toEqual(['Contoso (default)', 'Contoso — UAT']);
    expect(envs[0]).toMatchObject({ id: '11111111-1111-1111-1111-111111111111', isDefault: true, sku: 'Default', url: 'https://contoso.crm.dynamics.com' });
    expect(envs[1].url).toBe('https://contoso-uat.crm.dynamics.com'); // trailing slash tolerated / absent
  });

  it('accepts an already-unwrapped array and skips id-less entries', () => {
    const envs = parseEnvironments([{ properties: { displayName: 'no id' } }, BAP.value[1]]);
    expect(envs).toHaveLength(1);
    expect(envs[0].id).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('falls back to the id path segment and then the id for the label', () => {
    const envs = parseEnvironments([{ id: '/providers/x/environments/abc', properties: {} }]);
    expect(envs[0].id).toBe('abc');
    expect(environmentLabel(envs[0])).toBe('abc');
  });

  it('returns [] for junk input', () => {
    expect(parseEnvironments(null)).toEqual([]);
    expect(parseEnvironments({ nope: 1 })).toEqual([]);
  });
});
