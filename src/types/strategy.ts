export const strategyStages = ["model", "optimize", "control", "execution"] as const;
export type StrategyStage = typeof strategyStages[number];
/** Published roots; omitted stages retain the backend defaults. Legacy version IDs are separate. */
export interface StrategySelection {
  artifacts: Partial<Record<StrategyStage, string>>;
  model?: string | null;
  optimize?: string | null;
  control?: string | null;
  execution?: string | null;
}
export interface StrategyRecord {
  id: string;
  name: string;
  components: Record<StrategyStage, {
    label: string;
    version_id: string | null;
    artifact_id?: string | null;
    source_project_id?: string | null;
    source_project_name?: string | null;
    source_version_id?: string | null;
  }>;
  forms: Record<StrategyStage, Record<string, unknown>>;
  status: string;
  attempt: number;
  canStop: boolean;
  canRetry: boolean;
  error: string;
  workflowId: number | null;
  schemeVersion: string | null;
  createdAt: string;
  duration: string;
  reportPath: string | null;
}

export interface FormSchema {
  title?: string;
  type?: string;
  format?: string;
  $ref?: string;
  $defs?: Record<string, FormSchema>;
  properties?: Record<string, FormSchema>;
  required?: string[];
  enum?: (string | number | boolean)[];
  const?: string | number | boolean;
  anyOf?: FormSchema[];
  items?: FormSchema;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  "x-enum-labels"?: string[];
}
export type StrategyForms = Record<StrategyStage, { schema: FormSchema; values: Record<string, unknown> }>;

export const strategyStatus: Record<string, string> = { building: "组装中", queued: "排队中", running: "回测中", stopping: "终止中", retrying: "重试排队中", success: "回测成功", failed: "回测失败", stopped: "已终止" };
export const strategyActive = (status: string) => ["building", "queued", "running", "stopping", "retrying"].includes(status);
