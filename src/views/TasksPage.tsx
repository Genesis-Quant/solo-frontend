import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ListTodo,
  Search,
  Terminal
} from "lucide-react";
import { Link } from "react-router-dom";

import TaskLogDialog from "@/components/TaskLogDialog";
import { useResearchStore } from "@/store/research";
import {
  kindLabels,
  projectKinds,
  runLabels,
  type ResearchProject,
  type ResearchVersion
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

export default function TasksPage() {
  const projects = useResearchStore((state) => state.projects);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{
    project: ResearchProject;
    version: ResearchVersion;
  } | null>(null);
  const tasks = projects
    .flatMap((project) =>
      project.versions.map((version) => ({ project, version }))
    )
    .filter(
      ({ project, version }) =>
        (kind === "all" || kind === project.kind) &&
        (status === "all" || status === version.status) &&
        `${project.name} ${version.workflowId}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
    )
    .sort((a, b) => b.version.submittedAt.localeCompare(a.version.submittedAt));
  const totalPages = Math.max(1, Math.ceil(tasks.length / 10));
  const currentPage = Math.min(page, totalPages);
  return (
    <section className="mx-auto max-w-[1600px] space-y-6 p-5 md:p-8">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">全部任务</h1>
        <Badge variant="secondary">{tasks.length}</Badge>
      </div>
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
            <SelectItem value="success">研究成功</SelectItem>
            <SelectItem value="running">运行中</SelectItem>
            <SelectItem value="failed">研究失败</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="pl-5">工作流</TableHead>
              <TableHead className="min-w-48">项目 / 版本</TableHead>
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
              .map(({ project, version }) => (
                <TableRow key={version.id}>
                  <TableCell className="pl-5 font-mono text-xs text-muted-foreground">
                    #{version.workflowId}
                  </TableCell>
                  <TableCell className="py-4">
                    <Link
                      className="font-medium hover:text-primary hover:underline"
                      to={`/projects/${project.id}?version=${version.id}`}
                    >
                      {project.name}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      v{version.number} · {version.note}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {kindLabels[project.kind]}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      data-status={version.status}
                      className="status-badge whitespace-nowrap"
                    >
                      {runLabels[version.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {version.submittedAt}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {version.duration}
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`查看工作流 ${version.workflowId} 日志`}
                          onClick={() => setSelected({ project, version })}
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
          project={selected.project}
          version={selected.version}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
