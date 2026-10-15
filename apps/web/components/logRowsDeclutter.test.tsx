import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /rfis, /submittals, /drawings, /material-orders after the declutter pass
 * (density audit #32): every row printed its full detail inline — the
 * answer, every revision, every delivery — and the GC's Procore/ACC feeds
 * sat open under the log. The detail now opens on click, each behind a
 * summary that says what is inside and how many. The chips' name-only
 * label is pinned by jobPickerCensus.test.ts.
 */

vi.mock("@prova/db", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/rfis", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions", () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : vi.fn()) }));

const { RfiRow } = await import("@/components/RfiRow");
const { SubmittalRow } = await import("@/components/SubmittalRow");
const { DrawingSetRow } = await import("@/components/DrawingSetRow");
const { MaterialOrderRow } = await import("@/components/MaterialOrderRow");
const { ProcoreFeedSection } = await import("@/components/ProcoreFeedSection");
const { ACCFeedSection } = await import("@/components/ACCFeedSection");

/** The `<details>` whose summary is exactly `summary`, or "" — and it must be closed. */
function closedDetails(html: string, summary: string) {
  const at = html.indexOf(`>${summary}</summary>`);
  if (at < 0) return "";
  const open = html.lastIndexOf("<details", at);
  const block = html.slice(open, html.indexOf("</details>", at));
  expect(block, `${summary} starts open`).not.toMatch(/^<details[^>]* open/);
  return block;
}

describe("an RFI row", () => {
  it("keeps the question on the row and opens the answer on click", () => {
    const html = renderToStaticMarkup(
      <RfiRow
        rfi={{
          id: "rfi-1",
          number: 14,
          jobName: "Riverside",
          subject: "Head of wall at grid 4",
          question: "Which detail governs?",
          drawingReference: null,
          specSection: null,
          status: "ANSWERED",
          sentOn: "2026-09-08",
          dueBy: null,
          answeredOn: "2026-09-11",
          answer: "Use detail 4/A-501.",
          answerUrl: null,
          answerFileName: null,
          costImpact: false,
          scheduleImpact: false,
          askedByName: null,
        }}
        today="2026-09-21"
        canDelete={false}
        showJob={false}
      />,
    );
    expect(html.indexOf("Which detail governs?")).toBeLessThan(html.indexOf("<details"));
    expect(closedDetails(html, "The GC&#x27;s answer")).toContain("Use detail 4/A-501.");
    expect(html.split("Use detail 4/A-501.").length - 1).toBe(1);
  });
});

describe("a submittal row", () => {
  it("puts every revision line behind 'Revisions · N'", () => {
    const rev = (n: number) => ({
      revisionNumber: n,
      sentOn: "2026-09-01",
      dueBack: null,
      returnedOn: "2026-09-05",
      outcome: "REVISE_RESUBMIT",
      responseNotes: `Notes on R${n}`,
      responseUrl: null,
      responseFileName: null,
    });
    const html = renderToStaticMarkup(
      <SubmittalRow
        submittal={{
          id: "sub-1",
          number: 8,
          jobName: "Riverside",
          title: "Track and stud data",
          description: null,
          specSection: null,
          drawingReference: null,
          submittedByName: null,
          revisions: [rev(1), rev(2)],
        }}
        today="2026-09-21"
        canDelete={false}
        showJob={false}
      />,
    );
    const box = closedDetails(html, "Revisions · 2");
    expect(box).toContain("Notes on R1");
    expect(box).toContain("Notes on R2");
    expect(html.split("Notes on R").length - 1).toBe(2);
  });
});

describe("a drawing set row", () => {
  it("keeps the current revision and anything not received on the row; earlier ones open on click", () => {
    const rev = (id: string, issuedOn: string, receivedOn: string | null) => ({
      id,
      label: id,
      issuedOn,
      receivedOn,
      description: null,
      fileUrl: null,
      fileName: null,
    });
    const html = renderToStaticMarkup(
      <DrawingSetRow
        set={{
          id: "set-1",
          name: "Architectural",
          description: null,
          jobName: "Riverside",
          revisions: [
            rev("Rev 0", "2026-07-01", "2026-07-02"),
            rev("Rev 1", "2026-08-01", "2026-08-03"),
            rev("Rev 2", "2026-09-01", null),
          ],
        }}
        today="2026-09-21"
        canDelete={false}
        showJob={false}
      />,
    );
    const earlier = closedDetails(html, "Earlier revisions · 2");
    expect(earlier).toContain(">Rev 0<");
    expect(earlier).toContain(">Rev 1<");
    // Rev 2 is current and not received: its "Mark received" stays on the row.
    const onRow = html.slice(0, html.indexOf("<details"));
    expect(onRow).toContain(">Rev 2<");
    expect(onRow).toContain("Mark received");
  });
});

describe("a material order row", () => {
  it("keeps the order line and puts each delivery behind 'Deliveries · N'", () => {
    const html = renderToStaticMarkup(
      <MaterialOrderRow
        order={{
          id: "mo-1",
          number: 3,
          jobId: "job-1",
          jobName: "Riverside",
          lineItemDescription: null,
          vendorName: "L&W Supply",
          vendorId: "v-1",
          vendorReference: null,
          description: "600 sheets 5/8 Type X",
          notes: null,
          promisedFor: "2026-09-10",
          lineItemId: null,
          orderedOn: "2026-09-01",
          orderedByName: null,
          deliveries: [
            { id: "d-1", deliveredOn: "2026-09-08", completesOrder: false, notes: "First drop" },
            { id: "d-2", deliveredOn: "2026-09-12", completesOrder: true, notes: "Rest of it" },
          ],
        }}
        today="2026-09-21"
        vendors={[]}
        lineItems={[]}
        canDelete={false}
        showJob={false}
      />,
    );
    expect(html.indexOf("promised 2026-09-10")).toBeLessThan(html.indexOf("<details"));
    const box = closedDetails(html, "Deliveries · 2");
    expect(box).toContain("First drop");
    expect(box).toContain("Rest of it");
  });
});

describe("the GC's Procore and ACC feeds", () => {
  const link = {
    id: "l-1",
    procoreProjectName: "Riverside Tower",
    procoreCompanyName: "Turner",
    accProjectName: "Riverside Tower",
    accAccountName: "Turner",
    lastRefreshedAt: new Date(),
    lastRefreshStatus: "SUCCESS",
    lastRefreshMessage: null,
    job: { name: "Riverside" },
    items: [
      { id: "i-1", number: "RFI-7", title: "Slab edge", status: "Open", revision: null, discipline: null, ballInCourt: null, dueDate: null, webUrl: "https://x/1" },
      { id: "i-2", number: "RFI-8", title: "Soffit", status: "Open", revision: null, discipline: null, ballInCourt: null, dueDate: null, webUrl: "https://x/2" },
    ],
  };
  const feed = { kind: "RFI" as const, activeJob: null, connected: true, links: [link] };

  it("starts collapsed when connected, with the count on the summary", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const procore = renderToStaticMarkup(<ProcoreFeedSection feed={feed as any} />);
    expect(closedDetails(procore, "RFIs from the GC&#x27;s Procore · 2")).toContain("Slab edge");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acc = renderToStaticMarkup(<ACCFeedSection feed={feed as any} />);
    expect(acc).toMatch(/<summary[^>]*>[^<]* · 2<\/summary>/);
    expect(acc.slice(acc.indexOf("<details"))).toContain("Soffit");
  });
});
