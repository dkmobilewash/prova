// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const load = vi.fn();
vi.mock("@/lib/actions", () => ({ loadTakeoffExport: load }));
const { TakeoffExportButtons } = await import("./TakeoffExportButtons");

describe("the takeoff download", () => {
  it("builds a CSV in the browser from what the server read, named for the job", async () => {
    load.mockResolvedValueOnce({ ok: true, value: { jobName: "Baker EOC", sheets: [], rows: [{ item: "A walls", sheet: "A101", quantity: 50, unit: "lin ft", source: "found", note: "" }] } });
    const made: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { made.push(b); return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    const clicked: string[] = [];
    HTMLAnchorElement.prototype.click = function () { clicked.push(this.download); };
    const host = document.createElement("div");
    document.body.append(host);
    act(() => createRoot(host).render(createElement(TakeoffExportButtons, { jobId: "j" })));
    await act(async () => { (host.querySelector('[data-takeoff="export-csv"]') as HTMLButtonElement).click(); });
    expect(load).toHaveBeenCalledWith("j");
    expect(clicked).toEqual(["Baker-EOC-takeoff.csv"]);
    expect(await made[0]!.text()).toContain("A walls,A101,50,lin ft,found,");
  });
  it("says so when nothing is measured, and builds no file", async () => {
    load.mockResolvedValueOnce({ ok: true, value: { jobName: "Empty", sheets: [], rows: [] } });
    const host = document.createElement("div");
    document.body.append(host);
    act(() => createRoot(host).render(createElement(TakeoffExportButtons, { jobId: "j" })));
    await act(async () => { (host.querySelector('[data-takeoff="export-xlsx"]') as HTMLButtonElement).click(); });
    expect(host.textContent).toContain("Nothing is measured on this job yet.");
  });
});
