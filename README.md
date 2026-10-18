# Solo Frontend

沿用 Arena 的 React 19、Vite、TypeScript、Tailwind CSS 4、Radix UI、Zustand、Axios，以及 `src/views`、`layout`、`components`、`ui`、`assets/lib`、`assets/styles`、`store`、`types` 分层。

```powershell
npm ci
npm run dev
```

默认地址：`http://127.0.0.1:5174`；`/api` 代理到 `http://127.0.0.1:8010`。可在 `.env.local` 配置 `SOLO_BACKEND_URL`。

```powershell
npm run lint
node --test tests/*.test.mjs
npm run build
```

提供五类项目管理、版本详情、只读参数与依赖、产物清单、策略组装和任务及日志窗口；项目和研究成果读取真实 Backend 接口。成功版本复用 Arena 的 `FactorAnalysisReport`、`BacktestReport` 及其 DuckDB、统计与图表实现：因子项目显示因子分析，其余项目暂用同一份策略回测报告。运行中和失败版本显示任务状态。

报告通过 `src/assets/lib/reports.ts` 按运行清单中的 `versions.scheme` 大版本选择适配器。当前支持 Scheme 1.x；未知或缺失版本显示错误，不回退套用旧报告。适配器决定报告文件映射、因子列、收益持有期和显示参数，图表组件通过注入的数据接口读取 Parquet。左侧下载链接与图表使用同一份运行清单。

因子报告在日期条下、所有报告卡片上方提供“因子 / 收益率 / IC 类型”三个统一 select，默认第一因子、第一收益列与 `RankIC`，不提供“全部”。IC 时序、指标、图表范围与衰减使用同一 `RankIC | IC`；衰减仍保留所有收益列横轴，并高亮当前收益列。收益、多空、分组及换手共用所选因子和收益规格，分组正序 / 倒序等独立控制保留。DSL 执行统计仅受日期区间影响。切换三个维度不重置日期、不重建 DuckDB 或重新下载 Parquet；真实报告身份（文件、元数据或 workflow）变化才重置，普通等值轮询不会清空选择。

新运行清单从 `input.analysis.period / price_column / max_lag` 读取收益契约，任一新字段出现即要求完整合法，不静默回退。例如 `period=5, price_column="open_hfq", max_lag=3` 的生产结果应记录 `P5L1 / P5L2 / P5L3`，每列规格为 `{ "kind": "log", "periods": 5, "lag": k, "price_column": "open_hfq", "turnover_period": 5 }`，不生成因子当日收盘价起算的标签。`lag=k>=1` 指 t+k 入场、t+k+periods 出场，按完整交易日轴计算 `P{period}L{k}(t)=ln(price_column(t+k+period)/price_column(t+k))`：P5L1 为 t+1 → t+6，P5L2 为 t+2 → t+7，P5L3 为 t+3 → t+8。入场与退出使用同一价格列，仅支持 `open / close / open_hfq / close_hfq`，hfq 字段直接使用、不再乘 `adj_factor`；`periods` 与 `lag` 必须为正整数，不能从标签数字猜测。行情仅读取闭区间 `[start,end]`，不读取结束日后的未来区间；缺价或非正端点为 NULL，不跳过交易日或补零。

换手使用每个收益规格的 `turnover_period`，缺省才使用 `periods`；新 P 收益等于 period，不是 lag。查询实际换手 Parquet 的可用 `periods`，缺对应间隔显示无数据，不冒用其他间隔。

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
  "schemeVersion": "1.10.0",
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
    "return_columns": ["P5L1", "P5L2", "P5L3"],
    "return_specs": {
      "P5L1": { "kind": "log", "periods": 5, "lag": 1, "price_column": "open_hfq", "turnover_period": 5 },
      "P5L2": { "kind": "log", "periods": 5, "lag": 2, "price_column": "open_hfq", "turnover_period": 5 },
      "P5L3": { "kind": "log", "periods": 5, "lag": 3, "price_column": "open_hfq", "turnover_period": 5 }
    },
    "n_groups": 5,
    "n_select": 10
  }
}
```

当前只支持 Scheme 1.x。因子需要 `information_coefficient`、`group_returns`；回测按所选页面读取对应文件，不要求打开报告时四类附件全部存在。文件名必须是清单同目录下的单个名称，允许中文、空格和点开头的名称，不限制扩展名，但拒绝空名、`.`、`..`、路径分隔符、冒号及控制字符。

清单未提供 `theme` 时使用 `light`。回测的 `annualTradingDays` 默认 252，显式提供时必须为正整数；`riskFreeRate` 默认 0，显式提供时必须有限。因子报告固定使用 252 个年交易日和零无风险利率。`parameters` 仅用于 factor，因子列和收益列非空且不重复；当前各收益列使用 `log` 规格及正整数 `periods`，额外规格忽略。分组数及选股数为正整数。历史 `return_1` 等收盘到收盘收益、历史 `r0o` / `r1` 等隔夜 / 日内收益保持原规格，不混为当前 `P{period}L{k}` 同价 log 收益。任意自定义收益列名都依赖显式 metadata，`custom_99` 不代表 99 日。规格中出现 `price_column` 即采用完整价格契约校验：`kind` 必须为 `simple` 或 `log`、`periods` / `lag` 为正整数、价格为四种合法字段之一，不允许混入旧 `session`；显式规格保留原收益类型。任务报告按实际 Scheme 版本识别：1.10 起为 `log`，1.8/1.9 为 `simple`，不将已有数据误标。未使用新价格 metadata 的既有 `simple` / `log` 及可选旧时段信息继续支持。

各分组 raw 收益是当日有效 log 标签的加权均值，IC/RankIC 使用当日因子与原始 log 标签，不平滑。报告为每个因子、收益列和分组计算 `effective(t)=mean(raw(t),...,raw(t-period+1))`：当前及前 `period-1` 个交易期 raw log 收益的算术平均，开头不足 period 时使用已有样本，不额外除以 period，不平均不同 lag。先补齐完整交易日轴，缺失日期保留 NULL；窗口中任一 raw 为 NULL，则当期 effective 为 NULL，不跳过缺失。日期选择先在报告全表上计算窗口再截取，不在所选起点重启；`period=1` 使用同一规则。历史 `simple` raw 收益先转为 `ln(1+r)`，`r<=-1` 或非有限值转为 NULL。旧 `simple` 多期收益须用 `group_turnover` 的完整交易日轴补 NULL，缺少该可靠日历则明确报“缺少完整交易日历”，不按已有行压缩；新版 `log` 的后端 `group_returns` 本身已有完整交易日历，没有 `group_turnover` 仍支持。

分组净值为 `exp(cumsum(effective))`；多空先取同日 `high-low` raw log 收益，再使用同一窗口及 NULL 规则。时序 `value=effective` 为 log，`cumulative=cumsum(effective)` 为 logsum，不是简单收益或净值。均值、年化、波动率和 Sharpe 使用同一有效序列的非 NULL 观测：均值为 logmean，年化为 `logmean*252`，波动率为 `std(effective)*sqrt(252)`，Sharpe 为 `logmean/std(effective)*sqrt(252)`。所有 period 统一展示曲线与统计，不按持有期另设显示限制；NULL 日期保留曲线断点，不补零，不可定义的指标保留 NULL。

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
