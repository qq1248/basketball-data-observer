# 篮球数据观察 (Basketball Data Observer)

## 应用概览

本应用是一款面向篮球数据爱好者的赛事数据观察与分析工具，提供全球篮球赛事数据聚合、模型输出参考、历史数据统计、球队情报整理、伤停追踪等功能。纯数据参考展示，不含任何购彩/交易入口，打开即看，无注册门槛。**首页与页脚均展示「数据仅供参考，不构成任何投注建议」免责声明。**

## 技术架构

- **前端**: React 19 + TypeScript + Tailwind CSS + shadcn/ui
- **后端**: NestJS 10 + Drizzle ORM + PostgreSQL
- **用户系统**: 平台内置登录，基于 `req.userContext`

## 模块划分

### 后端模块
- `basketball` - 篮球比赛管理（列表、详情、预测模型）
- `sync` - 数据同步 ingest 端点（球美宝/ESPN/竞彩官方）
- `teams` - 球队档案
- `injuries` - 伤停情报
- `statistics` - 数据统计
- `model-rules` - 模型规则
- `admin` - 后台管理

### 前端页面（已实现）
- `/` - 今日赛事（首页，足球+篮球）
- `/match/:id` - 足球比赛详情
- `/basketball` - 篮球今日赛事
- `/basketball/detail/:id` - 篮球比赛详情
- `/basketball/stats` - 篮球数据统计
- `/basketball/backtest` - 篮球回测中心
- `/stats` - 数据统计（足球）
- `/stats/football` - 足球数据统计
- `/performance` - 模型表现
- `/performance/football` - 足球模型表现
- `/beidan` - 北单赛事
- `/teams` - 球队档案
- `/teams/:id` - 球队详情
- `/teams/by-name/:name` - 球队按名称查询
- `/rules` - 模型规则说明
- `/profile` - 个人中心
- `/admin` - 后台管理（需管理员权限）
- `/help` - 帮助中心
- `/support` - 支持与反馈
- `/about` - 关于我们
- `/brand` - 品牌页
- `/parlay` - 重定向至首页
- `/basketball/parlay` - 重定向至篮球首页

### 规划中（暂未实现）
- `/injuries` - 伤停情报中心
- `/disclaimer` - 免责声明独立页（目前免责声明在各页面内嵌展示）

## 数据模型

### team_season_stats 球队赛季基线表

存储球队历史赛季攻防基线数据，用于赛季初样本不足时补充预测引擎。

- 表结构：team_name, league, season, sport, ppg, oppg, games_played, data_source
- 数据来源：StatMuse 2024-25赛季NBA常规赛30队完整82场数据（data_source='statmuse_2024-25'）
- 触发条件：本赛季完赛场次 < 5 场时启用，等效 15 场样本量，绕过 V11 小样本收缩
- 过渡逻辑：sample >= 5 场后按本赛季数据与历史基线比例融合（赛季数据权重递增）
- 作用路径：bbComputeHistoricalTeamStats → bbFillHistoricalStats → generateBasketballPrediction → V11 锚定引擎
- 大小分概率仍 clamp [40%, 60%]，防止极端化

### 预测引擎 V11.1 统一引擎（自动升级 + 数据不足降级）

**升级目标**：消除双轨引擎（锚定V10 + data-driven v1.0）导致的预测反复，统一upcoming/live/finished全部场次走同一套引擎。在锚定模型基础上融合data-driven的Elo评分、近期战绩、H2H交锋、伤停等丰富特征，恢复大小分区分度。

**自动升级机制**：
- 触发时机：每次定期重算（daily_full_sync / base_sync / odds_intel_update / on_sale_capture / injury_backfill / espn_enrichment）时，先刷新 data-driven 预测，再对数据充足的场次自动升级为 V11 统一引擎
- 升级判定条件（满足任一即可升级）：
  - 主客两队均有 teamStats（pointsPerGame/ppg > 0）
  - 主客两队均有近期战绩（recentForm 非空）
  - 有 H2H 交锋历史（h2hHistory 非空）
  - 有伤停数据（injuries 非空）
  - 有情报文本（intel/intelSummary 长度 > 20）
- 数据不足降级：不满足以上条件的场次保持 data-driven-v10.1，不强行升级；符合 V11 数据不足设计原则
- 升级单向性：V11 场次永远不会回退到 data-driven（由 prediction-guard 保护）
- 伤停数据到达后自动触发 injury_backfill → 重算 → 自动升级，无需人工干预

**核心架构**：
- 基底：锚定V10.2（指数线为锚 + 客队热门降权 + 双向判定边缘区间）
- 让分融合：Elo评分加权融合（权重0.25），修正预期净胜分
- 大小分融合（V11新增）：
  - 近期战绩分层：近10场60%权重 + 近20场40%权重，融合权重10-35%（数据越充分权重越高）
  - H2H交锋净胜分效应：系数0.3，权重10-25%
  - 伤停压小增强：效应幅度×1.5
- 数据不足降级：无战绩/H2H数据时保留锚定基线，显式标记"V11 近期战绩数据不足，未做融合校准"

**让分V10.2规则完全保留**：
- 客队热门系统性降权：独立预期净胜分向主队方向调整1.5分；中盘3.5-6分额外+0.8分，深盘10.5-15分额外+0.6分；赛季末/季后赛客队大热门再+1.0分
- 双向判定边缘区间（对称±2）：模型预期比热门方线强≥2分 → 押热门方（中/高信心）；模型预期比热门方线弱≤-2分 → 反向押受让方（低信心）；介于±2之间 → 跟指数线热门方，低信心
- 伤停融合：热门方核心缺阵≥2人 → 禁止押热门方，转向受让方（低信心）
- 深盘放宽：≥25分且赢盘概率47%-53%才观望；12-24分一律给方向（低信心）

### 伤停门禁规则（V11 强制预检）

