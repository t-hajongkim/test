import { describe, expect, it } from "vitest";

import {
  ConnectionSetupRequestSchema,
  MAX_ZIP_METADATA_BYTES,
  NotionToken,
} from "../src/features/connection-setup/domain/connection-setup.js";
import { ClearNotionToken } from "../src/features/connection-setup/application/clear-notion-token.js";
import { EndConnectionSession } from "../src/features/connection-setup/application/end-connection-session.js";
import { GetConnectionSessionSummary } from "../src/features/connection-setup/application/get-connection-session-summary.js";
import { SaveConnectionSetup } from "../src/features/connection-setup/application/save-connection-setup.js";
import { StartConnectionSession } from "../src/features/connection-setup/application/start-connection-session.js";
import { InMemoryConnectionSessionStore } from "../src/features/connection-setup/infrastructure/in-memory-connection-session-store.js";

const tenantId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const clientId = "4c56f8e1-21d7-4b45-82a3-dcb5c91c8954";

describe("connection setup", () => {
  it("validates ZIP metadata without accepting paths, non-ZIP files, or bytes above the ingestion limit", () => {
    expect(
      ConnectionSetupRequestSchema.parse({
        source: {
          kind: "zip",
          file: { name: "workspace.ZIP", sizeBytes: MAX_ZIP_METADATA_BYTES },
        },
        microsoft: { tenantId, clientId },
        targets: ["lists", "sharepoint"],
      }),
    ).toEqual({
      source: {
        kind: "zip",
        file: { name: "workspace.ZIP", sizeBytes: MAX_ZIP_METADATA_BYTES },
      },
      microsoft: { tenantId, clientId },
      targets: ["lists", "sharepoint"],
    });

    for (const file of [
      { name: "../workspace.zip", sizeBytes: 10 },
      { name: "workspace.csv", sizeBytes: 10 },
      { name: "workspace.zip", sizeBytes: MAX_ZIP_METADATA_BYTES + 1 },
    ]) {
      expect(
        ConnectionSetupRequestSchema.safeParse({
          source: { kind: "zip", file },
          microsoft: { tenantId, clientId },
          targets: ["lists"],
        }).success,
      ).toBe(false);
    }
  });

  it("normalizes Notion root IDs and requires valid Microsoft IDs and unique targets", () => {
    const parsed = ConnectionSetupRequestSchema.parse({
      source: {
        kind: "notion_api",
        notionToken: "ntn_example_token",
        root: {
          kind: "database",
          id: "12345678-90AB-CDEF-1234-567890ABCDEF",
        },
      },
      microsoft: { tenantId: tenantId.toUpperCase(), clientId },
      targets: ["planner", "lists"],
    });

    expect(parsed.source).toMatchObject({
      kind: "notion_api",
      root: {
        kind: "database",
        id: "1234567890abcdef1234567890abcdef",
      },
    });
    expect(parsed.microsoft.tenantId).toBe(tenantId);

    expect(
      ConnectionSetupRequestSchema.safeParse({
        source: {
          kind: "notion_api",
          notionToken: "ntn_example_token",
          root: { kind: "page", id: "not-a-notion-id" },
        },
        microsoft: { tenantId: "not-a-guid", clientId },
        targets: ["lists", "lists"],
      }).success,
    ).toBe(false);
  });

  it("redacts a Notion token from string and JSON representations", () => {
    const marker = "ntn_secret_marker_123";
    const token = NotionToken.create(marker);

    expect(token.reveal()).toBe(marker);
    expect(String(token)).toBe("[REDACTED]");
    expect(JSON.stringify({ token })).toBe('{"token":"[REDACTED]"}');
    expect(JSON.stringify(token)).not.toContain(marker);
  });

  it("isolates, summarizes, clears, and ends in-memory sessions without exposing the token", async () => {
    const store = new InMemoryConnectionSessionStore();
    const start = new StartConnectionSession(store);
    const save = new SaveConnectionSetup(store);
    const getSummary = new GetConnectionSessionSummary(store);
    const clearToken = new ClearNotionToken(store);
    const end = new EndConnectionSession(store, {
      stopAccepting() {},
      async cancel() {},
      async cancelAll() {},
    });
    const first = await start.execute();
    const second = await start.execute();
    const marker = "ntn_session_secret_marker";

    const saved = await save.execute({
      sessionId: first.sessionId,
      configuration: {
        source: {
          kind: "notion_api",
          notionToken: marker,
          root: {
            kind: "page",
            id: "1234567890abcdef1234567890abcdef",
          },
        },
        microsoft: { tenantId, clientId },
        targets: ["lists", "sharepoint", "planner"],
      },
    });

    expect(saved).toMatchObject({
      status: "configuration_ready",
      configured: true,
      notionTokenPresent: true,
      source: {
        kind: "notion_api",
        root: {
          kind: "page",
          id: "1234567890abcdef1234567890abcdef",
        },
      },
      workflow: {
        analysis: "not_started",
        reviewApproval: "not_started",
        deployment: "disabled",
      },
    });
    expect(JSON.stringify(saved)).not.toContain(marker);
    await expect(
      getSummary.execute({ sessionId: second.sessionId }),
    ).resolves.toMatchObject({
      configured: false,
      notionTokenPresent: false,
    });

    const record = await store.findById(first.sessionId);
    expect(record?.notionToken?.reveal()).toBe(marker);

    await expect(
      clearToken.execute({ sessionId: first.sessionId }),
    ).resolves.toMatchObject({
      status: "collecting_configuration",
      configured: false,
      notionTokenPresent: false,
    });
    expect((await store.findById(first.sessionId))?.notionToken).toBeUndefined();

    await end.execute({ sessionId: first.sessionId });
    await expect(
      getSummary.execute({ sessionId: first.sessionId }),
    ).rejects.toThrow("Connection session was not found");
  });
});
