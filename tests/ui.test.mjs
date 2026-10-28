import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build, transform } from 'esbuild';
import { compile, preprocess } from 'svelte/compiler';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://localhost'});
for (const key of ['window','document','HTMLElement','Element','Node','CustomEvent','MouseEvent','getComputedStyle']) {
  Object.defineProperty(globalThis, key, {value:dom.window[key], configurable:true});
}
// Minimal stand-in for SiYuan's native Menu. The real menu renders a floating
// panel into document.body; the stub keeps that location and role contract.
const siyuanStub = `
class Menu {
  constructor(id, closeCallback) {
    this.element = document.createElement('div');
    this.element.setAttribute('role', 'menu');
    this.closeCallback = closeCallback;
  }
  addItem(options) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.textContent = options.label || '';
    item.addEventListener('click', () => {
      this.close();
      if (options.click) options.click(item, new window.MouseEvent('click', {bubbles: true}));
    });
    this.element.append(item);
    return item;
  }
  addSeparator() { const line = document.createElement('hr'); this.element.append(line); return line; }
  open() { document.body.append(this.element); }
  close() { this.element.remove(); if (this.closeCallback) this.closeCallback(); }
}
export { Menu };
`;
async function component(file) {
  const built = await build({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs',conditions:['browser'],
    plugins:[
      {name:'siyuan-stub',setup(builder){
        builder.onResolve({filter:/^siyuan$/},()=>({path:'siyuan',namespace:'siyuan-stub'}));
        builder.onLoad({filter:/.*/,namespace:'siyuan-stub'},()=>({contents:siyuanStub,loader:'js'}));
      }},
      {name:'svelte-tests',setup(builder){
        builder.onLoad({filter:/\.svelte$/}, async args => {
          const source = await readFile(args.path,'utf8');
          const processed = await preprocess(source, {script:async ({content,attributes}) => attributes.lang === 'ts' ? {code:(await transform(content,{loader:'ts',tsconfigRaw:{compilerOptions:{verbatimModuleSyntax:true}}})).code} : {code:content}}, {filename:args.path});
          return {contents:compile(processed.code,{filename:args.path,css:false,generate:'dom'}).js.code,resolveDir:require('node:path').dirname(args.path)};
        });
      }}]});
  const module = {exports:{}};
  new Function('require','module','exports',built.outputFiles[0].text)(require,module,module.exports);
  return module.exports.default;
}
const flush = async () => { for (let i=0;i<8;i++) await Promise.resolve(); };
const menuItems = () => [...document.querySelectorAll('[role="menu"] button')];
const menuLabels = () => menuItems().map(b => b.textContent.trim());
const menuButton = text => menuItems().find(b => b.textContent.trim() === text);
const closeMenus = () => document.querySelectorAll('[role="menu"]').forEach(el => el.remove());
function mount(Component, props) {
  const target = document.createElement('div'); document.body.append(target);
  const instance = new Component({target,props});
  return {target,instance,cleanup(){instance.$destroy(); target.remove(); closeMenus();}};
}

test('single clicks expand nested folder names and open only the clicked file', async () => {
  const Tree = await component('src/components/Tree.svelte');
  const opened=[];
  const ui=mount(Tree,{nodes:[{key:'f',cid:'f',name:'一级',kind:'folder',children:[{key:'g',cid:'g',name:'二级',kind:'folder',children:[{key:'p',cid:'p',name:'首页',kind:'file',fileType:'proto2',children:[]}]}]}],onOpen:node=>opened.push(node.cid)});
  try {
    assert.equal(ui.target.textContent.includes('首页'),false);
    ui.target.querySelector('button').click(); await flush();
    const nested = [...ui.target.querySelectorAll('button')].find(b=>b.textContent.includes('二级'));
    assert.ok(nested, 'single click must reveal nested folder');
    nested.click(); await flush();
    const file = [...ui.target.querySelectorAll('button')].find(b=>b.textContent.includes('首页'));
    assert.ok(file, 'nested click must reveal the file');
    file.click(); await flush();
    assert.deepEqual(opened,['p']);
    ui.target.querySelector('button').click(); await flush();
    assert.equal(ui.target.textContent.includes('首页'),false);
    assert.equal(ui.target.querySelector('button').getAttribute('aria-expanded'),'false');
  } finally {ui.cleanup();}
});
const treeNodes = [{
  key: 'f', cid: 'f', name: '目录', kind: 'folder', children: [
    { key: 'p', cid: 'p', name: '首页', kind: 'file', fileType: 'proto2', children: [] },
    { key: 'b', cid: 'b', name: '白板稿', kind: 'file', fileType: 'bomx2', children: [] },
    { key: 't', cid: 't', name: '发布稿', kind: 'file', fileType: 'aippt2', children: [] },
  ],
}, { key: 'd', cid: 'd', name: '设计稿', kind: 'file', fileType: 'design2', children: [] }];
const findButton = (target, text) => [...target.querySelectorAll('button')].find(b => b.textContent.trim() === text);
const moreButton = (target, name) => target.querySelector(`button[aria-label="更多操作：${name}"]`);