**核心原则**：禁止在伤停未核验的情况下输出预测。每次预测重算前必须自动从外部权威源（ESPN）抓取伤停数据并按主客正确归属入库，然后才允许重算预测。

**实现机制**：
- 位置：`recalcBasketballUpcomingPredictions()`（service入口）与 `recalcBasketballPredictions()`（sync-scheduler入口）双入口均加门禁
- 触发条件：NBA/WNBA upcoming 比赛中 `injuries IS NULL` 的场次
- 抓取方式：调用 ESPN summary 接口（`fetchBasketballSummary`），按 `header.competitions[].competitors[].homeAway` 匹配主客队伤停，禁止按数组索引
- 失败降级：抓取失败或无 sourceId 时跳过该场，不阻断整体重算，仅打 warn 日志
- 同步后自动升级：伤停数据到达后触发重算，满足 V11 升级条件的场次自动升级为统一引擎

**大小分V11分层闸门**：
- 浅/中盘（差<8分）：阈值4分
- 深盘（8-15分）：阈值2分
- 超深盘（≥15分）：阈值3分
- 概率约束区间 [40%, 60%]
- 融合增强：有近期战绩/H2H/伤停数据时，基于预期总分与线值的差计算概率，不再贴线50/50

### V11.2 攻防效率均值大小分模型（替换纯指数线锚定）

**核心目标**：用真实攻防数据计算每场预期总分，替换纯指数线锚定+clamp[40%,60%]的无判断力降级，输出真实差异化的大小分概率。

**计算公式**：
- 预期总分 = (主队PPG + 客队PPG + 主队OPPG + 客队OPPG) / 2 + 攻防不对称修正 + 伤停压小
- 数据优先级：本赛季 team_stats.pointsPerGame/opponentsPointsPerGame（样本≥5场）→ 2024-25 team_season_stats.ppg/oppg（82场基线，等效15样本）
- 攻防不对称修正：进攻强队对防守弱队上调，用 (主PPG×客OPPG) / (主OPPG×客PPG) 的比例微调，幅度≤±1.5分
- 伤停压小：核心缺阵每人0.4分（NBA），≥4人上限2分；WNBA每人1.5分，≥4人上限6分

**概率计算**：
- 净差 = 预期总分 - 官方 total_line_num
- 净差 ≥ +3分 → 大分方向，概率 = 50% + 净差×2%（上限70%）
- 净差 ≤ -3分 → 小分方向，概率 = 50% + |净差|×2%（上限70%）
- |净差| < 3分 → 贴线，方向按净差符号取大/小，概率55%封顶（线性插值）
- 概率允许真实分布（30%-70%），不再硬clamp到[40%,60%]

**接入路径**：
- V11 锚定路径：basketball-anchor-prediction.service.ts 中，当 homePpg/awayPpg/homeOppg/awayOppg 齐全时启用
- data-driven 路径：basketball-data-driven.service.ts 中，同条件启用，替换旧版正态CDF大小分计算
- 生效范围：所有具备 PPG+OPPG 数据的比赛（NBA/WNBA/欧篮联等）

**自洽性守卫（V11.1 通用）**：
- 在预测结果返回前强制校验：`totalDirection='大分'` 必须满足 `predictedTotal >= totalLineNum`，`totalDirection='小分'` 必须满足 `predictedTotal <= totalLineNum`
- 不一致时以方向为准，将预期总分微移至线值另一侧（差0.1分贴线），并同步重算预期比分，确保三分量（方向/预期总分/预期比分）严格自洽
- 触发场景：盘口线变动后预测未及时重算、多路径计算结果漂移、临界场次精度误差等导致的方向与数值错位
- model_rules 追加「自洽校准：预期总分与方向对齐至贴线临界」标记

**已知局限与迭代方向（V11.4 待建）**：
- 伤停与系列赛交互效应：核心球员缺阵的场次应从系列赛基线中排除或降权
- 主客场分拆：系列赛主场场均总分 vs 客场场均总分差异显著，当前取均值抹平了主客场效应
- 让分端系列赛实证：当前仅校准大小分，让分/胜负预测仍以常规赛Elo+效率模型为基底，未引入系列赛赢盘趋势因子

### V11.5 浅盘近期状态修正与伤停解耦（已实现 2026-10-23）

**核心目标**：消除浅盘修正（formAdj）对伤停数据的依赖，使所有 |线|<5.5 分的场次均能执行近期状态校准，不再因伤停数据为 0 而一并跳过。

**解耦前问题**：浅盘修正绑在 `computeInjuryAdjustment()` 内部，函数开头 `totalWeighted===0 直接 return` 导致 96% 的 v11.1-unified 浅盘场（无伤停数据）的近期状态校准被完全跳过。

**解耦后架构**：
- 独立函数 `applyShallowLineFormAdjustment()` — 纯近期状态修正，不依赖伤停
- `computeInjuryAdjustment()` — 仅处理伤停加权部分
- 调用顺序：伤停加权 → 浅盘修正（叠加到 modelSpread，各自有限制）
- 版本标记：v11.5-shallow-form（仅浅盘）/ v11.5-full（伤停+浅盘）

**参数保持不变**：0.15σ 浅盘系数、近10场净胜差×0.08、±1.5 分上限、爆冷抑制 0.8 分（差≤3.5 分时启用）。

**激活条件**：|让分线| < 5.5 且 主客近期净胜差不全为 0。

**当前影响范围**：
- 赛季初（10 月）NBA 新赛季刚开始，球队样本不足 → 今日 16 场均未激活
- 真正收益期：赛季中段（球队 10+ 场样本后）的 v11.1 浅盘场（无伤停但有近期战绩数据）
- 近 30 天 1337 场 v11.1 浅盘完赛场次为理论收益池（实际激活比例取决于赛季阶段）

### V11.4 让客深盘降权 + 赛季报销正则补全（已实现 2026-10-22）

