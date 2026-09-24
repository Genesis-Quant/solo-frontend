import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useResearchStore } from "@/store/research";
import { client } from "@/assets/lib/request";
import { supportsScheme } from "@/assets/lib/scheme";
import { Alert, AlertDescription } from "@/ui/alert";
import {
  kindLabels,
  projectKinds,
  type ProjectKind,
  type ResearchProject,
  type TemplateVersion
} from "@/types/research";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/ui/select";
import { Textarea } from "@/ui/textarea";

export default function ProjectForm({
  kind,
  project,
  onClose
}: {
  kind: ProjectKind;
  project?: ResearchProject;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const create = useResearchStore((state) => state.createProject);
  const edit = useResearchStore((state) => state.editProject);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [selectedKind, setKind] = useState(kind);
  const [template, setTemplate] = useState("");
  const [schemeVersion, setSchemeVersion] = useState("");
  const [schemeVersions, setSchemeVersions] = useState<TemplateVersion[]>([]);
  const [loadingSchemes, setLoadingSchemes] = useState(!project);
  const [schemeError, setSchemeError] = useState("");
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(!project);
  const [versionError, setVersionError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (project) return;
    let active = true;
    setLoadingSchemes(true);
    setSchemeError("");
    client.get<TemplateVersion[]>(`/templates/scheme-versions${refresh ? "?refresh=true" : ""}`)
      .then((items) => {
        if (!active) return;
        setSchemeVersions(items);
        setSchemeVersion((previous) => items.some((item) => item.tag === previous && supportsScheme(item.version)) ? previous : items.find((item) => supportsScheme(item.version))?.tag ?? "");
      })
      .catch((cause: Error) => { if (active) setSchemeError(cause.message); })
      .finally(() => { if (active) setLoadingSchemes(false); });
    return () => { active = false; };
  }, [project, refresh]);

  useEffect(() => {
    if (project) return;
    setTemplate("");
    setVersions([]);
    if (!schemeVersion) {
      setLoadingVersions(false);
      return;
    }
    let active = true;
    setLoadingVersions(true);
    setVersionError("");
    const query = new URLSearchParams({ kind: selectedKind, scheme_version: schemeVersion });
    if (refresh) query.set("refresh", "true");
    client.get<TemplateVersion[]>(`/templates/versions?${query}`)
      .then((items) => {
        if (!active) return;
        setVersions(items);
        setTemplate((previous) => items.some((item) => item.tag === previous) ? previous : items[0]?.tag ?? "");
      })
      .catch((cause: Error) => { if (active) setVersionError(cause.message); })
      .finally(() => { if (active) setLoadingVersions(false); });
    return () => { active = false; };
  }, [project, refresh, schemeVersion, selectedKind]);

  const versionsReady = !!schemeVersion && !!template && !loadingSchemes && !loadingVersions && !schemeError && !versionError;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("请输入项目名称");
      return;
    }
    if (submitting || (!project && !versionsReady)) return;
    setSubmitting(true);
    setError("");
    try {
      if (project) {
        await edit(project.id, name.trim(), description.trim());
        onClose();
        return;
      }
      const id = await create(name.trim(), description.trim(), selectedKind, schemeVersion, template);
      onClose();
      navigate(`/projects/${id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建项目失败");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{project ? "编辑项目" : "新建项目"}</DialogTitle>
          <DialogDescription className="sr-only">
            填写项目名称、类别与描述
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={submitting} className="space-y-5">
          {!project && (
            <div className="space-y-2">
              <Label htmlFor="project-kind">项目类型</Label>
              <Select
                value={selectedKind}
                onValueChange={(value) => { setTemplate(""); setKind(value as ProjectKind); }}
              >
                <SelectTrigger id="project-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projectKinds.map((value) => (
                    <SelectItem value={value} key={value}>
                      {kindLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="project-name">项目名称</Label>
            <Input
              id="project-name"
              autoFocus
              placeholder="输入项目名称"
              maxLength={60}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
              aria-invalid={!!error}
              aria-describedby={error ? "name-error" : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-description">
              描述 <span className="text-muted-foreground">（选填）</span>
            </Label>
            <Textarea
              id="project-description"
              placeholder="简述研究方向"
              rows={3}
              maxLength={200}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {!project && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="scheme-version">Scheme 版本</Label>
                <Select value={schemeVersion} onValueChange={(value) => {
                  if (value) { setTemplate(""); setSchemeVersion(value); }
                }} disabled={loadingSchemes || !schemeVersions.length}>
                  <SelectTrigger id="scheme-version" className="w-full">
                    <SelectValue placeholder={loadingSchemes ? "加载版本…" : "暂无可用版本"} />
                  </SelectTrigger>
                  <SelectContent>
                    {schemeVersions.map((version) => (
                      <SelectItem key={version.tag} value={version.tag} disabled={!supportsScheme(version.version)}>{version.tag}{!supportsScheme(version.version) && "（尚未支持）"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {schemeError && <Alert variant="destructive"><AlertDescription>{schemeError}</AlertDescription></Alert>}
                {!loadingSchemes && !schemeError && schemeVersions.length > 0 && !schemeVersions.some((item) => supportsScheme(item.version)) && <p className="text-sm text-muted-foreground">当前前端支持 Scheme 1.x，仓库尚无对应发布版本</p>}
              </div>
              <div className="space-y-2">
              <Label htmlFor="template-version">Algo 版本</Label>
              <Select value={template} onValueChange={(value) => { if (value) setTemplate(value); }} disabled={!schemeVersion || loadingSchemes || loadingVersions || !versions.length}>
                <SelectTrigger id="template-version" className="w-full">
                  <SelectValue placeholder={!schemeVersion ? "请先选择 Scheme 版本" : loadingVersions ? "加载版本…" : "暂无兼容版本"} />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((version) => (
                    <SelectItem key={version.tag} value={version.tag}>{version.tag}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {versionError && <Alert variant="destructive"><AlertDescription>{versionError}</AlertDescription></Alert>}
              {schemeVersion && !loadingVersions && !versionError && !versions.length && <p className="text-sm text-muted-foreground">没有兼容所选 Scheme 的 Algo 版本</p>}
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={loadingSchemes || loadingVersions} onClick={() => setRefresh((value) => value + 1)}>
                <RefreshCw className={loadingSchemes || loadingVersions ? "animate-spin" : ""} />刷新版本
              </Button>
            </div>
          )}
          {error && <Alert id="name-error" variant="destructive"><AlertDescription className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{error}</AlertDescription></Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={submitting || (!project && !versionsReady)}>
              {submitting && <LoaderCircle className="animate-spin" />}
              {submitting ? (project ? "保存中…" : "创建中…") : project ? "保存修改" : "创建项目"}
            </Button>
          </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
