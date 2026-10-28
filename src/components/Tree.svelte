<script lang="ts">
  import type { TreeNode } from '../lib/model.ts';
  export let nodes: TreeNode[] = [];
  export let onOpen: (node: TreeNode) => void;
  let expanded = new Set<string>();
  function activate(node: TreeNode) {
    if (node.kind === 'file') { onOpen(node); return; }
    const next = new Set(expanded);
    if (next.has(node.key)) next.delete(node.key); else next.add(node.key);
    expanded = next;
  }
</script>

<ul class="modao-tree-list">
  {#each nodes as node (node.key)}
    <li>
      <button class="modao-row" title={node.name}
        aria-expanded={node.kind === 'folder' ? expanded.has(node.key) : undefined}
        on:click={() => activate(node)}>
        <svg aria-hidden="true" class:modao-rotated={expanded.has(node.key)}>
          <use href={node.kind === 'folder' ? '#modao_chevron' : '#modao_logo'} />
        </svg>
        <span>{node.name || '未命名'}</span>
      </button>
      {#if node.kind === 'folder' && expanded.has(node.key)}
        <div class="modao-indent">
          {#if node.children.length}<svelte:self nodes={node.children} {onOpen} />
          {:else}<p class="modao-note">暂无文件</p>{/if}
        </div>
      {/if}
    </li>
  {/each}
</ul>
