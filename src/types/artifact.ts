import type { ProjectKind } from "@/types/research";

/** Immutable registry metadata. Source pointers are descriptive, not live dependencies. */
export interface ResearchArtifact {
  id: string;
  kind: ProjectKind;
  package: string;
  version: string;
  sha256: string;
  filename: string;
  size?: number | null;
  sizeBytes?: number | null;
  entry: string;
  schemeVersion: string | null;
  sources: Record<string, unknown>;
  sourceProjectId: string | null;
  sourceProjectName: string | null;
  sourceVersionId: string | null;
  publishedAt: string | null;
  retired?: boolean;
  retiredReason?: string | null;
  dependencies: Record<string, unknown>;
}
