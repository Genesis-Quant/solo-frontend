import studentTCdf from "@stdlib/stats-base-dists-t-cdf";

import { BrowserDuckDb, duckDbDateValue } from "@/assets/lib/duckdb";
import type { FactorReportParameters } from "@/types/factor";

export type InformationPoint = { time: string; ic: number | null; rankIc: number | null; icCumulative: number | null; rankIcCumulative: number | null };
export type LongShortPoint = { time: string; value: number | null; cumulative: number | null };
export type GroupPoint = { time: string; values: Record<string, number | null>; reverseValues: Record<string, number | null> };
export type GroupStatistic = { group: string; mean: number | null; pValue: number | null };
export type DecayPoint = { returnColumn: string; label: string; position: number; icMean: number | null; rankIcMean: number | null };
export type TurnoverGroup = { group: string; value: number | null };
export type TurnoverSummary = { periods: number; rankAutocorrelation: number | null; groups: TurnoverGroup[] };
export type ExecutionFilterStatistic = { name: string; count: number };
export type ExecutionStatisticPoint = { time: string; sourceCount: number; filteredCount: number; filters: ExecutionFilterStatistic[] };
export type FactorDateRange = { start: string; end: string };

export class FactorAnalytics {
  private constructor(
    private readonly database: BrowserDuckDb,
    private readonly informationFile: string,
    private readonly groupsFile: string,
    private readonly turnoverFile: string | null,
    private readonly executionStatisticsFile: string | null,
    private readonly parameters: FactorReportParameters
  ) {}

  static async create(
    workflowInstanceId: number,
    files: { information: ArrayBuffer; groups: ArrayBuffer; turnover?: ArrayBuffer | null; executionStatistics?: ArrayBuffer | null },
    parameters: FactorReportParameters
  ) {
    const informationFile = `factor-${workflowInstanceId}-information.parquet`;
    const groupsFile = `factor-${workflowInstanceId}-groups.parquet`;
    const turnoverFile = files.turnover ? `factor-${workflowInstanceId}-turnover.parquet` : null;
    const executionStatisticsFile = files.executionStatistics ? `factor-${workflowInstanceId}-execution-statistics.parquet` : null;
    const registeredFiles: Record<string, ArrayBuffer> = {
      [informationFile]: files.information,
      [groupsFile]: files.groups
    };
    if (turnoverFile && files.turnover) registeredFiles[turnoverFile] = files.turnover;
    if (executionStatisticsFile && files.executionStatistics) registeredFiles[executionStatisticsFile] = files.executionStatistics;
    const database = await BrowserDuckDb.create(registeredFiles);
    return new FactorAnalytics(database, informationFile, groupsFile, turnoverFile, executionStatisticsFile, parameters);
  }

  async informationSeries(factor: string, returnColumn: string, range?: FactorDateRange): Promise<InformationPoint[]> {
    const ic = identifier(`${factor}_${returnColumn}_ic`);
    const rank = identifier(`${factor}_${returnColumn}_rank_ic`);
    const rows = await this.rows(`
      SELECT time, ${ic} AS ic, ${rank} AS rank_ic,
        sum(${ic}) OVER (ORDER BY time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS ic_cumulative,
        sum(${rank}) OVER (ORDER BY time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rank_ic_cumulative
      FROM read_parquet(${literal(this.informationFile)})
      ${dateFilter(range)}
      ORDER BY time
    `);
    return rows.map((row) => ({
      time: duckDbDateValue(row.time),
      ic: numberValue(row.ic),
      rankIc: numberValue(row.rank_ic),
      icCumulative: numberValue(row.ic_cumulative),
      rankIcCumulative: numberValue(row.rank_ic_cumulative)
    }));
  }

  async longShortSeries(factor: string, returnColumn: string, range?: FactorDateRange): Promise<LongShortPoint[]> {
    const [lowColumn, highColumn] = endpointColumnNames(factor, returnColumn);
    const low = identifier(lowColumn);
    const high = identifier(highColumn);
    const rows = await this.rows(`
      ${this.collectionReturns(returnColumn, [high, low], true)},
      selected AS (
        SELECT time, value_0 AS value FROM collection_returns ${dateFilter(range)}
      )
      SELECT time, value,
        CASE WHEN value IS NULL THEN NULL ELSE sum(value) OVER (ORDER BY time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) END AS cumulative
      FROM selected
      ORDER BY time
    `);
    return rows.map((row) => ({ time: duckDbDateValue(row.time), value: numberValue(row.value), cumulative: numberValue(row.cumulative) }));
  }

