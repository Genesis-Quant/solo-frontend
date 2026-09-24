import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { useResearchStore } from "@/store/research";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/skeleton";

import AppLayout from "@/layout/AppLayout";
import { projectKinds } from "@/types/research";
import ProjectsPage from "@/views/ProjectsPage";
import ProjectPage from "@/views/ProjectPage";
import TasksPage from "@/views/TasksPage";

export default function App() {
  const load = useResearchStore((state) => state.loadProjects);
  const loading = useResearchStore((state) => state.loading);
  const error = useResearchStore((state) => state.error);
  useEffect(() => { void load(); }, [load]);
  return (
    <AppLayout>
      {loading ? <div className="space-y-5 p-8" aria-label="加载项目"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div> : error ? (
        <Alert variant="destructive" className="m-8 w-auto"><AlertDescription>{error}<Button variant="outline" onClick={() => void load()}>重新加载</Button></AlertDescription></Alert>
      ) : (
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
        <Route path="*" element={<Navigate to="/projects/factor" replace />} />
      </Routes>
      )}
    </AppLayout>
  );
}
