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
