# A buyer whose country is unknown pays full price

The buyer's country comes only from the dev session override or Cloudflare's `CF-IPCountry` header. If neither is present, `resolveCountry` returns null and the buyer pays full price. It never looks the country up over the network. The main reason is spoofing: a client can write any `X-Forwarded-For` it likes, and because a purchase keeps the country it was sold in (ADR-0009), a discount won by a forged address stays on that purchase for good. The other reasons are that ip-api.com's free tier is for non-commercial use only and that a lookup would make the course list, the purchase page and lesson pages wait on a network call. This deliberately overcharges a genuine learner whose request arrives without the header.

## Considered Options

- **Look up the first `X-Forwarded-For` address on ip-api.com's free endpoint** (ADR-0008). Rejected: the header can be spoofed, the licence forbids commercial use, it runs over plain HTTP, and it allows 45 requests a minute.
- **ip-api Pro.** Rejected: it fixes the licence and rate limit, but not spoofing or latency.
- **Bundle a MaxMind GeoLite2 database.** Rejected: it needs a licence key, a download of tens of megabytes, a monthly update, and still needs a trusted client IP.
- **Trust `X-Forwarded-For` only behind a configured proxy.** Rejected: it adds deployment configuration to protect a fallback that Cloudflare already makes unnecessary.

## Consequences

- Purchasing-power pricing depends on Cloudflare being in front of the app. Moving to a host without it silently charges every buyer full price.
- Unknown is treated differently at sale and afterwards. A null country at checkout means full price, but a null country on a lesson page does not block a discounted purchase (`checkPppAccess` blocks only a known, different country). Do not tighten lesson access to block on null: it would lock out learners who have paid.
- `app/lib/country.server.test.ts` asserts that country resolution never calls `fetch`. That test enforces this ADR.
