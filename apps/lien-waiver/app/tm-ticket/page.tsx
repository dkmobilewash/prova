import type { Metadata } from "next";
import { TmTicketTool } from "@/components/TmTicketTool";

/**
 * The free T&M / extra-work ticket, at /lien-waiver/tm-ticket on this app
 * (basePath). On cstream.ai it is reachable at the same path through
 * prova-web's existing /lien-waiver/* rewrite; a shorter cstream.ai/tm-ticket
 * needs its own rewrite on prova-web (Diego).
 */
export const metadata: Metadata = {
  title: { absolute: "Free T&M ticket — crew hours and materials, signed on your phone" },
  description:
    "Write the end-of-day T&M ticket for extra work on your phone: crew hours, material, equipment, and the GC super signs on the screen. Free PDF emailed to you and the super, no account. From C-Stream.",
};

export default function TmTicketPage() {
  return <TmTicketTool />;
}
