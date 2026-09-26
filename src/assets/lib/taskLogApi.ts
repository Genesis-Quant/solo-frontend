import { client } from "@/assets/lib/request";
import type { TaskLog, TaskLogScope } from "@/types/task";
import type { WorkflowTasks } from "@/types/workflow";

export function createTaskLogApi(base: string) {
  return {
    tasks: () => client.get<WorkflowTasks>(`${base}/tasks`),
    logs: (task: number, offset: number, limit: number, scope: TaskLogScope, cursor: string | null) => {
      const params = new URLSearchParams({ task_instance_id: String(task), skip_line_num: String(offset), limit: String(limit), scope });
      if (cursor) params.set("cursor", cursor);
      return client.get<TaskLog>(`${base}/logs?${params}`);
    },
    downloadLog: (task: number) => client.getText(`${base}/logs/download?task_instance_id=${task}`)
  };
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
