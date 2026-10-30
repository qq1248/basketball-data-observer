# 篮球数据观察 (Basketball Data Observer)

面向篮球数据爱好者的赛事数据观察与分析工具：全球篮球赛事数据聚合、模型输出参考、历史数据统计、球队情报整理、伤停追踪。

> **数据仅供参考，不构成任何投注建议。**

## 技术架构

- **前端**：React 19 + TypeScript + Tailwind CSS + shadcn/ui
- **后端**：NestJS 10 + Drizzle ORM + PostgreSQL
- **用户系统**：平台内置登录，基于 `req.userContext`

## 数据源与权威口径

数据源为多源交叉核验：**竞彩官方（sporttery）为唯一权威口径** + ESPN / 球美宝等第三方源仅作增强补充（比分、状态、伤停、情报、实力评分）。

**竞彩官方口径权威规则（长期铁律）：**

- 主队 = 竞彩官方主队（官方列表右侧），客队 = 竞彩官方客队（官方列表左侧）
- 让分线以官方主队视角原样写入：负号 = 主队让分，正号 = 主队受让
- 胜负赔率按官方「主胜/主负」列语义写入：主胜 = 主队获胜赔率，主负 = 客队获胜赔率
- **所有联赛统一适用**：NBA / WNBA / 欧篮联 / 西篮联 / 德篮联 / 日篮联 / 澳NBL 等，一律不得做主客翻转
- 官方源入库时执行 `OFFICIAL_CALIBER_CHECK` 防御性校验（让分线符号与胜负赔率强弱方向一致）
- 第三方源严禁覆盖 sporttery 源记录的主客队名、让分线/赔率、大小分线/赔率、胜负赔率与 source 字段

## 预测引擎

- **V11 统一引擎**：upcoming / live / finished 全部场次统一走同一套引擎，融合 Elo 评分、近期战绩、H2H 交锋、伤停等特征
- **数据不足降级**：不满足特征条件的场次保持 data-driven-v10.1，不强行升级
- **赛季基线表**：StatMuse 2024-25 赛季 NBA 常规赛 30 队完整 82 场数据，赛季初样本不足时补充预测引擎
- 大小分概率 clamp [40%, 60%] 防极端化

## 模块划分

### 后端模块
`basketball`（比赛管理/列表/详情/预测模型）、`sync`（数据同步 ingest：球美宝/ESPN/竞彩官方）、`teams`（球队档案）、`injuries`（伤停情报）、`statistics`（数据统计）、`model-rules`（模型规则）、`admin`（后台管理）

### 前端页面（已实现）
`/` 今日赛事（足球+篮球）、`/match/:id` 足球详情、`/basketball` 篮球今日赛事、`/basketball/detail/:id` 篮球详情、`/basketball/stats` 数据统计、`/basketball/backtest` 回测中心、`/stats`、`/stats/football`、`/performance`、`/performance/football`、`/beidan` 北单、`/teams` 球队档案、`/rules` 模型规则、`/profile`、`/admin`、`/help`、`/support`、`/about`、`/brand`

## 快速开始

```bash
npm install
npm run dev        # 开发（server + client）
npm run build      # 构建
npm run start      # 生产运行
```

## 数据文件说明

- `basketball_matches.sql` / `matches.sql`：数据库表结构
- `basketball_matches.json` / `matches.json`：赛事种子数据
- 平台内部文件（`.spark/`、`.agent-memory/`、`.githooks/`）与隐私数据（members/favorites/invitations/prediction_records）不入库

## License

Private / 保留所有权利。
