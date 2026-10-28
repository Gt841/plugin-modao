<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CreateType, ModaoApi, NamedItem } from '../lib/api.ts';
  import { buildTree, type TreeNode } from '../lib/model.ts';
  import Tree from './Tree.svelte';
  export let name: string;
  export let kind: 'personal' | 'org' | 'space' = 'personal';
  export let orgCid = '';
  export let spaceCid = '';
  export let api: ModaoApi;
  export let onOpen: (node: TreeNode) => void;
  export let onExternal: (node: TreeNode) => void = () => {};
  export let onCopy: (node: TreeNode) => void = () => {};
  let expanded = false;
  let loaded = false;
  let loading = false;
  let error = '';
  let actionError = '';
  let limited = false;
  let nodes: TreeNode[] = [];
  let spaces: NamedItem[] = [];
  let destroyed = false;
  onDestroy(() => { destroyed = true; });
  function messageOf(cause: unknown) {
    return cause instanceof Error ? cause.message : '操作失败，请重试。';
  }
  async function fetchDirectory() {
    if (kind === 'org') {
      const result = await api.spaces(orgCid);
      if (!destroyed) spaces = result;
      return;
    }
    const result = await api.contents(kind === 'space' ? {orgCid, spaceCid} : undefined);
    if (destroyed) return;
    nodes = buildTree(kind === 'personal' ? 'personal' : `${orgCid}/${spaceCid}`, result.folders, result.projects);
    limited = result.limited;
  }
  async function load() {
    if (loading) return;
    loading = true; error = ''; actionError = '';
    try {
      await fetchDirectory();
      loaded = true;
    } catch (cause) {
      if (!destroyed) error = messageOf(cause);
    } finally { if (!destroyed) loading = false; }
  }
  function toggle() {
    expanded = !expanded;
    if (expanded && !loaded) void load();
  }
  async function refreshAfter(action: string) {
    try {
      await fetchDirectory();
      if (!destroyed) actionError = '';
    } catch (cause) {
      if (!destroyed) actionError = `${action}，但刷新目录失败：${messageOf(cause)}`;
    }
  }
  async function createFile(type: CreateType, folder: TreeNode, newName: string) {
    actionError = '';
    await api.createFile(type, folder.cid, newName);
    await refreshAfter('已创建');
  }
  async function rename(node: TreeNode, newName: string) {
    actionError = '';
    await api.rename(node.kind === 'folder' ? 'folder' : 'file', node.cid, newName);
    await refreshAfter('已重命名');
  }
  // 静默重读当前目录，不收起已展开的节点。
  async function refreshTree() {
    try {
      await fetchDirectory();
      if (!destroyed) actionError = '';
    } catch (cause) {
      if (!destroyed) actionError = `刷新目录失败：${messageOf(cause)}`;
    }
  }
</script>

<section class="modao-source">
  <button class="modao-row modao-source-title" title={name} aria-expanded={expanded} on:click={toggle}>
    <svg aria-hidden="true" class:modao-rotated={expanded}><use href="#modao_chevron" /></svg>
    <span>{name}</span>
  </button>
  {#if expanded}
    <div class="modao-indent" aria-busy={loading}>
      {#if actionError}<p class="modao-note modao-error" role="alert">{actionError}</p>{/if}
      {#if loading}<p class="modao-note" role="status">正在读取…</p>
      {:else if error}<p class="modao-note modao-error" role="alert">{error}</p><button class="modao-text-button" on:click={load}>重试</button>
      {:else if kind === 'org'}
        {#each spaces as space (space.cid)}
          <svelte:self name={space.name} kind="space" {orgCid} spaceCid={space.cid} {api} {onOpen} {onExternal} {onCopy} />
        {:else}<p class="modao-note">暂无可访问空间</p>{/each}
      {:else}
        {#if limited}<p class="modao-note modao-error">接口仅返回部分目录，请在工作台查看完整列表。</p>{/if}
        {#if nodes.length}<Tree {nodes} {onOpen} {onExternal} {onCopy} onCreate={createFile} onRename={rename} onRefresh={refreshTree} />{:else}<p class="modao-note">暂无文件</p>{/if}
      {/if}
    </div>
  {/if}
</section>
