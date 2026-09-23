import normalQuantile from "@stdlib/stats-base-dists-normal-quantile";
import {
  mean as statisticsMean,
  min as statisticsMin,
  product,
  quantile,
  rootMeanSquare,
  sampleKurtosis,
  sampleSkewness,
  sampleStandardDeviation,
  standardDeviation,
  sum
} from "simple-statistics";

export type DatedReturn = { time: string; value: number };
export type DrawdownPoint = { time: string; value: number };
export type DrawdownPeriod = { start: string; valley: string; end: string; days: number; maxDrawdownPercent: number; maxDrawdown99Percent: number };
export type RollingPoint = { time: string; value: number };

export type QuantStatsReport = {
  totalReturn: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  volatility: number;
  maxDrawdown: number;
  calmar: number;
  payoffRatio: number;
  averageReturn: number;
  maxConsecutiveLosses: number;
  profitFactor: number;
  recoveryFactor: number;
  expectedAnnualReturn: number;
  skew: number;
  kurtosis: number;
  valueAtRisk: number;
  conditionalValueAtRisk: number;
  winRate: number;
  gainToPainRatio: number;
  drawdown: DrawdownPoint[];
  drawdownPeriods: DrawdownPeriod[];
  rollingSharpe: RollingPoint[];
  netValue: RollingPoint[];
};

export function quantStatsReport(rows: DatedReturn[], periods = 252, riskFreeRate = 0, excludeInitialReturn = false): QuantStatsReport {
  const returns = prepareReturns(rows.map((row) => row.value));
  const volatilityReturns = excludeInitialReturn ? returns.slice(1) : returns;
  const annualReturn = cagr(returns, periods);
  const annualVolatility = volatility(volatilityReturns, periods);
  const drawdown = toDrawdownSeries(returns).map((value, index) => ({ time: rows[index].time, value }));
  return {
    totalReturn: compoundedReturn(returns),
    cagr: annualReturn,
    sharpe: sharpe(annualReturn, annualVolatility, riskFreeRate),
    sortino: sortino(returns, riskFreeRate, periods),
    volatility: annualVolatility,
    maxDrawdown: maxDrawdown(returns),
    calmar: calmar(annualReturn, maxDrawdown(returns)),
    payoffRatio: payoffRatio(returns),
    averageReturn: meanOrNaN(returns),
    maxConsecutiveLosses: consecutiveLosses(returns),
    profitFactor: profitFactor(returns),
    recoveryFactor: recoveryFactor(returns),
    expectedAnnualReturn: expectedAnnualReturn(rows),
    skew: skew(returns),
    kurtosis: kurtosis(returns),
    valueAtRisk: valueAtRisk(returns),
    conditionalValueAtRisk: conditionalValueAtRisk(returns),
    winRate: winRate(returns),
    gainToPainRatio: gainToPainRatio(returns),
    drawdown,
    drawdownPeriods: drawdownDetails(drawdown),
    rollingSharpe: rollingSharpe(rows, riskFreeRate, Math.max(1, Math.round(periods / 2)), periods),
    netValue: cumulativeReturns(returns).map((value, index) => ({ time: rows[index].time, value: value + 1 }))
  };
}

function prepareReturns(values: number[], riskFreeRate = 0, periods?: number) {
  let returns = values.map((value) => Number.isFinite(value) ? value : 0);
  if (riskFreeRate !== 0) {
    const periodRate = periods ? (1 + riskFreeRate) ** (1 / periods) - 1 : riskFreeRate;
    returns = returns.map((value) => value - periodRate);
  }
  return returns;
}

function compoundedReturn(returns: number[]) { return product(returns.map((value) => 1 + value)) - 1; }

function cumulativeReturns(returns: number[]) {
  let total = 1;
  return returns.map((value) => {
    total *= 1 + value;
    return total - 1;
  });
}

function cagr(returns: number[], periods = 252) {
  if (!returns.length) return Number.NaN;
  const growth = compoundedReturn(returns) + 1;
  return growth > 0 ? growth ** (periods / returns.length) - 1 : Number.NaN;
}

function sharpe(annualReturn: number, annualVolatility: number, riskFreeRate = 0) {
  return annualVolatility === 0 ? Number.NaN : (annualReturn - riskFreeRate) / annualVolatility;
}

function sortino(returns: number[], riskFreeRate = 0, periods = 252) {
  const excess = prepareReturns(returns, riskFreeRate, periods);
  const downside = excess.length ? rootMeanSquare(excess.map((value) => value < 0 ? value : 0)) : Number.NaN;
  return downside === 0 ? Number.NaN : meanOrNaN(excess) / downside * Math.sqrt(periods);
}

function volatility(returns: number[], periods = 252) { return populationStandardDeviationOrNaN(prepareReturns(returns)) * Math.sqrt(periods); }

function toDrawdownSeries(returns: number[]) {
  const prices = cumulativeReturns(returns).map((value) => value + 1);
  let peak = 1;
  return prices.map((price) => {
    peak = Math.max(peak, price);
    const value = price / peak - 1;
    return Object.is(value, -0) ? 0 : value;
  });
}

function maxDrawdown(returns: number[]) {
  const drawdown = toDrawdownSeries(returns);
  return drawdown.length ? Math.min(0, statisticsMin(drawdown)) : 0;
}

function calmar(annualReturn: number, drawdown: number) { return drawdown === 0 ? Number.NaN : annualReturn / Math.abs(drawdown); }

function payoffRatio(returns: number[]) {
  const prepared = prepareReturns(returns);
  const wins = prepared.filter((value) => value > 0);
  const losses = prepared.filter((value) => value < 0);
  const averageLoss = losses.length ? statisticsMean(losses) : 0;
  return averageLoss === 0 || !wins.length ? Number.NaN : statisticsMean(wins) / Math.abs(averageLoss);
}