**让客深盘降权（核心规则）**：
- 回测发现：近30天让客方向 6-10 分深盘 5 场 0 命中（全输），是 V11.3 最大短板
- 规则：让分客胜 + |让分线| ∈ [6, 10) 分 → 让分信心强制降为「低」+ 最终 confidence 上限 55%
- 例外（不降权）：V11.3 引擎且伤停净修正 ≥ 1 分（伤停显著支撑让客方向时保留原信心）
- 触发位置：basketball-anchor-prediction.service.ts 中 V11 锚定路径

**赛季报销正则补全（伤停权重修复）**：
- 扩充 isSeasonOut 正则从 5 分支到 18+ 分支，补全以下表达：
  - `miss.*season` / `out for the season` / `for the rest of the season`（赛季报销）
  - `indefinitely`（无限期缺阵）
  - `year(s)`（年度级缺阵）
  - `torn`（撕裂：跟腱/十字韧带/半月板等）
  - `rupture`（断裂）
  - `fracture`（骨折）
  - `achilles surgery` / `ACL` / `Achilles` 等具体重伤手术
- 长期缺阵权重：fresh × 0.4（赛季报销级，从默认 1.0 降为 0.4）
- 修复位置：recalc-by-date 路径（原仅 5 分支极简正则）统一对齐完整版
- 验证：Oweh（跟腱断裂 miss the entirety of the season）从 1.0 → 0.4，307 伤停净调整 -1.1 → -0.4 分

### V11.7 intel路径效率模型收缩缺口修复（已实现 2026-10-24，升级至 anchor 基线对齐版）

**问题根因**：intel 路径 baselineSpread 来自 anchor 预测比分（纯效率模型产出，scoreSpread 未经过 V11.7 收缩），导致 intel 端 modelSpread 远高于 anchor 端。原 V11.7 只收缩 intelAdjust（伤停等情报调整量），效率模型主体完全未收缩。附加 bug：spreadVsLine 在 V11.7 收缩之前计算，导致收缩后的 modelSpread 未用于让分概率计算。

**修复方案 v1（双层收缩）**：
- V11.7 扩展为双层收缩：① baselineSpread 向指数线收缩 50%（效率模型权重减半） ② intel 调整量收缩 50%
- 修复 spreadVsLine 计算顺序：移到 V11.7 收缩之后

**修复方案 v2（anchor 基线对齐 + 65% 情报收缩）—— 当前版**：
- 根因进一步定位：anchor 端预测比分用 scoreSpread（效率模型原始值），而让分判定用 modelSpread（V11.7 收缩后），两者不等值
- 架构修正：`IntelBaselinePrediction` 新增 `modelSpread` 字段，anchor 端直接传入 V11.7 收缩后的最终 modelSpread
- intel 路径 V11.7 逻辑改为：直接以 anchor 的 modelSpread 为基线，不再从预测比分反推效率模型基线
- intel 调整量收缩 75%（赛季初情报可靠性降低，仅保留25%权重）
- 触发条件：NBA 联赛 + anchor 端已触发 V11.7 NBA赛季初稳定化
- model_rules 标记：V11.7 NBA赛季初稳定化（情报端）：anchor基线对齐+情报65%收缩

**量级对比（305 雄鹿vs公牛，赛季初样本<5场）**：
- anchor V11.7 后 modelSpread ≈ 8.1 分 → confidence ≈ 75%
- intel 修复前 modelSpread ≈ 19.4 分 → confidence = 95%（clamp上限）
- intel v2修复（anchor基线+75%情报收缩）：modelSpread ≈ 8.4 分 → confidence ≈ 76% ✓
- 从 95% 降到 76%，与 anchor 75% 基本对齐（intel 有少量情报支撑，略高 1pp）

**normalCdf 公式修复（同期修复）**：
- 修复前：normalCdf 函数公式错误（exp(-z) 而非 exp(-z²/2)），z=0.5 时返回约 95% 而非 69%
- 修复后：采用 Abramowitz & Stegun 近似公式，数值与标准正态分布一致
- 影响范围：intel 路径所有场次的胜负概率（homeWinProb/confidence）

### V11.4 让客深盘降权 intel路径修复（已实现 2026-10-24）

**问题根因**：V11.4 让客深盘信心降为低+上限55%只在 anchor-prediction.service 实现，但 intelService.applyToPrediction 会重新计算 confidence 覆盖 anchor 值，导致 intel 路径场次（v11.3-injury-weighted）的深盘让客信心始终不降权（如湖人vs快船72%、雷霆vs掘金69%）。

**修复方案**：在 sporttery.service.ts 的 generateBasketballPrediction() 中，intel 路径后和 anchor 路径后各加一次 V11.4 final cap 校验（与 V11.8 同一位置），让客深盘 |线| ∈ [6, 10) 分 → confidence 硬上限 55%。

**边界对齐（与 V11.8 无冲突）**：
- V11.4 生效区间：6 ≤ |让分线| < 10 分（深盘让客）→ confidence ≤ 55%
- V11.8 浅盘生效：|让分线| < 6 分（浅盘让客）→ confidence ≤ 70%
- **超深盘 ≥ 10 分让客：不降权**（V11.8 明确例外，近60天让客超深盘88.9%命中，强队深盘穿盘率高）
- 边界 10.0 分归属：≥10.0 归超深盘（不降权），明确写死

**设计决策——去除伤停例外**：原 anchor 端 V11.4 有例外（伤停净修正≥1分时保留原信心），但 intel 路径后 adjustBreakdown 中无直接的伤停净修正分数字段，硬判断字段名易错。为简化+保守，final cap 一律降到 55%，不设例外。

**触发位置**：sporttery.service.ts generateBasketballPrediction() 两处返回前（intel 路径后 + anchor 路径后）

**model_rules 标记**：`V11.4 让客深盘降权：最终信心上限55%（intel路径后校验）`

### V11.8 让客信心整体收缩（已实现 2026-10-23）

