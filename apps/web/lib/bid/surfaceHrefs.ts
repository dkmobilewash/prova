/**
 * WHERE A SHARED SCREEN'S LINKS GO, decided once per product.
 *
 * C Stream (the CRM) and C Stream Bid render the SAME estimating components —
 * the estimate lines, the bid recap, the takeoff, the proposal — and those
 * components used to hard-code CRM hrefs (`/wall-types`, `/jobs/<id>/proposal`,
 * `/proposals`…). Bid is not allowed a link into the CRM (`bidLinkCensus.test.ts`),
 * so every such href is now chosen HERE from one word, the `surface`, and the
 * shared server components take `surface` (default `"crm"`) instead of
 * spelling a path.
 *
 * THE CRM HALF IS TODAY'S HREFS, byte for byte — each is the literal the
 * component used before this file existed, and `surfaceHrefs.test.ts` pins that
 * — so a CRM page does not change by a character.
 *
 * Lives in `lib/`, which the link census does not read (its sight ends there).
 * So the census cannot see these strings, and `bidLinkCensus.test.ts` instead
 * CALLS `surfaceHrefs("bid", …)` and classifies every value it returns — the
 * same classifier it uses on source text. A Bid value that points at the CRM
 * fails there, by key, rather than in a click-through on the Bid host.
 *
 * Strings only, never functions: these cross into client components as props.
 */

export type Surface = "crm" | "bid";

export type SurfaceHrefs = {
  /** The product's home, for a "back to jobs" button that has nowhere else to go. */
  home: string;
  /** What that button says. */
  homeLabel: string;
  /** The wall-type library. */
  wallTypes: string;
  /** The bid log. */
  bids: string;
  /** The estimate (line items) of this job. */
  estimate: string;
  /** The takeoff tab of this job. */
  takeoff: string;
  /** The full-screen takeoff workspace of this job. */
  workspace: string;
  /** The wall-legend review screen of this job's takeoff. */
  legend: string;
  /** The bid recap of this job. CRM: a section of the estimate tab. */
  recap: string;
  /** The printable proposal of this job. */
  proposal: string;
  /** The company's standing proposal clauses. */
  clauseLibrary: string;
  /** Where the standing markup, waste and opening-deduction habit are set. */
  estimatingSettings: string;
  /** The job's own page: CRM, the job; Bid, the estimate (which opens on its
   * takeoff). Where a bid log sends "the estimate for this project". */
  job: string;
  /** Where a GC is added when a bid needs one and the company has none: CRM,
   * the contacts list; Bid, the GCs section of its settings. */
  addGc: string;
  /** The log of what the app sent. `null` = this product has no such screen,
   * so a component draws no link rather than a dead one. */
  messageLog: string | null;
};

export function surfaceHrefs(surface: Surface, jobId: string): SurfaceHrefs {
  if (surface === "bid") {
    const base = `/bid/estimates/${jobId}`;
    return {
      home: "/bid/bids",
      homeLabel: "Back to your bids",
      wallTypes: "/bid/wall-types",
      bids: "/bid/bids",
      estimate: `${base}/estimate`,
      takeoff: `${base}/takeoff`,
      workspace: `/bid/workspace/${jobId}`,
      legend: `${base}/takeoff/legend`,
      recap: `${base}/recap`,
      proposal: `${base}/proposal`,
      job: base,
      addGc: "/bid/settings#gcs",
      clauseLibrary: "/bid/settings#clauses",
      estimatingSettings: "/bid/settings",
      messageLog: null,
    };
  }
  return {
    home: "/dashboard",
    homeLabel: "Back to jobs",
    wallTypes: "/wall-types",
    bids: "/bids",
    estimate: `/jobs/${jobId}/estimate`,
    takeoff: `/jobs/${jobId}/takeoff`,
    workspace: `/takeoff/${jobId}`,
    legend: `/jobs/${jobId}/takeoff/legend`,
    recap: `/jobs/${jobId}/estimate`,
    proposal: `/jobs/${jobId}/proposal`,
    job: `/jobs/${jobId}`,
    addGc: "/contacts",
    clauseLibrary: "/proposals",
    estimatingSettings: "/settings?tab=estimating",
    messageLog: "/messages",
  };
}
