import { describe, expect, it } from "vitest";
import { labelSaveMessage } from "./labelSaveMessage";

describe("the answer key's save line reports the file", () => {
  it("the number written, not the number sent", () => {
    expect(labelSaveMessage({ sent: 164, written: 163, path: "AI101.json" })).toBe("Saved 163 decisions to AI101.json (164 were sent: check the file)");
  });
  it("agreeing counts say nothing more", () => {
    expect(labelSaveMessage({ sent: 163, written: 163, path: "AI101.json" })).toBe("Saved 163 decisions to AI101.json");
    expect(labelSaveMessage({ sent: 1, written: 1, path: undefined })).toBe("Saved 1 decision");
  });
  it("an older server that does not say: the sum sent, as before", () => {
    expect(labelSaveMessage({ sent: 12, written: undefined, path: "p.json" })).toBe("Saved 12 decisions to p.json");
  });
});
