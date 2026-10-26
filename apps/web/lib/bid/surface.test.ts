import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BID_HOME,
  BID_SEGMENTS,
  bidAuthDestination,
  bidAuthHref,
  classifyHost,
  decideSurface,
  isSharedPath,
  parseHostList,
} from "./surface";

/**
 * The host/path decision middleware makes for every request, driven with the
 * REAL host strings. Middleware itself is a thin translation of these
 * decisions into NextResponse calls; everything that can be wrong about which
 * product a request reaches is wrong here first.
 */

const BID = "bid.cstream.ai";
const APP = "app.cstream.ai";
const PREVIEW = "prova-web-git-feat-bid-foundation-dkmobilewash.vercel.app";
const LOCAL = "localhost:3000";

/** One path from every class the middleware distinguishes. */
const CRM = ["/dashboard", "/jobs", "/jobs/abc/estimate", "/welcome", "/pilot", "/takeoff/abc", "/contacts", "/catalog"];
const SHARED = [
  "/sign-in",
  "/sign-in/factor-one",
  "/sign-up",
  "/api/search",
  "/api/integrations/webhooks/x",
  "/_next/static/chunks/a.js",
  "/__clerk/v1/client",
  "/privacy",
  "/terms",
  "/brand/cstream-wordmark.png",
  "/favicon.ico",
  "/opengraph-image.png",
];

describe("classifyHost", () => {
  it.each([
    [BID, "bid"],
    ["BID.cstream.ai", "bid"],
    ["bid.cstream.ai:443", "bid"],
    ["bid.localhost:3000", "bid"],
    [APP, "app"],
    ["cstream.ai", "app"],
    ["www.cstream.ai", "app"],
    [PREVIEW, "open"],
    [LOCAL, "open"],
    ["127.0.0.1:3100", "open"],
    ["", "app"],
    [null, "app"],
    // A first label that merely STARTS with "bid" is not the Bid host.
    ["bidding.example.com", "app"],
    ["bid-preview.vercel.app", "open"],
  ] as const)("%s is %s", (host, expected) => {
    expect(classifyHost(host)).toBe(expected);
  });

  it("BID_HOSTS adds hosts whose first label is not `bid`", () => {
    const extra = parseHostList("estimate.example.com, Bids.Other.io:8443");
    expect(extra).toEqual(["estimate.example.com", "bids.other.io"]);
    expect(classifyHost("estimate.example.com", extra)).toBe("bid");
    expect(classifyHost("bids.other.io", extra)).toBe("bid");
    expect(classifyHost("estimate.example.com")).toBe("app");
    expect(parseHostList(undefined)).toEqual([]);
    expect(parseHostList("")).toEqual([]);
  });
});

describe("decideSurface on the Bid host", () => {
  it("rewrites the root to the Bid landing page, unprotected", () => {
    expect(decideSurface(BID, "/")).toEqual({ kind: "rewrite", pathname: "/bid", protect: false });
  });

  it("rewrites every Bid segment under /bid and protects the signed-in ones", () => {
    expect(decideSurface(BID, "/bids")).toEqual({ kind: "rewrite", pathname: "/bid/bids", protect: true });
    expect(decideSurface(BID, "/estimates/abc")).toEqual({
      kind: "rewrite",
      pathname: "/bid/estimates/abc",
      protect: true,
    });
    expect(decideSurface(BID, "/wall-types")).toEqual({ kind: "rewrite", pathname: "/bid/wall-types", protect: true });
    // The free drawing-set read is public on both products.
    expect(decideSurface(BID, "/wall-takeoff")).toEqual({
      kind: "rewrite",
      pathname: "/bid/wall-takeoff",
      protect: false,
    });
  });

  it("serves an already-prefixed /bid path as-is (the links the shell draws)", () => {
    expect(decideSurface(BID, "/bid")).toEqual({ kind: "pass", protect: false });
    expect(decideSurface(BID, "/bid/bids")).toEqual({ kind: "pass", protect: true });
  });

  it.each(CRM)("never renders the CRM route %s — it redirects to the Bid home", (path) => {
    expect(decideSurface(BID, path)).toEqual({ kind: "redirect", pathname: "/" });
  });

  it.each(SHARED)("leaves the shared path %s alone", (path) => {
    expect(decideSurface(BID, path)).toEqual({ kind: "pass", protect: false });
  });

  it("a host from BID_HOSTS behaves exactly like bid.cstream.ai", () => {
    const hosts = ["estimate.example.com"];
    for (const path of ["/", "/bids", "/dashboard", "/sign-in"]) {
      expect(decideSurface("estimate.example.com", path, hosts)).toEqual(decideSurface(BID, path));
    }
  });
});

