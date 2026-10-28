import test from 'node:test';
import assert from 'node:assert/strict';
import { installNavigationGuard } from '../src/lib/navigation.ts';

test('session request callback cancels external main frames including redirected requests, not CDN assets',()=>{
  let listener;
  const webRequest={onBeforeRequest:(...args)=>{listener=args.at(-1);}};
  const remove=installNavigationGuard(webRequest);
  assert.equal(typeof listener,'function');
  const check=(url,type,expected)=>{
    let reply;
    listener({url,resourceType:type},value=>{reply=value;});
    assert.deepEqual(reply,{cancel:expected},url);
  };
  check('https://modao.cc/workspace/home','mainFrame',false);
  check('https://accounts.modao.cc/login','mainFrame',false);
  check('https://modao.cc/proto/design/p1','mainFrame',false);
  check('https://evil.test/phishing','mainFrame',true);
  check('https://modao.cc.evil.test','mainFrame',true);
  check('http://modao.cc/workspace/home','mainFrame',true);
  check('https://user:secret@modao.cc/','mainFrame',true);
  check('https://modao.cc:444/','mainFrame',true);
  check('https://cdn.example.test/app.js','script',false);
  check('https://third-party.example/captcha','subFrame',false);
  remove(); assert.equal(listener,null);
});
