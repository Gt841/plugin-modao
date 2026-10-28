<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Menu } from 'siyuan';
  import type { CreateFolderTarget, CreateType, ModaoApi, NamedItem } from '../lib/api.ts';
  import { buildTree, normalizeName, type Folder, type TreeNode } from '../lib/model.ts';
  import Tree from './Tree.svelte';
  type DialogType = CreateType | 'folder';
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
  let rootCid = '';
  let rootSpace = '';
  let rootOrg = '';
  let foldersByCid = new Map<string, Folder>();
  let dialog: null | { type: DialogType } = null;
  let dialogName = '';
  let saving = false;
  let dialogError = '';
  let dialogInput: HTMLInputElement | undefined;
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
    // The creation targets come from the same response, so they can never point
    // at a different space than the one the user is looking at.
    foldersByCid = new Map(result.folders.map(folder => [folder.cid, folder]));
    const fallbackSpace = kind === 'space' ? spaceCid : '';
    const fallbackOrg = kind === 'space' ? orgCid : '';
    rootCid = result.rootCid || fallbackSpace;
    rootSpace = result.spaceCid || fallbackSpace;
    rootOrg = result.orgCid || fallbackOrg;
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
  function folderTarget(folder: TreeNode): CreateFolderTarget {
    const meta = foldersByCid.get(folder.cid);
    const target: CreateFolderTarget = { parentCid: folder.cid };
    const space = meta?.space_cid || rootSpace;
    const org = meta?.org_cid || rootOrg;
    if (space) target.spaceCid = space;
    if (org) target.orgCid = org;
    return target;
  }
  async function createFolderIn(folder: TreeNode, newName: string) {
    actionError = '';
    await api.createFolder(folderTarget(folder), newName);
    await refreshAfter('已创建');
  }
  function rootTarget(): CreateFolderTarget {
    if (!rootSpace) throw new Error('无法确定空间根目录，请先在墨刀工作台中创建。');
    const target: CreateFolderTarget = { spaceCid: rootSpace };
    if (rootOrg) target.orgCid = rootOrg;
    return target;
  }
  async function startRootCreate(type: DialogType) {
    actionError = ''; dialogError = ''; dialogName = '';
    expanded = true;
    if (!loaded) await load();
    if (destroyed || error) return;
    dialog = { type };
    await tick();
    dialogInput?.focus(); dialogInput?.select();
  }
  function cancelRoot() {
    if (saving) return;
    dialog = null; dialogError = '';
  }
  async function submitRoot() {
    if (!dialog || saving) return;
    const clean = normalizeName(dialogName);
    if (!clean) { dialogError = '名称需为 1–80 个字符，且不能包含控制字符。'; return; }
    saving = true; dialogError = ''; actionError = '';
    try {
      if (dialog.type === 'folder') await api.createFolder(rootTarget(), clean);
      else {
        if (!rootCid) throw new Error('无法确定空间根目录，请先在墨刀工作台中创建。');
        await api.createFile(dialog.type, rootCid, clean);
      }
      dialog = null;
      await refreshAfter('已创建');
    } catch (cause) {
      dialogError = messageOf(cause);
    } finally { saving = false; }
  }
  function escapeRoot(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    dialog = null; dialogError = '';
  }
  // 菜单跟随触发点。键盘触发时 clientX/clientY 为 0，退回按钮位置。
  function menuPoint(event: MouseEvent) {
    const element = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const rect = element?.getBoundingClientRect();
    return {
      x: event.clientX || (rect ? rect.left : 0),
      y: event.clientY || (rect ? rect.bottom : 0),
    };
  }
  function showRootMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const point = menuPoint(event);
    const menu = new Menu('modao-root-menu');
    menu.addItem({ icon: '', label: '新建原型', click: () => { void startRootCreate('proto2'); } });
    menu.addItem({ icon: '', label: '新建设计', click: () => { void startRootCreate('design2'); } });
    menu.addItem({ icon: '', label: '新建文件夹', click: () => { void startRootCreate('folder'); } });
    menu.addItem({ icon: '', label: '刷新子节点', click: () => { expanded = true; void refreshTree(); } });
    menu.open({ ...point, isLeft: true });
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
  <div class="modao-tree-line">
    <button class="modao-row modao-source-title" title={name} aria-expanded={expanded} on:click={toggle}>
      <svg aria-hidden="true" class="modao-node-chevron" class:modao-rotated={expanded}><use href="#modao_chevron" /></svg>
      {#if kind !== 'org'}<svg aria-hidden="true" class="modao-node-icon"><use href="#modao_folder" /></svg>{/if}
      <span>{name}</span>
    </button>
    {#if kind !== 'org'}
      <button class="modao-more" title="更多操作" aria-label={`更多操作：${name}`}
        aria-haspopup="menu" on:click={showRootMenu}><span aria-hidden="true">⋮</span></button>
    {/if}
  </div>
  {#if dialog}
    <div class="modao-dialog modao-root-dialog" role="dialog" aria-label="新建" on:keydown={escapeRoot}>
      <p class="modao-dialog-title">
        在“{name}”中{dialog.type === 'folder' ? '新建文件夹' : dialog.type === 'proto2' ? '新建原型' : '新建设计'}
      </p>
      <form on:submit|preventDefault={submitRoot}>
        <input bind:this={dialogInput} bind:value={dialogName} aria-label="名称" maxlength="80" placeholder="输入名称" disabled={saving} />
        {#if dialogError}<p class="modao-note modao-error" role="alert">{dialogError}</p>{/if}
        <div class="modao-dialog-actions">
          <button type="button" class="modao-text-button" on:click={cancelRoot} disabled={saving}>取消</button>
          <button type="submit" class="modao-text-button modao-primary" disabled={saving}>{saving ? '处理中…' : '确定'}</button>
        </div>
      </form>
    </div>
  {/if}
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
        {#if nodes.length}<Tree {nodes} {onOpen} {onExternal} {onCopy} onCreate={createFile} onCreateFolder={createFolderIn} onRename={rename} onRefresh={refreshTree} />{:else}<p class="modao-note">暂无文件</p>{/if}
      {/if}
    </div>
  {/if}
</section>
