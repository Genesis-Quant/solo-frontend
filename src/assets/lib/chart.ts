import type { AxisFormat, ChartRange } from "@/types/chart";

export function chartRange(values: Array<number | null | undefined>, includeZero = false): ChartRange | undefined {
  let min = includeZero ? 0 : Number.POSITIVE_INFINITY;
  let max = includeZero ? 0 : Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    count += 1;
  }
  return count ? { min, max } : undefined;
}

export function chartRangeIncluding(range: ChartRange | undefined, value: number): ChartRange | undefined {
  return range ? { min: Math.min(range.min, value), max: Math.max(range.max, value) } : undefined;
}

export function thresholdMarkLine(theme: string, label: string, value: number) {
  const color = theme === "dark" ? "#94a3b8" : "#64748b";
  const backgroundColor = theme === "dark" ? "rgba(21, 27, 36, 0.92)" : "rgba(255, 255, 255, 0.92)";
  return {
    silent: true,
    symbol: "none",
    data: [{ yAxis: value }],
    label: { show: true, formatter: label, position: "insideEndTop", color, backgroundColor, borderRadius: 3, padding: [2, 4], fontSize: 10 },
    lineStyle: { color, type: "dashed", width: 1 }
  };
}

export function mergeChartRanges(...ranges: Array<ChartRange | undefined>): ChartRange | undefined {
  const present = ranges.filter((range): range is ChartRange => range !== undefined);
  if (!present.length) return undefined;
  let min = Math.min(...present.map((range) => range.min));
  let max = Math.max(...present.map((range) => range.max));
  if (min === max) {
    const padding = Math.abs(min) * 0.05 || 1;
    min -= padding;
    max += padding;
  }
  const interval = niceInterval((max - min) / 5);
  return { min: cleanNumber(Math.floor(min / interval) * interval), max: cleanNumber(Math.ceil(max / interval) * interval) };
}

export function formatAxisLabel(value: number, format: AxisFormat = "decimal") {
  if (!Number.isFinite(value)) return String(value);
  if (format === "integer") return Math.round(value).toLocaleString("zh-CN");
  const display = format === "percent" ? value * 100 : value;
  if (Math.abs(display) >= 1e8 || Math.abs(display) < 1e-5 && display !== 0) return `${display.toExponential(2)}${format === "percent" ? "%" : ""}`;
  return `${Number(display.toFixed(format === "percent" ? 2 : 4))}${format === "percent" ? "%" : ""}`;
}

export function formatChartTooltipValue(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value === null || value === undefined ? "—" : String(value);
  if (value === 0) return "0";
  return Math.abs(value) < 1 ? value.toPrecision(3) : value.toFixed(3);
}

function niceInterval(value: number) {
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

function cleanNumber(value: number) { return Number(value.toPrecision(12)); }
