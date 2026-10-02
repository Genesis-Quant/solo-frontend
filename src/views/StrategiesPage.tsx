import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import StrategyDialog from "@/components/modal/StrategyDialog";
import { PageHeader, pageContainer } from "@/components/bar/PageHeader";
import ProjectDataTable, { type ProjectTableColumn } from "@/components/table/ProjectDataTable";
import { useProjectTable } from "@/hooks/useProjectTable";
import { usePageState } from "@/store/pageMemory";
import { useStrategyPolling, useStrategyStore } from "@/store/strategy";
import { strategyStages, strategyStatus, type StrategyRecord } from "@/types/strategy";
import { kindLabels } from "@/types/research";
import { Alert, AlertDescription } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";

type StrategySort = "name" | "model" | "optimize" | "control" | "execution" | "status" | "createdAt";
const scope = "strategies";
const strategyHref = (strategy: StrategyRecord) => `/strategies/${strategy.id}`;

export default function StrategiesPage() {
  const navigate = useNavigate();
  const records = useStrategyStore((state) => state.records);
  const loaded = useStrategyStore((state) => state.loaded);
  const error = useStrategyStore((state) => state.error);
  const seedCreated = useStrategyStore((state) => state.seedCreated);
  const [query, setQuery] = usePageState(scope, "search", "");
  const [creating, setCreating] = useState(false);
  useStrategyPolling();
  const visible = records.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  const columns = useMemo<ProjectTableColumn<StrategyRecord, StrategySort>[]>(() => [
    { id: "name", label: "策略名称", size: 220, sortKey: "name", value: (item) => item.name,
      cell: (item, href) => <Link to={href} className="block truncate rounded-sm font-medium group-hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" title={item.name}>{item.name}</Link> },
    ...strategyStages.map((stage): ProjectTableColumn<StrategyRecord, StrategySort> => ({
      id: stage, label: kindLabels[stage], size: 150, sortKey: stage, value: (item) => item.components[stage].label,
      cell: (item) => <span className="block truncate" title={item.components[stage].label}>{item.components[stage].label}</span>
    })),
    { id: "status", label: "状态", size: 110, sortKey: "status", value: (item) => item.status,
      cell: (item) => <Badge variant="outline" className="status-badge whitespace-nowrap" data-status={item.status}>{strategyStatus[item.status] ?? item.status}</Badge> },
    { id: "createdAt", label: "创建时间", size: 190, sortKey: "createdAt", value: (item) => Date.parse(item.createdAt),
      cell: (item) => new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false }), className: "tabular-nums text-muted-foreground" }
  ], []);
  const { resetPage, ...table } = useProjectTable(scope, visible, columns, "createdAt");
  const changeSearch = useCallback((value: string) => { setQuery(value); resetPage(); }, [resetPage, setQuery]);
  return <section className={pageContainer}>
    <PageHeader title="策略组装" count={records.length} actions={<Button onClick={() => setCreating(true)}><Plus />创建策略</Button>} />
    {error && <Alert variant="destructive"><AlertDescription>策略加载失败：{error}</AlertDescription></Alert>}
    <ProjectDataTable {...table} columns={columns} loading={!loaded && !error} emptyMessage="暂无策略，点击“创建策略”开始组装" rowHref={strategyHref} onOpen={(item) => navigate(`/strategies/${item.id}`)}
      search={{ value: query, onChange: changeSearch, placeholder: "搜索策略名称", label: "搜索策略" }} />
    {creating && <StrategyDialog onClose={() => setCreating(false)} onCreated={(strategy) => { seedCreated(strategy); navigate(`/strategies/${strategy.id}`); }} />}
  </section>;
}
