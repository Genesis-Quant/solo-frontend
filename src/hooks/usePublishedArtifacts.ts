import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/assets/lib/request";
import { RequestError } from "@/assets/lib/requestError";
import type { ResearchArtifact } from "@/types/artifact";
import type { ProjectKind } from "@/types/research";

/** Independent registry reads; never derive releases from the live project list. */
export function usePublishedArtifacts(kind?: ProjectKind) {
  const [artifacts, setArtifacts] = useState<ResearchArtifact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const requestEpoch = useRef(0);
  const reload = useCallback(() => {
    // Invalidate immediately, before React runs the next effect's cleanup.
    requestEpoch.current += 1;
    setRevision((value) => value + 1);
  }, []);
  const remove = useCallback(async (id: string) => {
    let cleanupFailure: RequestError | undefined;
    try {
      await client.delete(`/artifacts/${encodeURIComponent(id)}`);
    } catch (cause) {
      if (!(cause instanceof RequestError && cause.status === 404)) {
        if (!(cause instanceof RequestError && cause.code === "artifact_cleanup_incomplete" && cause.deleted === true && cause.id === id)) throw cause;
        cleanupFailure = cause;
      }
    }
    // Only an acknowledged deletion (including an explicit 404) removes a row.
    reload();
    setArtifacts((records) => records.filter((artifact) => artifact.id !== id));
    if (cleanupFailure) throw cleanupFailure;
  }, [reload]);

  useEffect(() => {
    let active = true;
    const epoch = ++requestEpoch.current;
    const current = () => active && epoch === requestEpoch.current;
    setRefreshing(true);
    client.get<ResearchArtifact[]>(`/artifacts?published=true${kind ? `&kind=${kind}` : ""}`)
      .then((records) => {
        if (!current()) return;
        setArtifacts(records);
        setLoaded(true);
        setError("");
      })
      .catch((cause) => { if (current()) setError(cause instanceof Error ? cause.message : "无法加载已发布成果"); })
      .finally(() => { if (current()) setRefreshing(false); });
    return () => { active = false; };
  }, [kind, revision]);

  return { artifacts, loaded, refreshing, error, reload, remove };
}
