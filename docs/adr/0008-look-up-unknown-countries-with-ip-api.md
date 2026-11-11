---
status: superseded by ADR-0012
---

> Superseded by [ADR-0012](./0012-an-unknown-country-pays-full-price.md): the buyer's country now comes only from `CF-IPCountry`, and no network lookup is made. The original decision is kept below for history.

# Look up a buyer's country with ip-api.com when the request does not carry one

Purchasing-power prices depend on the buyer's country. Behind Cloudflare the request carries it in the `CF-IPCountry` header, but not every request comes through Cloudflare. When the header is missing, `resolveCountry` looks up the first `X-Forwarded-For` address on ip-api.com's free endpoint, and only falls back to full price if that lookup fails.

## Considered Options

- **Bundle a MaxMind GeoLite2 database.** Rejected: it needs a licence key, a download of tens of megabytes, and an update every month.
- **Charge full price whenever the country is unknown.** Rejected: it overcharges exactly the learners purchasing-power pricing is for.

## Consequences

The course list, the purchase page and every lesson page for a discounted purchase can wait on a network call. The free endpoint is plain HTTP and limited to 45 requests a minute.
