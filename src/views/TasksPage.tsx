import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ChevronDown, ChevronRight, Clock3, Eye, LoaderCircle, RefreshCw, RotateCcw, Search, Square, Terminal } from "lucide-react";

import { client } from "@/assets/lib/request";
import { formatDuration } from "@/assets/lib/taskLogApi";
import { cn } from "@/assets/lib/utils";
import { AppPagination } from "@/components/bar/AppPagination";
import { PageHeader, pageContainer } from "@/components/bar/PageHeader";
import SchedulerState from "@/components/badge/SchedulerState";
import TaskLogDialog from "@/components/modal/TaskLogDialog";
import { usePageState } from "@/store/pageMemory";
import { useTaskPolling, useTaskStore } from "@/store/tasks";
import { kindLabels, projectKinds } from "@/types/research";
import { taskActive, taskStatusLabels, type TaskAttempt, type TaskDetails, type TaskRecord, type TaskStatus } from "@/types/task";
import type { WorkflowTaskInformation } from "@/types/workflow";
import { Alert, AlertDescription } from "@/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/ui/alert-dialog";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";

type TaskOperation = { task: TaskRecord; action: "stop" | "retry" };
type LogTarget = { id: string; number: number; taskId: number | null };
const scope = "tasks";

export default function TasksPage() {
  const { records, loaded, loading, error, pending, load, control } = useTaskStore();
  const [search, setSearch] = usePageState(scope, "search", "");
  const [kind, setKind] = usePageState(scope, "kind", "all");
  const [status, setStatus] = usePageState(scope, "status", "all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);
  const [operation, setOperation] = useState<TaskOperation | null>(null);
  const [operationError, setOperationError] = useState("");
  const [now, setNow] = useState(Date.now());
  useTaskPolling();
  const running = records.some((task) => taskActive(task.status) && task.startedAt);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const filtered = useMemo(() => records.filter((task) => (kind === "all" || task.kind === kind)
    && matchesStatus(task.status, status)
    && `${task.name} ${task.workflowId ?? ""} ${task.id}`.toLowerCase().includes(search.trim().toLowerCase())), [records, kind, status, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selected = records.find((task) => task.id === logTarget?.id);
  const chosen = selected?.attempts.find((attempt) => attempt.number === logTarget?.number);
  const operating = operation ? !!pending[operation.task.id] : false;
  const activeCount = records.filter((task) => taskActive(task.status)).length;

  function toggle(task: TaskRecord) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  }

  function openOperation(task: TaskRecord, action: TaskOperation["action"]) {
    setOperationError("");
    setOperation({ task, action });
  }

  function openLogs(task: TaskRecord, number = task.attempt, taskId: number | null = null) {
    setLogTarget({ id: task.id, number, taskId });
  }

  return <section className={pageContainer}>
    <PageHeader title="全部任务" count={records.length} status={<span className="text-xs text-muted-foreground">{activeCount} 个运行中</span>}
      actions={<Button variant="outline" disabled={loading} onClick={load}>{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}刷新</Button>} />
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative block min-w-64 flex-1"><span className="sr-only">搜索任务</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索任务" className="pl-9" placeholder="搜索项目、工作流编号或任务 ID" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <Select value={kind} onValueChange={(value) => { setKind(value); setPage(1); }}><SelectTrigger aria-label="项目类型筛选" className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部类型</SelectItem>{projectKinds.map((value) => <SelectItem key={value} value={value}>{kindLabels[value]}</SelectItem>)}<SelectItem value="strategy">策略组装</SelectItem></SelectContent></Select>
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger aria-label="任务状态筛选" className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="active">运行中及排队</SelectItem><SelectItem value="success">成功</SelectItem><SelectItem value="failed">失败</SelectItem><SelectItem value="stopped">已终止</SelectItem></SelectContent></Select>
      </div>
      <p className="text-xs text-muted-foreground">展开查看每轮记录和冻结参数 · 状态自动更新</p>
    </div>
    <div className="overflow-hidden rounded-md border bg-card shadow-sm">
      <Table className="min-w-[1100px] table-fixed" aria-label="任务与运行记录">
        <TableHeader><TableRow><TableHead className="w-[27%] px-4">项目 / 研究版本</TableHead><TableHead className="w-32">当前运行</TableHead><TableHead>执行 Task</TableHead><TableHead className="w-20 text-center">运行次数</TableHead><TableHead className="w-44">本轮开始 / 耗时</TableHead><TableHead className="w-52 px-4 text-right">操作</TableHead></TableRow></TableHeader>
        <TableBody>
          {visible.map((task) => <TaskWorkspaceRow key={task.id} task={task} expanded={expanded.has(task.id)} now={now} pending={pending[task.id]}
            onToggle={() => toggle(task)} onLogs={(number, taskId) => openLogs(task, number, taskId)} onOperation={(action) => openOperation(task, action)} />)}
          {!loaded && loading && <TableRow><TableCell colSpan={6}><div className="flex min-h-48 items-center justify-center gap-2 text-muted-foreground"><LoaderCircle className="size-5 animate-spin" />正在读取任务</div></TableCell></TableRow>}
          {(loaded || !loading) && !visible.length && <TableRow><TableCell colSpan={6}><div className="flex min-h-48 items-center justify-center gap-2 text-muted-foreground"><Activity className="size-5" />没有匹配的任务</div></TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">共 {filtered.length} 个任务，历史运行在任务行内展开</p><AppPagination page={safePage} pageSize={pageSize} totalPages={totalPages} onPageChange={setPage} onPageSizeChange={(value) => { setPage(1); setPageSize(value); }} /></div>
    {selected && logTarget && <TaskLogDialog key={`${selected.id}:${logTarget.number}:${logTarget.taskId ?? "latest"}`} description={`${selected.name} · 第 ${logTarget.number} 次运行`}
      apiBase={`/tasks/${selected.id}/attempts/${logTarget.number}`} workflowId={chosen?.workflowId ?? selected.workflowId} taskInstanceId={logTarget.taskId}
      attempts={selected.attempts} attempt={logTarget.number} onAttempt={(number) => setLogTarget({ id: selected.id, number, taskId: null })} onClose={() => setLogTarget(null)} />}
    {operation && <AlertDialog open onOpenChange={(open) => { if (!open && !operating) setOperation(null); }}>
      <AlertDialogContent onEscapeKeyDown={(event) => { if (operating) event.preventDefault(); }}>
        <AlertDialogHeader><AlertDialogTitle>{operation.action === "stop" ? "终止" : "重试"}“{operation.task.name}”？</AlertDialogTitle><AlertDialogDescription>{operation.action === "stop"
          ? "只终止选中的当前运行，不删除冻结输入、成果或历史日志。调度器确认结束前显示终止中。"
          : "使用原冻结参数和依赖开始新一轮；计时从零开始，上一轮的状态、计时和日志继续保留，成功报告不能覆盖。"}</AlertDialogDescription></AlertDialogHeader>
        {operation.action === "retry" && <p className="rounded-md border bg-muted/20 px-3 py-2 text-xs leading-5">{operation.task.checkpoints.length
          ? <>将直接复用已保存阶段：<strong>{operation.task.checkpoints.map((checkpoint) => checkpoint.label).join("、")}</strong>，其余阶段重新运行；成功后自动删除全部检查点。</>
          : "没有可复用的检查点，将从第一个阶段重新运行。"}</p>}
        <p className="font-mono text-xs text-muted-foreground">工作流 #{operation.task.workflowId ?? "—"} · 第 {operation.task.attempt} 次运行</p>
        {operationError && <Alert variant="destructive"><AlertDescription className="whitespace-pre-wrap break-words">{operationError}</AlertDescription></Alert>}
        <AlertDialogFooter><AlertDialogCancel disabled={operating} onClick={() => { if (!operating) setOperation(null); }}>取消</AlertDialogCancel><AlertDialogAction variant={operation.action === "stop" ? "destructive" : "default"} disabled={operating} onClick={async (event) => {
          event.preventDefault();
          if (operating) return;
          setOperationError("");
          try { await control(operation.task, operation.action); setOperation(null); }
          catch (cause) { setOperationError(cause instanceof Error ? cause.message : String(cause)); await load(); }
        }}>{operating && <LoaderCircle className="animate-spin" />}{operating ? "正在提交…" : operation.action === "stop" ? "确认终止" : "确认重试"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>}
  </section>;
}

function TaskWorkspaceRow({ task, expanded, now, pending, onToggle, onLogs, onOperation }: {
  task: TaskRecord;
  expanded: boolean;
  now: number;
  pending?: "stop" | "retry";
  onToggle: () => void;
  onLogs: (number: number, taskId: number | null) => void;
  onOperation: (action: "stop" | "retry") => void;
}) {
  const current = task.attempts.find((attempt) => attempt.number === task.attempt);
  const label = `${task.name}${task.version ? ` v${task.version}` : ""} #${task.workflowId ?? task.id}`;
  return <TableRow className={cn(expanded && "bg-muted/15", "hover:bg-transparent")}>
    <TableCell colSpan={6} className="whitespace-normal p-0">
      <div className="grid grid-cols-[27%_8rem_minmax(0,1fr)_5rem_11rem_13rem] items-center">
        <div className="flex min-w-0 items-start gap-2 px-4 py-4"><Button variant="ghost" size="icon-sm" className="mt-0.5 shrink-0" aria-label={`${expanded ? "收起" : "展开"}任务 ${label}`} aria-expanded={expanded} aria-controls={`task-details-${task.id}`} onClick={onToggle}>{expanded ? <ChevronDown /> : <ChevronRight />}</Button><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="shrink-0 text-[10px]">{task.kind === "strategy" ? "策略组装" : kindLabels[task.kind]}</Badge>{task.version && <span className="font-mono text-xs text-muted-foreground">v{task.version}</span>}</div><Link to={task.href} className="mt-1 block truncate font-medium hover:underline" title={task.name}>{task.name}</Link><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={task.id}>工作流 #{task.workflowId ?? "—"} · {task.note || task.id}</p></div></div>
        <div className="min-w-0 px-2 py-4"><TaskState status={task.status} /><p className="mt-1.5 font-mono text-[10px] text-muted-foreground">第 {task.attempt} 次运行</p>{task.checkpoints.length > 0 && <p className="mt-1 truncate text-[10px] text-primary" title={task.checkpoints.map((checkpoint) => checkpoint.label).join("、")}>检查点 {task.checkpoints.length} 个</p>}</div>
        <div className="min-w-0 px-2 py-4"><TaskCapsules tasks={current?.tasks ?? []} number={task.attempt} onLogs={onLogs} />{task.syncError && <p className="mt-1 break-words text-xs text-amber-700 dark:text-amber-300" title={task.syncError}>同步失败，保留上次状态</p>}</div>
        <div className="px-2 py-4 text-center font-mono text-xs tabular-nums">{task.attempts.length} 次</div>
        <div className="px-2 py-4"><p className="font-mono text-[11px] text-muted-foreground">{formatTime(task.startedAt)}</p><p className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-xs tabular-nums"><Clock3 className="size-3 text-muted-foreground" />{formatDuration(runningSeconds(task, now))}</p></div>
        <div className="flex flex-wrap justify-end gap-1 px-4 py-4"><Button variant="ghost" size="sm" aria-label={`查看运行详情 ${label}`} onClick={onToggle}><Eye />详情</Button><TaskActions task={task} pending={pending} onOperation={onOperation} /></div>
      </div>
      {expanded && <div id={`task-details-${task.id}`} className="border-t bg-muted/15 px-5 py-5"><TaskExpandedPanel task={task} now={now} pending={pending} onLogs={onLogs} onOperation={onOperation} /></div>}
    </TableCell>
  </TableRow>;
}

function TaskExpandedPanel({ task, now, pending, onLogs, onOperation }: {
  task: TaskRecord;
  now: number;
  pending?: "stop" | "retry";
  onLogs: (number: number, taskId: number | null) => void;
  onOperation: (action: "stop" | "retry") => void;
}) {
  const [details, setDetails] = useState<TaskDetails | null>(null);
  const [error, setError] = useState("");
  const [request, setRequest] = useState(0);
  const building = task.status === "building";
  useEffect(() => {
    let active = true;
    setDetails(null);
    setError("");
    client.get<TaskDetails>(`/tasks/${task.id}`)
      .then((result) => { if (active) setDetails(result); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [task.id, task.attempt, building, request]);
  const parameters = details?.parameters;
  return <div className="space-y-5">
    <section aria-label={`${task.name} 运行历史`}>
      <h3 className="mb-3 text-sm font-semibold">运行记录 <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{task.attempts.length} 次</span></h3>
      <div className="overflow-hidden rounded-md border bg-background"><Table className="min-w-[1000px] table-fixed"><TableHeader><TableRow><TableHead className="w-24 pl-4">轮次</TableHead><TableHead className="w-32">状态</TableHead><TableHead>执行 Task</TableHead><TableHead className="w-40">开始</TableHead><TableHead className="w-40">完成</TableHead><TableHead className="w-24">耗时</TableHead><TableHead className="w-48 pr-4 text-right">操作</TableHead></TableRow></TableHeader><TableBody>
        {task.attempts.map((attempt) => <TableRow key={attempt.id}><TableCell className="pl-4 font-mono text-xs">第 {attempt.number} 次{attempt.number === task.attempt && <span className="mt-1 block text-[10px] text-primary">当前</span>}</TableCell><TableCell><TaskState status={attempt.status} /></TableCell><TableCell className="whitespace-normal"><TaskCapsules tasks={attempt.tasks} number={attempt.number} onLogs={onLogs} />{attempt.error && <p className="mt-1.5 break-words text-xs text-destructive">{attempt.error}</p>}</TableCell><TableCell className="font-mono text-[11px] text-muted-foreground">{formatTime(attempt.startedAt)}</TableCell><TableCell className="font-mono text-[11px] text-muted-foreground">{formatTime(attempt.finishedAt)}</TableCell><TableCell className="font-mono text-xs tabular-nums">{formatDuration(runningSeconds(attempt, now))}</TableCell><TableCell className="pr-4"><div className="flex flex-wrap justify-end gap-1"><Button variant="ghost" size="sm" aria-label={`查看第 ${attempt.number} 次运行日志 ${task.name}`} onClick={() => onLogs(attempt.number, null)}><Terminal />日志</Button>{attempt.number === task.attempt && <TaskActions task={task} pending={pending} onOperation={onOperation} />}</div></TableCell></TableRow>)}
      </TableBody></Table></div>
    </section>
    <section aria-label={`${task.name} 阶段检查点`} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">阶段检查点</h3><p className="text-xs text-muted-foreground">失败或终止后重试时直接复用，运行成功后全部删除</p></div>
      {task.checkpoints.length
        ? <div className="flex flex-wrap gap-2">{task.checkpoints.map((checkpoint) => <div key={checkpoint.stage} className="rounded-md border bg-background px-3 py-2 text-xs"><p className="font-medium">{checkpoint.label}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{formatTime(checkpoint.createdAt)} · {formatBytes(checkpoint.bytes)}</p></div>)}</div>
        : <p className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">{task.status === "success" ? "运行已成功，检查点已删除" : "暂无已完成阶段的检查点"}</p>}
    </section>
    <section aria-label={`${task.name} 冻结运行参数`} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">冻结运行详情</h3><p className="text-xs text-muted-foreground">来自本次任务的 input.json 与锁文件，重试沿用同一份输入</p></div>
      {error && <Alert variant="destructive"><AlertDescription className="flex items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => setRequest((value) => value + 1)}>重新读取详情</Button></AlertDescription></Alert>}
      {!details && !error && <div className="flex min-h-24 items-center justify-center gap-2 rounded-md border bg-background text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在读取冻结参数</div>}
      {parameters && !parameters.available && <Alert><AlertDescription>{parameters.error}<Button className="ml-3" size="sm" variant="outline" onClick={() => setRequest((value) => value + 1)}>重新读取</Button></AlertDescription></Alert>}
      {parameters?.available && <Tabs defaultValue="run" className="rounded-md border bg-background p-4"><TabsList scrollable><TabsTrigger value="run">运行参数</TabsTrigger><TabsTrigger value="algorithms">算法参数</TabsTrigger><TabsTrigger value="dependencies">依赖版本（{parameters.dependencies.length}）</TabsTrigger><TabsTrigger value="input">Input JSON</TabsTrigger></TabsList>
        <TabsContent value="run" className="space-y-3 pt-3"><p className="text-xs text-muted-foreground">日期区间 {parameters.dateInterval}：{parameters.dateInterval === "[start,end]" ? "包含结束日" : "不包含结束日"}。以下为提交任务时冻结的原始值。</p><ParameterRows value={parameters.run} /></TabsContent>
        <TabsContent value="algorithms" className="space-y-4 pt-3">
          {Object.entries(parameters.algorithms).map(([stage, algorithm]) => <section key={stage} className="rounded-md border p-4"><div className="mb-3 flex flex-wrap items-center gap-2"><Badge variant="secondary">{stageName(stage)}</Badge><span className="font-mono text-xs">{algorithm.package} {algorithm.version}</span></div>{algorithm.entry && <p className="mb-3 break-all font-mono text-xs text-muted-foreground">{algorithm.entry}</p>}{algorithm.parameterSource === "component" ? <ParameterRows value={algorithm.params ?? {}} empty="该组件的冻结参数为空" /> : <p className="text-xs text-muted-foreground">此算法从统一回测参数中读取所需字段；共用算法参数列在下方，完整值见运行参数。</p>}</section>)}
          {Object.values(parameters.algorithms).some((algorithm) => algorithm.parameterSource === "shared") && <section className="rounded-md border p-4"><h4 className="mb-3 text-xs font-semibold">共用算法参数</h4><ParameterRows value={parameters.sharedAlgorithmParameters} empty="没有额外的共用算法字段，日期、股票池及回测设置见运行参数" /></section>}
        </TabsContent>
        <TabsContent value="dependencies" className="pt-3"><div className="max-h-80 overflow-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>依赖包</TableHead><TableHead>锁定版本</TableHead></TableRow></TableHeader><TableBody>{parameters.dependencies.map((dependency) => <TableRow key={dependency.name}><TableCell className="font-mono text-xs">{dependency.name}</TableCell><TableCell className="font-mono text-xs">{dependency.version}</TableCell></TableRow>)}</TableBody></Table></div></TabsContent>
        <TabsContent value="input" className="pt-3"><pre aria-label="冻结 Input JSON" className="max-h-96 overflow-auto rounded-md border bg-muted/15 p-4 font-mono text-xs leading-6">{JSON.stringify(parameters.input, null, 2)}</pre></TabsContent>
      </Tabs>}
    </section>
  </div>;
}

function TaskActions({ task, pending, onOperation }: { task: TaskRecord; pending?: "stop" | "retry"; onOperation: (action: "stop" | "retry") => void }) {
  return <>{task.canStop && <Button variant="destructive" size="sm" disabled={!!pending} aria-label={`终止任务 ${task.name} 第 ${task.attempt} 次`} onClick={() => onOperation("stop")}>{pending ? <LoaderCircle className="animate-spin" /> : <Square />}{task.status === "stopping" ? "确认终止" : "终止"}</Button>}{task.canRetry && <Button variant="outline" size="sm" disabled={!!pending} aria-label={`重试任务 ${task.name} 第 ${task.attempt} 次`} onClick={() => onOperation("retry")}>{pending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}重试</Button>}</>;
}

function TaskCapsules({ tasks, number, onLogs }: { tasks: WorkflowTaskInformation[]; number: number; onLogs: (number: number, taskId: number | null) => void }) {
  if (!tasks.length) return <span className="text-xs text-muted-foreground">等待本轮 Task</span>;
  return <div className="flex flex-wrap gap-1.5">{tasks.map((task) => <div key={task.task_instance_id ?? task.name} className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1.5"><span className="truncate text-xs font-medium">{task.name}</span><SchedulerState state={task.state} className="text-[10px]" />{task.task_instance_id !== null && <Button size="icon-sm" variant="ghost" className="size-6 shrink-0" title={`第 ${number} 次运行 · Task #${task.task_instance_id}`} aria-label={`查看 Task ${task.task_instance_id} 日志`} onClick={() => onLogs(number, task.task_instance_id)}><Terminal className="size-3" /></Button>}</div>)}</div>;
}

function TaskState({ status }: { status: TaskStatus }) {
  return <Badge variant="outline" className="status-badge whitespace-nowrap" data-status={status}>{taskStatusLabels[status]}</Badge>;
}

function matchesStatus(status: TaskStatus, filter: string) {
  if (filter === "all") return true;
  if (filter === "active") return taskActive(status);
  if (filter === "failed") return status === "failed" || status === "submit_failed";
  return status === filter;
}

function runningSeconds(value: Pick<TaskAttempt, "status" | "startedAt" | "finishedAt" | "durationSeconds">, now: number) {
  if (value.finishedAt || !value.startedAt || !["running", "stopping"].includes(value.status)) return value.durationSeconds;
  const start = Date.parse(value.startedAt);
  return Number.isFinite(start) ? Math.max(0, (now - start) / 1000) : value.durationSeconds;
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return unit ? `${size.toFixed(1)} ${units[unit]}` : `${size} B`;
}

function stageName(stage: string) {
  if (stage === "factor") return "因子算法";
  return kindLabels[stage as keyof typeof kindLabels] ?? stage;
}

const parameterLabels: Record<string, string> = {
  start: "开始日期", end: "结束日期", "universe.pool": "股票池", groups: "分组数量", period: "持有期（交易日）",
  price_column: "收益价格字段", max_lag: "最大延迟阶数", n_select: "极端组合数量", weight: "加权方式",
  columns: "因子列", calendar_symbol: "交易日历基准", benchmark: "收益基准", market_data: "行情类型", batch_days: "每批交易日数"
};

function parameterRows(value: Record<string, unknown>, prefix = ""): [string, unknown][] {
  return Object.entries(value).flatMap(([key, item]): [string, unknown][] => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item !== null && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length) return parameterRows(item as Record<string, unknown>, path);
    return [[path, item]];
  });
}

function parameterValue(value: unknown) {
  if (value === null || value === undefined) return "未设置";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join("、") : "空列表";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ParameterRows({ value, empty = "没有运行参数" }: { value: Record<string, unknown>; empty?: string }) {
  const rows = parameterRows(value);
  if (!rows.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return <dl className="grid grid-cols-1 gap-x-6 md:grid-cols-2">{rows.map(([name, item]) => <div key={name} className="grid min-w-0 grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.2fr)] gap-3 border-b py-2.5 text-xs"><dt className="break-words text-muted-foreground" title={name}>{parameterLabels[name] ?? name}</dt><dd className="min-w-0 whitespace-pre-wrap break-words font-mono">{parameterValue(item)}</dd></div>)}</dl>;
}