test('tree shows a distinct icon and workspace badge for every file type', async () => {
  const Tree = await component('src/components/Tree.svelte');
  const ui = mount(Tree, { nodes: treeNodes, onOpen: () => {}, onCreate: async () => {}, onRename: async () => {} });
  try {
    findButton(ui.target, '目录').click(); await flush();
    const row = name => [...ui.target.querySelectorAll('button.modao-row')].find(b => b.textContent.includes(name));
    assert.equal(row('目录').querySelector('use[href="#modao_folder"]').getAttribute('href'), '#modao_folder');
    assert.equal(moreButton(ui.target, '目录').textContent.trim(), '⋮');
    assert.equal(row('首页').querySelector('use').getAttribute('href'), '#modao_type_proto');
    assert.equal(row('设计稿').querySelector('use').getAttribute('href'), '#modao_type_design');
    assert.equal(row('白板稿').querySelector('use').getAttribute('href'), '#modao_type_board');
    assert.equal(row('发布稿').querySelector('use').getAttribute('href'), '#modao_type_ppt');
    assert.equal(row('白板稿').querySelector('.modao-type-badge').textContent, '白板');
    assert.equal(row('发布稿').querySelector('.modao-type-badge').textContent, 'PPT');
    assert.match(row('白板稿').title, /需在墨刀工作台打开/);
    assert.equal(row('首页').querySelector('.modao-type-badge'), null, 'openable files need no workspace badge');
    assert.doesNotMatch(row('首页').title, /需在墨刀工作台打开/);
  } finally { ui.cleanup(); }
});

test('node menus offer file-specific actions and refresh folders in place', async () => {
  const Tree = await component('src/components/Tree.svelte');
  const opened = []; const external = []; const copies = []; const refreshed = [];
  const ui = mount(Tree, {
    nodes: treeNodes, onOpen: node => opened.push(node.cid),
    onExternal: node => external.push(node.cid), onCopy: node => copies.push(node.cid),
    onRefresh: async node => { refreshed.push(node.cid); },
  });
  try {
    moreButton(ui.target, '目录').click(); await flush();
    assert.deepEqual(menuLabels(), ['新建原型', '新建设计', '新建文件夹', '刷新子节点', '重命名']);
    menuButton('刷新子节点').click(); await flush();
    assert.deepEqual(refreshed, ['f']);
    assert.equal(document.querySelector('[role="menu"]'), null, 'menu closes after an action');

    findButton(ui.target, '目录').click(); await flush();
    moreButton(ui.target, '首页').click(); await flush();
    assert.deepEqual(menuLabels(), ['用tab打开', '在浏览器打开', '复制在线链接', '重命名']);
    menuButton('用tab打开').click(); await flush();
    assert.deepEqual(opened, ['p']);
    moreButton(ui.target, '首页').click(); await flush();
    menuButton('在浏览器打开').click(); await flush();
    assert.deepEqual(external, ['p']);
    moreButton(ui.target, '首页').click(); await flush();
    menuButton('复制在线链接').click(); await flush();
    assert.deepEqual(copies, ['p']);

    moreButton(ui.target, '白板稿').click(); await flush();
    assert.deepEqual(menuLabels(), ['在工作台打开', '重命名']);
    menuButton('在工作台打开').click(); await flush();
    assert.deepEqual(opened, ['p', 'b']);

    const row = [...ui.target.querySelectorAll('button.modao-row')].find(b => b.textContent.includes('首页'));
    row.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 12, clientY: 34 })); await flush();
    assert.deepEqual(menuLabels(), ['用tab打开', '在浏览器打开', '复制在线链接', '重命名'], 'right click opens the same menu');
  } finally { ui.cleanup(); }
});

