/**
 * The public early-tester page (/pilot) — the one link handed to WWCCA
 * members. Three promises, each load-bearing:
 *
 * 1. It renders signed OUT. The render below runs with NO Clerk mock and no
 *    request scope — auth() or currentUser() would throw here, so a passing
 *    render is the proof the page makes no auth call, not just an
 *    assertion that it doesn't. A source scan backs it up so a later
 *    import of lib/auth fails with a sentence rather than a stack.
 * 2. The sign-up button goes to /sign-up — the page's whole job.
 * 3. It stays static: no database import, and no data-tour anchors (a
 *    public page has no walkthrough, and an anchored one would trip
 *    walkthroughCensus's orphan check with a less helpful message).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/image validates its loader config against the Next runtime, which a
// unit test does not carry. The page only needs the img to land in markup.
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { priority: _priority, ...rest } = props;
    return createElement("img", rest);
  },
}));

const { default: PilotPage, metadata } = await import("./page");

const html = renderToStaticMarkup(createElement(PilotPage));
const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

describe("/pilot renders signed out", () => {
  it("says what it is in the headline and names the trade", () => {
    expect(html).toContain("Your whole job, in one place.");
    expect(html).toContain("union wall-and-ceiling subcontractors");
  });

  it("sends a new tester to /sign-up and an existing one to /sign-in", () => {
    expect(html).toContain('href="/sign-up"');
    expect(html).toContain('href="/sign-in"');
  });

  it("shows the wordmark, not a text stand-in", () => {
    expect(html).toContain("/brand/cstream-wordmark.png");
  });

  it("covers the sections the link was handed out for", () => {
    expect(html).toContain("What to try in your first 15 minutes");
    expect(html).toContain("Built for your trade");
    expect(html).toContain("This is an early build");
  });

  it("prints no support address — the Help button is the contact", () => {
    expect(html).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(html).toContain("Help");
  });
});

describe("/pilot stays public and static", () => {
  it("imports no auth, session or database module", () => {
    expect(source).not.toMatch(/@clerk\//);
    expect(source).not.toMatch(/@\/lib\/auth/);
    expect(source).not.toMatch(/@prova\/db|@\/lib\/db/);
  });

  it("carries no walkthrough anchors", () => {
    expect(source).not.toContain("data-tour");
  });

  it("is absent from middleware's protected list", () => {
    const middleware = readFileSync(fileURLToPath(new URL("../../middleware.ts", import.meta.url)), "utf8");
    const listStart = middleware.indexOf("createRouteMatcher([");
    const listEnd = middleware.indexOf("]);", listStart);
    expect(listStart, "isProtectedRoute moved — update this test").toBeGreaterThan(-1);
    expect(middleware.slice(listStart, listEnd)).not.toContain("/pilot");
  });

  it("has a title and description for the link preview", () => {
    expect(metadata.title).toContain("C Stream");
    expect(String(metadata.description)).toContain("union");
  });
});
