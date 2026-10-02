import { useCallback, useMemo, useState } from "react";
import { Terminal } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import TaskLogDialog from "@/components/modal/TaskLogDialog";
import ProjectDataTable, { type ProjectTableColumn } from "@/components/table/ProjectDataTable";
import { useProjectTable } from "@/hooks/useProjectTable";
import { PageHeader, pageContainer } from "@/components/bar/PageHeader";
import { usePageState } from "@/store/pageMemory";
import { useStrategyPolling, useStrategyStore } from "@/store/strategy";
import { strategyStatus } from "@/types/strategy";
import { Alert, AlertDescription } from "@/ui/alert";
import { useResearchStore } from "@/store/research";
import { kindLabels, projectKinds, runLabels, type RunStatus } from "@/types/research";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

type TaskSort = "workflowId" | "name" | "kind" | "status" | "submittedAt" | "duration";
const scope = "tasks";

interface TaskRow {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  status: RunStatus;
  stateLabel: string;
  workflowId: number | null;
  submittedAt: string;
  duration: string;
  note: string;
  href: string;
  apiBase: string;
}

const taskHref = (task: TaskRow) => task.href;

export default function TasksPage() {
  const projects = useResearchStore((state) => state.projects);
  const strategies = useStrategyStore((state) => state.records);
  const error = useStrategyStore((state) => state.error);
  const [search, setSearch] = usePageState(scope, "search", "");
  const [kind, setKind] = usePageState(scope, "kind", "all");
  const [status, setStatus] = usePageState(scope, "status", "all");
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useStrategyPolling();
  const allTasks: TaskRow[] = [
    ...projects.flatMap((project) => project.versions.map((version) => ({
      id: version.id, name: project.name, kind: project.kind, kindLabel: kindLabels[project.kind],
      status: version.status, stateLabel: runLabels[version.status], workflowId: version.workflowId,
      submittedAt: version.submittedAt, duration: version.duration, note: `v${version.number} · ${version.note}`,
      href: `/projects/${project.id}?version=${version.id}`, apiBase: `/projects/${project.id}/versions/${version.id}`
    }))),
    ...strategies.map((strategy): TaskRow => ({
      id: strategy.id, name: strategy.name, kind: "strategy", kindLabel: "策略组装",
      status: strategy.status === "success" || strategy.status === "failed" ? strategy.status : "running",
      stateLabel: strategyStatus[strategy.status] ?? strategy.status,
      workflowId: strategy.workflowId, submittedAt: strategy.createdAt, duration: strategy.duration,
      note: Object.values(strategy.components).map((component) => component.label).join(" → "),
      href: `/strategies/${strategy.id}`, apiBase: `/strategies/${strategy.id}`
    }))
  ];
  const selected = allTasks.find((task) => task.id === selectedId);
  const tasks = allTasks
    .filter(
      (task) =>
        (kind === "all" || kind === task.kind) &&
        (status === "all" || status === task.status) &&
        `${task.name} ${task.workflowId ?? ""}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
    );
  const columns = useMemo<ProjectTableColumn<TaskRow, TaskSort>[]>(() => [
    { id: "workflowId", label: "工作流", size: 100, sortKey: "workflowId", value: (t) => t.workflowId ?? 0,
      cell: (t) => t.workflowId ? `#${t.workflowId}` : "—", className: "font-mono text-xs text-muted-foreground" },
    { id: "name", label: "项目 / 策略", size: 300, sortKey: "name", value: (t) => t.name,
      cell: (t, href) => <><Link to={href} className="block truncate rounded-sm font-medium group-hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" title={t.name}>{t.name}</Link><p className="mt-1 truncate text-xs text-muted-foreground" title={t.note}>{t.note}</p></> },
    { id: "kind", label: "类型", size: 120, sortKey: "kind", value: (t) => t.kindLabel },
    { id: "status", label: "状态", size: 120, sortKey: "status", value: (t) => t.stateLabel,
      cell: (t) => <Badge variant="outline" data-status={t.status} className="status-badge whitespace-nowrap">{t.stateLabel}</Badge> },
    { id: "submittedAt", label: "开始时间", size: 190, sortKey: "submittedAt", value: (t) => Date.parse(t.submittedAt),
      cell: (t) => new Date(t.submittedAt).toLocaleString("zh-CN", { hour12: false }), className: "tabular-nums text-muted-foreground" },
    { id: "duration", label: "耗时", size: 100, sortKey: "duration", value: (t) => Number.parseFloat(t.duration) || 0,
      cell: (t) => t.duration, className: "font-mono text-xs text-muted-foreground" },
    { id: "actions", label: "日志", size: 72, align: "right", value: (t) => t.id,
      cell: (t) => <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><Tooltip><TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`查看工作流 ${t.workflowId ?? t.name} 日志`} onClick={() => setSelectedId(t.id)}><Terminal /></Button>
      </TooltipTrigger><TooltipContent>查看日志</TooltipContent></Tooltip></div> }
  ], []);
  const { resetPage, ...table } = useProjectTable(scope, tasks, columns, "submittedAt");
  const changeSearch = useCallback((value: string) => { setSearch(value); resetPage(); }, [resetPage, setSearch]);
  return (
    <section className={pageContainer}>
      <PageHeader title="全部任务" count={allTasks.length} />
      {error && <Alert variant="destructive"><AlertDescription>策略任务加载失败：{error}</AlertDescription></Alert>}
      <ProjectDataTable {...table} columns={columns} loading={false} emptyMessage="没有匹配的任务" rowHref={taskHref} onOpen={(task) => navigate(task.href)}
        search={{ value: search, onChange: changeSearch, placeholder: "搜索项目或工作流编号", label: "搜索任务" }}
        filters={<>
          <Select value={kind} onValueChange={(value) => { setKind(value); resetPage(); }}>
            <SelectTrigger aria-label="项目类型筛选" className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">全部类型</SelectItem>{projectKinds.map((item) => <SelectItem key={item} value={item}>{kindLabels[item]}</SelectItem>)}<SelectItem value="strategy">策略组装</SelectItem></SelectContent>
          </Select>
          <Select value={status} onValueChange={(value) => { setStatus(value); resetPage(); }}>
            <SelectTrigger aria-label="任务状态筛选" className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="success">已成功</SelectItem><SelectItem value="running">运行中</SelectItem><SelectItem value="failed">已失败</SelectItem></SelectContent>
          </Select>
        </>} />
      {selected && <TaskLogDialog description={selected.name} apiBase={selected.apiBase} workflowId={selected.workflowId} onClose={() => setSelectedId(null)} />}
    </section>
  );
}
