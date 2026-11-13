import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  defaultKnockGateway,
  knockGateway,
  readKnockEnv,
} from "./knock-gateway.server";

const FAKE_ENV = {
  secretApiKey: "sk_test_fake",
  publicApiKey: "pk_test_fake",
  signingKey: "not-a-key",
  feedChannelId: "00000000-0000-0000-0000-000000000000",
};

describe("Knock SDK boundary", () => {
  function sourceFiles(dir: URL): string[] {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .map((file) => fileURLToPath(new URL(file, dir)));
  }

  const appDir = new URL("../", import.meta.url);
  const importsServerSdk = (file: string) =>
    /from\s+["']@knocklabs\/node/.test(readFileSync(file, "utf8"));

  it("imports @knocklabs/node only in the gateway", () => {
    const importers = sourceFiles(appDir)
      .filter(importsServerSdk)
      .map((file) => file.slice(fileURLToPath(appDir).length));

    expect(importers).toEqual(["lib/knock-gateway.server.ts"]);
  });

  it("keeps every Knock SDK out of routes", () => {
    const routeImporters = sourceFiles(new URL("routes/", appDir)).filter(
      (file) => /["']@knocklabs\//.test(readFileSync(file, "utf8"))
    );

    expect(routeImporters).toEqual([]);
  });
});

describe("network guard", () => {
  it("removes KNOCK_* so the default gateway is not configured", () => {
    expect(
      Object.keys(process.env).filter((name) => name.startsWith("KNOCK_"))
    ).toEqual([]);
    expect(readKnockEnv()).toBeNull();
    expect(defaultKnockGateway()).toBeNull();
  });

  it("makes a real gateway fail loudly instead of reaching Knock", async () => {
    const error = await knockGateway(FAKE_ENV, { maxRetries: 0 })
      .trigger(
        "discussion-reply",
        {
          recipients: [{ id: "1", name: "A", email: "a@example.com" }],
          actor: { id: "2", name: "B", email: "b@example.com" },
          data: {},
        },
        "discussion-reply:1"
      )
      .then(
        () => null,
        (e: unknown) => e
      );

    // The SDK wraps the guard's error as a connection error.
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).cause)).toMatch(/network guard/i);
  });
});
