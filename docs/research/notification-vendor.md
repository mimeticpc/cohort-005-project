# In-app notification vendor for Cadence

Research date: 2026-11-10. All pricing was read on 2026-11-10 from the linked pages. Only primary sources were used: vendor docs, pricing pages, and official GitHub repos. Claims that could not be confirmed against a primary source are marked **unverified**. Statements marked **assessment** are conclusions drawn for Cadence, not vendor claims.

## Context and constraints

- Stack: React Router v7 in framework mode (SSR), Node, SQLite/Drizzle.
- Scope: in-app only (bell, unread badge, feed). Email, push, and SMS come later and must not need a re-platform.
- Local dev switches the current user through the DevUI panel, using arbitrary ids such as `"1"` and `"2"`. The vendor must accept those ids with no pre-registration step that blocks switching.
- Data sent to the vendor: user id and display text only. No payment data.
- Real-time is wanted but not required. Recipient preferences are out of scope for v1, but support is noted.

## Comparison table

| Criterion | Knock | Novu | Courier | MagicBell | SuprSend |
|---|---|---|---|---|---|
| Prebuilt React feed | `NotificationIconButton` + `NotificationFeedPopover` + `NotificationFeed` [K1] | `<Inbox />` (Bell, Notifications, Preferences) [N1] | `CourierInbox`, `CourierInboxPopupMenu`, `CourierToast` [C1] | `FloatingInbox`, `Inbox`, `InboxButton` [M1] | `<Inbox />` = bell + popover; `NotificationFeed` [S1] |
| Theming | `--rnf-` CSS vars, replace CSS, `renderItem`, `colorMode="dark"`, i18n [K2] | `appearance` = `baseTheme`/`variables`/`elements` (Tailwind classes OK)/`icons` [N2] | `CourierInboxTheme` objects, custom views [C1] | CSS vars `--magicbell-*`, class names, custom `ItemComponent`/`ButtonComponent` [M1] | unverified (not on pages read) |
| Headless | `useNotifications`, `useNotificationStore`, `@knocklabs/client` [K3] | `@novu/react` hooks (`useNotifications`), `@novu/js` [N3] | `useCourier()` client [C1] | `magicbell-js` user client [M3]; React hooks unverified | Headless JS feed client [S3] |
| Read / seen / archive / mark-all | unseen/seen/read, archive, mark-all-read, `interacted`, action URL [K4] | read/unread/seen/archive/snooze/delete; `readAll`, `seenAll`, `archiveAll`; `redirect.url` [N3][N4] | read, archive; mark-all unverified [C1] | read/unread, archive, delete; mark-all unverified [M2] | read/unread/seen/archived/interacted, `markAllAsRead` [S3] |
| Real-time | Socket, cross-tab sync option [K2] | Real-time on by default (`realtime` prop); transport unverified [N3] | `listenForUpdates()` [C1] | "persistent connection"; transport unverified [M2] | Websocket (`initializeSocketConnection`) [S3] |
| Preferences | Per workflow / category / channel type; hosted or custom center [K5] | Built-in Preferences panel in Inbox [N1] | `CourierPreferences` preference center [C1] | `UserPreferences` component, per channel/category [M1][M2] | "user preferences" feature on Business plan [S4] |
| Add email later | Same workflow, add email step; email needs `email` attr [K6] | All channels on Free [N5] | Multi-channel platform [C2] | Email channel listed [M4] | Unlimited channels on Free [S4] |
| Self-host | No (SaaS only; nothing found) — **assessment** | Yes, MIT core, open core; enterprise folder commercial [N6][N7] | No — **assessment** | No (not on pricing page) [M5] | Enterprise only [S4] |
| Identity sync | Upfront identify or inline recipient object in trigger [K6][K7] | Upfront, inline in trigger `to`, or auto-created on first Inbox session [N8][N9] | JWT minted per user; user sync model unverified [C3] | User JWT with `user_external_id` [M6] | `distinct_id` synced by backend; SDK creates user [S1][S5] |
| Client auth (dev) | Public key + user id; enhanced security off by default [K8] | `applicationIdentifier` + `subscriberId`; HMAC is a per-env toggle [N10] | Backend-minted JWT always [C1][C3] | Backend-signed HS256 JWT always [M6] | Public key + `distinctId`; enhanced security off in Sandbox [S1] |
| Client auth (prod) | RS256 user token, `signUserToken` helper [K8] | HMAC-SHA256(secretKey, subscriberId) as `subscriberHash` [N10] | `POST /auth/issue-token` with scopes [C3] | HS256 JWT with secret key [M6] | ES256 JWT with signing key [S1][S2] |
| Environments | Unlimited on all plans [K9]; dev/prod isolated keys and data [K10] | 2 on Free (Dev + Prod) [N5] | Production + Test by default [C4] | 1 project on Free [M5] | Per-workspace keys; Sandbox/Production [S1][S2] |
| Node SDK | `@knocklabs/node` (Apache-2.0) [K11] | `@novu/api` [N11] | `client.auth.issueToken` shown [C3]; send API unverified | `magicbell-js` `ProjectClient` [M3] | `WorkflowTriggerRequest` [S1]; package name unverified |
| Free tier | 10,000 messages/mo, no hard cap [K9] | 10,000 workflow runs/mo, 5 workflows, 24h activity retention [N5] | 10,000 sends/mo [C2] | 1,000 deliveries/mo [M5] | 10,000 notifications/mo, SuprSend branding [S4] |
| Next paid tier | Starter $250/mo, 50k msgs, then $0.005 [K9] | Pro from $30/mo, 30k runs, $1.20/1k [N5] | Business $0.005/send [C2] | Startup $249/mo, 50k [M5] | Essentials $100/mo, 50k [S4] |
| SSR caveat | No SSR guidance in docs; uses browser socket; `enabled` prop defers connection [K11b] | `'use client'` used in Next.js example [N12] | Client-only; `"use client"` in Next.js [C1] | unverified | unverified |

