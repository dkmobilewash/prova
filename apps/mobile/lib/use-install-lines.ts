import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import { cacheKeys } from "@/lib/cache-keys";
import { cachedRead, withToken } from "@/lib/cached-read";
import type { LineItem } from "@/lib/types";
import { useStableGetToken } from "@/lib/use-stable-get-token";

/** The job's lines a field report can take a quantity on. With no signal this
 * reads what the phone last loaded, and with nothing cached the form just has no
 * quantity boxes, so a report can still be filed. */
export function useInstallLines(jobId: string | undefined): LineItem[] {
  const getToken = useStableGetToken();
  const [lines, setLines] = useState<LineItem[]>([]);
  useEffect(() => {
    if (!jobId) return;
    void cachedRead(
      cacheKeys.lineItems(jobId),
      withToken(getToken, (token) => api.listLineItems(jobId, token)),
    ).then((result) => {
      if (result.from !== "nothing") setLines(result.value.filter((line) => line.install));
    });
  }, [jobId, getToken]);
  return lines;
}
