import { vi } from "vitest";

// Vitest setupFiles entry: tests must never reach Knock (or anything else).
// Removing KNOCK_* leaves the default KnockGateway unconfigured, and the
// fetch stub makes any test that builds a real gateway fail loudly. Tests
// pass recordingGateway() instead. A test that needs fetch stubs its own.

for (const name of Object.keys(process.env)) {
  if (name.startsWith("KNOCK_")) delete process.env[name];
}

vi.stubGlobal("fetch", async (input: unknown) => {
  throw new Error(
    `Network guard: tests may not make network requests (${String(input)}). Pass recordingGateway() instead of the real KnockGateway.`
  );
});
