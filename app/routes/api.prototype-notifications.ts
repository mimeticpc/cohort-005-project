// PROTOTYPE, throwaway (#47). Sends demo Notifications to the DevUI user.
import type { Route } from "./+types/api.prototype-notifications";
import { requireUserId } from "~/lib/access.server";
import { seedDemoNotifications } from "~/lib/notification-feed-prototype.server";

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  return { sent: await seedDemoNotifications(userId) };
}
