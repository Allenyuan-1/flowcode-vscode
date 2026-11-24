import type { HostToWebview, WebviewToHost } from './messages';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

const api = typeof window !== 'undefined' ? window.acquireVsCodeApi?.() : undefined;

export const isVsCode = Boolean(api);

export function post(message: WebviewToHost): void {
  if (api) {
    api.postMessage(message);
    return;
  }
  if (message.type === 'copy' && navigator.clipboard) {
    void navigator.clipboard.writeText(message.text);
  }
  if (message.type === 'toast') {
    // eslint-disable-next-line no-console
    console.info(`[FlowCode] ${message.message}`);
  }
}

export function subscribe(handler: (message: HostToWebview) => void): () => void {
  const listener = (event: MessageEvent<HostToWebview>) => handler(event.data);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export function persistedState<T>(): T | undefined {
  try {
    return api?.getState() as T | undefined;
  } catch {
    return undefined;
  }
}

export function persistState(state: unknown): void {
  try {
    api?.setState(state);
  } catch {
    // ignore
  }
}
