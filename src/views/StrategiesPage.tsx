import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { client } from "@/assets/lib/request";
import StrategyDialog from "@/components/modal/StrategyDialog";
import { strategyStages, type StrategyRecord } from "@/types/strategy";
import { kindLabels } from "@/types/research";
import { Alert, AlertDescription } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";

export const strategyStatus: Record<string, string> = { building: "组装中", queued: "排队中", running: "运行中", success: "已完成", failed: "失败" };

export default function StrategiesPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<StrategyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => client.get<StrategyRecord[]>("/strategies").then((items) => { if (active) { setRecords(items); setError(""); } }).catch((cause: Error) => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const visible = records.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-6 p-6">
    <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><h1 className="text-xl font-semibold">策略组装</h1><Badge variant="secondary">{records.length}</Badge></div><Button onClick={() => setCreating(true)}><Plus />创建策略</Button></div>
    <div className="relative max-w-xs"><Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="搜索策略" aria-label="搜索策略" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="overflow-hidden rounded-lg border bg-card"><Table>
      <TableHeader><TableRow><TableHead>策略名称</TableHead>{strategyStages.map((stage) => <TableHead key={stage}>{kindLabels[stage]}</TableHead>)}<TableHead>状态</TableHead><TableHead>创建时间</TableHead><TableHead className="text-right">报告</TableHead></TableRow></TableHeader>
      <TableBody>{visible.map((item) => <TableRow key={item.id}>
        <TableCell><Link className="font-medium text-primary hover:underline" to={`/strategies/${item.id}`}>{item.name}</Link></TableCell>
        {strategyStages.map((stage) => <TableCell key={stage} className="max-w-48 truncate" title={item.components[stage].label}>{item.components[stage].label}</TableCell>)}
        <TableCell><Badge variant={item.status === "failed" ? "destructive" : "secondary"}>{strategyStatus[item.status] ?? item.status}</Badge></TableCell>
        <TableCell className="text-muted-foreground">{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</TableCell>
        <TableCell className="text-right"><Button asChild variant="ghost" size="sm"><Link to={`/strategies/${item.id}`}>{item.status === "success" ? "查看报告" : "查看详情"}</Link></Button></TableCell>
      </TableRow>)}{!visible.length && <TableRow><TableCell colSpan={8} className="h-48 text-center text-muted-foreground">{loading ? "正在加载…" : query ? "没有匹配的策略" : "暂无策略，点击创建策略开始组装"}</TableCell></TableRow>}</TableBody>
    </Table></div>
    {creating && <StrategyDialog onClose={() => setCreating(false)} onCreated={(strategy) => navigate(`/strategies/${strategy.id}`)} />}
  </div>;
}
