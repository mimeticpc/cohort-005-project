# Refund is separate from Refund Request; Enrollment Ends at Approval

A Refund Request records an Admin's decision; a Refund records the money. They are kept as two entities with their own states (Open/Approved/Declined vs Pending/Issued/Failed) because a decision is final the moment it is made, while money can sit Pending or Fail and be retried long afterwards. The Learner's Enrollment Ends at Approval, not when the Refund is Issued: once the platform has committed to returning the money, the Learner should not keep watching while it is in flight, and a Failed Refund is retried rather than reversed, so access is never restored by a payment hiccup.

## Considered Options

- **Single entity** (an `amountRefunded` column on the Refund Request): rejected because it cannot express "approved but money not yet sent" or "money failed", which the issuing slice needs.
- **End the Enrollment when the Refund is Issued**: rejected because it lets a Learner keep consuming the Course for as long as payment takes, and ties access to payment-provider timing.

## Consequences

- Purchases are never altered by a Refund; they remain the record that money changed hands.
- Ended Enrollments stay on record and are never reopened; buying again creates a new Purchase and Enrollment. Progress survives, so a returning Learner resumes where they left off.
