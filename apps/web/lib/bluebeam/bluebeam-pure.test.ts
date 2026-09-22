import { describe, expect, it, vi } from "vitest";
import {
  BLUEBEAM_REGION_HOSTS,
  BluebeamApiError,
  BluebeamAuthError,
  BluebeamUnauthorizedError,
  bluebeamAuthorizeUrl,
  createBluebeamSession,
  exchangeBluebeamCode,
  isBluebeamRegion,
  listBluebeamSessionFiles,
  readBluebeamConfig,
  refreshBluebeamTokens,
  summarizeBluebeamSessionMarkups,
  uploadFileToBluebeamSession,
  type BluebeamApiTarget,
  type BluebeamConfig,
} from "@prova/integrations";

/**
 * The parts of the Bluebeam integration that need no database: config
 * parsing, the OAuth client against a fake token endpoint, and the
 * Studio API client's PERMISSIVE parsing of Sessions/Files/Markups —
 * the piece packages/integrations/src/bluebeam.ts's header comment says
 * is not independently verified against a live account, tested here
 * against several plausible response shapes rather than one assumed one.
 */

const env = {
  BLUEBEAM_CLIENT_ID: "client-123",
  BLUEBEAM_CLIENT_SECRET: "secret-456",
  BLUEBEAM_REDIRECT_URI: "https://app.cstream.ai/api/bluebeam/callback",
  INTEGRATION_TOKEN_KEY: "k",
};

describe("readBluebeamConfig", () => {
  it("defaults to the US region when none is set", () => {
    const config = readBluebeamConfig(env);
    expect(config?.region).toBe("US");
    expect(config?.host).toBe("https://api.bluebeam.com");
  });

  it("reads a real region, case-insensitively, and picks its host", () => {
    expect(readBluebeamConfig({ ...env, BLUEBEAM_REGION: "de" })?.host).toBe("https://api.bluebeamstudio.de");
    expect(readBluebeamConfig({ ...env, BLUEBEAM_REGION: "AU" })?.host).toBe("https://api.bluebeamstudio.com.au");
  });

  it("is null — never a guess — when a required variable is missing or the region is not one of the five", () => {
    for (const name of ["BLUEBEAM_CLIENT_ID", "BLUEBEAM_CLIENT_SECRET", "BLUEBEAM_REDIRECT_URI"]) {
      expect(readBluebeamConfig({ ...env, [name]: "" }), name).toBeNull();
    }
    expect(readBluebeamConfig({ ...env, BLUEBEAM_REGION: "CA" })).toBeNull();
  });

  it("BLUEBEAM_REGION_HOSTS names exactly the five regions Bluebeam actually serves", () => {
    expect(Object.keys(BLUEBEAM_REGION_HOSTS).sort()).toEqual(["AU", "DE", "SE", "UK", "US"]);
    for (const region of Object.keys(BLUEBEAM_REGION_HOSTS)) expect(isBluebeamRegion(region)).toBe(true);
    expect(isBluebeamRegion("CA")).toBe(false);
  });
});

describe("bluebeamAuthorizeUrl", () => {
  it("carries state, the full_prime+offline_access scopes, and the exact redirect — no PKCE params", () => {
    const config = readBluebeamConfig(env) as BluebeamConfig;
    const url = new URL(bluebeamAuthorizeUrl(config, "st4te"));
    expect(url.origin + url.pathname).toBe("https://api.bluebeam.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client-123",
      redirect_uri: "https://app.cstream.ai/api/bluebeam/callback",
      scope: "full_prime offline_access",
      state: "st4te",
    });
    expect(url.searchParams.has("code_challenge")).toBe(false);
  });
});

describe("OAuth token exchange", () => {
  const config = readBluebeamConfig(env) as BluebeamConfig;

  it("exchanges a code with client credentials in the body, at /oauth2/token", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.bluebeam.com/oauth2/token");
      const body = new URLSearchParams(String(init?.body));
      expect(Object.fromEntries(body)).toEqual({
        grant_type: "authorization_code",
        client_id: "client-123",
        client_secret: "secret-456",
        code: "auth-code",
        redirect_uri: "https://app.cstream.ai/api/bluebeam/callback",
      });
      return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 });
    });
    const tokens = await exchangeBluebeamCode(config, "auth-code", fetchImpl);
    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
  });

  it("refresh sends grant_type=refresh_token with the refresh token", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("old-rt");
      return new Response(JSON.stringify({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }), { status: 200 });
    });
    const tokens = await refreshBluebeamTokens(config, "old-rt", fetchImpl);
    expect(tokens.accessToken).toBe("at2");
  });

  it("a falsy or missing expires_in falls back to one hour rather than a broken number", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ access_token: "at", refresh_token: "rt" }), { status: 200 });
    const tokens = await exchangeBluebeamCode(config, "c", fetchImpl);
    expect(tokens.expiresIn).toBe(3600);
  });

  it("marks invalid_grant so the caller knows only reconnecting fixes it", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    await expect(refreshBluebeamTokens(config, "dead", fetchImpl)).rejects.toMatchObject({ invalidGrant: true, status: 400 });
  });

  it("a non-invalid_grant failure is not marked as one", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
    await expect(refreshBluebeamTokens(config, "x", fetchImpl)).rejects.toBeInstanceOf(BluebeamAuthError);
    try {
      await refreshBluebeamTokens(config, "x", fetchImpl);
    } catch (error) {
      expect((error as BluebeamAuthError).invalidGrant).toBe(false);
    }
  });
});

