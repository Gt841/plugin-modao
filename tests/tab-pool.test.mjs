import test from 'node:test';
import assert from 'node:assert/strict';
import { TabPool } from '../src/lib/tab-pool.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const requests = [];
  const focused = [];
  const pool = new TabPool(key => {
    const request = { key, ...deferred() };
    requests.push(request);
    return request.promise;
  }, tab => tab.alive, tab => focused.push(tab));
  return { pool, requests, focused };
}

test('rapid clicks share exactly one pending create and the same result', async () => {
  const { pool, requests } = fixture();
  const clicks = Array.from({ length: 25 }, () => pool.open('same'));
  for (const promise of clicks) assert.equal(promise, clicks[0]);
  await Promise.resolve();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].key, 'same');
  const tab = { id: 'one', alive: true };
  requests[0].resolve(tab);
  for (const result of await Promise.all(clicks)) assert.equal(result, tab);
});

test('opening an already live tab focuses and returns it without creating again', async () => {
  const { pool, requests, focused } = fixture();
  const initial = pool.open('same');
  await Promise.resolve();
  const tab = { alive: true };
  requests[0].resolve(tab);
  await initial;
  assert.equal(await pool.open('same'), tab);
  assert.equal(await pool.open('same'), tab);
  assert.deepEqual(focused, [tab, tab]);
  assert.equal(requests.length, 1);
});

test('dead tabs can be reopened repeatedly and every replacement stays deduplicated', async () => {
  const { pool, requests, focused } = fixture();
  const firstOpen = pool.open('same');
  await Promise.resolve();
  const first = { id: 'first', alive: true };
  requests[0].resolve(first);
  await firstOpen;
  first.alive = false;

  const secondOpen = pool.open('same');
  assert.equal(pool.open('same'), secondOpen);
  await Promise.resolve();
  assert.equal(requests.length, 2);
  const second = { id: 'second', alive: true };
  requests[1].resolve(second);
  assert.equal(await secondOpen, second);
  assert.equal(await pool.open('same'), second);
  assert.deepEqual(focused, [second]);
  second.alive = false;

  const thirdOpen = pool.open('same');
  assert.equal(pool.open('same'), thirdOpen);
  await Promise.resolve();
  assert.equal(requests.length, 3);
  const third = { id: 'third', alive: true };
  requests[2].resolve(third);
  assert.equal(await thirdOpen, third);
  assert.equal(await pool.open('same'), third);
  assert.deepEqual(focused, [second, third]);
  assert.equal(requests.length, 3);
});

test('create rejection is shared, releases the key, and permits a cached retry', async () => {
  const { pool, requests } = fixture();
  const first = pool.open('same');
  const second = pool.open('same');
  assert.equal(first, second);
  const error = new Error('create failed');
  const rejected = Promise.all([
    assert.rejects(first, value => value === error),
    assert.rejects(second, value => value === error),
  ]);
  await Promise.resolve();
  requests[0].reject(error);
  await rejected;

  const retry = pool.open('same');
  assert.equal(pool.open('same'), retry);
  await Promise.resolve();
  assert.equal(requests.length, 2);
  const tab = { alive: true };
  requests[1].resolve(tab);
  assert.equal(await retry, tab);
  assert.equal(await pool.open('same'), tab);
  assert.equal(requests.length, 2);
});

test('synchronous create errors also reject and allow retry', async () => {
  let calls = 0;
  const tab = { alive: true };
  const pool = new TabPool(() => {
    calls += 1;
    if (calls === 1) throw new Error('synchronous failure');
    return Promise.resolve(tab);
  }, () => true, () => {});
  await assert.rejects(pool.open('same'), /synchronous failure/);
  assert.equal(await pool.open('same'), tab);
  assert.equal(calls, 2);
});

test('a stale destroy cannot forget either a pending or settled replacement', async () => {
  const { pool, requests } = fixture();
  const initial = pool.open('same');
  await Promise.resolve();
  const old = { alive: true };
  requests[0].resolve(old);
  await initial;
  old.alive = false;

  const replacement = pool.open('same');
  pool.forget('same', old);
  assert.equal(pool.open('same'), replacement);
  await Promise.resolve();
  const current = { alive: true };
  requests[1].resolve(current);
  await replacement;
  pool.forget('same', old);
  pool.forget('same', { alive: true });
  pool.forget('absent', current);
  assert.equal(await pool.open('same'), current);
  assert.equal(requests.length, 2);
});

