import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useMemo } from 'react';
import type { BasketballMatchItem, BasketballRecentGame } from '@shared/api.interface';
import { isPlaceholder } from '@client/src/utils/data-quality';

interface TeamStatsTabProps {
  match: BasketballMatchItem;
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl p-6 border border-border bg-card shadow-sm text-center">
      <p className="text-sm text-gray-400">{text}</p>
    </div>
  );
}

function DataSourceLabel({ source }: { source: string }) {
  return (
    <span className="text-[10px] uppercase tracking-widest text-gray-400 ml-auto">
      数据来源：{source}
    </span>
  );
}

function getStatsDataSource(match: BasketballMatchItem): string | null {
  const src = match.source;
  if (src && typeof src === 'string' && src.trim()) {
    const upper = src.trim().toUpperCase();
    if (upper.includes('ESPN')) return 'ESPN';
    if (upper.includes('SPORTTERY')) return '竞彩官方';
    if (upper.includes('QIUMIBAO')) return '球美宝';
    return src.trim();
  }
  return null;
}

function hasMeaningfulStats(s: BasketballMatchItem['homeStats']): boolean {
  if (!s) return false;
  // 占位值过滤：winRate 0.5、pointsPerGame 80 视为占位
  const isPlaceholderScore = (v: number | undefined | null): boolean =>
    typeof v === 'number' && v === 80;
  const isPlaceholderForm = (v: number | undefined | null): boolean =>
    typeof v === 'number' && v === 0.5;
  const meaningfulVals = [s.winRate, s.pointsPerGame, s.reboundsPerGame, s.assistsPerGame, s.fieldGoalPct, s.threePointPct];
  const hasNumeric = meaningfulVals.some((v) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return false;
    if (isPlaceholderScore(v)) return false;
    if (isPlaceholderForm(v)) return false;
    return true;
  });
  const hasRecord = !!(
    (s.homeRecord && s.homeRecord.trim() && !isPlaceholder(s.homeRecord, 'stats')) ||
    (s.awayRecord && s.awayRecord.trim() && !isPlaceholder(s.awayRecord, 'stats'))
  );
  return hasNumeric || hasRecord;
}