test('folder menu creates files and folders, and rename works for files and folders', async () => {
  const Tree = await component('src/components/Tree.svelte');
  const created = []; const folders = []; const renamed = [];
  const ui = mount(Tree, {
    nodes: treeNodes, onOpen: () => {},
    onCreate: async (...args) => { created.push(args); },
    onCreateFolder: async (...args) => { folders.push(args); },
    onRename: async (...args) => { renamed.push(args); },
  });
  try {
    findButton(ui.target, '目录').click(); await flush();
    moreButton(ui.target, '目录').click(); await flush();
    assert.deepEqual(menuLabels(), ['新建原型', '新建设计', '新建文件夹', '刷新子节点', '重命名']);
    menuButton('新建原型').click(); await flush();
    let dialog = ui.target.querySelector('[role="dialog"]');
    assert.ok(dialog, 'create dialog must open');
    const input = dialog.querySelector('input[aria-label="名称"]');
    input.value = '  新原型  '; input.dispatchEvent(new dom.window.Event('input')); await flush();
    findButton(dialog, '确定').click(); await flush();
    assert.deepEqual(created, [['proto2', treeNodes[0], '新原型']]);
    assert.equal(ui.target.querySelector('[role="dialog"]'), null, 'dialog closes after success');

    moreButton(ui.target, '目录').click(); await flush();
    menuButton('新建文件夹').click(); await flush();
    dialog = ui.target.querySelector('[role="dialog"]');
    assert.match(dialog.textContent, /新建文件夹/);
    const folderInput = dialog.querySelector('input[aria-label="名称"]');
    folderInput.value = '  新子目录  '; folderInput.dispatchEvent(new dom.window.Event('input')); await flush();
    findButton(dialog, '确定').click(); await flush();
    assert.deepEqual(folders, [[treeNodes[0], '新子目录']]);

    moreButton(ui.target, '首页').click(); await flush();
    menuButton('重命名').click(); await flush();
    dialog = ui.target.querySelector('[role="dialog"]');
    assert.equal(dialog.querySelector('input[aria-label="名称"]').value, '首页');
    const fileInput = dialog.querySelector('input[aria-label="名称"]');
    fileInput.value = '首页改'; fileInput.dispatchEvent(new dom.window.Event('input')); await flush();
    findButton(dialog, '确定').click(); await flush();
    assert.deepEqual(renamed, [[treeNodes[0].children[0], '首页改']]);

    moreButton(ui.target, '目录').click(); await flush();
    menuButton('重命名').click(); await flush();
    dialog = ui.target.querySelector('[role="dialog"]');
    const renameFolderInput = dialog.querySelector('input[aria-label="名称"]');
    renameFolderInput.value = '新目录'; renameFolderInput.dispatchEvent(new dom.window.Event('input')); await flush();
    findButton(dialog, '确定').click(); await flush();
    assert.deepEqual(renamed.at(-1), [treeNodes[0], '新目录']);
  } finally { ui.cleanup(); }
});

test('failed rename keeps the dialog open with the server message', async () => {
  const Tree = await component('src/components/Tree.svelte');
  const ui = mount(Tree, {
    nodes: treeNodes, onOpen: () => {},
    onCreate: async () => {},
    onRename: async () => { throw new Error('名称已存在，请换一个名称后重试。'); },
  });
  try {
    moreButton(ui.target, '设计稿').click(); await flush();
    menuButton('重命名').click(); await flush();
    const dialog = ui.target.querySelector('[role="dialog"]');
    const input = dialog.querySelector('input[aria-label="名称"]');
    input.value = '新名字'; input.dispatchEvent(new dom.window.Event('input')); await flush();
    findButton(dialog, '确定').click(); await flush();
    assert.equal(ui.target.querySelector('[role="dialog"]'), dialog, 'failed rename must keep the dialog');
    assert.match(dialog.textContent, /名称已存在/);
  } finally { ui.cleanup(); }
});

