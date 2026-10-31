import type {
  DecayPoint,
  GroupPoint,
  GroupStatistic,
  InformationPoint,
  LongShortPoint,
  TurnoverSummary
} from "@/assets/lib/factorAnalysis";
import type { FactorReportParameters } from "@/types/factor";

export type FactorDirection = "original" | "inverted";

type FactorDirectionData = {
  information: InformationPoint[];
  longShort: LongShortPoint[];
  groups: GroupPoint[];
  groupStatistics: GroupStatistic[];
  decay: DecayPoint[];
  turnover: TurnoverSummary | null;
};

// 反转已有汇总组合，不尝试从 Parquet 恢复逐股因子或重新处理中性化、并列值和分组边界。
export function factorDirectionView(
  data: FactorDirectionData,
  direction: FactorDirection,
  parameters: Pick<FactorReportParameters, "n_groups" | "n_select">
): FactorDirectionData {
  if (direction === "original") return data;
  const opposite = (label: string) => oppositeGroup(label, parameters.n_groups, parameters.n_select);
  const groupStatistics = new Map(data.groupStatistics.map((row) => [row.group, row]));
  const turnoverGroups = new Map(data.turnover?.groups.map((row) => [row.group, row]));
  const groupValues = (values: GroupPoint["values"]) => Object.fromEntries(
    Object.keys(values).map((label) => [label, values[opposite(label)] ?? null])
  );
  return {
    information: data.information.map((row) => ({
      ...row,
      ic: negate(row.ic),
      rankIc: negate(row.rankIc),
      icCumulative: negate(row.icCumulative),
      rankIcCumulative: negate(row.rankIcCumulative)
    })),
    // 净值和回撤由新 log 收益序列重算；组合净值本身不能直接变号。
    longShort: data.longShort.map((row) => ({ ...row, value: negate(row.value), cumulative: negate(row.cumulative) })),
    groups: data.groups.map((row) => ({ ...row, values: groupValues(row.values), reverseValues: groupValues(row.reverseValues) })),
    groupStatistics: data.groupStatistics.map((row) => {
      const source = groupStatistics.get(opposite(row.group));
      return { group: row.group, mean: source?.mean ?? null, pValue: source?.pValue ?? null };
    }),
    decay: data.decay.map((row) => ({ ...row, icMean: negate(row.icMean), rankIcMean: negate(row.rankIcMean) })),
    turnover: data.turnover
      ? {
        ...data.turnover,
        groups: data.turnover.groups.map((row) => ({ group: row.group, value: turnoverGroups.get(opposite(row.group))?.value ?? null }))
      }
      : null
  };
}

export function oppositeGroup(label: string, nGroups: number, nSelect: number): string {
  if (label === `最小 ${nSelect} 支`) return `最大 ${nSelect} 支`;
  if (label === `最大 ${nSelect} 支`) return `最小 ${nSelect} 支`;
  const match = /^Group (\d+)$/.exec(label);
  const group = match ? Number(match[1]) : 0;
  return group >= 1 && group <= nGroups ? `Group ${nGroups + 1 - group}` : label;
}

function negate(value: number | null): number | null {
  return value === null || value === 0 ? value : -value;
}
