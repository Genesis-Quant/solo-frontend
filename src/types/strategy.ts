export const strategyStages = ["model", "optimize", "control", "execution"] as const;
export type StrategyStage = typeof strategyStages[number];
export type StrategySelection = Record<StrategyStage, string | null>;
export interface StrategyRecord {
  id: string;
  name: string;
  components: Record<StrategyStage, { label: string; version_id: string | null }>;
  forms: Record<StrategyStage, Record<string, unknown>>;
  status: string;
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
