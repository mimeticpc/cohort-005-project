import { describe, it, expect, vi, afterEach } from "vitest";
import { setCurrentUserId } from "~/lib/session";
import { loader } from "./api.notification-token";

// The Notification Feed's token refresh. Failures are thrown responses
// (CODING_STANDARDS.md); the feed only reads the body of a 2xx.

function call(request: Request) {
  return loader({ request, params: {}, context: {} } as Parameters<
    typeof loader
  >[0]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/notification-token", () => {
  it("throws a 401 when no one is signed in", async () => {
    await expect(
      call(new Request("http://localhost/api/notification-token"))
    ).rejects.toMatchObject({ init: { status: 401 } });
  });

  it("throws a 503 when Knock isn't configured", async () => {
    const plain = new Request("http://localhost/api/notification-token");
    const cookie = await setCurrentUserId(plain, 1);
    const request = new Request("http://localhost/api/notification-token", {
      headers: { Cookie: cookie },
    });

    await expect(call(request)).rejects.toMatchObject({
      init: { status: 503 },
    });
  });
});
