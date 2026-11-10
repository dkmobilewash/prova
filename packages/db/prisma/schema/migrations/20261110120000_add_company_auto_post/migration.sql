-- "Auto-post proven items" (lib/takeoff/autoPost.ts). Additive: existing companies stay off;
-- new companies are created with it on in lib/auth.ts, not by this default.
ALTER TABLE "Company" ADD COLUMN "autoPostOn" BOOLEAN NOT NULL DEFAULT false;
