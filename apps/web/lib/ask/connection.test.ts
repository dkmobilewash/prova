import { describe, expect, it } from "vitest";
import { connectionProblem } from "./connection";

/** Each API answer becomes a sentence that says what to fix, and none
 * of them could carry the key. */
describe("connectionProblem", () => {
  const model = "claude-opus-5";

  it("names the fix for each shape the API answers with", () => {
    expect(connectionProblem({ ok: false, status: null, type: "not_configured" }, model)).toMatch(/ANTHROPIC_API_KEY.*redeploy/);
    expect(connectionProblem({ ok: false, status: null, type: "connection_error" }, model)).toMatch(/Could not reach Anthropic/);
    expect(connectionProblem({ ok: false, status: 401, type: "authentication_error" }, model)).toMatch(/rejected the key \(401/);
    expect(connectionProblem({ ok: false, status: 403, type: "permission_error" }, model)).toMatch(/not allowed to use claude-opus-5 \(403/);
    expect(connectionProblem({ ok: false, status: 404, type: "not_found_error" }, model)).toMatch(/cannot use claude-opus-5 \(404/);
    expect(connectionProblem({ ok: false, status: 429, type: "rate_limit_error" }, model)).toMatch(/rate-limiting.*429/);
    expect(connectionProblem({ ok: false, status: 529, type: "overloaded_error" }, model)).toMatch(/having trouble \(529 overloaded_error\)/);
    expect(connectionProblem({ ok: false, status: 418, type: null }, model)).toBe("Anthropic answered 418.");
  });

  it("says the key was saved after the build, which is the case that cost an hour", () => {
    expect(connectionProblem({ ok: false, status: null, type: "not_configured" }, model)).toContain(
      "a key saved after a deployment was built does not reach it",
    );
  });
});
