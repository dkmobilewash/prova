// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadButton, fileNameFrom } from "./DownloadButton";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("the download button's request", () => {
  let host: HTMLDivElement;
  const clicked: { href: string; download: string }[] = [];
  const fetchMock = vi.fn();

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = () => "blob:file";
    URL.revokeObjectURL = () => undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    });
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      createRoot(host).render(createElement(DownloadButton, { href: "/api/pay-applications/j/i/g703?format=csv", label: "G703 as CSV", fallbackName: "G703.csv" }));
    });
  });
  afterEach(() => {
    host.remove();
    clicked.length = 0;
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is a button, not a link, so a press never navigates to the route", () => {
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector("button")?.textContent).toBe("G703 as CSV");
  });

  it("fetches the file with the page's session and saves it under the server's name", async () => {
    fetchMock.mockResolvedValue(new Response("A Item no.", { status: 200, headers: { "content-disposition": 'attachment; filename="G703 Tower application 2.csv"' } }));
    await act(async () => host.querySelector("button")?.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/pay-applications/j/i/g703?format=csv", { credentials: "same-origin" });
    expect(clicked).toEqual([{ href: "blob:file", download: "G703 Tower application 2.csv" }]);
  });

  it("says the download failed, with the status, and saves nothing", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    await act(async () => host.querySelector("button")?.click());
    expect(host.textContent).toContain("HTTP 503");
    expect(clicked).toEqual([]);
  });
});

describe("the file name", () => {
  it("reads the server's name, and falls back", () => {
    expect(fileNameFrom('attachment; filename="a b.csv"', "x")).toBe("a b.csv");
    expect(fileNameFrom(null, "x.csv")).toBe("x.csv");
  });
});
