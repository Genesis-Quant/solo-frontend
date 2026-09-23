# Solo Frontend

沿用 Arena 的 React 19、Vite、TypeScript、Tailwind CSS 4、Radix UI、Zustand、Axios，以及 `src/views`、`layout`、`components`、`ui`、`assets/lib`、`assets/styles`、`store`、`types` 分层。

```powershell
npm ci
npm run dev
```

默认地址：`http://127.0.0.1:5174`；`/api` 代理到 `http://127.0.0.1:8010`。可在 `.env.local` 配置 `SOLO_BACKEND_URL`。

```powershell
npm run lint
npm run build
```

当前为交互原型：五类项目管理、版本详情、只读参数与依赖、产物清单、发布流程和全部任务及日志窗口。成功版本复用 Arena 的 `FactorAnalysisReport`、`BacktestReport` 及其 DuckDB、统计与图表实现：因子项目显示因子分析，其余项目暂用同一份策略回测报告。运行中和失败版本显示任务状态。

固定报告数据位于 `public/reports`，由 `scripts/generate-report-fixtures.py` 使用固定种子生成，属于合成示例，不是真实研究结果或交易日历。所有项目和版本复用各自类型的固定报告，界面标记“固定示例”。浏览器直接读取 Parquet，支持日期筛选、指标切换、明细分页与导出；左侧研究产物可下载源 Parquet。后续可将 `src/assets/lib/reportFixture.ts` 替换为真实报告接口。

UI 基础组件位于 `src/ui`，通过 shadcn 官方 CLI 的 `new-york` 注册表安装；页面只组合这些组件。组件中的 `cn` 导入统一使用项目现有工具函数。

项目与发布状态使用独立的 `solo.prototype.research` 本地存储，任务和日志来自 `src/assets/lib/prototype.ts` 示例数据。发布校验为模拟流程；示例 v10 演示接口校验失败。尚未连接项目 API、COS 或 DolphinScheduler，不会实际发布包或提交研究。刷新后保留项目修改和发布状态。

“打开 Jupyter”直接跳转到 `VITE_JUPYTER_URL/lab/tree/projects/{项目 ID}`。可在 `.env.local` 中配置地址；项目目录创建、绑定与 Jupyter 插件集成留待后续接入。
