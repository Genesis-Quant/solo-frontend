import { lazy, Suspense, useMemo, useState } from "react";
import { ReportContext, reportApi, type ReportData } from "@/assets/lib/reports";
import { Skeleton } from "@/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

const FactorAnalysisReport = lazy(() => import("./FactorAnalysisReport"));
const BacktestReport = lazy(() => import("./BacktestReport"));

export default function ResearchReport({ report, workflowId }: { report: ReportData; workflowId: number }) {
  const api = useMemo(() => reportApi(report), [report]);
  const [factor, setFactor] = useState(report.parameters?.factor_columns[0] ?? "");
  return <ReportContext.Provider value={api}>
    {report.kind === "factor" && report.parameters && report.parameters.factor_columns.length > 1 && (
      <Select value={factor} onValueChange={setFactor}>
        <SelectTrigger aria-label="报告因子" className="mb-4 w-64"><SelectValue /></SelectTrigger>
        <SelectContent>{report.parameters.factor_columns.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
      </Select>
    )}
    <Suspense fallback={<Skeleton className="h-80 w-full" aria-label="加载报告" />}>
      {report.kind === "factor" && report.parameters
        ? <FactorAnalysisReport factor={factor} parameters={report.parameters} workflowInstanceId={workflowId} />
        : <BacktestReport annualTradingDays={report.annualTradingDays} riskFreeRate={report.riskFreeRate} workflowInstanceId={workflowId} />}
    </Suspense>
  </ReportContext.Provider>;
}
