import { create } from "zustand";
import { persist } from "zustand/middleware";

import { initialProjects } from "@/assets/lib/prototype";
import type { ProjectKind, ResearchProject } from "@/types/research";

interface ResearchStore {
  projects: ResearchProject[];
  createProject: (
    name: string,
    description: string,
    kind: ProjectKind,
    template: string
  ) => string;
  editProject: (id: string, name: string, description: string) => void;
  removeProject: (id: string) => void;
  publishVersion: (projectId: string, versionId: string) => Promise<void>;
}

export const useResearchStore = create<ResearchStore>()(
  persist(
    (set, get) => ({
      projects: initialProjects,
      createProject: (name, description, kind, template) => {
        const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
        set((state) => ({
          projects: [
            {
              id,
              name,
              description,
              kind,
              template,
              updatedAt: new Date().toLocaleString("sv-SE").slice(0, 16),
              archived: false,
              versions: []
            },
            ...state.projects
          ]
        }));
        return id;
      },
      editProject: (id, name, description) =>
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id ? { ...project, name, description } : project
          )
        })),
      removeProject: (id) =>
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id ? { ...project, archived: true } : project
          )
        })),
      publishVersion: async (projectId, versionId) => {
        const target = get()
          .projects.find((p) => p.id === projectId)
          ?.versions.find((v) => v.id === versionId);
        if (
          !target ||
          target.status !== "success" ||
          target.publishStatus === "published" ||
          target.publishStatus === "checking"
        )
          return;
        const update = (publishStatus: "checking" | "published" | "failed") =>
          set((state) => ({
            projects: state.projects.map((p) =>
              p.id === projectId
                ? {
                    ...p,
                    versions: p.versions.map((v) =>
                      v.id === versionId ? { ...v, publishStatus } : v
                    )
                  }
                : p
            )
          }));
        update("checking");
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        update(target.publishError ? "failed" : "published");
      }
    }),
    {
      name: "solo.prototype.research",
      version: 1,
      partialize: (state) => ({
        projects: state.projects.map((p) => ({
          ...p,
          versions: p.versions.map((v) =>
            v.publishStatus === "checking"
              ? { ...v, publishStatus: "unpublished" as const }
              : v
          )
        }))
      })
    }
  )
);
