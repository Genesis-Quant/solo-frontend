import { create } from "zustand";
import { client } from "@/assets/lib/request";
import type { ProjectKind, ResearchProject } from "@/types/research";

interface ResearchStore {
  projects: ResearchProject[];
  loading: boolean;
  error: string;
  loadProjects: () => Promise<void>;
  createProject: (name: string, description: string, kind: ProjectKind, schemeVersion: string, algoVersion: string) => Promise<string>;
  editProject: (id: string, name: string, description: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  publishVersion: (projectId: string, versionId: string) => Promise<void>;
}

function projectFromApi(project: ResearchProject): ResearchProject {
  return { ...project, updatedAt: new Date(project.updatedAt).toLocaleString("sv-SE").slice(0, 16) };
}

export const useResearchStore = create<ResearchStore>((set, get) => ({
  projects: [],
  loading: true,
  error: "",
  loadProjects: async () => {
    if (!get().projects.length) set({ loading: true, error: "" });
    try {
      const projects = await client.get<ResearchProject[]>("/projects");
      set({ projects: projects.map(projectFromApi), loading: false, error: "" });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "无法加载项目", loading: false });
    }
  },
  createProject: async (name, description, kind, schemeVersion, algoVersion) => {
    const project = projectFromApi(await client.post<ResearchProject>("/projects", {
      name, description, kind, scheme_version: schemeVersion, algo_version: algoVersion
    }));
    set((state) => ({ projects: [project, ...state.projects] }));
    return project.id;
  },
  editProject: async (id, name, description) => {
    const project = projectFromApi(await client.patch<ResearchProject>(`/projects/${id}`, { name, description }));
    set((state) => ({ projects: state.projects.map((item) => item.id === id ? project : item) }));
  },
  removeProject: async (id) => {
    await client.delete(`/projects/${id}`);
    set((state) => ({ projects: state.projects.filter((project) => project.id !== id) }));
  },
  publishVersion: async () => {
    set({ error: "研究版本发布接口尚未接入" });
  }
}));
