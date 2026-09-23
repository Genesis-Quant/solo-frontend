import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { getInstanceByDom, init, use, type EChartsCoreOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

import { formatChartTooltipValue } from "@/assets/lib/chart";

use([BarChart, HeatmapChart, LineChart, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const RESIZE_SETTLE_MS = 100;

export default function EChart({ height, onDataZoomChange, option }: { height: number; onDataZoomChange?: (event: unknown) => void; option: EChartsCoreOption }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return undefined;
    const chart = init(container.current);
    let resizeTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => chart.resize(), RESIZE_SETTLE_MS);
    });
    observer.observe(container.current);
    return () => {
      window.clearTimeout(resizeTimer);
      observer.disconnect();
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    const chart = container.current ? getInstanceByDom(container.current) : undefined;
    chart?.setOption(withTooltipValueFormatter(option), { notMerge: true });
  }, [option]);

  useEffect(() => {
    const chart = container.current ? getInstanceByDom(container.current) : undefined;
    if (!chart || !onDataZoomChange) return undefined;
    chart.on("datazoom", onDataZoomChange);
    return () => { chart.off("datazoom", onDataZoomChange); };
  }, [onDataZoomChange]);

  return <div ref={container} style={{ height }} />;
}

function withTooltipValueFormatter(option: EChartsCoreOption): EChartsCoreOption {
  const tooltip = (option as { tooltip?: unknown }).tooltip;
  if (!tooltip || Array.isArray(tooltip) || typeof tooltip !== "object") return option;
  const tooltipOption = tooltip as Record<string, unknown>;
  if (tooltipOption.show === false || typeof tooltipOption.valueFormatter === "function") return option;
  return { ...option, tooltip: { ...tooltipOption, valueFormatter: formatChartTooltipValue } };
}