**核心问题**：让客方向信心系统性高估——近60天 V11 时代让客高信心(≥65%)19场仅57.9%命中（平均信心74.5%，高估16.6pp）；让主高信心27场70.4%（高估10.3pp）；让客比让主多高估约6pp。V11.3伤停加权版让客也只有44.4%（9场），伤停数据不构成例外。

**两级收缩机制**：
- **pickSide 档级降档**：让客方向高→中信心，中→低信心（锚定路径，basketball-anchor-prediction.service.ts）
- **最终 confidence 上限 70%**：|让分线| < 6 分的让客场次，最终 confidence 强制 ≤ 70%
- **双路径校验**：anchor 路径 + intel 路径后各校验一次（intelService.applyToPrediction 会重新计算 confidence 覆盖 anchor 值）
- **V11.4 深盘 55% 仍优先**：6-10 分让客深盘由 V11.4 55% 上限管理
- **超深盘（≥10分）不降权**：近60天让客超深盘88.9%命中（9场），强队深盘穿盘率高，不降权

**触发位置**：
- basketball-anchor-prediction.service.ts — pickSide 档级降档 + anchor 路径 final cap
- sporttery.service.ts generateBasketballPrediction() — intel 路径后 final cap（第14301行/14327行两处返回前）

### V11.10 让主深盘降权（已实现 2026-10-25）

**核心问题**：让主深盘（6-10分）高信心命中率偏低（周五档≥70% 让主高信心翻车率高），对称于 V11.4 让客深盘问题，但程度较轻。

**降权规则**：让分主胜 + |让分线| ∈ [6, 10) 分 → confidence 硬上限 70%
- 比 V11.4 让客深盘 55% 温和（让主方向历史表现优于让客）
- 超深盘 ≥10 分不降权（强队深盘穿盘率高）

**触发位置**：sporttery.service.ts generateBasketballPrediction() 两处返回前（intel 路径后 + anchor 路径后）

**model_rules 标记**：`V11.10 让主深盘降权：最终信心上限70%`

**代码落地修正说明**：
- 初始版本仅在 anchor-prediction.service 加 V11.8，但 intelService.applyToPrediction 会重新计算 confidence 覆盖锚定值，导致 V11.3 场次（都走 intel 路径）的最终 confidence 未被压缩
- 修正：在 sporttery.service 的两条返回路径（intel路径 + anchor路径）前各加一次 V11.8 final cap 校验

### V11.13 信心结构全面校准（2026-10-29，数据驱动）

**触发背景**：近30天 V11 完赛场次回测发现高信心整体倒挂——高信心让分命中率51.2% < 中信心67.5% < 低信心53.3%。三大痛点：①让客≥70%仅42.9%（灾难级）②大分中信心仅52%（远低于小分73.3%）③NBA大分重灾区仅51.2%

**三项校准规则**：

1. **V11.13a 让客信心全线下压**：让分客胜 + confidence ≥ 68% → 统一 cap 到 65%
   - 依据：让客高信心(≥70%)14场仅42.9%命中，65-69%区间样本少波动大
   - 影响：让客场次不再有高信心档，全部降为中高边界
   - 与 V11.8/V11.4 关系：V11.8 浅盘70%上限 + V11.4 深盘55%上限 仍生效，V11.13a 在此基础上进一步收紧中浅盘

2. **V11.13b 大分方向信心收缩**：total_direction='大分' + confidence > 62% → cap 到 62%
   - 依据：中信心大分仅52%命中率（小分73.3%），NBA大分仅51.2%
   - 影响：大分方向最高只能到中信心上沿，不再给高信心

3. **V11.13c 高信心门槛上调**：非让客非大分的场次，confidence 在 [65, 68) 区间 → 降到 64%
   - 依据：高信心整体命中率51.2%说明65%门槛太松，需收紧到68%以上才算高信心
   - 影响：原来65-67%的"高信心"全部降为中信心，高信心里只留真正稳定的

**触发位置**：sporttery.service.ts generateBasketballPrediction() 两处返回前（intel 路径后 + anchor 路径后）

**优先级**：V11.7/V11.9 赛季初保护 → V11.8 让客浅盘70% → V11.4 让客深盘55% → V11.10 让主深盘70% → V11.13a 让客65% → V11.13b 大分62% → V11.13c 高信心门槛68%（后执行的规则覆盖前者，但只降不升）

**预期效果**：
- 高信心场次数量减少约60%，命中率从51%→约65%+（只留最确定的）
- 让客场次全部退出高信心档
- 大分方向全部退出高信心档

### V11.14 让分低信心降级+深盘上限（已实现 2026-10-29）

**触发背景**：周三档让分仅50%（7/14），低信心场全灭（0/3），深盘让主高信心翻车率高。回测近14天117场完赛场次数据驱动定参。

**两项校准规则**：

1. **V11.14a 让分低信心降级观望**：让分信心 ≤ 55% → 让分推荐改为「观望」
   - 依据：近14天conf≤55的21场仅42.9%命中，是低信心段的核心拖累
   - 效果：117场→89场（-23.9%），命中率59.0%→62.9%（+3.9pp）

2. **V11.14b 让主深盘上限66%**：让分主胜 + |让分线| ≥ 8.5 分 + confidence > 66% → cap 到 66%
   - 依据：让主深盘(8.5+)高信心命中率偏低，赛季初尤其明显（如311让主9.5@68%翻车）
   - 与 V11.10 关系：V11.10（6-10分让主深盘cap70%）仍生效，V11.14b 在 ≥8.5 分区间进一步收紧到66%

**触发位置**：sporttery.service.ts generateBasketballPrediction() 两处返回前（intel 路径后 + anchor 路径后）

**优先级**：V11.7/V11.9 → V11.8 → V11.4 → V11.10 → V11.13 → V11.14b → V11.14a（后执行覆盖前者，只降不升）

### V11.3 季后赛实证修正（已实现 2025-10-21）

