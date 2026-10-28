import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validCid, editorUrl, safeViewUrl, buildTree,
} from '../src/lib/model.ts';

function flatten(nodes) {
  const result = [];
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.pop();
    result.push(node);
    pending.push(...node.children);
  }
  return result;
}

test('CID accepts only 1–128 ASCII letters, digits, underscore and hyphen', () => {
  for (const value of ['a', '0', '_', '-', 'AbC_019-x', 'a'.repeat(128)]) {
    assert.equal(validCid(value), true, String(value));
  }
  for (const value of [
    undefined, null, 1, true, {}, [], new String('abc'), '', 'a'.repeat(129),
    '汉字', 'é', 'Ａ', '.', '..', 'a/b', 'a\\b', 'a b', 'a:b', 'a%2Fb',
    'a?', 'a#', 'a\n', 'a\r', '\ta', 'a\0',
  ]) {
    assert.equal(validCid(value), false, String(value));
  }
});

for (const [type, expected] of [
  ['proto2', 'https://modao.cc/proto/design/Ab_09-x'],
  ['prototype', 'https://modao.cc/app/design/Ab_09-x'],
  ['design2', 'https://modao.cc/design/editor/Ab_09-x'],
]) {
  test(`editorUrl uses the verified literal ${type} route`, () => {
    assert.equal(editorUrl(type, 'Ab_09-x'), expected);
  });
}

test('editorUrl rejects invalid CID and never guesses unknown project types', () => {
  for (const type of ['proto', 'design', '', 'PROTO2', '__proto__', 'constructor', 'toString']) {
    assert.equal(editorUrl(type, 'abc'), null, type);
  }
  for (const cid of ['', '../abc', 'a/b', 'a%2Fb', 'a\n', 'a'.repeat(129), null]) {
    for (const type of ['proto2', 'prototype', 'design2']) {
      assert.equal(editorUrl(type, cid), null, `${type}: ${cid}`);
    }
  }
});

test('safeViewUrl accepts only workspace and verified editor routes', () => {
  for (const url of [
    'https://modao.cc/workspace/home',
    'https://modao.cc/workspace/home/',
    'https://modao.cc:443/workspace/home',
    'https://modao.cc/proto/design/Ab_09-x',
    'https://modao.cc/app/design/Ab_09-x',
    'https://modao.cc/design/editor/Ab_09-x',
    'https://modao.cc:443/design/editor/abc',
  ]) {
    assert.equal(safeViewUrl(url), true, url);
  }
});

test('safeViewUrl rejects malicious URLs before browser normalization', () => {
  for (const url of [
    undefined, null, {}, 42, new URL('https://modao.cc/workspace/home'),
    '', '/workspace/home', '//modao.cc/workspace/home',
    'javascript:alert(1)', 'data:text/html,hello', 'http://modao.cc/workspace/home',
    'https://evil.test/workspace/home', 'https://modao.cc.evil.test/workspace/home',
    'https://sub.modao.cc/workspace/home', 'https://modao.cc./workspace/home',
    'https://modao.cc@evil.test/workspace/home',
    'https://evil.test@modao.cc/workspace/home',
    'https://user:password@modao.cc/workspace/home', 'https://@modao.cc/workspace/home',
    'https://modao.cc:80/workspace/home', 'https://modao.cc:444/workspace/home',
    'https://modao.cc/workspace/home?redirect=https://evil.test',
    'https://modao.cc/workspace/home?', 'https://modao.cc/workspace/home#',
    'https://modao.cc/workspace/home/#abc',
    'https://modao.cc/design/editor/abc?x=1', 'https://modao.cc/app/design/abc#x',
    'https://modao.cc/', 'https://modao.cc/workspace', 'https://modao.cc/workspace/home/extra',
    'https://modao.cc/PROTO/design/abc', 'https://modao.cc/proto/editor/abc',
    'https://modao.cc/app/design/', 'https://modao.cc/design/editor/abc/',
    'https://modao.cc/design/editor/a.b', 'https://modao.cc/design/editor/汉字',
    'https://modao.cc/design/editor/' + 'a'.repeat(129),
    'https://modao.cc/x/../workspace/home', 'https://modao.cc/./workspace/home',
    'https://modao.cc/%2e/workspace/home', 'https://modao.cc/x/%2e%2e/workspace/home',
    'https://modao.cc/design/editor/../editor/abc',
    'https://modao.cc/design/editor/%2e%2e/editor/abc',
    'https://modao.cc/design/editor/a%2fb', 'https://modao.cc/design/editor/a%2Fb',
    'https://modao.cc/design/editor/a%5Cb', 'https://modao.cc/design/editor/a%252fb',
    'https://modao.cc/design%2Feditor/abc', 'https://modao.cc/design/editor/%61bc',
    'https://modao.cc\\workspace\\home', 'https://modao.cc//workspace/home',
    'https:////modao.cc/workspace/home', ' https://modao.cc/workspace/home',
    'https://modao.cc/workspace/home\n', 'https://mo\tdao.cc/workspace/home',
    'https://modao.cc/design/editor/ab\nc', 'https://modao.cc/workspace/home\0',
  ]) {
    assert.equal(safeViewUrl(url), false, String(url));
  }
});

