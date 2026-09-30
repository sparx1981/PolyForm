import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SDK_REFERENCE } from './sdkFullReference';

function sdkInterfaceSource(): string {
  const source = readFileSync(resolve(__dirname, '../../services/developerService.ts'), 'utf8');
  const start = source.indexOf('export interface SDK {');
  const end = source.indexOf('\n}\n\nexport class DeveloperSDK', start);
  if (start < 0 || end < 0) throw new Error('Could not locate SDK interface.');
  return source.slice(start, end + 2);
}

function declaredNamespaces(source: string): string[] {
  return [...source.matchAll(/^  ([A-Za-z][A-Za-z0-9]*): \{$/gm)].map(match => match[1]);
}

function declaredMethods(source: string, namespace: string | null): string[] {
  if (namespace === null) {
    const firstNamespace = source.search(/^  [A-Za-z][A-Za-z0-9]*: \{$/m);
    const core = firstNamespace >= 0 ? source.slice(0, firstNamespace) : source;
    return [...core.matchAll(/^  ([A-Za-z][A-Za-z0-9]*): \(/gm)].map(match => match[1]);
  }

  const marker = `  ${namespace}: {`;
  const start = source.indexOf(marker);
  if (start < 0) return [];
  let depth = 0;
  let bodyStart = -1;
  for (let i = start + marker.length - 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      depth++;
      if (bodyStart < 0) bodyStart = i + 1;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && bodyStart >= 0) {
        const body = source.slice(bodyStart, i);
        return [...body.matchAll(/^    ([A-Za-z][A-Za-z0-9]*): \(/gm)].map(match => match[1]);
      }
    }
  }
  return [];
}

describe('SDK documentation parity', () => {
  const source = sdkInterfaceSource();
  const docs = new Map(SDK_REFERENCE.map(tag => [tag.id, tag.methods.map(method => method.name)]));

  it('documents every SDK namespace', () => {
    expect([...docs.keys()].sort()).toEqual(['core', ...declaredNamespaces(source)].sort());
  });

  it('documents every declared SDK method without stale extras', () => {
    const groups = ['core', ...declaredNamespaces(source)];
    for (const group of groups) {
      const actual = declaredMethods(source, group === 'core' ? null : group).sort();
      const documented = [...(docs.get(group) ?? [])].sort();
      expect(documented, `SDK docs drifted for ${group}`).toEqual(actual);
    }
  });
});