test('source creates files and renames entries through the API without collapsing the tree', async () => {
  const Source = await component('src/components/Source.svelte');
  let projects = [{ cid: 'p1', name: '页一', type: 'proto2', team_cid: 'f1' }];
  const writes = [];
  let reads = 0;
  const api = {
    contents: async () => { reads++; return { folders: [{ cid: 'f1', name: '目录' }], projects: [...projects], limited: false }; },
    createFile: async (type, folderCid, name) => { writes.push(['create', type, folderCid, name]); projects.push({ cid: 'p2', name, type, team_cid: folderCid }); },
    rename: async (kind, cid, name) => { writes.push(['rename', kind, cid, name]); projects = projects.map(p => p.cid === cid ? { ...p, name } : p); },
  };
  const ui = mount(Source, { name: '个人文件', kind: 'personal', api, onOpen: () => {} });
  try {
    findButton(ui.target, '个人文件').click(); await flush();
    findButton(ui.target, '目录').click(); await flush();
    assert.ok(findButton(ui.target, '页一'));
    moreButton(ui.target, '目录').click(); await flush();
    menuButton('新建原型').click(); await flush();
    const dialog = ui.target.querySelector('[role="dialog"]');
    const input = dialog.querySelector('input[aria-label="名称"]');
    input.value = '新页面'; input.dispatchEvent(new dom.window.Event('input')); await flush();
    findButton(dialog, '确定').click(); await flush();
    assert.deepEqual(writes, [['create', 'proto2', 'f1', '新页面']]);
    assert.ok(findButton(ui.target, '新页面'), 'created file must appear after the silent reload');
    assert.equal(findButton(ui.target, '目录').getAttribute('aria-expanded'), 'true', 'tree must stay expanded');

    const beforeRefresh = reads;
    moreButton(ui.target, '目录').click(); await flush();
    menuButton('刷新子节点').click(); await flush();
    assert.equal(reads, beforeRefresh + 1, 'refresh re-reads the directory');
    assert.equal(findButton(ui.target, '目录').getAttribute('aria-expanded'), 'true', 'refresh must not collapse the tree');
    assert.ok(findButton(ui.target, '新页面'));

    moreButton(ui.target, '新页面').click(); await flush();
    menuButton('重命名').click(); await flush();
    const renameDialog = ui.target.querySelector('[role="dialog"]');
    const renameInput = renameDialog.querySelector('input[aria-label="名称"]');
    renameInput.value = '改名页'; renameInput.dispatchEvent(new dom.window.Event('input')); await flush();
    findButton(renameDialog, '确定').click(); await flush();
    assert.deepEqual(writes.at(-1), ['rename', 'file', 'p2', '改名页']);
    assert.ok(findButton(ui.target, '改名页'));
  } finally { ui.cleanup(); }
});

test('space menus create files and folders at the current root', async () => {
  const Source = await component('src/components/Source.svelte');
  let projects = [{ cid: 'p1', name: '页一', type: 'proto2', team_cid: 'root' }];
  const writes = [];
  const api = {
    contents: async () => ({ folders: [{ cid: 'root', name: '个人文件', root_project: true, space_cid: 'root' }], projects: [...projects], limited: false, rootCid: 'root', spaceCid: 'root' }),
    createFile: async (type, folderCid, name) => { writes.push(['file', type, folderCid, name]); projects.push({ cid: 'p2', name, type, team_cid: folderCid }); },
    createFolder: async (target, name) => { writes.push(['folder', target, name]); },
  };
  const ui = mount(Source, { name: '个人文件', kind: 'personal', api, onOpen: () => {} });
  try {
    findButton(ui.target, '个人文件').click(); await flush();
    moreButton(ui.target, '个人文件').click(); await flush();
    assert.deepEqual(menuLabels(), ['新建原型', '新建设计', '新建文件夹', '刷新子节点']);
    menuButton('新建原型').click(); await flush();
    let dialog = ui.target.querySelector('[role="dialog"]');
    let input = dialog.querySelector('input[aria-label="名称"]');
    input.value = '空间新页面'; input.dispatchEvent(new dom.window.Event('input')); await flush();
    findButton(dialog, '确定').click(); await flush();
    assert.deepEqual(writes, [['file', 'proto2', 'root', '空间新页面']]);
    assert.ok(findButton(ui.target, '空间新页面'), 'space-created file must appear after reload');

    moreButton(ui.target, '个人文件').click(); await flush();
    menuButton('新建文件夹').click(); await flush();
    dialog = ui.target.querySelector('[role="dialog"]');
    assert.match(dialog.textContent, /新建文件夹/);
    input = dialog.querySelector('input[aria-label="名称"]');
    input.value = '空间新目录'; input.dispatchEvent(new dom.window.Event('input')); await flush();
    findButton(dialog, '确定').click(); await flush();
    assert.deepEqual(writes.at(-1), ['folder', { spaceCid: 'root' }, '空间新目录']);
  } finally { ui.cleanup(); }
});

test('org space creation carries the selected organization and space', async () => {
  const Source = await component('src/components/Source.svelte');
  const writes = [];
  const api = {
    contents: async () => ({ folders: [], projects: [], limited: false }),
    createFile: async (...args) => { writes.push(['file', ...args]); },
    createFolder: async (...args) => { writes.push(['folder', ...args]); },
  };
  const ui = mount(Source, { name: '产品空间', kind: 'space', orgCid: 'o1', spaceCid: 's1', api, onOpen: () => {} });
  try {
    findButton(ui.target, '产品空间').click(); await flush();
    moreButton(ui.target, '产品空间').click(); await flush();
    menuButton('新建设计').click(); await flush();
    let dialog = ui.target.querySelector('[role="dialog"]');
    let input = dialog.querySelector('input[aria-label="名称"]');
    input.value = '空间设计'; input.dispatchEvent(new dom.window.Event('input')); await flush();
    findButton(dialog, '确定').click(); await flush();
    assert.deepEqual(writes, [['file', 'design2', 's1', '空间设计']]);

    moreButton(ui.target, '产品空间').click(); await flush();
    menuButton('新建文件夹').click(); await flush();
    dialog = ui.target.querySelector('[role="dialog"]');
    input = dialog.querySelector('input[aria-label="名称"]');
    input.value = '空间目录'; input.dispatchEvent(new dom.window.Event('input')); await flush();
    findButton(dialog, '确定').click(); await flush();
    assert.deepEqual(writes.at(-1), ['folder', { spaceCid: 's1', orgCid: 'o1' }, '空间目录']);
  } finally { ui.cleanup(); }
});

