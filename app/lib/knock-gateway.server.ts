import { existsSync } from "node:fs";
import Knock, { NotFoundError, signUserToken } from "@knocklabs/node";
import type { PreferenceSet } from "@knocklabs/node/resources/recipients/preferences";
import type { ChannelType } from "~/lib/notification-catalogue";

// ─── KnockGateway ───
// The only module that imports the Knock server SDK. Everything Cadence asks
// of Knock goes through this interface, so tests hand in recordingGateway()
// and never reach the network (see app/test/network-guard.ts).
//
// Callers take the gateway as a last parameter defaulting to
// defaultKnockGateway(), which is null when the KNOCK_* env vars are missing:
// Notifications then quietly do nothing.

export type KnockUser = {
  id: string;
  name: string;
  email: string;
  avatar?: string;
};

export type TriggerPayload = {
  recipients: KnockUser[];
  // Left out for email the recipient caused themselves (an email-only
  // workflow such as the "Refund requested" receipt).
  actor?: KnockUser;
  data: Record<string, string>;
};

export type ChannelTypePreferences = Partial<Record<ChannelType, boolean>>;

// A person's stored per-workflow entries. `true`/`false` switches the whole
// workflow; an object holds per-channel-type values. Missing = no entry.
export type WorkflowPreferences = Record<
  string,
  boolean | { channel_types?: ChannelTypePreferences | null }
>;

export interface KnockGateway {
  // Public values the browser needs for the headless feed.
  readonly feed: { publicApiKey: string; channelId: string };
  trigger(
    workflowKey: string,
    payload: TriggerPayload,
    idempotencyKey: string
  ): Promise<void>;
  identify(user: KnockUser): Promise<void>;
  getPreferences(userId: string): Promise<WorkflowPreferences>;
  mergePreferences(
    userId: string,
    workflows: Record<string, { channel_types: ChannelTypePreferences }>
  ): Promise<void>;
  signUserToken(userId: string): Promise<string>;
}

export type KnockEnv = {
  secretApiKey: string;
  publicApiKey: string;
  signingKey: string;
  feedChannelId: string;
};

// Cadence only stores plain booleans per channel type; anything else Knock
// allows (conditions) is ignored.
function toWorkflowPreferences(
  workflows: NonNullable<PreferenceSet["workflows"]>
): WorkflowPreferences {
  return Object.fromEntries(
    Object.entries(workflows).map(([key, value]) => {
      if (typeof value === "boolean") return [key, value];
      const channelTypes: ChannelTypePreferences = {};
      for (const type of ["in_app_feed", "email"] as const) {
        const setting = value.channel_types?.[type];
        if (typeof setting === "boolean") channelTypes[type] = setting;
      }
      return [key, { channel_types: channelTypes }];
    })
  );
}

const TIMEOUT_MS = 5_000;
const USER_TOKEN_TTL_SECONDS = 60 * 60;

export function knockGateway(
  env: KnockEnv,
  options: { maxRetries?: number } = {}
): KnockGateway {
  // Explicit apiKey: the SDK would otherwise fall back to process.env.
  const client = new Knock({
    apiKey: env.secretApiKey,
    timeout: TIMEOUT_MS,
    ...(options.maxRetries === undefined
      ? {}
      : { maxRetries: options.maxRetries }),
  });

  return {
    feed: { publicApiKey: env.publicApiKey, channelId: env.feedChannelId },

    async trigger(workflowKey, payload, idempotencyKey) {
      await client.workflows.trigger(workflowKey, payload, {
        idempotencyKey,
      });
    },

    async identify({ id, ...props }) {
      await client.users.update(id, props);
    },

    async getPreferences(userId) {
      try {
        const set = await client.users.getPreferences(userId, "default");
        return toWorkflowPreferences(set.workflows ?? {});
      } catch (error) {
        // A user Knock has never seen has no stored entries.
        if (error instanceof NotFoundError) return {};
        throw error;
      }
    },

    async mergePreferences(userId, workflows) {
      await client.users.setPreferences(userId, "default", {
        __persistence_strategy__: "merge",
        workflows,
      });
    },

    signUserToken(userId) {
      return signUserToken(userId, {
        signingKey: env.signingKey,
        expiresInSeconds: USER_TOKEN_TTL_SECONDS,
      });
    },
  };
}

let envFileLoaded = false;

// Vite doesn't put non-VITE_ vars on process.env, so read .env ourselves.
// Never under vitest: the network guard has removed KNOCK_* on purpose.
function loadEnvFile() {
  if (envFileLoaded || process.env.VITEST) return;
  envFileLoaded = true;
  if (existsSync(".env")) process.loadEnvFile(".env");
}

export function readKnockEnv(): KnockEnv | null {
  loadEnvFile();
  const {
    KNOCK_SECRET_API_KEY: secretApiKey,
    KNOCK_PUBLIC_API_KEY: publicApiKey,
    KNOCK_SIGNING_KEY: signingKey,
    KNOCK_FEED_CHANNEL_ID: feedChannelId,
  } = process.env;
  if (!secretApiKey || !publicApiKey || !signingKey || !feedChannelId) {
    return null;
  }
  return { secretApiKey, publicApiKey, signingKey, feedChannelId };
}

let cached: { env: KnockEnv; gateway: KnockGateway } | null = null;

export function defaultKnockGateway(): KnockGateway | null {
  const env = readKnockEnv();
  if (!env) return null;
  if (cached?.env.secretApiKey !== env.secretApiKey) {
    cached = { env, gateway: knockGateway(env) };
  }
  return cached.gateway;
}

// ─── recordingGateway ───
// In-memory KnockGateway for tests: records every call in order and returns
// canned preferences. `failWith` makes every call reject with that error.

export type RecordedCall =
  | {
      method: "trigger";
      workflowKey: string;
      payload: TriggerPayload;
      idempotencyKey: string;
    }
  | { method: "identify"; user: KnockUser }
  | { method: "getPreferences"; userId: string }
  | {
      method: "mergePreferences";
      userId: string;
      workflows: Record<string, { channel_types: ChannelTypePreferences }>;
    }
  | { method: "signUserToken"; userId: string };

export function recordingGateway(
  options: {
    preferences?: Record<string, WorkflowPreferences>;
    failWith?: Error;
  } = {}
) {
  const calls: RecordedCall[] = [];
  const record = async (call: RecordedCall) => {
    calls.push(call);
    if (options.failWith) throw options.failWith;
  };

  return {
    calls,
    feed: { publicApiKey: "pk_test_recording", channelId: "recording-feed" },
    async trigger(workflowKey, payload, idempotencyKey) {
      await record({ method: "trigger", workflowKey, payload, idempotencyKey });
    },
    async identify(user) {
      await record({ method: "identify", user });
    },
    async getPreferences(userId) {
      await record({ method: "getPreferences", userId });
      return options.preferences?.[userId] ?? {};
    },
    async mergePreferences(userId, workflows) {
      await record({ method: "mergePreferences", userId, workflows });
    },
    async signUserToken(userId) {
      await record({ method: "signUserToken", userId });
      return `signed-token-for-${userId}`;
    },
  } satisfies KnockGateway & { calls: RecordedCall[] };
}
