<script lang="ts">
  import Guest from './Guest.svelte';
  import { WORKSPACE_URL } from '../lib/model.ts';
  export let src: string;
  export let onRefresh: () => void;
  export let onExternal: () => void;
  let guest: Guest;
  let error = '';
  let loading = true;
</script>

<div class="modao-pane">
  <div class="modao-page-toolbar">
    <span class="modao-page-hint">{src === WORKSPACE_URL ? '请在此页登录；完成后刷新目录。' : '墨刀 · 文件编辑器'}</span>
    <button class="modao-text-button" on:click={onRefresh}>刷新目录</button>
    <button class="modao-text-button" on:click={() => { error = ''; loading = true; guest.reload(); }}>重载页面</button>
    <button class="modao-text-button" on:click={onExternal}>浏览器打开</button>
  </div>
  {#if error}<div class="modao-page-error" role="alert">{error}</div>
  {:else if loading}<div class="modao-page-loading" role="status">正在加载墨刀…</div>{/if}
  <Guest bind:this={guest} {src} onReady={() => { loading = false; error = ''; }} onFailure={message => { error = message; loading = false; }} />
</div>
