<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ModaoApi, NamedItem } from '../lib/api.ts';
  import { buildTree, type TreeNode } from '../lib/model.ts';
  import Tree from './Tree.svelte';
  export let name: string;
  export let kind: 'personal' | 'org' | 'space' = 'personal';
  export let orgCid = '';
  export let spaceCid = '';
  export let api: ModaoApi;
  export let onOpen: (node: TreeNode) => void;
  let expanded = false;
  let loaded = false;
  let loading = false;
  let error = '';
  let limited = false;
  let nodes: TreeNode[] = [];
  let spaces: NamedItem[] = [];
  let destroyed = false;
  onDestroy(() => { destroyed = true; });
  async function load() {
    if (loading) return;
    loading = true; error = '';
    try {
      if (kind === 'org') {
        const result = await api.spaces(orgCid);
        if (destroyed) return;
        spaces = result;
      } else {
        const result = await api.contents(kind === 'space' ? {orgCid, spaceCid} : undefined);
        if (destroyed) return;
        nodes = buildTree(kind === 'personal' ? 'personal' : `${orgCid}/${spaceCid}`, result.folders, result.projects);
        limited = result.limited;
      }
      loaded = true;
    } catch (cause) {
      if (!destroyed) error = cause instanceof Error ? cause.message : '目录读取失败，请重试。';
    } finally { if (!destroyed) loading = false; }
  }
  function toggle() {
    expanded = !expanded;
    if (expanded && !loaded) void load();
  }
</script>

<section class="modao-source">
  <button class="modao-row modao-source-title" title={name} aria-expanded={expanded} on:click={toggle}>
    <svg aria-hidden="true" class:modao-rotated={expanded}><use href="#modao_chevron" /></svg>
    <span>{name}</span>
  </button>
  {#if expanded}
    <div class="modao-indent" aria-busy={loading}>
      {#if loading}<p class="modao-note" role="status">正在读取…</p>
      {:else if error}<p class="modao-note modao-error" role="alert">{error}</p><button class="modao-text-button" on:click={load}>重试</button>
      {:else if kind === 'org'}
        {#each spaces as space (space.cid)}
          <svelte:self name={space.name} kind="space" {orgCid} spaceCid={space.cid} {api} {onOpen} />
        {:else}<p class="modao-note">暂无可访问空间</p>{/each}
      {:else}
        {#if limited}<p class="modao-note modao-error">接口仅返回部分目录，请在工作台查看完整列表。</p>{/if}
        {#if nodes.length}<Tree {nodes} {onOpen} />{:else}<p class="modao-note">暂无文件</p>{/if}
      {/if}
    </div>
  {/if}
</section>
