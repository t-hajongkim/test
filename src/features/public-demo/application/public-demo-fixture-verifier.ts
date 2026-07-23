import type { PublicDemoFixtureDeclaration } from "../../workspace-ingestion/domain/notion-api-snapshot.js";

export interface PublicDemoFixtureVerifier {
  verify(fixtureDirectory: string): Promise<PublicDemoFixtureDeclaration>;
}
