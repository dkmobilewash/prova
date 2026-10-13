import { describe, expect, it } from "vitest";
import { AREAS } from "@/lib/areas";
import { accentFor } from "@/components/areaAccent";

describe("every area has its own colour", () => {
  it("gives each of the six areas a distinct accent, so the sidebar and home boxes stay colour-coded", () => {
    expect(AREAS.length).toBeGreaterThanOrEqual(6); // a scan of nothing must not pass
    const icons = AREAS.map((area) => accentFor(area.name).icon);
    expect(icons.every((c) => c !== "text-ink-muted")).toBe(true);
    expect(new Set(icons).size).toBe(AREAS.length);
  });
});
