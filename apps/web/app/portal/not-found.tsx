import { PublicRouteNotFound } from "@/components/PublicRouteNotFound";

/**
 * The 404 for the client portal — the one surface an outside company ever
 * sees. See `components/PublicRouteNotFound.tsx` for why it carries no link
 * into the app and why its copy must stay vague about whether the token ever
 * existed.
 *
 * Covers every `notFound()` under `/portal`: a token that does not resolve,
 * a revoked or INACTIVE contact, and a jobId that belongs to someone else.
 */
export default function PortalNotFound() {
  return <PublicRouteNotFound />;
}
