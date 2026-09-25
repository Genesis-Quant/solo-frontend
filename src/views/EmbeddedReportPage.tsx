import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { loadReportPath, type ReportData } from "@/assets/lib/reports";
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
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const project = params.get("project");
  const version = params.get("version");
  const path = params.get("path");
  const theme = params.get("theme");

  useEffect(() => {
    const controller = new AbortController();
    if (!projectKinds.includes(project as ProjectKind)) {
      setError("请提供有效的项目类型 project");
    } else if (!version || !path) {
      setError("请提供 Scheme 版本 version 和报告目录 path");
    } else if (theme !== null && theme !== "light" && theme !== "dark") {
      setError("theme 仅支持 light 或 dark");
    } else {
      loadReportPath(path, project as ProjectKind, version, controller.signal)
        .then((data) => { if (!controller.signal.aborted) setReport(data); })
        .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    }
    return () => controller.abort();
  }, [project, version, path, theme]);

  useEffect(() => {
    if (theme !== "light" && theme !== "dark") return;
    const previous = useAppStore.getState().theme;
    // iframe 的显式主题只作用于当前页面，不覆盖工作台保存的偏好。
    document.documentElement.dataset.theme = theme;
    useAppStore.setState({ theme });
    return () => {
      document.documentElement.dataset.theme = previous;
      useAppStore.setState({ theme: previous });
    };
  }, [theme]);

  return <main className="mx-auto min-h-svh max-w-[1600px] space-y-4 p-4" aria-label="嵌入报告">
    {error ? <Alert variant="destructive" role="alert">
      <AlertTitle>报告加载失败</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert> : report ? <ResearchReport report={report} workflowId={0} />
      : <Skeleton className="h-80 w-full" aria-label="加载报告" />}
  </main>;
}
