import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import IconCalendarRange from "~icons/lucide/calendar-range";
import IconRotateCcw from "~icons/lucide/rotate-ccw";

import EChart from "@/components/chart/EChart";
import { Button } from "@/ui/button";

type DateRangePoint = { time: string; value: number | null };
type DataZoomEvent = { batch?: DataZoomEvent[]; end?: number; endValue?: unknown; start?: number; startValue?: unknown };
type PointerDate = { date: string; position: number };

export default function DateRangeBar({ endDate, label = "报告区间", maximumDate, minimumDate, onRangeChange, onReset, points, startDate, theme }: { endDate: string; label?: string; maximumDate: string; minimumDate: string; onRangeChange: (start: string, end: string) => void; onReset: () => void; points: DateRangePoint[]; startDate: string; theme: string }) {
  const timer = useRef<number | null>(null);
  const displayFrame = useRef<number | null>(null);
  const pendingDisplay = useRef({ start: startDate, end: endDate });
  const pointerFrame = useRef<number | null>(null);
  const pointerClientX = useRef(0);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [pointerDate, setPointerDate] = useState<PointerDate | null>(null);
  const [displayStartDate, setDisplayStartDate] = useState(startDate);
  const [displayEndDate, setDisplayEndDate] = useState(endDate);
  const dates = useMemo(() => points.map((row) => row.time), [points]);
  const tradingDays = useMemo(() => dates.filter((date) => date >= displayStartDate && date <= displayEndDate).length, [dates, displayEndDate, displayStartDate]);
  const option = useMemo(() => dateRangeOption(points, startDate, endDate, theme), [endDate, points, startDate, theme]);
  const startPosition = datePosition(dates, displayStartDate);
  const endPosition = datePosition(dates, displayEndDate);
  const labelsOverlap = Math.abs(endPosition - startPosition) < 18;
  const showDisplayRange = useCallback((nextStart: string, nextEnd: string) => {
    pendingDisplay.current = { start: nextStart, end: nextEnd };
    if (displayFrame.current !== null) return;
    displayFrame.current = window.requestAnimationFrame(() => {
      setDisplayStartDate(pendingDisplay.current.start);
      setDisplayEndDate(pendingDisplay.current.end);
      displayFrame.current = null;
    });
  }, []);
  const commitRange = useCallback((nextStart: string, nextEnd: string) => {
    if (nextStart === startDate && nextEnd === endDate) return;
    onRangeChange(nextStart, nextEnd);
  }, [endDate, onRangeChange, startDate]);
  const changeRange = useCallback((event: unknown) => {
    const root = event as DataZoomEvent;
    const zoom = root.batch?.[0] ?? root;
    const nextStart = zoomDate(zoom.startValue, zoom.start, dates, "start");
    const nextEnd = zoomDate(zoom.endValue, zoom.end, dates, "end");
    if (!nextStart || !nextEnd) return;
    showDisplayRange(nextStart, nextEnd);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (dragging.current) return;
    timer.current = window.setTimeout(() => {
      commitRange(nextStart, nextEnd);
      timer.current = null;
    }, 250);
  }, [commitRange, dates, showDisplayRange]);

  const showPointerDate = useCallback((clientX: number) => {
    const bounds = track.current?.getBoundingClientRect();
    if (!bounds) return;
    const trackWidth = Math.max(1, bounds.width - 20);
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left - 10) / trackWidth));
    const index = Math.round(ratio * Math.max(0, dates.length - 1));
    const date = dates[index];
    if (date) setPointerDate({ date, position: dates.length > 1 ? index / (dates.length - 1) * 100 : 50 });
  }, [dates]);

  const showPointerDateNextFrame = useCallback((clientX: number) => {
    pointerClientX.current = clientX;
    if (pointerFrame.current !== null) return;
    pointerFrame.current = window.requestAnimationFrame(() => {
      showPointerDate(pointerClientX.current);
      pointerFrame.current = null;
    });
  }, [showPointerDate]);

  const hidePointerDate = useCallback(() => {
    if (pointerFrame.current !== null) window.cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = null;
    setPointerDate(null);
  }, []);

  function startDragging(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    pendingDisplay.current = { start: displayStartDate, end: displayEndDate };
    dragging.current = true;
    showPointerDateNextFrame(event.clientX);
  }

  useEffect(() => { setDisplayStartDate(startDate); setDisplayEndDate(endDate); }, [endDate, startDate]);
  useEffect(() => {
    function move(event: globalThis.PointerEvent) { if (dragging.current) showPointerDateNextFrame(event.clientX); }
    function finish(event: globalThis.PointerEvent) {
      if (!dragging.current) return;
      dragging.current = false;
      commitRange(pendingDisplay.current.start, pendingDisplay.current.end);
      const bounds = track.current?.getBoundingClientRect();
      if (!bounds || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) hidePointerDate();
      else showPointerDateNextFrame(event.clientX);
    }
    function cancel() {
      dragging.current = false;
      showDisplayRange(startDate, endDate);
      hidePointerDate();
    }
    window.addEventListener("pointermove", move, { capture: true, passive: true });
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", cancel, true);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", cancel, true);
    };
  }, [commitRange, endDate, hidePointerDate, showDisplayRange, showPointerDateNextFrame, startDate]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (displayFrame.current !== null) window.cancelAnimationFrame(displayFrame.current);
    if (pointerFrame.current !== null) window.cancelAnimationFrame(pointerFrame.current);
  }, []);
  if (!minimumDate || !maximumDate) return null;
  return <div className="rounded-md border bg-muted/20 px-3 pb-2 pt-2.5">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <IconCalendarRange className="text-muted-foreground" width={16} height={16} />
      <span className="font-medium">{label}</span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{displayStartDate}</span>
      <span className="text-xs text-muted-foreground">至</span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{displayEndDate}</span>
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{tradingDays.toLocaleString("zh-CN")} 个交易日</span>
      <Button aria-label={`恢复全部${label}`} className="size-8" disabled={startDate === minimumDate && endDate === maximumDate} size="icon" title="恢复全部区间" variant="ghost" onClick={onReset}><IconRotateCcw width={15} height={15} /></Button>
    </div>
    <div ref={track} aria-label={`拖动选择${label}`} className="relative h-[82px] min-w-0 w-full touch-none" onPointerDownCapture={startDragging} onPointerLeave={() => { if (!dragging.current) hidePointerDate(); }} onPointerMoveCapture={(event) => { if (!dragging.current) showPointerDate(event.clientX); }}>
      <EChart height={82} onDataZoomChange={changeRange} option={option} />
      <div className="pointer-events-none absolute inset-x-[10px] top-0 z-10 h-8">
        <DateLabel date={displayStartDate} position={startPosition} />
        <DateLabel date={displayEndDate} position={endPosition} secondRow={labelsOverlap} />
        {pointerDate ? <DateLabel date={pointerDate.date} position={pointerDate.position} tone="hover" /> : null}
      </div>
    </div>
  </div>;
}