**核心目标**：用季后赛系列赛真实攻防数据校准预期总分，解决常规赛攻防效率均值在季后赛阶段系统性偏高的问题。

**计算公式**：
- 系列赛加权融合：系列赛实际场均总分 vs 常规赛模型预期总分，按场次权重混合
  - G1-G2：55%权重、G3-G4：65%权重、G5+：75%权重
- 盘口趋势因子（双路）：
  - 开盘线可用：线移 × 0.3
  - 无开盘线但有系列赛历史盘口：系列赛首战盘口→当前 × 0.4
- 前置条件：playoffSeriesGames.length >= 2 且 V11.2 大小分模块激活

**自洽性**：预期总分必须与大小分方向一致；预期比分净胜分与让分推荐方向一致。

### 篮球模型 v7.3 核心规则（v7.2基础上增量校准）

- **客队热门系统性降权**（回测：客队热门穿盘率仅42.3%，主队热门51.4%）：独立预期净胜分向主队方向调整1.5分；中盘3.5-6分额外+0.8分，深盘10.5-15分额外+0.6分；赛季末/季后赛客队大热门再+1.0分
- **大小分按月份校准**（v7.2已有6/7/8月，v7.3加9月）：6月+4、7月+3（偏大），8月-2.5、9月-1.5（偏小），5月10月中性
- **边缘主队小热门季末降级**：主胜概率50-56%的主队在季末/季后赛反复主场输球，强制低信心
- **±2.5边缘盘单核心缺阵噪声大**：强制低信心，不强推高信心
- **小样本联赛（<30场）默认低信心**：累计≥30场样本再放开
- **FIBA女子深盘阈值上调**：穿盘阈值由|线|≥15调到≥20，穿盘强度×0.7打折

### 篮球比分入库管线（v7.3加固）
- ESPN源：终场冻结前二次校验比分合理性（两队≥20分、总分60-300、分差≤80），不通过则保持live并标记espn-pending-review
- 球美宝源：仅用于live比分跳动，其post状态不再触发终场冻结，保持live并标记qiumibao-final-pending，等待ESPN二次确认
- 终场权威唯一来源是ESPN scoreboard的status=post + 比分合理性校验通过

### 篮球模型 v7.2 核心规则

- **概率算法**：让分/大小分概率由「独立预期净胜分/总分 vs 指数线」通过正态CDF计算，shrinkage=0.85轻度收缩保留分化，不再写死为常数
- **独立预期净胜分**：从指数推导市场共识净胜分 + 情景调整（赛季阶段、伤停、战意等），独立于指数线
- **情景调整接入**（回测验证）：
  - R41 超深盘赛季阶段：WNBA 9月赛季末强队穿盘≈80%(+0.84σ)、5/7月赛季初≈32%(-0.47σ)
  - R77 WNBA大小月份：6月+4分(大)、7月+3分(大)、8月-2.5分(小)
  - R44 边缘盘核心缺阵：热门方球星缺阵→弱队侧≈69%(+0.50σ)
- **硬约束**：有指数线必给方向、主在前客在后、精选组合仅取≥58%中/高信心场、低信心不进精选组合
- **信心分级**：高(偏离50%≥15%) / 中(8%~15%) / 低(<8%)

### basketball_matches 表
- id (uuid, pk)
- match_no (varchar) - 比赛编号
- source (varchar) - 数据源（sporttery/qiumibao/espn/nbl-official）
- live_score_source (varchar) - 实时比分来源（espn/qiumibao/nbl-official/flashscore/qiumibao-final-degraded）
- league (varchar) - 联赛名（WNBA/NBA/澳NBL/欧篮联/西篮联/德篮联/日篮联等）
- home_team / away_team (varchar) - 主/客队
- kickoff_time (timestamptz) - 开赛时间
- match_date (varchar) - 比赛日期
- business_date (date) - 竞彩交易日
- home_win_prob / away_win_prob (int) - 主/客胜概率 %
- prediction_direction (varchar) - 主胜/客胜/观望
- handicap (varchar) - 让分盘口文字
- handicap_line_num (numeric) - 让分线数值
- handicap_recommendation (varchar) - 让分主胜/让分客胜
- total_line (varchar) - 大小分盘口文字
- total_line_num (numeric) - 大小分线数值
- total_direction (varchar) - 大分/小分/观望
- predicted_home_score / predicted_away_score (int) - 预期比分
- confidence (int) - 信心度 %（高≥65/中58-65/低<58）
- intel / intel_summary (text) - 情报/摘要
- injuries / team_stats / recent_form / h2h_history (jsonb) - 伤停/队数据/近况/交锋
- home_score / away_score (int) - 比分
- match_status (varchar) - upcoming/live/finished
- hit_wdw / hit_handicap / hit_overunder (boolean) - 胜负/让分/大小分命中标记
- home_win_odds / away_win_odds (numeric) - 胜负赔率
- handicap_odds_home / handicap_odds_away (numeric) - 让分赔率
- total_odds_over / total_odds_under (numeric) - 大小分赔率
- model_rules (text[]) - 触发的模型规则
- _created_at / _updated_at (timestamptz) - 审计列

### 篮球预测模型核心参数（WNBA基准）
- 主场优势：2.5 分
- 标准差：7.0 分
- 基准总分：165 分
- 信心分级：高≥65% / 中58-65% / 低<58%
- 让分/大小分概率由正态CDF计算，shrinkage=0.85

## 移动端视觉体系：v13.0 V2 竞技主题（三套可切换）

**设计定位**：从单套石墨金演进为三套竞技主题一键切换。默认「翡翠暗夜」高端深邃，备选「紫金王朝」经典荣耀 + 「烈焰赤红」热情冲击力。底部导航升级为中心凸起主按钮形态（今日 Tab 凸起），统一线性图标+弹跳动效。

