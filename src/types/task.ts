import type { WorkflowTaskInformation } from "@/types/workflow";

export type TaskStatus = "building" | "queued" | "running" | "retrying" | "stopping" | "stopped" | "success" | "failed" | "submit_failed";

export interface TaskAttempt {
  id: string;
  number: number;
  status: TaskStatus;
  workflowId: number | null;
  schedulerState: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number;
  error: string;
  syncError: string;
  tasks: WorkflowTaskInformation[];
}

export interface TaskCheckpoint {
  stage: string;
  label: string;
  createdAt: string | null;
  bytes: number;
}

export interface TaskRecord {
  id: string;
  name: string;
  kind: "factor" | "model" | "optimize" | "control" | "execution" | "strategy";
  projectId: string | null;
  version: number | null;
  note: string;
  createdAt: string;
  attemptCreatedAt: string;
  status: TaskStatus;
  workflowId: number | null;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number;
  syncError: string;
  error: string;
  canStop: boolean;
  canRetry: boolean;
  checkpoints: TaskCheckpoint[];
  href: string;
  attempts: TaskAttempt[];
}

export interface TaskParameters {
  available: boolean;
  error: string;
  run: Record<string, unknown>;
  dateInterval: "[start,end]" | "[start,end)";
  sharedAlgorithmParameters: Record<string, unknown>;
  algorithms: Record<string, {
    package?: string;
    version?: string;
    entry?: string;
    params?: Record<string, unknown>;
    parameterSource: "component" | "shared";
  }>;
  dependencies: { name: string; version: string }[];
  input: Record<string, unknown>;
}

export interface TaskDetails extends TaskRecord {
  parameters: TaskParameters;
}

export const taskStatusLabels: Record<TaskStatus, string> = {
  building: "构建中", queued: "排队中", running: "运行中", retrying: "等待重试",
  stopping: "终止中", stopped: "已终止", success: "成功", failed: "失败", submit_failed: "提交失败"
};

export const taskActive = (status: TaskStatus) => ["building", "queued", "running", "retrying", "stopping"].includes(status);

export const taskLogScopes = ["full", "worker"] as const;
export type TaskLogScope = typeof taskLogScopes[number];

export type TaskLog = {
  workflow_instance_id: number;
  task_instance_id: number;
  state: string;
  scope: TaskLogScope;
  skip_line_num: number;
  returned_lines: number;
  next_line_num: number;
  has_more: boolean;
  message: string;
  next_cursor?: string | null;
};
