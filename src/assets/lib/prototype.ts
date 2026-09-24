import type {
  ProjectKind,
  ResearchProject,
  ResearchVersion,
  TaskStep
} from "@/types/research";

// Frontend fixtures only. No research execution, package publishing or scheduler requests.
const names: Record<ProjectKind, string[]> = {
  factor: ["量价动量因子", "低波动因子", "质量与盈利因子"],
  model: ["多因子动量", "低波动选股", "质量成长模型"],
  optimize: ["风险平价组合", "波动率目标组合", "行业约束组合"],
  control: ["订单限额风控", "集中度风控", "流动性风控"],
  execution: ["分时均匀下单", "成交量跟随下单", "限价拆单"]
};
const descriptions: Record<ProjectKind, string[]> = {
  factor: [
    "成交量与价格动量的联合研究",
    "特质波动率与下行风险",
    "盈利质量与财务稳定性"
  ],
  model: [
    "结合量价信号的横截面选股模型",
    "低波动股票筛选与排序",
    "质量因子与成长特征建模"
  ],
  optimize: [
    "平衡组合内各资产的风险贡献",
    "按目标波动率调整仓位",
    "行业暴露与单一资产仓位约束"
  ],
  control: [
    "订单金额与交易数量检查",
    "账户持仓集中度检查",
    "订单规模与市场流动性检查"
  ],
  execution: [
    "按时间窗口分配母单数量",
    "结合市场成交量分配子单",
    "按价格与可成交量拆分订单"
  ]
};
const upstream: Partial<
  Record<ProjectKind, { name: string; version: string }[]>
> = {
  model: [{ name: "量价动量因子", version: "0.1.8" }],
  optimize: [{ name: "多因子动量", version: "0.1.11" }],
  control: [{ name: "风险平价组合", version: "0.1.11" }],
  execution: [{ name: "订单限额风控", version: "0.1.11" }]
};
const parameters: Record<ProjectKind, Record<string, string>> = {
  factor: {
    lookback: "20",
    winsorize: "0.01",
    neutralize: "行业、市值",
    standardize: "z-score"
  },
  model: {
    lookback: "20",
    top_n: "30",
    rebalance: "每周",
    "factor.columns": "momentum_20d, volume_ratio"
  },
  optimize: { lookback: "60", max_weight: "0.10", cash_reserve: "0.02" },
  control: { max_order_value: "100,000", max_position_weight: "0.15" },
  execution: { slices: "5", participation_rate: "0.10", limit_offset: "0.002" }
};

export const defaultDownstream: Record<ProjectKind, string[]> = {
  factor: [],
  model: ["风险平价", "不拒单", "不拆单"],
  optimize: ["不拒单", "不拆单"],
  control: ["不拆单"],
  execution: []
};

export const initialProjects: ResearchProject[] = Object.entries(names).flatMap(
  ([key, items], groupIndex) => {
    const kind = key as ProjectKind;
    return items.map((name, index) => {
      const id = `${kind}-${index + 1}`;
      const versions: ResearchVersion[] = [12, 11, 10].map(
        (number, offset) => ({
          id: `${id}-v${number}`,
          reportFixture: true,
          number,
          note:
            offset === 0
              ? ["调整滚动窗口", "更新研究参数", "补充边界条件检查"][index]
              : "阶段研究结果",
          submittedAt: `2026-09-${22 - offset} ${["10:32", "09:48", "09:16"][index]}`,
          status:
            offset === 0 && index === 1
              ? "running"
              : offset === 0 && index === 2
                ? "failed"
                : "success",
          publishStatus: offset === 1 ? "published" : "unpublished",
          workflowId: 8200 + groupIndex * 100 + index * 10 + number,
          duration: index === 1 && offset === 0 ? "02:18" : "04:36",
          error:
            index === 2 && offset === 0
              ? "ValueError: 输入数据存在缺失值，请检查预处理结果。"
              : undefined,
          // v10 is an explicit publish-validation failure fixture.
          publishError:
            number === 10
              ? "接口校验失败：候选包缺少 Params 导出。"
              : undefined,
          parameters: { ...parameters[kind] },
          dependencies: upstream[kind] ?? []
        })
      );
      return {
        id,
        kind,
        name,
        description: descriptions[kind][index],
        schemeVersion: "v1.0.0",
        algoVersion: "v1.0.0",
        updatedAt: versions[0].submittedAt,
        archived: false,
        versions
      };
    });
  }
);

export function stepState(
  version: ResearchVersion,
  step: TaskStep
): "success" | "running" | "failed" | "pending" {
  if (step === "environment" || version.status === "success") return "success";
  if (step === "report") return "pending";
  return version.status;
}

function sampleTaskLogs(version: ResearchVersion, step: TaskStep): string[] {
  if (stepState(version, step) === "pending") return [];
  if (step === "environment")
    return [
      "09:30:00 INFO  Worker 接收任务",
      "09:30:01 INFO  加载提交版本",
      "09:30:03 INFO  环境准备完成"
    ];
  if (step === "report")
    return [
      "09:34:28 INFO  开始整理研究结果",
      "09:34:33 INFO  report.parquet 已写入",
      "09:34:36 INFO  任务执行成功"
    ];
  return [
    "09:30:04 INFO  加载算法与研究参数",
    "09:30:05 INFO  数据区间 2024-01-02 — 2025-06-30",
    "09:30:08 INFO  数据检查完成",
    "09:30:10 INFO  开始执行研究",
    ...version.status === "failed"
      ? [`09:30:12 ERROR ${version.error}`, "09:30:12 ERROR 任务执行失败"]
      : [
          "09:31:02 INFO  已处理 80 / 363 个交易日",
          "09:32:18 INFO  已处理 180 / 363 个交易日",
          ...version.status === "success"
            ? [
                "09:34:27 INFO  已处理 363 / 363 个交易日",
                "09:34:28 INFO  研究完成"
              ]
            : []
        ]
  ];
}

export function taskLogs(version: ResearchVersion, step: TaskStep): string[] {
  const startedAt = new Date(version.submittedAt.replace(" ", "T") + ":00").getTime();
  return sampleTaskLogs(version, step).map((line) => {
    const [hour, minute, second] = line.slice(0, 8).split(":").map(Number);
    const offset = hour * 3600 + minute * 60 + second - (9 * 3600 + 30 * 60);
    const time = new Date(startedAt + offset * 1000).toTimeString().slice(0, 8);
    return time + line.slice(8);
  });
}

export function jupyterUrl(project: ResearchProject): string {
  const base = (
    import.meta.env.VITE_JUPYTER_URL || "http://127.0.0.1:8888"
  ).replace(/\/$/, "");
  return `${base}/lab/tree/projects/${encodeURIComponent(project.id)}`;
}
