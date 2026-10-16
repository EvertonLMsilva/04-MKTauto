import { ShopeeAffiliateLive } from "../backend/dist/affiliate/infrastructure/shopee-affiliate-live.js";

// Standalone, explicitly selected probe. Never imported by the application.
// Prints metadata only; no raw errors, responses, offers or credentials.
if (process.argv.length !== 3 || process.argv[2] !== "--execute-once") {
  console.log(
    JSON.stringify({
      requestCount: 0,
      errorCodes: ["EXPLICIT_EXECUTION_REQUIRED"],
    }),
  );
  process.exitCode = 1;
} else {
  let live;
  try {
    live = new ShopeeAffiliateLive(
      {
        appId: process.env.SHOPEE_AFFILIATE_APP_ID ?? "",
        secret: process.env.SHOPEE_AFFILIATE_SECRET ?? "",
      },
      { fetch: globalThis.fetch },
    );
    await live.queryOffers();
    console.log(JSON.stringify(live.metadata()));
  } catch {
    console.log(
      JSON.stringify(
        live?.metadata() ?? {
          requestCount: 0,
          httpStatus: null,
          authentication: "UNKNOWN",
          operation: "productOfferV2",
          offersReturned: null,
          contractFields: [],
          errorCodes: ["SHOPEE_LIVE_CREDENTIALS_MISSING"],
        },
      ),
    );
    process.exitCode = 1;
  }
}
