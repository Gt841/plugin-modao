import { Plugin, openTab, showMessage, confirm, type ITab, type ITabModel } from 'siyuan';
import Dock from './components/Dock.svelte';
import WebPane from './components/WebPane.svelte';
import { SessionBridge } from './lib/bridge.ts';
import { ModaoApi } from './lib/api.ts';
import { PARTITION, WORKSPACE_URL, safeViewUrl, editorUrl, type TreeNode } from './lib/model.ts';
import { TabPool } from './lib/tab-pool.ts';
import { installNavigationGuard } from './lib/navigation.ts';
import './index.css';

const TAB_TYPE = 'modao_view';
const ICONS = `<symbol id="modao_logo" viewBox="0 0 24 24"><rect x="2" y="2" width="4" height="9" rx="0.3"/><rect x="9" y="2" width="4" height="9" rx="0.3"/><path d="M17 2h5v6c0 7-3 11-8 14l-2-4c4-2 5-5 5-10z"/></symbol>
<symbol id="modao_chevron" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7-1.5-1.5L13 12 7.5 6.5z"/></symbol>
<symbol id="modao_refresh" viewBox="0 0 24 24"><path d="M20 4v7h-7l2.7-2.7A6 6 0 1 0 18 14h2a8 8 0 1 1-3-7.1z"/></symbol>
<symbol id="modao_login" viewBox="0 0 24 24"><path d="M14 3h7v18h-7v-2h5V5h-5zM10 7l5 5-5 5-1.4-1.4 2.6-2.6H2v-2h9.2L8.6 8.4z"/></symbol>
<symbol id="modao_logout" viewBox="0 0 24 24"><path d="M3 3h8v2H5v14h6v2H3zM17 7l5 5-5 5-1.4-1.4 2.6-2.6H9v-2h9.2l-2.6-2.6z"/></symbol>`;

export default class ModaoPlugin extends Plugin {
  private dock?: Dock;
  private bridge = new SessionBridge();
  private api = new ModaoApi(this.bridge);
  private views = new Map<ITabModel, WebPane>();
  private liveTabs = new Map<string, ITab>();
  private titles = new Map<string, string>();
  private disposed = false;
  private loggingOut = false;
  private epoch = 0;
  private removeNavigationGuard?: () => void;
  private tabs = new TabPool<ITab>(url => this.createView(url), tab => !!tab.headElement?.isConnected, tab => tab.headElement.click());

