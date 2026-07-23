import { z } from "zod";

export const MAX_ZIP_METADATA_BYTES = 200 * 1024 * 1024;

const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTION_ID_PATTERN =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const NOTION_TOKEN_PATTERN = /^\S{8,4096}$/u;

export const SourceKindSchema = z.enum(["zip", "notion_api"]);
export const NotionRootKindSchema = z.enum(["page", "database"]);
export const MicrosoftTargetSchema = z.enum([
  "lists",
  "sharepoint",
  "planner",
]);

const MicrosoftIdentifierSchema = z
  .string()
  .regex(GUID_PATTERN, "Enter a valid Microsoft identifier.")
  .transform((value) => value.toLowerCase());

const ZipFileMetadataSchema = z
  .object({
    name: z
      .string()
      .min(1, "Choose a ZIP file.")
      .max(255, "The ZIP file name is too long.")
      .refine(
        (value) => !/[\\/]/u.test(value),
        "The ZIP file name must not contain a path.",
      )
      .refine(
        (value) => value.toLowerCase().endsWith(".zip"),
        "Choose a .zip file.",
      ),
    sizeBytes: z
      .number()
      .int("The ZIP size must be a whole number.")
      .positive("The ZIP file must not be empty.")
      .max(
        MAX_ZIP_METADATA_BYTES,
        `The ZIP file must not exceed ${MAX_ZIP_METADATA_BYTES} bytes.`,
      ),
  })
  .strict();

const NotionRootSchema = z
  .object({
    kind: NotionRootKindSchema,
    id: z
      .string()
      .regex(NOTION_ID_PATTERN, "Enter a valid Notion page or database ID.")
      .transform((value) => value.replaceAll("-", "").toLowerCase()),
  })
  .strict();

const ZipSourceSchema = z
  .object({
    kind: z.literal("zip"),
    file: ZipFileMetadataSchema,
  })
  .strict();

const NotionApiSourceSchema = z
  .object({
    kind: z.literal("notion_api"),
    notionToken: z
      .string()
      .regex(
        NOTION_TOKEN_PATTERN,
        "Enter a token between 8 and 4096 characters with no spaces.",
      ),
    root: NotionRootSchema,
  })
  .strict();

const MicrosoftConnectionSchema = z
  .object({
    tenantId: MicrosoftIdentifierSchema,
    clientId: MicrosoftIdentifierSchema,
  })
  .strict();

const MicrosoftTargetsSchema = z
  .array(MicrosoftTargetSchema)
  .min(1, "Choose at least one Microsoft destination.")
  .superRefine((targets, context) => {
    if (new Set(targets).size !== targets.length) {
      context.addIssue({
        code: "custom",
        message: "Choose each Microsoft destination only once.",
      });
    }
  });

export const ConnectionSetupRequestSchema = z
  .object({
    source: z.discriminatedUnion("kind", [
      ZipSourceSchema,
      NotionApiSourceSchema,
    ]),
    microsoft: MicrosoftConnectionSchema,
    targets: MicrosoftTargetsSchema,
  })
  .strict();

export type MicrosoftTarget = z.infer<typeof MicrosoftTargetSchema>;
export type ConnectionSetupRequest = z.infer<
  typeof ConnectionSetupRequestSchema
>;
export type ConnectionSourceConfiguration =
  | z.infer<typeof ZipSourceSchema>
  | {
      readonly kind: "notion_api";
      readonly root: z.infer<typeof NotionRootSchema>;
    };

export interface ConnectionConfiguration {
  readonly source: ConnectionSourceConfiguration;
  readonly microsoft: z.infer<typeof MicrosoftConnectionSchema>;
  readonly targets: readonly MicrosoftTarget[];
}

export class NotionToken {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  public static create(value: string): NotionToken {
    return new NotionToken(
      z
        .string()
        .regex(
          NOTION_TOKEN_PATTERN,
          "Enter a token between 8 and 4096 characters with no spaces.",
        )
        .parse(value),
    );
  }

  public reveal(): string {
    return this.#value;
  }

  public toString(): string {
    return "[REDACTED]";
  }

  public toJSON(): string {
    return "[REDACTED]";
  }
}
