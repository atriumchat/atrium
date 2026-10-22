import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstRun, jobFill, OWN_READY, ownOnDesktop, ownOnPhone, signInFlow } from '../src/index';

for (const [name, flow] of Object.entries({ ownOnPhone, ownOnDesktop, firstRun, signInFlow })) {
  test(`${name}: every step's part is a part, its fill on the scale, back leads to a step`, () => {
    const steps = Object.keys(flow.steps) as (keyof typeof flow.steps)[];
    for (const step of steps) {
      const spec = flow.steps[step] as { fill: number; part: string | null; back?: unknown };
      if (spec.part !== null) assert.ok((flow.parts as readonly string[]).includes(spec.part), `${step}: ${spec.part}`);
      assert.ok(spec.fill >= 0 && spec.fill < 1, `${step}: ${spec.fill}`);
      if (typeof spec.back === 'string') assert.ok(steps.includes(spec.back as never), `${step} → ${spec.back}`);
    }
  });
}

test('the phone: parts numbered in order, the way back as walked', () => {
  assert.deepEqual(ownOnPhone.stage('mail'), { part: 'address', n: 2, total: 5 });
  assert.deepEqual(ownOnPhone.stage('invite'), { part: 'friends', n: 5, total: 5 });
  assert.equal(ownOnPhone.back('mail', undefined), 'free');
  assert.equal(ownOnPhone.back('server', undefined), null);
  assert.equal(ownOnPhone.back('key', undefined), null);
});

test('the scale never goes back along the phone way forward', () => {
  const forward = ['server', 'address', 'free', 'mail', 'install', 'name', 'admin', 'key', 'invite'] as const;
  const fills = forward.map((s) => ownOnPhone.fill(s));
  assert.deepEqual([...fills].sort((a, b) => a - b), fills);
  assert.ok(ownOnPhone.fill('install') < OWN_READY && OWN_READY < ownOnPhone.fill('name'));
});

test('the web: back to the code only when it was asked', () => {
  assert.equal(firstRun.back('server', { askCode: true }), 'code');
  assert.equal(firstRun.back('server', { askCode: false }), null);
});

test('a long job fills its stretch of the scale', () => {
  assert.equal(jobFill(0.32, 0.68, 0, 11, false), 0.32);
  assert.ok(Math.abs(jobFill(0.32, 0.68, 11, 11, false) - 0.68) < 1e-9);
  assert.equal(jobFill(0.32, 0.68, 3, 11, true), 0.68);
  assert.equal(jobFill(0.32, 0.68, 99, 11, false), jobFill(0.32, 0.68, 11, 11, false));
});

test('getting in: only signing up is counted, back goes the way walked', () => {
  assert.equal(signInFlow.stage('login'), null);
  assert.deepEqual(signInFlow.stage('account'), { part: 'account', n: 2, total: 2 });
  assert.equal(signInFlow.back('recover', undefined), 'login');
  assert.equal(signInFlow.back('start', undefined), null);
  assert.ok(signInFlow.fill('invite') < signInFlow.fill('account'));
});

test('the desktop: three parts, the address second', () => {
  assert.deepEqual(ownOnDesktop.stage('free-mail'), { part: 'address', n: 2, total: 3 });
  assert.equal(ownOnDesktop.back('install', { way: 'free' }), null);
});
