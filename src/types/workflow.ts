export type WorkflowTaskInformation = {
  task_instance_id: number | null;
  name: string;
  state: string;
  host: string | null;
  duration_seconds: number | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export type WorkflowTasks = {
  state: string;
  error: string | null;
  tasks: WorkflowTaskInformation[];
  attempt?: number;
  duration_seconds?: number;
  started_at?: string | null;
  finished_at?: string | null;
};

export const terminalStates = new Set(["SUCCESS", "FAILURE", "STOP", "KILL", "FORCED_SUCCESS", "SUBMIT_FAILED", "AUTO_SAVE_FAILED", "RESULT_FAILED"]);