**切换机制**：`data-accent-theme` 属性挂在 `:root`，值为 `emerald`（默认）/ `lakers` / `inferno`，localStorage 持久化。切换即时生效，所有 CSS 变量通过 `--accent-primary` 等语义化变量引用。

### 三套主题配色

| 语义变量 | 翡翠暗夜（默认） | 紫金王朝 | 烈焰赤红 |
|---------|---------------|---------|---------|
| `--accent-primary` | `#10B981` 翡翠绿 | `#F59E0B` 紫金 | `#EF4444` 烈焰红 |
| `--accent-primary-light` | `#34D399` | `#FBBF24` | `#F87171` |
| `--accent-primary-dark` | `#059669` | `#D97706` | `#DC2626` |
| `--accent-glow` | `rgba(16, 185, 129, 0.25)` | `rgba(245, 158, 11, 0.25)` | `rgba(239, 68, 68, 0.25)` |

### 深色基底（三套共用）
- 背景：`#0B0F15`（比 v12 更深邃，减少蓝调）
- 卡片：`#141922`（微暖灰，更柔和）
- 次级：`#1A202C`
- 主文字：`#F1F5F9`
- 次文字：`#94A3B8`
- 弱文字：`#64748B`
- 边框：`var(--accent-primary-10)` 即主色 10% 透明度

### 状态色（共用，语义不变）
- live 玫瑰红：`#F43F5E`
- 同步中琥珀：`#F59E0B`（与紫金王朝主色同色，live用live红区分）
- 终场绿：`#22C55E`

### 方向色（共用）
- 主胜红：`#F87171`
- 客胜蓝：`#60A5FA`
- 大分橙：`#FB923C`
- 小分青：`#2DD4BF`

### 底部导航 V2
- 形态：5 个 Tab，中间「今日」Tab 凸起为圆形主按钮（FAB 风格）
- 图标：统一 lucide 线性 1.8px 线宽
- 激活态：图标上移 2px + 轻微弹跳 + 底部装饰条（主色）
- 背景：`#0B0F15`/95 + backdrop-blur-xl
- 高度：64px + safe-area
- 凸起按钮：宽56px 高56px 圆形，主色渐变，图标白色

---

## 移动端视觉体系：Arena Night 竞技暗夜（v2.0 视觉重制）

**设计定位**：参考 Apple Sports + FlashScore 的深色竞技风，彻底推翻旧版浅红毛玻璃方案。以暗夜球场为灵感，电光蓝为主品牌色，卡片用微凸层级感，整体轻盈、专业、有速度感。

**适用范围**：移动端 5 个 Tab 页（今日/赛程/统计/数据/我的）及详情页全部采用此视觉语言。桌面端保留原有深红星云体系不变。

### 色彩系统
- **主背景**：`#0A0E1A`（暗夜蓝黑，非纯黑，带蓝调）
- **卡片背景**：`#121829`（深靛蓝灰，微凸于背景）
- **卡片次级**：`#1A2238`（更亮一级，用于卡片内嵌区块）
- **主色/品牌色**：`#3B82F6`（电光蓝，替代旧版深红）
- **主色亮**：`#60A5FA`（hover/渐变终点）
- **主文字**：`#F1F5F9`（接近白的冷灰）
- **次文字**：`#94A3B8`（蓝灰）
- **弱文字**：`#64748B`
- **边框/分割**：`rgba(59, 130, 246, 0.12)`（微蓝色边框，不使用纯灰）
- **成功/命中**：`#22C55E`（鲜绿）
- **失败/未中**：`#EF4444`（亮红）
- **live 红**：`#F43F5E`（玫瑰红，带脉冲）
- **同步中橙**：`#F59E0B`（琥珀色）
- **主队标红**：`#F87171`
- **客队标蓝**：`#60A5FA`

### 字体与排版
- 字体沿用 Inter 体系
- 大数字（比分/命中率）：`font-black` + `tabular-nums` + 字距收紧
- 联赛标签：`text-[11px] font-semibold uppercase tracking-wider`
- 预测数值：`font-bold tabular-nums`

### 卡片体系
- **比赛卡**：`bg-[#121829] rounded-2xl border border-[rgba(59,130,246,0.12)]`，无阴影（深色模式靠边框分层）
- **live 卡**：左侧 `border-l-[3px] border-rose-500` + 红点脉冲动画
- **同步中卡**：左侧 `border-l-[3px] border-amber-500`
- **终场卡**：左侧 `border-l-[3px] border-green-500/50`
- **内嵌模块**：`bg-[#1A2238] rounded-xl`
- **底部 Tab**：`bg-[#0A0E1A]/95 backdrop-blur-xl border-t border-[rgba(59,130,246,0.15)]`
- **Tab 激活**：图标+文字均为电光蓝 `#3B82F6`，底部无横线（用小圆点或图标变色）

### 间距与布局
- 页面水平边距：`px-4`（16px）
- 卡片间距：`gap-3`（12px）
- 卡片内边距：`p-4`（16px）
- 底部 Tab 高度：60px + safe-area
- 内容区底部预留：`calc(60px + env(safe-area-inset-bottom) + 12px)`

### 动效
- 按压反馈：`active:scale-[0.97] transition-transform duration-150`
- live 脉冲：`animate-pulse` 红点
- 页面切换：不做（由路由管理）

### 硬规则
- 移动端全局背景为 `#0A0E1A`，严禁出现纯白或浅灰背景
- 主品牌色是电光蓝 `#3B82F6`，深红 `#8B0000` 仅在桌面端使用，移动端一律不用
- 卡片靠边框+层级区分，不靠阴影（深色模式阴影不可见）
- 所有触控目标 ≥ 44px
- 数字一律 tabular-nums 防跳动

---

## 设计规范（深红星云 nebula-crimson）

### 视觉定位
高端商务年报美学：权威、庄重、高端科技感。深红 #8B0000 极度克制地用作点睛色，大面积由白/浅灰#FAFAFA/近纯黑#1A0000–#050505承载，靠全幅区块明暗交替营造呼吸节奏。

