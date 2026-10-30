import TaskLogPanel from "@/components/panel/TaskLogPanel";
import { formatDuration } from "@/assets/lib/taskLogApi";
import { taskStatusLabels, type TaskAttempt } from "@/types/task";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";

export default function TaskLogDialog({ description, apiBase, workflowId, onClose, attempts, attempt, onAttempt, taskInstanceId = null }: {
  description: string;
  apiBase: string;
  workflowId: number | null;
  onClose: () => void;
  attempts?: TaskAttempt[];
  attempt?: number;
  onAttempt?: (number: number) => void;
  taskInstanceId?: number | null;
}) {
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="flex h-[min(52rem,90vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1100px,calc(100vw-2rem))]" showCloseButton>
      <DialogHeader className="sr-only">
        <DialogTitle>运行日志</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {attempts && attempt && onAttempt && <div className="flex shrink-0 items-center gap-3 border-b bg-muted/20 px-5 py-3 pr-14"><span className="text-sm font-medium">运行记录</span><Select value={String(attempt)} onValueChange={(value) => onAttempt(Number(value))}><SelectTrigger aria-label="选择运行轮次" className="w-64"><SelectValue /></SelectTrigger><SelectContent>{attempts.map((item) => <SelectItem key={item.id} value={String(item.number)}>第 {item.number} 次 · {taskStatusLabels[item.status]} · {formatDuration(item.durationSeconds)}</SelectItem>)}</SelectContent></Select></div>}
      <TaskLogPanel className="min-h-0 flex-1 rounded-none border-0 shadow-none" reserveCloseButton
        apiBase={apiBase} taskInstanceId={taskInstanceId}
        title="运行日志" workflowInstanceId={workflowId || null} />
    </DialogContent>
  </Dialog>;
}
