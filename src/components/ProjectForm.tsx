import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useResearchStore } from "@/store/research";
import {
  kindLabels,
  projectKinds,
  type ProjectKind,
  type ResearchProject
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
  const [template, setTemplate] = useState("稳定版 · v1.0.0");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("请输入项目名称");
      return;
    }
    if (project) {
      edit(project.id, name.trim(), description.trim());
      onClose();
    } else {
      const id = create(
        name.trim(),
        description.trim(),
        selectedKind,
        template
      );
      onClose();
      navigate(`/projects/${id}`);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
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
          {!project && (
            <div className="space-y-2">
              <Label htmlFor="project-kind">项目类型</Label>
              <Select
                value={selectedKind}
                onValueChange={(value) => setKind(value as ProjectKind)}
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
            {error && (
              <p
                id="name-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            )}
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
            <div className="space-y-2">
              <Label htmlFor="template-version">模板版本</Label>
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger id="template-version" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="稳定版 · v1.0.0">
                    稳定版 · v1.0.0
                  </SelectItem>
                  <SelectItem value="v0.9.0">v0.9.0</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">{project ? "保存修改" : "创建项目"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