test('forget deletes only the matching instance under its own key', async () => {
  const { pool, requests } = fixture();
  const first = pool.open('a');
  const other = pool.open('b');
  await Promise.resolve();
  const tabA = { alive: true };
  const tabB = { alive: true };
  requests[0].resolve(tabA);
  requests[1].resolve(tabB);
  await Promise.all([first, other]);
  pool.forget('a', tabB);
  assert.equal(await pool.open('a'), tabA);
  pool.forget('a', tabA);
  const replacement = pool.open('a');
  await Promise.resolve();
  assert.equal(requests.length, 3);
  assert.equal(await pool.open('b'), tabB);
  const newTab = { alive: true };
  requests[2].resolve(newTab);
  assert.equal(await replacement, newTab);
});

test('different keys create independently even if results arrive out of order', async () => {
  const { pool, requests } = fixture();
  const first = pool.open('a');
  const second = pool.open('b');
  await Promise.resolve();
  assert.deepEqual(requests.map(request => request.key), ['a', 'b']);
  const tabB = { id: 'b', alive: true };
  requests[1].resolve(tabB);
  assert.equal(await second, tabB);
  const tabA = { id: 'a', alive: true };
  requests[0].resolve(tabA);
  assert.equal(await first, tabA);
  assert.equal(await pool.open('a'), tabA);
  assert.equal(await pool.open('b'), tabB);
});

test('clear evicts all live tabs', async () => {
  let count = 0;
  const pool = new TabPool(async key => ({ key, id: ++count }), () => true, () => {});
  const oldA = await pool.open('a');
  const oldB = await pool.open('b');
  pool.clear();
  assert.notEqual(await pool.open('a'), oldA);
  assert.notEqual(await pool.open('b'), oldB);
  assert.equal(count, 4);
});

test('clear prevents a late result from repopulating an empty cache', async () => {
  const { pool, requests } = fixture();
  const initial = pool.open('same');
  await Promise.resolve();
  pool.clear();
  const late = { alive: true };
  requests[0].resolve(late);
  assert.equal(await initial, late);
  const fresh = pool.open('same');
  await Promise.resolve();
  assert.equal(requests.length, 2);
  const current = { alive: true };
  requests[1].resolve(current);
  assert.equal(await fresh, current);
});

test('clear prevents an old late success from overwriting a new cached tab', async () => {
  const { pool, requests } = fixture();
  const old = pool.open('same');
  await Promise.resolve();
  pool.clear();
  const fresh = pool.open('same');
  assert.notEqual(old, fresh);
  await Promise.resolve();
  const current = { alive: true };
  requests[1].resolve(current);
  await fresh;
  requests[0].resolve({ alive: true });
  await old;
  assert.equal(await pool.open('same'), current);
  assert.equal(requests.length, 2);
});

test('an old late rejection after clear cannot evict a new in-flight create', async () => {
  const { pool, requests } = fixture();
  const old = pool.open('same');
  const rejected = assert.rejects(old, /late failure/);
  await Promise.resolve();
  pool.clear();
  const fresh = pool.open('same');
  await Promise.resolve();
  requests[0].reject(new Error('late failure'));
  await rejected;
  assert.equal(pool.open('same'), fresh);
  assert.equal(requests.length, 2);
  const current = { alive: true };
  requests[1].resolve(current);
  assert.equal(await fresh, current);
  assert.equal(await pool.open('same'), current);
});

test('generic falsy values remain cacheable and forgettable', async () => {
  for (const tab of [0, false, undefined, null]) {
    let count = 0;
    const focused = [];
    const pool = new TabPool(async () => { count += 1; return tab; }, () => true, value => focused.push(value));
    assert.equal(await pool.open('same'), tab);
    assert.equal(await pool.open('same'), tab);
    assert.equal(count, 1);
    assert.deepEqual(focused, [tab]);
    pool.forget('same', tab);
    assert.equal(await pool.open('same'), tab);
    assert.equal(count, 2);
  }
});
