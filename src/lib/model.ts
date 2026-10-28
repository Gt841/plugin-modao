export const ORIGIN = 'https://modao.cc';
export const WORKSPACE_URL = ORIGIN + '/workspace/home';
export const PARTITION = 'persist:modao';

export interface Project {
  cid: string;
  name: string;
  type: string;
  team_cid?: string;
}

export interface Folder {
  cid: string;
  name: string;
  parent_cid?: string | null;
  root_project?: boolean;
}

export interface TreeNode {
  key: string;
  cid: string;
  name: string;
  kind: 'folder' | 'file';
  fileType?: string;
  children: TreeNode[];
}

export function validCid(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128
    && !/[^A-Za-z0-9_-]/.test(value);
}

export function editorUrl(type: string, cid: string): string | null {
  if (!validCid(cid)) return null;
  switch (type) {
    case 'proto2': return `${ORIGIN}/proto/design/${cid}`;
    case 'prototype': return `${ORIGIN}/app/design/${cid}`;
    case 'design2': return `${ORIGIN}/design/editor/${cid}`;
    default: return null;
  }
}

export function safeViewUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // Match the original URL: URL parsing would normalize away traversal or whitespace.
  const allowed = /^https:\/\/modao\.cc(?::443)?\/(?:workspace\/home\/?|(?:proto\/design|app\/design|design\/editor)\/[A-Za-z0-9_-]{1,128})$/;
  // JavaScript's $ also matches before a final newline; require a complete match.
  return allowed.exec(value)?.[0] === value;
}

export function buildTree(scope: string, folders: Folder[], projects: Project[]): TreeNode[] {
  const uniqueFolders = new Map<string, Folder>();
  for (const folder of folders) {
    if (!uniqueFolders.has(folder.cid)) uniqueFolders.set(folder.cid, folder);
  }

  const parents = new Map<string, string>();
  for (const folder of uniqueFolders.values()) {
    if (folder.parent_cid != null && uniqueFolders.has(folder.parent_cid)) {
      parents.set(folder.cid, folder.parent_cid);
    }
  }

  // Each folder has at most one parent. Break one edge per cycle, without recursion.
  const visited = new Set<string>();
  for (const cid of uniqueFolders.keys()) {
    const path = new Set<string>();
    let current: string | undefined = cid;
    while (current !== undefined && !visited.has(current)) {
      if (path.has(current)) {
        parents.delete(current);
        break;
      }
      path.add(current);
      current = parents.get(current);
    }
    for (const member of path) visited.add(member);
  }

  const folderNodes = new Map<string, TreeNode>();
  const virtualRoots = new Set<string>();
  for (const folder of uniqueFolders.values()) {
    folderNodes.set(folder.cid, {
      key: JSON.stringify([scope, 'folder', folder.cid]),
      cid: folder.cid,
      name: folder.name,
      kind: 'folder',
      children: [],
    });
    if (folder.root_project) virtualRoots.add(folder.cid);
  }

  const roots: TreeNode[] = [];
  for (const [cid, node] of folderNodes) {
    const parentCid = parents.get(cid);
    const parent = parentCid === undefined ? undefined : folderNodes.get(parentCid);
    (parent ? parent.children : roots).push(node);
  }

  const seenProjects = new Set<string>();
  for (const project of projects) {
    if (seenProjects.has(project.cid)) continue;
    seenProjects.add(project.cid);
    const parent = project.team_cid === undefined ? undefined : folderNodes.get(project.team_cid);
    (parent ? parent.children : roots).push({
      key: JSON.stringify([scope, 'file', project.cid]),
      cid: project.cid,
      name: project.name,
      kind: 'file',
      fileType: project.type,
      children: [],
    });
  }

  // Promote virtual-root children into the same output list, at any depth.
  const result: TreeNode[] = [];
  const pending = [{ input: roots, output: result }];
  while (pending.length) {
    const { input, output } = pending.pop()!;
    for (const node of input) {
      if (node.kind === 'folder' && virtualRoots.has(node.cid)) {
        pending.push({ input: node.children, output });
      } else {
        output.push(node);
        const children = node.children;
        node.children = [];
        if (children.length) pending.push({ input: children, output: node.children });
      }
    }
  }

  const compare = (left: TreeNode, right: TreeNode): number => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
    return left.name.localeCompare(right.name, 'zh-CN') || left.key.localeCompare(right.key);
  };
  result.sort(compare);
  for (const node of folderNodes.values()) node.children.sort(compare);
  return result;
}
