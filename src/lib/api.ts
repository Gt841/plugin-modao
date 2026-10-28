import { BridgeError, type WriteRequest } from './bridge.ts';
import { normalizeName, validCid, type Folder, type Project } from './model.ts';

export interface Transport {
  get(path: string): Promise<unknown>;
  write(request: WriteRequest): Promise<void>;
}
export type CreateType = 'proto2' | 'design2';
export interface NamedItem { cid: string; name: string }
export interface SpaceContext { orgCid: string; spaceCid: string }
export interface Contents { folders: Folder[]; projects: Project[]; limited: boolean }
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeError('schema');
  return value;
}
function named(value: unknown): NamedItem {
  const item = object(value);
  if (!validCid(item.cid) || typeof item.name !== 'string') throw new BridgeError('schema');
  return { cid: item.cid, name: item.name };
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new BridgeError('schema');
  return value;
}
function optionalCid(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (!validCid(value)) throw new BridgeError('schema');
  return value;
}

// These are the routes and fields consumed by the public Modao web client.
// They are internal APIs, not a stable public API contract. Reject unknown shapes.
export class ModaoApi {
  private transport: Transport;
  constructor(transport: Transport) { this.transport = transport; }
  async checkLogin(): Promise<void> {
    const body = object(await this.transport.get('/api/dashboard/v5/users/detail'));
    if (!body.user || !validCid(body.user.cid)) throw new BridgeError('authentication');
  }
  async organizations(): Promise<NamedItem[]> {
    const body = object(await this.transport.get('/api/dashboard/v6/orgs'));
    return list(body.orgs).map(named);
  }
  async spaces(orgCid: string): Promise<NamedItem[]> {
    if (!validCid(orgCid)) throw new BridgeError('forbidden');
    const body = object(await this.transport.get(`/api/dsh2/web_v1/org_entry/${orgCid}`));
    return list(body.spaces).map(named);
  }
  async contents(context?: SpaceContext): Promise<Contents> {
    if (context && (!validCid(context.orgCid) || !validCid(context.spaceCid))) throw new BridgeError('forbidden');
    const path = context
      ? `/api/dsh2/web_v1/space_entry/${context.spaceCid}?org=${context.orgCid}`
      : '/api/dashboard/v5/me';
    const body = object(await this.transport.get(path));
    const folders: Folder[] = list(body.teams).map(value => {
      const item = object(value);
      if (item.root_project != null && typeof item.root_project !== 'boolean') throw new BridgeError('schema');
      return { ...named(item), parent_cid: optionalCid(item.parent_cid), root_project: item.root_project === true };
    });
    const projects: Project[] = list(body.projects).map(value => {
      const item = object(value);
      if (typeof item.type !== 'string' || !item.type) throw new BridgeError('schema');
      const project: Project = { ...named(item), type: item.type };
      const teamCid = optionalCid(item.team_cid);
      if (teamCid) project.team_cid = teamCid;
      return project;
    });
    // The observed routes have no paging parameters. Never invent continuation
    // calls. Tell the user to use the workspace when a partial result is indicated.
    const limited = !!(body.has_more || body.next || body.next_page || body.next_cursor)
      || (typeof body.total === 'number' && body.total > projects.length + folders.length)
      || (typeof body.total_count === 'number' && body.total_count > projects.length + folders.length);
    return { folders, projects, limited };
  }
  async createFile(type: CreateType, folderCid: string, name: string): Promise<void> {
    if (type !== 'proto2' && type !== 'design2') throw new BridgeError('invalid');
    if (!validCid(folderCid)) throw new BridgeError('invalid');
    const clean = normalizeName(name);
    if (!clean) throw new BridgeError('invalid');
    await this.transport.write({ kind: 'create', type, teamCid: folderCid, name: clean });
  }
  async rename(kind: 'file' | 'folder', cid: string, name: string): Promise<void> {
    if (kind !== 'file' && kind !== 'folder') throw new BridgeError('invalid');
    if (!validCid(cid)) throw new BridgeError('invalid');
    const clean = normalizeName(name);
    if (!clean) throw new BridgeError('invalid');
    await this.transport.write({ kind: 'rename', target: kind === 'file' ? 'project' : 'team', cid, name: clean });
  }
}
