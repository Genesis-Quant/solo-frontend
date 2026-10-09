import { useCallback, useMemo, useState } from "react";
import { FolderOpen, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { RequestError } from "@/assets/lib/requestError";
import ProjectDialog from "@/components/modal/ProjectDialog";
import ProjectDataTable, { type ProjectTableColumn } from "@/components/table/ProjectDataTable";
import { useProjectTable } from "@/hooks/useProjectTable";
import { PageHeader, pageContainer } from "@/components/bar/PageHeader";
import { usePageState } from "@/store/pageMemory";
import { useResearchStore } from "@/store/research";
import { kindLabels, publishLabels, runLabels, type ProjectKind, type ResearchProject } from "@/types/research";
import { Alert, AlertDescription } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/ui/dropdown-menu";
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

type ProjectSort = "name" | "version" | "status" | "publishStatus" | "updatedAt";
const projectHref = (project: ResearchProject) => `/projects/${project.id}`;

export default function ProjectsPage({ kind }: { kind: ProjectKind }) {
  const navigate = useNavigate();
  const projects = useResearchStore((state) => state.projects).filter((p) => p.kind === kind && !p.archived);
  const remove = useResearchStore((state) => state.removeProject);
  const scope = `projects:${kind}`;
  const [search, setSearch] = usePageState(scope, "search", "");
  const [status, setStatus] = usePageState(scope, "status", "all");
  const [form, setForm] = useState<ResearchProject | "new" | null>(null);
  const [deleting, setDeleting] = useState<ResearchProject | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(true);
  const [deleteError, setDeleteError] = useState("");
  const [cleanupPending, setCleanupPending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const openDelete = useCallback((project: ResearchProject) => {
    setDeleteFiles(true);
    setDeleteError("");
    setCleanupPending(false);
    // Keep this snapshot and UUID even when polling removes a partially deleted row.
    setDeleting(project);
  }, []);
  const closeDelete = useCallback(() => {
    setDeleting(null);
    setDeleteFiles(true);
    setDeleteError("");
    setCleanupPending(false);
  }, []);
  const columns = useMemo<ProjectTableColumn<ResearchProject, ProjectSort>[]>(() => [
    { id: "name", label: "项目", size: 280, sortKey: "name", value: (p) => p.name,
      cell: (p, href) => <><Link to={href} className="block truncate rounded-sm font-medium group-hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" title={p.name}>{p.name}</Link>{p.retired && <Badge variant="outline" className="mt-1" title={p.retiredReason ?? undefined}>已退役</Badge>}<p className="mt-1 truncate text-xs text-muted-foreground" title={p.description}>{p.description || "—"}</p></> },
    { id: "version", label: "最新版本", size: 112, sortKey: "version", value: (p) => p.versions[0]?.number ?? 0,
      cell: (p) => <Badge variant="secondary" className="tabular-nums">{p.versions[0] ? `v${p.versions[0].number}` : "—"}</Badge> },
    { id: "status", label: "研究状态", size: 120, sortKey: "status", value: (p) => p.versions[0]?.status,
      cell: (p) => <Badge variant="outline" data-status={p.versions[0]?.status ?? "empty"} className="status-badge whitespace-nowrap">{p.versions[0] ? runLabels[p.versions[0].status] : "未提交"}</Badge> },
    { id: "publishStatus", label: "发布状态", size: 120, sortKey: "publishStatus", value: (p) => p.versions[0]?.publishStatus,
      cell: (p) => p.versions[0] ? <Badge variant="secondary" className={p.versions[0].publishStatus === "published" ? "bg-primary/10 text-primary" : ""}>{publishLabels[p.versions[0].publishStatus]}</Badge> : "—" },
    { id: "updatedAt", label: "更新时间", size: 180, sortKey: "updatedAt", value: (p) => p.updatedAt, className: "tabular-nums text-muted-foreground" },
    { id: "actions", label: "操作", size: 72, align: "right", value: (p) => p.id,
      cell: (p) => <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`${p.name}操作`}><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild><Link to={`/projects/${p.id}`}><FolderOpen />打开项目</Link></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setForm(p)}><Pencil />编辑项目</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => openDelete(p)}><Trash2 />删除项目</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div> }
  ], [openDelete]);
  const filtered = projects.filter((p) => `${p.name} ${p.description} ${p.id}`.toLowerCase().includes(search.toLowerCase()) && (status === "all" || (p.versions[0]?.status ?? "empty") === status));
  const { resetPage, ...table } = useProjectTable(scope, filtered, columns, "updatedAt");
  const changeSearch = useCallback((value: string) => { setSearch(value); resetPage(); }, [resetPage, setSearch]);
  return (
    <section className={pageContainer}>
      <PageHeader title={kindLabels[kind]} count={projects.length} actions={<Button onClick={() => setForm("new")}><Plus />新建项目</Button>} />
      <ProjectDataTable key={scope} {...table} columns={columns} loading={false} emptyMessage={status === "all" ? "暂无研究项目" : "没有符合筛选条件的项目"} rowHref={projectHref} onOpen={(p) => navigate(`/projects/${p.id}`)}
        search={{ value: search, onChange: changeSearch, placeholder: "搜索项目名称、描述或 ID" }}
        filters={<Select value={status} onValueChange={(value) => { setStatus(value); resetPage(); }}>
          <SelectTrigger className="w-36" aria-label="研究状态筛选"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="success">研究成功</SelectItem><SelectItem value="running">运行中</SelectItem><SelectItem value="failed">研究失败</SelectItem><SelectItem value="empty">未提交</SelectItem></SelectContent>
        </Select>} />
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
          if (!open && !removing) closeDelete();
        }}
      >
        <AlertDialogContent onEscapeKeyDown={(event) => { if (removing) event.preventDefault(); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{deleting?.name}”？</AlertDialogTitle>
            <AlertDialogDescription>
              项目、研究版本、任务、运行资源和报告将永久删除，无法恢复。已发布成果及独立下游项目、策略的冻结依赖继续保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                id="delete-project-files"
                type="checkbox"
                className="peer size-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                checked={deleteFiles}
                disabled={removing || cleanupPending}
                aria-describedby="delete-project-directory delete-project-files-warning"
                onChange={(event) => setDeleteFiles(event.target.checked)}
              />
              <Label htmlFor="delete-project-files" className="leading-normal">同时删除 Jupyter 中的项目文件夹</Label>
            </div>
            <p id="delete-project-directory" className="text-sm text-muted-foreground">
              项目文件夹：<code className="whitespace-pre-wrap break-all">{deleting?.directory}</code>
            </p>
            <p id="delete-project-files-warning" className="text-sm text-muted-foreground">
              此选项仅控制项目工作区。勾选后将永久删除该文件夹中的项目源码、虚拟环境和 notebooks，无法恢复；不勾选仅保留项目文件夹，仍删除项目记录、研究版本、任务、运行资源和报告。保留的文件夹可能阻止同名项目重新创建。
            </p>
          </div>
          {deleteError && <Alert variant="destructive"><AlertDescription>{deleteError}{cleanupPending && <p>项目记录已删除，部分资源尚未清理。请重试清理原项目；不会删除后来新建的同名项目。</p>}</AlertDescription></Alert>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={removing}
              onClick={async (event) => {
                event.preventDefault();
                if (!deleting || removing) return;
                setRemoving(true);
                setDeleteError("");
                try {
                  await remove(deleting.id, deleteFiles);
                  closeDelete();
                } catch (cause) {
                  setDeleteError(cause instanceof Error ? cause.message : "删除失败");
                  if (cause instanceof RequestError && cause.deleted === true && cause.id === deleting.id) setCleanupPending(true);
                } finally { setRemoving(false); }
              }}
            >
              {removing ? "删除中…" : cleanupPending ? "重试清理" : "删除项目"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
