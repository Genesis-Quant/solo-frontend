import { useCallback, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { artifactSize, artifactWheelUrl } from "@/assets/lib/artifacts";
import { RequestError } from "@/assets/lib/requestError";
import { PageHeader, pageContainer } from "@/components/bar/PageHeader";
import ProjectDataTable, { type ProjectTableColumn } from "@/components/table/ProjectDataTable";
import { useProjectTable } from "@/hooks/useProjectTable";
import { usePublishedArtifacts } from "@/hooks/usePublishedArtifacts";
import { usePageState } from "@/store/pageMemory";
import type { ResearchArtifact } from "@/types/artifact";
import { kindLabels, projectKinds } from "@/types/research";
import { Alert, AlertDescription } from "@/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/ui/alert-dialog";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

type ArtifactSort = "package" | "kind" | "version" | "schemeVersion" | "source" | "publishedAt";
const scope = "artifacts";
const wheelHref = (artifact: ResearchArtifact) => artifactWheelUrl(artifact.id);

export default function ArtifactsPage() {
  const { artifacts, loaded, refreshing, error, reload, remove } = usePublishedArtifacts();
  const [search, setSearch] = usePageState(scope, "search", "");
  const [kind, setKind] = usePageState(scope, "kind", "all");
  const [deleting, setDeleting] = useState<ResearchArtifact | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [cleanupPending, setCleanupPending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const deletePending = useRef(false);
  const openDelete = useCallback((artifact: ResearchArtifact) => {
    if (deletePending.current) return;
    setDeleteError("");
    setCleanupPending(false);
    // Never retarget a confirmation when the catalog replaces or removes its row.
    setDeleting({ ...artifact });
  }, []);
  const closeDelete = useCallback(() => {
    if (deletePending.current) return;
    setDeleting(null);
    setDeleteError("");
    setCleanupPending(false);
  }, []);
  const releases = artifacts.filter((artifact) => !!artifact.publishedAt);
  const filtered = releases.filter((artifact) => (kind === "all" || artifact.kind === kind)
    && `${artifact.package} ${artifact.version} ${artifact.filename} ${artifact.sourceProjectName ?? ""} ${artifact.id} ${artifact.sha256}`.toLowerCase().includes(search.toLowerCase()));
  const columns = useMemo<ProjectTableColumn<ResearchArtifact, ArtifactSort>[]>(() => [
    { id: "package", label: "已发布包", size: 300, sortKey: "package", value: (artifact) => artifact.package,
      cell: (artifact, href) => <><a href={href} download className="block truncate rounded-sm font-medium hover:underline focus-visible:underline" title={artifact.filename}>{artifact.package}</a><p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={`SHA256 ${artifact.sha256}`}>{artifact.filename} · {artifactSize(artifact.size ?? artifact.sizeBytes)}</p>{artifact.retired && <Badge variant="outline" className="mt-1" title={artifact.retiredReason ?? undefined}>已退役</Badge>}</> },
    { id: "kind", label: "类型", size: 120, sortKey: "kind", value: (artifact) => kindLabels[artifact.kind] },
    { id: "version", label: "包版本", size: 110, sortKey: "version", value: (artifact) => artifact.version, className: "font-mono text-xs" },
    { id: "schemeVersion", label: "Scheme", size: 110, sortKey: "schemeVersion", value: (artifact) => artifact.schemeVersion ?? "未记录", className: "font-mono text-xs" },
    { id: "source", label: "来源快照", size: 200, sortKey: "source", value: (artifact) => artifact.sourceProjectName ?? "未记录",
      cell: (artifact) => <span className="block truncate text-muted-foreground" title={artifact.sourceProjectId ?? undefined}>{artifact.sourceProjectName ?? "未记录"}</span> },
    { id: "publishedAt", label: "发布时间", size: 190, sortKey: "publishedAt", value: (artifact) => artifact.publishedAt,
      cell: (artifact) => artifact.publishedAt ? new Date(artifact.publishedAt).toLocaleString("zh-CN", { hour12: false }) : "—", className: "tabular-nums text-muted-foreground" },
    { id: "actions", label: "操作", size: 112, align: "right", value: (artifact) => artifact.id,
      cell: (artifact, href) => <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <Button asChild variant="ghost" size="icon-sm"><a href={href} download aria-label={`下载 ${artifact.filename}`}><Download /></a></Button>
        <Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`删除 ${artifact.package} ${artifact.version}`} disabled={removing} onClick={() => openDelete(artifact)}><Trash2 /></Button>
      </div> }
  ], [openDelete, removing]);
  const { resetPage, ...table } = useProjectTable(scope, filtered, columns, "publishedAt");
  const changeSearch = useCallback((value: string) => { setSearch(value); resetPage(); }, [resetPage, setSearch]);
  return <section className={pageContainer}>
    <PageHeader title="已发布成果" count={releases.length} actions={<><Button asChild variant="outline"><Link to="/strategies">策略组装</Link></Button><Button variant="outline" disabled={refreshing} onClick={reload}><RefreshCw className={refreshing ? "animate-spin" : ""} />刷新</Button></>} />
    <p className="text-sm text-muted-foreground">已发布包及其冻结依赖独立保留，删除源项目不会移除成果。来源仅为历史快照；已退役成果可下载，但不能用于新策略。</p>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <ProjectDataTable {...table} columns={columns} loading={!loaded && !error} emptyMessage="暂无符合条件的已发布成果" rowHref={wheelHref} onOpen={(artifact) => window.location.assign(wheelHref(artifact))}
      search={{ value: search, onChange: changeSearch, placeholder: "搜索包、来源或 SHA256", label: "搜索已发布成果" }}
      filters={<Select value={kind} onValueChange={(value) => { setKind(value); resetPage(); }}><SelectTrigger className="w-36" aria-label="成果类型筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部类型</SelectItem>{projectKinds.map((item) => <SelectItem key={item} value={item}>{kindLabels[item]}</SelectItem>)}</SelectContent></Select>} />
    <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) closeDelete(); }}>
      <AlertDialogContent onEscapeKeyDown={(event) => { if (deletePending.current) event.preventDefault(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-all">删除“{deleting?.package} {deleting?.version}”？</AlertDialogTitle>
          <AlertDialogDescription>
            永久删除该成果的登记记录、wheel 及发布环境，无法恢复。源项目、已冻结任务的副本和历史报告保留。删除后该成果不再可下载或用于新安装、策略组装。若仍被项目、其他成果或在途安装引用，删除将被拒绝并提示原因。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="min-w-0 space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          <div><dt className="text-muted-foreground">包及版本</dt><dd className="break-all font-mono text-xs">{deleting?.package} {deleting?.version}</dd></div>
          <div><dt className="text-muted-foreground">文件</dt><dd className="break-all font-mono text-xs">{deleting?.filename}</dd></div>
          <div><dt className="text-muted-foreground">SHA256</dt><dd className="break-all font-mono text-xs">{deleting?.sha256}</dd></div>
          <div><dt className="text-muted-foreground">成果 ID</dt><dd className="break-all font-mono text-xs">{deleting?.id}</dd></div>
        </dl>
        {deleteError && <Alert variant="destructive"><AlertDescription className="break-all">{deleteError}{cleanupPending && <p>成果登记记录已删除，部分发布文件尚未清理。请重试清理原成果；不会删除后来发布的同名成果。</p>}</AlertDescription></Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removing} onClick={closeDelete}>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={removing} onClick={async (event) => {
            event.preventDefault();
            if (!deleting || deletePending.current) return;
            deletePending.current = true;
            setRemoving(true);
            setDeleteError("");
            try {
              await remove(deleting.id);
              deletePending.current = false;
              closeDelete();
            } catch (cause) {
              const reason = cause instanceof RequestError ? cause.reason ?? cause.message : cause instanceof Error ? cause.message : "请稍后重试";
              setDeleteError(`删除失败：${reason}`);
              if (cause instanceof RequestError && cause.code === "artifact_cleanup_incomplete" && cause.deleted === true && cause.id === deleting.id) setCleanupPending(true);
            } finally {
              deletePending.current = false;
              setRemoving(false);
            }
          }}>{removing ? "删除中…" : cleanupPending ? "重试清理" : deleteError ? "重试删除" : "删除成果"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
