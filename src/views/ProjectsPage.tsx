import { useState } from "react";
import {
  ArrowUpRight,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2
} from "lucide-react";
import { Link } from "react-router-dom";

import ProjectDialog from "@/components/modal/ProjectDialog";
import { Alert, AlertDescription } from "@/ui/alert";
import { useResearchStore } from "@/store/research";
import {
  kindLabels,
  publishLabels,
  runLabels,
  type ProjectKind,
  type ResearchProject
} from "@/types/research";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@/ui/empty";
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

export default function ProjectsPage({ kind }: { kind: ProjectKind }) {
  const projects = useResearchStore((state) => state.projects).filter(
    (p) => p.kind === kind && !p.archived
  );
  const remove = useResearchStore((state) => state.removeProject);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState<ResearchProject | "new" | null>(null);
  const [deleting, setDeleting] = useState<ResearchProject | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [removing, setRemoving] = useState(false);
  const filtered = projects.filter(
    (p) =>
      `${p.name} ${p.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (status === "all" || (p.versions[0]?.status ?? "empty") === status)
  );
  return (
    <section className="mx-auto max-w-[1600px] space-y-6 p-5 md:p-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{kindLabels[kind]}</h1>
          <Badge variant="secondary" className="tabular-nums">
            {projects.length}
          </Badge>
        </div>
        <Button onClick={() => setForm("new")}>
          <Plus />
          新建项目
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label="搜索项目"
            placeholder="搜索项目名称或描述"
            className="bg-card pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36 bg-card" aria-label="研究状态筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="success">研究成功</SelectItem>
            <SelectItem value="running">运行中</SelectItem>
            <SelectItem value="failed">研究失败</SelectItem>
            <SelectItem value="empty">未提交</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {deleteError && <Alert variant="destructive"><AlertDescription>{deleteError}</AlertDescription></Alert>}
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="min-w-64 pl-5">项目</TableHead>
              <TableHead>最新版本</TableHead>
              <TableHead>研究状态</TableHead>
              <TableHead>发布状态</TableHead>
              <TableHead className="whitespace-nowrap">更新时间</TableHead>
              <TableHead className="w-14">
                <span className="sr-only">项目操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((project) => {
              const latest = project.versions[0];
              return (
                <TableRow key={project.id}>
                  <TableCell className="py-5 pl-5">
                    <Link
                      className="inline-flex items-center gap-2 font-medium hover:text-primary hover:underline"
                      to={`/projects/${project.id}`}
                    >
                      {project.name}
                      <ArrowUpRight className="size-3.5 text-muted-foreground" />
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {project.description || "—"}
                    </p>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {latest ? `v${latest.number}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      data-status={latest?.status}
                      className="status-badge whitespace-nowrap"
                    >
                      {latest ? runLabels[latest.status] : "未提交"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {latest
? (
                      <Badge
                        variant="secondary"
                        className={
                          latest.publishStatus === "published"
                            ? "bg-primary/10 text-primary"
                            : ""
                        }
                      >
                        {publishLabels[latest.publishStatus]}
                      </Badge>
                    )
:
                      "—"
                    }
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {project.updatedAt}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${project.name}操作`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to={`/projects/${project.id}`}>
                            <FolderOpen />
                            打开项目
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setForm(project)}>
                          <Pencil />
                          编辑项目
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleting(project)}
                        >
                          <Trash2 />
                          删除项目
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {filtered.length === 0 && (
          <Empty className="py-20">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpen />
              </EmptyMedia>
              <EmptyTitle>
                {projects.length ? "没有匹配的项目" : "暂无项目"}
              </EmptyTitle>
              <EmptyDescription>
                {projects.length
                  ? "调整搜索条件后重试"
                  : "创建你的第一个研究项目"}
              </EmptyDescription>
            </EmptyHeader>
            <Button
              variant="outline"
              onClick={() => {
                if (projects.length) {
                  setSearch("");
                  setStatus("all");
                } else setForm("new");
              }}
            >
              {projects.length ? "清除筛选" : "新建项目"}
            </Button>
          </Empty>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        共 {filtered.length} 个项目
      </p>
      {form && (
        <ProjectDialog
          kind={kind}
          project={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
        />
      )}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{deleting?.name}”？</AlertDialogTitle>
            <AlertDialogDescription>
              项目将从列表移除，已有研究版本、包和报告继续保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={removing}
              onClick={async (event) => {
                event.preventDefault();
                if (!deleting || removing) return;
                setRemoving(true);
                setDeleteError("");
                try {
                  await remove(deleting.id);
                  setDeleting(null);
                } catch (cause) {
                  setDeleteError(cause instanceof Error ? cause.message : "删除失败");
                  setDeleting(null);
                } finally { setRemoving(false); }
              }}
            >
              删除项目
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
