import type {
  ProjectKind,
  ResearchProject,
  ResearchVersion,
  TaskStep
} from "@/types/research";

export const defaultDownstream: Record<ProjectKind, string[]> = {
  factor: [],
  model: ["风险平价", "不拒单", "不拆单"],
  optimize: ["不拒单", "不拆单"],
  control: ["不拆单"],
  execution: []
};

export function stepState(
  version: ResearchVersion,
  step: TaskStep
): "success" | "running" | "failed" | "pending" {
  if (step === "environment" || version.status === "success") return "success";
  if (step === "report") return "pending";
  return version.status;
}

export function jupyterUrl(project: ResearchProject): string {
  const base = (
    import.meta.env.VITE_JUPYTER_URL || "http://127.0.0.1:8888"
  ).replace(/\/$/, "");
  return `${base}/lab/tree/projects/${encodeURIComponent(project.id)}`;
}
