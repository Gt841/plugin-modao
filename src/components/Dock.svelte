<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Guest from './Guest.svelte';
  import Source from './Source.svelte';
  import type { ModaoApi, NamedItem } from '../lib/api.ts';
  import type { SessionBridge } from '../lib/bridge.ts';
  import { WORKSPACE_URL, type TreeNode } from '../lib/model.ts';
  export let api: ModaoApi;
  export let bridge: SessionBridge;
  export let onWorkspace: () => void;
  export let onOpen: (node: TreeNode) => void;
  export let onExternal: (node: TreeNode) => void = () => {};
  export let onCopy: (node: TreeNode) => void = () => {};
  export let onLogout: () => Promise<boolean>;
  let generation = 0;
  let request = 0;
  let busy = true;
  let loggedIn = false;
  let organizations: NamedItem[] = [];
  let error = '';
  let destroyed = false;
  export let sessionActive = true;
  onDestroy(() => { destroyed = true; request++; });
  export async function suspend() {
    request++; sessionActive = false; busy = false; organizations = []; loggedIn = false;
    await tick();
  }
  export function resume() {
    if (destroyed) return;
    sessionActive = true; refresh();
  }
  export function refresh() {
    if (destroyed || !sessionActive) return;
    request++; generation++; busy = true; error = ''; organizations = [];
  }
  async function loadDirectory() {
    const current = ++request;
    busy = true; error = '';
    try {
      await api.checkLogin();
      if (destroyed || current !== request) return;
      loggedIn = true;
      const result = await api.organizations();
      if (destroyed || current !== request) return;
      organizations = result;
    } catch (cause) {
      if (destroyed || current !== request) return;
      if ((cause as any)?.kind === 'authentication') loggedIn = false;
      error = cause instanceof Error ? cause.message : '无法读取目录，请在工作台查看。';
    } finally { if (!destroyed && current === request) busy = false; }
  }
  function failed(message: string) { request++; busy = false; error = message; }
  async function loginOrLogout() {
    if (!loggedIn) { onWorkspace(); return; }
    await onLogout();
  }
</script>

<div class="modao-dock">
  <header class="block__icons modao-toolbar">
    <div class="block__logo modao-logo" title="墨刀 · 目录树">
      <svg class="block__logoicon modao-logo-icon" aria-hidden="true"><use href="#modao_logo" /></svg>
      <span class="modao-title">墨刀</span>
    </div>
    <span class="fn__flex-1 fn__space" />
    <div class="modao-dock-actions">
      <button class="block__icon" title="刷新目录" aria-label="刷新目录" disabled={busy || !sessionActive} on:click={refresh}>
        <svg aria-hidden="true"><use href="#modao_refresh" /></svg>
      </button>
      <button class="block__icon" title={loggedIn ? '退出墨刀登录' : '登录墨刀'}
        aria-label={loggedIn ? '退出墨刀登录' : '登录墨刀'} on:click={loginOrLogout}>
        <svg aria-hidden="true"><use href={loggedIn ? '#modao_logout' : '#modao_login'} /></svg>
      </button>
    </div>
  </header>
  <div class="modao-directory" aria-label="墨刀文件目录" aria-busy={busy}>
    {#if busy}<p class="modao-note" role="status">正在连接墨刀…</p>{/if}
    {#if error}<p class="modao-note modao-error" role="alert">{error}</p>{/if}
    {#if !busy && loggedIn}
      {#key generation}
        <Source name="个人文件" kind="personal" hideWhenEmpty {api} {onOpen} {onExternal} {onCopy} />
        {#each organizations as org (org.cid)}
          <Source name={org.name} kind="org" orgCid={org.cid} {api} {onOpen} {onExternal} {onCopy} />
        {/each}
      {/key}
    {:else if !busy && !loggedIn}
      <div class="modao-signin"><p>在思源页签中登录墨刀，<br />然后点击“刷新目录”。</p>
        <button class="b3-button" on:click={onWorkspace}>打开工作台登录</button>
      </div>
    {/if}
  </div>
  <div class="modao-session-host" aria-hidden="true">
    {#if sessionActive}{#key generation}<Guest src={WORKSPACE_URL} {bridge} onReady={loadDirectory} onFailure={failed} />{/key}{/if}
  </div>
</div>

<style>
  /* Same native toolbar structure and metrics as the BoardMix dock. */
  .modao-toolbar { display:flex; flex-wrap:nowrap; align-items:center; }
  .modao-logo { display:flex; align-items:center; min-width:0; margin-right:0; flex:0 1 auto; overflow:hidden; }
  .modao-logo-icon { flex:0 0 auto; fill:currentColor; width:18px; height:18px; padding:2px; }
  .modao-title { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .modao-dock-actions { display:flex; flex-direction:row; flex-wrap:nowrap; align-items:center; gap:2px; flex:0 0 auto; margin-left:4px; }
  .modao-dock-actions .block__icon { width:24px; height:24px; min-width:24px; min-height:24px; margin-left:0; padding:0; justify-content:center; cursor:pointer; opacity:1!important; visibility:visible!important; }
  .modao-dock-actions .block__icon:hover { background-color:var(--b3-list-hover); border-radius:var(--b3-border-radius,4px); }
  .modao-dock-actions .block__icon:disabled { color:var(--b3-theme-on-surface); cursor:wait; opacity:.6!important; }
  .modao-dock-actions .block__icon svg { width:14px; height:14px; fill:currentColor; }
</style>
