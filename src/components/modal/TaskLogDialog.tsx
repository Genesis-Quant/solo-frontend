import TaskLogPanel from "@/components/panel/TaskLogPanel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";

export default function TaskLogDialog({ description, apiBase, workflowId, onClose }: {
  description: string;
  apiBase: string;
  workflowId: number | null;
  onClose: () => void;
}) {
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="h-[min(48rem,88vh)] gap-0 overflow-hidden p-0 sm:max-w-[min(960px,calc(100vw-2rem))]" showCloseButton>
      <DialogHeader className="sr-only">
        <DialogTitle>运行日志</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <TaskLogPanel className="h-full rounded-none border-0 shadow-none" reserveCloseButton
        apiBase={apiBase} taskInstanceId={null}
        title="运行日志" workflowInstanceId={workflowId || null} />
    </DialogContent>
  </Dialog>;
}