test('source retry displays permission failure, then a legitimate empty directory', async () => {
  const Source = await component('src/components/Source.svelte');
  let attempt=0;
  const ui=mount(Source,{name:'个人文件',kind:'personal',api:{contents:async()=>{if(++attempt===1) throw new Error('无权访问'); return {folders:[],projects:[],limited:false};}},onOpen:()=>{}});
  try {
    ui.target.querySelector('button').click(); await flush();
    assert.match(ui.target.textContent,/无权访问/);
    [...ui.target.querySelectorAll('button')].find(b=>b.textContent.includes('重试')).click(); await flush();
    assert.match(ui.target.textContent,/暂无文件/); assert.equal(attempt,2);
    ui.target.querySelector('button').click(); await flush(); ui.target.querySelector('button').click(); await flush();
    assert.equal(attempt,2);
  } finally {ui.cleanup();}
});
test('guest detaches its session and removes event handlers on component destruction', async () => {
  const Guest = await component('src/components/Guest.svelte');
  let attached=0,detached=0,ready=0;
  const ui=mount(Guest,{src:'https://modao.cc/workspace/home',bridge:{attach(){attached++},detach(){detached++}},onReady:()=>ready++});
  const guest=ui.target.querySelector('webview');
  guest.dispatchEvent(new dom.window.Event('dom-ready')); await flush();
  assert.equal(attached,1); assert.equal(ready,1);
  const beforeNavigation=detached;
  const navigation=new dom.window.Event('did-start-navigation');
  navigation.isMainFrame=true; navigation.isInPlace=true;
  guest.dispatchEvent(navigation); await flush();
  assert.equal(detached,beforeNavigation,'SPA navigation must not detach the ready bridge');
  ui.cleanup();
  const count=detached;
  guest.dispatchEvent(new dom.window.Event('dom-ready')); await flush();
  assert.equal(attached,1); assert.ok(count>=1);
});

test('dock exposes refresh and login controls, checks session and refreshes loaded roots', async () => {
  const Dock = await component('src/components/Dock.svelte');
  let opened=0, logouts=0, checks=0;
  const ui=mount(Dock,{api:{checkLogin:async()=>{checks++},organizations:async()=>[{cid:'o1',name:'设计组'}]},bridge:{attach(){},detach(){}},onWorkspace:()=>opened++,onOpen:()=>{},onLogout:async()=>{logouts++;return false;}});
  try {
    const refresh=ui.target.querySelector('button[aria-label="刷新目录"]');
    const login=ui.target.querySelector('button[aria-label="登录墨刀"]');
    assert.ok(refresh, 'refresh must always be present'); assert.ok(login, 'login must always be present');
    login.click(); assert.equal(opened,1);
    ui.target.querySelector('webview').dispatchEvent(new dom.window.Event('dom-ready')); await flush();
    assert.equal(checks,1); assert.match(ui.target.textContent,/设计组/);
    ui.target.querySelector('button[aria-label="退出墨刀登录"]').click(); await flush(); assert.equal(logouts,1);
    refresh.click(); await flush();
    assert.equal(ui.target.textContent.includes('设计组'),false);
    ui.target.querySelector('webview').dispatchEvent(new dom.window.Event('dom-ready')); await flush();
    assert.equal(checks,2); assert.match(ui.target.textContent,/设计组/);
    assert.equal(typeof ui.instance.suspend,'function','logout must be able to stop the session host');
    await ui.instance.suspend(); await flush(); assert.equal(ui.target.querySelector('webview'),null);
    ui.instance.refresh(); await flush(); assert.equal(ui.target.querySelector('webview'),null,'refresh must remain locked until storage cleanup finishes');
    assert.equal(refresh.disabled,true);
    ui.instance.resume(); await flush(); assert.ok(ui.target.querySelector('webview'));
  } finally {ui.cleanup();}
});
