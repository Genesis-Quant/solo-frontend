import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { client } from "@/assets/lib/request";
import { sameSchemeSeries, schemeMajor } from "@/assets/lib/scheme";
import { usePublishedArtifacts } from "@/hooks/usePublishedArtifacts";
import { kindLabels } from "@/types/research";
import { strategyStages, type StrategyForms, type StrategyRecord, type StrategySelection, type StrategyStage } from "@/types/strategy";
import { Alert, AlertDescription } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import SchemaFields from "@/components/field/SchemaFields";

const defaults = { optimize: "风险平价", control: "不拒单", execution: "不拆单" };

export default function StrategyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (strategy: StrategyRecord) => void }) {
  const { artifacts, loaded, refreshing, error: catalogError, reload } = usePublishedArtifacts();
  const [name, setName] = useState("");
  const [selection, setSelection] = useState<StrategySelection>({ artifacts: {} });
  const [forms, setForms] = useState<StrategyForms | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const candidates = artifacts.filter((artifact) => !!artifact.publishedAt && !artifact.retired && schemeMajor(artifact.schemeVersion) === 1);
  const model = candidates.find((artifact) => artifact.kind === "model" && artifact.id === selection.artifacts.model);
  const selectionValid = !catalogError && !!model && strategyStages.every((kind) =>
    !selection.artifacts[kind] || candidates.some((artifact) => artifact.kind === kind && artifact.id === selection.artifacts[kind]
      && sameSchemeSeries(artifact.schemeVersion, model.schemeVersion)));
  const stage = strategyStages[step - 1];
  const current = forms && stage ? forms[stage] : null;

  function selectArtifact(kind: StrategyStage, value: string) {
    if (busy) return;
    const selected = kind === "model" ? {} : { ...selection.artifacts };
    if (value === "default") delete selected[kind];
    else selected[kind] = value;
    setSelection({ artifacts: selected });
    setForms(null);
    setError("");
  }

  async function advance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!selectionValid) {
      setError(selection.artifacts.model
        ? "所选已发布成果已退役、缺少实际 Scheme 版本或不兼容，请刷新并重新选择"
        : "请先选择 Model 已发布成果");
      return;
    }
    if (step === 0) {
      if (forms) { setStep(1); return; }
      setBusy(true);
      try { setForms(await client.post<StrategyForms>("/strategies/forms", selection)); setStep(1); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setBusy(false); }
    } else if (step < 4) setStep(step + 1);
    else {
      setBusy(true);
      try {
        const strategy = await client.post<StrategyRecord>("/strategies", {
          name, selections: selection, forms: Object.fromEntries(strategyStages.map((kind) => [kind, forms![kind].values]))
        });
        onCreated(strategy);
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setBusy(false); }
    }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="flex max-h-[90svh] flex-col overflow-hidden sm:max-w-3xl">
      <DialogHeader><DialogTitle>创建策略</DialogTitle><DialogDescription>{step === 0 ? "选择已发布的 Model 成果，再选择 Scheme 主版本、次版本一致的后续成果，补丁版本可不同；源项目删除不影响已发布成果。" : `填写${kindLabels[stage]} Form${step === 1 ? "及公共回测设置" : ""}。`}</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-2 border-b pb-4" aria-label="组装步骤">
        {["选择成果", ...strategyStages.map((kind) => kindLabels[kind])].map((label, index) => <Badge key={label} variant={index === step ? "default" : "secondary"} className="gap-1.5 py-1 transition-colors duration-200">{index < step ? <Check className="size-3" /> : <span>{index + 1}</span>}{label}</Badge>)}
      </div>
      <form onSubmit={advance} className="flex min-h-0 flex-1 flex-col gap-5">
        <div key={step} className="component-fade-in min-h-0 flex-1 overflow-y-auto px-1 py-1">
          {step === 0
? <div className="space-y-5">
            <div className="space-y-2"><Label htmlFor="strategy-name">策略名称</Label><Input id="strategy-name" required maxLength={60} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="输入策略名称" /></div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <Link to="/artifacts" className="text-primary underline underline-offset-4">查看已发布成果</Link>
              <Button type="button" size="sm" variant="outline" disabled={busy || refreshing} onClick={reload}>{refreshing ? "加载成果…" : "刷新成果"}</Button>
            </div>
            {strategyStages.map((kind) => <div className="space-y-2" key={kind}>
              <Label htmlFor={`strategy-${kind}`}>{kindLabels[kind]}</Label>
              <Select disabled={busy || !loaded || kind !== "model" && !model} value={selection.artifacts[kind] ?? (kind === "model" ? "" : "default")} onValueChange={(value) => selectArtifact(kind, value)}>
                <SelectTrigger className="w-full" id={`strategy-${kind}`}><SelectValue placeholder="选择已发布成果" /></SelectTrigger>
                <SelectContent>{kind !== "model" && <SelectItem value="default">默认 · {defaults[kind]}</SelectItem>}
                  {candidates.filter((artifact) => artifact.kind === kind && (kind === "model" || sameSchemeSeries(artifact.schemeVersion, model?.schemeVersion)))
                    .map((artifact) => <SelectItem key={artifact.id} value={artifact.id}>{artifact.sourceProjectName ?? artifact.package} · {artifact.package} {artifact.version} · Scheme {artifact.schemeVersion}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>)}
            {loaded && !candidates.some((artifact) => artifact.kind === "model") && <p className="text-sm text-muted-foreground">暂无可用的 Model 已发布成果，请先发布未退役且已记录实际 Scheme 1.x 版本的成功研究成果。</p>}
          </div>
: current && <>
            <p className="mb-5 text-sm text-muted-foreground">{selection.artifacts[stage]
              ? candidates.find((artifact) => artifact.id === selection.artifacts[stage])?.package
              : defaults[stage as keyof typeof defaults]}</p>
            {Object.keys(current.schema.properties ?? {}).length
? <SchemaFields prefix={stage} schema={current.schema} values={current.values} onChange={(values) => setForms({ ...forms!, [stage]: { ...current, values } })} />
              : <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">此算法无需配置参数</p>}
          </>}
        </div>
        {(error || catalogError) && <Alert variant="destructive"><AlertDescription className="max-h-36 overflow-auto whitespace-pre-wrap break-words">{error || catalogError}</AlertDescription></Alert>}
        <DialogFooter className="shrink-0 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy} onClick={() => step ? setStep(step - 1) : onClose()}>{step ? <><ArrowLeft />上一步</> : "取消"}</Button>
          <Button type="submit" disabled={busy || !selectionValid}>{busy ? <><LoaderCircle className="animate-spin" />{step === 0 ? "读取 Form…" : "组装并提交…"}</> : step === 4 ? "创建并回测" : <>下一步<ArrowRight /></>}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
