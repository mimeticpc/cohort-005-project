# Notifications live only in Knock

Knock is the only place a Notification is stored. That covers the item in the Notification Feed, its seen and read state, and its content. Cadence keeps no copy in `data.db`, and the Notification Feed polls Knock's headless feed directly. This is a deliberate exception to ADR 0006 (one SQLite file). The things a Notification reports on (Refund Requests, Seats, Enrollments, comments) are already recorded in `data.db`, so a lost Notification never loses a fact. A local copy would mean writing everything twice and keeping read state in sync with Knock. Knock keeps feed items indefinitely, so we don't need a local copy for history either.

## Considered Options

- **Mirror every Notification into a local table**: allows local queries and joins, but every send is written twice and read/seen state has to be kept in sync with Knock. Rejected.
- **A local table as the Notification Feed's source of truth, with Knock only sending email**: we'd be building the feed infrastructure ourselves, which is out of scope. Rejected.

## Consequences

- A feed row shows a snapshot of the trigger `data` (actor, avatar, titles, excerpt). Renaming someone or editing a comment later doesn't change rows already sent.
- Notifications are never cleaned up when their target is deleted. A link to a deleted lesson goes to that page's normal not-found state.
- If Knock is unreachable, only the bell is affected: the badge hides, the popover shows an error, and the page still renders.
- Any future user deletion must also delete the user in Knock. Knock's delete-user endpoint hard-deletes that user's messages and preferences.
- Message logs in Knock (delivery details) expire after 30 days on the Free and Starter plans. Feed items don't expire.
- Whether Cadence needs a local outbox for retrying triggers is a separate delivery question. This ADR doesn't decide it.
