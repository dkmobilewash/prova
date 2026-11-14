/**
 * ── IS PRODUCTION ACTUALLY SHIPPING? — the deploy-status card on the pilot dashboard ──
 *
 * 2026-11-14: production deploys were frozen for ~12 hours (api/ask over Vercel's 5 GB function
 * limit) while CI stayed green, so nothing merged in that window was live and nobody could see it.
 * Diego's order: a failed Vercel production deploy must be impossible to miss. The CI half is
 * .github/workflows/vercel-deploy-watch.yml (a red check + a deploy-outage issue); this is the
 * operator half — the newest PRODUCTION deployment's state, read server-side from Vercel's REST.
 *
 * Renders NOTHING without VERCEL_TOKEN (a read-only token Diego mints in the dashboard and sets as
 * an env var — a credential, so it never travels through an agent channel). The project and team
 * ids are identifiers, not secrets; env overrides exist for both. The fetch is no-store: a cached
 * "READY" during an outage would be this card lying about the one thing it exists to say.
 */
const PROJECT = process.env.VERCEL_PROJECT_ID ?? "prj_zcUBJNZA4AFPsWswaZx9aEkDbqFu";
const TEAM = process.env.VERCEL_TEAM_ID ?? "team_a9hPOrTDrIirux5O6e9B2HSM";

type Row = { state?: string; createdAt?: number; meta?: { githubCommitSha?: string; githubCommitMessage?: string } };

export async function DeployStatus() {
  const token = process.env.VERCEL_TOKEN ?? "";
  if (token === "") return null;
  let latest: Row | null = null;
  try {
    const res = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${PROJECT}&teamId=${TEAM}&target=production&limit=1`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    latest = ((await res.json()) as { deployments?: Row[] }).deployments?.[0] ?? null;
  } catch {
    return (
      <p className="mb-4 rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink-muted">
        Deploy status could not be read from Vercel just now — that is this card failing, not the deploys.
      </p>
    );
  }
  if (latest === null) return null;
  const sha = (latest.meta?.githubCommitSha ?? "").slice(0, 8);
  const when = latest.createdAt ? new Date(latest.createdAt).toISOString().slice(0, 16).replace("T", " ") + "Z" : "";
  const failed = latest.state === "ERROR" || latest.state === "CANCELED";
  if (failed) {
    return (
      <p className="mb-4 rounded-md border border-red-700 bg-surface px-3 py-2 text-sm">
        <span className="font-semibold text-red-400">Production deploys are FAILING.</span>{" "}
        <span className="text-ink-body">
          The newest production deployment ({sha}, {when}) is {latest.state}: the app is serving an OLDER commit than
          main, and everything merged since the last green deploy is not live. See the deploy-outage issue on GitHub.
        </span>
      </p>
    );
  }
  return (
    <p className="mb-4 rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink-muted">
      Production deploys: the newest ({sha}, {when}) is {latest.state ?? "unknown"}.
    </p>
  );
}
