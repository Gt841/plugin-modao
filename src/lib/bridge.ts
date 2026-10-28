import { normalizeName, validCid } from './model.ts';

export type ErrorKind = 'not-ready' | 'authentication' | 'forbidden' | 'not-found' | 'schema' | 'network' | 'timeout' | 'cancelled' | 'http' | 'invalid' | 'rejected' | 'conflict';
const messages: Record<ErrorKind, string> = {
  'not-ready': '墨刀会话尚未就绪，请打开工作台登录后刷新。',
  authentication: '请在墨刀工作台完成登录，再点击“刷新目录”。',
  forbidden: '墨刀拒绝访问此目录，请在工作台检查账号权限。',
  'not-found': '墨刀目录接口已变更（404），请先使用工作台。',
  schema: '墨刀返回了无法识别的目录数据，请先使用工作台。',
  network: '无法连接墨刀，请检查网络后重试。',
  timeout: '墨刀请求超时，请稍后重试。',
  cancelled: '请求已取消。',
  http: '墨刀服务暂时不可用，请稍后重试。',
  invalid: '名称需为 1–80 个字符，且不能包含控制字符。',
  rejected: '墨刀拒绝了这次修改，请检查名称或权限后重试。',
  conflict: '名称已存在，请换一个名称后重试。',
};
export class BridgeError extends Error {
  kind: ErrorKind;
  status?: number;
  constructor(kind: ErrorKind, status?: number) {
    super(messages[kind]); this.name = 'BridgeError'; this.kind = kind; this.status = status;
  }
}
export function allowedPath(path: string): boolean {
  return /^\/api\/dashboard\/v5\/(users\/detail|me)$/.test(path)
    || path === '/api/dashboard/v6/orgs'
    || /^\/api\/dsh2\/web_v1\/org_entry\/[A-Za-z0-9_-]{1,128}$/.test(path)
    || /^\/api\/dsh2\/web_v1\/space_entry\/[A-Za-z0-9_-]{1,128}\?org=[A-Za-z0-9_-]{1,128}$/.test(path);
}

// The guest performs its own same-origin GET. Cookies and browser storage are
// never extracted; only the directory fields needed by the dock leave the guest.
export function requestScript(path: string): string {
  if (!allowedPath(path)) throw new BridgeError('forbidden');
  return `(async () => {
    if (location.origin !== 'https://modao.cc') return {error:'authentication'};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(${JSON.stringify(path)}, {
        method:'GET', credentials:'same-origin', redirect:'error',
        headers:{accept:'application/json'}, signal:controller.signal
      });
      if (!response.ok) return {status:response.status};
      if (!(response.headers.get('content-type') || '').includes('application/json')) return {error:'authentication'};
      let body;
      try { body = await response.json(); } catch { return {error:'schema'}; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return {error:'schema'};
      const pick = (value, keys) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const result = {};
        for (const key of keys) {
          const field = value[key];
          if (field === null || ['string','number','boolean'].includes(typeof field)) result[key] = field;
        }
        return result;
      };
      const list = (value, keys) => Array.isArray(value) ? value.map(item => pick(item, keys)) : null;
      const data = {};
      if ('user' in body) data.user = pick(body.user, ['cid']);
      for (const key of ['org','space']) if (key in body) data[key] = pick(body[key], ['cid','name','otype']);
      for (const key of ['orgs','spaces']) if (key in body) data[key] = list(body[key], ['cid','name','otype']);
      if ('teams' in body) data.teams = list(body.teams, ['cid','name','parent_cid','root_project']);
      if ('projects' in body) data.projects = list(body.projects, ['cid','name','type','team_cid']);
      for (const key of ['total','total_count','has_more','next','next_page','next_cursor','page','page_size']) {
        if (key in body) data[key] = pick(body, [key])[key];
      }
      return {status:response.status, data};
    } catch (error) {
      return {error:controller.signal.aborted ? 'timeout' : 'network'};
    } finally { clearTimeout(timeout); }
  })()`;
}
export type WriteRequest =
  | { kind: 'create'; type: 'proto2' | 'design2'; teamCid: string; name: string }
  | { kind: 'rename'; target: 'project' | 'team'; cid: string; name: string };

interface WriteSpec {
  method: 'POST' | 'PUT';
  path: string;
  body: unknown;
}

function jsonLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/[\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16)}`);
}

// Creation and renaming use the same internal routes as the public client.
// Only the two approved project types can be created; delete and move are not exposed.
function writeSpec(request: WriteRequest): WriteSpec {
  const name = normalizeName(request?.name);
  if (!name) throw new BridgeError('invalid');
  if (request.kind === 'create') {
    if (!validCid(request.teamCid)) throw new BridgeError('invalid');
    if (request.type === 'proto2') return {
      method: 'POST',
      path: `/flpak/w-paknew?upperType=project-basic&type=proto2&teamCid=${request.teamCid}`,
      body: { name, device: 'iphone', model: 'iPhoneX', width: 375, height: 812 },
    };
    if (request.type === 'design2') return {
      method: 'POST',
      path: `/api/design/web_v1/create_design_project?teamCid=${request.teamCid}`,
      body: { newOpt: { name } },
    };
    throw new BridgeError('invalid');
  }
  if (request.kind === 'rename') {
    if (!validCid(request.cid)) throw new BridgeError('invalid');
    if (request.target === 'project') return {
      method: 'PUT',
      path: `/api/dashboard/v5/projects/${request.cid}`,
      body: { project: { cid: request.cid, name } },
    };
    if (request.target === 'team') return {
      method: 'PUT',
      path: `/api/dashboard/v5/teams/${request.cid}`,
      body: { team: { name } },
    };
    throw new BridgeError('invalid');
  }
  throw new BridgeError('invalid');
}

// Writes never return response bodies; the caller refreshes the directory instead.
export function writeScript(request: WriteRequest): string {
  const { method, path, body } = writeSpec(request);
  return `(async () => {
    if (location.origin !== 'https://modao.cc') return {error:'authentication'};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(${jsonLiteral(path)}, {
        method:${jsonLiteral(method)}, credentials:'same-origin', redirect:'error',
        headers:{accept:'application/json','content-type':'application/json'},
        body:${jsonLiteral(JSON.stringify(body))}, signal:controller.signal
      });
      return {status:response.status};
    } catch (error) {
      return {error:controller.signal.aborted ? 'timeout' : 'network'};
    } finally { clearTimeout(timeout); }
  })()`;
}

export interface GuestPage {
  getURL(): string;
  executeJavaScript(script: string): Promise<unknown>;
}
export class SessionBridge {
  private page?: GuestPage;
  private epoch = 0;
  private disposed = false;
  private pending = new Set<() => void>();
  get ready(): boolean { return !!this.page && !this.disposed; }
  attach(page: GuestPage): void {
    if (this.disposed) return;
    this.invalidate(); this.page = page;
  }
  detach(page: GuestPage): void {
    if (this.page !== page) return;
    this.invalidate(); this.page = undefined;
  }
  private invalidate(): void {
    this.epoch++;
    for (const cancel of this.pending) cancel();
    this.pending.clear();
  }
  dispose(): void {
    this.disposed = true; this.invalidate(); this.page = undefined;
  }
  private async run(script: string, timeout: number): Promise<Record<string, any>> {
    if (this.disposed) throw new BridgeError('cancelled');
    const page = this.page;
    if (!page) throw new BridgeError('not-ready');
    try {
      const url = new URL(page.getURL());
      if (url.origin !== 'https://modao.cc' || !/^\/workspace(?:\/|$)/.test(url.pathname)) throw new Error();
    } catch { throw new BridgeError('authentication'); }
    const epoch = this.epoch;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel = () => {};
    const guard = new Promise<never>((_, reject) => {
      cancel = () => reject(new BridgeError('cancelled'));
      this.pending.add(cancel);
      timer = setTimeout(() => reject(new BridgeError('timeout')), timeout);
    });
    try {
      const result: any = await Promise.race([page.executeJavaScript(script), guard]);
      if (epoch !== this.epoch || this.disposed) throw new BridgeError('cancelled');
      if (!result || typeof result !== 'object') throw new BridgeError('schema');
      if (result.error) throw new BridgeError(result.error in messages ? result.error : 'network');
      if (typeof result.status !== 'number') throw new BridgeError('schema');
      return result;
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      throw new BridgeError('network');
    } finally {
      clearTimeout(timer); this.pending.delete(cancel);
    }
  }
  async get(path: string): Promise<unknown> {
    const result = await this.run(requestScript(path), 15000);
    if (result.status === 401) throw new BridgeError('authentication', 401);
    if (result.status === 403) throw new BridgeError('forbidden', 403);
    if (result.status === 404) throw new BridgeError('not-found', 404);
    if (!(result.status >= 200 && result.status < 300)) throw new BridgeError('http', result.status);
    if (!result.data || typeof result.data !== 'object') throw new BridgeError('schema');
    return result.data;
  }
  async write(request: WriteRequest): Promise<void> {
    const result = await this.run(writeScript(request), 25000);
    if (result.status === 400) throw new BridgeError('rejected', 400);
    if (result.status === 401) throw new BridgeError('authentication', 401);
    if (result.status === 403) throw new BridgeError('forbidden', 403);
    if (result.status === 404) throw new BridgeError('not-found', 404);
    if (result.status === 409) throw new BridgeError('conflict', 409);
    if (!(result.status >= 200 && result.status < 300)) throw new BridgeError('http', result.status);
  }
}
