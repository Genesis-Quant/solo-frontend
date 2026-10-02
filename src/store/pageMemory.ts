import { useCallback } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { kindLabels, projectKinds } from "@/types/research";

/** 一级页面：侧栏直达的列表页，离开后需要保留筛选、分页、排序和滚动位置。 */
export const primaryPages: { path: string; label: string }[] = [
  ...projectKinds.map((kind) => ({ path: `/projects/${kind}`, label: kindLabels[kind] })),
  { path: "/strategies", label: "策略组装" },
  { path: "/tasks", label: "全部任务" }
];

const lastPageKey = "solo.last-page";

export function isPrimaryPage(pathname: string) {
  return primaryPages.some((page) => page.path === pathname);
}

export function rememberPrimaryPage(pathname: string) {
  if (isPrimaryPage(pathname)) localStorage.setItem(lastPageKey, pathname);
}

export function lastPrimaryPage() {
  const stored = localStorage.getItem(lastPageKey);
  return stored && isPrimaryPage(stored) ? stored : primaryPages[0].path;
}

type PageMemoryStore = {
  pages: Record<string, Record<string, unknown>>;
  scroll: Record<string, number>;
  patch: (scope: string, name: string, value: unknown) => void;
  saveScroll: (pathname: string, top: number) => void;
};

/** 会话级记忆：刷新页面仍保留，关闭标签页后清空。 */
export const usePageMemory = create<PageMemoryStore>()(persist((set) => ({
  pages: {},
  scroll: {},
  patch: (scope, name, value) => set((state) => ({
    pages: { ...state.pages, [scope]: { ...state.pages[scope], [name]: value } }
  })),
  saveScroll: (pathname, top) => set((state) => ({ scroll: { ...state.scroll, [pathname]: top } }))
}), { name: "solo.page-memory", storage: createJSONStorage(() => sessionStorage) }));

/** 与 useState 相同的用法，但值按 scope 保存在页面记忆中。 */
export function usePageState<T>(scope: string, name: string, initial: T): [T, (value: T) => void] {
  const stored = usePageMemory((state) => state.pages[scope]?.[name]) as T | undefined;
  const patch = usePageMemory((state) => state.patch);
  const update = useCallback((value: T) => patch(scope, name, value), [name, patch, scope]);
  return [stored ?? initial, update];
}
