<script lang="ts">
  import { onMount } from 'svelte';
  import { PARTITION, WORKSPACE_URL } from '../lib/model.ts';
  import type { SessionBridge } from '../lib/bridge.ts';
  export let src: string;
  export let bridge: SessionBridge | undefined = undefined;
  export let onReady: () => void = () => {};
  export let onFailure: (message: string) => void = () => {};
  let page: any;
  let timeout: ReturnType<typeof setTimeout>;
  export function reload() {
    if (!page) return;
    bridge?.detach(page);
    Promise.resolve(page.loadURL(bridge ? WORKSPACE_URL : src)).catch(() => onFailure('页面加载失败，请重试。'));
  }
  onMount(() => {
    const start = (event: any) => {
      if (event.isMainFrame === false || event.isInPlace) return;
      bridge?.detach(page); clearTimeout(timeout);
      timeout = setTimeout(() => onFailure('墨刀页面加载超时，请检查网络或在工作台重试。'), 25000);
    };
    const ready = () => { clearTimeout(timeout); bridge?.attach(page); onReady(); };
    const failed = (event: any) => {
      if (event.errorCode === -3 || event.isMainFrame === false) return;
      clearTimeout(timeout); bridge?.detach(page);
      onFailure('墨刀页面加载失败，请检查网络后重试。');
    };
    const popup = () => { onFailure('此操作需要外部窗口，请通过浏览器中的墨刀工作台完成。'); };
    const handlers: Record<string, (event: any) => void> = {
      'dom-ready': ready, 'did-start-navigation': start, 'did-fail-load': failed,
      'new-window': popup, 'render-process-gone': failed,
    };
    for (const [event, handler] of Object.entries(handlers)) page.addEventListener(event, handler);
    start({});
    return () => {
      clearTimeout(timeout); bridge?.detach(page);
      for (const [event, handler] of Object.entries(handlers)) page.removeEventListener(event, handler);
    };
  });
</script>

<webview bind:this={page} {src} partition={PARTITION}
  webpreferences="contextIsolation=yes,sandbox=yes,nodeIntegration=no"
  allowfullscreen class="modao-guest"></webview>
