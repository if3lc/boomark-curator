import type { BookmarkRecord, LinkCheckResult, Settings } from "../shared/types";
import { isHttpUrl } from "../shared/url";

export async function checkLink(record: BookmarkRecord, settings: Settings): Promise<LinkCheckResult> {
  if (!record.url || !isHttpUrl(record.url)) {
    return result(record, "unsupported-scheme");
  }

  if (requiresOpaqueProbe(record.url)) {
    return opaqueProbe(record, settings);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.linkTimeoutMs);

  try {
    const head = await fetch(record.url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store"
    });
    return classify(record, head);
  } catch (error) {
    if (controller.signal.aborted) {
      return result(record, "timeout", undefined, String(error));
    }
  } finally {
    clearTimeout(timeout);
  }

  const fallbackController = new AbortController();
  const fallbackTimeout = setTimeout(() => fallbackController.abort(), settings.linkTimeoutMs);
  try {
    const response = await fetch(record.url, {
      method: "GET",
      redirect: "follow",
      signal: fallbackController.signal,
      cache: "no-store"
    });
    return classify(record, response);
  } catch (error) {
    return result(record, fallbackController.signal.aborted ? "timeout" : "network-error", undefined, String(error));
  } finally {
    clearTimeout(fallbackTimeout);
  }
}

async function opaqueProbe(record: BookmarkRecord, settings: Settings): Promise<LinkCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.linkTimeoutMs);
  try {
    await fetch(record.url!, {
      method: "GET",
      mode: "no-cors",
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store"
    });
    return result(record, "restricted", undefined, "Browser-protected URL; checked with opaque no-cors probe.");
  } catch (error) {
    return result(record, controller.signal.aborted ? "timeout" : "restricted", undefined, String(error));
  } finally {
    clearTimeout(timeout);
  }
}

function requiresOpaqueProbe(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore")) ||
      url.hostname === "chromewebstore.google.com"
    );
  } catch {
    return false;
  }
}

export async function checkLinks(records: BookmarkRecord[], settings: Settings, onProgress: (done: number) => Promise<void> | void): Promise<LinkCheckResult[]> {
  const queue = [...records];
  const results: LinkCheckResult[] = [];
  let done = 0;

  async function worker(): Promise<void> {
    while (queue.length) {
      const record = queue.shift();
      if (!record) return;
      results.push(await checkLink(record, settings));
      done += 1;
      await onProgress(done);
    }
  }

  const workers = Array.from({ length: Math.max(1, settings.linkConcurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

function classify(record: BookmarkRecord, response: Response): LinkCheckResult {
  if (response.status === 401 || response.status === 403 || response.status === 405 || response.status === 429) {
    return result(record, "restricted", response);
  }
  if (response.status === 404 || response.status === 410) {
    return result(record, "missing", response);
  }
  if (response.ok || (response.status >= 300 && response.status < 400)) {
    return result(record, "reachable", response);
  }
  return result(record, "network-error", response);
}

function result(record: BookmarkRecord, status: LinkCheckResult["status"], response?: Response, error?: string): LinkCheckResult {
  return {
    bookmarkId: record.id,
    url: record.url ?? "",
    status,
    httpStatus: response?.status,
    finalUrl: response?.url,
    error,
    checkedAt: new Date().toISOString()
  };
}
