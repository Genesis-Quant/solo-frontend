"""Generate deterministic, synthetic Parquet fixtures for Arena's report schemas.

Run with a Python environment containing numpy, pandas and pyarrow.
These are UI examples, not research results or an exchange trading calendar.
"""

from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1] / "public" / "reports"
RNG = np.random.default_rng(20260922)
DATES = pd.bdate_range("2024-01-02", "2025-06-30")
N = len(DATES)


def save(kind: str, name: str, data: dict | list[dict]) -> None:
    path = ROOT / kind / f"{name}.parquet"
    path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(data).to_parquet(path, index=False, compression="zstd")


def factor_report() -> None:
    information = {"time": DATES}
    groups = {"time": DATES}
    market = RNG.normal(0.0003, 0.008, N)
    turnover = []
    for period in (1, 5, 20):
        prefix = f"momentum_20d_return_{period}d"
        ic = RNG.normal(0.055 / period**0.25, 0.09, N)
        information[f"{prefix}_ic"] = ic
        information[f"{prefix}_rank_ic"] = np.clip(ic * 0.8 + RNG.normal(0.013, 0.025, N), -1, 1)
        for index, group in enumerate(("bottom", "group0", "group1", "group2", "group3", "group4", "top")):
            daily = market + (index - 3) * 0.00023 + RNG.normal(0, 0.0018, N)
            # Forward returns with overlapping horizons, matching the report's horizon handling.
            groups[f"{prefix}_{group}"] = np.array([
                np.prod(1 + daily[i : i + period]) - 1 if i + period <= N else np.nan
                for i in range(N)
            ])
        for date in DATES:
            turnover.append({
                "time": date, "factor": "momentum_20d", "periods": period,
                "rank_autocorrelation": np.clip(0.96 - period * 0.014 + RNG.normal(0, 0.02), 0, 1),
                **{group: np.clip(0.09 + period * 0.018 + RNG.normal(0, 0.035), 0, 1)
                   for group in ("bottom", "group0", "group1", "group2", "group3", "group4", "top")}
            })
    sources = 5000 + np.arange(N)
    st = RNG.integers(100, 140, N)
    suspended = RNG.integers(30, 90, N)
    valid = sources - st - suspended
    save("factor", "information_coefficient", information)
    save("factor", "group_returns", groups)
    save("factor", "group_turnover", turnover)
    save("factor", "execution_statistics", {
        "time": DATES, "source_count": sources,
        "filter0_name": "剔除 ST", "filter0_count": sources - st,
        "filter1_name": "剔除停牌", "filter1_count": valid,
        "filtered_count": valid, "retention_rate": valid / sources
    })


def backtest_report() -> None:
    symbols = ["000001.XSHE", "000333.XSHE", "000651.XSHE", "600036.XSHG", "600519.XSHG"]
    common = RNG.normal(0.0004, 0.009, N)
    common[80:100] -= 0.003
    common[250:268] -= 0.004
    prices = np.array([12.0, 60.0, 38.0, 32.0, 1500.0]) * np.cumprod(
        1 + common[:, None] + RNG.normal(0.00025, 0.006, (N, 5)), axis=0
    )
    benchmark = np.cumprod(1 + common)
    cash, total_fee, realized, previous_equity = 1_000_000.0, 0.0, 0.0, 1_000_000.0
    holdings, costs = np.zeros(5, dtype=int), np.zeros(5)
    portfolios, positions, trades, statistics = [], [], [], []
    for day, date in enumerate(DATES):
        close = prices[day]
        previous = holdings.copy()
        buys, sells = np.zeros(5, dtype=int), np.zeros(5, dtype=int)
        # Fixed example: rebalance at every twentieth opening, using yesterday's prices.
        opening = prices[max(day - 1, 0)]
        if day % 20 == 0:
            target = np.floor((cash + holdings @ opening) * 0.95 / 5 / opening / 100).astype(int) * 100
            quantities = target - holdings
            for i in np.argsort(quantities):
                quantity = int(quantities[i])
                if not quantity:
                    continue
                fee = abs(quantity) * opening[i] * 0.0003
                if quantity > 0:
                    costs[i] = (costs[i] * holdings[i] + quantity * opening[i]) / target[i]
                    buys[i] = quantity
                else:
                    realized += -quantity * (opening[i] - costs[i])
                    sells[i] = -quantity
                cash -= quantity * opening[i] + fee
                total_fee += fee
                holdings[i] += quantity
                trades.append({
                    "sendTime": date + pd.Timedelta(hours=9, minutes=30),
                    "tradeTime": date + pd.Timedelta(hours=9, minutes=30, seconds=1),
                    "symbol": symbols[i], "orderId": len(trades) + 1, "orderStatus": 1,
                    "direction": 1 if quantity > 0 else 3, "orderPrice": opening[i],
                    "orderQty": abs(quantity), "tradePrice": opening[i], "tradeQty": abs(quantity),
                    "label": "固定示例"
                })
        market_value = float(holdings @ close)
        equity = cash + market_value
        floating = float(holdings @ (close - costs))
        portfolios.append({
            "tradeDate": date, "netValue": equity / 1_000_000, "totalReturn": equity / 1_000_000 - 1,
            "benchmarkClosePrice": benchmark[day] * 3500, "benchmarkNetValue": benchmark[day],
            "totalEquity": equity, "totalMarketValue": market_value, "cash": cash, "frozenFunds": 0.0,
            "ratio": equity / previous_equity - 1, "pnl": equity - previous_equity,
            "floatingPnl": floating, "realizedPnl": realized, "totalPnl": equity - 1_000_000, "totalFee": total_fee
        })
        previous_equity = equity
        for i, symbol in enumerate(symbols):
            positions.append({
                "tradeDate": date, "symbol": symbol, "lastDayLongPosition": previous[i], "lastDayShortPosition": 0,
                "longPosition": holdings[i], "longPositionAvgPrice": costs[i], "shortPosition": 0, "shortPositionAvgPrice": 0.0,
                "todayBuyVolume": buys[i], "todayBuyValue": buys[i] * opening[i],
                "todaySellVolume": sells[i], "todaySellValue": sells[i] * opening[i], "closePrice": close[i]
            })
            statistics.append({
                "tradeDate": date, "symbol": symbol,
                **{f"today{name}{field}": value for name, quantity in (("BuyOpen", buys[i]), ("SellOpen", 0), ("SellClose", sells[i]), ("BuyClose", 0))
                   for field, value in (("TradeVolume", quantity), ("TradeValue", quantity * opening[i]), ("AvgPrice", opening[i] if quantity else 0.0))}
            })
    save("backtest", "daily_portfolios", portfolios)
    save("backtest", "daily_positions", positions)
    save("backtest", "trade_details", trades)
    save("backtest", "daily_trading_statistics", statistics)


if __name__ == "__main__":
    factor_report()
    backtest_report()
    print(f"Generated 8 fixed Parquet files for {N} example dates in {ROOT}")
