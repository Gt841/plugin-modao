interface RequestDetails { url: string; resourceType: string }
type Listener = (details: RequestDetails, callback: (result: {cancel: boolean}) => void) => void;
export interface WebRequest {
  onBeforeRequest(filter: {urls: string[]}, listener: Listener): void;
  onBeforeRequest(listener: null): void;
}

// Unlike webview's will-navigate event, WebRequest's asynchronous callback can
// cancel requests. Apply only to this plugin's session, never the default session.
export function installNavigationGuard(webRequest: WebRequest): () => void {
  webRequest.onBeforeRequest({urls:['<all_urls>']}, (details, callback) => {
    if (details.resourceType !== 'mainFrame') { callback({cancel:false}); return; }
    let allowed = false;
    try {
      const url = new URL(details.url);
      allowed = url.protocol === 'https:' && !url.username && !url.password && !url.port
        && (url.hostname === 'modao.cc' || url.hostname.endsWith('.modao.cc'));
    } catch { /* malformed main-frame destinations are blocked */ }
    callback({cancel:!allowed});
  });
  return () => webRequest.onBeforeRequest(null);
}
