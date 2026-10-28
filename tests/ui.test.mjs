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
async function component(file) {
  const built = await build({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs',conditions:['browser'],
    plugins:[{name:'svelte-tests',setup(builder){
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
function mount(Component, props) {
  const target = document.createElement('div'); document.body.append(target);
  const instance = new Component({target,props});
  return {target,instance,cleanup(){instance.$destroy(); target.remove();}};
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