function profitFactor(returns: number[]) {
  const prepared = prepareReturns(returns);
  const wins = sum(prepared.filter((value) => value >= 0));
  const losses = Math.abs(sum(prepared.filter((value) => value < 0)));
  return losses === 0 ? wins === 0 ? 0 : Number.POSITIVE_INFINITY : wins / losses;
}

function recoveryFactor(returns: number[], riskFreeRate = 0) {
  const prepared = prepareReturns(returns);
  const drawdown = Math.abs(maxDrawdown(prepared));
  return drawdown === 0 ? Number.NaN : Math.abs(sum(prepared) - riskFreeRate) / drawdown;
}

function gainToPainRatio(returns: number[]) {
  const prepared = prepareReturns(returns);
  const pain = Math.abs(sum(prepared.filter((value) => value < 0)));
  return pain === 0 ? Number.NaN : sum(prepared) / pain;
}

function expectedReturn(returns: number[]) { return returns.length ? product(returns.map((value) => 1 + value)) ** (1 / returns.length) - 1 : Number.NaN; }

function expectedAnnualReturn(rows: DatedReturn[]) {
  const prepared = prepareReturns(rows.map((row) => row.value));
  const years = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const year = row.time.slice(0, 4);
    years.set(year, [...years.get(year) ?? [], prepared[index]]);
  });
  return expectedReturn([...years.values()].map(compoundedReturn));
}

function valueAtRisk(returns: number[], sigma = 1, confidence = 0.95) {
  const prepared = prepareReturns(returns);
  const probability = 1 - (confidence > 1 ? confidence / 100 : confidence);
  const deviation = sampleStandardDeviationOrNaN(prepared);
  return deviation === 0 || Number.isNaN(deviation) ? Number.NaN : meanOrNaN(prepared) + normalQuantile(probability, 0, 1) * deviation * sigma;
}

function conditionalValueAtRisk(returns: number[], sigma = 1, confidence = 0.95) {
  const prepared = prepareReturns(returns);
  const threshold = valueAtRisk(prepared, sigma, confidence);
  const tail = prepared.filter((value) => value < threshold);
  return tail.length ? statisticsMean(tail) : threshold;
}

function winRate(returns: number[]) {
  const prepared = prepareReturns(returns);
  const nonZero = prepared.filter((value) => value !== 0);
  return nonZero.length ? statisticsMean(nonZero.map((value) => value > 0 ? 1 : 0)) : 0;
}

function consecutiveLosses(returns: number[]) {
  let current = 0;
  let longest = 0;
  for (const value of prepareReturns(returns)) {
    current = value < 0 ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function skew(returns: number[]) {
  const values = prepareReturns(returns);
  if (values.length < 3) return Number.NaN;
  const average = statisticsMean(values);
  if (values.every((value) => value === average)) return 0;
  return sampleSkewness(values);
}

function kurtosis(returns: number[]) {
  const values = prepareReturns(returns);
  if (values.length < 4) return Number.NaN;
  const average = statisticsMean(values);
  if (values.every((value) => value === average)) return 0;
  return sampleKurtosis(values);
}

function drawdownDetails(drawdown: DrawdownPoint[]) {
  const starts: number[] = drawdown.length && drawdown[0].value !== 0 ? [0] : [];
  const ends: number[] = [];
  for (let index = 1; index < drawdown.length; index += 1) {
    if (drawdown[index].value !== 0 && drawdown[index - 1].value === 0) starts.push(index);
    if (drawdown[index].value === 0 && drawdown[index - 1].value !== 0) ends.push(index - 1);
  }
  if (!starts.length) return [];
  if (!ends.length || starts.at(-1)! > ends.at(-1)!) ends.push(drawdown.length - 1);
  return starts.map((start, index) => {
    const end = ends[index];
    const period = drawdown.slice(start, end + 1);
    const values = period.map((row) => row.value);
    const minimum = statisticsMin(values);
    const threshold = quantile(values.map((value) => -value), 0.99);
    const clean = values.filter((value) => -value < threshold);
    return {
      start: drawdown[start].time,
      valley: period[values.indexOf(minimum)].time,
      end: drawdown[end].time,
      days: calendarDays(drawdown[start].time, drawdown[end].time),
      maxDrawdownPercent: minimum * 100,
      maxDrawdown99Percent: (clean.length ? statisticsMin(clean) : Number.NaN) * 100
    };
  });
}

function rollingSharpe(rows: DatedReturn[], riskFreeRate = 0, rollingPeriod = 126, periodsPerYear = 252) {
  const returns = prepareReturns(rows.map((row) => row.value), riskFreeRate, periodsPerYear);
  const result: RollingPoint[] = [];
  if (rollingPeriod < 2) return result;
  for (let index = rollingPeriod - 1; index < returns.length; index += 1) {
    const window = returns.slice(index - rollingPeriod + 1, index + 1);
    const deviation = sampleStandardDeviation(window);
    const scale = Math.max(...window.map(Math.abs));
    if (deviation <= Number.EPSILON * scale * window.length) continue;
    const value = statisticsMean(window) / deviation * Math.sqrt(periodsPerYear);
    if (Number.isFinite(value)) result.push({ time: rows[index].time, value });
  }
  return result;
}

function meanOrNaN(values: number[]) { return values.length ? statisticsMean(values) : Number.NaN; }
function sampleStandardDeviationOrNaN(values: number[]) { return values.length > 1 ? sampleStandardDeviation(values) : Number.NaN; }
function populationStandardDeviationOrNaN(values: number[]) { return values.length > 1 ? standardDeviation(values) : Number.NaN; }

function calendarDays(start: string, end: string) { return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1; }
