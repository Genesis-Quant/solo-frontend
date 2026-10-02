import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { client } from "@/assets/lib/request";
import { loadReportPath, type ReportData } from "@/assets/lib/reports";
import { PageHeader, pageContainer } from "@/components/bar/PageHeader";
import ReportSkeleton from "@/components/panel/ReportSkeleton";
import ResearchReport from "@/components/panel/ResearchReport";
import { useStrategyStore } from "@/store/strategy";
import { strategyActive, strategyStages, strategyStatus, type StrategyRecord } from "@/types/strategy";
import { kindLabels } from "@/types/research";
import { Alert, AlertDescription } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";

type ReportLoadState = {
  path: string;
  schemeVersion: string | null;
} & (
  | { status: "loading" }
  | { status: "ready"; data: ReportData }
  | { status: "failed"; error: string }
);

export default function StrategyPage() {
  const { strategyId } = useParams();
  return <StrategyDetail key={strategyId} id={strategyId!} />;
}

function StrategyDetail({ id }: { id: string }) {
  const record = useStrategyStore((state) => state.records.find((item) => item.id === id));
  const upsert = useStrategyStore((state) => state.upsert);
  const [metadataError, setMetadataError] = useState("");
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [reportState, setReportState] = useState<ReportLoadState | null>(null);
  const [reportAttempt, setReportAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useStrategyStore.subscribe((state) => {
      const current = state.records.find((item) => item.id === id);
      if (!current || !strategyActive(current.status)) clearTimeout(timer);
    });
    async function load(poll = false) {
      if (!active) return;
      if (poll && !strategyActive(useStrategyStore.getState().records.find((item) => item.id === id)?.status ?? "")) return;
      setMetadataError("");
      try {
        const result = await client.get<StrategyRecord>(`/strategies/${id}`);
        if (!active) return;
        const accepted = upsert(result);
        if (strategyActive(accepted.status)) timer = setTimeout(() => load(true), 5000);
      } catch (cause) {
        if (active) setMetadataError(cause instanceof Error ? cause.message : String(cause));
      }
    }
    load();
    return () => { active = false; clearTimeout(timer); unsubscribe(); };
  }, [id, upsert, metadataAttempt]);
  useEffect(() => {
    if (!record?.reportPath || record.status !== "success") {
      setReportState(null);
      return undefined;
    }
    const request = { path: record.reportPath, schemeVersion: record.schemeVersion ?? null };
    const controller = new AbortController();
    setReportState({ ...request, status: "loading" });
    loadReportPath(request.path, "strategy", request.schemeVersion ?? undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setReportState({ ...request, status: "ready", data });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setReportState({
          ...request,
          status: "failed",
          error: cause instanceof Error ? cause.message : String(cause)
        });
      });
    return () => controller.abort();
  }, [record?.reportPath, record?.status, record?.schemeVersion, reportAttempt]);
  const currentReport = record?.status === "success"
    && reportState?.path === record.reportPath
    && reportState.schemeVersion === (record.schemeVersion ?? null)
    ? reportState
    : null;
  const error = metadataError || record?.error;
  return <section className={pageContainer}>
    <PageHeader back={{ label: "返回策略列表", to: "/strategies" }} title={record?.name ?? "策略"}
      status={record && <Badge variant="outline" className="status-badge" data-status={record.status}>{strategyStatus[record.status] ?? record.status}</Badge>} />
    {record && <div className="component-fade-in flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border bg-card p-4 shadow-sm">{strategyStages.map((stage, index) => <div className="flex min-w-0 items-center gap-4" key={stage}>{index > 0 && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}<div className="min-w-0"><p className="text-xs text-muted-foreground">{kindLabels[stage]}</p><p className="mt-1 break-words text-sm font-medium">{record.components[stage].label}</p></div></div>)}</div>}
    {error && <Alert variant="destructive" className="component-fade-in"><AlertDescription className="flex flex-wrap items-center gap-3"><span className="max-h-60 overflow-auto whitespace-pre-wrap break-words">{error}</span>{metadataError && <Button variant="outline" onClick={() => setMetadataAttempt((attempt) => attempt + 1)}>重试详情</Button>}</AlertDescription></Alert>}
    {currentReport?.status === "failed" && <Alert variant="destructive" className="component-fade-in"><AlertDescription className="flex flex-wrap items-center gap-3"><span className="whitespace-pre-wrap break-words">{currentReport.error}</span><Button variant="outline" onClick={() => setReportAttempt((attempt) => attempt + 1)}>重试报告</Button></AlertDescription></Alert>}
    {currentReport?.status === "ready"
      ? <div className="component-fade-in"><ResearchReport report={currentReport.data} workflowId={record?.workflowId ?? 0} /></div>
      : record && strategyActive(record.status)
        ? <div className="component-fade-in flex h-64 items-center justify-center gap-3 rounded-lg border bg-card text-sm text-muted-foreground shadow-sm"><LoaderCircle className="size-5 animate-spin" />{strategyStatus[record.status]}，完成后自动显示回测报告</div>
        : !error && record?.status !== "failed" && currentReport?.status !== "failed"
          ? <ReportSkeleton />
          : null}
  </section>;
}
