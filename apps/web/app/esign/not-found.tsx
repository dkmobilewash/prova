import { PublicRouteNotFound } from "@/components/PublicRouteNotFound";

/**
 * The same 404, for the signing route.
 *
 * `/esign/[token]` calls `notFound()` twice — an unknown token, and a
 * PENDING request that has been revoked or has expired — and had no
 * `not-found.tsx` either, so both landed on the stock Next 404 exactly as
 * the portal's did. `error.tsx` is already shared between these two route
 * groups (`PublicRouteError`); this is the missing half of that pair.
 */
export default function EsignNotFound() {
  return <PublicRouteNotFound />;
}
