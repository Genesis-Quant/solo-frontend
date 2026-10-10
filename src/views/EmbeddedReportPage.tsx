import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { loadReportPath, type ReportData, type ReportProjectKind } from "@/assets/lib/reports";
import { loadNotebookReport } from "@/assets/lib/notebookReports";
import ResearchReport from "@/components/panel/ResearchReport";
import { useAppStore } from "@/store";
import { projectKinds, type ProjectKind } from "@/types/research";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Skeleton } from "@/ui/skeleton";

/** Notebook iframe 入口，不加载工作台导航或项目列表。 */
export default function EmbeddedReportPage() {
  const [params] = useSearchParams();
  const query = params.toString();
  return <EmbeddedReport key={query} params={params} />;
}

function EmbeddedReport({ params }: { params: URLSearchParams }) {
  const [report, setReport] = useState<(ReportData & { theme?: "light" | "dark" }) | null>(null);
  const [error, setError] = useState("");
  const source = params.get("source");
  const project = params.get("project");
  const version = params.get("version");
  const path = params.get("path");
  const theme = params.get("theme");
  const resolvedTheme = theme ?? (source === "jupyter" ? report?.theme : undefined);

  useEffect(() => {
    const controller = new AbortController();
    let request: Promise<ReportData> | undefined;
    if (source === "jupyter") {
      if (!path) setError("请提供相对于 Jupyter root 的 report.json 路径 path");
      else if (theme !== null && theme !== "light" && theme !== "dark") setError("theme 仅支持 light 或 dark");
      else request = loadNotebookReport(path, controller.signal);
    } else if (!projectKinds.includes(project as ProjectKind) && project !== "strategy") {
      setError("请提供有效的项目类型 project");
    } else if (!version || !path) {
      setError("请提供 Scheme 版本 version 和报告目录 path");
    } else if (theme !== null && theme !== "light" && theme !== "dark") {
      setError("theme 仅支持 light 或 dark");
    } else {
      request = loadReportPath(path, project as ReportProjectKind, version, controller.signal);
    }
    request?.then((data) => { if (!controller.signal.aborted) setReport(data); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => controller.abort();
  }, [source, project, version, path, theme]);

  useEffect(() => {
    const theme = resolvedTheme;
    if (theme !== "light" && theme !== "dark") return;
    const previous = useAppStore.getState().theme;
    // iframe 的显式主题只作用于当前页面，不覆盖工作台保存的偏好。
    document.documentElement.dataset.theme = theme;
    useAppStore.setState({ theme });
    return () => {
      document.documentElement.dataset.theme = previous;
      useAppStore.setState({ theme: previous });
    };
  }, [resolvedTheme]);

  return <main className="mx-auto min-h-svh max-w-[1600px] space-y-4 p-4" aria-label="嵌入报告">
    {error ? <Alert variant="destructive" role="alert">
      <AlertTitle>报告加载失败</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert> : report ? <ResearchReport report={report} workflowId={0} />
      : <Skeleton className="h-80 w-full" aria-label="加载报告" />}
  </main>;
}
