import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { RegretLetter } from "./RegretLetter";

/**
 * The regret letter for a declined bid. The letter itself and its company
 * scoping live in `./RegretLetter.tsx`, which C Stream Bid also renders
 * (`app/bid/(signed-in)/bids/[id]/regret`) with `surface="bid"`. It is a
 * component rather than this page's default export because Next only lets a
 * page's default export take `params` and `searchParams` — a `surface` prop
 * here typechecks and then fails `next build` ("invalid default export").
 */
export default async function RegretLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { id } = await params;
  return RegretLetter({ id, company: context.company, surface: "crm" });
}
