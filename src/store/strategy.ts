import { useEffect } from "react";
import { create } from "zustand";

import { client } from "@/assets/lib/request";
import { strategyActive, type StrategyRecord } from "@/types/strategy";

interface StrategyStore {
  records: StrategyRecord[];
  loaded: boolean;
  error: string;
  load: () => Promise<void>;
  seedCreated: (record: StrategyRecord) => void;
  upsert: (record: StrategyRecord) => StrategyRecord;
}

function reconcileRecord(current: StrategyRecord | undefined, incoming: StrategyRecord, preserveCurrent = false): StrategyRecord {
  if (!current) return incoming;
  // 同一 ID 是不可重启的一次运行；活动快照不能覆盖已确认的终态。
  if ((current.status === "success" || current.status === "failed") && strategyActive(incoming.status)) return current;
  if (strategyActive(current.status) && (incoming.status === "success" || incoming.status === "failed")) return incoming;
  return preserveCurrent ? current : incoming;
}

/** 策略列表在策略页和任务页之间共享，返回页面时先展示缓存再后台刷新。 */
export const useStrategyStore = create<StrategyStore>((set, get) => {
  let requestSequence = 0;
  let mutationGeneration = 0;
  const recordGenerations = new Map<string, number>();

  return {
    records: [],
    loaded: false,
    error: "",
    load: async () => {
      const request = ++requestSequence;
      const startedAt = mutationGeneration;
      try {
        const records = await client.get<StrategyRecord[]>("/strategies");
        if (request !== requestSequence) return;
        set((state) => {
          // 保留请求期间的逐条写入，但终态仍优先于活动快照；其它记录以列表为准，包括删除。
          const current = new Map(state.records.map((record) => [record.id, record]));
          const modified = new Map(state.records
            .filter((record) => (recordGenerations.get(record.id) ?? 0) > startedAt)
            .map((record) => [record.id, record]));
          const serverIds = new Set(records.map((record) => record.id));
          // 旧请求已失效，后续请求会从当前写入代次开始，不再需要这些标记。
          recordGenerations.clear();
          return {
            records: [
              ...Array.from(modified.values()).filter((record) => !serverIds.has(record.id)),
              ...records.map((record) => reconcileRecord(current.get(record.id), record, modified.has(record.id)))
            ],
            loaded: true,
            error: ""
          };
        });
      } catch (cause) {
        if (request !== requestSequence) return;
        set({ error: cause instanceof Error ? cause.message : String(cause) });
      }
    },
    seedCreated: (record) => {
      // 创建响应可能晚于轮询，只补入尚未缓存的策略。
      if (!get().records.some((item) => item.id === record.id)) get().upsert(record);
    },
    upsert: (record) => {
      const current = get().records.find((item) => item.id === record.id);
      const accepted = reconcileRecord(current, record);
      if (accepted === current) return accepted;
      recordGenerations.set(record.id, ++mutationGeneration);
      set((state) => ({
        records: current
          ? state.records.map((item) => item.id === record.id ? accepted : item)
          : [accepted, ...state.records]
      }));
      return accepted;
    }
  };
});

/** 页面可见时，在上一次刷新完成 5 秒后再次刷新，避免轮询请求重叠。 */
export function useStrategyPolling() {
  const load = useStrategyStore((state) => state.load);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (stopped) return;
      if (!document.hidden) await load();
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load]);
}
