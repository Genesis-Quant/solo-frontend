import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { lastPrimaryPage } from "@/store/pageMemory";
import { useResearchStore } from "@/store/research";
import { useStrategyStore } from "@/store/strategy";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/skeleton";

import AppLayout from "@/layout/AppLayout";
import { projectKinds } from "@/types/research";
import ProjectsPage from "@/views/ProjectsPage";
import ProjectPage from "@/views/ProjectPage";
import TasksPage from "@/views/TasksPage";
import StrategiesPage from "@/views/StrategiesPage";
import StrategyPage from "@/views/StrategyPage";
import EmbeddedReportPage from "@/views/EmbeddedReportPage";

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Routes>
        <Route path="/embed/report" element={<EmbeddedReportPage />} />
        <Route path="*" element={<Workbench />} />
      </Routes>
    </MotionConfig>
  );
}

function Workbench() {
  const load = useResearchStore((state) => state.loadProjects);
  const loading = useResearchStore((state) => state.loading);
  const error = useResearchStore((state) => state.error);
  const strategiesLoaded = useStrategyStore((state) => state.loaded);
  const { pathname } = useLocation();
  const needsStrategies = pathname === "/strategies" || pathname === "/tasks";
  const contentReady = !loading && !error && (!needsStrategies || strategiesLoaded);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <AppLayout contentReady={contentReady}>
      {loading ? <div className="mx-auto w-full max-w-[1600px] space-y-6 p-5 md:p-8" aria-label="加载项目"><Skeleton className="h-9 w-48" /><Skeleton className="h-96 w-full" /></div> : error ? (
        <div className="p-5 md:p-8"><Alert variant="destructive" className="component-fade-in"><AlertDescription>{error}<Button variant="outline" onClick={() => void load()}>重新加载</Button></AlertDescription></Alert></div>
      ) : (
      <div key={pathname} className="page-enter h-full">
      <Routes>
        {projectKinds.map((kind) =>
          <Route
            key={kind}
            path={`/projects/${kind}`}
            element={<ProjectsPage key={kind} kind={kind} />}
          />
        )}
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/strategies" element={<StrategiesPage />} />
        <Route path="/strategies/:strategyId" element={<StrategyPage />} />
        <Route path="*" element={<Navigate to={lastPrimaryPage()} replace />} />
      </Routes>
      </div>
      )}
    </AppLayout>
  );
}
