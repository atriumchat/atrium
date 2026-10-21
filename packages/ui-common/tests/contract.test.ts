import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { flowParts } from '../src/index';

// Each implementation's `parts` object is checked against FlowParts by its own typecheck (props); this checks that
// what an app can import by name is the whole contract on both platforms.
const exported = (pkg: string) => {
  const index = readFileSync(new URL(`../../${pkg}/src/index.ts`, import.meta.url), 'utf8');
  return new Set([...index.matchAll(/export \{([^}]+)\}/g)].flatMap((m) => m[1]!.split(',').map((name) => name.trim().split(/\s+as\s+/).pop()!)));
};

for (const pkg of ['ui-web', 'ui-native']) {
  test(`${pkg} exports every flow part`, () => {
    const names = exported(pkg);
    assert.deepEqual(flowParts.filter((part) => !names.has(part)), []);
    assert.ok(names.has('parts'), 'the checked parts object');
  });
}
