"use client";

import { useState } from "react";

/** A "Copy link" button beside a URL the server rendered.
 *
 * The URL itself is rendered by the SERVER (from request headers), never
 * derived from `window.location` here — a client-computed origin is empty
 * on the server render and the markup would disagree with itself, which is
 * the hydration trap components/localToday.ts documents.
 *
 * Clipboard access is refused in some embedded browsers (the WeekSummary
 * copy button hit this first): the URL is on screen and selectable beside
 * this button, so a refusal just leaves the button unlit rather than
 * failing a flow.
 */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800"
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