## Per-vendor notes

### Knock

- **Feed UI:** `@knocklabs/react` ships `KnockProvider` (`apiKey`, `user={{ id }}`), `KnockFeedProvider` (`feedId`, optional `userToken`), `NotificationIconButton`, and `NotificationFeedPopover`. Import `@knocklabs/react/dist/index.css` [K2].
- **Badge:** The badge counts unseen by default. `badgeCountType="unread"` switches it to unread. Opening the popover marks items seen by default. `onOpen` can mark them read instead [K2].
- **Clicks:** The feed redirects to the template's action URL. `onNotificationClick` overrides that, for example to use React Router `navigate` [K2][K4].
- **Statuses:** unseen, seen, read, archived ("x" control), `interacted`, and `link_clicked`. "Mark all as read" is supported [K4].
- **Headless:** Headless hooks do not mark items seen automatically. Call `feedClient.markAllAsSeen()` [K3].
- **Real-time:** A socket connection, with an optional cross-tab BroadcastChannel and automatic disconnect for inactive tabs [K2].
- **Identity:**
  - Only `id` is required. Ids can be up to 256 chars, cannot contain `/` or `#`, and are immutable [K6].
  - String recipients must already be identified. Inline recipient objects are identified during the trigger, so no separate identify call is needed [K7].
  - Users are isolated per environment [K6].
- **Auth:**
  - Enhanced security mode is off by default. In that mode the public key alone can act as any user, which suits DevUI user switching.
  - In prod, turn it on and sign an RS256 JWT (`sub` = user id) with `KNOCK_SIGNING_KEY`. Default expiry is 3600s [K8].
  - Helper: `signUserToken` from `@knocklabs/node` [K11].
- **Environments:**
  - New accounts start with Production only. Enabling environments adds Development, and this cannot be undone.
  - Workflows are edited in dev, committed, and promoted. Keys and data are per environment [K10].
  - Unlimited environments on all plans [K9].
- **Trigger:** `client.workflows.trigger('key', { recipients, data })`. `data` is JSON up to 10MB. An `Idempotency-Key` header dedupes for 24h [K7][K11]. Env var: `KNOCK_API_KEY` [K11].
- **Pricing:** A message is one recipient × one channel. In-app feed messages count. Messages suppressed by preferences are not billed [K9].
- **SSR:**
  - The docs contain no SSR or `"use client"` guidance (unverified either way). The README says "React for web only" [K11b].
  - **Assessment:** Render the feed client-only in RR7, for example after mount. `enabled={false}` defers identify and socket calls until a token is ready [K11b].

### Novu

- **Feed UI:** `@novu/react` `<Inbox applicationIdentifier subscriberId />`. Requires React 18+ and supports React 19 [N1].
- **Styling:** `appearance.variables` (`colorPrimary`, `colorBackground`, `borderRadius`…), `appearance.elements` (inline style, class string such as Tailwind, or callback), `baseTheme: dark`, and `icons` [N2].
- **Navigation:** `routerPush` wires `redirect.url` to the app router. React Router and Remix examples exist [N4].
- **Headless:** `useNotifications` with filters (read/seen/archived/snoozed/tags). Bulk actions: `readAll`, `seenAll`, `archiveAll`, `archiveAllRead`. Per item: read/unread/seen/archive/snooze/delete. Real-time defaults on [N3].
- **Identity:**
  - Subscribers are created upfront, inline in the trigger `to` (created or updated), or by bulk import [N8].
  - A `subscriberId` that does not exist yet is auto-created when Inbox loads [N9].
  - Ids are any unique string per environment [N8].
