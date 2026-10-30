import { useEffect } from "react";
import { create } from "zustand";

import { client } from "@/assets/lib/request";
import { taskActive, type TaskRecord } from "@/types/task";

interface TaskStore {
  records: TaskRecord[];
  loaded: boolean;
  loading: boolean;
  error: string;
  pending: Record<string, "stop" | "retry">;
  load: () => Promise<void>;
  forget: (id: string) => void;
  control: (record: TaskRecord, action: "stop" | "retry") => Promise<TaskRecord>;
}

// Control snapshots can lag polling; fresh GETs remain authoritative for server corrections.
function mergeControlResponse(current: TaskRecord, incoming: TaskRecord): TaskRecord {
  if (incoming.attempt < current.attempt) return current;
  if (incoming.attempt === current.attempt && !taskActive(current.status)) return current;
  return incoming;
}

export const useTaskStore = create<TaskStore>((set, get) => {
  let sequence = 0;
  let generation = 0;
  const changed = new Map<string, number>();
  const deleted = new Set<string>();
  return {
    records: [], loaded: false, loading: false, error: "", pending: {},
    load: async () => {
      const request = ++sequence;
      const started = generation;
      set({ loading: true });
      try {
        const records = await client.get<TaskRecord[]>("/tasks");
        if (request !== sequence) return;
        set((state) => {
          const existing = new Map(state.records.map((record) => [record.id, record]));
          return {
            records: records.filter((record) => !deleted.has(record.id)).map((record) => {
              if ((changed.get(record.id) ?? 0) > started) return existing.get(record.id) ?? record;
              return record;
            }),
            loaded: true, loading: false, error: ""
          };
        });
      } catch (cause) {
        if (request === sequence) set({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    },
    forget: (id) => {
      deleted.add(id);
      set((state) => ({ records: state.records.filter((record) => record.id !== id) }));
    },
    control: async (record, action) => {
      if (get().pending[record.id]) throw new Error("该任务操作正在提交");
      const current = get().records.find((item) => item.id === record.id);
      if (!current || current.attempt !== record.attempt) throw new Error("任务轮次已变化，请刷新后确认");
      set((state) => ({ pending: { ...state.pending, [record.id]: action } }));
      try {
        const updated = await client.post<TaskRecord>(`/tasks/${record.id}/${action}`, { attempt: record.attempt });
        changed.set(record.id, ++generation);
        let merged = updated;
        set((state) => ({
          records: state.records.map((item) => {
            if (item.id !== updated.id) return item;
            merged = mergeControlResponse(item, updated);
            return merged;
          })
        }));
        return merged;
      } finally {
        set((state) => {
          const pending = { ...state.pending };
          delete pending[record.id];
          return { pending };
        });
      }
    }
  };
});

export function useTaskPolling() {
  const load = useTaskStore((state) => state.load);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed) return;
      if (!document.hidden) await load();
      if (!disposed) timer = setTimeout(poll, 2500);
    };
    poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [load]);
}
