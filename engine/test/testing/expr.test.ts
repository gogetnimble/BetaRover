import { describe, it, expect } from 'vitest';
import { evaluateExpression, resolveValue, emptyContext } from '../../src/testing/index.js';

describe('WDL expression evaluator', () => {
  it('evaluates references and functions', () => {
    const ctx = emptyContext();
    ctx.variables.LogSource = 'Ember';
    ctx.trigger.body = { name: 'Ada' };
    ctx.outputs.Compose = { greeting: 'hi' };
    expect(evaluateExpression("variables('LogSource')", ctx)).toBe('Ember');
    expect(evaluateExpression("triggerBody()?['name']", ctx)).toBe('Ada');
    expect(evaluateExpression("outputs('Compose')?['greeting']", ctx)).toBe('hi');
    expect(evaluateExpression("concat('hi ', variables('LogSource'))", ctx)).toBe('hi Ember');
    expect(evaluateExpression('equals(1, 1)', ctx)).toBe(true);
    expect(evaluateExpression("if(greater(3,2), 'a', 'b')", ctx)).toBe('a');
    expect(evaluateExpression('length(createArray(1,2,3))', ctx)).toBe(3);
    expect(evaluateExpression("empty('')", ctx)).toBe(true);
  });

  it('resolves interpolation, whole-expression and escaped strings', () => {
    const ctx = emptyContext();
    ctx.variables.n = 'World';
    expect(resolveValue("Hello @{variables('n')}!", ctx)).toBe('Hello World!');
    expect(resolveValue("@variables('n')", ctx)).toBe('World');
    expect(resolveValue('@@literal', ctx)).toBe('@literal');
    expect(resolveValue('plain', ctx)).toBe('plain');
    expect(resolveValue(42, ctx)).toBe(42);
    // deep resolution of objects/arrays
    expect(resolveValue({ a: "@{variables('n')}", b: [1, '@variables(\'n\')'] }, ctx)).toEqual({ a: 'World', b: [1, 'World'] });
  });

  it('throws on unknown functions so a test surfaces them', () => {
    expect(() => evaluateExpression('bogus(1)', emptyContext())).toThrow(/Unsupported function/);
  });
});
