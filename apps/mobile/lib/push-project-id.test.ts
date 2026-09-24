import { describe, expect, it } from "vitest";
import { expoProjectId } from "./push-project-id";

/**
 * The id without which no phone can register for push.
 *
 * `getExpoPushTokenAsync` throws when it cannot find one, and it is
 * called fire-and-forget at launch — so the throw is swallowed, push
 * never works, and nothing anywhere says why. That is the failure this
 * resolver exists to make impossible to reach silently.
 */

describe("finding the EAS project id", () => {
  it("reads the ordinary app-config location", () => {
    expect(expoProjectId({ expoConfig: { extra: { eas: { projectId: "abc-123" } } } })).toBe(
      "abc-123",
    );
  });

  it("falls back to easConfig, which is where some EAS builds put it", () => {
    expect(expoProjectId({ expoConfig: null, easConfig: { projectId: "def-456" } })).toBe(
      "def-456",
    );
  });

  it("prefers the app config when both exist, since that is what was built", () => {
    expect(
      expoProjectId({
        expoConfig: { extra: { eas: { projectId: "from-config" } } },
        easConfig: { projectId: "from-eas" },
      }),
    ).toBe("from-config");
  });

  it("answers null for every shape of missing, rather than an empty string", () => {
    // An empty string would be passed straight to Expo and fail there,
    // one layer further from the cause.
    for (const constants of [
      {},
      { expoConfig: null, easConfig: null },
      { expoConfig: { extra: {} } },
      { expoConfig: { extra: { eas: {} } } },
      { expoConfig: { extra: { eas: { projectId: "" } } } },
      { expoConfig: { extra: { eas: { projectId: "   " } } } },
      { expoConfig: { extra: { eas: { projectId: 42 } } } },
    ]) {
      expect(expoProjectId(constants)).toBeNull();
    }
  });

  it("trims, because a copied id carries whitespace more often than not", () => {
    expect(expoProjectId({ expoConfig: { extra: { eas: { projectId: " abc-123 " } } } })).toBe(
      "abc-123",
    );
  });
});
