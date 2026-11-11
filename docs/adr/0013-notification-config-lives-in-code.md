# Notification config lives in code; Knock is a sync target

Every Notification's workflow, templates and default Notification Preferences are defined in the repo. The defaults live in one catalogue module. A sync script pushes them to Knock: workflows with `knock workflow push --commit`, and environment defaults with a Management API PUT. It runs by hand for Development and as a required deploy step for Production. Nobody edits this config in the Knock dashboard. We chose this so you can understand how Notifications behave by reading the code, and so changes go through review and version control. Each Knock environment has its own unversioned defaults, which drift silently if edited by hand.

## Considered Options

- **Author defaults in the Knock dashboard** (Platform → Preferences): no code needed, but the config is invisible from the repo and has to be copied between environments by hand. Rejected.
- **Write the full default set into each person's Knock preferences**: then a default changed later would never reach existing people. Rejected.

## Consequences

- Production deploys need a `KNOCK_SERVICE_TOKEN` secret.
- In Knock, a person's entry for one workflow replaces that workflow's environment default, and a channel they leave unset counts as on. So saving one toggle writes both channel values for that Notification. Once someone touches a Notification, a later change in code to that Notification's defaults won't reach them.
