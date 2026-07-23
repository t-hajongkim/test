import { describe, expect, it } from "vitest";

import { prototypeStatus } from "../src/index.js";

describe("prototype environment", () => {
  it("loads the TypeScript entry point", () => {
    expect(prototypeStatus).toBe("environment-ready");
  });
});
