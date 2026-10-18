import { lazy, Suspense, useMemo } from "react";
import { ReportContext, reportApi, type ReportData } from "@/assets/lib/reports";
import { Skeleton } from "@/ui/skeleton";

const FactorAnalysisReport = lazy(() => import("./FactorAnalysisReport"));
const BacktestReport = lazy(() => import("./BacktestReport"));

export default function ResearchReport({ report, workflowId }: { report: ReportData; workflowId: number }) {
  // 轮询可能返回同一报告的新对象；只有数据源 / 契约真正变更才重置会话与筛选。
  const identity = JSON.stringify([report.kind, report.schemeVersion, Object.entries(report.files).sort(([left], [right]) => left.localeCompare(right)), report.parameters, report.annualTradingDays, report.riskFreeRate]);
  const api = useMemo(() => reportApi(report), [identity]);
  return <ReportContext.Provider value={api}>
    <Suspense fallback={<Skeleton className="h-80 w-full" aria-label="加载报告" />}>
      {report.kind === "factor" && report.parameters
        ? <FactorAnalysisReport parameters={report.parameters} workflowInstanceId={workflowId} />
        : <BacktestReport annualTradingDays={report.annualTradingDays} riskFreeRate={report.riskFreeRate} workflowInstanceId={workflowId} />}
    </Suspense>
  </ReportContext.Provider>;
}