function DateLabel({ date, position, secondRow = false, tone = "handle" }: { date: string; position: number; secondRow?: boolean; tone?: "handle" | "hover" }) {
  const transform = position < 8 ? "translateX(0)" : position > 92 ? "translateX(-100%)" : "translateX(-50%)";
  const positionClass = tone === "hover" ? "top-[42px]" : secondRow ? "top-5" : "top-0";
  return <span className={`absolute whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] leading-4 tabular-nums shadow-sm ${positionClass} ${tone === "hover" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"}`} style={{ left: `${position}%`, transform }}>{date}</span>;
}

function dateRangeOption(rows: DateRangePoint[], startDate: string, endDate: string, theme: string) {
  const dark = theme === "dark";
  const accent = dark ? "#34d399" : "#059669";
  const preview = dark ? "#64748b" : "#94a3b8";
  const border = dark ? "#3f3f46" : "#d4d4d8";
  const background = dark ? "#18181b" : "#ffffff";
  return {
    animation: false,
    grid: { left: 10, right: 10, top: 26, bottom: 40 },
    tooltip: { show: false },
    xAxis: { type: "category", data: rows.map((row) => row.time), show: false },
    yAxis: { type: "value", show: false, scale: true },
    series: [{ type: "line", data: rows.map((row) => row.value ?? 0), showSymbol: false, lineStyle: { opacity: 0 } }],
    dataZoom: [{
      type: "slider",
      left: 10,
      right: 10,
      bottom: 0,
      height: 38,
      startValue: startDate,
      endValue: endDate,
      filterMode: "none",
      realtime: true,
      brushSelect: true,
      showDetail: false,
      backgroundColor: background,
      borderColor: border,
      fillerColor: dark ? "rgba(52,211,153,.16)" : "rgba(5,150,105,.12)",
      dataBackground: { lineStyle: { color: preview, opacity: 0.8, width: 1 }, areaStyle: { color: preview, opacity: dark ? 0.16 : 0.12 } },
      selectedDataBackground: { lineStyle: { color: accent, width: 1.4 }, areaStyle: { color: accent, opacity: dark ? 0.18 : 0.2 } },
      handleStyle: { color: background, borderColor: accent, borderWidth: 1.5 },
      moveHandleStyle: { color: accent, opacity: 0.22 }
    }]
  };
}

function datePosition(dates: string[], target: string) {
  if (dates.length <= 1) return 50;
  const exact = dates.indexOf(target);
  if (exact >= 0) return exact / (dates.length - 1) * 100;
  const next = dates.findIndex((date) => date >= target);
  const index = next < 0 ? dates.length - 1 : next;
  return index / (dates.length - 1) * 100;
}

function zoomDate(value: unknown, percent: number | undefined, dates: string[], edge: "start" | "end") {
  if (!dates.length) return "";
  if (typeof value === "string" && dates.includes(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return dates[Math.max(0, Math.min(dates.length - 1, Math.round(value)))] ?? "";
  if (typeof percent !== "number" || !Number.isFinite(percent)) return "";
  const position = Math.max(0, Math.min(dates.length - 1, percent / 100 * (dates.length - 1)));
  return dates[edge === "start" ? Math.floor(position) : Math.ceil(position)] ?? "";
}
