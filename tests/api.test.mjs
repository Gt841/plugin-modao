import test from 'node:test';
import assert from 'node:assert/strict';
import { ModaoApi } from '../src/lib/api.ts';

// Hand-written contract fixtures based on public client code, not live account captures.
function transport(responses) {
  const calls = [];
  return { calls, get: async path => { calls.push(path); if (!(path in responses)) throw new Error(`Unexpected request: ${path}`); const value = responses[path]; if (value instanceof Error) throw value; return value; } };
}
test('loads organizations, spaces and directory using observed route parameters', async () => {
  const source = transport({
    '/api/dashboard/v5/users/detail': { user: { cid: 'u1' } },
    '/api/dashboard/v6/orgs': { orgs: [{ cid: 'o1', name: '组织' }] },
    '/api/dsh2/web_v1/org_entry/o1': { org: {cid:'o1',name:'组织'}, spaces: [{cid:'s1',name:'产品'}] },
    '/api/dsh2/web_v1/space_entry/s1?org=o1': { space: {cid:'s1',name:'产品'}, teams: [{cid:'f1',name:'目录',root_project:true}], projects: [{cid:'p1',name:'首页',type:'proto2',team_cid:'f1'}] },
  });
  const api = new ModaoApi(source);
  await api.checkLogin();
  assert.deepEqual(await api.organizations(), [{cid:'o1',name:'组织'}]);
  assert.deepEqual(await api.spaces('o1'), [{cid:'s1',name:'产品'}]);
  const contents = await api.contents({orgCid:'o1', spaceCid:'s1'});
  assert.deepEqual(contents.projects, [{cid:'p1',name:'首页',type:'proto2',team_cid:'f1'}]);
  assert.deepEqual(source.calls, ['/api/dashboard/v5/users/detail','/api/dashboard/v6/orgs','/api/dsh2/web_v1/org_entry/o1','/api/dsh2/web_v1/space_entry/s1?org=o1']);
});
test('personal files use me endpoint and empty arrays are legitimate', async () => {
  const source = transport({'/api/dashboard/v5/me': {teams:[],projects:[]}});
  assert.deepEqual(await new ModaoApi(source).contents(), {folders:[],projects:[],limited:false});
  assert.deepEqual(source.calls, ['/api/dashboard/v5/me']);
});
test('rejects missing arrays and malformed items instead of reporting empty success', async () => {
  for (const data of [{}, {teams:null,projects:[]}, {teams:[],projects:[{cid:'p1',name:'N'}]}, {teams:[{cid:'../bad',name:'X'}],projects:[]}]) {
    const api = new ModaoApi(transport({'/api/dashboard/v5/me':data}));
    await assert.rejects(api.contents(), e => e.kind === 'schema');
  }
  const api = new ModaoApi(transport({'/api/dashboard/v5/users/detail':{user:{}}}));
  await assert.rejects(api.checkLogin(), e => e.kind === 'authentication');
});
test('pagination hints are surfaced rather than silently claiming a full list', async () => {
  const api = new ModaoApi(transport({'/api/dashboard/v5/me': {teams:[],projects:[],has_more:true,next_page:2}}));
  assert.equal((await api.contents()).limited, true);
});
test('permission errors are propagated without probing alternative routes', async () => {
  const forbidden = Object.assign(new Error('denied'), {kind:'forbidden'});
  const source = transport({'/api/dashboard/v5/me':forbidden});
  await assert.rejects(new ModaoApi(source).contents(), e => e === forbidden);
  assert.deepEqual(source.calls, ['/api/dashboard/v5/me']);
});
test('malicious organization or incomplete space context never reaches transport', async () => {
  const source = transport({}); const api = new ModaoApi(source);
  await assert.rejects(api.spaces('../other'));
  await assert.rejects(api.contents({spaceCid:'s1',orgCid:''}));
  assert.deepEqual(source.calls, []);
});
