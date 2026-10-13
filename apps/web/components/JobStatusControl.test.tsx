import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions", () => ({ setJobStatus: vi.fn() }));

const { JobStatusControl } = await import("./JobStatusControl");

/**
 * The estimate-stage sentence used to say the job becomes contracted
 * "further down this page" — after the Overview was split into tabs, the
 * button it meant was on another tab, so the most important transition in
 * the product was a dead end. It must now link to where the button is.
 */
describe("JobStatusControl on an estimate", () => {
  // The Estimate TAB is gone — the job page is five stage steps — and
  // "at the bottom of the Estimate tab" sent people looking for nothing.
  it("points at the header's Won it? box and links to the estimate page's lock-in", () => {
    const html = renderToStaticMarkup(<JobStatusControl jobId="job-1" status="ESTIMATE" />);
    expect(html).toContain('href="/jobs/job-1/estimate#job-lock-in"');
    expect(html).toContain("Won it?");
    expect(html).not.toMatch(/estimate tab/i);
    expect(html).not.toContain("further down this page");
  });

  it("names the step without a link for a viewer who has no Estimate tab", () => {
    const html = renderToStaticMarkup(
      <JobStatusControl jobId="job-1" status="ESTIMATE" showsEstimateTab={false} />,
    );
    expect(html).toContain("Mark contracted");
    expect(html).not.toContain("/estimate#job-lock-in");
    expect(html).not.toMatch(/estimate tab/i);
  });
});
