import path from "node:path";

export function analysisArtifactDir(root: string, analysisId: string): string {
  return path.join(root, ".futureproof", "runs", analysisId);
}
