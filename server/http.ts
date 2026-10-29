export function timedFetch(url: string | URL, init: RequestInit = {}, timeoutMs = 10000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
