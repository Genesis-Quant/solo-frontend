import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileArchive,
  FileChartColumn,
  FileCode2,
  FileText,
  LoaderCircle,
  Pencil,
  Terminal
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import {
  defaultDownstream,
  stepState
} from "@/assets/lib/prototype";
import { apiUrl } from "@/assets/lib/settings";
import ProjectForm from "@/components/ProjectForm";
import ResearchReport from "@/components/panel/ResearchReport";
import { loadReport, type ReportData } from "@/assets/lib/reports";
import TaskLogDialog from "@/components/TaskLogDialog";
import { useResearchStore } from "@/store/research";
import {
  kindLabels,
  publishLabels,
  runLabels,
  stepLabels,
  type ResearchProject,
  type ResearchVersion,
  type TaskStep
} from "@/types/research";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@/ui/empty";
import { Progress } from "@/ui/progress";
import { ScrollArea } from "@/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/ui/select";
import { Separator } from "@/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

export default function ProjectPage() {
  const { projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const project = useResearchStore((state) =>
    state.projects.find((p) => p.id === projectId)
  );
  if (!project)
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>项目不存在</EmptyTitle>
        </EmptyHeader>
        <Button asChild variant="outline">
          <Link to="/projects/factor">
            <ArrowLeft />
            返回项目列表
          </Link>
        </Button>
      </Empty>
    );
  const version =
    project.versions.find((v) => v.id === searchParams.get("version")) ??
    project.versions[0];
  return (
    <ProjectDetail
      key={`${project.id}:${version?.id}`}
      project={project}
      version={version}
      selectVersion={(id) =>
        setSearchParams({ version: id }, { replace: true })
      }
    />
  );
}

