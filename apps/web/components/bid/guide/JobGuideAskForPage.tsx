"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { JobGuideAsk } from "@/components/bid/guide/JobGuideAsk";
import { pickAsk } from "@/lib/bid/guide/pickAsk";
import type { JobGuide } from "@/lib/bid/guide/types";

/** The ask card, worded for the page it sits on — see `pickAsk`. */
export function JobGuideAskForPage({ guide }: { guide: JobGuide }) {
  const pathname = usePathname() ?? "";
  const invitation = useSearchParams()?.get("invitation")?.trim() || null;
  return <JobGuideAsk guide={pickAsk(guide, pathname, invitation)} />;
}
