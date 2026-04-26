export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";

  const removableParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
  for (const key of removableParams) {
    url.searchParams.delete(key);
  }

  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  const serialized = url.toString();
  return serialized.endsWith("/") ? serialized.slice(0, -1) : serialized;
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
