import { rm } from "node:fs/promises";

await Promise.all(
  ["dist", "coverage", "output", "tmp"].map((path) =>
    rm(path, { force: true, recursive: true }),
  ),
);
