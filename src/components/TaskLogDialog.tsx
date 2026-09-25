import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Maximize2,
  Minimize2,
  Terminal,
  X
} from "lucide-react";

import { stepState } from "@/assets/lib/prototype";
import { cn } from "@/assets/lib/utils";
import { client } from "@/assets/lib/request";
import {
  runLabels,
  stepLabels,
  type ResearchProject,
  type ResearchVersion,
  type TaskStep
} from "@/types/research";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Label } from "@/ui/label";
import { ScrollArea, ScrollBar } from "@/ui/scroll-area";
import { Switch } from "@/ui/switch";
import { Tabs, TabsContent } from "@/ui/tabs";

export default function TaskLogDialog({
  project,
  version,
  initialStep = "research",
  onClose
}: {
  project: ResearchProject;
  version: ResearchVersion;
  initialStep?: TaskStep;
  onClose: () => void;
}) {
  const [step, setStep] = useState<TaskStep>(initialStep);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => client.get<{ message: string }>(`/projects/${project.id}/versions/${version.id}/logs`)
      .then((result) => { if (active) setLiveLogs(result.message.split("\n").filter(Boolean)); })
      .catch((error: Error) => { if (active) setLiveLogs([error.message]); });
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [project.id, version.id]);
  const logs = liveLogs;
  const visibleLogs = logs.filter(
    (line) => !errorsOnly || line.includes("ERROR")
  );
  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [follow, step, errorsOnly]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(visibleLogs.join("\n"));
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("复制失败，请使用下载日志");
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([logs.join("\n")], { type: "text/plain;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.id}-v${version.number}-${step}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex h-[min(720px,90svh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl",
          expanded &&
            "h-[calc(100svh-24px)] max-w-[calc(100vw-24px)] sm:max-w-[calc(100vw-24px)]"
        )}
      >
        <DialogHeader className="flex-row items-center justify-between border-b px-5 py-4">
          <div className="space-y-1.5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Terminal className="size-4" />
              DolphinScheduler 日志
            </DialogTitle>
            <DialogDescription>
              {project.name} / v{version.number}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={expanded ? "缩小日志窗口" : "展开日志窗口"}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label="关闭日志">
                <X />
              </Button>
            </DialogClose>
          </div>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-5 py-3 text-xs text-muted-foreground">
          <span>
            工作流{" "}
            <span className="font-mono text-foreground">
              #{version.workflowId}
            </span>
          </span>
          <span>
            开始于{" "}
            <span className="tabular-nums text-foreground">
              {version.submittedAt}
            </span>
          </span>
          <Badge
            variant="outline"
            data-status={version.status}
            className="status-badge"
          >
            {runLabels[version.status]}
          </Badge>
        </div>
        <Tabs
          value={step}
          onValueChange={(value) => {
            setStep(value as TaskStep);
            setCopied(false);
            setCopyError("");
          }}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="flex flex-wrap items-center gap-5">
              <div className="flex items-center gap-2">
                <Switch
                  id="log-errors"
                  checked={errorsOnly}
                  onCheckedChange={setErrorsOnly}
                />
                <Label htmlFor="log-errors" className="text-xs">
                  仅错误
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="log-follow"
                  checked={follow}
                  onCheckedChange={setFollow}
                />
                <Label htmlFor="log-follow" className="text-xs">
                  跟随日志
                </Label>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span role="status" className="text-xs text-destructive">
                {copyError}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!visibleLogs.length}
                onClick={copy}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? "已复制" : "复制"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!logs.length}
                onClick={download}
              >
                <Download />
                下载
              </Button>
            </div>
          </div>
          {(Object.keys(stepLabels) as TaskStep[]).map((item) => (
            <TabsContent
              key={item}
              value={item}
              className="m-0 min-h-0 flex-1 border-t bg-muted/30"
            >
              <ScrollArea className="h-full">
                {visibleLogs.length
? (
                  <div className="min-w-max p-5 font-mono text-xs leading-7">
                    {visibleLogs.map((line, index) => (
                      <div
                        key={index}
                        className={
                          line.includes("ERROR")
                            ? "text-destructive"
                            : "text-foreground"
                        }
                      >
                        <span className="mr-5 inline-block w-5 select-none text-right text-muted-foreground">
                          {index + 1}
                        </span>
                        {line}
                      </div>
                    ))}
                    <div ref={endRef} />
                  </div>
                )
: (
                  <Empty className="min-h-52">
                    <EmptyHeader>
                      <EmptyTitle className="text-sm text-muted-foreground">
                        {stepState(version, step) === "pending"
                          ? "此步骤尚未执行，暂无日志"
                          : "没有错误日志"}
                      </EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                )}
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </TabsContent>
          ))}
        </Tabs>
        <div className="flex items-center justify-between border-t px-5 py-2.5 text-xs text-muted-foreground">
          <span>{visibleLogs.length} 行</span>
          <span>{follow ? "跟随已开启" : "跟随已暂停"}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
