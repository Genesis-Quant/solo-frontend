import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { client } from "@/assets/lib/request";
import { schemeMajor } from "@/assets/lib/scheme";
import { useResearchStore } from "@/store/research";
import { kindLabels } from "@/types/research";
import { strategyStages, type StrategyForms, type StrategyRecord, type StrategySelection } from "@/types/strategy";
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
  const projects = useResearchStore((state) => state.projects);
  const [name, setName] = useState("");
  const [selection, setSelection] = useState<StrategySelection>({ model: null, optimize: null, control: null, execution: null });
  const [forms, setForms] = useState<StrategyForms | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const candidates = projects.flatMap((project) => project.versions.filter((version) => version.status === "success").map((version) => ({ project, version, scheme: version.dependencies.find((dependency) => dependency.name === "scheme")?.version ?? project.schemeVersion })));
  const model = candidates.find((item) => item.version.id === selection.model);
  const major = schemeMajor(model?.scheme);
  const stage = strategyStages[step - 1];
  const current = forms && stage ? forms[stage] : null;
  async function advance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (step === 0) {
      if (!selection.model) { setError("请先选择 Model 研究版本"); return; }
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
      <DialogHeader><DialogTitle>创建策略</DialogTitle><DialogDescription>{step === 0 ? "选择 Model，再选择同一 Scheme 大版本的后续项目。" : `填写${kindLabels[stage]} Form${step === 1 ? "及公共回测设置" : ""}。`}</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-2 border-b pb-4" aria-label="组装步骤">
        {["选择项目", ...strategyStages.map((kind) => kindLabels[kind])].map((label, index) => <Badge key={label} variant={index === step ? "default" : "secondary"} className="gap-1.5 py-1">{index < step ? <Check className="size-3" /> : <span>{index + 1}</span>}{label}</Badge>)}
      </div>
      <form onSubmit={(event) => void advance(event)} className="flex min-h-0 flex-1 flex-col gap-5">
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
          {step === 0 ? <div className="space-y-5">
            <div className="space-y-2"><Label htmlFor="strategy-name">策略名称</Label><Input id="strategy-name" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="输入策略名称" /></div>
            {strategyStages.map((kind) => <div className="space-y-2" key={kind}>
              <Label htmlFor={`strategy-${kind}`}>{kindLabels[kind]}</Label>
              <Select disabled={busy || (kind !== "model" && !model)} value={selection[kind] ?? (kind === "model" ? "" : "default")} onValueChange={(value) => {
                setSelection(kind === "model" ? { model: value, optimize: null, control: null, execution: null } : { ...selection, [kind]: value === "default" ? null : value });
                setForms(null);
              }}><SelectTrigger className="w-full" id={`strategy-${kind}`}><SelectValue placeholder="选择成功的研究版本" /></SelectTrigger>
                <SelectContent>{kind !== "model" && <SelectItem value="default">默认 · {defaults[kind]}</SelectItem>}
                  {candidates.filter((item) => item.project.kind === kind && (kind === "model" ? schemeMajor(item.scheme) === 1 : schemeMajor(item.scheme) === major)).map(({ project, version, scheme }) => <SelectItem key={version.id} value={version.id}>{project.name} · v{version.number} · Scheme {scheme}{version.note ? ` · ${version.note}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>)}
          </div> : current && <>
            <p className="mb-5 text-sm text-muted-foreground">{selection[stage] ? candidates.find((item) => item.version.id === selection[stage])?.project.name : defaults[stage as keyof typeof defaults]}</p>
            {Object.keys(current.schema.properties ?? {}).length ? <SchemaFields prefix={stage} schema={current.schema} values={current.values} onChange={(values) => setForms({ ...forms!, [stage]: { ...current, values } })} />
              : <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">此算法无需配置参数</p>}
          </>}
        </div>
        {error && <Alert variant="destructive"><AlertDescription className="max-h-36 overflow-auto whitespace-pre-wrap break-words">{error}</AlertDescription></Alert>}
        <DialogFooter className="shrink-0 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy} onClick={() => step ? setStep(step - 1) : onClose()}>{step ? <><ArrowLeft />上一步</> : "取消"}</Button>
          <Button type="submit" disabled={busy || (step === 0 && !selection.model)}>{busy ? <><LoaderCircle className="animate-spin" />{step === 0 ? "读取 Form…" : "组装并提交…"}</> : step === 4 ? "创建并回测" : <>下一步<ArrowRight /></>}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
