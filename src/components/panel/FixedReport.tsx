import { lazy, Suspense } from "react";

import { factorFixtureParameters } from "@/assets/lib/reportFixture";
import type { ProjectKind } from "@/types/research";
import { Skeleton } from "@/ui/skeleton";

const FactorAnalysisReport = lazy(() => import("./FactorAnalysisReport"));
const BacktestReport = lazy(() => import("./BacktestReport"));

export default function FixedReport({ kind }: { kind: ProjectKind }) {
  return (
    <Suspense fallback={<Skeleton className="h-80 w-full" aria-label="加载报告" />}>
      {kind === "factor"
        ? <FactorAnalysisReport factor="momentum_20d" parameters={factorFixtureParameters} workflowInstanceId={1} />
        : <BacktestReport annualTradingDays={252} riskFreeRate={0} workflowInstanceId={1} />}
    </Suspense>
  );
}
