import { create } from "zustand";
import { client } from "@/assets/lib/request";
import { RequestError } from "@/assets/lib/requestError";
import type { ProjectKind, ResearchProject, ResearchVersion } from "@/types/research";

interface ResearchStore {
  projects: ResearchProject[];
  loaded: boolean;
  loading: boolean;
  error: string;
  loadProjects: () => Promise<void>;
  createProject: (name: string, description: string, kind: ProjectKind, schemeVersion: string, algoVersion: string) => Promise<string>;
  editProject: (id: string, name: string, description: string) => Promise<void>;
  removeProject: (id: string, deleteFiles?: boolean) => Promise<void>;
  publishVersion: (projectId: string, versionId: string) => Promise<ResearchVersion>;
}

function projectFromApi(project: ResearchProject): ResearchProject {
  return { ...project, updatedAt: new Date(project.updatedAt).toLocaleString("sv-SE").slice(0, 16) };
}

function reconcileVersion(current: ResearchVersion | undefined, incoming: ResearchVersion): ResearchVersion {
  // A saved run cannot restart, but publication and artifact state can change independently.
  // Pre-mutation GETs are already suppressed by loadProjects' generation checks.
  if (current && current.status !== "running" && current.phase !== "submit_failed" && incoming.status === "running") {
    return {
      ...current,
      publishStatus: incoming.publishStatus,
      artifactId: incoming.artifactId,
      artifact: incoming.artifact,
      files: incoming.files,
      publishError: incoming.publishError
    };
  }
  return incoming;
}

function reconcileProject(current: ResearchProject | undefined, incoming: ResearchProject): ResearchProject {
  const versions = new Map(current?.versions.map((version) => [version.id, version]));
  return { ...incoming, versions: incoming.versions.map((version) => reconcileVersion(versions.get(version.id), version)) };
}

export const useResearchStore = create<ResearchStore>((set, get) => {
  let requestSequence = 0;
  let mutationGeneration = 0;
  const projectGenerations = new Map<string, number>();
  const deletedGenerations = new Map<string, number>();
  const markChanged = (id: string) => projectGenerations.set(id, ++mutationGeneration);
  const removeCached = (id: string) => {
    deletedGenerations.set(id, ++mutationGeneration);
    projectGenerations.delete(id);
    set((state) => ({ projects: state.projects.filter((project) => project.id !== id) }));
  };

  return {
    projects: [],
    loaded: false,
    loading: true,
    error: "",
    loadProjects: async () => {
      const request = ++requestSequence;
      const startedAt = mutationGeneration;
      if (!get().loaded) set({ loading: true, error: "" });
      try {
        const projects = await client.get<ResearchProject[]>("/projects");
        if (request !== requestSequence) return;
        set((state) => {
          const current = new Map(state.projects.map((project) => [project.id, project]));
          const modified = new Map(state.projects
            .filter((project) => (projectGenerations.get(project.id) ?? 0) > startedAt)
            .map((project) => [project.id, project]));
          const incoming = projects.filter((project) => (deletedGenerations.get(project.id) ?? 0) <= startedAt);
          const serverIds = new Set(incoming.map((project) => project.id));
          projectGenerations.clear();
          deletedGenerations.clear();
          return {
            projects: [
              ...Array.from(modified.values()).filter((project) => !serverIds.has(project.id)),
              ...incoming.map((project) => modified.get(project.id) ?? reconcileProject(current.get(project.id), projectFromApi(project)))
            ],
            loaded: true,
            loading: false,
            error: ""
          };
        });
      } catch (cause) {
        if (request !== requestSequence) return;
        set({ loading: false, ...startedAt === mutationGeneration ? { error: cause instanceof Error ? cause.message : "无法加载项目" } : {} });
      }
    },
    createProject: async (name, description, kind, schemeVersion, algoVersion) => {
      const project = projectFromApi(await client.post<ResearchProject>("/projects", {
        name, description, kind, scheme_version: schemeVersion, algo_version: algoVersion
      }));
      markChanged(project.id);
      set((state) => ({ projects: [project, ...state.projects.filter((item) => item.id !== project.id)] }));
      return project.id;
    },
    editProject: async (id, name, description) => {
      const project = projectFromApi(await client.patch<ResearchProject>(`/projects/${id}`, { name, description }));
      markChanged(id);
      set((state) => ({ projects: state.projects.map((item) => item.id === id ? reconcileProject(item, project) : item) }));
    },
    removeProject: async (id, deleteFiles = true) => {
      try {
        await client.delete(`/projects/${id}?delete_files=${deleteFiles}`);
      } catch (cause) {
        // Cleanup may fail after the DB commit. Keep the caller's original UUID for retry.
        if (cause instanceof RequestError && cause.deleted === true && cause.id === id) removeCached(id);
        throw cause;
      }
      removeCached(id);
    },
    publishVersion: async (projectId, versionId) => {
      const version = await client.post<ResearchVersion>(`/projects/${projectId}/versions/${versionId}/publish`, {});
      markChanged(projectId);
      set((state) => ({ projects: state.projects.map((project) => project.id === projectId
        ? { ...project, versions: project.versions.map((current) => current.id === versionId ? reconcileVersion(current, version) : current) }
        : project) }));
      return version;
    }
  };
});
