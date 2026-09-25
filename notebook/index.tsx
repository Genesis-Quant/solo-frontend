import { createRoot } from "react-dom/client";
import { Moon, Sun } from "lucide-react";
import ResearchReport from "@/components/panel/ResearchReport";
import type { ReportData } from "@/assets/lib/reports";
import { useAppStore } from "@/store";
import { Button } from "@/ui/button";
import "@/assets/styles/tailwind.css";
import "@/assets/styles/base.less";

declare global {
  interface Window {
    __SCHEME_REPORT__: ReportData & { theme: "light" | "dark" };
  }
}

const report = window.__SCHEME_REPORT__;
useAppStore.getState().setTheme(report.theme);

function NotebookReport() {
  const { theme, setTheme } = useAppStore();
  return <main className="mx-auto max-w-[1600px] space-y-4 p-4">
    <header className="flex items-center justify-between">
      <h1 className="text-lg font-semibold">{report.kind === "factor" ? "因子分析报告" : "策略回测报告"}</h1>
      <Button variant="ghost" size="icon" aria-label="切换日间或夜间模式" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
        {theme === "dark" ? <Sun /> : <Moon />}
      </Button>
    </header>
    <ResearchReport report={report} workflowId={1} />
  </main>;
}

createRoot(document.getElementById("root")!).render(<NotebookReport />);