function hasMeaningfulRadar(r: BasketballMatchItem['homeRadar']): boolean {
  if (!r) return false;
  const vals = [r.offense, r.defense, r.rebounds, r.threePoint, r.pace, r.depth, r.inside, r.form];
  // 0.5 视为 form 占位值
  return vals.some((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v !== 0.5);
}

export default function TeamStatsTab({ match }: TeamStatsTabProps) {
  const homeStats = match.homeStats;
  const awayStats = match.awayStats;
  const homeRadar = match.homeRadar;
  const awayRadar = match.awayRadar;
    const rawHomeForm = match.homeRecentForm ?? '';
    const rawAwayForm = match.awayRecentForm ?? '';
    const homeFormStr = isPlaceholder(rawHomeForm, 'form') ? '' : rawHomeForm;
    const awayFormStr = isPlaceholder(rawAwayForm, 'form') ? '' : rawAwayForm;
    const statsSource = getStatsDataSource(match);
   const hasStats = hasMeaningfulStats(homeStats) && hasMeaningfulStats(awayStats);
   const hasRadar = hasMeaningfulRadar(homeRadar) && hasMeaningfulRadar(awayRadar);
   const hasForm = homeFormStr.length > 0 || awayFormStr.length > 0;
   const allEmpty = !hasStats && !hasRadar && !hasForm;

   // 解析近期战绩：优先 recentFormDetail，其次尝试 JSON（BasketballRecentGame[]），最后按胜负字符串解析
   const parsedForm = useMemo(() => {
     const parseOne = (raw: string | null): BasketballRecentGame[] => {
       if (!raw) return [];
       const trimmed = raw.trim();
       if (!trimmed) return [];
       if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
         try {
           const parsed = JSON.parse(trimmed);
           if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
             return parsed as BasketballRecentGame[];
           }
         } catch {
           // 解析失败，回退到字符串模式
         }
       }
       return [];
     };
     const fromDetail = (arr: unknown[] | undefined): BasketballRecentGame[] => {
       if (!arr || arr.length === 0) return [];
       return arr.map((g) => {
         const game = g as { date: string; opponent: string; isHome: boolean; scoreFor: number; scoreAgainst: number; result: string };
         return {
           date: game.date,
           opponent: game.opponent,
           isHome: game.isHome,
           teamScore: game.scoreFor,
           opponentScore: game.scoreAgainst,
           result: game.result === 'win' ? 'W' : 'L',
         };
       });
     };
     const detailHome = fromDetail(match.recentFormDetail?.home);
     const detailAway = fromDetail(match.recentFormDetail?.away);
     if (detailHome.length > 0 || detailAway.length > 0) {
       return { home: detailHome, away: detailAway };
     }
     return {
       home: parseOne(match.homeRecentForm),
       away: parseOne(match.awayRecentForm),
     };
   }, [match.recentFormDetail, match.homeRecentForm, match.awayRecentForm]);

   const hasDetailedForm = parsedForm.home.length > 0 || parsedForm.away.length > 0;
   const hasTrendData = hasDetailedForm || hasForm;

  if (allEmpty) {
    return (
      <div className="rounded-xl p-6 border border-border bg-card shadow-sm text-center">
        <p className="text-sm text-muted-foreground">暂无可靠数据</p>
      </div>
    );
  }

  const normalizeStat = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace('%', ''));
    return Number.isFinite(n) ? n : null;
  };

  const statRows = hasStats
    ? [
        { label: '胜率', home: normalizeStat(homeStats.winRate), away: normalizeStat(awayStats.winRate), suffix: '%' },
        { label: '场均得分', home: normalizeStat(homeStats.pointsPerGame), away: normalizeStat(awayStats.pointsPerGame), suffix: '' },
        { label: '场均篮板', home: normalizeStat(homeStats.reboundsPerGame), away: normalizeStat(awayStats.reboundsPerGame), suffix: '' },
        { label: '场均助攻', home: normalizeStat(homeStats.assistsPerGame), away: normalizeStat(awayStats.assistsPerGame), suffix: '' },
        { label: '投篮命中率', home: normalizeStat(homeStats.fieldGoalPct), away: normalizeStat(awayStats.fieldGoalPct), suffix: '%' },
        { label: '三分命中率', home: normalizeStat(homeStats.threePointPct), away: normalizeStat(awayStats.threePointPct), suffix: '%' },
      ].filter((row) => row.home !== null || row.away !== null)
    : [];

  const radarOption: EChartsOption = hasRadar
    ? {
        tooltip: { trigger: 'item' },
        legend: {
          bottom: 0,
          textStyle: { color: 'hsl(215 10% 45%)', fontSize: 11 },
          data: [match.homeTeam, match.awayTeam],
        },
        radar: {
          indicator: [
            { name: '进攻' },
            { name: '防守' },
            { name: '篮板' },
            { name: '三分' },
            { name: '节奏' },
          ],
          center: ['50%', '45%'],
          radius: '60%',
          axisName: {
            color: 'hsl(215 10% 45%)',
            fontSize: 12,
          },
          splitLine: {
            lineStyle: { color: 'hsl(214 20% 88%)' },
          },
          splitArea: {
            show: true,
            areaStyle: {
              color: ['rgba(0,0,0,0.01)', 'rgba(0,0,0,0.03)'],
            },
          },
          axisLine: {
            lineStyle: { color: 'hsl(214 20% 88%)' },
          },
        },
        series: [
          {
            type: 'radar',
            lineStyle: { width: 2 },
            data: [
              {
                name: match.homeTeam,
                value: [
                  homeRadar.offense,
                  homeRadar.defense,
                  homeRadar.rebounds,
                  homeRadar.threePoint,
                  homeRadar.pace,
                ],
                 areaStyle: { color: 'hsl(358 78% 47% / 0.15)' },
                 itemStyle: { color: 'hsl(358 78% 47%)' },
                 lineStyle: { color: 'hsl(358 78% 47%)' },
               },
               {
                 name: match.awayTeam,
                 value: [
                   awayRadar.offense,
                   awayRadar.defense,
                   awayRadar.rebounds,
                   awayRadar.threePoint,
                   awayRadar.pace,
                 ],
                 areaStyle: { color: 'hsl(213 74% 48% / 0.15)' },
                 itemStyle: { color: 'hsl(213 74% 48%)' },
                 lineStyle: { color: 'hsl(213 74% 48%)' },
               },
            ],
          },
        ],
      }
    : {};

  const FormBadges = ({ formStr }: { formStr: string }) => (
    <div className="flex gap-1.5 flex-wrap">
      {formStr.split('').map((ch, i) => (
        <div
          key={i}
          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
            ch === '胜' || ch === 'W' ? 'text-home-win bg-home-win-bg' : 'text-away-win bg-away-win-bg'
          }`}
        >
          {ch}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
       {/* Stats Table */}
      {hasStats && (
          <div
            className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
          >
           <div className="text-sm font-semibold mb-3 text-[var(--foreground)] md:text-foreground flex items-center gap-2 w-full">
             <span className="w-1 h-4 rounded-full bg-orange-400 md:bg-basketball-orange" />
            数据对比
            {statsSource && <DataSourceLabel source={statsSource} />}
          </div>
          <div className="space-y-2">
            {statRows.map((row) => {
              const homeVal = row.home ?? 0;
              const awayVal = row.away ?? 0;
              const homeHigher = homeVal > awayVal;
              const awayHigher = awayVal > homeVal;
              const isDefense = row.label.includes('失分');
              const homeBetter = isDefense ? !homeHigher : homeHigher;
              const awayBetter = isDefense ? !awayHigher : awayHigher;

              const homeIsPlaceholder = row.home != null && (isPlaceholder(row.home, 'score') || isPlaceholder(row.home, 'form'));
              const awayIsPlaceholder = row.away != null && (isPlaceholder(row.away, 'score') || isPlaceholder(row.away, 'form'));
              return (
                 <div key={row.label} className="flex items-center gap-2">
                     <div
                       className={`w-20 text-right text-sm font-mono ${
                          homeBetter && !homeIsPlaceholder ? 'text-home-win font-semibold' : homeIsPlaceholder ? 'text-[var(--muted-foreground)] md:text-gray-400' : 'text-[var(--foreground)]/70 md:text-foreground/70'
                       }`}
                     >
                       {row.home != null && !homeIsPlaceholder ? row.home : '暂无数据'}
                       {row.home != null && !homeIsPlaceholder ? row.suffix : ''}
                     </div>
                    <div className="flex-1 text-center text-xs text-[var(--muted-foreground)] md:text-muted-foreground">
                     {row.label}
                   </div>
                     <div
                       className={`w-20 text-left text-sm font-mono ${
                          awayBetter && !awayIsPlaceholder ? 'text-away-win font-semibold' : awayIsPlaceholder ? 'text-[var(--muted-foreground)] md:text-gray-400' : 'text-[var(--foreground)]/70 md:text-foreground/70'
                       }`}
                     >
                       {row.away != null && !awayIsPlaceholder ? row.away : '暂无数据'}
                       {row.away != null && !awayIsPlaceholder ? row.suffix : ''}
                     </div>
                 </div>
               );
            })}
          </div>

          {/* Home/Away Record */}
          {(homeStats.homeRecord || awayStats.awayRecord) && (
            <>
               <div className="my-3 border-t border-[var(--border)]/60 md:border-border" />
               <div className="text-sm font-semibold mb-3 text-[var(--foreground)] md:text-foreground">主客场战绩</div>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div>
                  <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-1">{match.homeTeam} (主)</div>
                  <div className="text-lg font-bold font-mono text-home-win">
                    {homeStats.homeRecord ?? '-'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-1">{match.awayTeam} (客)</div>
                  <div className="text-lg font-bold font-mono text-away-win">
                    {awayStats.awayRecord ?? '-'}
                  </div>
                </div>
              </div>
            </>
          )}
         </div>
       )}

        {/* Radar Chart */}
       {hasRadar ? (
          <div
            className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
          >
            <div className="text-sm font-semibold mb-2 text-[var(--foreground)] md:text-foreground flex items-center gap-2 w-full">
              <span className="w-1 h-4 rounded-full bg-blue-400 md:bg-away-win" />
             能力雷达图
             {statsSource && <DataSourceLabel source={statsSource} />}
           </div>
          <div className="h-80">
            <ReactECharts
              option={radarOption}
              theme="ud"
              style={{ height: '100%', width: '100%' }}
            />
          </div>
        </div>
      ) : null}

       {/* Recent Form */}
       {hasForm ? (
          <div
            className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
          >
            <div className="text-sm font-semibold mb-3 text-[var(--foreground)] md:text-foreground flex items-center gap-2 w-full">
               <span className="w-1 h-4 rounded-full bg-red-400 md:bg-home-win" />
              近期状态
              {statsSource && <DataSourceLabel source={statsSource} />}
            </div>
           <div className="space-y-3">
             <div className="flex items-center gap-3">
               <div className="w-24 text-xs text-muted-foreground flex-shrink-0">
                 {match.homeTeam}
               </div>
                {homeFormStr.length > 0 ? (
                  <FormBadges formStr={homeFormStr} />
                ) : (
                   <span className="text-xs text-[var(--muted-foreground)] md:text-gray-400">暂无数据</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="w-24 text-xs text-[var(--muted-foreground)] md:text-muted-foreground flex-shrink-0">
                  {match.awayTeam}
                </div>
                {awayFormStr.length > 0 ? (
                  <FormBadges formStr={awayFormStr} />
                ) : (
                   <span className="text-xs text-[var(--muted-foreground)] md:text-gray-400">暂无数据</span>
                )}
             </div>
           </div>
         </div>
       ) : null}

        {/* Recent Form Trend Chart */}
         {hasTrendData && (
           <div className="rounded-xl p-6 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
              <div className="flex items-center justify-between mb-3 w-full">
                <div className="text-sm font-semibold text-[var(--foreground)] md:text-foreground flex items-center gap-2 flex-1">
                  <span className="w-1 h-4 rounded-full bg-blue-400 md:bg-nebula-crimson" />
                 近期战绩趋势
                 {statsSource && <DataSourceLabel source={statsSource} />}
               </div>
                <span className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] md:text-muted-foreground">
                 FORM TREND
               </span>
             </div>
            <RecentFormTrendChart
              homeGames={parsedForm.home}
              awayGames={parsedForm.away}
              homeFormStr={homeFormStr}
              awayFormStr={awayFormStr}
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
            />
          </div>
        )}
     </div>
   );
 }

interface TrendChartProps {
  homeGames: BasketballRecentGame[];
  awayGames: BasketballRecentGame[];
  homeFormStr: string;
  awayFormStr: string;
  homeTeam: string;
  awayTeam: string;
}

function RecentFormTrendChart({ homeGames, awayGames, homeFormStr, awayFormStr, homeTeam, awayTeam }: TrendChartProps) {
  const hasDetailed = homeGames.length > 0 || awayGames.length > 0;

  // 构建图表数据：取近 10 场，从远到近排列
  const buildFromGames = (games: BasketballRecentGame[]): { diff: number; score: number }[] => {
    const recent = games.slice(-10);
    return recent.map((g) => ({
      diff: g.teamScore - g.opponentScore,
      score: g.teamScore,
    }));
  };

  const buildFromString = (formStr: string): { diff: number; score: number }[] => {
    if (!formStr) return [];
    const chars = formStr.split('').slice(-10);
    return chars.map((ch) => {
      const isWin = ch === 'W' || ch === '胜' || ch === 'w';
      return {
        diff: isWin ? 1 : -1,
        score: 0,
      };
    });
  };

  const homeData = hasDetailed && homeGames.length > 0
    ? buildFromGames(homeGames)
    : buildFromString(homeFormStr);
  const awayData = hasDetailed && awayGames.length > 0
    ? buildFromGames(awayGames)
    : buildFromString(awayFormStr);

  const maxLen = Math.max(homeData.length, awayData.length, 1);
  const xAxisData = Array.from({ length: maxLen }, (_, i) => `第${i + 1}场`);

  const homeBars = homeData.map((d) => d.diff);
  const awayBars = awayData.map((d) => d.diff);
  const homeScores = homeData.map((d) => d.score);
  const awayScores = awayData.map((d) => d.score);

  // 胜负统计
  const homeWins = homeData.filter((d) => d.diff > 0).length;
  const homeLosses = homeData.filter((d) => d.diff < 0).length;
  const homeTotal = homeData.length || 1;
  const homeWinRate = Math.round((homeWins / homeTotal) * 100);

  const awayWins = awayData.filter((d) => d.diff > 0).length;
  const awayLosses = awayData.filter((d) => d.diff < 0).length;
  const awayTotal = awayData.length || 1;
  const awayWinRate = Math.round((awayWins / awayTotal) * 100);

  const showScoreLine = hasDetailed && (homeScores.some((s) => s > 0) || awayScores.some((s) => s > 0));

  const option: EChartsOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    legend: {
      bottom: 0,
      textStyle: { color: '#9CA3AF', fontSize: 11 },
      data: showScoreLine
        ? [`${homeTeam} 得失分差`, `${awayTeam} 得失分差`, `${homeTeam} 得分`, `${awayTeam} 得分`]
        : [`${homeTeam} 胜负`, `${awayTeam} 胜负`],
    },
    grid: {
      left: '3%',
      right: showScoreLine ? '12%' : '3%',
      top: '10%',
      bottom: '18%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: xAxisData,
      axisLabel: {
        color: '#9CA3AF',
        fontSize: 10,
      },
      axisLine: { lineStyle: { color: '#E5E7EB' } },
    },
    yAxis: showScoreLine
      ? [
          {
            type: 'value',
            name: '得失分差',
            nameTextStyle: { color: '#9CA3AF', fontSize: 10 },
            axisLabel: { color: '#9CA3AF', fontSize: 10 },
            splitLine: { lineStyle: { color: '#F3F4F6' } },
          },
          {
            type: 'value',
            name: '得分',
            nameTextStyle: { color: '#9CA3AF', fontSize: 10 },
            axisLabel: { color: '#9CA3AF', fontSize: 10 },
            splitLine: { show: false },
          },
        ]
      : [
          {
            type: 'value',
            name: '胜负',
            nameTextStyle: { color: '#9CA3AF', fontSize: 10 },
            axisLabel: {
              color: '#9CA3AF',
              fontSize: 10,
              formatter: (v: number) => (v > 0 ? '胜' : v < 0 ? '负' : ''),
            },
            splitLine: { lineStyle: { color: '#F3F4F6' } },
          },
        ],
    series: [
      {
        name: `${homeTeam} ${showScoreLine ? '得失分差' : '胜负'}`,
        type: 'bar' as const,
        data: homeBars,
        itemStyle: { color: '#8B0000' },
        barWidth: '30%',
      },
      {
        name: `${awayTeam} ${showScoreLine ? '得失分差' : '胜负'}`,
        type: 'bar' as const,
        data: awayBars,
        itemStyle: { color: '#CD5C5C' },
        barWidth: '30%',
      },
      ...(showScoreLine
        ? [
            {
              name: `${homeTeam} 得分`,
              type: 'line' as const,
              yAxisIndex: 1,
              data: homeScores,
              lineStyle: { color: '#8B0000', width: 2 },
              itemStyle: { color: '#8B0000' },
              smooth: true,
            },
            {
              name: `${awayTeam} 得分`,
              type: 'line' as const,
              yAxisIndex: 1,
              data: awayScores,
              lineStyle: { color: '#CD5C5C', width: 2 },
              itemStyle: { color: '#CD5C5C' },
              smooth: true,
            },
          ]
        : []),
    ] as EChartsOption['series'],
  };

  return (
    <div>
      <div className="h-[280px]">
        <ReactECharts
          option={option}
          style={{ height: '100%', width: '100%' }}
          notMerge
        />
      </div>
      {/* 胜负分布指标卡 */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="text-center p-3 rounded-lg bg-[var(--secondary)] md:bg-muted/50">
           <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-1">{homeTeam}</div>
          <div className="flex justify-around">
            <div>
              <div className="text-xl font-black font-mono text-home-win">{homeWins}</div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mt-0.5">胜</div>
            </div>
            <div>
              <div className="text-xl font-black font-mono text-miss-text">{homeLosses}</div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mt-0.5">负</div>
            </div>
            <div>
               <div className="text-xl font-black font-mono text-blue-400 md:text-nebula-crimson">{homeWinRate}%</div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mt-1">胜率</div>
            </div>
          </div>
        </div>
        <div className="text-center p-3 rounded-lg bg-[var(--secondary)] md:bg-muted/50">
           <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-1">{awayTeam}</div>
          <div className="flex justify-around">
            <div>
              <div className="text-xl font-black font-mono text-home-win">{awayWins}</div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mt-0.5">胜</div>
            </div>
            <div>
              <div className="text-xl font-black font-mono text-miss-text">{awayLosses}</div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mt-0.5">负</div>
            </div>
            <div>
               <div className="text-xl font-black font-mono text-blue-400 md:text-nebula-crimson">{awayWinRate}%</div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mt-1">胜率</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
