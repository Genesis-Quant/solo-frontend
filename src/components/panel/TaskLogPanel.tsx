import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, Clock3, LoaderCircle, RefreshCw, Server, Terminal } from "lucide-react";

import { appendTaskLog, filterTaskLog, parseTaskLog, taskLogEntries, type TaskLogThreshold } from "@/assets/lib/taskLogs";
import { createTaskLogApi, formatDuration } from "@/assets/lib/taskLogApi";
import { cn } from "@/assets/lib/utils";
import { AppPagination } from "@/components/bar/AppPagination";
import SchedulerState from "@/components/badge/SchedulerState";
import TaskLogViewer from "@/components/panel/TaskLogViewer";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import type { TaskLogScope } from "@/types/task";
import { terminalStates, type WorkflowTasks } from "@/types/workflow";

type TaskLogPanelProps = {
  apiBase: string;
  className?: string;
  reserveCloseButton?: boolean;
  taskInstanceId: number | null;
  title?: string;
  workflowInstanceId: number | null;
};

export default function TaskLogPanel({ apiBase, className, reserveCloseButton = false, taskInstanceId, title = "运行日志", workflowInstanceId }: TaskLogPanelProps) {
  const api = useMemo(() => createTaskLogApi(apiBase), [apiBase]);
  const [workflow, setWorkflow] = useState<WorkflowTasks | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(500);
  const [scope, setScope] = useState<TaskLogScope>("full");
  const [threshold, setThreshold] = useState<TaskLogThreshold>("INFO");
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const scrollToTop = useRef(false);
  const task = selectedTask(workflow, taskInstanceId);
  const parsed = useMemo(() => parseTaskLog(message), [message]);
  const lines = useMemo(() => filterTaskLog(parsed, threshold), [parsed, threshold]);
  const entries = useMemo(() => taskLogEntries(lines), [lines]);
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleLines = useMemo(() => entries.slice((safePage - 1) * pageSize, safePage * pageSize).flat(), [entries, pageSize, safePage]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentTaskId: number | null = null;
    let lineCursor = 0;
    let sourceCursor: string | null = null;
    setWorkflow(null);
    setMessage("");
    setPage(1);
    setError("");
    setLoading(true);
    follow.current = true;
    const poll = async () => {
      let terminal = false;
      try {
        const result = await api.tasks();
        if (disposed) return;
        setWorkflow(result);
        const current = selectedTask(result, taskInstanceId);
        terminal = terminalStates.has(result.state);
        if (!current?.task_instance_id || !current.host) {
          setMessage("");
          currentTaskId = null;
          lineCursor = 0;
          sourceCursor = null;
        } else {
          terminal = terminal || terminalStates.has(current.state);
          if (currentTaskId !== current.task_instance_id) {
            currentTaskId = current.task_instance_id;
            lineCursor = 0;
            sourceCursor = null;
            setMessage("");
            setPage(1);
          }
          if (terminal && scope === "full") {
            const text = await api.downloadLog(currentTaskId);
            if (disposed) return;
            setMessage(text);
          } else {
            let more = true;
            while (more && !disposed) {
              const offset = lineCursor;
              const output = await api.logs(currentTaskId, offset, 10000, scope, sourceCursor);
              if (disposed) return;
              setMessage((previous) => offset === 0 ? output.message : appendTaskLog(previous, output.message, scope === "worker"));
              lineCursor = output.next_line_num;
              sourceCursor = output.next_cursor ?? null;
              more = output.has_more && lineCursor > offset;
            }
          }
        }
        if (!disposed) setError("");
      } catch (cause) {
        if (disposed) return;
        terminal = false;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!disposed) {
          setLoading(false);
          if (!terminal) timer = setTimeout(poll, 2500);
        }
      }
    };
    poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [api, scope, taskInstanceId, workflowInstanceId, refresh]);

  useEffect(() => {
    if (follow.current) setPage(totalPages);
    else if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    if (follow.current && safePage === totalPages) node.scrollTop = node.scrollHeight;
    else if (scrollToTop.current) { node.scrollTop = 0; scrollToTop.current = false; }
  }, [visibleLines, safePage, totalPages]);

  const unavailable = !!workflow && terminalStates.has(workflow.state) && !task?.host;
  const waiting = !unavailable && !task?.host;
  const empty = waiting ? "等待本轮 Task 在 Worker 启动" : unavailable ? workflow?.error || "本轮已结束，没有可读取的 Worker 日志" : "暂无日志";
  return <section aria-label={title} className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border bg-card shadow-sm", className)}>
    <header className={cn("flex shrink-0 flex-wrap items-start justify-between gap-3 border-b px-5 py-4", reserveCloseButton && "pr-14")}>
      <div className="flex min-w-0 items-center gap-2.5"><Terminal className="size-4 text-muted-foreground" /><div><h2 className="text-base font-semibold">{title}</h2><p className="mt-0.5 font-mono text-[11px] text-muted-foreground">Workflow #{workflowInstanceId ?? "—"} / Task #{task?.task_instance_id ?? "—"}</p></div></div>
      <div className="flex flex-wrap items-center gap-2"><Select value={threshold} onValueChange={(value) => { follow.current = false; scrollToTop.current = true; setPage(1); setThreshold(value as TaskLogThreshold); }}><SelectTrigger aria-label="最低日志级别" className="h-8 min-w-28 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="INFO">INFO 及以上</SelectItem><SelectItem value="DEBUG">DEBUG 及以上</SelectItem><SelectItem value="TRACE">全部级别</SelectItem><SelectItem value="WARNING">WARNING 及以上</SelectItem><SelectItem value="ERROR">ERROR 及以上</SelectItem></SelectContent></Select><Tabs value={scope} onValueChange={(value) => setScope(value as TaskLogScope)}><TabsList className="h-8"><TabsTrigger className="text-xs" value="full">全部</TabsTrigger><TabsTrigger className="text-xs" value="worker">Worker 输出</TabsTrigger></TabsList></Tabs><Button variant="outline" size="sm" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw className={loading ? "animate-spin" : ""} />刷新</Button></div>
    </header>
    <div className="grid shrink-0 grid-cols-2 border-b bg-muted/15 sm:grid-cols-4"><TaskMeta icon={<Activity className="size-3.5" />} label="状态" value={<SchedulerState state={workflow?.state ?? "LOADING"} />} /><TaskMeta icon={<Terminal className="size-3.5" />} label="Task" value={task?.name ?? "—"} /><TaskMeta icon={<Server className="size-3.5" />} label="Worker" value={task?.host ?? "—"} /><TaskMeta icon={<Clock3 className="size-3.5" />} label="本轮耗时" value={formatDuration(workflow?.duration_seconds ?? task?.duration_seconds)} /></div>
    {workflow?.error && <p className="border-b px-4 py-2 text-xs text-muted-foreground">{workflow.error}</p>}
    <div className="min-h-0 flex-1 overflow-auto bg-muted/15" ref={viewport} onScroll={() => { const node = viewport.current; if (node) follow.current = safePage === totalPages && node.scrollHeight - node.scrollTop - node.clientHeight <= 24; }}>
      {loading && !workflow ? <div className="grid min-h-72 place-items-center"><LoaderCircle className="size-5 animate-spin" /></div> : <TaskLogViewer lines={visibleLines} emptyMessage={empty} />}
    </div>
    {error && <div role="alert" className="shrink-0 border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">{error}</div>}
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-2"><div className="text-[10px] text-muted-foreground"><p>{scope === "worker" ? "只显示本轮 Worker 子进程输出" : "本轮调度及 Worker 原始日志"}</p><p>{entries.length.toLocaleString()} 条记录 · {lines.length.toLocaleString()} 行 / 原始 {parsed.length.toLocaleString()} 行</p></div>{entries.length > 0 && <AppPagination page={safePage} pageSize={pageSize} pageSizeOptions={[100, 500, 1000]} totalPages={totalPages} onPageChange={(value) => { follow.current = false; scrollToTop.current = true; setPage(value); }} onPageSizeChange={(value) => { follow.current = false; scrollToTop.current = true; setPage(1); setPageSize(value); }} />}</footer>
  </section>;
}

function selectedTask(workflow: WorkflowTasks | null, identifier: number | null) {
  if (!workflow) return undefined;
  if (identifier !== null) return workflow.tasks.find((task) => task.task_instance_id === identifier);
  return workflow.tasks.reduce<(typeof workflow.tasks)[number] | undefined>((latest, task) => (task.task_instance_id ?? 0) > (latest?.task_instance_id ?? 0) ? task : latest, undefined);
}

function TaskMeta({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return <div className="min-w-0 border-r px-4 py-3 last:border-r-0"><div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">{icon}{label}</div><div className="mt-1.5 truncate font-mono text-xs font-medium">{value}</div></div>;
}