  onload(): void {
    this.addIcons(ICONS);
    try {
      const remote = (window as any).require('@electron/remote');
      this.removeNavigationGuard = installNavigationGuard(remote.session.fromPartition(PARTITION).webRequest);
    } catch {
      showMessage('墨刀需要思源桌面主窗口的独立会话支持，当前环境无法安全加载工作台。',6000,'error');
    }
    const plugin = this;
    // A single registered type restores on startup. SiYuan distinguishes custom
    // tabs by type + data; data contains only the stable URL, never a changing title.
    this.addTab({
      type: TAB_TYPE,
      init() {
        const url = this.data?.url;
        if (plugin.disposed || plugin.loggingOut || !plugin.removeNavigationGuard || !safeViewUrl(url)) {
          this.element.textContent = '墨刀页签地址无效或会话已关闭，请从侧栏重新打开。';
          return;
        }
        this.element.classList.add('modao-tab');
        plugin.liveTabs.set(url, this.tab);
        const pane = new WebPane({target:this.element, props:{
          src:url,
          onRefresh:() => plugin.dock?.refresh(),
          onExternal:() => plugin.openExternal(url),
        }});
        plugin.views.set(this, pane);
      },
      destroy() {
        plugin.views.get(this)?.$destroy(); plugin.views.delete(this);
        const url = this.data?.url;
        if (plugin.liveTabs.get(url) === this.tab) plugin.liveTabs.delete(url);
        plugin.tabs.forget(url, this.tab); plugin.titles.delete(url);
      },
    });
    this.addDock({
      config:{position:'LeftBottom',size:{width:240,height:0},icon:'modao_logo',title:'墨刀'},
      data:{}, type:'modao_dock',
      init(dock) {
        plugin.dock?.$destroy();
        if (!plugin.removeNavigationGuard) {
          dock.element.textContent = '无法建立安全的墨刀会话，请在思源桌面主窗口启用本插件。';
          return;
        }
        plugin.dock = new Dock({target:dock.element,props:{
          api:plugin.api, bridge:plugin.bridge, sessionActive:!plugin.loggingOut,
          onWorkspace:() => { void plugin.openView(WORKSPACE_URL, '墨刀工作台').catch(() => showMessage('无法打开墨刀工作台。',6000,'error')); },
          onOpen:(node:TreeNode) => { void plugin.openFile(node).catch(() => showMessage('无法打开墨刀文件。',6000,'error')); },
          onLogout:() => plugin.confirmLogout(),
        }});
      },
      destroy() { plugin.dock?.$destroy(); plugin.dock = undefined; },
    });
  }
  async openView(url: string, title: string): Promise<ITab> {
    if (this.disposed || this.loggingOut || !this.removeNavigationGuard || !safeViewUrl(url)) throw new Error('墨刀页签不可用');
    this.titles.set(url, title);
    return this.tabs.open(url);
  }
  async openFile(node: TreeNode): Promise<void> {
    const url = editorUrl(node.fileType || '', node.cid);
    if (!url) showMessage('此文件类型尚未支持直接定位，请在墨刀工作台中打开。');
    await this.openView(url || WORKSPACE_URL, url ? node.name : '墨刀工作台');
  }
  private async createView(url: string): Promise<ITab> {
    if (this.disposed || this.loggingOut) throw new Error('会话已关闭');
    const existing = this.liveTabs.get(url);
    if (existing?.headElement?.isConnected) { existing.headElement.click(); return existing; }
    const epoch = this.epoch;
    const tab = await openTab({app:this.app,custom:{id:this.name + TAB_TYPE,icon:'modao_logo',title:this.titles.get(url) || '墨刀',data:{url}}});
    if (this.disposed || this.loggingOut || epoch !== this.epoch) { tab?.close(); throw new Error('会话已关闭'); }
    if (!tab) throw new Error('未能创建页签');
    return tab;
  }
  private openExternal(url: string): void {
    if (!safeViewUrl(url)) return;
    try {
      const electron = (window as any).require('electron');
      const shell = electron.shell || (window as any).require('@electron/remote').shell;
      Promise.resolve(shell.openExternal(url)).catch(() => showMessage('无法打开浏览器。',6000,'error'));
    } catch { showMessage('当前环境不支持打开外部浏览器。',6000,'error'); }
  }
  async confirmLogout(): Promise<boolean> {
    if (this.loggingOut || this.disposed) return false;
    const approved = await new Promise<boolean>(resolve => confirm('退出墨刀登录',
      '将关闭本插件的墨刀页签并清除插件内的登录状态。未保存的编辑可能丢失，请先确认已保存。不会影响外部浏览器、BoardMix 或 PPTGo。',
      () => resolve(true), () => resolve(false)));
    if (!approved || this.disposed || this.loggingOut) return false;
    this.loggingOut = true; this.epoch++;
    try {
      await this.dock?.suspend();
      for (const tab of [...this.liveTabs.values()]) tab.close();
      this.tabs.clear(); this.liveTabs.clear(); this.titles.clear();
      const remote = (window as any).require('@electron/remote');
      const session = remote.session.fromPartition(PARTITION);
      await session.clearStorageData();
      await session.clearCache();
      return true;
    } catch {
      showMessage('未能清除墨刀会话，请在墨刀工作台内退出登录。',6000,'error');
      return false;
    } finally {
      this.loggingOut = false;
      this.dock?.resume();
    }
  }
  onunload(): void {
    this.disposed = true; this.epoch++;
    this.dock?.$destroy(); this.dock = undefined;
    for (const pane of this.views.values()) pane.$destroy();
    this.views.clear(); this.liveTabs.clear(); this.tabs.clear(); this.titles.clear();
    this.bridge.dispose();
    try { this.removeNavigationGuard?.(); } catch { /* Electron may already be shutting down. */ }
    this.removeNavigationGuard = undefined;
  }
}
