import { describe, expect, it } from "vitest";
import { recordingGateway } from "~/lib/knock-gateway.server";
import {
  emailOnlyWorkflows,
  notificationCatalogue,
} from "~/lib/notification-catalogue";
import { readWorkflow } from "~/test/knock-config";
import { sendSmokeMessages, type SmokeRecipient } from "./knock-smoke-messages";

// `npm run knock:smoke` is manual and talks to real Knock. These tests check
// the part that can be checked offline: it sends every catalogue Notification
// and every email-only workflow once, to the dev's user, with data Knock's
// trigger data schema accepts (Knock answers 422 otherwise).

const dev: SmokeRecipient = {
  id: "42",
  name: "Dev Person",
  email: "dev@example.com",
};
const runId = "smoke:1731400000000";

const allKeys = [
  ...Object.keys(notificationCatalogue),
  ...Object.keys(emailOnlyWorkflows),
].sort();

type DataSchema = {
  type: string;
  required?: string[];
  properties: Record<string, { type: string }>;
};

function triggers() {
  const gateway = recordingGateway();
  return sendSmokeMessages(gateway, dev, runId).then(() =>
    gateway.calls.flatMap((call) => (call.method === "trigger" ? [call] : []))
  );
}

describe("sendSmokeMessages", () => {
  it("triggers every Notification and email-only workflow exactly once", async () => {
    const keys = (await triggers()).map((call) => call.workflowKey).sort();
    expect(keys).toEqual(allKeys);
    expect(keys).toHaveLength(8);
  });

  it("sends each to the dev's user only", async () => {
    for (const call of await triggers()) {
      expect(call.payload.recipients).toEqual([dev]);
      expect(call.payload.actor?.id).not.toBe(dev.id);
    }
  });

  it("gives Notifications an actor and leaves it off email-only workflows", async () => {
    for (const call of await triggers()) {
      if (call.workflowKey in emailOnlyWorkflows) {
        expect(call.payload.actor).toBeUndefined();
      } else {
        expect(call.payload.actor?.name).toBeTruthy();
      }
    }
  });

  it("uses a fresh smoke:<timestamp> idempotency key per workflow", async () => {
    const calls = await triggers();
    expect(calls.map((call) => call.idempotencyKey)).toEqual(
      calls.map((call) => `${runId}:${call.workflowKey}`)
    );
  });

  it("sends data that satisfies each workflow's trigger data schema", async () => {
    for (const call of await triggers()) {
      const { trigger_data_json_schema: schema } = readWorkflow(
        call.workflowKey
      ) as unknown as { trigger_data_json_schema: DataSchema };
      const { data } = call.payload;
      for (const field of schema.required ?? []) {
        expect(data, `${call.workflowKey}.${field}`).toHaveProperty(field);
      }
      for (const [field, value] of Object.entries(data)) {
        expect(
          schema.properties[field]?.type,
          `${call.workflowKey}.${field} is not in the schema`
        ).toBe("string");
        expect(typeof value).toBe("string");
      }
    }
  });

  it("turns every channel on for the dev first, so default-off Notifications arrive too", async () => {
    const gateway = recordingGateway();
    await sendSmokeMessages(gateway, dev, runId);

    const [first] = gateway.calls;
    if (first?.method !== "mergePreferences") {
      throw new Error(`expected mergePreferences first, got ${first?.method}`);
    }
    expect(first.userId).toBe(dev.id);
    expect(Object.keys(first.workflows).sort()).toEqual(
      Object.keys(notificationCatalogue).sort()
    );
    // New Enrollment defaults to off on both channels.
    expect(first.workflows["new-enrollment"]).toEqual({
      channel_types: { in_app_feed: true, email: true },
    });
    expect(first.workflows["refund-requested"]).toBeUndefined();
  });
});