### 色彩系统
- 主背景：`#FAFAFA`（浅色段落基底）
- 卡片/表面：`#FFFFFF`
- 主色/点睛：`#8B0000`（nebula-crimson，仅品牌区块、强调数值、进度条、装饰线、hover）
- 主文字：`#111827`
- 弱文字：`#9CA3AF`
- 边框：`#F3F4F6`
- 暗区背景：Hero `#1A0000`、Outlook `#030712`、Footer `#050505`
- 增长/正向：绿 `#16A34A` 文字 / `#DCFCE7` 底
- 图表序列色：seq1 `#8B0000` → seq2 `#A52A2A` → seq3 `#CD5C5C` → seq4 `#E9967A` → seq5 `#FFA07A`（深红→鲑橙5段固定序列，不引入其他色相）

### 排版
- 字体：'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif
- 字体加载：`@import url('https://miaoda.feishu.cn/fonts/css2?family=Inter:wght@300;400;500;600;700;900&display=swap')`
- 标题始终 `font-black`(900) + `tracking-tight` / `tracking-tighter`
- 英文辅助标签始终 `uppercase tracking-widest text-[10px]`
- 字号层级：H1 Hero `text-6xl md:text-9xl`、H2 章节 `text-5xl`、H3 卡片 `text-2xl`、正文 `text-lg leading-relaxed`

### 布局
- 容器：`max-w-7xl mx-auto`
- 水平内边距：`px-8 md:px-24`（移动 2rem / 桌面 6rem）
- 区块垂直内边距：`py-32`（8rem）
- 网格间距：`gap-6`（1.5rem）
- 页面节奏：全幅明暗交替（白→深红→浅灰→近黑）

### 组件规范
- **指标卡**：`metric-card` — 浅色圆角卡，hover 品牌色投影加深、底部进度线展开、图标翻色，`duration-500`
- **玻璃卡**：`glass-card` — 暗区透明白容器 + `backdrop-blur-md`，hover 提亮
- **产品卡**：`product-card` — hover 上浮 `-translate-y-4` + 底边线变品牌色
- **进度条**：`progress-gradient` — `from-red-900 → nebula-crimson` 渐变，`duration-[1.5s] ease-out`
- **左强调条**：`emphasis-bar` — `border-l-4 border-nebula-crimson`
- **eyebrow**：`eyebrow eyebrow-line` — 大写英文标签前置深红短装饰线

### 硬规则
- 深红 #8B0000 极度克制：仅品牌区块、强调数值、进度条、装饰线、hover；正文与大面积辅助面禁用
- 标题必用 font-black + tracking-tight/tighter；英文标签必用 uppercase tracking-widest
- 图表配色固定深红→鲑橙5段序列，不出现其他色相
- 圆角下限 `rounded-lg`(8px)，禁止直角卡片

## 竞彩官方口径权威规则（长期铁律）

**核心原则：竞彩官方是所有竞彩赛事数据的唯一权威口径，新比赛全部按官方入库，不得做任何翻转。**

### 1. 数据摄入全面官方化
- 主队 = 竞彩官方主队（官方列表右侧），客队 = 竞彩官方客队（官方列表左侧）
- 让分线以官方主队视角原样写入：负号=主队让分，正号=主队受让
- 胜负赔率按官方「主胜/主负」列语义写入：主胜=主队获胜赔率，主负=客队获胜赔率
- **所有联赛统一适用**：NBA/WNBA/欧篮联/西篮联/德篮联/日篮联/澳NBL 等，一律不得做主客翻转
- 禁用语：「needFlip」「主客顺序纠正」「翻转」等任何基于指数与赔率推断的自动翻转逻辑

### 2. 自动校验机制
- `upsertBasketballMatches` 官方源分支（insert+update）各加一处 `OFFICIAL_CALIBER_CHECK` 防御性校验
- 校验规则：让分线符号 与 胜负赔率强弱方向 必须一致（主队让分→主队赔率更低）
- 不一致时打 warn 日志，不阻断写入（官方数据本身是权威，日志仅作异常告警）

### 3. 第三方源边界（球美宝/ESPN/FlashScore 等）
- 仅作**增强补充**：比分、状态、开赛时间、伤停、情报、实力评分
- **严禁覆盖** sporttery 源记录的以下字段：
  - 主客队名（home_team / away_team）
  - 让分线与让分赔率（handicap / handicap_line_num / handicap_odds_*）
  - 大小分线与大小分赔率（total_line / total_line_num / total_odds_*）
  - 胜负赔率（home_win_odds / away_win_odds）
  - source 字段（保持 'sporttery'）
- ESPN reverseMatch 路径：仅当目标非 sporttery 源时才写入盘口赔率；sporttery 源记录只写比分/状态
- 球美宝 `syncBasketballScheduleOddsFromQiumibao`：`isOfficialRecord=true` 时跳过所有盘口赔率写入
- 第三方源自建记录（无 match_no 匹配）：保持源数据原始主客语义，不做翻转

### 4. 前端展示官方化
- 所有篮球页面（卡片/详情/比分/赛程）统一：**左=客队，右=主队**
- 预测方向着色：主胜红=右侧主队胜，客胜蓝=左侧客队胜
- 比分：左=客队得分，右=主队得分，与队名位置一一对应

### 5. 历史已对齐场次锁定
- 2026-10-30 周五 302-318 共 17 场 + 周六315（G7 女武神vs梦想）已按官方口径对齐
- 这些场次的 `is_official_locked=true` 时，盘口线和赔率受 `protect_official_locked_basketball` 触发器保护
- 触发器放行预测模型字段（方向/概率/规则等），只锁定盘口线与赔率

## 已知数据质量问题与修复记录

### daily_review 自动化任务缺失复盘生成逻辑