function ProjectDetail({
  project,
  version,
  selectVersion
}: {
  project: ResearchProject;
  version?: ResearchVersion;
  selectVersion: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [logs, setLogs] = useState<TaskStep | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportError, setReportError] = useState("");
  useEffect(() => {
    if (version?.status !== "success") return;
    const controller = new AbortController();
    setReport(null);
    setReportError("");
    loadReport(version, project.kind, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setReport(data); })
      .catch((error: Error) => { if (!controller.signal.aborted) setReportError(error.message); });
    return () => controller.abort();
  }, [version?.id, version?.status, version?.reportPath, project.kind]);
  function changeVersion(id: string) {
    selectVersion(id);
  }
  return (
    <div className="flex min-h-full flex-col lg:h-full lg:flex-row">
      <aside className="flex shrink-0 flex-col border-b bg-card lg:w-[286px] lg:border-r lg:border-b-0">
        <div className="space-y-4 p-5 pb-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="break-words text-base font-semibold">
                {project.name}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {kindLabels[project.kind]}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="编辑项目"
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
          </div>
          <VersionSummary project={project} version={version} changeVersion={changeVersion} />
        </div>
        {version && (
          <>
            <Separator />
            <Tabs defaultValue="parameters" className="min-h-0 flex-1 gap-0">
              <TabsList className="mx-5 mt-4 grid grid-cols-2">
                <TabsTrigger value="parameters">参数与依赖</TabsTrigger>
                <TabsTrigger value="artifacts">研究产物</TabsTrigger>
              </TabsList>
              <ScrollArea className="min-h-0 flex-1 lg:h-0">
                <TabsContent
                  value="parameters"
                  className="m-0 space-y-5 p-5 text-xs"
                >
                  <section className="space-y-3">
                    <h2 className="font-semibold">运行参数</h2>
                    <dl className="space-y-3">
                      {Object.entries({
                        数据区间: "2024-01-02 — 2025-06-30",
                        股票池: "中证全指 · 动态成分",
                        ...project.kind === "factor"
                          ? {}
                          : {
                              基准: "沪深 300",
                              初始资金: "¥1,000,000",
                              "决策 / 成交": "收盘决策 / 次日开盘"
                            }
                      }).map(([name, value]) => (
                        <div key={name}>
                          <dt className="mb-1 text-muted-foreground">{name}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <Separator />
                  <section className="space-y-3">
                    <h2 className="font-semibold">算法参数</h2>
                    <dl className="space-y-3">
                      {Object.entries(version.parameters).map(
                        ([name, value]) => (
                          <div key={name}>
                            <dt className="mb-1 font-mono text-muted-foreground">
                              {name}
                            </dt>
                            <dd className="break-words">{value}</dd>
                          </div>
                        )
                      )}
                    </dl>
                  </section>
                  <Separator />
                  <section className="space-y-3">
                    <h2 className="font-semibold">上游依赖</h2>
                    {version.dependencies.length
?
                      version.dependencies.map((dependency) => (
                        <div
                          key={dependency.name}
                          className="flex items-center justify-between gap-2"
                        >
                          <span>{dependency.name}</span>
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            {dependency.version}
                          </Badge>
                        </div>
                      ))
                     : (
                      <p className="text-muted-foreground">无上游依赖</p>
                    )}
                  </section>
                  {defaultDownstream[project.kind].length > 0 && (
                    <>
                      <Separator />
                      <section className="space-y-3">
                        <h2 className="font-semibold">默认后续算法</h2>
                        <div className="flex flex-wrap gap-2">
                          {defaultDownstream[project.kind].map((item) => (
                            <Badge key={item} variant="secondary">
                              {item}
                            </Badge>
                          ))}
                        </div>
                      </section>
                    </>
                  )}
                </TabsContent>
                <TabsContent
                  value="artifacts"
                  className="m-0 space-y-5 p-5 text-xs"
                >
                  {version.status === "success" && (
                    <section className="space-y-2">
                      <h2 className="flex items-center gap-2 font-semibold">
                        <FileChartColumn className="size-4 text-muted-foreground" />
                        报告数据
                      </h2>
                      {Object.entries(report?.files ?? {}).map(([name, url]) => (
                        <Button key={name} asChild variant="link" className="h-auto max-w-full justify-start p-0 text-xs">
                          <a className="break-all whitespace-normal font-mono" href={url} download>
                            {name}.parquet
                          </a>
                        </Button>
                      ))}
                    </section>
                  )}
                  <Separator />
                  <section className="space-y-2">
                    <h2 className="flex items-center gap-2 font-semibold">
                      <FileArchive className="size-4 text-muted-foreground" />
                      {version.publishStatus === "published"
                        ? "已发布包"
                        : "候选包"}
                    </h2>
                    <p className="break-all font-mono">
                      solo_{project.id.replace(/-/g, "_")}-0.1.{version.number}
                      -py3-none-any.whl
                    </p>
                    <p className="text-muted-foreground">148 KB</p>
                  </section>
                  <Separator />
                  <section className="space-y-2">
                    <h2 className="flex items-center gap-2 font-semibold">
                      <FileCode2 className="size-4 text-muted-foreground" />
                      源码快照
                    </h2>
                    <p className="font-mono">source-v{version.number}.tar.gz</p>
                    <p className="text-muted-foreground">86 KB</p>
                  </section>
                  <Separator />
                  <section className="space-y-2">
                    <h2 className="flex items-center gap-2 font-semibold">
                      <FileText className="size-4 text-muted-foreground" />
                      运行清单
                    </h2>
                    <p className="font-mono">manifest.json</p>
                    <p className="text-muted-foreground">4 KB</p>
                  </section>
                </TabsContent>
              </ScrollArea>
            </Tabs>
            <VersionActions
              key={version.id}
              project={project}
              version={version}
              onLogs={() => setLogs("research")}
            />
          </>
        )}
      </aside>
      <section className="flex min-h-[440px] min-w-0 flex-1 flex-col gap-5 p-5 lg:min-h-0 lg:p-6">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <h2 className="text-base font-semibold">
            {kindLabels[project.kind]}
            {!version || version.status === "success" ? "报告" : "执行状态"}
          </h2>
          <Button asChild variant="outline" className="bg-card">
            <a href={`${apiUrl}/projects/${project.id}/jupyter`} target="_blank" rel="noreferrer">
              打开 Jupyter
              <ArrowUpRight />
            </a>
          </Button>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {version?.status === "success"
? reportError
  ? <Alert variant="destructive"><AlertDescription>{reportError}</AlertDescription></Alert>
  : report ? <ResearchReport report={report} workflowId={version.workflowId} /> : <p className="text-muted-foreground">加载报告…</p>
: !version
? (
          <Empty className="min-h-72 border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileChartColumn className="text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle className="text-base">
                暂无研究版本
              </EmptyTitle>
              <EmptyDescription>
                在 Jupyter 中完成研究后提交版本
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
: (
          <ExecutionState version={version} onLogs={setLogs} />
        )}
        </div>
      </section>
      {editing && (
        <ProjectForm
          kind={project.kind}
          project={project}
          onClose={() => setEditing(false)}
        />
      )}
      {logs && version && (
        <TaskLogDialog
          key={version.id}
          project={project}
          version={version}
          initialStep={logs}
          onClose={() => setLogs(null)}
        />
      )}
    </div>
  );
}

function VersionActions({
  project,
  version,
  onLogs
}: {
  project: ResearchProject;
  version: ResearchVersion;
  onLogs: () => void;
}) {
  const publish = useResearchStore((state) => state.publishVersion);
  const [confirmVersion, setConfirmVersion] = useState<string | null>(null);
  return (
    <div className="space-y-3 border-t p-4" aria-live="polite">
      {confirmVersion === version.id && (
        <Alert>
          <AlertTitle>发布 v{version.number}？</AlertTitle>
          <AlertDescription>
            发布后，此版本可供下游项目选择。
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setConfirmVersion(null);
                  publish(project.id, version.id);
                }}
              >
                确认发布
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmVersion(null)}
              >
                取消
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {version.publishStatus === "failed" && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>发布失败</AlertTitle>
          <AlertDescription>{version.publishError}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          {version.status === "success" && (
            <Button
              className="w-full"
              disabled={
                version.publishStatus === "published" ||
                version.publishStatus === "checking" ||
                !!confirmVersion
              }
              variant={
                version.publishStatus === "published" ? "secondary" : "default"
              }
              onClick={() => setConfirmVersion(version.id)}
            >
              {version.publishStatus === "checking"
? (
                <LoaderCircle className="animate-spin" />
              )
: version.publishStatus === "published"
? (
                <Check />
              )
: null}
              {version.publishStatus === "published"
                ? "已发布"
                : version.publishStatus === "checking"
                  ? "发布校验中"
                  : "发布版本"}
            </Button>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="DolphinScheduler 日志"
              onClick={onLogs}
            >
              <Terminal />
            </Button>
          </TooltipTrigger>
          <TooltipContent>DolphinScheduler 日志</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function ExecutionState({
  version,
  onLogs
}: {
  version: ResearchVersion;
  onLogs: (step: TaskStep) => void;
}) {
  return (
    <div className="space-y-6 rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">
          v{version.number} · {runLabels[version.status]}
        </h3>
        <span className="text-xs text-muted-foreground">
          工作流 #{version.workflowId}
        </span>
      </div>
      {version.status === "running" && (
        <div className="space-y-2">
          <Progress value={50} aria-label="研究进度" />
          <p className="text-xs text-muted-foreground">
            已处理 180 / 363 个交易日
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(stepLabels) as TaskStep[]).map((step) => {
          const status = stepState(version, step);
          return (
            <Button
              key={step}
              variant="outline"
              className="h-auto justify-start gap-3 py-4"
              onClick={() => onLogs(step)}
            >
              {status === "success"
? (
                <Check className="text-emerald-600" />
              )
: status === "running"
? (
                <LoaderCircle className="animate-spin text-primary" />
              )
: status === "failed"
? (
                <CircleAlert className="text-destructive" />
              )
: (
                <FileText className="text-muted-foreground" />
              )}
              <span className="space-y-1 text-left">
                <span className="block">{stepLabels[step]}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {
                    {
                      success: "已完成",
                      running: "执行中",
                      failed: "失败",
                      pending: "未执行"
                    }[status]
                  }
                </span>
              </span>
            </Button>
          );
        })}
      </div>
      {version.error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>执行研究失败</AlertTitle>
          <AlertDescription className="break-all font-mono text-xs">
            {version.error}
          </AlertDescription>
        </Alert>
      )}
      <Button variant="outline" onClick={() => onLogs("research")}>
        <Terminal />
        查看完整日志
      </Button>
    </div>
  );
}

function VersionSummary({ project, version, changeVersion }: { project: ResearchProject; version?: ResearchVersion; changeVersion: (id: string) => void }) {
  const index = project.versions.findIndex((item) => item.id === version?.id);
  return (<>
          {version
? (
            <>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="上一版本"
                  disabled={index >= project.versions.length - 1}
                  onClick={() => changeVersion(project.versions[index + 1].id)}
                >
                  <ChevronLeft />
                </Button>
                <Select value={version.id} onValueChange={changeVersion}>
                  <SelectTrigger
                    aria-label="提交版本"
                    className="min-w-0 flex-1 border-0 shadow-none"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {project.versions.map((item) => (
                      <SelectItem value={item.id} key={item.id}>
                        提交版本 v{item.number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="下一版本"
                  disabled={index <= 0}
                  onClick={() => changeVersion(project.versions[index - 1].id)}
                >
                  <ChevronRight />
                </Button>
              </div>
              <div className="rounded-md bg-muted/60 p-3">
                <p className="text-sm">{version.note}</p>
                <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                  {version.submittedAt}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="outline"
                  className="status-badge"
                  data-status={version.status}
                >
                  {runLabels[version.status]}
                </Badge>
                <Badge
                  variant="secondary"
                  className={
                    version.publishStatus === "published"
                      ? "bg-primary/10 text-primary"
                      : ""
                  }
                >
                  {publishLabels[version.publishStatus]}
                </Badge>
              </div>
            </>
          )
: (
            <>
              <p className="text-sm text-muted-foreground">
                {project.description || "暂无描述"}
              </p>
              <Badge variant="outline">未提交</Badge>
              <p className="text-xs text-muted-foreground">
                Scheme {project.schemeVersion ?? "未记录"} · Algo {project.algoVersion}
              </p>
            </>
          )}
  </>);
}
