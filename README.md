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

## DuckDB 本地扩展

报告页的 DuckDB Worker、主 WASM 和 Parquet 扩展均随前端部署，不向 `extensions.duckdb.org` 发起运行时下载。`public/duckdb-extensions/v1.5.4/` 保存 EH 与 MVP 两个平台的签名扩展，`src/assets/duckdb-extensions.json` 记录对应 npm/Core 版本、官方来源和字节数。现有资源复用本机历史官方缓存的原始字节，并由 DuckDB 校验签名和版本；没有启用 unsigned 或 metadata-mismatch 选项。

初始化显式配置同源扩展仓库并 `LOAD parquet`，关闭自动安装和自动加载；本地资源缺失时直接显示部署错误，不回退到外部下载。`@duckdb/duckdb-wasm` 精确固定为 `1.33.1-dev57.0`。升级 DuckDB 必须同步更新两个平台的扩展和清单，保持签名校验开启。

Vite 将整个 `public` 目录复制到 `dist`；静态部署时应一起发布 `dist/duckdb-extensions`，Docker 镜像也包含它。此配置覆盖工作台和 Notebook iframe，不改写已有 Scheme 独立 HTML 中冻结的报告资源。

## Notebook iframe

iframe 复用工作台的 `ResearchReport`、图表和同源 DuckDB 签名 Parquet 扩展，不加载工作台导航、项目列表或轮询，不内嵌 data URL、token 或 `srcdoc`，也不修改 Scheme 既有独立 `to_html()`。

### Notebook 清单（Jupyter 文件源）

`report.show()` 的 Jupyter display bridge 使用浏览器可访问的前端 URL：

```text
http://127.0.0.1:5174/embed/report?source=jupyter&path=projects/factor/X/reports/<uuid>/report.json&theme=light
```

- `source=jupyter`：与旧运行报告入口独立，不需要 `project` 或 `version`；Scheme 版本仅取自清单。
- `path`：相对于 Jupyter root（通常 `/shared`）的 `report.json` 路径；拒绝绝对路径、URL、空段、`.`、`..`、反斜线、冒号及 NUL。每个路径段单独编码后请求同源 `/jupyter/solo/files/<path>`。
- `theme`：可选 `light` 或 `dark`，未传时使用清单主题；只影响 iframe，不持久化工作台偏好。

清单是轻量 JSON，不含 Parquet 内容，例如：

```json
{
  "protocol": 1,
  "format": "solo-notebook-report",
  "schemeVersion": "1.2.3",
  "kind": "factor",
  "theme": "light",
  "annualTradingDays": 252,
  "riskFreeRate": 0,
  "files": {
    "information_coefficient": "information_coefficient.parquet",
    "group_returns": "group_returns.parquet"
  },
  "parameters": {
    "factor_columns": ["momentum"],
    "return_columns": ["return_1"],
    "return_specs": { "return_1": { "kind": "simple", "periods": 1 } },
    "n_groups": 5,
    "n_select": 10
  }
}
```

当前只支持 Scheme 1.x。因子需要 `information_coefficient`、`group_returns`；回测按所选页面读取对应文件，不要求打开报告时四类附件全部存在。文件名必须是清单同目录下的单个名称，允许中文、空格和点开头的名称，不限制扩展名，但拒绝空名、`.`、`..`、路径分隔符、冒号及控制字符。

清单未提供 `theme` 时使用 `light`。回测的 `annualTradingDays` 默认 252，显式提供时必须为正整数；`riskFreeRate` 默认 0，显式提供时必须有限。因子报告固定使用 252 个年交易日和零无风险利率。`parameters` 仅用于 factor，因子列和收益列非空且不重复；每个收益列必须有对应的 `simple` 或 `log` 规格及正整数 `periods`，额外规格忽略。分组数及选股数为正整数。旧 `return_1` 等收盘到收盘收益与新版 `r0o`、`r1` 等隔夜/日内收益保持各自定义，不混为同一口径。

### Jupyter 同源代理与登录

Vite 开发服务器增加 `/jupyter` 代理并去掉该前缀，不改变 `/api` 后端代理：

- `SOLO_JUPYTER_API_URL`：固定上游地址，默认 `http://127.0.0.1:8888`；容器内可设为 `http://jupyter:8888`。
- `SOLO_JUPYTER_BROWSER_URL`：用户实际登录的 Jupyter URL，默认 `http://127.0.0.1:8888`；代理使用其 `host` 作为上游 `Host`，以匹配 Jupyter 的签名认证 Cookie。

请先在同一浏览器登录 Jupyter，并保持前端与 Jupyter 的浏览器 hostname 一致（不要混用 `localhost` 与 `127.0.0.1`），这样 Cookie 能跨端口转发。文件 GET 从 `document.cookie` 解码 `_xsrf`，仅对本地 `/jupyter/` URL 添加 `X-XSRFToken`；不会把服务端 `JUPYTER_TOKEN` 注入请求。清单和 Parquet 的重定向、登录页或 HTML 响应会显示明确登录提示，不回退到独立 HTML。

文件下载 anchor 没有 XSRF header，代理仅当 Referer origin 与传入请求的前端 Host/协议严格一致时，将它改写为 Jupyter 浏览器 origin 加原路径及查询。跨站或非法 Referer 不改写，Origin 原样转发，仍由 Jupyter 做来源、认证和文件权限检查；不开放匿名访问，也不绕过跨站 Origin 校验。

生产静态部署必须在前端的同源服务配置 `/jupyter/` 反向代理：固定上游为已部署的 Jupyter，剥离 `/jupyter` 前缀，设置浏览器 Jupyter Host，转发浏览器 Cookie 和 XSRF header，并按上述同源条件改写下载 Referer（HTTPS 前端应使用可信的外部 frontend origin 判断）。不要无条件改写 Origin/跨站 Referer、添加服务端 token 或允许 URL 参数选择代理目标。Vite `server.proxy` 不会进入静态 `dist`；部署时还需保留 `/embed/report` 的 SPA 回退及 `dist/duckdb-extensions` 本地资源。跨 hostname 部署应由同源 Jupyter 登录建立会话，不以关闭认证解决 Cookie 问题。

### 原运行清单入口（保持兼容）

`/embed/report?project=factor&version=1.0.0&path=<run-id>/report` 只展示报告，不加载工作台导航、项目列表和轮询。

- `project`：`factor`、`model`、`optimize`、`control` 或 `execution`。
- `version`：Scheme 实际包版本，接受 1～3 段纯数字，如 `1`、`1.6`、`1.6.3`，不接受带 `v` 的 Tag；前端按主版本选择适配器，并检查报告清单中的实际 Scheme 主版本。
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
