import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { BasketballMatchItem, BasketballKeyPlayer } from '@shared/api.interface';
import { formatBeijingTime } from '@client/src/utils/format-beijing-time';
import { formatHandicapDisplay } from '@client/src/utils/handicap-format';
import { formatStrengthDisplay, calcStrengthHit } from '@client/src/utils/strength-display';
import MultiSourceSection from './MultiSourceSection';
import { isPlaceholder } from '@client/src/utils/data-quality';
import { guardConsistency } from '@client/src/utils/basketball-consistency-guard';

const RULE_SHORT_NAMES: Record<string, string> = {
  R1: '基本面权重',
  R2: '主客场调整',
  R3: '战意矩阵',
  R4: '让分深度过滤',
  R5: '总分基准',
  R6: '伤停影响',
  R7: '赛程密度',
  R8: 'H2H历史交锋',
  R9: '大赛周期',
  R10: '决赛大分溢价',
  R11: '排位赛让分过滤',
  R12: '球队深度因子',
  R13: '指数锚定',
  R14: '阵容强度因子',
  R15: '出线轮换降速',
  R16: '胜分差区间分布',
  R17: 'WNBA季后赛节奏',
  R18: '核心球员使用率',
  R19: '三分命中率波动',
  R20: '罚球命中率影响',
  R21: '篮板球优势',
  R22: '失误转化率',
  R23: '概率压缩校准',
  R24: '大赛深指数过线律',
  R25: '弱队意外赛果过滤',
  R26: 'WNBA浅指数强队加成',
  R27: 'WNBA中深指数不穿',
  R28: 'WNBA超深指数不穿',
  R29: 'WNBA中指数小分',
  R30: 'WNBA深指数大分',
  R31: 'WNBA核心缺阵降分',
  R32: '赛季阶段调整',
  R33: '长间歇揭幕战',
};

function getKeyPlayersWithBadges(players: BasketballKeyPlayer[]): { name: string; statLine: string; badges: string[] }[] {
  if (!players || players.length === 0) return [];
  let maxPpg = -1;
  let maxRpg = -1;
  let maxApg = -1;
  for (const p of players) {
    if ((p.ppg ?? 0) > maxPpg) maxPpg = p.ppg ?? 0;
    if ((p.rpg ?? 0) > maxRpg) maxRpg = p.rpg ?? 0;
    if ((p.apg ?? 0) > maxApg) maxApg = p.apg ?? 0;
  }
  return players.map((p) => {
    const badges: string[] = [];
    if ((p.ppg ?? 0) > 0 && p.ppg === maxPpg) badges.push('得分王');
    if ((p.rpg ?? 0) > 0 && p.rpg === maxRpg) badges.push('篮板王');
    if ((p.apg ?? 0) > 0 && p.apg === maxApg) badges.push('助攻王');
    const parts: string[] = [];
    if (p.ppg != null && p.ppg > 0) parts.push(`${p.ppg}分`);
    if (p.rpg != null && p.rpg > 0) parts.push(`${p.rpg}板`);
    if (p.apg != null && p.apg > 0) parts.push(`${p.apg}助`);
    const statLine = parts.length > 0 ? parts.join(' ') : '—';
    return { name: p.name, statLine, badges };
  });
}

function DonutChart({ homeWinProb, awayWinProb, direction }: { homeWinProb: number; awayWinProb: number; direction: string }) {
  const total = homeWinProb + awayWinProb || 1;
  const radius = 40;
  const stroke = 10;
  const circumference = 2 * Math.PI * radius;
  const homeDash = total > 0 ? (homeWinProb / total) * circumference : 0;
  return (
    <div className="relative w-24 h-24 mx-auto">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="hsl(214 20% 88%)" strokeWidth={stroke} />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="hsl(358 78% 47%)"
          strokeWidth={stroke}
          strokeDasharray={`${homeDash} ${circumference}`}
          strokeLinecap="round"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="hsl(213 74% 48%)"
          strokeWidth={stroke}
          strokeDasharray={`${(awayWinProb / total) * circumference} ${circumference}`}
          strokeDashoffset={-homeDash}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-xs text-muted-foreground">方向</div>
        <div
          className={`text-sm font-bold ${direction.includes('主') ? 'text-home-win' : 'text-away-win'}`}
        >
          {direction}
        </div>
      </div>
    </div>
  );
}


  const getRuleShortName = (rule: string): string => {
    const code = rule.split(' ')[0];
    return RULE_SHORT_NAMES[code] || '';
  };

interface DataUpdateInfo {
  bjTime: string;
  text: string;
  source: string | null;
  useScore: boolean;
}

function getDataSourceLabel(match: BasketballMatchItem): string | null {
  const src = match.source;
  if (src && typeof src === 'string' && src.trim()) {
    const upper = src.trim().toUpperCase();
    if (upper.includes('SPORTTERY')) return '盘口：竞彩官方 / 伤停：ESPN / 预测：V11模型';
    if (upper.includes('ESPN')) return '数据：ESPN / 预测：V11模型';
    if (upper.includes('QIUMIBAO')) return '盘口：球美宝 / 预测：V11模型';
    if (upper === 'FOX') return '盘口：FOX / 预测：V11模型';
    return src.trim();
  }
  return null;
}

function DataSourceTag({ source }: { source: string }) {
  return (
    <span className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] md:text-gray-400 ml-auto">
      数据来源：{source}
    </span>
  );
}

interface OverviewTabProps {
  match: BasketballMatchItem;
  dataUpdateInfo: DataUpdateInfo | null;
  isLive: boolean;
  isFinished: boolean;
  isUpcoming: boolean;
}

