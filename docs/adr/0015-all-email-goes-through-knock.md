# All Cadence email goes through Knock

Every email Cadence sends goes out through a Knock workflow and Knock's single Resend channel, including email that isn't a Notification, such as the "Refund requested" receipt a buyer gets for their own Refund Request. Cadence has no second sending path: `mailer.server.ts`, its Postmark transport and the `.outbox/` fallback are removed. One path gives us one provider account and sending domain, one template system and look (Liquid templates in the repo), one dev safeguard (Knock's To override) and one test seam. Email the recipient caused themselves is an email-only Knock workflow that sits outside the Notification catalogue. It has no Notification Feed step, no category and no Notification Preference, so it is never a Notification and can't be turned off.

## Considered Options

- **Two senders, one provider**: `mailer.server.ts` sends receipts directly through Resend, and Knock sends Notifications. The receipt would survive a Knock outage, but we'd have two code paths, two email designs, and a second dev safeguard rebuilt in TS. Rejected.
- **Two senders, two providers**: keep Postmark for transactional email next to Knock and Resend. This adds a second sign-up and domain verification, and the emails come from mismatched senders. Postmark had never sent a real email (no token was ever set). Rejected.
- **Postmark instead of Resend behind Knock**: Knock supports it natively, but it reverses the email provider decision (100-email monthly free tier, manual production approval) to keep about 40 lines of code. Rejected.

## Consequences

- If Knock is unreachable, buyer-caused email fails too, not only Notifications. How triggers fail and retry covers both kinds.
- Knock is a hard dependency for all email, and every send counts against Knock's monthly message allowance.
- Email-only workflows and their templates live in the repo and are pushed by the same sync script as Notifications (ADR 0013). They just have no defaults to sync.
- An email-only workflow must have no category and no entry in the Notification catalogue. Otherwise it picks up preferences and the preference sync (ADR 0013) can turn it off.
- Future emails the recipient caused themselves (for example a welcome email on purchase) follow the same pattern: a new email-only workflow, not new mailer code.
- "A Knock message" doesn't always mean "a Notification". The Notification catalogue in code is the source of truth for which workflows are Notifications.