describe("decideSurface on the production app host", () => {
  it.each(["/bid", "/bid/", "/bid/bids", "/bid/estimates/abc", "/bid/wall-takeoff"])("%s is a 404", (path) => {
    expect(decideSurface(APP, path)).toEqual({ kind: "not-found" });
  });

  it.each([...CRM, ...SHARED, "/", "/bids", "/bidder"])("%s passes untouched and unprotected by Bid", (path) => {
    // `/bids` is the CRM's own bid desk — same word, different product.
    expect(decideSurface(APP, path)).toEqual({ kind: "pass", protect: false });
  });
});

describe.each([PREVIEW, LOCAL])("decideSurface on the open host %s", (host) => {
  it("reaches Bid directly under /bid, protecting its signed-in pages", () => {
    expect(decideSurface(host, "/bid")).toEqual({ kind: "pass", protect: false });
    expect(decideSurface(host, "/bid/wall-takeoff")).toEqual({ kind: "pass", protect: false });
    expect(decideSurface(host, "/bid/bids")).toEqual({ kind: "pass", protect: true });
    expect(decideSurface(host, "/bid/settings")).toEqual({ kind: "pass", protect: true });
  });

  it.each([...CRM, ...SHARED, "/"])("keeps the CRM path %s working unchanged", (path) => {
    expect(decideSurface(host, path)).toEqual({ kind: "pass", protect: false });
  });
});

describe("isSharedPath", () => {
  it("does not treat a prefix-sharing word as shared", () => {
    expect(isSharedPath("/sign-in-help")).toBe(false);
    expect(isSharedPath("/apiary")).toBe(false);
    expect(isSharedPath("/privacy/more")).toBe(false);
  });
});

describe("bidAuthDestination — where sign-in / sign-up send a person", () => {
  it("the Bid host always lands in Bid, never on /dashboard", () => {
    expect(bidAuthDestination(BID, null)).toBe(BID_HOME);
    expect(bidAuthDestination(BID, "https://bid.cstream.ai/estimates/abc")).toBe("/bid/estimates/abc");
    expect(bidAuthDestination(BID, "/bid/wall-types")).toBe("/bid/wall-types");
    // A CRM path on the Bid host is not honoured; Bid home instead.
    expect(bidAuthDestination(BID, "https://bid.cstream.ai/dashboard")).toBe(BID_HOME);
  });

  it("a preview or localhost is told by the redirect_url", () => {
    expect(bidAuthDestination(PREVIEW, `https://${PREVIEW}/bid/bids`)).toBe("/bid/bids");
    expect(bidAuthDestination(LOCAL, "/bid/estimates")).toBe("/bid/estimates");
    expect(bidAuthDestination(LOCAL, "/bid")).toBe(BID_HOME);
    expect(bidAuthDestination(LOCAL, decodeURIComponent(bidAuthHref("sign-up").split("=")[1]))).toBe(BID_HOME);
  });

  it("the CRM keeps its own default", () => {
    expect(bidAuthDestination(APP, null)).toBeNull();
    expect(bidAuthDestination(APP, "/jobs")).toBeNull();
    expect(bidAuthDestination(PREVIEW, "/dashboard")).toBeNull();
    expect(bidAuthDestination(LOCAL, null)).toBeNull();
  });

  it("never echoes a foreign absolute URL", () => {
    expect(bidAuthDestination(LOCAL, "https://evil.example/bid/bids")).toBeNull();
    expect(bidAuthDestination(BID, "https://evil.example/bid/bids")).toBe(BID_HOME);
    expect(bidAuthDestination(LOCAL, "//evil.example/bid/bids")).toBeNull();
    expect(bidAuthDestination(LOCAL, "javascript:alert(1)")).toBeNull();
  });
});

/**
 * BID_SEGMENTS IS THE MIDDLEWARE'S ALLOWLIST, AND IT HAS TO BE THE FILESYSTEM.
 * A segment missing from it redirects its page home on the Bid host; a
 * segment listed with no directory behind it rewrites to a 404. Derived from
 * `app/bid/` with route groups flattened, and both directions asserted.
 */
describe("BID_SEGMENTS matches app/bid", () => {
  const bidDir = fileURLToPath(new URL("../../app/bid", import.meta.url));

  function segments(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (/^\(.*\)$/.test(entry.name)) out.push(...segments(join(dir, entry.name)));
      else out.push(entry.name);
    }
    return out;
  }

  it("the directory exists and holds the landing page", () => {
    expect(existsSync(join(bidDir, "page.tsx"))).toBe(true);
  });

  it("lists exactly the top-level segments that exist", () => {
    const found = segments(bidDir).sort();
    // Size first, so an empty walk cannot pass as an equality of nothing.
    expect(found.length).toBe(BID_SEGMENTS.length);
    expect(found).toEqual([...BID_SEGMENTS].sort());
  });
});