export default function OverviewTab({ match, dataUpdateInfo, isLive, isFinished, isUpcoming }: OverviewTabProps) {
  // 四一致守卫：校正方向、概率、高亮侧、推荐方向不一致
  const safeMatch = guardConsistency(match);

  // 数值空值保护：概率类默认 0，比分类用于计算时默认 0
  const dedupedRules = Array.from(new Set(match.modelRules ?? []));
  const homeWinProb = safeMatch.homeWinProb ?? 0;
  const awayWinProb = safeMatch.awayWinProb ?? 0;
  const predictedHomeScore = safeMatch.predictedHomeScore ?? 0;
  const predictedAwayScore = safeMatch.predictedAwayScore ?? 0;
  const expectedTotal = typeof safeMatch.predictedTotal === 'number' && safeMatch.predictedTotal > 0
    ? safeMatch.predictedTotal
    : predictedHomeScore + predictedAwayScore;
  // 占位值检测：80 分为默认占位值
  const hasRealPredictedScore = typeof safeMatch.predictedHomeScore === 'number'
    && typeof safeMatch.predictedAwayScore === 'number'
    && safeMatch.predictedHomeScore > 0
    && safeMatch.predictedAwayScore > 0
    && !isPlaceholder(safeMatch.predictedHomeScore, 'score')
    && !isPlaceholder(safeMatch.predictedAwayScore, 'score');
  const predHtHome = match.predHtHome ?? 0;
  const predHtAway = match.predHtAway ?? 0;
  const handicapLineNum = match.handicapLineNum ?? 0;

  const leagueKey = (league: string): string => {
    const name = league || '';
    if (name.includes('WNBA') || name.includes('美国女子篮球') || name.includes('美职女篮')) return 'WNBA';
    if (name.includes('德篮') || name.includes('BBL') || name.includes('德国篮球')) return '德篮联';
    if (name.includes('澳NBL') || (name.includes('NBL') && !name.includes('CBA')) || name.includes('澳大利亚篮球')) return '澳NBL';
    if (name.includes('亚运') && name.includes('女篮')) return '亚运女篮';
    if (name.includes('亚运') && name.includes('男篮')) return '亚运男篮';
    if ((name.includes('女篮') || name.includes('男篮')) && name.includes('世界杯')) return '世界杯';
    if (name.includes('NBA') || name.includes('美职篮') || name.includes('美国男子篮球')) return 'NBA';
    if (name.includes('CBA') || name.includes('中职篮') || name.includes('中国男子篮球')) return 'CBA';
    if (name.includes('欧冠篮') || name.includes('欧洲篮球') || name.includes('欧篮联')) return '欧冠篮';
    return 'default';
  };

  const isLineValid = (league: string, type: 'spread' | 'total', value: number): boolean => {
    if (!value || Number.isNaN(value)) return false;
    const key = leagueKey(league);
    let spreadMax = 25;
    let totalMin = 130;
    let totalMax = 200;
    switch (key) {
      case 'NBA':
        spreadMax = 25; totalMin = 180; totalMax = 250; break;
      case 'WNBA':
        spreadMax = 25; totalMin = 130; totalMax = 200; break;
      case '澳NBL':
        spreadMax = 25; totalMin = 150; totalMax = 210; break;
      case '欧冠篮':
      case '德篮联':
        spreadMax = 30; totalMin = 130; totalMax = 200; break;
      case 'CBA':
        spreadMax = 30; totalMin = 150; totalMax = 220; break;
      case '亚运男篮':
        spreadMax = 30; totalMin = 130; totalMax = 200; break;
      case '亚运女篮':
        spreadMax = 50; totalMin = 120; totalMax = 190; break;
      default:
        spreadMax = 40; totalMin = 100; totalMax = 260;
    }
    if (type === 'spread') return Math.abs(value) > 0 && Math.abs(value) <= spreadMax;
    return value > totalMin && value < totalMax;
  };

  const leagueName = match.league || '';
   const hasHandicapLine = match.handicapLineNum !== null && match.handicapLineNum !== undefined && match.handicapLineNum !== 0
      && isLineValid(leagueName, 'spread', handicapLineNum);
  const handicapPickProbRaw = 0;
  const totalPickProb = safeMatch.totalPickProb ?? 0;
  const overProb = safeMatch.overProb ?? 0;
  const underProb = safeMatch.underProb ?? 0;
  const spreadProb1_5 = match.spreadProb1_5 ?? 0;
  const spreadProb6_10 = match.spreadProb6_10 ?? 0;
  const spreadProb11_15 = match.spreadProb11_15 ?? 0;
  const spreadProb16_20 = match.spreadProb16_20 ?? 0;
  const spreadProb21Plus = match.spreadProb21Plus ?? 0;

  // 字符串空值保护
  const homeTeam = match.homeTeam ?? '-';
  const awayTeam = match.awayTeam ?? '-';
  const handicapPickRaw = safeMatch.handicapPick ?? '';
  const handicapIsWait = !handicapPickRaw || handicapPickRaw.includes('观望');
  const totalDir = safeMatch.totalDirection || safeMatch.totalPick || '观望';
  const totalPick = totalDir;
  const predictionDirectionRaw = safeMatch.predictionDirection ?? '';
  const wdwIsWait = !predictionDirectionRaw || predictionDirectionRaw === '观望';
  const predictionDirection = wdwIsWait ? '观望' : predictionDirectionRaw;
  const handicapPick = handicapIsWait ? '观望' : handicapPickRaw;
  const dataUpdatedAt = match.dataUpdatedAt ?? '-';

  const bjUpdatedTime = formatBeijingTime(dataUpdatedAt);
  const totalLineNumFromMatch = match.totalLineNum ?? 0;

  const handicapDisp = formatHandicapDisplay(handicapLineNum, handicapPick, homeTeam, awayTeam);
  const dataSourceLabel = getDataSourceLabel(match);
  const handicapHomeGives = handicapDisp.homeGives;
  const pickIsHomeWin = handicapDisp.pickIsHomeWin;
  const handicapCoverProb = pickIsHomeWin ? handicapPickProbRaw : 100 - handicapPickProbRaw;
  const coverTeam = handicapDisp.coverTeam;
  const recommendedLine = handicapDisp.coverLine;
  const recIsFavorite = (pickIsHomeWin && handicapHomeGives) || (!pickIsHomeWin && !handicapHomeGives);
  const winConfidence = Math.max(homeWinProb, awayWinProb);
  const wdwLowConfidence = !wdwIsWait && winConfidence < 58;

  const strengthDisplay = formatStrengthDisplay(
    homeTeam,
    awayTeam,
    hasRealPredictedScore ? predictedHomeScore : null,
    hasRealPredictedScore ? predictedAwayScore : null,
    match.confidence ?? winConfidence,
  );
  const strengthHit = isFinished
    ? calcStrengthHit(match.homeScore, match.awayScore, predictedHomeScore, predictedAwayScore)
    : null;
  const strengthConfidence = match.confidence ?? winConfidence;
  const getConfidenceLevel = (prob: number): string => {
    if (prob >= 65) return '高';
    if (prob >= 58) return '中';
    return '低';
  };
  const strengthConfLevel = getConfidenceLevel(strengthConfidence);
  const winConfLevel = getConfidenceLevel(winConfidence);
  const handicapConfLevel = (() => {
    if (match.handicapConfidence === '高') return '高';
    if (match.handicapConfidence === '中') return '中';
    if (match.handicapConfidence === '低') return '低';
    return getConfidenceLevel(handicapCoverProb);
  })();
  const handicapPickFull = hasHandicapLine && !handicapIsWait
    ? handicapDisp.subText
    : '观望';
  const totalStdDev = 7;
  const ouConfLevel = (() => {
    if (match.ouConfidence === '高') return '高';
    if (match.ouConfidence === '中') return '中';
    if (match.ouConfidence === '低') return '低';
    const prob = safeMatch.totalPickProb ?? 0;
    if (prob >= 65 || prob <= 35) return '高';
    if (prob >= 58 || prob <= 42) return '中';
    return '低';
  })();
  const totalLineNumRaw = totalLineNumFromMatch > 0 ? totalLineNumFromMatch : (parseFloat(match.totalLine ?? '0') || 0);
  const totalLineNum = isLineValid(leagueName, 'total', totalLineNumRaw) ? totalLineNumRaw : 0;
  const isModelTotalRef = totalLineNum <= 0 && totalPick && totalPick !== '观望'
    && totalPick.includes('模型参考');
  const noOddsAtAll = isUpcoming && !hasHandicapLine && totalLineNum <= 0 && !isModelTotalRef;
  const isLowOuConfidence = ouConfLevel === '低' && totalLineNum > 0 && totalPick && totalPick !== '观望';
  const markerPos = totalLineNum > 0 ? Math.min(98, Math.max(2, (expectedTotal / (totalLineNum * 2)) * 100)) : 50;
  const spreadProbsDynamic = (() => {
    const winProb = Math.max(homeWinProb, awayWinProb);
    const predictedSpread = Math.abs(predictedHomeScore - predictedAwayScore);
    if (winProb <= 0 || predictedSpread <= 0) {
      return [spreadProb1_5, spreadProb6_10, spreadProb11_15, spreadProb16_20, spreadProb21Plus];
    }
    const league = match.league ?? '';
    const isWNBA = league.includes('WNBA');
    const sigma = isWNBA ? 13 : 14;
    const erfApprox = (x: number) => {
      const t = 1 / (1 + 0.3275911 * Math.abs(x));
      const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
      return x >= 0 ? y : -y;
    };
    const normCdf = (x: number, mu: number, s: number) => {
      const z = (x - mu) / (s * Math.SQRT2);
      return 0.5 * (1 + erfApprox(z));
    };
    const mu = predictedSpread;
    const p1 = Math.max(0, normCdf(5.5, mu, sigma) - normCdf(0.5, mu, sigma));
    const p2 = Math.max(0, normCdf(10.5, mu, sigma) - normCdf(5.5, mu, sigma));
    const p3 = Math.max(0, normCdf(15.5, mu, sigma) - normCdf(10.5, mu, sigma));
    const p4 = Math.max(0, normCdf(20.5, mu, sigma) - normCdf(15.5, mu, sigma));
    const p5 = Math.max(0, 1 - normCdf(20.5, mu, sigma));
    const raw = [p1, p2, p3, p4, p5];
    const sum = raw.reduce((a, b) => a + b, 0) || 1;
    const normalized = raw.map((p) => Math.round((p / sum) * 100));
    let diff = 100 - normalized.reduce((a, b) => a + b, 0);
    let idx = 0;
    while (diff !== 0) {
      normalized[idx] += diff > 0 ? 1 : -1;
      diff += diff > 0 ? -1 : 1;
      idx = (idx + 1) % 5;
    }
    return normalized;
  })();
  const spreadData = [
    { name: '1-5分', value: spreadProbsDynamic[0] },
    { name: '6-10分', value: spreadProbsDynamic[1] },
    { name: '11-15分', value: spreadProbsDynamic[2] },
    { name: '16-20分', value: spreadProbsDynamic[3] },
    { name: '21+分', value: spreadProbsDynamic[4] },
  ];

  const spreadChartOption: EChartsOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: '{b}: {c}%',
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '10%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: spreadData.map((d) => d.name),
      axisLabel: { color: 'hsl(212 15% 45%)', fontSize: 11 },
      axisLine: { lineStyle: { color: 'hsl(214 20% 88%)' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: 'hsl(212 15% 45%)', formatter: '{value}%' },
      splitLine: { lineStyle: { color: 'hsl(214 20% 88%)' } },
    },
    series: [
      {
        type: 'bar',
        data: spreadData.map((d, i) => ({
          value: d.value,
          itemStyle: {
            color:
              d.name === match.spreadTopRange
                ? 'hsl(28 85% 55%)'
                : i % 2 === 0
                  ? 'hsl(358 78% 47%)'
                  : 'hsl(213 74% 48%)',
            borderRadius: [4, 4, 0, 0],
          },
        })),
        barWidth: '50%',
      },
    ],
  };

  const statusColor = (dir: string) =>
    dir.includes('主') || dir.includes('home') || dir.includes('Home')
      ? 'text-home-win'
      : dir.includes('客') || dir.includes('away') || dir.includes('Away')
        ? 'text-away-win'
        : 'text-basketball-orange';

  return (
    <div className="space-y-3">
       {/* Prediction Cards - 三项方向参考 */}
       <div className="grid grid-cols-3 gap-2 md:gap-3">
         {/* 胜负预测 */}
         <div
           data-ai-section-type="card-stat"
           className="rounded-xl p-3 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
         >
           <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-2 text-center">胜负</div>
           <div className="text-center">
              {wdwIsWait ? (
                 <>
                    <div className="text-base md:text-lg font-bold mb-1 text-[var(--muted-foreground)] md:text-gray-400">
                       {isFinished ? '无模型数据' : noOddsAtAll ? '指数待开放' : '数据不足'}
                    </div>
                    <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mt-1">
                     {isFinished ? '赛前无方向' : noOddsAtAll ? '等指数线开放后自动生成' : '未出方向'}
                   </div>
                 </>
               ) : (
               <>
                  <div className={`text-base md:text-lg font-bold mb-1 ${statusColor(predictionDirection)}`}>
                    {predictionDirection}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-2">
                    <span className="text-home-win font-mono font-semibold">{homeWinProb}%</span>
                    <span className="mx-1 text-[var(--muted-foreground)]/30 md:text-muted-foreground/30">/</span>
                    <span className="text-away-win font-mono font-semibold">{awayWinProb}%</span>
                  </div>
               </>
             )}
           </div>
        </div>

         {/* 实力对比 */}
         <div
           data-ai-section-type="card-stat"
           className="rounded-xl p-3 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
         >
           <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-2 text-center">实力</div>
          {strengthDisplay.strongerSide !== 'even' || strengthDisplay.strongerTeam ? (
            <div className="text-center">
              <div
                className={`text-2xl md:text-lg font-black md:font-bold mb-1 leading-tight tabular-nums ${
                  strengthDisplay.strongerSide === 'home'
                    ? 'text-home-win'
                    : strengthDisplay.strongerSide === 'away'
                      ? 'text-away-win'
                     : 'text-[var(--muted-foreground)] md:text-muted-foreground'
                 }`}
               >
                 {strengthDisplay.spreadText}
               </div>
               <div className={`text-xs md:text-sm font-semibold mb-1 ${
                 strengthDisplay.strongerSide === 'home'
                   ? 'text-home-win/80'
                   : strengthDisplay.strongerSide === 'away'
                     ? 'text-away-win/80'
                     : 'text-[var(--muted-foreground)] md:text-muted-foreground'
               }`}>
                 {strengthDisplay.strongerSide === 'even' ? strengthDisplay.mainLabel : strengthDisplay.strongerTeam}
               </div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground">
                 {strengthDisplay.subText}
               </div>
               {hasHandicapLine && (
                 <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mt-1">
                  市场指数：{handicapHomeGives
                    ? `主队让${Math.abs(handicapLineNum).toFixed(1)}分`
                    : `主队受让${handicapLineNum.toFixed(1)}分`}
                </div>
              )}
            </div>
          ) : (
             <div className="text-center py-2">
               <div className="text-base md:text-lg font-bold mb-1 text-[var(--muted-foreground)] md:text-muted-foreground">
                 {strengthDisplay.mainLabel}
               </div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground">
                {strengthDisplay.subText}
              </div>
            </div>
          )}
        </div>

          {/* 总分参考 */}
         <div
           data-ai-section-type="card-stat"
           className="rounded-xl p-3 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
         >
            <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-2 text-center flex items-center justify-center gap-1">
              总分
              {isModelTotalRef && (
                <span
                  className="text-[9px] px-1.5 py-px rounded border border-[var(--border)] md:border-gray-300 bg-[var(--secondary)]/50 md:bg-gray-100 text-[var(--muted-foreground)] md:text-gray-500 font-normal"
                  title="竞彩未开大小分盘，此为模型预估值，仅供参考"
                >
                  模型参考
                </span>
              )}
            </div>
          {totalLineNum > 0 ? (
            <div className="text-center">
              <div
                 className={`text-base md:text-lg font-bold mb-1 ${totalPick.includes('大') ? 'text-orange-400 md:text-basketball-orange' : 'text-cyan-400 md:text-away-win'}`}
               >
                 {totalPick}
               </div>
               <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-2">
                  总分 <span className="font-mono font-semibold text-[var(--foreground)] md:text-foreground">{totalLineNum.toFixed(1)}分</span>
                </div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground">
                 大{overProb}% / 小{underProb}%
               </div>
            </div>
          ) : isModelTotalRef ? (
            <div className="text-center">
               <div className="text-base md:text-lg font-bold mb-1 text-[var(--muted-foreground)] md:text-gray-500">
                 {totalPick}
               </div>
               <div className="text-xs text-[var(--muted-foreground)] md:text-gray-500 mb-2">
                 预期 <span className="font-mono font-semibold">{expectedTotal.toFixed(1)}分</span>
               </div>
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-gray-500">
                 大{overProb}% / 小{underProb}%
               </div>
            </div>
          ) : (
             <div className="text-center py-2">
               <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground">待开售</div>
             </div>
          )}
        </div>
      </div>

      {/* 胜负详细概率 + 实力对比 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
         {/* 胜负概率详情 */}
         <div
           data-ai-section-type="card-stat"
           className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
         >
           <div className="text-sm font-semibold text-[var(--foreground)] md:text-foreground mb-3 flex items-center gap-2 w-full">
              <span className="w-1 h-4 rounded-full bg-home-win" />
             胜负概率
             {dataSourceLabel && <DataSourceTag source={dataSourceLabel} />}
           </div>
          <div className="flex items-center gap-4">
            <DonutChart
              homeWinProb={homeWinProb}
              awayWinProb={awayWinProb}
              direction={predictionDirection}
            />
            <div className="flex-1 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-away-win" />
                  客胜
                </span>
                <span className="text-away-win font-mono font-bold">{awayWinProb}%</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-home-win" />
                  主胜
                </span>
                <span className="text-home-win font-mono font-bold">{homeWinProb}%</span>
              </div>
            </div>
          </div>
        </div>

         {/* 实力对比详情 */}
         <div
           data-ai-section-type="card-stat"
           className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
         >
            <div className="text-sm font-semibold text-[var(--foreground)] md:text-foreground mb-2 flex items-center gap-2 w-full">
              <span className="w-1 h-4 rounded-full bg-nebula-crimson" />
              实力对比
              {dataSourceLabel && <DataSourceTag source={dataSourceLabel} />}
            </div>
          {strengthDisplay.strongerSide !== 'even' || strengthDisplay.strongerTeam ? (
            <>
              <div className="text-center mb-3">
                <div
                  className={`text-lg md:text-2xl font-black leading-tight ${
                    strengthDisplay.strongerSide === 'home'
                      ? 'text-home-win'
                      : strengthDisplay.strongerSide === 'away'
                        ? 'text-away-win'
                        : 'text-foreground'
                  }`}
                >
                  {strengthDisplay.mainLabel}
                </div>
                 <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mt-1">
                   {strengthDisplay.subText}
                 </div>
              </div>
              <div className="text-center mb-3">
                <span className="text-5xl md:text-3xl font-black font-mono tabular-nums text-nebula-crimson leading-none">
                  {strengthDisplay.spreadText}
                </span>
                 <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mt-1">预期净胜分</div>
              </div>
               <div className="flex items-center justify-between text-xs px-2 mb-3">
                 <span className="text-[var(--muted-foreground)] md:text-muted-foreground/70">信心等级</span>
                <span
                  className={`font-bold ${
                    strengthDisplay.quality === 'high'
                      ? 'text-home-win'
                      : strengthDisplay.quality === 'mid'
                        ? 'text-basketball-orange'
                        : 'text-draw-text'
                  }`}
                >
                  {strengthDisplay.quality === 'high' ? '高信心' : strengthDisplay.quality === 'mid' ? '中信心' : '低信心'}
                </span>
              </div>
               {hasHandicapLine && (
                 <div className="text-center text-xs text-[var(--muted-foreground)] md:text-muted-foreground pt-2 border-t border-[var(--border)]/60 md:border-border">
                  市场指数：{handicapHomeGives
                    ? `主队让 ${Math.abs(handicapLineNum).toFixed(1)} 分`
                    : `主队受让 ${handicapLineNum.toFixed(1)} 分`}
                </div>
              )}
               {isFinished && strengthHit !== null && (
                 <div className="text-center text-xs mt-2">
                   <span className="text-[var(--muted-foreground)] md:text-muted-foreground/70">实力预测：</span>
                  {strengthHit === true ? (
                    <span className="text-success font-medium">✅ 验证通过</span>
                  ) : (
                    <span className="text-destructive font-medium">❌ 未通过</span>
                  )}
                </div>
              )}
               {!isFinished && strengthDisplay.quality === 'low' && strengthDisplay.strongerSide !== 'even' && (
                 <div className="text-center text-[11px] text-amber-400/80 md:text-draw-text/80 mt-2 leading-relaxed">
                  低信心：双方实力差距较小，方向仅为模型微倾向，谨慎参考
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
               <div className="text-2xl mb-2">⏳</div>
               <div className="text-sm font-medium text-[var(--muted-foreground)] md:text-muted-foreground">
                 {strengthDisplay.mainLabel}
               </div>
               <div className="text-xs text-[var(--muted-foreground)]/70 md:text-muted-foreground/70 mt-1">
                {strengthDisplay.subText}
              </div>
            </div>
          )}
        </div>

          {/* 总分方向参考详情 */}
         <div
           data-ai-section-type="card-stat"
           className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
         >
              <div className="text-sm font-semibold text-[var(--foreground)] md:text-foreground mb-2 flex items-center gap-2 w-full">
              <span className={`w-1 h-4 rounded-full ${isModelTotalRef ? 'bg-[var(--muted-foreground)] md:bg-gray-400' : 'bg-[var(--total-over)] md:bg-basketball-orange'}`} />
               总分参考
               {isModelTotalRef && (
                <span
                  className="text-[10px] px-2 py-0.5 rounded border border-[var(--border)] md:border-gray-300 bg-[var(--secondary)]/50 md:bg-gray-100 text-[var(--muted-foreground)] md:text-gray-500 font-normal"
                  title="竞彩未开大小分盘，此为模型预估值，仅供参考"
                >
                  非官方盘口
                </span>
               )}
               {dataSourceLabel && <DataSourceTag source={dataSourceLabel} />}
            </div>
          {totalLineNum > 0 ? (
            <>
              <div className="text-center mb-3">
                <span
                 className={`text-lg font-bold ${totalPick.includes('大') ? 'text-orange-400 md:text-basketball-orange' : 'text-cyan-400 md:text-away-win'}`}
                 >
                   {totalPick}
                 </span>
                 <span className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground ml-2">总分 {totalLineNum.toFixed(1)}分</span>
              </div>
               <div className="relative h-6 rounded-full overflow-hidden bg-[var(--secondary)] md:bg-muted">
                 <div
                   className="absolute left-0 top-0 h-full"
                   style={{ width: `${overProb}%`, backgroundColor: 'hsl(28 85% 55% / 0.6)' }}
                 />
                 <div
                   className="absolute right-0 top-0 h-full"
                   style={{ width: `${underProb}%`, backgroundColor: 'hsl(213 74% 48% / 0.4)' }}
                 />
                 <div
                   className="absolute top-0 w-0.5 h-full bg-[var(--foreground)] md:bg-foreground z-10"
                   style={{ left: `${markerPos}%`, transform: 'translateX(-50%)' }}
                   title={`预期总分 ${expectedTotal.toFixed(1)}`}
                />
                 <div
                   className="absolute top-0 w-0.5 h-full bg-[var(--muted-foreground)]/50 md:bg-muted-foreground/50 z-10"
                   style={{ left: '50%', transform: 'translateX(-50%)' }}
                />
              </div>
               <div className="flex justify-between text-xs mt-2">
                 <span className="text-orange-400 md:text-basketball-orange flex items-center gap-1">
                   <span className="w-2 h-2 rounded-full bg-orange-400 md:bg-basketball-orange" />
                   大 {overProb}%
                 </span>
                 <span className="text-cyan-400 md:text-away-win flex items-center gap-1">
                   小 {underProb}%
                   <span className="w-2 h-2 rounded-full bg-cyan-400 md:bg-away-win" />
                 </span>
               </div>
               <div className="text-center text-xs text-[var(--muted-foreground)] md:text-muted-foreground mt-2 pt-2 border-t border-[var(--border)]/60 md:border-border">
                  预期总分: <span className="text-[var(--foreground)] md:text-foreground font-mono">{expectedTotal.toFixed(1)}</span>
                  {isLowOuConfidence && <span className="text-amber-400 md:text-draw-text ml-1">±{totalStdDev}</span>}
                  <span className="mx-2 text-[var(--muted-foreground)]/30 md:text-muted-foreground/30">|</span>
                    指数: <span className="font-mono">{totalLineNum.toFixed(1)}分</span>
                </div>
                {isLowOuConfidence && (
                  <div className="text-center text-[11px] text-amber-400/80 md:text-draw-text/80 mt-2 leading-relaxed">
                   低信心：预期总分与线值差距小于误差带，方向仅为模型微倾向，谨慎参考
                 </div>
               )}
            </>
          ) : isModelTotalRef ? (
            <>
              <div className="text-center mb-3">
                 <span className="text-lg font-bold text-[var(--foreground)] md:text-gray-500">
                  {totalPick}
                </span>
                 <span className="text-xs text-[var(--muted-foreground)] md:text-gray-500 ml-2">预期 {expectedTotal.toFixed(1)}分</span>
              </div>
               <div className="relative h-6 rounded-full overflow-hidden bg-[var(--secondary)] md:bg-gray-100">
                <div
                  className="absolute left-0 top-0 h-full"
                  style={{ width: `${overProb}%`, backgroundColor: 'hsl(28 85% 55% / 0.3)' }}
                />
                <div
                  className="absolute right-0 top-0 h-full"
                  style={{ width: `${underProb}%`, backgroundColor: 'hsl(213 74% 48% / 0.2)' }}
                />
                <div
                   className="absolute top-0 w-0.5 h-full bg-[var(--muted-foreground)] md:bg-gray-400 z-10"
                  style={{ left: '50%', transform: 'translateX(-50%)' }}
                  title={`预期总分 ${expectedTotal.toFixed(1)}（模型预估，无官方盘口对照）`}
                />
              </div>
               <div className="flex justify-between text-xs mt-2">
                 <span className="text-[var(--muted-foreground)] md:text-gray-500 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[var(--muted-foreground)] md:bg-gray-400" />
                   大 {overProb}%
                 </span>
                 <span className="text-[var(--muted-foreground)] md:text-gray-500 flex items-center gap-1">
                   小 {underProb}%
                    <span className="w-2 h-2 rounded-full bg-[var(--muted-foreground)] md:bg-gray-400" />
                 </span>
               </div>
               <div className="text-center text-xs text-[var(--muted-foreground)] md:text-gray-500 mt-2 pt-2 border-t border-[var(--border)]/60 md:border-gray-100">
                 预期总分: <span className="font-mono">{expectedTotal.toFixed(1)}</span>
                  <span className="mx-2 text-[var(--muted-foreground)]/50 md:text-gray-400/50">|</span>
                   指数: <span className="font-mono">未开售</span>
               </div>
               <div className="text-center text-[11px] text-[var(--muted-foreground)] md:text-gray-500 mt-2 leading-relaxed">
                 模型参考：竞彩未开大小分盘，此为模型预估值，仅供参考
              </div>
            </>
          ) : (
             <div className="flex flex-col items-center justify-center py-12 text-center">
               <div className="text-2xl mb-2">⏳</div>
                <div className="text-sm font-medium text-[var(--muted-foreground)] md:text-muted-foreground">指数待开售</div>
                 <div className="text-xs text-[var(--muted-foreground)]/70 md:text-muted-foreground/70 mt-1">赛前 24 小时内更新总分参考</div>
            </div>
          )}
        </div>

         {/* 胜分差分布 */}
         <div
           data-ai-section-type="card-stat"
           className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
         >
            <div className="text-sm font-semibold text-[var(--foreground)] md:text-foreground mb-2 flex items-center gap-2 w-full">
              <span className="w-1 h-4 rounded-full bg-away-win" />
             胜分差分布
             {dataSourceLabel && <DataSourceTag source={dataSourceLabel} />}
           </div>
          <div className="h-48">
            <ReactECharts
              option={spreadChartOption}
              theme="ud"
              style={{ height: '100%', width: '100%' }}
            />
          </div>
        </div>
      </div>

       {/* Predicted Score */}
        <div
          className="rounded-xl p-5 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
        >
          <div className="text-sm text-[var(--muted-foreground)] md:text-muted-foreground text-center mb-3 flex items-center justify-center gap-2">
           模型比分参考
         </div>
         {hasRealPredictedScore ? (
         <div className="flex items-center justify-center gap-6 md:gap-10">
           <div className="text-center">
              <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-1">客队</div>
              <div className="text-sm font-semibold text-[var(--foreground)] md:text-foreground mb-1">{awayTeam}</div>
              <div className="text-3xl md:text-5xl font-bold font-mono text-away-win">
                {safeMatch.predictedAwayScore}
              </div>
           </div>
           <div className="text-muted-foreground/30 text-2xl font-bold">:</div>
           <div className="text-center">
              <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mb-1">主队</div>
              <div className="text-sm font-semibold text-[var(--foreground)] md:text-foreground mb-1">{homeTeam}</div>
              <div className="text-3xl md:text-5xl font-bold font-mono text-home-win">
                {safeMatch.predictedHomeScore}
              </div>
           </div>
         </div>
         ) : (
            <div className="text-center py-6">
              <div className="text-sm text-[var(--muted-foreground)] md:text-gray-400">暂无数据</div>
              <div className="text-[10px] text-slate-500/70 md:text-gray-400/70 mt-1">模型比分收集中</div>
           </div>
         )}
         {predHtHome + predHtAway > 0 && hasRealPredictedScore && (
           <div className="mt-4 pt-3 border-t border-[var(--border)]/60 md:border-border text-center">
              <span className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground">半场参考：</span>
             <span className="text-sm font-mono text-[var(--foreground)] md:text-foreground ml-1">
              {predHtAway} - {predHtHome}
            </span>
          </div>
        )}
      </div>

        {/* Confidence - 胜负 + 实力 */}
         <div className="grid grid-cols-2 gap-3">
           <div
             className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
           >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[var(--muted-foreground)] md:text-muted-foreground">胜负信心</span>
              {wdwIsWait ? (
                 <span className="text-xs font-bold text-[var(--muted-foreground)] md:text-gray-400">{noOddsAtAll ? '指数待开放' : '数据不足'}</span>
               ) : (
                <span className={`text-xs font-bold ${winConfidence >= 65 ? 'text-home-win' : winConfidence >= 58 ? 'text-basketball-orange' : 'text-draw-text'}`}>
                  {winConfLevel}
                </span>
              )}
           </div>
             <div className={`text-xl font-bold font-mono mb-2 ${wdwIsWait ? 'text-[var(--muted-foreground)] md:text-gray-400' : 'text-[var(--foreground)] md:text-foreground'}`}>
               {wdwIsWait ? '—' : `${Math.round(winConfidence)}%`}
             </div>
            <div className="h-2 rounded-full overflow-hidden bg-blue-500/10 md:bg-muted">
              {!wdwIsWait && (
               <div
                 className="h-full rounded-full transition-all"
                 style={{
                   width: `${winConfidence}%`,
                   background: winConfidence >= 65
                     ? 'hsl(358 78% 47%)'
                     : winConfidence >= 58
                       ? 'hsl(28 85% 55%)'
                       : 'hsl(214 10% 55%)',
                 }}
               />
             )}
           </div>
         </div>
           <div
             className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
           >
             <div className="flex items-center justify-between mb-2">
               <span className="text-xs font-medium text-[var(--muted-foreground)] md:text-muted-foreground">实力信心</span>
              {strengthDisplay.strongerSide === 'even' && !strengthDisplay.strongerTeam ? (
                 <span className="text-xs font-bold text-[var(--muted-foreground)] md:text-gray-400">数据不足</span>
              ) : (
                <span className={`text-xs font-bold ${
                  strengthConfidence >= 65 ? 'text-home-win' : strengthConfidence >= 58 ? 'text-basketball-orange' : 'text-draw-text'
                }`}>
                  {strengthConfLevel}信心
                </span>
              )}
            </div>
              <div className={`text-xl font-bold font-mono mb-2 ${
                strengthDisplay.strongerSide === 'even' && !strengthDisplay.strongerTeam ? 'text-[var(--muted-foreground)] md:text-gray-400' : 'text-[var(--foreground)] md:text-foreground'
              }`}>
                {strengthDisplay.strongerSide === 'even' && !strengthDisplay.strongerTeam ? '—' : `${Math.round(strengthConfidence)}%`}
              </div>
             <div className="h-2 rounded-full overflow-hidden bg-blue-500/10 md:bg-muted">
              {strengthDisplay.strongerSide !== 'even' || strengthDisplay.strongerTeam ? (
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${strengthConfidence}%`,
                    background: strengthConfidence >= 65
                      ? 'hsl(358 78% 47%)'
                      : strengthConfidence >= 58
                        ? 'hsl(28 85% 55%)'
                        : 'hsl(214 10% 55%)',
                  }}
                />
              ) : null}
            </div>
          </div>
      </div>

      {/* Key Players */}
       {match.homeKeyPlayers && match.homeKeyPlayers.length > 0 && (
         <div
           className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
         >
            <div className="text-sm font-semibold mb-3 text-[var(--foreground)] md:text-foreground flex items-center gap-2 w-full">
              <span className="w-1 h-4 rounded-full bg-orange-400 md:bg-basketball-orange" />
             关键球员
             {dataSourceLabel && <DataSourceTag source={dataSourceLabel} />}
           </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-away-win font-semibold mb-2 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-away-win" />
                {awayTeam}
              </div>
              <ul className="space-y-2">
                {getKeyPlayersWithBadges(match.awayKeyPlayers || []).map((p, i) => (
                    <li key={i} className="text-sm text-[var(--foreground)] md:text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{p.name}</span>
                      {p.badges.map((b, j) => (
                         <span
                           key={j}
                           className="text-[9px] px-1 py-0.5 rounded bg-orange-400/15 text-orange-400 md:bg-basketball-orange/15 md:text-basketball-orange font-medium"
                         >
                           {b}
                         </span>
                      ))}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mt-0.5">
                      {p.statLine}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs text-home-win font-semibold mb-2 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-home-win" />
                {homeTeam}
              </div>
              <ul className="space-y-2">
                {getKeyPlayersWithBadges(match.homeKeyPlayers).map((p, i) => (
                    <li key={i} className="text-sm text-[var(--foreground)] md:text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{p.name}</span>
                      {p.badges.map((b, j) => (
                         <span
                           key={j}
                           className="text-[9px] px-1 py-0.5 rounded bg-orange-400/15 text-orange-400 md:bg-basketball-orange/15 md:text-basketball-orange font-medium"
                         >
                           {b}
                         </span>
                      ))}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground mt-0.5">
                      {p.statLine}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Model Rules */}
       {match.modelRules && match.modelRules.length > 0 ? (
         <div
           className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
         >
           <div className="text-sm font-semibold mb-3 text-[var(--foreground)] md:text-foreground flex items-center gap-2">
             <span className="w-1 h-4 rounded-full bg-blue-400 md:bg-primary" />
             触发的模型规则
           </div>
            <ul className="space-y-2">
              {dedupedRules.map((rule: string, i: number) => {
                const shortName = getRuleShortName(rule);
                return (
                  <li key={i} className="flex items-start gap-2 text-sm text-[var(--foreground)]/80 md:text-foreground/80">
                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-blue-400 md:bg-primary" />
                    <span className="font-mono text-xs text-blue-400/80 md:text-primary/80 flex-shrink-0">{rule}</span>
                    {shortName && <span className="text-[var(--foreground)]/80 md:text-foreground/80">· {shortName}</span>}
                 </li>
               );
             })}
           </ul>
        </div>
      ) : (
         <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
           <div className="text-sm font-semibold mb-2 text-[var(--foreground)] md:text-foreground">触发的模型规则</div>
           <div className="text-sm text-[var(--muted-foreground)] md:text-muted-foreground text-center py-2">暂无规则数据</div>
        </div>
      )}

       {/* 多源数据对照 */}
       <MultiSourceSection matchId={match.id} />

       {/* 数据更新时间（按状态显示） */}
       <div className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground/70 text-center pt-2 border-t border-[var(--border)]/60 md:border-border/50">
        {isFinished && dataUpdateInfo?.useScore && (
          <span>完赛时间 · {dataUpdateInfo.bjTime}</span>
        )}
        {isLive && dataUpdateInfo?.useScore && (
          <span>
            比分更新 · {dataUpdateInfo.text}前
            {dataUpdateInfo.source && <span className="ml-1">· 来源{dataUpdateInfo.source}</span>}
          </span>
        )}
        {isUpcoming && dataUpdateInfo && !dataUpdateInfo.useScore && (
          <span>数据更新 · {dataUpdateInfo.text}前</span>
        )}
      </div>
      {/* 预测生成时间（模型数据生成时间，固定不变） */}
      {bjUpdatedTime && (
         <div className="text-[10px] text-[var(--muted-foreground)]/50 md:text-muted-foreground/50 text-center pt-1">
            模型生成时间：{bjUpdatedTime}
        </div>
      )}
    </div>
  );
}
