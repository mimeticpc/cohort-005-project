# Cadence

An online course platform where Learners buy and work through Courses.

## Language

**Learner**:
A person who buys and takes Courses. Provisional term; may be revisited.
_Avoid_: Student

**Admin**:
A person who runs the platform, including the people who Resolve Refund Requests. Not the Admin of a Team.
_Avoid_: Support member, Staff, Platform admin

**Purchase**:
A Learner's payment for a Course. A Purchase is a permanent record: a Refund never changes or removes it.

**Enrollment**:
A Learner's access to a Course. It is Active until it is Ended; an Approved Refund Request Ends it at the moment of approval. An Ended Enrollment stays on record and is never reopened: buying the Course again makes a new Purchase and a new Enrollment. The Learner's progress, ratings and comments survive an Ended Enrollment.
_Avoid_: Access, Seat

### Refunds

**Refund Request**:
A Learner's ask to get back what they paid for a Purchase. It is Open until a platform Admin resolves it as Approved or Declined.
_Avoid_: Cancellation, Reversal, Chargeback

**Refund**:
The return of a Learner's money for a Purchase. Every Approved Refund Request has exactly one Refund, which comes into existence at approval. It is always the full amount the Learner paid, never the Course's list price and never a part of it. A Learner gets at most one Refund per Course, across all their Purchases of it.
_Avoid_: Cancellation, Reversal, Chargeback

### Refund Request states

**Open**:
The state of a Refund Request that no Admin has resolved yet. A Purchase has at most one Open Refund Request. An Open Refund Request is not a Pending Refund: one waits on a decision, the other on money.
_Avoid_: Pending Refund Request, Requested

**Resolve**:
A platform Admin's act of moving an Open Refund Request to Approved or Declined. A resolution is final.
_Avoid_: Disposition, Decide

**Approved**:
The state of a Refund Request where an Admin decided the money will be returned. It says nothing about whether money has moved.

**Declined**:
The state of a Refund Request where an Admin decided no money will be returned. The Learner may raise a new Refund Request for the same Purchase.
_Avoid_: Rejected, Denied

### Refund states

**Pending**:
The state of a Refund whose money has not yet been sent to the Learner. Every Refund starts Pending.
_Avoid_: using Pending for a Refund Request (see Open)

**Issued**:
The state of a Refund whose money has been sent to the Learner.
_Avoid_: Processed, Sent

**Failed**:
The state of a Refund whose money could not be delivered to the Learner. A retry moves the same Refund back to Issued.
