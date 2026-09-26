import { ChevronRight } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { cn } from "@/assets/lib/utils";
import AnimatedCollapse from "@/components/panel/AnimatedCollapse";
import { groupTaskLogSections, parseTaskLog, type ParsedTaskLogLine, type TaskLogGroup, type TaskLogLevel } from "@/assets/lib/taskLogs";

const LEVEL_STYLES: Record<TaskLogLevel, { badge: string; line: string }> = {
  TRACE: { badge: "text-slate-500 dark:text-slate-400", line: "hover:bg-slate-500/5" },
  DEBUG: { badge: "text-cyan-700 dark:text-cyan-300", line: "hover:bg-cyan-500/5" },
  INFO: { badge: "text-blue-700 dark:text-blue-300", line: "hover:bg-blue-500/5" },
  SUCCESS: { badge: "text-emerald-700 dark:text-emerald-300", line: "border-l-emerald-500/60 bg-emerald-500/5 hover:bg-emerald-500/10" },
  WARNING: { badge: "text-amber-700 dark:text-amber-300", line: "border-l-amber-500/70 bg-amber-500/7 hover:bg-amber-500/12" },
  ERROR: { badge: "text-red-700 dark:text-red-300", line: "border-l-red-500/70 bg-red-500/7 hover:bg-red-500/12" },
  CRITICAL: { badge: "font-bold text-rose-700 dark:text-rose-300", line: "border-l-rose-600 bg-rose-500/10 hover:bg-rose-500/15" },
  SYSTEM: { badge: "text-violet-700 dark:text-violet-300", line: "hover:bg-violet-500/5" }
};

export default function TaskLogViewer({ emptyMessage, lineOffset = 0, message }: { emptyMessage: string; lineOffset?: number; message: string }) {
  const lines = useMemo(() => parseTaskLog(message).map((line) => ({ ...line, lineNumber: line.lineNumber + lineOffset })), [lineOffset, message]);
  const groups = useMemo(() => groupTaskLogSections(lines), [lines]);
  const usesLongTimestamp = lines.some((line) => timestampUsesDate(line.timestamp));
  if (!lines.length) return <div className="grid min-h-72 place-items-center px-5 text-xs text-muted-foreground">{emptyMessage}</div>;

  return <div aria-label="Task 日志内容" className="min-h-72 w-full min-w-[50rem] py-2 font-mono text-[11px] leading-5" role="log">
    {groups.map((group) => group.title
      ? <TaskLogSection group={group} key={group.key} usesLongTimestamp={usesLongTimestamp} />
      : <TaskLogRows key={group.key} lines={group.lines} usesLongTimestamp={usesLongTimestamp} />)}
  </div>;
}

function TaskLogSection({ group, usesLongTimestamp }: { group: TaskLogGroup; usesLongTimestamp: boolean }) {
  const [open, setOpen] = useState(group.title === "Task Output");
  const contentId = useId();
  const firstLine = group.lines[0]?.lineNumber;
  const lastLine = group.lines.at(-1)?.lineNumber;
  return <section className={cn("border-y border-border/60 transition-colors", open ? "bg-transparent" : "bg-background/20")}>
    <button aria-controls={contentId} aria-expanded={open} className="sticky top-0 z-[1] flex w-full cursor-pointer items-center gap-2 bg-muted/85 px-3 py-2 text-left font-sans text-xs font-semibold backdrop-blur transition-colors hover:bg-muted" type="button" onClick={() => setOpen((value) => !value)}>
      <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-90")} />
      <span>{group.title}</span>
      <span className="font-mono text-[10px] font-normal text-muted-foreground">{group.lines.length.toLocaleString()} 行</span>
      {firstLine && lastLine ? <span className="ml-auto font-mono text-[10px] font-normal text-muted-foreground">L{firstLine}–{lastLine}</span> : null}
    </button>
    <AnimatedCollapse id={contentId} open={open}><TaskLogRows lines={group.lines} usesLongTimestamp={usesLongTimestamp} /></AnimatedCollapse>
  </section>;
}

function TaskLogRows({ lines, usesLongTimestamp }: { lines: ParsedTaskLogLine[]; usesLongTimestamp: boolean }) {
  return lines.map((line) => <TaskLogRow key={line.lineNumber} line={line} usesLongTimestamp={usesLongTimestamp} />);
}

function TaskLogRow({ line, usesLongTimestamp }: { line: ParsedTaskLogLine; usesLongTimestamp: boolean }) {
  const style = line.level ? LEVEL_STYLES[line.level] : null;
  const timestampTitle = line.outerTimestamp
    ? `Loguru: ${line.timestamp ?? "—"}\nDolphinScheduler: ${line.outerTimestamp}`
    : line.timestamp ?? undefined;
  return <div className={cn(
    "group grid min-h-5 border-l-2 border-l-transparent px-2 transition-colors",
    usesLongTimestamp
      ? "grid-cols-[3.25rem_8rem_4.25rem_minmax(0,1fr)]"
      : "grid-cols-[3.25rem_4.25rem_4.25rem_minmax(0,1fr)]",
    style?.line
  )}>
    <span className="select-none pr-3 text-right text-muted-foreground/45">{line.lineNumber}</span>
    <span className="truncate pr-4 font-medium text-sky-700 dark:text-sky-300" title={timestampTitle}>{formatLogTimestamp(line.timestamp)}</span>
    <span className={cn("pr-3 font-semibold", style?.badge)}>{line.level ?? ""}</span>
    <span className="whitespace-pre-wrap break-words pr-5">
      {line.format === "dolphinscheduler" ? <LogSource>DS</LogSource> : null}
      {line.file ? <PythonSource file={line.file} functionName={line.functionName} line={line.sourceLine} title={line.source ?? undefined} /> : line.source && line.source !== "DolphinScheduler" ? <LogSource title={line.source}>{line.source}</LogSource> : null}
      <span className={line.format === "traceback" ? "text-red-700 dark:text-red-300" : "text-foreground/90"}>{line.message || " "}</span>
    </span>
  </div>;
}

function LogSource({ children, title }: { children: string; title?: string }) {
  return <span className="mr-2 inline-block max-w-64 truncate align-bottom text-[10px] text-muted-foreground" title={title}>{children}</span>;
}

function PythonSource({ file, functionName, line, title }: { file: string; functionName: string | null; line: number | null; title?: string }) {
  return <span className="mr-2 inline-flex max-w-72 items-baseline gap-1 truncate align-bottom text-[10px]" title={title}>
    <span className="truncate font-semibold text-violet-700 dark:text-violet-300">{file}</span>
    {functionName ? <><span className="text-muted-foreground/50">·</span><span className="truncate font-medium text-cyan-700 dark:text-cyan-300">{functionName}</span></> : null}
    {line !== null ? <span className="text-amber-700 dark:text-amber-300">:{line}</span> : null}
  </span>;
}

function formatLogTimestamp(value: string | null) {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!match) return value;
  const [, year, month, day, time] = match;
  const now = new Date();
  const sameYear = Number(year) === now.getFullYear();
  const sameDay = sameYear && Number(month) === now.getMonth() + 1 && Number(day) === now.getDate();
  if (sameDay) return time;
  return sameYear ? `${month}-${day} ${time}` : `${year.slice(-2)}-${month}-${day} ${time}`;
}

function timestampUsesDate(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;
  const [, year, month, day] = match;
  const now = new Date();
  return Number(year) !== now.getFullYear() || Number(month) !== now.getMonth() + 1 || Number(day) !== now.getDate();
}