- 现象：10/25-27 三日 daily_review 表无记录，但 sync_task_logs 显示 daily_review 定时任务每天 22:00 都触发且 status=success
- 根因：`sporttery.automation.ts` 的 `dailyReview()` 方法只做了命中回填（hit-backfill）+ ESPN 摘要同步（espn-summary），**完全漏掉了 `generateDailyReview()` 复盘生成调用**。日志里 `daily_review done: hitBackfilled=672 sources=hit-backfill+espn-summary` 印证——sources 里没有 daily-review
- 触发条件：生产态 automation 路径（线上 cron 触发）。dev 模式的 `SyncSchedulerService.runDailyFullSync()` 路径是完整的，但线上不走那条
- 修复：automation 注入 `SyncSchedulerService`，在 hit-backfill + espn-summary 之后补上 `generateDailyReview('basketball', todayStr)` + `generateDailyReview('football', todayStr)` 调用，使用 Asia/Shanghai 时区计算当日日期
- 受影响范围：10/25-27 三日复盘记录缺失（已通过 SQL 补生成）；此后 daily_review 定时任务将正确生成复盘

### ESPN summary 伤停主客归属 bug

- 现象：部分比赛的 injuries JSON 中 home/away 与实际主客队相反（如周二301活塞vs凯尔特人，home下存的是凯尔特人球员）
- 根因：`espn-source.ts fetchSummary()` 中直接用 `teamInjuries[0]` 当 home、`teamInjuries[1]` 当 away，但 ESPN API 的 injuries 数组顺序不固定（有时客队在前）
- 修复：通过 `header.competitions[].competitors[].homeAway` 获取主客队名称/缩写，与 `teamInjuries[].teamName/teamAbbr` 匹配后正确归属；匹配不上时 fallback 到原索引顺序
- 受影响范围：injuries 字段主客倒置的比赛，其 V11 预测的伤停融合方向完全反转（热门方缺阵被算成冷门方缺阵）

### 球美宝篮球比分主客倒置 bug

- 现象：sporttery 源篮球比赛的 home_score/away_score 与主客队名错位（如活塞vs凯尔特人实际比分121-113，但库内显示113-121）
- 根因：`normalizeQiumibaoBasketball` 翻转了主客队名以对齐竞彩编号顺序，但 home_score/away_score 未同步翻转
- 修复：sporttery.service.ts 中 `updateBasketballScoresFromQiumibao` 主路径和 fallback 路径共约10处 homeScore/awayScore 交换，确保比分与翻转后的队名对齐
- 终场权威数据源：ESPN scoreboard（球美宝 post 状态不再触发终场冻结）

### 官方锁定触发器过度保护导致 V11.2 预测无法写入

- 现象：`is_official_locked=true` 的比赛，recalc 预测后数据库值完全不变（total_direction、total_pick_prob、model_rules 等全部停留在旧值）
- 根因：`protect_official_locked_basketball` 触发器函数引用了不存在的列 `odds_open_home` 等导致 UPDATE 报错回滚；修复列名后触发器仍将预测方向/概率/model_rules 等模型输出字段与盘口一起锁定
- 修复：重构触发器为仅保护盘口线值与赔率字段（handicap/total_line/odds_*），允许预测模型字段（total_direction、total_pick_prob、over_prob、under_prob、model_rules、prediction_direction、home_win_prob、away_win_prob、confidence、pred_engine_version 等）随模型升级正常更新
- 受影响范围：所有官方锁定的 NBA/WNBA 比赛，V11.2 大小分模型重算结果之前全部被触发器拦截

### 竞彩官方直连 WAF 拦截 + 球美宝 fallback 盘口漂移

- 现象：沙箱出口 IP 被竞彩官方 WAF 拦截（HTTP 403），sporttery 源数据走球美宝 fallback，盘口线值与官方存在 0.5-1 分偏差
- 影响：sporttery 源篮球比赛的 handicap_line_num / total_line_num 会被球美宝数据覆盖，与竞彩官方不完全一致
- 临时应对：发布前手动修正数据库中的盘口线与赔率到官方值；长期方案：优化球美宝→竞彩映射精度或接入备用官方数据源

### 篮球竞彩让分线符号翻转 bug（d9fc421 / 11777c5）

- 现象：d9fc421 在竞彩篮球让分线解析时错误地给 hdc.goalLineValue 加了负号，导致让分线方向完全翻转
- 根因：篮球 hdc.goalLineValue 本身已是主队视角（负=主队让分，正=主队受让），无需额外取反；d9fc421 误以为需要翻转而多写了一个负号
- 修复：11777c5 移除多余负号，统一走 `convertHandicapLine()` 直接返回官方值
- 历史数据影响：
  - 已完赛场次（is_official_locked=true）：受 `protect_official_locked_basketball` 触发器保护，盘口字段未被错误修改，仅被加上了误导性 `finalized_let_fix_20261022` 标记（已清除）
  - Live/upcoming 场次：d9fc421 窗口内可能写入错误值，修复后自动 sync 已纠正
- 验证：周四307 雷霆vs掘金，竞彩源 -8.5 与 ESPN 源 -8.5 完全一致（方向+数值）
- 口径约定：竞彩官方 `goalLineValue` 负=主队让分（主队强），正=主队受让（主队弱），与内部口径一致，禁止基于指数大小或 hf/af 推断翻转符号

## 发布流程（CRITICAL）

每次发布到生产环境前，**必须**先执行数据库全量备份：

1. 备份：`bash server/scripts/pre-deploy-backup.sh`
   - 导出 matches / basketball_matches / members / favorites / prediction_records / invitations 全部业务表
   - 备份位置：`/tmp/db-backups/<timestamp>/`
2. 确认备份成功（所有表均导出成功，行数符合预期）
3. 发布：`miaoda deploy --wait`
4. 发布后验证：`GET /api/version` 版本号与预期一致 + 核心接口返回正常

发布原则：只增量写入，不删除任何用户或比赛数据；upsert 操作保证幂等。
