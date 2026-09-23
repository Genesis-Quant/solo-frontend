import type { BacktestTableName } from "@/assets/lib/backtestAnalysis";
import type { ParquetColumnConfig, ParquetColumnConfigs } from "@/types/table";

const integer = (label: string, group: string): ParquetColumnConfig => ({ group, label, sortable: true, type: "integer" });
const number = (label: string, group: string): ParquetColumnConfig => ({ group, label, sortable: true, type: "number" });

export const backtestTableConfigs: Record<BacktestTableName, ParquetColumnConfigs> = {
  trade_details: {
    sendTime: { filter: "date", filterLabel: "日期", filterOrder: 0, label: "委托时间", pin: "start", sortable: true, type: "datetime", size: 112 },
    symbol: { filter: "text", label: "证券代码", pin: "start", type: "string", size: 140 },
    tradeTime: { group: "成交", label: "成交时间", sortable: true, type: "datetime", size: 112 },
    orderStatus: {
      enum: {
        "4": { label: "已报", tone: "blue" },
        "2": { label: "撤单成功", tone: "neutral" },
        "1": { label: "已成", tone: "green" },
        "0": { label: "部成", tone: "amber" },
        "-1": { label: "审批拒绝", tone: "red" },
        "-2": { label: "撤单拒绝", tone: "red" },
        "-3": { label: "未成交订单", tone: "neutral" }
      },
      filter: "enum",
      filterLabel: "订单",
      filterOrder: 40,
      label: "订单状态",
      type: "enum",
      size: 128
    },
    orderId: { defaultVisible: false, label: "订单编号", sortable: true, type: "integer", size: 128 },
    direction: {
      enum: {
        "1": { label: "买入开仓", tone: "blue" },
        "2": { label: "卖出开仓", tone: "red" },
        "3": { label: "卖出平仓", tone: "amber" },
        "4": { label: "买入平仓", tone: "green" }
      },
      filter: "enum",
      filterLabel: "方向",
      filterOrder: 30,
      group: "委托",
      label: "买卖方向",
      type: "enum"
    },
    orderPrice: number("委托价格", "委托"),
    orderQty: integer("委托数量", "委托"),
    tradePrice: number("成交价格", "成交"),
    tradeQty: integer("成交数量", "成交"),
    label: { filter: "text", filterOrder: 20, label: "策略标签", pin: "end", type: "string", size: 160 }
  },
  daily_positions: {
    tradeDate: { filter: "date", filterLabel: "日期", filterOrder: 0, label: "交易日期", pin: "start", sortable: true, type: "date", size: 132 },
    symbol: { filter: "text", label: "证券代码", pin: "start", type: "string", size: 140 },
    lastDayLongPosition: integer("昨日多头持仓", "昨日持仓"),
    lastDayShortPosition: integer("昨日空头持仓", "昨日持仓"),
    longPosition: integer("多头持仓", "多头持仓"),
    longPositionAvgPrice: number("多头持仓均价", "多头持仓"),
    shortPosition: integer("空头持仓", "空头持仓"),
    shortPositionAvgPrice: number("空头持仓均价", "空头持仓"),
    todayBuyVolume: integer("当日买入数量", "买入交易"),
    todayBuyValue: number("当日买入金额", "买入交易"),
    todaySellVolume: integer("当日卖出数量", "卖出交易"),
    todaySellValue: number("当日卖出金额", "卖出交易"),
    closePrice: { label: "收盘价", pin: "end", sortable: true, type: "number", size: 128 }
  },
  daily_portfolios: {
    tradeDate: { filter: "date", filterLabel: "日期", filterOrder: 0, label: "交易日期", pin: "start", sortable: true, type: "date", size: 132 },
    netValue: number("策略净值", "收益"),
    totalReturn: { ...number("累计收益率", "收益"), format: "percent" },
    benchmarkClosePrice: number("基准收盘价", "基准"),
    benchmarkNetValue: number("基准净值", "基准"),
    totalEquity: number("总资产", "资产"),
    totalMarketValue: number("持仓市值", "资产"),
    cash: number("可用现金", "现金"),
    frozenFunds: number("冻结资金", "现金"),
    ratio: { ...number("当日收益率", "收益"), format: "percent" },
    pnl: number("当日盈亏", "盈亏"),
    floatingPnl: number("浮动盈亏", "盈亏"),
    realizedPnl: number("已实现盈亏", "盈亏"),
    totalPnl: number("累计盈亏", "盈亏"),
    totalFee: number("累计手续费", "费用")
  },
  daily_trading_statistics: {
    tradeDate: { filter: "date", filterLabel: "日期", filterOrder: 0, label: "交易日期", pin: "start", sortable: true, type: "date", size: 132 },
    symbol: { filter: "text", label: "证券代码", pin: "start", type: "string", size: 140 },
    todayBuyOpenTradeVolume: integer("买入开仓数量", "买入开仓"),
    todayBuyOpenTradeValue: number("买入开仓金额", "买入开仓"),
    todayBuyOpenAvgPrice: number("买入开仓均价", "买入开仓"),
    todaySellOpenTradeVolume: integer("卖出开仓数量", "卖出开仓"),
    todaySellOpenTradeValue: number("卖出开仓金额", "卖出开仓"),
    todaySellOpenAvgPrice: number("卖出开仓均价", "卖出开仓"),
    todaySellCloseTradeVolume: integer("卖出平仓数量", "卖出平仓"),
    todaySellCloseTradeValue: number("卖出平仓金额", "卖出平仓"),
    todaySellCloseAvgPrice: number("卖出平仓均价", "卖出平仓"),
    todayBuyCloseTradeVolume: integer("买入平仓数量", "买入平仓"),
    todayBuyCloseTradeValue: number("买入平仓金额", "买入平仓"),
    todayBuyCloseAvgPrice: number("买入平仓均价", "买入平仓")
  }
};
