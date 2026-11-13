import { data } from "react-router";
import type { Route } from "./+types/api.notification-token";
import { getFeedConfig } from "~/lib/notifications.server";
import { getCurrentUserId } from "~/lib/session";

// A fresh signed Knock user token for the session user. The Notification
// Feed calls this shortly before its token expires, so an idle tab keeps
// polling. Returns the user id too: the feed ignores a token for anyone else
// (the DevUI switch happened in another tab). Failures are thrown, so the
// feed sees a non-2xx and keeps its current token.
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw data("Not signed in", { status: 401 });
  }
  const config = await getFeedConfig(userId);
  if (!config) {
    throw data("Notifications are unavailable", { status: 503 });
  }
  return Response.json(
    { knockUserId: config.knockUserId, userToken: config.userToken },
    { headers: { "Cache-Control": "no-store" } }
  );
}
