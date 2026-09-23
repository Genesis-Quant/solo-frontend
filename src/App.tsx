import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "@/layout/AppLayout";
import { projectKinds } from "@/types/research";
import ProjectsPage from "@/views/ProjectsPage";
import ProjectPage from "@/views/ProjectPage";
import TasksPage from "@/views/TasksPage";

export default function App() {
  return (
    <AppLayout>
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
    </AppLayout>
  );
}
