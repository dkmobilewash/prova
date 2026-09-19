import { handleDocuSignConnect } from "@/lib/docusign/connect-handler";

/**
 * DocuSign Connect (webhook) receiver. Public by necessity — DocuSign's
 * servers have no session — so everything it does is in
 * lib/docusign/connect-handler.ts, which verifies the HMAC signature before
 * reading a byte of meaning out of the body. See that file for the order of
 * refusals.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleDocuSignConnect(request);
}
