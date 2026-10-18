import type { Metadata } from "next";
import { ChangeOrderTool } from "@/components/ChangeOrderTool";

/**
 * The free change order request, at /lien-waiver/change-order on this app
 * (basePath). On cstream.ai it is reachable at the same path through
 * prova-web's existing /lien-waiver/* rewrite; a shorter
 * cstream.ai/change-order needs its own rewrite on prova-web (Diego).
 */
export const metadata: Metadata = {
  title: { absolute: "Free change order request (PCO) — fill it out on your phone" },
  description:
    "Write a change order request on your phone: scope, labor, material, equipment, markup and schedule impact, with a GC signature block. Free PDF by email, no account. From C-Stream.",
};

export default function ChangeOrderPage() {
  return <ChangeOrderTool />;
}
