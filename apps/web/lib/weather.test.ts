import { describe, expect, it } from "vitest";
import { fetchDayWeather, geocodeSite, siteToday, weatherIsStale, weatherLine } from "./weather";

const reply = (body: unknown, ok = true) => async () => ({ ok, json: async () => body });

const day = (date: string, code = 63) => ({
  timezone: "America/Los_Angeles",
  utc_offset_seconds: -25200,
  daily: {
    time: [date],
    temperature_2m_max: [64.2],
    temperature_2m_min: [51.8],
    precipitation_sum: [0.42],
    wind_speed_10m_max: [12.4],
    weather_code: [code],
  },
});

describe("site weather", () => {
  it("reads one day, and calls it observed once the SITE's day is over", async () => {
    // 2026-09-18 03:00 UTC is still 2026-09-17 at 20:00 in Portland.
    const lateEvening = new Date("2026-09-18T03:00:00Z");
    const today = await fetchDayWeather({ latitude: 45.5, longitude: -122.7 }, "2026-09-17", lateEvening, reply(day("2026-09-17")));
    expect(today?.kind).toBe("forecast");
    const nextMorning = new Date("2026-09-18T15:00:00Z");
    const done = await fetchDayWeather({ latitude: 45.5, longitude: -122.7 }, "2026-09-17", nextMorning, reply(day("2026-09-17")));
    expect(done).toMatchObject({ kind: "observed", tempHighF: 64.2, precipIn: 0.42, summary: "Rain", timeZone: "America/Los_Angeles" });
    expect(weatherLine(done!)).toBe("Rain · 52–64°F · 0.42 in · wind 12 mph");
  });

  it("returns null, never throws, when the service fails or answers for another day", async () => {
    expect(await fetchDayWeather({ latitude: 1, longitude: 1 }, "2026-09-17", new Date(), reply({}, false))).toBeNull();
    expect(await fetchDayWeather({ latitude: 1, longitude: 1 }, "2026-09-17", new Date(), reply(day("2026-09-16")))).toBeNull();
    const boom = async () => {
      throw new Error("timeout");
    };
    expect(await fetchDayWeather({ latitude: 1, longitude: 1 }, "2026-09-17", new Date(), boom)).toBeNull();
  });

  it("works out the site's calendar day from its UTC offset", () => {
    expect(siteToday(new Date("2026-09-18T03:00:00Z"), -25200)).toBe("2026-09-17");
    expect(siteToday(new Date("2026-09-18T08:00:00Z"), -25200)).toBe("2026-09-18");
  });

  it("refetches a forecast, never an observed day, and not more than every half hour", () => {
    const now = new Date("2026-09-19T12:00:00Z");
    expect(weatherIsStale(null, now)).toBe(true);
    expect(weatherIsStale({ kind: "observed", date: "2026-09-17", fetchedAt: "2026-09-18T00:00:00Z" }, now)).toBe(false);
    expect(weatherIsStale({ kind: "forecast", date: "2026-09-18", fetchedAt: "2026-09-18T20:00:00Z" }, now)).toBe(true);
    expect(weatherIsStale({ kind: "forecast", date: "2026-09-18", fetchedAt: "2026-09-19T11:45:00Z" }, now)).toBe(false);
  });

  it("geocodes a street address with the Census, and a city with Open-Meteo in the named state", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      if (url.includes("census.gov")) {
        return { ok: true, json: async () => ({ result: { addressMatches: [{ coordinates: { x: -122.68, y: 45.51 } }] } }) };
      }
      return {
        ok: true,
        json: async () => ({
          results: [
            { latitude: 45.5, longitude: -122.6, timezone: "America/Los_Angeles", admin1: "Maine" },
            { latitude: 45.52, longitude: -122.67, timezone: "America/Los_Angeles", admin1: "Oregon" },
          ],
        }),
      };
    };
    expect(await geocodeSite("1600 SW 4th Ave, Portland, OR", fetcher)).toEqual({ latitude: 45.51, longitude: -122.68, timeZone: null });
    expect(await geocodeSite("Portland, OR", fetcher)).toEqual({ latitude: 45.52, longitude: -122.67, timeZone: "America/Los_Angeles" });
    expect(calls.filter((c) => c.includes("census.gov"))).toHaveLength(1);
    expect(await geocodeSite("  ", fetcher)).toBeNull();
  });
});
