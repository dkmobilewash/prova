// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendSubmittalPackage = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
const uploadDocumentFile = vi.fn(async () => ({ ok: true, fileUrl: "https://x.test/p.pdf" }));
vi.mock("@/lib/actions", () => ({ sendSubmittalPackage }));
vi.mock("@/lib/document-upload-client", () => ({ uploadDocumentFile }));
vi.mock("@/lib/submittal-package", () => ({
  buildSubmittalPackage: async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    skipped: [],
    contents: { files: [{ name: "a.pdf", pages: 1 }], totalPages: 2 },
  }),
  submittalPackageFileName: () => "SUB-1.pdf",
}));
const { SubmittalPackageBuilder } = await import("./SubmittalPackageBuilder");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const cover = { companyName: "Acme", gcName: "GC", jobName: "Tower", submittalNumber: 1, revisionNumber: 1, title: "Board", description: null, specSection: null, drawingReference: null };
const draft = { toAddress: "pm@gc.test", toName: "GC", subject: "Sub 1", body: "Attached." };

describe("emailing a built package", () => {
  let host: HTMLFormElement;
  const onSent = vi.fn();
  const press = (label: string) => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes(label));

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    URL.createObjectURL = () => "blob:x";
    URL.revokeObjectURL = () => undefined;
    host = document.createElement("form");
    document.body.append(host);
    await act(async () => {
      createRoot(host).render(
        createElement(SubmittalPackageBuilder, { cover, onContents: () => undefined, email: { submittalId: "s1", companyId: "c1", draft, onSent } }),
      );
    });
  });
  afterEach(() => host.remove());

  it("offers nothing until a package is built", () => {
    expect(host.textContent).not.toContain("Email it");
  });

  it("shows the words after a build, and only a press sends the built file", async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.pdf", { type: "application/pdf" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => press("Build and download")?.click());
    expect(host.querySelector<HTMLInputElement>('[name="toAddress"]')?.value).toBe("pm@gc.test");
    expect(sendSubmittalPackage).not.toHaveBeenCalled();

    await act(async () => press("Email the package")?.click());
    expect(uploadDocumentFile).toHaveBeenCalledWith("submittal-package", "c1", expect.anything());
    const [id, url, form] = sendSubmittalPackage.mock.calls[0] as [string, string, FormData];
    expect([id, url]).toEqual(["s1", "https://x.test/p.pdf"]);
    expect(form.get("fileName")).toBe("SUB-1.pdf");
    expect(String(form.get("packageContents"))).toContain("a.pdf");
    expect(onSent).toHaveBeenCalled();
  });
});
