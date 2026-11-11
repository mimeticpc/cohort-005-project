---
status: deprecated
---

> Deprecated: email is now sent through Postmark when `POSTMARK_SERVER_TOKEN` is set, and written to `.outbox/` as JSON otherwise (local dev, tests). See `app/lib/mailer.server.ts`. The original decision is kept below for history.

# Refund emails go to the server log until we choose a mail provider

A learner who asks for a refund is promised a confirmation email, but Cadence has no mail transport. `raiseRefundRequest` builds the full message and the refund route writes it to the server log, and the settings page stays the learner's record of a pending Refund. Sending from our own SMTP server would mean running SPF, DKIM and a sender reputation ourselves, and signing up with a provider now would commit us to a pricing tier before we know our volume.

## Consequences

No learner actually receives the confirmation, and the line "we will email you again when it is done" is a promise we cannot keep yet. When a provider is chosen, it replaces the `console.log` in the refund route.
