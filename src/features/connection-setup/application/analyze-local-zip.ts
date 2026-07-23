import { AnalyzeWorkspace } from "../../compatibility-analysis/application/analyze-workspace.js";
import { IngestWorkspace } from "../../workspace-ingestion/application/ingest-workspace.js";
import { CanonicalWorkspaceGraphSchema } from "../../workspace-ingestion/domain/canonical-graph.js";
import { WorkspaceSourceError } from "../../workspace-ingestion/application/workspace-source-error.js";
import {
  ConnectionAnalysisInProgressError,
  ConnectionZipConfigurationRequiredError,
  type ConnectionSessionRecord,
  type ConnectionSessionStore,
} from "./connection-session-store.js";
import {
  summarizeConnectionSession,
  type ConnectionSessionSummary,
} from "./connection-session-summary.js";
import type {
  LocalZipArchiveStager,
  StagedZipArchive,
} from "./local-zip-archive-stager.js";
import {
  LocalZipStagingCancelledError,
  LocalZipStagingCleanupError,
} from "./local-zip-archive-stager.js";
import type { LocalZipAnalysisLifecycle } from "./local-zip-analysis-lifecycle.js";

export type LocalZipAnalysisErrorKind =
  | "conflict"
  | "invalid"
  | "payload_too_large"
  | "unavailable";

export type LocalZipAnalysisErrorCode =
  | "ZIP_ANALYSIS_IN_PROGRESS"
  | "ZIP_ANALYSIS_CANCELLED"
  | "ZIP_ANALYSIS_UNAVAILABLE"
  | "ZIP_COMPRESSED_LIMIT_EXCEEDED"
  | "ZIP_DUPLICATE_PATH"
  | "ZIP_EMPTY"
  | "ZIP_FILE_COUNT_LIMIT_EXCEEDED"
  | "ZIP_INVALID"
  | "ZIP_SIZE_MISMATCH"
  | "ZIP_UNCOMPRESSED_LIMIT_EXCEEDED"
  | "ZIP_UNSAFE_PATH"
  | "ZIP_CONFIGURATION_REQUIRED";

export class LocalZipAnalysisError extends Error {
  public constructor(
    public readonly code: LocalZipAnalysisErrorCode,
    public readonly kind: LocalZipAnalysisErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "LocalZipAnalysisError";
  }
}

export interface AnalyzeLocalZipRequest {
  readonly sessionId: string;
  readonly content: AsyncIterable<Uint8Array>;
  readonly contentLength?: number;
  readonly cancelContent?: () => void;
}

interface ActiveLocalZipAnalysis {
  readonly controller: AbortController;
  readonly completion: Promise<void>;
  complete(): void;
}

export class AnalyzeLocalZip implements LocalZipAnalysisLifecycle {
  readonly #activeOperations = new Map<string, ActiveLocalZipAnalysis>();
  readonly #cleanupFailures = new Map<
    string,
    LocalZipStagingCleanupError
  >();
  #accepting = true;

  public constructor(
    private readonly store: ConnectionSessionStore,
    private readonly stager: LocalZipArchiveStager,
    private readonly ingestWorkspace: IngestWorkspace,
    private readonly analyzeWorkspace: AnalyzeWorkspace,
  ) {}

