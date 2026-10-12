/** Where the tool points people who want more than a waiver. Set per
 * deployment; the default is C-Stream's public site. */
export const CSTREAM_URL = process.env.NEXT_PUBLIC_CSTREAM_URL?.trim() || "https://cstream.ai";

/** Must equal next.config.mjs `basePath`. Next adds it to <Link> and
 * assets on its own, but NOT to a bare fetch(), which is what this is for. */
export const BASE_PATH = "/lien-waiver";

export const SITE_NAME = "Free Lien Waiver Forms";
