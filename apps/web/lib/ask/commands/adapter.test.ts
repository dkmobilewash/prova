import { describe, expect, it, vi } from "vitest";
import { formDataFrom, throughAction } from "./adapter";

describe("formDataFrom", () => {
  it("speaks the form's dialect: checkboxes are 'on', absent optionals are absent, arrays repeat", () => {
    const fd = formDataFrom({
      reportDate: "2026-09-08",
      completesOrder: true,
      isRequired: false,
      notes: undefined,
      weather: null,
      lineItemId: ["a", "b"],
    });
    expect(fd.get("reportDate")).toBe("2026-09-08");
    expect(fd.get("completesOrder")).toBe("on");
    expect(fd.has("isRequired")).toBe(false);
    expect(fd.has("notes")).toBe(false);
    expect(fd.has("weather")).toBe(false);
    expect(fd.getAll("lineItemId")).toEqual(["a", "b"]);
  });

  it("keeps an empty string as an empty string, since a form would post one", () => {
    expect(formDataFrom({ notes: "" }).get("notes")).toBe("");
  });
});

describe("throughAction", () => {
  it("passes an action's own result through untouched", async () => {
    expect(await throughAction("Send out", async () => ({ ok: false, error: "already out" }))).toEqual({
      ok: false,
      error: "already out",
    });
    expect(await throughAction("Send out", async () => ({ ok: true }))).toEqual({ ok: true });
  });

  it("turns a throw into a sentence that does not claim nothing was saved", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await throughAction("Send out", async () => {
      throw new Error("boom");
    });
    expect(result).toEqual({ ok: false, error: "Send out did not complete. Check the page before trying again." });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
