import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store';
import { registerTools } from '../src/tools';
import { AUTOMATIC_CHECKS, PROPOSED_AUTOMATIC_CHECKS, RULE_ENFORCEMENT, RULE_GROUPS, WORKFLOW_RULES, GENERAL_RULES, instructionSize, instructions } from '../src/rules';

const toolNames = (() => {
  const names = new Set<string>();
  registerTools({ registerTool: (name: string) => names.add(name) } as any, { caller: { uid: 'u', email: 'u@example.com' }, store: new MemoryStore() });
  return names;
})();

const allRules = RULE_GROUPS.flatMap(g => g.rules);
/** Words that look like tool names: verb_noun with underscores. */
const TOOL_LIKE = /\b(?:add|check|set|list|get|create|update|remove|delete|rename|furnish|preview|import|flatten|transform|undo|draw|edit|follow)_[a-z_]+\b/g;

describe('the rules sent to Claude', () => {
  it('has unique ids and an enforcement label for every rule', () => {
    const ids = allRules.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(RULE_ENFORCEMENT[id], `${id} needs an entry in RULE_ENFORCEMENT`).toBeDefined();
    for (const id of Object.keys(RULE_ENFORCEMENT)) expect(ids, `${id} is labelled but is not a rule`).toContain(id);
  });

  it('only names tools that exist', () => {
    const text = [GENERAL_RULES, ...allRules.map(r => `${r.rule} ${r.why}`), ...AUTOMATIC_CHECKS.map(c => `${c.where} ${c.check}`)].join('\n');
    const named = new Set([...text.matchAll(TOOL_LIKE)].map(m => m[0]));
    for (const name of named) expect(toolNames.has(name), `"${name}" is named in the rules but is not a tool`).toBe(true);
  });

  it('keeps automatic and proposed check ids separate and unique', () => {
    const ids = [...AUTOMATIC_CHECKS, ...PROPOSED_AUTOMATIC_CHECKS].map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(AUTOMATIC_CHECKS.every(c => c.id.startsWith('C'))).toBe(true);
    expect(PROPOSED_AUTOMATIC_CHECKS.every(c => c.id.startsWith('P'))).toBe(true);
  });

  it('marks rules nothing checks as [unchecked] and sends only rule text, not reasons', () => {
    const sent = instructions();
    expect(sent).toMatch(/B13\. .*\[unchecked\]/);
    expect(sent).not.toMatch(/B9\. .*\[unchecked\]/);
    expect(sent).not.toContain(allRules.find(r => r.id === 'B9')!.why);
    for (const rule of WORKFLOW_RULES) expect(sent).toContain(`${rule.id}. ${rule.title}`);
  });

  it('is a size worth knowing, and well under a quarter of a typical context window', () => {
    const size = instructionSize();
    expect(size.sentChars).toBeLessThan(size.withReasonsChars);
    expect(size.approxTokensSent).toBeLessThan(12_000);
  });
});
