import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /photos after the declutter pass (density audit #40): four rows of chips
 * sat above zero photos, the job chips carried GC + status, and "pick a job
 * above" was said twice. The photo filters now wait for a photo; the job
 * row stays (it is how a new photo's job is picked).
 */

let total = 0;
vi.mock("@prova/db", () => ({
  prisma: {
    job: {
      findMany: vi.fn(async () => [{ id: "job-1", name: "Riverside", status: "IN_PROGRESS", contact: { name: "Turner" } }]),
    },
  },
}));
vi.mock("@/lib/authz", () => ({
  requireCapability: vi.fn(async () => ({ allowed: true, context: { company: { id: "co-1" }, id: "u-1", role: "OWNER" } })),
}));
vi.mock("@/lib/viewerToday", () => ({ viewerTimeZone: async () => "UTC", viewerToday: async () => "2026-10-14" }));
vi.mock("@/lib/job-media-query", () => ({
  loadJobMedia: vi.fn(async () => []),
  countJobMedia: vi.fn(async () => total),
  loadJobMediaTags: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/photos", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions", () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : vi.fn()) }));

const { default: PhotosPage } = await import("@/app/(app)/photos/page");
const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await PhotosPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  total = 0;
});

describe("/photos", () => {
  it("with no photos: the job row only, and 'pick a job above' said once", async () => {
    const html = await render();
    expect(html).toContain('data-tour="photos-job-filter"');
    expect(html).not.toContain('data-tour="photos-shared-filter"');
    expect(html).not.toContain('data-tour="photos-location-filter"');
    expect(html.match(/Pick a job above/gi) ?? []).toHaveLength(1);
  });

  it("names the job on its chip, with the full label in the title", async () => {
    const html = await render();
    expect(html).toMatch(/title="Riverside — Turner · [^"]+"[^>]*>Riverside<\/a>/);
  });

  it("shows the photo filters once there is a photo", async () => {
    total = 3;
    const html = await render();
    expect(html).toContain('data-tour="photos-shared-filter"');
    expect(html).toContain('data-tour="photos-location-filter"');
  });

  it("keeps them when a filter emptied the gallery, so there is a way back", async () => {
    const html = await render({ shared: "no" });
    expect(html).toContain('data-tour="photos-shared-filter"');
    expect(html).toContain('data-tour="photos-location-filter"');
  });
});
