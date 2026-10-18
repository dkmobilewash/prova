import { describe, expect, it, vi } from "vitest";
import { UnsafeUrlError, assertPublicUrl, isPrivateAddress, safeFetch } from "./safeFetch";

const lookupTo = (address: string) => vi.fn(async () => [{ address, family: address.includes(":") ? 6 : 4 }]);

describe("isPrivateAddress", () => {
  it.each(["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:169.254.169.254"])(
    "refuses %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["93.184.216.34", "172.32.0.1", "2606:4700::1111"])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("assertPublicUrl", () => {
  it("refuses a host that resolves to the metadata address", async () => {
    await expect(assertPublicUrl(new URL("https://evil.example/"), lookupTo("169.254.169.254"))).rejects.toThrow(UnsafeUrlError);
  });
  it("refuses when ANY of the addresses is private", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]);
    await expect(assertPublicUrl(new URL("https://split.example/"), lookup)).rejects.toThrow(/private/);
  });
  it("refuses a non-web scheme before any lookup", async () => {
    const lookup = lookupTo("93.184.216.34");
    await expect(assertPublicUrl(new URL("file:///etc/passwd"), lookup)).rejects.toThrow(/only web pages/);
    expect(lookup).not.toHaveBeenCalled();
  });
  it("refuses IP literals, v4 and v6", async () => {
    await expect(assertPublicUrl(new URL("http://93.184.216.34/"), lookupTo("93.184.216.34"))).rejects.toThrow(/IP address/);
    await expect(assertPublicUrl(new URL("http://[::1]/"), lookupTo("::1"))).rejects.toThrow(/IP address/);
  });
  it("allows a public host", async () => {
    await expect(assertPublicUrl(new URL("https://bakerdrywall.com/"), lookupTo("93.184.216.34"))).resolves.toBeUndefined();
  });
});

describe("safeFetch", () => {
  it("re-checks a redirect and refuses one whose host resolves private", async () => {
    const lookup = vi.fn(async (host: string) => [{ address: host === "bakerdrywall.com" ? "93.184.216.34" : "10.0.0.9", family: 4 }]);
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://internal.bakerdrywall.com/" } }));
    await expect(safeFetch("https://bakerdrywall.com/", { fetch: fetch as never, lookup })).rejects.toThrow(/private/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("refuses a redirect to a different site", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 301, headers: { location: "http://169.254.169.254/latest" } }));
    await expect(safeFetch("https://bakerdrywall.com/", { fetch: fetch as never, lookup: lookupTo("93.184.216.34") })).rejects.toThrow(UnsafeUrlError);
  });
  it("follows a same-site redirect and caps the body", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://www.bakerdrywall.com/" } }))
      .mockResolvedValueOnce(new Response("x".repeat(5000)));
    const page = await safeFetch("https://bakerdrywall.com/", { fetch, lookup: lookupTo("93.184.216.34"), maxBytes: 100 });
    expect(page?.url).toBe("https://www.bakerdrywall.com/");
    expect(page!.body.length).toBeLessThan(5000);
  });
  it("gives up after three redirects", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://bakerdrywall.com/again" } }));
    expect(await safeFetch("https://bakerdrywall.com/", { fetch: fetch as never, lookup: lookupTo("93.184.216.34") })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("a site that does not answer is null, not a throw", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await safeFetch("https://bakerdrywall.com/", { fetch: fetch as never, lookup: lookupTo("93.184.216.34") })).toBeNull();
  });
});