  public async execute(
    request: AnalyzeLocalZipRequest,
  ): Promise<ConnectionSessionSummary> {
    const operation = this.registerOperation(request.sessionId);
    const cancelContent = (): void => request.cancelContent?.();
    operation.controller.signal.addEventListener("abort", cancelContent, {
      once: true,
    });
    let stagedArchive: StagedZipArchive | undefined;
    let analysisStarted = false;
    let lifecycleFailure: LocalZipStagingCleanupError | undefined;
    try {
      const startedSession = await this.beginAnalysis(request.sessionId);
      analysisStarted = true;
      const source = startedSession.configuration?.source;
      if (!source || source.kind !== "zip") {
        throw new ConnectionZipConfigurationRequiredError();
      }
      stagedArchive = await this.stager.stage({
        content: request.content,
        expectedBytes: source.file.sizeBytes,
        signal: operation.controller.signal,
        ...(request.contentLength !== undefined
          ? { declaredBytes: request.contentLength }
          : {}),
      });
      await this.store.markZipAnalysisRunning(request.sessionId);

      const now = new Date();
      const ingestedGraph = await this.ingestWorkspace.execute(
        stagedArchive.source,
        now,
      );
      const graph = CanonicalWorkspaceGraphSchema.parse({
        ...ingestedGraph,
        sourceDescription: "local-upload:notion-zip",
      });
      const plan = this.analyzeWorkspace.execute(graph, now);

      throwIfCancelled(operation.controller.signal);
      await stagedArchive.dispose();
      stagedArchive = undefined;
      throwIfCancelled(operation.controller.signal);
      const completedSession = await this.store.completeZipAnalysis(
        request.sessionId,
        graph,
        plan,
      );
      return summarizeConnectionSession(completedSession);
    } catch (error) {
      let failure: unknown = error;
      if (
        stagedArchive &&
        !(failure instanceof LocalZipStagingCleanupError)
      ) {
        try {
          await stagedArchive.dispose();
        } catch (cleanupError) {
          failure = cleanupError;
        }
      }
      if (
        operation.controller.signal.aborted &&
        !(failure instanceof LocalZipStagingCleanupError)
      ) {
        failure = new LocalZipStagingCancelledError();
      }
      if (failure instanceof LocalZipStagingCleanupError) {
        lifecycleFailure = failure;
      }
      if (analysisStarted) {
        await this.store.failZipAnalysis(request.sessionId);
      }
      if (failure instanceof LocalZipStagingCancelledError) {
        throw new LocalZipAnalysisError(
          "ZIP_ANALYSIS_CANCELLED",
          "conflict",
          "세션이 종료되어 진행 중인 로컬 분석을 취소했습니다.",
        );
      }
      if (failure instanceof WorkspaceSourceError) {
        throw mapWorkspaceSourceError(failure);
      }
      throw failure;
    } finally {
      operation.controller.signal.removeEventListener(
        "abort",
        cancelContent,
      );
      if (this.#activeOperations.get(request.sessionId) === operation) {
        this.#activeOperations.delete(request.sessionId);
      }
      if (lifecycleFailure) {
        this.#cleanupFailures.set(request.sessionId, lifecycleFailure);
      }
      operation.complete();
    }
  }

  public stopAccepting(): void {
    this.#accepting = false;
  }

  public async cancel(sessionId: string): Promise<void> {
    const operation = this.#activeOperations.get(sessionId);
    if (operation) {
      operation.controller.abort();
      await operation.completion;
    }
    await this.retryCleanup(sessionId);
  }