  async groupSeries(factor: string, returnColumn: string, nGroups: number, range?: FactorDateRange): Promise<GroupPoint[]> {
    const definitions = groupDefinitions(factor, returnColumn, nGroups, this.parameters.n_select);
    const columns = definitions.flatMap((_definition, index) => {
      const source = `value_${index}`;
      return ["ASC", "DESC"].map((direction) => {
        const window = `ORDER BY time ${direction} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`;
        const cumulative = `CASE WHEN ${source} IS NULL THEN NULL ELSE exp(sum(${source}) OVER (${window})) END`;
        return `${cumulative} AS ${identifier(`${direction === "DESC" ? "reverse_" : ""}series_${index}`)}`;
      });
    });
    const rows = await this.rows(`
      ${this.collectionReturns(returnColumn, definitions.map((definition) => identifier(definition.column)))},
      selected AS (SELECT * FROM collection_returns ${dateFilter(range)})
      SELECT time, ${columns.join(", ")} FROM selected ORDER BY time
    `);
    return rows.map((row) => ({
      time: duckDbDateValue(row.time),
      values: Object.fromEntries(definitions.map((definition, index) => [definition.label, numberValue(row[`series_${index}`])])),
      reverseValues: Object.fromEntries(definitions.map((definition, index) => [definition.label, numberValue(row[`reverse_series_${index}`])]))
    }));
  }

  async groupStatistics(factor: string, returnColumn: string, nGroups: number, range?: FactorDateRange): Promise<GroupStatistic[]> {
    const definitions = groupDefinitions(factor, returnColumn, nGroups, this.parameters.n_select);
    const statements = definitions.map((definition, index) => {
      const source = `value_${index}`;
      return `SELECT ${literal(definition.label)} AS group_name, count(${source}) AS observations, avg(${source}) AS mean, stddev_samp(${source}) AS std FROM selected`;
    });
    const rows = await this.rows(`
      ${this.collectionReturns(returnColumn, definitions.map((definition) => identifier(definition.column)))},
      selected AS (SELECT * FROM collection_returns ${dateFilter(range)})
      ${statements.join(" UNION ALL ")}
    `);
    return rows.map((row) => {
      const observations = integerValue(row.observations);
      const mean = numberValue(row.mean);
      const deviation = numberValue(row.std);
      const standardError = deviation === null || observations < 3 ? null : deviation / Math.sqrt(observations);
      const statistic = mean === null || standardError === null || standardError <= 0 ? null : Math.abs(mean / standardError);
      return {
        group: String(row.group_name),
        mean,
        pValue: statistic === null ? null : 2 * (1 - studentTCdf(statistic, observations - 1))
      };
    });
  }

  async decay(factor: string, returnColumns: string[], range?: FactorDateRange): Promise<DecayPoint[]> {
    const columns = returnColumns.flatMap((returnColumn, index) => {
      const ic = identifier(`${factor}_${returnColumn}_ic`);
      const rank = identifier(`${factor}_${returnColumn}_rank_ic`);
      return [`avg(${ic}) AS ${identifier(`ic_${index}`)}`, `avg(${rank}) AS ${identifier(`rank_ic_${index}`)}`];
    });
    const row = (await this.rows(`SELECT ${columns.join(", ")} FROM read_parquet(${literal(this.informationFile)}) ${dateFilter(range)}`))[0] ?? {};
    return returnColumns.map((returnColumn, index) => ({
      returnColumn,
      label: returnColumn,
      position: index,
      icMean: numberValue(row[`ic_${index}`]),
      rankIcMean: numberValue(row[`rank_ic_${index}`])
    }));
  }

  async turnoverPeriods(factor: string): Promise<number[]> {
    if (!this.turnoverFile) return [];
    const rows = await this.rows(`SELECT DISTINCT periods FROM read_parquet(${literal(this.turnoverFile)}) WHERE factor = ${literal(factor)} ORDER BY periods`);
    return rows.map((row) => integerValue(row.periods)).filter((periods) => periods > 0);
  }

  async turnoverSummary(factor: string, periods: number, nGroups: number, range?: FactorDateRange): Promise<TurnoverSummary> {
    const definitions = turnoverDefinitions(nGroups, this.parameters.n_select);
    if (!this.turnoverFile) return { periods, rankAutocorrelation: null, groups: definitions.map((definition) => ({ group: definition.label, value: null })) };
    const groupColumns = definitions.map((definition, index) => `avg(${identifier(definition.column)}) AS ${identifier(`turnover_${index}`)}`);
    const row = (await this.rows(`
      SELECT avg(rank_autocorrelation) AS rank_autocorrelation, ${groupColumns.join(", ")}
      FROM read_parquet(${literal(this.turnoverFile)})
      WHERE factor = ${literal(factor)} AND periods = ${Math.trunc(periods)}${dateAndFilter(range)}
    `))[0] ?? {};
    return {
      periods,
      rankAutocorrelation: numberValue(row.rank_autocorrelation),
      groups: definitions.map((definition, index) => ({
        group: definition.label,
        value: numberValue(row[`turnover_${index}`])
      }))
    };
  }

