import { Skeleton } from "@/ui/skeleton";

/** 报告加载占位：与报告的指标卡 + 图表布局一致，避免加载完成时跳动。 */
export default function ReportSkeleton() {
  return <div className="space-y-5" aria-label="加载报告" aria-busy>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => <Skeleton className="h-20" key={index} />)}
    </div>
    <Skeleton className="h-80" />
  </div>;
}
