import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import IconActivity from "~icons/lucide/activity";
import IconClock3 from "~icons/lucide/clock-3";
import IconLoaderCircle from "~icons/lucide/loader-circle";
import IconRefreshCw from "~icons/lucide/refresh-cw";
import IconServer from "~icons/lucide/server";
import IconTerminal from "~icons/lucide/terminal";

import { appendTaskLog, shouldResetTerminalTaskLog } from "@/assets/lib/taskLogs";
import { createTaskLogApi, formatDuration } from "@/assets/lib/taskLogApi";
import { cn } from "@/assets/lib/utils";
import TaskLogViewer from "@/components/panel/TaskLogViewer";
import { AppPagination } from "@/components/bar/AppPagination";
import SchedulerState from "@/components/badge/SchedulerState";
import { Button } from "@/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import type { TaskLogScope } from "@/types/task";
import { terminalStates, type WorkflowTasks } from "@/types/workflow";

const FETCH_SIZE = 10_000;
const DEFAULT_PAGE_SIZE = 500;
const LOG_PAGE_SIZE_OPTIONS = [100, 500, 1000];
const LOG_BOTTOM_THRESHOLD = 24;

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [scope, setScope] = useState<TaskLogScope>("full");
  const nextLineRef = useRef(0);
  const nextCursorRef = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const resetScrollRef = useRef(false);
  const selectionRef = useRef(`${apiBase}:${workflowInstanceId}:${taskInstanceId}:${scope}`);
  const refreshInFlightRef = useRef<string | null>(null);
  selectionRef.current = `${apiBase}:${workflowInstanceId}:${taskInstanceId}:${scope}`;
  const task = selectedWorkflowTask(workflow, taskInstanceId);
  const resolvedTaskInstanceId = task?.task_instance_id ?? taskInstanceId;
  const taskUnavailable = taskLogUnavailable(workflow, task?.host, resolvedTaskInstanceId);
  const creating = !taskUnavailable && taskLogCreating(task?.host, resolvedTaskInstanceId);
  const lines = useMemo(() => splitLogLines(message), [message]);
  const totalPages = Math.max(1, Math.ceil(lines.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleMessage = useMemo(() => lines.slice((safePage - 1) * pageSize, safePage * pageSize).join("\n"), [lines, pageSize, safePage]);

  const resetLog = useCallback(() => {
    setMessage("");
    setPage(1);
    nextLineRef.current = 0;
    nextCursorRef.current = null;
    followLatestRef.current = true;
    resetScrollRef.current = false;
  }, []);

  const changePage = useCallback((value: number) => {
    followLatestRef.current = false;
    resetScrollRef.current = true;
    setPage(value);
  }, []);

  const changePageSize = useCallback((value: number) => {
    followLatestRef.current = false;
    resetScrollRef.current = true;
    setPage(1);
    setPageSize(value);
  }, []);

  const updateFollowLatest = useCallback(() => {
    const viewport = logRef.current;
    if (!viewport) return;
    followLatestRef.current = safePage === totalPages && isLogAtBottom(viewport);
  }, [safePage, totalPages]);

  const loadWorkflow = useCallback(async () => {
    const selection = `${apiBase}:${workflowInstanceId}:${taskInstanceId}:${scope}`;
    const result = await api.tasks();
    if (selectionRef.current !== selection) return null;
    setWorkflow(result);
    return result;
  }, [api, apiBase, scope, taskInstanceId, workflowInstanceId]);

  const loadLogs = useCallback(async (currentWorkflow: WorkflowTasks, reset: boolean) => {
    const currentTask = selectedWorkflowTask(currentWorkflow, taskInstanceId);
    const currentTaskInstanceId = currentTask?.task_instance_id;
    if (!currentTaskInstanceId || !currentTask.host) return false;
    const selection = `${apiBase}:${workflowInstanceId}:${taskInstanceId}:${scope}`;
    const terminal = terminalStates.has(currentWorkflow.state) || terminalStates.has(currentTask.state);
    if (reset && terminal && scope === "full") {
      const completeLog = await api.downloadLog(currentTaskInstanceId);
      if (selectionRef.current !== selection) return false;
      setMessage(completeLog);
      nextLineRef.current = 0;
      nextCursorRef.current = null;
      return true;
    }
    let cursor = reset ? 0 : nextLineRef.current;
    let sourceCursor = reset ? null : nextCursorRef.current;
    let added = "";
    let hasMore = true;
    while (hasMore) {
      const result = await api.logs(currentTaskInstanceId, cursor, FETCH_SIZE, scope, sourceCursor);
      if (selectionRef.current !== selection) return false;
      added = appendTaskLog(added, result.message, scope === "worker");
      hasMore = result.has_more && result.next_line_num > cursor;
      cursor = result.next_line_num;
      sourceCursor = result.next_cursor ?? null;
    }
    setMessage((current) => reset ? added : appendTaskLog(current, added, scope === "worker"));
    nextLineRef.current = cursor;
    nextCursorRef.current = sourceCursor;
    return true;
  }, [api, apiBase, scope, taskInstanceId, workflowInstanceId]);

  const refresh = useCallback(async () => {
    const selection = `${apiBase}:${workflowInstanceId}:${taskInstanceId}:${scope}`;
    if (refreshInFlightRef.current === selection) return;
    refreshInFlightRef.current = selection;
    setError("");
    setLoading(true);
    try {
      const currentWorkflow = await loadWorkflow();
      if (currentWorkflow && !await loadLogs(currentWorkflow, true)) resetLog();
    } catch (reason) {
      if (selectionRef.current === selection) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (selectionRef.current === selection) setLoading(false);
      if (refreshInFlightRef.current === selection) refreshInFlightRef.current = null;
    }
  }, [apiBase, loadLogs, loadWorkflow, resetLog, scope, taskInstanceId, workflowInstanceId]);

  useEffect(() => { setWorkflow(null); }, [apiBase, taskInstanceId, workflowInstanceId]);
  useEffect(() => {
    resetLog();
    refresh();
  }, [refresh, resetLog, taskInstanceId, workflowInstanceId]);
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const selection = `${apiBase}:${workflowInstanceId}:${taskInstanceId}:${scope}`;
      if (refreshInFlightRef.current === selection) return;
      refreshInFlightRef.current = selection;
      try {
        const result = await loadWorkflow();
        const state = result ? selectedWorkflowTask(result, taskInstanceId)?.state : undefined;
        const terminal = Boolean(result && (terminalStates.has(result.state) || state && terminalStates.has(state)));
        const logsLoaded = result ? await loadLogs(result, shouldResetTerminalTaskLog(scope, terminal)) : false;
        if (selectionRef.current === selection) setError("");
        if (terminal && (logsLoaded || !selectedWorkflowTask(result!, taskInstanceId)?.host)) window.clearInterval(timer);
      } catch (reason) {
        if (selectionRef.current === selection) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (refreshInFlightRef.current === selection) refreshInFlightRef.current = null;
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [apiBase, loadLogs, loadWorkflow, scope, taskInstanceId, workflowInstanceId]);
  useEffect(() => { if (followLatestRef.current && safePage !== totalPages) setPage(totalPages); }, [safePage, totalPages]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  useLayoutEffect(() => {
    const viewport = logRef.current;
    if (!viewport) return;
    if (followLatestRef.current && safePage === totalPages) {
      viewport.scrollTop = viewport.scrollHeight;
      return;
    }
    if (!resetScrollRef.current) return;
    viewport.scrollTop = 0;
    resetScrollRef.current = false;
    followLatestRef.current = safePage === totalPages && isLogAtBottom(viewport);
  }, [safePage, totalPages, visibleMessage]);

  return <section aria-label={title} className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border bg-card shadow-sm", className)}>
    <header className={cn("flex shrink-0 items-start justify-between gap-5 border-b px-5 py-4", reserveCloseButton && "pr-14")}>
      <div className="flex min-w-0 items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted/40"><IconTerminal width={15} height={15} /></span><div className="min-w-0"><h2 className="truncate text-base font-semibold">{title}</h2><p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">Workflow #{workflowInstanceId ?? "—"} / Task #{resolvedTaskInstanceId ?? "—"}</p></div></div>
      <div className="flex shrink-0 items-center gap-2"><Tabs value={scope} onValueChange={(value) => setScope(value as TaskLogScope)}><TabsList className="h-8 rounded-md p-0.5"><TabsTrigger className="h-7 px-2 text-xs" value="full">全部</TabsTrigger><TabsTrigger className="h-7 px-2 text-xs" value="worker">Worker 输出</TabsTrigger></TabsList></Tabs><Button disabled={loading} size="sm" variant="outline" onClick={refresh}>{loading ? <IconLoaderCircle className="animate-spin" /> : <IconRefreshCw />}刷新</Button></div>
    </header>
    <div className="grid shrink-0 grid-cols-2 border-b bg-muted/15 sm:grid-cols-4"><TaskMeta icon={<IconActivity width={13} height={13} />} label="状态" value={<SchedulerState state={task?.state ?? workflow?.state ?? "LOADING"} />} /><TaskMeta icon={<IconTerminal width={13} height={13} />} label="Task" value={task?.name ?? "—"} /><TaskMeta icon={<IconServer width={13} height={13} />} label="Worker" value={task?.host ?? "—"} /><TaskMeta icon={<IconClock3 width={13} height={13} />} label="耗时" value={formatDuration(task?.duration_seconds)} /></div>
    <div className="flex min-h-0 flex-1 flex-col bg-muted/20 text-foreground"><div className="flex shrink-0 items-center justify-between border-b px-4 py-2 font-mono text-[10px] tracking-[0.1em] text-muted-foreground"><span>{task?.name ?? "TASK"} / {resolvedTaskInstanceId ?? "—"}</span><span>{lines.length.toLocaleString("zh-CN")} LINES</span></div><div className="min-h-0 flex-1 overflow-auto" ref={logRef} onScroll={updateFollowLatest}>{taskLogContent(loading, workflow, visibleMessage, (safePage - 1) * pageSize, error, creating, taskUnavailable, scope)}</div>{error ? <div className="shrink-0 border-t border-destructive/20 bg-destructive/5 px-4 py-2.5 text-xs text-destructive">{error}</div> : null}<footer className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-2"><div className="text-[10px] text-muted-foreground"><p>{taskLogFooter(creating, taskUnavailable, scope)}</p><p className="mt-0.5">共 {lines.length.toLocaleString("zh-CN")} 行</p></div>{lines.length > 0 ? <AppPagination page={safePage} pageSize={pageSize} pageSizeOptions={LOG_PAGE_SIZE_OPTIONS} totalPages={totalPages} onPageChange={changePage} onPageSizeChange={changePageSize} /> : null}</footer></div>
  </section>;
}

function TaskMeta({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) { return <div className="min-w-0 border-r border-t px-4 py-3 first:border-t-0 sm:border-t-0"><div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">{icon}{label}</div><div className="mt-1.5 truncate font-mono text-xs font-medium">{value}</div></div>; }
function emptyLogMessage(error: string, creating: boolean) { return error ? "" : creating ? "创建中" : "暂无日志"; }

function selectedWorkflowTask(workflow: WorkflowTasks | null, taskInstanceId: number | null) {
  if (!workflow) return undefined;
  if (taskInstanceId !== null) return workflow.tasks.find((item) => item.task_instance_id === taskInstanceId);
  return workflow.tasks.find((item) => item.task_instance_id !== null) ?? workflow.tasks[0];
}

function taskLogCreating(host: string | null | undefined, taskInstanceId: number | null) { return !taskInstanceId || !host; }
function taskLogUnavailable(workflow: WorkflowTasks | null, host: string | null | undefined, taskInstanceId: number | null) { return Boolean(workflow && terminalStates.has(workflow.state) && taskLogCreating(host, taskInstanceId)); }

function taskLogContent(loading: boolean, workflow: WorkflowTasks | null, message: string, lineOffset: number, error: string, creating: boolean, unavailable: boolean, scope: TaskLogScope) {
  if (loading && !workflow) return <div className="grid min-h-72 place-items-center"><IconLoaderCircle className="animate-spin text-muted-foreground" width={20} height={20} /></div>;
  const unavailableMessage = unavailable ? workflow?.error || "工作流已结束，未创建可读取日志的 Task" : "";
  const emptyMessage = scope === "worker" && !error && !creating ? "暂无 Worker 输出" : emptyLogMessage(error, creating);
  return <TaskLogViewer message={message} lineOffset={lineOffset} emptyMessage={unavailableMessage || emptyMessage} />;
}

function taskLogFooter(creating: boolean, unavailable: boolean, scope: TaskLogScope) {
  if (unavailable) return "工作流已结束，Task 未创建或未分配 Worker";
  if (creating) return "等待 DolphinScheduler 创建并分配 Task";
  return scope === "worker" ? "只显示 Worker 子进程输出" : "实时从 DolphinScheduler 读取";
}

function splitLogLines(message: string) {
  if (!message) return [];
  const lines = message.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function isLogAtBottom(viewport: HTMLDivElement) {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= LOG_BOTTOM_THRESHOLD;
}