- **Auth:**
  - Prod: enable HMAC in the In-App integration per environment, then pass `subscriberHash = hex(HMAC-SHA256(NOVU_SECRET_KEY, subscriberId))` [N10].
  - Without HMAC, updating an existing subscriber's profile from the client is blocked [N10].
  - Dev behavior with HMAC off is implied by the per-env toggle. The impersonation risk is **unverified** in docs.
- **Trigger:** `new Novu({ secretKey }).trigger({ workflowId, to, payload })`. `to` accepts up to 100 recipients [N11].
- **Self-host:**
  - The repo is MIT, with an `enterprise/` folder under a commercial license [N7].
  - Self-host needs MongoDB, Redis (AOF), API/Worker/WS services, and object storage. It lacks some cloud features, including some Inbox features [N6].
  - The pricing page lists "Self-hosted" as Enterprise, which conflicts with the MIT community repo. Treat the free community self-host feature set as **unverified** [N5][N6].
- **Pricing:** Free gives 10k workflow runs/mo, 5 workflows, 2 envs, 3 team members, and 24h activity retention. Pro is from $30. Whether "workflow run" means per trigger or per recipient is **unverified** (FAQ empty) [N5].
- **SSR:** The Next.js example marks the Inbox file `'use client'` [N12]. **Assessment:** Treat it as client-only in RR7.

### Courier

- **Feed UI:** `@trycourier/courier-react` (React 18+) provides `CourierInbox`, `CourierInboxPopupMenu`, `CourierToast`, and `CourierPreferences`. `useCourier()` exposes the shared client [C1].
- **Client-only:** Components are client-only, and Next.js needs `"use client"` [C1].
- **Real-time:** Requires `registerFeeds` → `listenForUpdates()` → `load()` [C1].
- **Auth:**
  - The browser always needs a backend-minted JWT, issued with `POST /auth/issue-token` and scope `user_id:<id> inbox:read:messages inbox:write:events`.
  - Omitting `expires_in` makes a token that never expires. The SDK does not auto-refresh [C3].
  - **Assessment:** DevUI works if the server mints a token per selected user, but there is no zero-config dev path.
- **Environments:** Production and Test by default. Keys are per environment, and Test keys never send real notifications [C4].
- **Pricing:** Developer plan is free up to 10k sends/mo. Business is $0.005/send [C2]. Whether inbox messages count is **unverified**.

### MagicBell

- **Feed UI:** `@magicbell/react` `ContextProvider token=…` plus `FloatingInbox`, `Inbox`, `InlineNotification`, `UserPreferences`, and `WebPushButton` [M1].
- **Auth:** Requires a User JWT: HS256 with the project secret, claims `user_external_id` and/or `user_email` plus `api_key`. There is no documented dev-mode shortcut [M6].
- **Server SDK:** `magicbell-js` `ProjectClient.broadcasts.createBroadcast` [M3].
- **Pricing:** Free (Builder) gives 1,000 deliveries/mo and 1 project. Startup is $249/mo for 50k. Each channel delivery counts [M5]. The Free tier is the smallest of the five.

### SuprSend

- **Feed UI:** `@suprsend/react` `SuprSendProvider` (`publicApiKey`, `distinctId`, `userToken`, `refreshUserToken`) and `<Inbox pageSize={20} />` [S1]. The older `@suprsend/react-inbox` package is no longer supported [S6].
- **Auth:**
  - Prod: ES256 JWT with `entity_type: "subscriber"` and `entity_id: distinct_id`, signed with the signing key [S1][S2].
  - Enhanced security is off in Sandbox [S1].
- **Headless:** Websocket feed client with `markAllAsRead`, archive, and multiple stores (tabs) [S3].
- **Pricing:** Free gives 10k notifications/mo, with SuprSend branding on the inbox. Preferences and digest are on Business ($250/mo). Self-host is Enterprise only [S4].

### Alternatives (brief)

