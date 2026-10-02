import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

import { cn } from "@/assets/lib/utils";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";

type PageHeaderProps = {
  actions?: ReactNode;
  back?: { label: string; to: string };
  className?: string;
  count?: number;
  status?: ReactNode;
  title: ReactNode;
};

/** 列表页与详情页共用的标题栏：返回、标题、计数/状态与右侧操作。 */
export function PageHeader({ actions, back, className, count, status, title }: PageHeaderProps) {
  return <div className={cn("flex min-h-9 flex-wrap items-center justify-between gap-4", className)}>
    <div className="flex min-w-0 items-center gap-3">
      {back && <Button asChild variant="outline" size="icon-sm" aria-label={back.label} title={back.label}><Link to={back.to}><ArrowLeft /></Link></Button>}
      <h1 className="truncate text-xl font-semibold">{title}</h1>
      {count !== undefined && <Badge variant="secondary" className="tabular-nums">{count.toLocaleString("zh-CN")}</Badge>}
      {status}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>;
}

/** 一级页面与详情页统一的内容容器宽度与留白。 */
export const pageContainer = "mx-auto w-full max-w-[1600px] space-y-6 p-5 md:p-8";
