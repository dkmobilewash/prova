import { describe, expect, it } from "vitest";
import { formatHours, median } from "./pilotMetrics";

describe("the pilot dashboard's arithmetic", () => {
  it("median of none, odd and even", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("upload-to-bid reads in minutes, hours or days", () => {
    expect(formatHours(null)).toBe("—");
    expect(formatHours(0.25)).toBe("15 min");
    expect(formatHours(2)).toBe("2 h");
    expect(formatHours(47.94)).toBe("47.9 h");
    expect(formatHours(72)).toBe("3 d");
  });
});
