<script lang="ts">
  import { Menu } from 'siyuan';
  import { fileMeta, normalizeName, type TreeNode } from '../lib/model.ts';
  type CreateType = 'proto2' | 'design2';
  type DialogType = CreateType | 'folder';
  export let nodes: TreeNode[] = [];
  export let onOpen: (node: TreeNode) => void;
  export let onCreate: (type: CreateType, folder: TreeNode, name: string) => Promise<void> = async () => {};
  export let onCreateFolder: (folder: TreeNode, name: string) => Promise<void> = async () => {};
  export let onRename: (node: TreeNode, name: string) => Promise<void> = async () => {};
  export let onExternal: (node: TreeNode) => void = () => {};
  export let onCopy: (node: TreeNode) => void = () => {};
  export let onRefresh: (node: TreeNode) => Promise<void> = async () => {};
  let expanded = new Set<string>();
  let dialog: null | { mode: 'create'; type: DialogType; node: TreeNode } | { mode: 'rename'; node: TreeNode } = null;
  let name = '';
  let saving = false;
  let error = '';
  let input: HTMLInputElement | undefined;

  function activate(node: TreeNode) {
    if (node.kind === 'file') { onOpen(node); return; }
    const next = new Set(expanded);
    if (next.has(node.key)) next.delete(node.key); else next.add(node.key);
    expanded = next;
  }
  function focusInput() {
    void Promise.resolve().then(() => { input?.focus(); input?.select(); });
  }
  function startCreate(type: DialogType, folder: TreeNode) {
    error = ''; name = '';
    dialog = { mode: 'create', type, node: folder };
    focusInput();
  }
  function startRename(node: TreeNode) {
    error = ''; name = node.name;
    dialog = { mode: 'rename', node };
    focusInput();
  }
  function cancel() {
    if (saving) return;
    dialog = null; error = '';
  }
  async function submit() {
    if (!dialog || saving) return;
    const clean = normalizeName(name);
    if (!clean) { error = '名称需为 1–80 个字符，且不能包含控制字符。'; return; }
    saving = true; error = '';
    try {
      if (dialog.mode === 'create') {
        if (dialog.type === 'folder') await onCreateFolder(dialog.node, clean);
        else await onCreate(dialog.type, dialog.node, clean);
      } else await onRename(dialog.node, clean);
      dialog = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : '操作失败，请重试。';
    } finally { saving = false; }
  }
  function open(node: TreeNode) {
    dialog = null;
    onOpen(node);
  }
  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    dialog = null; error = '';
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
  function showMenu(node: TreeNode, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const point = menuPoint(event);
    const menu = new Menu('modao-node-menu');
    if (node.kind === 'folder') {
      menu.addItem({ icon: '', label: '新建原型', click: () => startCreate('proto2', node) });
      menu.addItem({ icon: '', label: '新建设计', click: () => startCreate('design2', node) });
      menu.addItem({ icon: '', label: '新建文件夹', click: () => startCreate('folder', node) });
      menu.addItem({ icon: '', label: '刷新子节点', click: () => { void onRefresh(node); } });
    } else {
      const meta = fileMeta(node.fileType);
      if (meta.openable) {
        menu.addItem({ icon: '', label: '用tab打开', click: () => open(node) });
        menu.addItem({ icon: '', label: '在浏览器打开', click: () => onExternal(node) });
        menu.addItem({ icon: '', label: '复制在线链接', click: () => onCopy(node) });
      } else {
        menu.addItem({ icon: '', label: '在工作台打开', click: () => open(node) });
      }
    }
    menu.addItem({ icon: '', label: '重命名', click: () => startRename(node) });
    menu.open({ ...point, isLeft: true });
  }
</script>

<ul class="modao-tree-list">
  {#each nodes as node (node.key)}
    {@const meta = node.kind === 'file' ? fileMeta(node.fileType) : null}
    <li class="modao-tree-item">
      <div class="modao-tree-line">
        <button class="modao-row" title={meta ? `${node.name || '未命名'} · ${meta.label}${meta.openable ? '' : ' · 需在墨刀工作台打开'}` : node.name}
          aria-expanded={node.kind === 'folder' ? expanded.has(node.key) : undefined}
          on:click={() => activate(node)}
          on:contextmenu={(event) => showMenu(node, event)}>
          <svg aria-hidden="true" class="modao-node-chevron" class:modao-rotated={expanded.has(node.key)}>
            <use href={node.kind === 'folder' ? '#modao_chevron' : (meta ? meta.icon : '#modao_type_other')} />
          </svg>
          {#if node.kind === 'folder'}
            <svg aria-hidden="true" class="modao-node-icon"><use href="#modao_folder" /></svg>
          {/if}
          <span>{node.name || '未命名'}</span>
          {#if meta && !meta.openable}
            <span class="modao-type-badge" title="需在墨刀工作台打开">{meta.label}</span>
          {/if}
        </button>
        <button class="modao-more" title="更多操作" aria-label={`更多操作：${node.name || '未命名'}`}
          aria-haspopup="menu" on:click={(event) => showMenu(node, event)}><span aria-hidden="true">⋮</span></button>
      </div>
      {#if dialog && dialog.node.key === node.key}
        <div class="modao-dialog" role="dialog" aria-label={dialog.mode === 'create' ? '新建文件' : '重命名'} on:keydown={escape}>
          <p class="modao-dialog-title">
            {dialog.mode === 'create'
              ? `在“${dialog.node.name || '未命名'}”中${dialog.type === 'folder' ? '新建文件夹' : dialog.type === 'proto2' ? '新建原型' : '新建设计'}`
              : `重命名“${dialog.node.name || '未命名'}”`}
          </p>
          <form on:submit|preventDefault={submit}>
            <input bind:this={input} bind:value={name} aria-label="名称" maxlength="80" placeholder="输入名称" disabled={saving} />
            {#if error}<p class="modao-note modao-error" role="alert">{error}</p>{/if}
            <div class="modao-dialog-actions">
              <button type="button" class="modao-text-button" on:click={cancel} disabled={saving}>取消</button>
              <button type="submit" class="modao-text-button modao-primary" disabled={saving}>{saving ? '处理中…' : '确定'}</button>
            </div>
          </form>
        </div>
      {/if}
      {#if node.kind === 'folder' && expanded.has(node.key)}
        <div class="modao-indent">
          {#if node.children.length}<svelte:self nodes={node.children} {onOpen} {onCreate} {onCreateFolder} {onRename} {onExternal} {onCopy} {onRefresh} />
          {:else}<p class="modao-note">暂无文件</p>{/if}
        </div>
      {/if}
    </li>
  {/each}
</ul>
