import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ uploadComplianceDocument: vi.fn() }));
vi.mock("@/lib/document-upload-client", () => ({ singleFileFrom: vi.fn(), uploadDocumentFile: vi.fn() }));

const { ComplianceUploadForm } = await import("./ComplianceUploadForm");

/** /compliance rendered its upload form open on every visit — the one add
 * form on that page that was not behind a button. */
describe("ComplianceUploadForm", () => {
  it("starts collapsed behind an Upload a document button", () => {
    const html = renderToStaticMarkup(<ComplianceUploadForm companyId="c1" jobs={[]} />);
    expect(html).toContain("Upload a document");
    expect(html).not.toContain('type="file"');
  });
});
