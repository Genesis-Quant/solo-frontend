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
import ArtifactsPage from "@/views/ArtifactsPage";
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
  const loaded = useResearchStore((state) => state.loaded);
  const loading = useResearchStore((state) => state.loading);
  const error = useResearchStore((state) => state.error);
  const strategiesLoaded = useStrategyStore((state) => state.loaded);
  const { pathname } = useLocation();
  const needsStrategies = pathname === "/strategies" || pathname === "/tasks";
  const needsResearch = pathname.startsWith("/projects/") || pathname === "/tasks";
  const contentReady = (!needsResearch || loaded && !loading) && (!needsStrategies || strategiesLoaded);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (stopped) return;
      if (!document.hidden) await load();
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [load]);
  return (
    <AppLayout contentReady={contentReady}>
      {needsResearch && loading && !loaded
? <div className="mx-auto w-full max-w-[1600px] space-y-6 p-5 md:p-8" aria-label="加载项目"><Skeleton className="h-9 w-48" /><Skeleton className="h-96 w-full" /></div>
: needsResearch && error && !loaded
? (
        <div className="p-5 md:p-8"><Alert variant="destructive" className="component-fade-in"><AlertDescription>{error}<Button variant="outline" onClick={() => load()}>重新加载</Button></AlertDescription></Alert></div>
      )
: (
      <div key={pathname} className="page-enter h-full">
      {needsResearch && error && <Alert variant="destructive" className="mx-5 mt-5"><AlertDescription>项目刷新失败：{error}<Button variant="outline" onClick={() => load()}>重试</Button></AlertDescription></Alert>}
      <Routes>
        {projectKinds.map((kind) =>
          <Route
            key={kind}
            path={`/projects/${kind}`}
            element={<ProjectsPage key={kind} kind={kind} />}
          />
        )}
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/artifacts" element={<ArtifactsPage />} />
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
