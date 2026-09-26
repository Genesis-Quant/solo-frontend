import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ListTodo,
  Search,
  Terminal
} from "lucide-react";
import { Link } from "react-router-dom";

import TaskLogDialog from "@/components/modal/TaskLogDialog";
import { client } from "@/assets/lib/request";
import type { StrategyRecord } from "@/types/strategy";
import { Alert, AlertDescription } from "@/ui/alert";
import { useResearchStore } from "@/store/research";
import {
  kindLabels,
  projectKinds,
  runLabels,
  type RunStatus
} from "@/types/research";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/ui/empty";
import { Input } from "@/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

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

export default function TasksPage() {
  const projects = useResearchStore((state) => state.projects);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await client.get<StrategyRecord[]>("/strategies");
        if (active) { setStrategies(result); setError(""); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (active) timer = setTimeout(() => void load(), 5000); }
    }
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, []);
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
      stateLabel: ({ building: "组装中", queued: "排队中", running: "运行中", success: "回测成功", failed: "回测失败" } as Record<string, string>)[strategy.status] ?? strategy.status,
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
    )
    .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
  const totalPages = Math.max(1, Math.ceil(tasks.length / 10));
  const currentPage = Math.min(page, totalPages);
  return (
    <section className="mx-auto max-w-[1600px] space-y-6 p-5 md:p-8">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">全部任务</h1>
        <Badge variant="secondary">{tasks.length}</Badge>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>策略任务加载失败：{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label="搜索任务"
            placeholder="搜索项目或工作流编号"
            className="bg-card pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={kind}
          onValueChange={(value) => {
            setKind(value);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="项目类型筛选" className="w-36 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {projectKinds.map((item) => (
              <SelectItem key={item} value={item}>
                {kindLabels[item]}
              </SelectItem>
            ))}
            <SelectItem value="strategy">策略组装</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="任务状态筛选" className="w-36 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="success">已成功</SelectItem>
            <SelectItem value="running">运行中</SelectItem>
            <SelectItem value="failed">已失败</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="pl-5">工作流</TableHead>
              <TableHead className="min-w-48">项目 / 策略</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>开始时间</TableHead>
              <TableHead>耗时</TableHead>
              <TableHead className="w-14">
                <span className="sr-only">日志</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks
              .slice((currentPage - 1) * 10, currentPage * 10)
              .map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="pl-5 font-mono text-xs text-muted-foreground">
                    {task.workflowId ? `#${task.workflowId}` : "—"}
                  </TableCell>
                  <TableCell className="py-4">
                    <Link
                      className="font-medium hover:text-primary hover:underline"
                      to={task.href}
                    >
                      {task.name}
                    </Link>
                    <p className="mt-1 max-w-96 truncate text-xs text-muted-foreground" title={task.note}>
                      {task.note}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {task.kindLabel}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      data-status={task.status}
                      className="status-badge whitespace-nowrap"
                    >
                      {task.stateLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {new Date(task.submittedAt).toLocaleString("zh-CN", { hour12: false })}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {task.duration}
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`查看工作流 ${task.workflowId ?? task.name} 日志`}
                          onClick={() => setSelectedId(task.id)}
                        >
                          <Terminal />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>查看日志</TooltipContent>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        {!tasks.length && (
          <Empty className="py-20">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListTodo />
              </EmptyMedia>
              <EmptyTitle>没有匹配的任务</EmptyTitle>
            </EmptyHeader>
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setKind("all");
                setStatus("all");
                setPage(1);
              }}
            >
              清除筛选
            </Button>
          </Empty>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>共 {tasks.length} 条任务</span>
        <div className="flex items-center gap-3">
          <span>
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="上一页"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="下一页"
            disabled={currentPage === totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      {selected && (
        <TaskLogDialog
          description={selected.name}
          apiBase={selected.apiBase}
          workflowId={selected.workflowId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  );
}