test('empty real data produces an empty tree', () => {
  assert.deepEqual(buildTree('team', [], []), []);
});

test('virtual project roots disappear, promoting children while retaining nesting and names', () => {
  const tree = buildTree('team', [
    { cid: 'root', name: '虚拟根', root_project: true },
    { cid: 'nested', name: ' 二级 / 原名 ', parent_cid: 'folder' },
    { cid: 'folder', name: '目录', parent_cid: 'root' },
  ], [
    { cid: 'direct', name: '首页', type: 'proto2', team_cid: 'root' },
    { cid: 'deep', name: '<原始名称>', type: 'design2', team_cid: 'nested' },
  ]);
  assert.deepEqual(tree, [
    {
      key: '["team","folder","folder"]', cid: 'folder', name: '目录', kind: 'folder',
      children: [{
        key: '["team","folder","nested"]', cid: 'nested', name: ' 二级 / 原名 ', kind: 'folder',
        children: [{
          key: '["team","file","deep"]', cid: 'deep', name: '<原始名称>', kind: 'file',
          fileType: 'design2', children: [],
        }],
      }],
    },
    {
      key: '["team","file","direct"]', cid: 'direct', name: '首页', kind: 'file',
      fileType: 'proto2', children: [],
    },
  ]);
});

test('a nested virtual root promotes children to its nearest visible ancestor', () => {
  const tree = buildTree('s', [
    { cid: 'outer', name: 'Outer' },
    { cid: 'hidden', name: 'Hidden', root_project: true, parent_cid: 'outer' },
    { cid: 'inner', name: 'Inner', parent_cid: 'hidden' },
  ], [{ cid: 'p', name: 'Project', type: 'prototype', team_cid: 'hidden' }]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].cid, 'outer');
  assert.deepEqual(tree[0].children.map(node => `${node.kind}:${node.cid}`), ['folder:inner', 'file:p']);
  assert.equal(flatten(tree).length, 3);
});

test('rootless data attaches by parent_cid and team_cid, sorting folders before files', () => {
  const tree = buildTree('s', [
    { cid: 'z', name: 'Zulu', parent_cid: null },
    { cid: 'b', name: 'Beta', parent_cid: 'a' },
    { cid: 'a', name: 'Alpha' },
  ], [
    { cid: 'top', name: 'Aardvark', type: 'unknown' },
    { cid: 'p', name: 'Aardvark', type: 'proto2', team_cid: 'a' },
  ]);
  assert.deepEqual(tree.map(node => node.cid), ['a', 'z', 'top']);
  assert.deepEqual(tree[0].children.map(node => node.cid), ['b', 'p']);
  assert.equal(tree[2].fileType, 'unknown');
});

