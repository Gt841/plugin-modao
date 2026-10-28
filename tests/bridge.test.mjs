import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SessionBridge, requestScript, writeScript, allowedPath, BridgeError } from '../src/lib/bridge.ts';

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
function runWrite(request, response, fetchOverride) {
  return vm.runInNewContext(writeScript(request), {
    location: { origin: 'https://modao.cc' },
    fetch: fetchOverride || (async () => response), AbortController, setTimeout, clearTimeout,
  });
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
test('writeScript creates only prototypes and designs through the verified internal routes', async () => {
  const seen = [];
  const capture = async (path, options) => { seen.push({ path, options }); return jsonResponse({ clientData: { projectUpper: { cid: 'new' } }, token: 'secret' }); };
  assert.deepEqual(JSON.parse(JSON.stringify(await runWrite({ kind: 'create', type: 'proto2', teamCid: 'f1', name: '新原型' }, null, capture))), { status: 200 });
  assert.equal(seen[0].path, '/flpak/w-paknew?upperType=project-basic&type=proto2&teamCid=f1');
  assert.equal(seen[0].options.method, 'POST');
  assert.equal(seen[0].options.credentials, 'same-origin');
  assert.equal(seen[0].options.redirect, 'error');
  assert.match(seen[0].options.headers['content-type'], /^application\/json/);
  assert.deepEqual(JSON.parse(seen[0].options.body), { name: '新原型', device: 'iphone', model: 'iPhoneX', width: 375, height: 812 });

  assert.deepEqual(JSON.parse(JSON.stringify(await runWrite({ kind: 'create', type: 'design2', teamCid: 'f1', name: '新设计' }, null, capture))), { status: 200 });
  assert.equal(seen[1].path, '/api/design/web_v1/create_design_project?teamCid=f1');
  assert.equal(seen[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(seen[1].options.body), { newOpt: { name: '新设计' } });
});

test('writeScript renames projects and folders with partial update bodies', async () => {
  const seen = [];
  const capture = async (path, options) => { seen.push({ path, options }); return jsonResponse({ project: { cid: 'p1' }, team: { cid: 'f1' } }); };
  await runWrite({ kind: 'rename', target: 'project', cid: 'p1', name: '改名' }, null, capture);
  await runWrite({ kind: 'rename', target: 'team', cid: 'f1', name: '新目录' }, null, capture);
  assert.equal(seen[0].path, '/api/dashboard/v5/projects/p1');
  assert.equal(seen[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(seen[0].options.body), { project: { cid: 'p1', name: '改名' } });
  assert.equal(seen[1].path, '/api/dashboard/v5/teams/f1');
  assert.equal(seen[1].options.method, 'PUT');
  assert.deepEqual(JSON.parse(seen[1].options.body), { team: { name: '新目录' } });
});

test('writeScript fails closed on unsupported types, malicious CIDs and invalid names', () => {
  for (const request of [
    { kind: 'create', type: 'bomx2', teamCid: 'f1', name: '白板' },
    { kind: 'create', type: 'proto2', teamCid: '../f1', name: '原型' },
    { kind: 'create', type: 'design2', teamCid: 'f1', name: '' },
    { kind: 'create', type: 'design2', teamCid: 'f1', name: 'a\nb' },
    { kind: 'rename', target: 'project', cid: '../p1', name: '改名' },
    { kind: 'rename', target: 'team', cid: 'f1', name: '   ' },
    { kind: 'rename', target: 'other', cid: 'f1', name: '改名' },
  ]) {
    assert.throws(() => writeScript(request), e => e instanceof BridgeError && e.kind === 'invalid');
  }
  assert.equal(allowedPath('/api/dashboard/v5/projects/p1'), false, 'write routes must never be GET-readable');
  assert.equal(allowedPath('/flpak/w-paknew?upperType=project-basic&type=proto2&teamCid=f1'), false);
});

test('bridge.write maps write failures and never returns response bodies', async () => {
  const bridge = new SessionBridge();
  const page = { getURL: () => 'https://modao.cc/workspace/home', executeJavaScript: async () => ({ status: 200 }) };
  bridge.attach(page);
  assert.equal(await bridge.write({ kind: 'rename', target: 'team', cid: 'f1', name: '改名' }), undefined);
  for (const [status, kind] of [[400, 'rejected'], [401, 'authentication'], [403, 'forbidden'], [404, 'not-found'], [409, 'conflict'], [500, 'http']]) {
    page.executeJavaScript = async () => ({ status, data: { token: 'secret' } });
    await assert.rejects(bridge.write({ kind: 'rename', target: 'project', cid: 'p1', name: '改名' }), e => e.kind === kind && e.status === status, String(status));
  }
  page.executeJavaScript = async () => ({ data: { token: 'secret' } });
  await assert.rejects(bridge.write({ kind: 'rename', target: 'project', cid: 'p1', name: '改名' }), e => e.kind === 'schema');
  page.executeJavaScript = async () => ({ error: 'network' });
  await assert.rejects(bridge.write({ kind: 'rename', target: 'project', cid: 'p1', name: '改名' }), e => e.kind === 'network');
});

test('bridge.write requires a ready same-origin page and cancels stale writes', async () => {
  const bridge = new SessionBridge();
  await assert.rejects(bridge.write({ kind: 'rename', target: 'team', cid: 'f1', name: '改名' }), e => e.kind === 'not-ready');
  let release;
  const page = { getURL: () => 'https://modao.cc/workspace/home', executeJavaScript: async () => new Promise(resolve => { release = resolve; }) };
  bridge.attach(page);
  const pending = bridge.write({ kind: 'rename', target: 'team', cid: 'f1', name: '改名' });
  bridge.detach(page);
  release({ status: 200 });
  await assert.rejects(pending, e => e.kind === 'cancelled');
  page.getURL = () => 'https://evil.test/workspace/home'; bridge.attach(page);
  await assert.rejects(bridge.write({ kind: 'rename', target: 'team', cid: 'f1', name: '改名' }), e => e.kind === 'authentication');
});

test('bridge classifies HTTP status and releases resources on disposal', async () => {
  const bridge = new SessionBridge();
  const page = { getURL: () => 'https://modao.cc/workspace/home', executeJavaScript: async () => ({status: 403}) };
  bridge.attach(page);
  await assert.rejects(bridge.get(userPath), e => e.kind === 'forbidden' && e.status === 403);
  bridge.dispose(); bridge.attach(page);
  await assert.rejects(bridge.get(userPath), e => e.kind === 'cancelled');
});