  public async cancelAll(): Promise<void> {
    const operations = [...this.#activeOperations.values()];
    for (const operation of operations) {
      operation.controller.abort();
    }
    await Promise.all(operations.map((operation) => operation.completion));
    let firstFailure: LocalZipStagingCleanupError | undefined;
    for (const sessionId of [...this.#cleanupFailures.keys()]) {
      try {
        await this.retryCleanup(sessionId);
      } catch (error) {
        if (
          !firstFailure &&
          error instanceof LocalZipStagingCleanupError
        ) {
          firstFailure = error;
        }
      }
    }
    if (firstFailure) {
      throw firstFailure;
    }
  }

  private async beginAnalysis(
    sessionId: string,
  ): Promise<ConnectionSessionRecord> {
    try {
      return await this.store.beginZipAnalysis(sessionId);
    } catch (error) {
      if (error instanceof ConnectionAnalysisInProgressError) {
        throw new LocalZipAnalysisError(
          "ZIP_ANALYSIS_IN_PROGRESS",
          "conflict",
          "이미 로컬 분석이 진행 중입니다. 현재 분석이 끝난 뒤 다시 시도해 주세요.",
        );
      }

      if (error instanceof ConnectionZipConfigurationRequiredError) {
        throw new LocalZipAnalysisError(
          "ZIP_CONFIGURATION_REQUIRED",
          "conflict",
          "먼저 Source 단계에서 Notion ZIP 설정을 저장해 주세요.",
        );
      }
      throw error;
    }
  }

  private registerOperation(sessionId: string): ActiveLocalZipAnalysis {
    if (!this.#accepting) {
      throw new LocalZipAnalysisError(
        "ZIP_ANALYSIS_UNAVAILABLE",
        "unavailable",
        "로컬 앱을 종료하는 중이어서 새 분석을 시작할 수 없습니다.",
      );
    }
    const cleanupFailure = this.#cleanupFailures.get(sessionId);
    if (cleanupFailure) {
      throw cleanupFailure;
    }
    if (this.#activeOperations.has(sessionId)) {
      throw new LocalZipAnalysisError(
        "ZIP_ANALYSIS_IN_PROGRESS",
        "conflict",
        "이미 로컬 분석이 진행 중입니다. 현재 분석이 끝난 뒤 다시 시도해 주세요.",
      );
    }
    const operation = createActiveOperation();
    this.#activeOperations.set(sessionId, operation);
    return operation;
  }

  private async retryCleanup(sessionId: string): Promise<void> {
    const cleanupFailure = this.#cleanupFailures.get(sessionId);
    if (!cleanupFailure) {
      return;
    }
    try {
      await cleanupFailure.retryCleanup();
      this.#cleanupFailures.delete(sessionId);
    } catch {
      throw cleanupFailure;
    }
  }
}

function createActiveOperation(): ActiveLocalZipAnalysis {
  let completeOperation: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => {
    completeOperation = resolve;
  });
  return {
    controller: new AbortController(),
    completion,
    complete(): void {
      completeOperation?.();
    },
  };
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new LocalZipStagingCancelledError();
  }
}

function mapWorkspaceSourceError(
  error: WorkspaceSourceError,
): LocalZipAnalysisError {
  switch (error.code) {
    case "archive_too_large":
      return new LocalZipAnalysisError(
        "ZIP_COMPRESSED_LIMIT_EXCEEDED",
        "payload_too_large",
        "ZIP 파일의 압축 크기가 허용 한도를 넘었습니다. 더 작은 내보내기 파일을 선택해 주세요.",
      );
    case "uncompressed_size_limit":
      return new LocalZipAnalysisError(
        "ZIP_UNCOMPRESSED_LIMIT_EXCEEDED",
        "payload_too_large",
        "ZIP의 압축을 푼 크기가 허용 한도를 넘었습니다. Notion 내보내기를 나누어 다시 시도해 주세요.",
      );
    case "file_count_limit":
      return new LocalZipAnalysisError(
        "ZIP_FILE_COUNT_LIMIT_EXCEEDED",
        "payload_too_large",
        "ZIP 안의 파일 수가 허용 한도를 넘었습니다. Notion 내보내기를 나누어 다시 시도해 주세요.",
      );
    case "empty_source":
      return new LocalZipAnalysisError(
        "ZIP_EMPTY",
        "invalid",
        "선택한 ZIP 파일이 비어 있습니다. Notion에서 다시 내보낸 ZIP을 선택해 주세요.",
      );
    case "invalid_archive":
    case "invalid_source_data":
      return new LocalZipAnalysisError(
        "ZIP_INVALID",
        "invalid",
        "올바른 Notion ZIP 파일을 읽을 수 없습니다. 내보내기를 다시 받아 선택해 주세요.",
      );
    case "unsafe_path":
      return new LocalZipAnalysisError(
        "ZIP_UNSAFE_PATH",
        "invalid",
        "ZIP 안에서 안전하지 않은 경로가 발견되어 분석을 중단했습니다.",
      );
    case "duplicate_path":
      return new LocalZipAnalysisError(
        "ZIP_DUPLICATE_PATH",
        "invalid",
        "ZIP 안에 같은 경로의 파일이 둘 이상 있어 안전하게 분석할 수 없습니다.",
      );
    case "archive_size_mismatch":
      return new LocalZipAnalysisError(
        "ZIP_SIZE_MISMATCH",
        "invalid",
        "선택한 ZIP의 크기와 전송된 데이터가 다릅니다. 파일을 다시 선택해 주세요.",
      );
  }
}
