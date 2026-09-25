import type { Hunk } from './reviewTypes';

export type CssRuleChange = { selector: string; kind: 'added' | 'removed' | 'changed'; before: string[]; after: string[] };

function rules(source: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  // A compact rule is common in generated CSS. Keep parsing deliberately
  // conservative: nested blocks, comments and complex values remain in Raw diff.
  const pattern = /([^{};]+?)\s*\{([^{}]*)\}/g;
  for (const match of source.matchAll(pattern)) {
    const selector = match[1]!.trim();
    if (!selector || selector.startsWith('@')) continue;
    const declarations = match[2]!.split(';').map(value => value.trim()).filter(Boolean);
    result.set(selector, declarations);
  }
  return result;
}

export function cssRuleChanges(hunks: Hunk[]): CssRuleChange[] {
  const changes = new Map<string, CssRuleChange>();
  for (const hunk of hunks) {
    const before = rules(hunk.lines.filter(line => line.kind !== 'add').map(line => line.text).join('\n'));
    const after = rules(hunk.lines.filter(line => line.kind !== 'delete').map(line => line.text).join('\n'));
    for (const selector of new Set([...before.keys(), ...after.keys()])) {
      const oldValues = before.get(selector) ?? [];
      const newValues = after.get(selector) ?? [];
      if (JSON.stringify(oldValues) === JSON.stringify(newValues)) continue;
      changes.set(selector, { selector, kind: !before.has(selector) ? 'added' : !after.has(selector) ? 'removed' : 'changed', before: oldValues, after: newValues });
    }
  }
  return [...changes.values()];
}
