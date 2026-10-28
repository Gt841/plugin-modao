import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build, transform } from 'esbuild';
import { compile, preprocess } from 'svelte/compiler';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'});
for(const key of ['window','document','HTMLElement','Element','Node','CustomEvent','MouseEvent']) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
let registrations, calls, messages, models, requestHandler;
const webRequest={onBeforeRequest:(...args)=>{requestHandler=args.at(-1);}};
window.require=name=>{assert.equal(name,'@electron/remote');return {session:{fromPartition:partition=>{assert.equal(partition,'persist:modao');return {webRequest};}}};};
class Plugin {
  name='plugin-modao'; app={};
  addIcons(){}
  addTab(config){registrations.push(config);}
  addDock(config){this.dockDefinition=config;}
}
function initTab(url) {
  const element=document.createElement('div'); document.body.append(element);
  const headElement=document.createElement('button'); document.body.append(headElement);
  let model;
  const tab={headElement,close(){registrations[0].destroy.call(model); headElement.remove();element.remove();}};
  model={data:{url},element,tab}; models.push(model);
  registrations[0].init.call(model);
  return tab;
}
let confirmChoice=false;
globalThis.__modaoTest = {Plugin,openTab:async options=>{calls.push(options); return initTab(options.custom.data.url);},showMessage:msg=>messages.push(msg),confirm:(_title,_text,accept,cancel)=>confirmChoice ? accept() : cancel()};
async function loadPlugin(){
  const result=await build({entryPoints:['src/index.ts'],bundle:true,write:false,platform:'node',format:'cjs',conditions:['browser'],plugins:[{name:'host-test',setup(b){
    b.onResolve({filter:/^siyuan$/},()=>({path:'siyuan',namespace:'test'}));
    b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'module.exports=globalThis.__modaoTest;'}));
    b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
    b.onLoad({filter:/\.svelte$/},async args=>{const source=await readFile(args.path,'utf8'); const processed=await preprocess(source,{script:async({content,attributes})=>({code:attributes.lang==='ts'?(await transform(content,{loader:'ts',tsconfigRaw:{compilerOptions:{verbatimModuleSyntax:true}}})).code:content})},{filename:args.path});return {contents:compile(processed.code,{filename:args.path,css:false}).js.code,resolveDir:require('node:path').dirname(args.path)};});
  }}]});
  const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);return module.exports.default;
}
test('fixed tab registration restores views and deduplicates file clicks through the host boundary',async()=>{
  registrations=[];calls=[];messages=[];models=[];
  const ModaoPlugin=await loadPlugin();const plugin=new ModaoPlugin();await plugin.onload();
  assert.equal(typeof requestHandler,'function','install session guard before any guest can open');
  let decision;requestHandler({resourceType:'mainFrame',url:'https://evil.test/'},value=>decision=value);
  assert.deepEqual(decision,{cancel:true});
  assert.equal(registrations.length,1);
  const url='https://modao.cc/proto/design/p1';
  const a=plugin.openView(url,'首页'), b=plugin.openView(url,'首页');
  assert.equal(await a,await b);assert.equal(calls.length,1);
  assert.equal(calls[0].custom.icon,'modao_logo');
  assert.deepEqual(calls[0].custom.data,{url});
  const first=await a;first.close();
  const reopened=await plugin.openView(url,'首页');
  assert.notEqual(reopened,first);assert.equal(calls.length,2);
  assert.equal(await plugin.openView(url,'首页'),reopened);
  const restored=initTab('https://modao.cc/design/editor/p2');
  assert.equal(await plugin.openView('https://modao.cc/design/editor/p2','设计'),restored);
  assert.equal(calls.length,2);
  plugin.onunload();await flush();
  assert.equal(document.querySelectorAll('webview').length,0);
  assert.equal(requestHandler,null,'unload must unsubscribe its session guard');
  await assert.rejects(plugin.openView(url,'首页'));
});
test('unsafe restored URLs cannot create a guest and unknown types use the workspace',async()=>{
  registrations=[];calls=[];messages=[];models=[];document.body.innerHTML='';
  const ModaoPlugin=await loadPlugin();const plugin=new ModaoPlugin();await plugin.onload();
  assert.equal(registrations.length,1);
  initTab('https://evil.test/steal');
  assert.equal(document.querySelector('webview'),null);
  await assert.rejects(plugin.openView('javascript:alert(1)','恶意链接'));
  await plugin.openFile({cid:'p9',name:'其他',kind:'file',fileType:'unknown',key:'p9',children:[]});
  assert.equal(calls[0].custom.data.url,'https://modao.cc/workspace/home');
  assert.ok(messages.some(m=>m.includes('工作台')));
  plugin.onunload();
});
test('logout requires confirmation and clears only the plugin partition after closing guests',async()=>{
  registrations=[];calls=[];messages=[];models=[];document.body.innerHTML='';
  const clearing=[];
  window.require=name=>{assert.equal(name,'@electron/remote');return {session:{fromPartition:partition=>{assert.equal(partition,'persist:modao');return {webRequest,clearStorageData:async()=>{assert.equal(document.querySelector('webview'),null);clearing.push(partition);},clearCache:async()=>{}};}}};};
  const ModaoPlugin=await loadPlugin();const plugin=new ModaoPlugin();await plugin.onload();
  await plugin.openView('https://modao.cc/workspace/home','工作台');
  confirmChoice=false; assert.equal(await plugin.confirmLogout(),false); assert.deepEqual(clearing,[]);
  confirmChoice=true; assert.equal(await plugin.confirmLogout(),true); assert.deepEqual(clearing,['persist:modao']);
  plugin.onunload(); delete window.require; confirmChoice=false;
});
test('dock recreation during logout cannot create a guest until storage cleanup resolves',async t=>{
  registrations=[];calls=[];messages=[];models=[];document.body.innerHTML='';
  let releaseStorage;
  const session={webRequest,clearStorageData:()=>new Promise(resolve=>{releaseStorage=resolve;}),clearCache:async()=>{}};
  window.require=()=>({session:{fromPartition:()=>session}});
  const ModaoPlugin=await loadPlugin();const plugin=new ModaoPlugin();await plugin.onload();t.after(()=>plugin.onunload());
  const first=document.createElement('aside');document.body.append(first);plugin.dockDefinition.init({element:first});
  confirmChoice=true;const pending=plugin.confirmLogout();await flush();
  assert.equal(typeof releaseStorage,'function');assert.equal(document.querySelector('webview'),null);
  const second=document.createElement('aside');document.body.append(second);plugin.dockDefinition.init({element:second});await flush();
  const guestDuringLogout=document.querySelector('webview');
  releaseStorage();await pending;await flush();
  assert.equal(guestDuringLogout,null,'remount must inherit the logout lock');
  assert.ok(second.querySelector('webview'),'current dock resumes only after storage cleanup');
  confirmChoice=false;
});
test('missing session guard fails closed instead of loading an unprotected guest',async()=>{
  registrations=[];calls=[];messages=[];models=[];document.body.innerHTML='';delete window.require;
  const ModaoPlugin=await loadPlugin();const plugin=new ModaoPlugin();await plugin.onload();
  await assert.rejects(plugin.openView('https://modao.cc/workspace/home','工作台'));
  assert.equal(document.querySelector('webview'),null); assert.equal(calls.length,0);
  plugin.onunload();
});
