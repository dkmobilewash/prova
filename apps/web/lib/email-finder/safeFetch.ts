import { BlockList, isIP } from "node:net";
import { promises as dns } from "node:dns";

/**
 * FETCH A PAGE FROM A HOST A SEARCH ENGINE HANDED US, WITHOUT LETTING THAT HOST
 * POINT US AT OURSELVES.
 *
 * The domain the email finder fetches comes from a search result or from a box
 * a caller typed into — both strings nobody here controls. A server that
 * fetches an arbitrary URL is a server that can be told to fetch
 * `169.254.169.254` (the cloud metadata endpoint) or something on its own
 * private network. So every hop — the first URL and every redirect — is
 * resolved first and refused if ANY address it resolves to is private,
 * loopback, link-local or unspecified; IP literals and non-http(s) schemes are
 * refused before any lookup.
 *
 * Refusals are `UnsafeUrlError` with a sentence a person can read; the caller
 * turns it into the action's result rather than a throw.
 */

export class UnsafeUrlError extends Error {}

export type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;
export type FetchFn = typeof fetch;

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["255.255.255.255", 32],
] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true; // not an address at all: refuse rather than guess
  if (family === 6) {
    // IPv4-mapped (::ffff:10.0.0.1) is the IPv4 address wearing a disguise.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(address, "ipv6");
  }
  return blocked.check(address, "ipv4");
}

const systemLookup: Lookup = (host) => dns.lookup(host, { all: true });

export async function assertPublicUrl(url: URL, lookup: Lookup = systemLookup): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Refused ${url.protocol}// — only web pages are fetched.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    throw new UnsafeUrlError(`Refused ${host}: an IP address is not a company website.`);
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new UnsafeUrlError(`${host} does not resolve — no such website.`);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError(`Refused ${host}: it resolves to a private or internal address.`);
  }
}

/** `www.x.com` and `x.com` are one site; anything else is somebody else's. */
function sameSite(host: string, domain: string): boolean {
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
  const h = bare(host);
  const d = bare(domain);
  return h === d || h.endsWith(`.${d}`);
}

export type SafeFetchOptions = {
  fetch?: FetchFn;
  lookup?: Lookup;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
};

export type SafePage = { url: string; status: number; body: string };

/**
 * GET one page. Redirects are followed by hand (at most `maxRedirects`), each
 * one re-checked and required to stay on the starting site. The body is cut at
 * `maxBytes`. Network failures and timeouts return null — a site that does not
 * answer is "no page", not an error; only a REFUSAL throws.
 *
 * ponytail: the address is checked, then fetch resolves again — a host that
 * re-points its DNS between the two (rebinding) gets one blind GET through.
 * The body is only scanned for email addresses and never shown, which is what
 * makes that acceptable for now; pin the address with an undici Agent `connect`
 * lookup if this ever returns page content to a person.
 */
export async function safeFetch(start: string, opts: SafeFetchOptions = {}): Promise<SafePage | null> {
  const doFetch = opts.fetch ?? fetch;
  const maxRedirects = opts.maxRedirects ?? 3;
  const maxBytes = opts.maxBytes ?? 1_000_000;
  let url = new URL(start);
  const origin = url.hostname;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(url, opts.lookup);
    let response: Response;
    try {
      response = await doFetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        headers: { "User-Agent": opts.userAgent ?? "CStreamBot/1.0 (+https://app.cstream.ai)" },
      });
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      const next = new URL(location, url);
      if (!sameSite(next.hostname, origin)) {
        throw new UnsafeUrlError(`Refused a redirect from ${origin} to ${next.hostname}: a different site.`);
      }
      url = next;
      continue;
    }
    return { url: url.toString(), status: response.status, body: await readCapped(response, maxBytes) };
  }
  return null;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, maxBytes - bytes);
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
  } catch {
    // A body that dies halfway is still worth scanning for what did arrive.
  } finally {
    reader.cancel().catch(() => {});
  }
  return text;
}
