import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  coupons,
  purchases,
  teamMembers,
  TeamMemberRole,
  users,
} from "~/db/schema";
import {
  defaultKnockGateway,
  type ChannelTypePreferences,
  type KnockGateway,
  type WorkflowPreferences,
} from "~/lib/knock-gateway.server";
import {
  visibleNotifications,
  type ChannelType,
  type NotificationEntry,
  type NotificationKey,
  type Viewer,
} from "~/lib/notification-catalogue";
import { toKnockUser } from "~/lib/notifications.server";

// ─── Notification Preferences ───
// The /settings "Notifications" card. Rows come from the catalogue, filtered
// to the person's role; each toggle shows the person's stored Knock entry,
// or the catalogue default when there is none (ADR 0013, #48).

type Db = BetterSQLite3Database<typeof schema>;

export type PreferenceRow = {
  key: NotificationKey;
  name: string;
  // One value per channel the Notification sends on.
  channels: ChannelTypePreferences;
};

function storedOrDefault(
  entry: NotificationEntry<NotificationKey>,
  stored: WorkflowPreferences[string] | undefined
): ChannelTypePreferences {
  const channels: ChannelTypePreferences = {};
  for (const [type, fallback] of Object.entries(entry.defaults) as [
    ChannelType,
    boolean,
  ][]) {
    channels[type] =
      stored === undefined
        ? fallback
        : typeof stored === "boolean"
          ? stored
          : // Knock treats a channel left unset in an entry as on.
            (stored.channel_types?.[type] ?? true);
  }
  return channels;
}

export async function loadPreferences(
  db: Db,
  userId: number,
  gateway: KnockGateway | null = defaultKnockGateway()
): Promise<PreferenceRow[] | null> {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || !gateway) return null;

  let stored: WorkflowPreferences;
  try {
    stored = await gateway.getPreferences(String(user.id));
  } catch (error) {
    console.error("[notifications] could not load preferences:", error);
    return null;
  }
  return visibleNotifications(notificationViewer(db, user)).map((entry) => ({
    key: entry.key,
    name: entry.name,
    channels: storedOrDefault(entry, stored[entry.key]),
  }));
}

// A Team Admin is a team_members row, not a users.role; it counts only on a
// team that has a Team Licence (a Purchase with Seats). A buyer is anyone
// with a Purchase, whatever their role.
export function notificationViewer(
  db: Db,
  user: Pick<typeof users.$inferSelect, "id" | "role">
): Viewer {
  const teamLicenceAdminRow = db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .innerJoin(coupons, eq(coupons.teamId, teamMembers.teamId))
    .where(
      and(
        eq(teamMembers.userId, user.id),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();
  const purchase = db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.userId, user.id))
    .get();
  return {
    role: user.role,
    isTeamAdmin: teamLicenceAdminRow !== undefined,
    isBuyer: purchase !== undefined,
  };
}

export type PreferenceValues = { feed: boolean; email: boolean };

export type SavePreferenceResult =
  | { ok: true; channels: { in_app_feed: boolean; email: boolean } }
  | { ok: false };

// Identify first (a never-seen user can't hold preferences), then merge-write
// both channel values for the one workflow: a channel left unset in a Knock
// entry counts as on. Email is forced off when the feed is off.
export async function savePreference(
  db: Db,
  userId: number,
  key: NotificationKey,
  values: PreferenceValues,
  gateway: KnockGateway | null = defaultKnockGateway()
): Promise<SavePreferenceResult> {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || !gateway) return { ok: false };

  const visible = visibleNotifications(notificationViewer(db, user)).some(
    (entry) => entry.key === key
  );
  if (!visible) return { ok: false };

  const channels = {
    in_app_feed: values.feed,
    email: values.feed && values.email,
  };
  try {
    await gateway.identify(toKnockUser(user));
    await gateway.mergePreferences(String(user.id), {
      [key]: { channel_types: channels },
    });
  } catch (error) {
    console.error(
      `[notifications] could not save preference workflow=${key}:`,
      error
    );
    return { ok: false };
  }
  return { ok: true, channels };
}
