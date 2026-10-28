import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SessionBridge, requestScript, allowedPath, BridgeError } from '../src/lib/bridge.ts';

const userPath = '/api/dashboard/v5/users/detail';
// Synthetic fixtures: these are not captured account responses.
const project = { cid: 'p1', name: '文件', type: 'proto2', team_cid: 'f1', access_token: 'must-not-leave-webview' };
function runScript(path, response, fetchOverride) {
  return vm.runInNewContext(requestScript(path), {
    location: { origin: 'https://modao.cc' },
    fetch: fetchOverride || (async () => response), AbortController, setTimeout, clearTimeout,
  });
}
function jsonResponse(body, status = 200) {
  return { status, ok: status >= 200 && status < 300, redirected: false,
    url: 'https://modao.cc/api/example', headers: { get: () => 'application/json' }, json: async () => body };
}
test('only explicitly known read endpoints and exact query keys are allowed', () => {
  for (const path of [userPath, '/api/dashboard/v5/me', '/api/dashboard/v6/orgs',
    '/api/dsh2/web_v1/org_entry/o1', '/api/dsh2/web_v1/space_entry/s1?org=o1']) assert.equal(allowedPath(path), true);
  for (const path of ['https://evil.test/api/dashboard/v5/me', '//evil.test', '/api/dashboard/v5/projects/p1',
    '/api/dashboard/v5/me?token=x', '/api/dsh2/web_v1/space_entry/s?org=o&extra=1',
    '/api/dsh2/web_v1/space_entry/../me?org=o', '/api/dsh2/web_v1/org_entry/%2fother']) {
    assert.equal(allowedPath(path), false, path);
    assert.throws(() => requestScript(path));
  }
});
test('same-origin GET passes only required directory fields across the webview boundary', async () => {
  const result = await runScript('/api/dashboard/v5/me', null, async (path, options) => {
    assert.equal(path, '/api/dashboard/v5/me');
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    return jsonResponse({ teams: [{ cid: 'f1', name: '目录', root_project: true, secret: 'x' }], projects: [project], token: 'x' });
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 200, data: {
    teams: [{ cid: 'f1', name: '目录', root_project: true }],
    projects: [{ cid: 'p1', name: '文件', type: 'proto2', team_cid: 'f1' }],
  } });
});
test('user projection excludes email and login credentials', async () => {
  const result = await runScript(userPath, jsonResponse({ user: { cid: 'u1', email: 'private', token: 'secret' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 200, data: { user: { cid: 'u1' } } });
});
test('HTTP failures never expose backend response bodies', async () => {
  const result = await runScript(userPath, jsonResponse({ token: 'secret' }, 401));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 401 });
});
test('HTML login and malformed JSON remain explicit errors rather than empty directories', async () => {
  const html = jsonResponse({}); html.headers.get = () => 'text/html';
  assert.equal((await runScript(userPath, html)).error, 'authentication');
  const broken = jsonResponse({}); broken.json = async () => { throw new Error('secret body'); };
  assert.equal((await runScript(userPath, broken)).error, 'schema');
});
test('bridge refuses requests without a ready same-origin page and rejects stale results', async () => {
  const bridge = new SessionBridge();
  await assert.rejects(bridge.get(userPath), e => e instanceof BridgeError && e.kind === 'not-ready');
  let release; let calls = 0;
  const page = { getURL: () => 'https://modao.cc/workspace/home', executeJavaScript: async () => { calls++; return new Promise(r => { release = r; }); } };
  bridge.attach(page);
  const pending = bridge.get(userPath);
  bridge.detach(page);
  release({ status: 200, data: { user: { cid: 'old' } } });
  await assert.rejects(pending, e => e.kind === 'cancelled');
  page.getURL = () => 'https://evil.test/workspace/home'; bridge.attach(page);
  await assert.rejects(bridge.get(userPath), e => e.kind === 'authentication');
  assert.equal(calls, 1);
});
test('bridge classifies HTTP status and releases resources on disposal', async () => {
  const bridge = new SessionBridge();
  const page = { getURL: () => 'https://modao.cc/workspace/home', executeJavaScript: async () => ({status: 403}) };
  bridge.attach(page);
  await assert.rejects(bridge.get(userPath), e => e.kind === 'forbidden' && e.status === 403);
  bridge.dispose(); bridge.attach(page);
  await assert.rejects(bridge.get(userPath), e => e.kind === 'cancelled');
});
