import type { ReactNode } from "react";

import { cn } from "@/assets/lib/utils";
import { terminalStates } from "@/types/workflow";

const schedulerStateLabels: Record<string, string> = {
  RUNNING_EXECUTION: "RUNNING",
  SUBMITTED_SUCCESS: "WAITING",
  WAIT_TO_RUN: "WAITING",
  SERIAL_WAIT: "WAITING",
  DELAY_EXECUTION: "DELAYED",
  READY_BLOCK: "BLOCKED",
  READY_PAUSE: "PAUSING",
  READY_STOP: "STOPPING",
  NEED_FAULT_TOLERANCE: "RECOVERING",
  FORCED_SUCCESS: "FORCED",
  SUBMIT_FAILED: "FAILED",
  RETRYING: "RETRYING",
  AUTO_SAVE_PENDING: "SAVING",
  AUTO_SAVE_FAILED: "SAVE FAILED",
  RESULT_PENDING: "RESULT PENDING",
  RESULT_FAILED: "RESULT FAILED"
};

export function schedulerStateLabel(state: string) { return schedulerStateLabels[state] ?? state; }

export type SchedulerStateTone = "blue" | "green" | "amber" | "red" | "neutral";

const schedulerStateToneClasses: Record<SchedulerStateTone, string> = {
  blue: "text-sky-600 dark:text-sky-400",
  green: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground"
};

const successStates = new Set(["SUCCESS", "FORCED_SUCCESS"]);
const runningStates = new Set(["RUNNING_EXECUTION", "DISPATCH", "RETRYING"]);
const queuedStates = new Set([
  "CREATED",
  "QUEUED",
  "SUBMITTING",
  "SUBMITTED",
  "AUTO_SAVE_PENDING",
  "RESULT_PENDING",
  "SUBMITTED_SUCCESS",
  "WAITING",
  "WAIT_TO_RUN",
  "SERIAL_WAIT",
  "DELAY_EXECUTION",
  "READY_BLOCK",
  "BLOCK"
]);
const pausedStates = new Set(["READY_PAUSE", "PAUSE"]);
const stoppingStates = new Set(["READY_STOP", "NEED_FAULT_TOLERANCE"]);

export function schedulerStateTone(state: string): SchedulerStateTone {
  if (successStates.has(state)) return "green";
  if (terminalStates.has(state)) return "red";
  if (runningStates.has(state)) return "blue";
  if (queuedStates.has(state)) return "amber";
  if (pausedStates.has(state)) return "neutral";
  if (stoppingStates.has(state)) return "red";
  return "neutral";
}

export default function SchedulerState({ className, label, state, title }: { className?: string; label?: ReactNode; state: string; title?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs", schedulerStateToneClasses[schedulerStateTone(state)], className)} title={title}>{label ?? schedulerStateLabel(state)}</span>;
}
