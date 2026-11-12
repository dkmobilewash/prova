#!/usr/bin/env node
// Daily (.github/workflows/clerk-sweep.yml), or by hand: deletes throwaway walk/e2e users older than
// 24 h from the DEVELOPMENT Clerk instance. Keeps the e2e-* personas and any non-throwaway address.
// See e2e/lib/throwawayUsers.mjs. Needs CLERK_SECRET_KEY = an sk_test_ key; prints counts only.
import { sweepThrowaways, testClerk } from "./lib/throwawayUsers.mjs";

const { total, deleted } = await sweepThrowaways(testClerk());
console.log(`clerk sweep: ${total} users on the instance, deleted ${deleted} throwaway users older than 24 h`);
