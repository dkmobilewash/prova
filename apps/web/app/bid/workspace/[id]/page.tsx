import TakeoffWorkspacePage from "@/app/takeoff/[id]/page";

export const metadata = { title: "Takeoff workspace" };

/**
 * C Stream Bid — the full-screen takeoff workspace. OUTSIDE the signed-in shell
 * (`app/bid/(signed-in)`) for the reason the CRM's `/takeoff/[id]` sits outside
 * `(app)`: a shell header takes the viewport the workspace exists to give the
 * drawing. It authenticates itself, exactly as that page does — and middleware
 * already requires a session for everything under `/bid` but the landing page
 * and the free read.
 *
 * THE CRM'S OWN PAGE rendered with `surface="bid"`: same loader, same
 * workspace, "Back to the estimate" and the wall-type library pointing into Bid.
 */
export default function BidTakeoffWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; key?: string }>;
}) {
  return <TakeoffWorkspacePage params={params} searchParams={searchParams} surface="bid" />;
}