- **Novu self-host** is the strongest open-source or self-hostable vendor option (see above).
- **In-house build (assessment, no vendor):**
  - A `notifications` table in SQLite/Drizzle, a loader for the feed and count, an action for mark-read, and polling or SSE through an RR7 resource route.
  - Zero vendor identity or auth issues, and DevUI works trivially.
  - Costs: no preferences, email orchestration, or templates. Adding email later means building the orchestration or migrating.

## Recommendation

**Recommended: Knock.**

- **DevUI fit:**
  - The prebuilt React feed works with public key + arbitrary `user.id` while enhanced security is off (the default) [K8].
  - Inline recipient objects in the trigger auto-identify users, so ids `"1"` and `"2"` need no pre-sync [K7].
- **Dev/prod separation:** Unlimited environments with isolated keys and data. Workflows are promoted dev → prod by commit [K9][K10].
- **Prod auth:** First-party `signUserToken` (RS256) in `@knocklabs/node` [K8][K11].
- **State and UI:** The richest documented state model (unseen/seen/read/archived/interacted) and seen-vs-unread badge control [K2][K4].
- **Email later:** Add an email step to the same workflow and send `email` on the user. No re-platform [K6].
- **Preferences:** Ready for later, at workflow/category/channel-type level [K5].
- **Cost:** Free 10k messages/mo with no hard cap [K9].
- **Data minimization:** Only `id` is required. `name` is optional [K6].
- **Risks:**
  - Paid tier jumps to $250/mo [K9].
  - No self-host.
  - No documented SSR guidance, so the feed must be mounted client-only (assessment).

**Runner-up: Novu.**

- **Why:**
  - Comparable `<Inbox />` with deeper theming (`appearance.elements` accepts Tailwind classes) [N2].
  - Built-in preferences panel [N1].
  - Subscribers are auto-created from either the trigger or the first Inbox load, which also fits DevUI [N8][N9].
  - Cheaper first paid tier ($30) [N5].
  - MIT open-core self-host escape hatch [N7].
- **Why second:**
  - Free tier caps at 5 workflows and 24h activity retention, which constrains a growing notification catalog [N5].
  - Only 2 environments on Free/Pro [N5].
  - Billing unit ("workflow run") and community self-host feature parity are unverified [N5][N6].

Courier and MagicBell need a server-minted JWT even in dev [C3][M6]. MagicBell's free tier is 1k deliveries [M5]. SuprSend's free inbox carries branding, and preferences are paywalled at $250 [S4].

## Implications

### (a) Notification catalog (events × recipients)

- **Workflows:** Knock's unit is the **workflow** (keyed, e.g. `course-purchased`), with channel steps (in-app feed now, email later) and templates using Liquid variables [K4][K7]. Each catalog row maps to one workflow key, its recipients, and its `data` fields.
- **Categories:** Workflows can carry categories for later preference grouping, e.g. `billing` and `course-updates` [K5].
- **Billing math:** One trigger to N recipients on M channels bills N×M messages [K9]. Count fan-out events (e.g. "new lesson in course" to all enrollees) explicitly.
- **Action URLs:** Each template can have an action URL built from variables (e.g. `/courses/{{ course_slug }}`) [K4]. The catalog should list the click-through target per event.
- **Novu equivalent:** workflow + `payload` + `redirect.url` [N4][N11]. Free tier allows only 5 workflows [N5].

### (b) UI prototype

- **Default look:** A bell icon button with a count badge (unseen by default) opens a popover feed of notification cells. Cells show avatar, rendered markdown body, timestamp, and unread dot. The feed has a filter (All/Unread/Read) and "mark all as read" [K2][K4].
- **Customization:**
  - `--rnf-*` CSS variables, `colorMode="dark"`, and `renderItem` for custom cells [K2].
  - `onNotificationClick` → RR7 `navigate()` [K2].
  - `badgeCountType="unread"` [K2].
  - Archive "x" per item [K4].
- **Fully custom (e.g. Tailwind/shadcn):** Use the headless `useNotifications` + `useNotificationStore` hooks and call `markAllAsSeen` yourself [K3].

### (c) Integration architecture

- **Triggers:** Fire server-side in RR7 `action`s or service functions after the DB write succeeds, via `@knocklabs/node` `workflows.trigger`.
  - Pass inline recipients `{ id: String(user.id), name }` and minimal `data` (display text, slugs). Never payment data.
  - Use an `Idempotency-Key` header for retries [K7][K11].
- **User token:**
  - In the root loader (server), when a session user exists and enhanced security is on, sign a token with `signUserToken(String(user.id))` and return it to the client.
  - The token expires in 1h by default, so refresh on navigation or before expiry [K8][K11].
  - Because DevUI switching changes the session user, the loader re-runs and re-signs for the new id (assessment).
