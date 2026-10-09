import type { ResearchArtifact } from "@/types/artifact";

export const projectKinds = [
  "factor",
  "model",
  "optimize",
  "control",
  "execution"
] as const;
export type ProjectKind = (typeof projectKinds)[number];
export type RunStatus = "success" | "running" | "failed";
export type PublishStatus = "unpublished" | "checking" | "published" | "failed";
export type TaskStep = "environment" | "research" | "report";

export interface TemplateVersion {
  tag: string;
  commit: string;
  version?: string | null;
}

export interface ResearchVersion {
  id: string;
  number: number;
  packageVersion?: string | null;
  /** Raw server lifecycle phase (building, queued, running, submit_failed, …). */
  phase?: string;
  artifactId?: string | null;
  artifact?: ResearchArtifact | null;
  files?: { name: string; size?: number | null; url?: string | null }[];
  note: string;
  submittedAt: string;
  status: RunStatus;
  publishStatus: PublishStatus;
  workflowId: number;
  duration: string;
  error?: string;
  publishError?: string;
  reportPath?: string;
  retired?: boolean;
  retiredReason?: string | null;
  parameters: Record<string, string>;
  dependencies: { name: string; version: string }[];
}

export interface ResearchProject {
  id: string;
  name: string;
  description: string;
  kind: ProjectKind;
  schemeVersion: string | null;
  schemeCommit?: string | null;
  algoVersion: string;
  algoCommit?: string;
  directory?: string;
  updatedAt: string;
  /** Legacy migration flag only; new deletions remove records. */
  archived?: boolean;
  retired?: boolean;
  retiredReason?: string | null;
  versions: ResearchVersion[];
}

export const kindLabels: Record<ProjectKind, string> = {
  factor: "因子分析",
  model: "策略建模",
  optimize: "组合优化",
  control: "订单风控",
  execution: "算法下单"
};

export const runLabels: Record<RunStatus, string> = {
  success: "研究成功",
  running: "运行中",
  failed: "研究失败"
};

export const phaseLabels: Record<string, string> = {
  building: "构建中",
  queued: "排队中",
  running: "运行中",
  success: "研究成功",
  failed: "研究失败",
  submit_failed: "提交失败"
};

export const publishLabels: Record<PublishStatus, string> = {
  unpublished: "未发布",
  checking: "校验中",
  published: "已发布",
  failed: "发布失败"
};

export const stepLabels: Record<TaskStep, string> = {
  environment: "准备环境",
  research: "执行研究",
  report: "生成报告"
};