describe("Studio API — permissive parsing of Sessions/Files/Markups", () => {
  const target: BluebeamApiTarget = { accessToken: "at", host: "https://api.bluebeam.com" };

  it("createBluebeamSession reads an id under either `id` or `sessionId`", async () => {
    const underId = async () => new Response(JSON.stringify({ id: "s1", name: "Job A" }), { status: 200 });
    expect(await createBluebeamSession(target, "Job A", underId)).toEqual({ id: "s1", name: "Job A" });

    const underSessionId = async () => new Response(JSON.stringify({ sessionId: "s2", sessionName: "Job B" }), { status: 200 });
    expect(await createBluebeamSession(target, "Job B", underSessionId)).toEqual({ id: "s2", name: "Job B" });
  });

  it("createBluebeamSession falls back to the name it sent when Bluebeam echoes none back", async () => {
    const noName = async () => new Response(JSON.stringify({ id: "s3" }), { status: 200 });
    expect(await createBluebeamSession(target, "Job C", noName)).toEqual({ id: "s3", name: "Job C" });
  });

  it("createBluebeamSession fails loudly rather than silently when Bluebeam omits an id entirely", async () => {
    const noId = async () => new Response(JSON.stringify({ name: "Job D" }), { status: 200 });
    await expect(createBluebeamSession(target, "Job D", noId)).rejects.toBeInstanceOf(BluebeamApiError);
  });

  it("listBluebeamSessionFiles reads a bare array or an {items:[]} envelope the same way", async () => {
    const bareArray = async () => new Response(JSON.stringify([{ id: "f1", name: "a.pdf" }]), { status: 200 });
    expect(await listBluebeamSessionFiles(target, "s1", bareArray)).toEqual([{ id: "f1", name: "a.pdf" }]);

    const wrapped = async () => new Response(JSON.stringify({ items: [{ fileId: "f2", fileName: "b.pdf" }] }), { status: 200 });
    expect(await listBluebeamSessionFiles(target, "s1", wrapped)).toEqual([{ id: "f2", name: "b.pdf" }]);
  });

  it("listBluebeamSessionFiles skips a row with no usable id rather than throwing", async () => {
    const impl = async () => new Response(JSON.stringify([{ name: "no id" }, { id: "f1", name: "ok" }]), { status: 200 });
    expect(await listBluebeamSessionFiles(target, "s1", impl)).toEqual([{ id: "f1", name: "ok" }]);
  });

  it("summarizeBluebeamSessionMarkups groups by whatever status string is present, under either key name", async () => {
    const impl = async () =>
      new Response(
        JSON.stringify([{ status: "Approved" }, { status: "Approved" }, { markupStatus: "Rejected" }, {}]),
        { status: 200 },
      );
    const summary = await summarizeBluebeamSessionMarkups(target, "s1", impl);
    expect(summary.total).toBe(4);
    expect(summary.byStatus).toEqual({ Approved: 2, Rejected: 1, Unknown: 1 });
  });

  it("a 401 from any Studio API call throws BluebeamUnauthorizedError, not a generic API error", async () => {
    const impl = async () => new Response("", { status: 401 });
    await expect(listBluebeamSessionFiles(target, "s1", impl)).rejects.toBeInstanceOf(BluebeamUnauthorizedError);
  });
});

describe("uploadFileToBluebeamSession", () => {
  const target: BluebeamApiTarget = { accessToken: "at", host: "https://api.bluebeam.com" };
  const file = { name: "plan.pdf", bytes: new TextEncoder().encode("%PDF-1.7 fake"), contentType: "application/pdf" };

  it("creates metadata, PUTs the bytes with NO Authorization header, then confirms — in that order", async () => {
    const calls: { url: string; method: string | undefined; hasAuth: boolean }[] = [];
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url, method: init?.method, hasAuth: headers.has("Authorization") });
      if (url.endsWith("/sessions/s1/files") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "f1", uploadUrl: "https://s3.example.com/presigned?sig=abc" }), { status: 200 });
      }
      if (url === "https://s3.example.com/presigned?sig=abc") {
        return new Response("", { status: 200 });
      }
      if (url.endsWith("/sessions/s1/files/f1/confirm")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`Unexpected call: ${url}`);
    });

    const result = await uploadFileToBluebeamSession(target, "s1", file, impl);
    expect(result).toEqual({ fileId: "f1" });
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT", "POST"]);
    // The pre-signed S3 URL must NEVER see our bearer token.
    expect(calls[1].hasAuth).toBe(false);
    expect(calls[0].hasAuth).toBe(true);
    expect(calls[2].hasAuth).toBe(true);
  });

  it("fails loudly when Bluebeam's create-file response has no upload target", async () => {
    const impl = async () => new Response(JSON.stringify({ id: "f1" }), { status: 200 });
    await expect(uploadFileToBluebeamSession(target, "s1", file, impl)).rejects.toBeInstanceOf(BluebeamApiError);
  });

  it("fails loudly when the S3 PUT itself is refused", async () => {
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/files")) {
        return new Response(JSON.stringify({ id: "f1", uploadUrl: "https://s3.example.com/bad" }), { status: 200 });
      }
      return new Response("denied", { status: 403 });
    });
    await expect(uploadFileToBluebeamSession(target, "s1", file, impl)).rejects.toBeInstanceOf(BluebeamApiError);
  });
});
