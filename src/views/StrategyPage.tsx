import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { client } from "@/assets/lib/request";
import { loadReportPath, type ReportData } from "@/assets/lib/reports";
import ResearchReport from "@/components/panel/ResearchReport";
import { strategyStages, type StrategyRecord } from "@/types/strategy";
import { kindLabels } from "@/types/research";
import { Alert, AlertDescription } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/skeleton";
import { strategyStatus } from "./StrategiesPage";

export default function StrategyPage() {
  const { strategyId } = useParams();
  return <StrategyDetail key={strategyId} id={strategyId!} />;
}

function StrategyDetail({ id }: { id: string }) {
  const [record, setRecord] = useState<StrategyRecord | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await client.get<StrategyRecord>(`/strategies/${id}`);
        if (!active) return;
        setRecord(result); setError("");
        if (["building", "queued", "running"].includes(result.status)) timer = setTimeout(() => void load(), 5000);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }
    }
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [id]);
  useEffect(() => {
    if (!record?.reportPath || record.status !== "success") return;
    const controller = new AbortController();
    void loadReportPath(record.reportPath, "strategy", record.schemeVersion ?? undefined, controller.signal).then((result) => { if (!controller.signal.aborted) setReport(result); }).catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [record?.reportPath, record?.status, record?.schemeVersion]);
  return <div className="space-y-5 p-6">
    <div className="flex flex-wrap items-center gap-3"><Button asChild variant="outline" size="icon" aria-label="返回策略列表"><Link to="/strategies"><ArrowLeft /></Link></Button><h1 className="text-xl font-semibold">{record?.name ?? "策略"}</h1>{record && <Badge variant={record.status === "failed" ? "destructive" : "secondary"}>{strategyStatus[record.status] ?? record.status}</Badge>}</div>
    {record && <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">{strategyStages.map((stage, index) => <div className="flex min-w-0 items-center gap-3" key={stage}>{index > 0 && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}<div className="min-w-0"><p className="text-xs text-muted-foreground">{kindLabels[stage]}</p><p className="mt-1 break-words text-sm font-medium">{record.components[stage].label}</p></div></div>)}</div>}
    {(error || record?.error) && <Alert variant="destructive"><AlertDescription className="max-h-60 overflow-auto whitespace-pre-wrap break-words">{error || record?.error}</AlertDescription></Alert>}
    {report ? <ResearchReport report={report} workflowId={record?.workflowId ?? 0} /> : record && ["building", "queued", "running"].includes(record.status) ? <div className="flex h-64 items-center justify-center gap-3 rounded-lg border text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin" />{strategyStatus[record.status]}，完成后自动显示回测报告</div> : !error && record?.status !== "failed" ? <Skeleton className="h-80" /> : null}
  </div>;
}
