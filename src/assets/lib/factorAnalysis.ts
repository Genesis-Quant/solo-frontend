import studentTCdf from "@stdlib/stats-base-dists-t-cdf";

import { BrowserDuckDb, duckDbDateValue } from "@/assets/lib/duckdb";
import type { FactorMetricSummary, FactorMetrics, FactorReportParameters } from "@/types/factor";

export type InformationPoint = { time: string; ic: number | null; rankIc: number | null; icCumulative: number | null; rankIcCumulative: number | null };
export type LongShortPoint = { time: string; value: number | null; cumulative: number | null };
export type GroupPoint = { time: string; values: Record<string, number | null>; reverseValues: Record<string, number | null> };
export type GroupStatistic = { group: string; mean: number | null; pValue: number | null };
export type DecayPoint = { returnColumn: string; label: string; position: number; icMean: number | null; rankIcMean: number | null };
export type TurnoverGroup = { group: string; value: number | null };
export type TurnoverSummary = { periods: number; rankAutocorrelation: number | null; groups: TurnoverGroup[] };
export type ExecutionFilterStatistic = { name: string; count: number };
export type ExecutionStatisticPoint = { time: string; sourceCount: number; filteredCount: number; retentionRate: number | null; filters: ExecutionFilterStatistic[] };
export type FactorDateRange = { start: string; end: string };