- **Client:** `KnockProvider apiKey={PUBLIC_KEY} user={{ id }}` and `KnockFeedProvider feedId={CHANNEL_ID} userToken={token}`, rendered client-only. `enabled` gates the connection until the token is present [K2][K11b].
  - Key the provider on user id so a DevUI switch remounts the provider and reconnects the socket (assessment).
- **Env vars:**
  - `KNOCK_API_KEY` (secret, server) [K11]
  - `KNOCK_SIGNING_KEY` (server, prod/enhanced security) [K8]
  - `KNOCK_PUBLIC_API_KEY` and `KNOCK_FEED_CHANNEL_ID` (client-exposed, passed via loader) [K2]
  - Separate values per Knock environment [K10].
- **Tests:** No Knock-side test mode is documented for unit tests. Wrap the trigger in a small module so `npm run test` can mock it (assessment).

### (d) Vendor account setup

1. Sign up for Knock (Free plan, $0) [K9].
2. Enable environments (Owner/Admin) to get **Development** below **Production**. This is irreversible [K10].
3. In Development, create an in-app feed channel and copy its channel id [K2][K4].
4. Under Platform > API keys, copy the public key, secret key, and (for prod) signing key, separately per environment [K8][K10].
5. Create the first workflow(s) with an in-app step and action URL. Commit in dev, then promote to prod [K10].
6. Leave enhanced security **off** in Development (DevUI ids work with the public key alone) and turn it **on** in Production before launch [K8].
7. Add the env vars above to `.env` (dev keys) and the deploy environment (prod keys).
8. Later: add email by configuring an email provider channel per environment and adding an email step to the workflows. Users then need an `email` attribute [K6].

## Sources

- [K1] https://docs.knock.app/in-app-ui/react/overview
- [K2] https://docs.knock.app/in-app-ui/react/feed
- [K3] https://docs.knock.app/in-app-ui/react/custom-notifications-ui
- [K4] https://docs.knock.app/integrations/in-app/knock
- [K5] https://docs.knock.app/preferences/overview
- [K6] https://docs.knock.app/concepts/users
- [K7] https://docs.knock.app/send-notifications/triggering-workflows/api
- [K8] https://docs.knock.app/in-app-ui/security-and-authentication
- [K9] https://knock.app/pricing (read 2026-11-10)
- [K10] https://docs.knock.app/concepts/environments
- [K11] https://github.com/knocklabs/knock-node
- [K11b] https://github.com/knocklabs/javascript/tree/main/packages/react
- [N1] https://docs.novu.co/platform/inbox/overview
- [N2] https://docs.novu.co/platform/inbox/configuration/styling
- [N3] https://docs.novu.co/platform/sdks/react/hooks/use-notifications
- [N4] https://docs.novu.co/platform/inbox/advanced-customization/notification-click-behavior
- [N5] https://novu.co/pricing (read 2026-11-10)
- [N6] https://docs.novu.co/community/self-hosting-novu/overview
- [N7] https://github.com/novuhq/novu
- [N8] https://docs.novu.co/platform/concepts/subscribers
- [N9] https://docs.novu.co/platform/quickstart/nextjs
- [N10] https://docs.novu.co/platform/inbox/prepare-for-production
- [N11] https://docs.novu.co/api-reference/events/trigger-event
- [N12] https://docs.novu.co/platform/quickstart/nextjs
- [C1] https://www.courier.com/docs/sdk-libraries/courier-react-web
- [C2] https://www.courier.com/pricing (read 2026-11-10)
- [C3] https://www.courier.com/docs/platform/inbox/authentication
- [C4] https://www.courier.com/docs/workspaces/overview#environments-and-api-keys
- [M1] https://www.magicbell.com/docs/libraries/magicbell-react
- [M2] https://www.magicbell.com/docs/channels/in_app
- [M3] https://www.magicbell.com/docs/libraries/magicbell-js
- [M4] https://www.magicbell.com/docs
- [M5] https://www.magicbell.com/pricing (read 2026-11-10)
- [M6] https://www.magicbell.com/docs/api/authentication/user
- [S1] https://docs.suprsend.com/docs/inbox-quick-start
- [S2] https://docs.suprsend.com/docs/developer/api-keys
- [S3] https://docs.suprsend.com/docs/js-inapp-feed
- [S4] https://www.suprsend.com/pricing (read 2026-11-10)
- [S5] https://docs.suprsend.com/docs/users
- [S6] https://docs.suprsend.com/docs/inbox-react
