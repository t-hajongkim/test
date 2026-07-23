export interface LocalZipAnalysisLifecycle {
  stopAccepting(): void;
  cancel(sessionId: string): Promise<void>;
  cancelAll(): Promise<void>;
}
