import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { client } from "@/assets/lib/request";
import { supportsScheme } from "@/assets/lib/scheme";
import { errorMessage } from "@/assets/lib/utils";
import { useResearchStore } from "@/store/research";
import type { ResearchProject, TemplateVersion } from "@/types/research";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

interface Catalog {
  key: string;
  items: TemplateVersion[];
  error: string;
}

export default function ProjectUpgradeDialog({ project, onClose }: { project: ResearchProject; onClose: () => void }) {
  const upgrade = useResearchStore((state) => state.upgradeProject);
  const [refresh, setRefresh] = useState(0);
  const [schemeVersion, setSchemeVersion] = useState("");
  const [algoVersion, setAlgoVersion] = useState("");
  const [schemeCatalog, setSchemeCatalog] = useState<Catalog | null>(null);
  const [algoCatalog, setAlgoCatalog] = useState<Catalog | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const requestId = useRef(0);
  const revision = requestId.current;
  const catalogKey = JSON.stringify([project.id, project.kind, project.schemeVersion, project.algoVersion, refresh]);
  const schemes = schemeCatalog?.key === catalogKey ? schemeCatalog.items : [];
  const loadingSchemes = schemeCatalog?.key !== catalogKey;
  const schemeError = schemeCatalog?.key === catalogKey ? schemeCatalog.error : "";
  const selectedScheme = schemes.find((item) => item.tag === schemeVersion && supportsScheme(item.version));
  const algoKey = JSON.stringify([catalogKey, schemeVersion]);
  const algos = algoCatalog?.key === algoKey ? algoCatalog.items : [];
  const loadingAlgos = !!selectedScheme && algoCatalog?.key !== algoKey;
  const algoError = algoCatalog?.key === algoKey ? algoCatalog.error : "";
  const selectedAlgo = algos.find((item) => item.tag === algoVersion);
  const ready = !!selectedScheme && !!selectedAlgo;

  useEffect(() => () => { requestId.current++; }, []);

  useEffect(() => {
    if (busy.current) return;
    const request = ++requestId.current;
    client.get<TemplateVersion[]>(`/templates/scheme-versions${refresh ? "?refresh=true" : ""}`)
      .then((items) => {
        if (request !== requestId.current) return;
        const allowed = items.filter((item) => supportsScheme(item.version));
        setSchemeCatalog({ key: catalogKey, items, error: "" });
        setSchemeVersion((previous) => allowed.find((item) => item.tag === previous)?.tag
          ?? allowed.find((item) => item.tag === project.schemeVersion)?.tag ?? allowed[0]?.tag ?? "");
      })
      .catch((cause: unknown) => {
        if (request !== requestId.current) return;
        setSchemeCatalog({ key: catalogKey, items: [], error: errorMessage(cause) });
        setSchemeVersion("");
      });
  }, [catalogKey, project.schemeVersion, refresh]);

  const canLoadAlgos = !!selectedScheme;
  useEffect(() => {
    if (busy.current || !canLoadAlgos) return;
    const request = ++requestId.current;
    const query = new URLSearchParams({ kind: project.kind, scheme_version: schemeVersion });
    if (refresh) query.set("refresh", "true");
    client.get<TemplateVersion[]>(`/templates/versions?${query}`)
      .then((items) => {
        if (request !== requestId.current) return;
        setAlgoCatalog({ key: algoKey, items, error: "" });
        setAlgoVersion((previous) => items.find((item) => item.tag === previous)?.tag
          ?? items.find((item) => item.tag === project.algoVersion)?.tag ?? items[0]?.tag ?? "");
      })
      .catch((cause: unknown) => {
        if (request !== requestId.current) return;
        setAlgoCatalog({ key: algoKey, items: [], error: errorMessage(cause) });
        setAlgoVersion("");
      });
  }, [algoKey, canLoadAlgos, project.algoVersion, project.kind, refresh, schemeVersion]);

  function close() {
    if (!busy.current) onClose();
  }

  function refreshCatalog() {
    if (busy.current) return;
    requestId.current++;
    setRefresh((value) => value + 1);
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || revision !== requestId.current || !ready) return;
    const request = ++requestId.current;
    busy.current = true;
    setSubmitting(true);
    setError("");
    try {
      await upgrade(project.id, selectedScheme!.tag, selectedAlgo!.tag);
      if (request === requestId.current) onClose();
    } catch (cause) {
      if (request === requestId.current) setError(errorMessage(cause));
    } finally {
      busy.current = false;
      if (request === requestId.current) setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!submitting}
        onEscapeKeyDown={(event) => { if (busy.current) event.preventDefault(); }}
        onInteractOutside={(event) => { if (busy.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>升级版本</DialogTitle>
          <DialogDescription>{project.name} · 仅更新当前项目环境，不改写历史研究版本。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">当前项目环境（非历史 run 依赖）</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Scheme</dt><dd className="break-all font-mono">{project.schemeVersion ?? "未记录"}</dd>
              <dt className="text-muted-foreground">Algo</dt><dd className="break-all font-mono">{project.algoVersion}</dd>
            </dl>
          </div>
          <fieldset disabled={submitting} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="upgrade-scheme-version">目标 Scheme</Label>
              <Select value={selectedScheme?.tag ?? ""} disabled={submitting || loadingSchemes || !schemes.length}
                onValueChange={(value) => {
                  if (busy.current || value === schemeVersion) return;
                  requestId.current++;
                  setSchemeVersion(value);
                  setAlgoVersion("");
                  setAlgoCatalog(null);
                  setError("");
                }}>
                <SelectTrigger id="upgrade-scheme-version" className="w-full"><SelectValue placeholder={loadingSchemes ? "加载版本…" : "暂无可用版本"} /></SelectTrigger>
                <SelectContent>{schemes.map((item) => (
                  <SelectItem key={item.tag} value={item.tag} disabled={!supportsScheme(item.version)}>
                    {item.tag} · {item.version ?? "版本未记录"}{!supportsScheme(item.version) && "（尚未支持）"}
                  </SelectItem>
                ))}</SelectContent>
              </Select>
              {schemeError && <Alert variant="destructive"><AlertDescription>{schemeError}</AlertDescription></Alert>}
              {!loadingSchemes && !schemeError && !schemes.some((item) => supportsScheme(item.version)) && <p className="text-sm text-muted-foreground">暂无受支持的活跃 Scheme（支持 Scheme 1.x），请刷新版本目录。</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="upgrade-algo-version">目标 Algo</Label>
              <Select value={selectedAlgo?.tag ?? ""} disabled={submitting || !selectedScheme || loadingAlgos || !algos.length}
                onValueChange={(value) => {
                  if (busy.current) return;
                  requestId.current++;
                  setAlgoVersion(value);
                  setError("");
                }}>
                <SelectTrigger id="upgrade-algo-version" className="w-full"><SelectValue placeholder={!selectedScheme ? "请先选择 Scheme" : loadingAlgos ? "加载兼容版本…" : "暂无兼容版本"} /></SelectTrigger>
                <SelectContent>{algos.map((item) => (
                  <SelectItem key={item.tag} value={item.tag}>
                    {item.tag}{item.version && ` · ${item.version}`}
                  </SelectItem>
                ))}</SelectContent>
              </Select>
              {algoError && <Alert variant="destructive"><AlertDescription>{algoError}</AlertDescription></Alert>}
              {selectedScheme && !loadingAlgos && !algoError && !algos.length && <p className="text-sm text-muted-foreground">没有兼容所选 Scheme 的活跃 Algo，请刷新版本目录。</p>}
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 break-words text-xs text-muted-foreground" aria-live="polite">目标环境：Scheme {selectedScheme?.tag ?? "待选择"} · Algo {selectedAlgo?.tag ?? "待选择"}</p>
              <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={refreshCatalog}>
                <RefreshCw className={loadingSchemes || loadingAlgos ? "animate-spin" : ""} />刷新版本
              </Button>
            </div>
          </fieldset>
          <p className="text-xs text-muted-foreground">可选择任意兼容版本，包括降低版本或保留当前版本；最终由后端校验。</p>
          <Alert><AlertDescription className="space-y-2 text-xs">
            <p>重建项目 venv，更新 .solo 及必要的 pyproject.toml / uv.lock，采用所选 Algo 版本的依赖契约。</p>
            <p>不替换 src / Notebook，不迁移参数或代码；历史研究版本、报告及冻结依赖保持不变。</p>
            <p>闲置 Kernel 会关闭，忙碌 Kernel 需先停止。已安装上游研究包若跨 minor 不兼容会拒绝升级，不会自动卸载或升级。</p>
            <p>退役项目也可升级环境，但不会使历史退役 run 恢复活跃。</p>
          </AlertDescription></Alert>
          {error && <Alert variant="destructive" role="alert"><AlertDescription className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{error}</AlertDescription></Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={close}>取消</Button>
            <Button type="submit" disabled={submitting || !ready}>{submitting && <LoaderCircle className="animate-spin" />}{submitting ? "升级中…" : "确认升级"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
