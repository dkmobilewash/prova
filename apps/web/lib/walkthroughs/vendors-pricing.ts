import type { Walkthrough } from "./types";

/** /vendors/pricing — what your suppliers have quoted, and which way it is moving. */
export const vendorPricingWalkthrough: Walkthrough = {
  route: "/vendors/pricing",
  title: "Vendor pricing",
  steps: [
    {
      anchor: "vp-record",
      title: "Record a price",
      body:
        "Press Record a price, pick the vendor, and type what they quoted, the unit and the date. If you have no vendors yet, add one on the Vendors page first.",
    },
    {
      anchor: "vp-empty",
      title: "No prices yet",
      body:
        "Start with what you buy most — board, studs, joint compound. Two quotes for the same item is when this page can show you which way the price moved.",
    },
    {
      anchor: "vp-items",
      title: "One box per item",
      body:
        "Each thing you buy gets its own box with every quote for it, newest first. The cheapest current quote is marked.",
    },
    {
      anchor: "vp-live-prices",
      title: "Who is cheapest",
      body:
        "The cheapest current price for this item and how far the others are from it. Prices are only compared when they use the same unit.",
    },
    {
      anchor: "vp-movement",
      title: "Going up or down",
      body: "How much each vendor's price for this item has changed since their earlier quote. Red is up, green is down.",
    },
    {
      anchor: "vp-catalog-gap",
      title: "Your estimate price is too low",
      body:
        "Your saved price for this item is lower than anyone will sell it for. Nothing was changed for you — update it on the catalog page if you agree.",
    },
  ],
};