test('orphan folders and projects are promoted without losing descendants', () => {
  const tree = buildTree('s', [
    { cid: 'orphan', name: 'Orphan', parent_cid: 'missing' },
    { cid: 'child', name: 'Child', parent_cid: 'orphan' },
  ], [
    { cid: 'loose', name: 'Loose', type: 'proto2', team_cid: 'missing' },
    { cid: 'inside', name: 'Inside', type: 'design2', team_cid: 'child' },
  ]);
  assert.deepEqual(tree.map(node => node.cid), ['orphan', 'loose']);
  assert.equal(tree[0].children[0].cid, 'child');
  assert.equal(tree[0].children[0].children[0].cid, 'inside');
  assert.equal(flatten(tree).length, 4);
});

test('cycles and self-parenting are broken and every visible entity appears once', () => {
  const tree = buildTree('s', [
    { cid: 'a', name: 'A', parent_cid: 'b' },
    { cid: 'b', name: 'B', parent_cid: 'c' },
    { cid: 'c', name: 'C', parent_cid: 'a' },
    { cid: 'd', name: 'D', parent_cid: 'b' },
    { cid: 'self', name: 'Self', parent_cid: 'self' },
    { cid: 'v1', name: 'Hidden1', root_project: true, parent_cid: 'v2' },
    { cid: 'v2', name: 'Hidden2', root_project: true, parent_cid: 'v1' },
  ], [
    { cid: 'p', name: 'P', type: 'proto2', team_cid: 'c' },
    { cid: 'q', name: 'Q', type: 'prototype', team_cid: 'v2' },
  ]);
  assert.deepEqual(flatten(tree).map(node => `${node.kind}:${node.cid}`).sort(), [
    'file:p', 'file:q', 'folder:a', 'folder:b', 'folder:c', 'folder:d', 'folder:self',
  ]);
});

test('scope and kind are part of collision-free keys; duplicates keep the first entity', () => {
  const folders = Object.freeze([
    Object.freeze({ cid: 'shared', name: 'First folder' }),
    Object.freeze({ cid: 'shared', name: 'Duplicate folder' }),
  ]);
  const projects = Object.freeze([
    Object.freeze({ cid: 'shared', name: 'First file', type: 'design2', team_cid: 'shared' }),
    Object.freeze({ cid: 'shared', name: 'Duplicate file', type: 'proto2' }),
  ]);
  const first = flatten(buildTree('team-A', folders, projects));
  const second = flatten(buildTree('team-B', folders, projects));
  assert.deepEqual(first.map(node => node.key), [
    '["team-A","folder","shared"]', '["team-A","file","shared"]',
  ]);
  assert.deepEqual(second.map(node => node.key), [
    '["team-B","folder","shared"]', '["team-B","file","shared"]',
  ]);
  assert.deepEqual(first.map(node => node.name), ['First folder', 'First file']);
  assert.equal(first[1].fileType, 'design2');
  assert.equal(new Set([...first, ...second].map(node => node.key)).size, 4);
  assert.equal(buildTree('a:folder', [{ cid: 'b', name: 'One' }], [])[0].key, '["a:folder","folder","b"]');
  assert.equal(buildTree('a', [{ cid: 'folder:b', name: 'Two' }], [])[0].key, '["a","folder","folder:b"]');
});

test('deep cyclic folders are handled iteratively without stack overflow', () => {
  const folders = Array.from({ length: 15000 }, (_, index) => ({
    cid: String(index), name: `Folder ${index}`, parent_cid: String((index + 1) % 15000),
  }));
  const nodes = flatten(buildTree('deep', folders, []));
  assert.equal(nodes.length, 15000);
  assert.equal(new Set(nodes.map(node => node.key)).size, 15000);
});

test('deep virtual roots promote a real project without stack overflow', () => {
  const folders = Array.from({ length: 15000 }, (_, index) => ({
    cid: String(index), name: `Virtual ${index}`, root_project: true,
    parent_cid: index === 14999 ? null : String(index + 1),
  }));
  assert.deepEqual(buildTree('deep', folders, [
    { cid: 'p', name: 'Real project', type: 'design2', team_cid: '0' },
  ]), [{
    key: '["deep","file","p"]', cid: 'p', name: 'Real project', kind: 'file',
    fileType: 'design2', children: [],
  }]);
});
