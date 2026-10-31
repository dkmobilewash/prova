import type { FindingSource } from "@/lib/agents/core";
import type { BidWorkspace, FindingRow } from "@/lib/agents/bidWorkspace";
import { storedHref } from "./bidLogHrefs";

/**
 * The bid's own page data, with every link the agents stored re-pointed for
 * C Stream Bid (`storedHref("bid", …)`): a link to the bid's own page or to an
 * estimate becomes its Bid twin; every other stored link (a GC's contact page,
 * the pursuit pipeline, backcharges, a past job) is a CRM screen and is dropped,
 * so its chip or "Fix this" is drawn as words, never as a link out of Bid. A
 * source that carries an outside `url` keeps it (it opens a web page, not the
 * CRM); one left with neither is drawn as a plain chip.
 *
 * Pure, so `bidPageData.test.ts` can drive it with the shapes the agents
 * really write and the link census can classify what comes out.
 */
function sources(list: FindingSource[]): FindingSource[] {
  return list.map((s) => {
    const { href, url, ...rest } = s;
    const mapped = storedHref("bid", href);
    const out: FindingSource = mapped ? { ...rest, href: mapped } : rest;
    const outside = webPage(url);
    return outside ? { ...out, url: outside } : out;
  });
}

/** A research citation's web page: kept only if it is an absolute http(s) URL
 * that is NOT one of C Stream's own hosts (those are CRM doors, however they
 * got stored). */
export function webPage(url: string | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const host = url.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase();
  return host.endsWith("cstream.ai") ? null : url;
}

function finding(f: FindingRow): FindingRow {
  return { ...f, fixHref: storedHref("bid", f.fixHref), sources: sources(f.sources) };
}

export function bidPageData(data: BidWorkspace): BidWorkspace {
  const { recommendation } = data.decision;
  return {
    ...data,
    research: data.research.map(finding),
    estimateCheck: data.estimateCheck.map(finding),
    // An addendum row opens the bid's own page, which is where this one already is.
    addenda: data.addenda.map((a) => ({ ...a, href: storedHref("bid", a.href) ?? `/bid/bids/${data.bid.id}` })),
    decision: {
      ...data.decision,
      recommendation: recommendation
        ? { ...recommendation, href: storedHref("bid", recommendation.href), sources: sources(recommendation.sources) }
        : null,
    },
  };
}