  async executionStatistics(range?: FactorDateRange): Promise<ExecutionStatisticPoint[]> {
    if (!this.executionStatisticsFile) return [];
    const rows = await this.rows(`
      SELECT * FROM read_parquet(${literal(this.executionStatisticsFile)})
      ${dateFilter(range)}
      ORDER BY time
    `);
    const filterIndices = Object.keys(rows[0] ?? {})
      .flatMap((column) => { const match = /^filter(\d+)_count$/.exec(column); return match ? [Number(match[1])] : []; })
      .sort((left, right) => left - right);
    return rows.map((row) => ({
      time: duckDbDateValue(row.time),
      sourceCount: integerValue(row.source_count),
      filteredCount: integerValue(row.filtered_count),
      filters: filterIndices.map((index) => ({
        name: String(row[`filter${index}_name`]),
        count: integerValue(row[`filter${index}_count`])
      }))
    }));
  }

  async close() {
    await this.database.close();
  }

  private async rows(sql: string): Promise<Record<string, unknown>[]> {
    return this.database.rows(sql);
  }

  private collectionReturns(returnColumn: string, sources: string[], spread = false) {
    const spec = this.parameters.return_specs[returnColumn];
    if (spec.kind === "simple" && spec.periods > 1 && !this.turnoverFile) {
      throw new Error("报告缺少完整交易日历，无法计算多期收益；请提供 group_turnover 数据");
    }
    const normalized = sources.map((source) => spec.kind === "simple"
      ? `CASE WHEN isfinite(${source}) AND ${source} > -1 THEN ln(1 + ${source}) ELSE NULL END`
      : source);
    const raw = spread ? [`${normalized[0]} - ${normalized[1]}`] : normalized;
    // Legacy group tables omit empty cross sections; turnover preserves their trading dates.
    const calendar = this.turnoverFile
      ? `trade_dates AS (
        SELECT time FROM read_parquet(${literal(this.turnoverFile)})
        UNION SELECT time FROM read_parquet(${literal(this.groupsFile)})
      ), `
      : "";
    const source = this.turnoverFile
      ? `trade_dates LEFT JOIN read_parquet(${literal(this.groupsFile)}) USING (time)`
      : `read_parquet(${literal(this.groupsFile)})`;
    return `WITH ${calendar}raw_returns AS (
      SELECT time,
        (row_number() OVER (ORDER BY time) - 1) // ${spec.periods} AS collection_id,
        ${raw.map((column, index) => `${column} AS raw_${index}`).join(", ")}
      FROM ${source}
    ), collection_returns AS (
      SELECT max(time) AS time,
        ${raw.map((_column, index) => `CASE WHEN count(raw_${index}) = ${spec.periods} THEN avg(raw_${index}) ELSE NULL END AS value_${index}`).join(", ")}
      FROM raw_returns
      GROUP BY collection_id
      HAVING count(*) = ${spec.periods}
    )`;
  }
}

function endpointColumnNames(factor: string, returnColumn: string): [string, string] {
  return [`${factor}_${returnColumn}_bottom`, `${factor}_${returnColumn}_top`];
}

function groupDefinitions(factor: string, returnColumn: string, nGroups: number, nSelect: number) {
  const groups = Array.from({ length: nGroups }, (_, group) => ({
    column: `${factor}_${returnColumn}_group${group}`,
    label: `Group ${group + 1}`
  }));
  const bottom = `${factor}_${returnColumn}_bottom`;
  const top = `${factor}_${returnColumn}_top`;
  return [
    { column: bottom, label: `最小 ${nSelect} 支` },
    ...groups,
    { column: top, label: `最大 ${nSelect} 支` }
  ];
}

function identifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function literal(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function numberValue(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerValue(value: unknown) {
  return Math.max(0, Math.trunc(numberValue(value) ?? 0));
}

function dateFilter(range?: FactorDateRange) {
  if (!range || !/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) return "";
  return `WHERE time BETWEEN DATE ${literal(range.start)} AND DATE ${literal(range.end)}`;
}

function turnoverDefinitions(nGroups: number, nSelect: number) {
  const groups = Array.from({ length: nGroups }, (_, group) => ({
    column: `group${group}`,
    label: `Group ${group + 1}`
  }));
  return [
    { column: "bottom", label: `最小 ${nSelect} 支` },
    ...groups,
    { column: "top", label: `最大 ${nSelect} 支` }
  ];
}

function dateAndFilter(range?: FactorDateRange) {
  if (!range || !/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) return "";
  return ` AND time BETWEEN DATE ${literal(range.start)} AND DATE ${literal(range.end)}`;
}
