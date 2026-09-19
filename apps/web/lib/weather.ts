/**
 * Job-site weather for daily reports, from public services that need no key:
 *
 *   - the US Census geocoder turns a street address into coordinates;
 *   - Open-Meteo's place search does the same for "Portland, OR";
 *   - Open-Meteo's forecast API gives one day's high, low, precipitation,
 *     wind and conditions for those coordinates, for a day up to ~3 months
 *     back (the archive API beyond that).
 *
 * Typed weather is the first thing a GC disputes, so the report stores what
 * these return and never asks anyone to type it. A day still in progress is
 * a FORECAST; once it is over (in the site's own time zone) the same call
 * returns the OBSERVED day, which replaces it.
 *
 * Every function here returns null on any failure — a slow or down weather
 * service must never stop a foreman filing a report.
 */

export type SiteCoordinates = { latitude: number; longitude: number; timeZone: string | null };

export type DayWeather = {
  kind: "forecast" | "observed";
  source: "Open-Meteo";
  fetchedAt: string;
  date: string;
  tempHighF: number | null;
  tempLowF: number | null;
  precipIn: number | null;
  windMaxMph: number | null;
  code: number | null;
  summary: string;
};

const TIMEOUT_MS = 5000;

type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });

/** WMO weather interpretation codes, as Open-Meteo reports them. */
const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Heavy freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm with hail",
};

export function weatherSummary(code: number | null): string {
  if (code === null) return "Conditions not reported";
  return WMO[code] ?? `Weather code ${code}`;
}

/** "Rain · 58–64°F · 0.42 in · wind 12 mph" — one line for a report row. */
export function weatherLine(w: Pick<DayWeather, "summary" | "tempHighF" | "tempLowF" | "precipIn" | "windMaxMph">): string {
  const parts = [w.summary];
  if (w.tempLowF !== null && w.tempHighF !== null) parts.push(`${Math.round(w.tempLowF)}–${Math.round(w.tempHighF)}°F`);
  if (w.precipIn !== null && w.precipIn > 0) parts.push(`${w.precipIn.toFixed(2)} in`);
  if (w.windMaxMph !== null) parts.push(`wind ${Math.round(w.windMaxMph)} mph`);
  return parts.join(" · ");
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The site's calendar day right now, yyyy-mm-dd, from Open-Meteo's own
 * utc_offset_seconds for that place. */
export function siteToday(now: Date, utcOffsetSeconds: number): string {
  return new Date(now.getTime() + utcOffsetSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Coordinates for what a person typed as the site. A street address (it
 * starts with a house number) goes to the US Census geocoder; anything else,
 * or an address the Census cannot match, goes to Open-Meteo's place search
 * on the part before the first comma, preferring a result in the state named
 * after it. The time zone comes from Open-Meteo when it is the one that
 * matched; otherwise the first weather fetch fills it in.
 */
export async function geocodeSite(address: string, fetcher: Fetcher = defaultFetch): Promise<SiteCoordinates | null> {
  const text = address.trim();
  if (!text) return null;
  try {
    if (/^\d/.test(text)) {
      const url =
        "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" +
        encodeURIComponent(text);
      const res = await fetcher(url);
      if (res.ok) {
        const body = (await res.json()) as { result?: { addressMatches?: { coordinates?: { x?: unknown; y?: unknown } }[] } };
        const match = body.result?.addressMatches?.[0]?.coordinates;
        const latitude = num(match?.y);
        const longitude = num(match?.x);
        if (latitude !== null && longitude !== null) return { latitude, longitude, timeZone: null };
      }
    }

    const [place, ...rest] = text.split(",").map((part) => part.trim());
    const region = rest.join(" ").replace(/\d{5}(-\d{4})?/, "").trim().toLowerCase();
    // A street address the Census could not match: search on the city, which
    // is the second-to-last comma part ("123 Main St, Portland, OR").
    const name = /^\d/.test(place) && rest.length > 1 ? rest[0] : place;
    const url =
      "https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&format=json&countryCode=US&name=" +
      encodeURIComponent(name);
    const res = await fetcher(url);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      results?: { latitude?: unknown; longitude?: unknown; timezone?: unknown; admin1?: unknown }[];
    };
    const results = body.results ?? [];
    if (results.length === 0) return null;
    const stateHint = region.split(/\s+/).pop() ?? "";
    const preferred =
      results.find((r) => {
        const admin = typeof r.admin1 === "string" ? r.admin1.toLowerCase() : "";
        return stateHint.length > 0 && (admin === stateHint || STATE_ABBREVIATIONS[stateHint] === admin);
      }) ?? results[0];
    const latitude = num(preferred.latitude);
    const longitude = num(preferred.longitude);
    if (latitude === null || longitude === null) return null;
    return { latitude, longitude, timeZone: typeof preferred.timezone === "string" ? preferred.timezone : null };
  } catch {
    return null;
  }
}

/**
 * One day's weather at the site. `kind` is "observed" when the day is over
 * in the site's own time zone, "forecast" otherwise. Days more than 90 back
 * come from the archive API (always observed).
 */
export async function fetchDayWeather(
  site: { latitude: number; longitude: number },
  date: string,
  now: Date = new Date(),
  fetcher: Fetcher = defaultFetch,
): Promise<(DayWeather & { timeZone: string | null }) | null> {
  const daily = "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code";
  const query =
    `latitude=${site.latitude}&longitude=${site.longitude}&daily=${daily}` +
    `&start_date=${date}&end_date=${date}&timezone=auto` +
    "&temperature_unit=fahrenheit&precipitation_unit=inch&wind_speed_unit=mph";
  const ageDays = (now.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000;
  const base = ageDays > 90 ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
  try {
    const res = await fetcher(`${base}?${query}`);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      timezone?: unknown;
      utc_offset_seconds?: unknown;
      daily?: Record<string, unknown[]>;
    };
    const d = body.daily;
    if (!d || !Array.isArray(d.time) || d.time[0] !== date) return null;
    const code = num(d.weather_code?.[0]);
    const offset = num(body.utc_offset_seconds) ?? 0;
    return {
      kind: date < siteToday(now, offset) ? "observed" : "forecast",
      source: "Open-Meteo",
      fetchedAt: now.toISOString(),
      date,
      tempHighF: num(d.temperature_2m_max?.[0]),
      tempLowF: num(d.temperature_2m_min?.[0]),
      precipIn: num(d.precipitation_sum?.[0]),
      windMaxMph: num(d.wind_speed_10m_max?.[0]),
      code,
      summary: weatherSummary(code),
      timeZone: typeof body.timezone === "string" ? body.timezone : null,
    };
  } catch {
    return null;
  }
}

/** Whether a stored report weather should be fetched again: never fetched,
 * or a forecast whose day may now be over, or a forecast more than three
 * hours old. An observed day is final. */
export function weatherIsStale(stored: unknown, now: Date = new Date()): boolean {
  if (!stored || typeof stored !== "object") return true;
  const w = stored as Partial<DayWeather>;
  if (w.kind === "observed") return false;
  const fetchedAt = typeof w.fetchedAt === "string" ? new Date(w.fetchedAt).getTime() : 0;
  // Not more than every half hour, whatever else is true: the UTC day below
  // turns over hours before a US site's day does.
  if (now.getTime() - fetchedAt < 30 * 60_000) return false;
  if (typeof w.date === "string" && w.date < now.toISOString().slice(0, 10)) return true;
  return now.getTime() - fetchedAt > 3 * 3600_000;
}

const STATE_ABBREVIATIONS: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
  ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho",
  il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
  me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota",
  ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
  nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas",
  ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia",
  wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};
