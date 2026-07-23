import path from "node:path";

import { Command, Option } from "commander";

import { startDashboardServer } from "../../loop-package/infrastructure/static-dashboard-server.js";
import { RunMigration } from "../application/run-migration.js";

export async function runCli(argv: readonly string[]): Promise<void> {
  const program = new Command()
    .name("notion2loop")
    .description(
      "Analyze a Notion export and generate a Loop migration dashboard.",
    )
    .version("0.1.0");

  program
    .command("migrate")
    .description("Generate a migration package from a Notion export.")
    .requiredOption("-i, --input <path>", "Notion export directory or ZIP file")
    .option(
      "-o, --output <directory>",
      "Output directory",
      "output/migration",
    )
    .action(async (options: { input: string; output: string }) => {
      await generateMigration(options.input, options.output);
    });

  program
    .command("demo")
    .description("Generate the bundled representative migration demo.")
    .option("-o, --output <directory>", "Output directory", "output/demo")
    .action(async (options: { output: string }) => {
      await generateMigration(
        path.resolve("fixtures/notion-export"),
        options.output,
      );
    });

  program
    .command("serve")
    .description("Serve a generated migration dashboard locally.")
    .option(
      "-d, --directory <directory>",
      "Generated dashboard directory",
      "output/demo",
    )
    .addOption(
      new Option("-p, --port <number>", "Local port")
        .default("4173")
        .argParser(parsePort),
    )
    .action(async (options: { directory: string; port: number }) => {
      const server = await startDashboardServer(
        path.resolve(options.directory),
        options.port,
      );
      process.stdout.write(
        `Notion2Loop dashboard: http://127.0.0.1:${options.port}\n`,
      );

      const close = (): void => {
        server.close(() => process.exit(0));
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    });

  await program.parseAsync([...argv], { from: "user" });
}

async function generateMigration(
  inputPath: string,
  outputDirectory: string,
): Promise<void> {
  const result = await new RunMigration().execute({
    inputPath: path.resolve(inputPath),
    outputDirectory: path.resolve(outputDirectory),
  });

  process.stdout.write(
    [
      `Workspace: ${result.graph.title}`,
      `Fidelity: ${result.plan.summary.fidelityScore}%`,
      `Issues: ${result.plan.summary.issueCount}`,
      `Agent tasks: ${result.plan.summary.agentTaskCount}`,
      `Dashboard: ${path.join(result.manifest.outputDirectory, result.manifest.dashboardPath)}`,
      "",
    ].join("\n"),
  );
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}
