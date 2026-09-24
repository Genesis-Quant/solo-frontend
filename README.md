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

报告通过 `src/assets/lib/reports.ts` 按运行清单中的 `versions.scheme` 大版本选择适配器。当前支持 Scheme 1.x；未知或缺失版本显示错误，不回退套用旧报告。适配器决定报告文件映射、因子列、收益持有期和显示参数，图表组件通过注入的数据接口读取 Parquet。左侧下载链接与图表使用同一份运行清单。

运行记录提供 `reportPath`（相对于共享 runs 目录的输出目录），前端读取 `/api/v1/reports/{reportPath}/run.json` 及其中声明的 Parquet。报告版本取自该次实际运行，与项目创建时的版本无关。显式标记 `reportFixture: true` 的原型记录仍使用 `public/reports` 中 Scheme 1 的固定合成数据；未关联真实目录的记录不会自动显示示例报告。

创建项目时先选择 Scheme，再选择兼容 Algo。根据版本接口返回的实际包版本，前端只允许选择已实现业务适配的 Scheme 大版本；更新适配器时同步更新 `scheme.ts` 的支持列表。

UI 基础组件位于 `src/ui`，通过 shadcn 官方 CLI 的 `new-york` 注册表安装；页面只组合这些组件。组件中的 `cn` 导入统一使用项目现有工具函数。

项目增删改查已连接 Backend；版本提交、发布和任务记录接口尚未接入，后端目前返回空版本列表。`src/assets/lib/prototype.ts` 保留显式标记的原型数据，不会冒充真实研究记录。

“打开 Jupyter”通过 Backend 跳转项目 Notebook；创建时由 Backend 准备 `/shared/projects/{类型}/{项目名}`、uv 环境和 Kernel。