export class FactorAnalytics {
  private constructor(
    private readonly database: BrowserDuckDb,
    private readonly informationFile: string,
    private readonly groupsFile: string,
    private readonly turnoverFile: string | null,
    private readonly executionStatisticsFile: string | null,
    private readonly parameters: FactorReportParameters,
    private readonly executionFilterIndices: number[]
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
    const executionFilterIndices = executionStatisticsFile
      ? (await database.rows(`DESCRIBE SELECT * FROM read_parquet(${literal(executionStatisticsFile)})`))
        .map((row) => /^filter(\d+)_count$/.exec(String(row.column_name)))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => Number(match[1]))
        .sort((left, right) => left - right)
      : [];
    return new FactorAnalytics(database, informationFile, groupsFile, turnoverFile, executionStatisticsFile, parameters, executionFilterIndices);
  }

  async metrics(): Promise<FactorMetrics> {
    const metrics: FactorMetrics = {};
    const rows = await this.rows(factorMetricsSql(
      this.informationFile,
      this.groupsFile,
      this.parameters.factor_columns,
      this.parameters.return_columns,
      this.parameters.return_specs
    ));
    for (const row of rows) {
      const factor = String(row.factor_name);
      const returnColumn = String(row.return_column);
      if (!metrics[factor]) metrics[factor] = {};
      metrics[factor][returnColumn] = metricSummary(row, row);
    }
    return metrics;
  }

  async dateRange(factor: string, returnColumn: string): Promise<FactorDateRange> {
    const ic = identifier(`${factor}_${returnColumn}_ic`);
    const rank = identifier(`${factor}_${returnColumn}_rank_ic`);
    const row = (await this.rows(`SELECT min(time) AS start_time, max(time) AS end_time FROM read_parquet(${literal(this.informationFile)}) WHERE ${ic} IS NOT NULL OR ${rank} IS NOT NULL`))[0] ?? {};
    return { start: duckDbDateValue(row.start_time), end: duckDbDateValue(row.end_time) };
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
    const spec = this.returnSpec(returnColumn);
    const realized = spec.kind === "log" ? "exp(raw_value) - 1" : "raw_value";
    const cumulative = spec.periods !== 1
      ? "NULL::DOUBLE"
      : spec.kind === "log"
        ? "exp(sum(raw_value) OVER (ORDER BY time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) - 1"
        : "product(1 + raw_value) OVER (ORDER BY time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) - 1";
    const rows = await this.rows(`
      WITH daily AS (
        SELECT time, ${high} - ${low} AS raw_value
        FROM read_parquet(${literal(this.groupsFile)})
        ${dateFilter(range)}
      )
      SELECT time, ${realized} AS value,
        ${cumulative} AS cumulative
      FROM daily
      ORDER BY time
    `);
    return rows.map((row) => ({ time: duckDbDateValue(row.time), value: numberValue(row.value), cumulative: numberValue(row.cumulative) }));
  }

  async groupSeries(factor: string, returnColumn: string, nGroups: number, range?: FactorDateRange): Promise<GroupPoint[]> {
    const spec = this.returnSpec(returnColumn);
    const definitions = groupDefinitions(factor, returnColumn, nGroups, this.parameters.n_select);
    const columns = definitions.flatMap((definition, index) => {
      const source = identifier(definition.column);
      return ["ASC", "DESC"].map((direction) => {
        const window = `ORDER BY time ${direction} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`;
        const cumulative = spec.periods !== 1
          ? "NULL::DOUBLE"
          : spec.kind === "log"
            ? `exp(sum(${source}) OVER (${window}))`
            : `product(1 + ${source}) OVER (${window})`;
        return `${cumulative} AS ${identifier(`${direction === "DESC" ? "reverse_" : ""}series_${index}`)}`;
      });
    });
    const rows = await this.rows(`SELECT time, ${columns.join(", ")} FROM read_parquet(${literal(this.groupsFile)}) ${dateFilter(range)} ORDER BY time`);
    return rows.map((row) => ({
      time: duckDbDateValue(row.time),
      values: Object.fromEntries(definitions.map((definition, index) => [definition.label, numberValue(row[`series_${index}`])])),
      reverseValues: Object.fromEntries(definitions.map((definition, index) => [definition.label, numberValue(row[`reverse_series_${index}`])]))
    }));
  }

  async groupStatistics(factor: string, returnColumn: string, nGroups: number, range?: FactorDateRange): Promise<GroupStatistic[]> {
    const spec = this.returnSpec(returnColumn);
    const definitions = groupDefinitions(factor, returnColumn, nGroups, this.parameters.n_select);
    const statements = definitions.map((definition) => {
      const source = identifier(definition.column);
      const realized = spec.kind === "log" ? `exp(${source}) - 1` : source;
      return `SELECT ${literal(definition.label)} AS group_name, count(${source}) AS observations, avg(${realized}) AS mean, stddev_samp(${realized}) AS std FROM read_parquet(${literal(this.groupsFile)}) ${dateFilter(range)}`;
    });
    const rows = await this.rows(statements.join(" UNION ALL "));
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
    const filterColumns = this.executionFilterIndices.flatMap((index) => [`filter${index}_name`, `filter${index}_count`]);
    const columns = ["time", "source_count", ...filterColumns, "filtered_count", "retention_rate"];
    const rows = await this.rows(`
      SELECT ${columns.map(identifier).join(", ")}
      FROM read_parquet(${literal(this.executionStatisticsFile)})
      ${dateFilter(range)}
      ORDER BY time
    `);
    return rows.map((row) => ({
      time: duckDbDateValue(row.time),
      sourceCount: integerValue(row.source_count),
      filteredCount: integerValue(row.filtered_count),
      retentionRate: numberValue(row.retention_rate),
      filters: this.executionFilterIndices.map((index) => ({
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

  private returnSpec(returnColumn: string) {
    return this.parameters.return_specs[returnColumn];
  }
}

function factorMetricsSql(
  informationFile: string,
  groupsFile: string,
  factors: string[],
  returnColumns: string[],
  returnSpecs: FactorReportParameters["return_specs"]
) {
  const pairs = factors.flatMap((factor) => returnColumns.map((returnColumn) => ({ factor, returnColumn })));
  const information = pairs.map(({ factor, returnColumn }) => `SELECT ${literal(factor)} AS factor_name, ${literal(returnColumn)} AS return_column, ${identifier(`${factor}_${returnColumn}_ic`)} AS ic, ${identifier(`${factor}_${returnColumn}_rank_ic`)} AS rank_ic FROM read_parquet(${literal(informationFile)})`).join(" UNION ALL ");
  const returns = pairs.map(({ factor, returnColumn }) => {
    const [lowColumn, highColumn] = endpointColumnNames(factor, returnColumn);
    const low = identifier(lowColumn);
    const high = identifier(highColumn);
    const spec = returnSpecs[returnColumn];
    const spread = `${high} - ${low}`;
    const value = spec.kind === "log" ? `exp(${spread}) - 1` : spread;
    return `SELECT ${literal(factor)} AS factor_name, ${literal(returnColumn)} AS return_column, time, ${value} AS value, ${spec.periods === 1 ? "true" : "false"} AS eligible FROM read_parquet(${literal(groupsFile)}) WHERE ${high} IS NOT NULL AND ${low} IS NOT NULL`;
  }).join(" UNION ALL ");
  return `
    WITH information_values AS (${information}),
    information_metrics AS (
      SELECT factor_name, return_column, count(ic) AS observations, avg(ic) AS ic_mean, stddev_samp(ic) AS ic_std,
        avg(ic) / nullif(stddev_samp(ic), 0) AS ic_ir,
        count_if(ic > 0)::DOUBLE / nullif(count(ic), 0) AS ic_positive_ratio,
        avg(rank_ic) AS rank_ic_mean, stddev_samp(rank_ic) AS rank_ic_std,
        avg(rank_ic) / nullif(stddev_samp(rank_ic), 0) AS rank_ic_ir,
        count_if(rank_ic > 0)::DOUBLE / nullif(count(rank_ic), 0) AS rank_ic_positive_ratio
      FROM information_values GROUP BY factor_name, return_column
    ), nav AS (
      SELECT *, product(1 + value) OVER (PARTITION BY factor_name, return_column ORDER BY time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS wealth
      FROM (${returns}) WHERE eligible
    ), drawdown AS (
      SELECT *, wealth / greatest(1.0, max(wealth) OVER (PARTITION BY factor_name, return_column ORDER BY time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) - 1 AS drawdown
      FROM nav
    ), return_summary AS (
      SELECT factor_name, return_column, count(value) AS return_observations, product(1 + value) AS growth,
        stddev_pop(value) * sqrt(252.0) AS annual_volatility, abs(min(drawdown)) AS max_drawdown
      FROM drawdown GROUP BY factor_name, return_column
    )
    SELECT information_metrics.*, return_summary.return_observations, return_summary.growth - 1 AS cumulative_return,
      CASE WHEN return_summary.growth >= 0 THEN power(return_summary.growth, 252.0 / return_summary.return_observations) - 1 END AS annual_return,
      return_summary.annual_volatility,
      CASE WHEN return_summary.annual_volatility > 0 AND return_summary.growth >= 0 THEN (power(return_summary.growth, 252.0 / return_summary.return_observations) - 1) / return_summary.annual_volatility END AS sharpe,
      return_summary.max_drawdown
    FROM information_metrics LEFT JOIN return_summary USING (factor_name, return_column)
  `;
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

function metricSummary(information: Record<string, unknown>, longShort: Record<string, unknown>): FactorMetricSummary {
  return {
    observations: integerValue(information.observations),
    ic_mean: numberValue(information.ic_mean), ic_std: numberValue(information.ic_std), ic_ir: numberValue(information.ic_ir), ic_positive_ratio: numberValue(information.ic_positive_ratio),
    rank_ic_mean: numberValue(information.rank_ic_mean), rank_ic_std: numberValue(information.rank_ic_std), rank_ic_ir: numberValue(information.rank_ic_ir), rank_ic_positive_ratio: numberValue(information.rank_ic_positive_ratio),
    long_short_cumulative_return: numberValue(longShort.cumulative_return), long_short_annual_return: numberValue(longShort.annual_return),
    long_short_annual_volatility: numberValue(longShort.annual_volatility), long_short_sharpe: numberValue(longShort.sharpe), long_short_max_drawdown: numberValue(longShort.max_drawdown)
  };
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
