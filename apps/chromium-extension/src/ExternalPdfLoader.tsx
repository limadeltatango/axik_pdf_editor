import { useState } from "react";

const MAX_REMOTE_PDF_BYTES = 200 * 1024 * 1024;

function requestedPdfUrl(): URL | undefined {
  const value = new URLSearchParams(window.location.search).get("sourceUrl");
  if (!value || value.length > 8000) return undefined;
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function safePdfFilename(url: URL): string {
  const raw = decodeURIComponent(url.pathname.split("/").pop() || "download.pdf");
  const sanitized = raw.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 140) || "download.pdf";
  return sanitized.toLowerCase().endsWith(".pdf") ? sanitized : sanitized + ".pdf";
}

/** User-initiated, origin-permission-gated acquisition. No cookies or site scraping. */
async function fetchPdf(url: URL, signal: AbortSignal): Promise<File> {
  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    redirect: "follow",
    signal
  });
  if (!response.ok || !response.body) {
    throw new Error("PDF request failed (HTTP " + response.status + ").");
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_REMOTE_PDF_BYTES) throw new RangeError("PDF exceeds the 200 MB safety limit.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REMOTE_PDF_BYTES) {
        throw new RangeError("PDF exceeds the 200 MB safety limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("The selected link returned an empty file.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // PDF signature may begin after a small transport prefix, but no HTML page
  // or unknown binary is accepted as a PDF.
  const signature = new TextDecoder("ascii").decode(bytes.subarray(0, Math.min(1024, total)));
  if (!signature.includes("%PDF-")) throw new TypeError("The link did not return a PDF. Download it manually.");
  return new File([bytes], safePdfFilename(url), { type: "application/pdf" });
}

export function ExternalPdfLoader({ onLoaded }: { onLoaded: (file: File) => void }) {
  const url = requestedPdfUrl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [controller, setController] = useState<AbortController>();

  if (!url || loaded) return null;

  async function openLink() {
    // IMPORTANT: permissions.request must originate from this actual click,
    // not from an effect, timer or automatically launched page.
    const originPattern = url!.origin + "/*";
    let allowed = false;
    try {
      allowed = await chrome.permissions.request({ origins: [originPattern] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Site permission request failed.");
      return;
    }
    if (!allowed) {
      setError("Site permission was denied. Download the PDF and choose it manually instead.");
      return;
    }
    const pending = new AbortController();
    setController(pending);
    setError(undefined);
    setBusy(true);
    try {
      const file = await fetchPdf(url!, pending.signal);
      onLoaded(file);
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not retrieve this PDF.");
    } finally {
      setBusy(false);
      setController(undefined);
    }
  }

  return (
    <div className="external-pdf-banner" role="region" aria-label="Open remote PDF">
      <span>PDF link: <strong title={url.toString()}>{url.hostname}</strong></span>
      <button onClick={() => void openLink()} disabled={busy}>
        {busy ? "Downloading PDF…" : "Allow site and open PDF"}
      </button>
      {busy && <button onClick={() => controller?.abort()}>Cancel</button>}
      {error && <span role="alert">{error}</span>}
      <span className="external-pdf-note">No sign-in cookies sent. You may instead download and select the file manually.</span>
    </div>
  );
}
