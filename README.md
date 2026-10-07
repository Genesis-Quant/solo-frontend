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

提供五类项目管理、版本详情、只读参数与依赖、产物清单、策略组装和任务及日志窗口；项目和研究成果读取真实 Backend 接口。成功版本复用 Arena 的 `FactorAnalysisReport`、`BacktestReport` 及其 DuckDB、统计与图表实现：因子项目显示因子分析，其余项目暂用同一份策略回测报告。运行中和失败版本显示任务状态。

报告通过 `src/assets/lib/reports.ts` 按运行清单中的 `versions.scheme` 大版本选择适配器。当前支持 Scheme 1.x；未知或缺失版本显示错误，不回退套用旧报告。适配器决定报告文件映射、因子列、收益持有期和显示参数，图表组件通过注入的数据接口读取 Parquet。左侧下载链接与图表使用同一份运行清单。

运行记录提供 `reportPath`（相对于共享 runs 目录的输出目录），前端读取 `/api/v1/reports/{reportPath}/run.json` 及其中声明的 Parquet。报告版本取自该次实际运行，与项目创建时的版本无关；未关联真实目录的记录不会显示示例报告。

## Notebook iframe

`/embed/report?project=factor&version=1.0.0&path=<run-id>/report` 只展示报告，不加载工作台导航、项目列表和轮询。

- `project`：`factor`、`model`、`optimize`、`control` 或 `execution`。
- `version`：Scheme 版本（也接受 `v1.0.0`）；前端按主版本选择适配器，并检查报告清单中的实际 Scheme 主版本。
- `path`：共享 `/shared/runs` 下包含 `run.json` 的报告目录，可传相对路径或 `/shared/runs/...` 绝对路径。
- `theme`：可选 `light` 或 `dark`，只影响 iframe，不改变工作台保存的主题偏好。

在 Jupyter 中使用标准 IPython 组件：

```python
from urllib.parse import urlencode
from IPython.display import IFrame, display

query = urlencode({
    "project": "factor",
    "version": "1.0.0",
    "path": "<run-id>/report",
    "theme": "light",
})
display(IFrame(f"http://127.0.0.1:5174/embed/report?{query}", width="100%", height=1000))
```

URL 使用浏览器能访问的前端地址。报告数据由前端通过后端读取，Notebook 不内嵌 JS、WASM 或 Parquet。本入口用于已生成完整运行清单的报告；仅调用 `report.save()` 输出的 Parquet 目录目前不包含该清单。

创建项目时先选择 Scheme，再选择兼容 Algo。根据版本接口返回的实际包版本，前端只允许选择已实现业务适配的 Scheme 大版本；更新适配器时同步更新 `scheme.ts` 的支持列表。策略组装的后续项目另按实际 Scheme 的主版本、次版本过滤，补丁版本可不同，例如 1.2.0 与 1.2.7 可互选，但 1.1.x 和 1.3.x 不会混入。项目互调使用 `sameSchemeSeries`，报告继续使用 `schemeMajor`，1.x 不同次版本的报告仍由同一个 v1 适配器渲染。

UI 基础组件位于 `src/ui`，通过 shadcn 官方 CLI 的 `new-york` 注册表安装；页面只组合这些组件。组件中的 `cn` 导入统一使用项目现有工具函数。

`src/components` 按界面形态分类：`badge`、`bar`、`card`、`chart`、`field`、`modal`、`panel`、`table`。不按业务内容、状态或实现技术建立 `log`、`status`、`motion`、`layout` 等目录；分页组件归入 `bar`，日志与折叠容器归入 `panel`。

退役状态与原因由 Backend 返回。历史项目和报告继续显示，退役项目不能新提交或作为策略候选，退役成果不会被当前项目的新环境状态遮盖；候选缺失实际 Scheme 时不猜测创建 Tag。没有活跃 Scheme 或模板时提示无法新建，不回退到退役版本。页面禁用只用于交互提示，Backend 同样执行准入校验。`src/assets/lib/prototype.ts` 保留显式标记的原型数据，不会冒充真实研究记录。

“打开 Jupyter”通过 Backend 跳转项目 Notebook；创建时由 Backend 准备 `/shared/projects/{类型}/{项目名}`、uv 环境和 Kernel。
