chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type !== "extract-page-summary") return;

  const summary = {
    title: document.title,
    description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? "",
    canonicalUrl: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? location.href,
    headings: [...document.querySelectorAll("h1,h2")]
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .slice(0, 8),
    snippet: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 1200)
  };

  sendResponse(summary);
});
