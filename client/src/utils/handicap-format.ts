export interface HandicapDisplay {
  homeLine: number;
  awayLine: number;
  homeGives: boolean;
  homeFavored: boolean;
  pickIsHomeWin: boolean;
  coverTeam: string;
  coverLine: number;
  coverLineText: string;
  subText: string;
  mainLabel: string;
  explainerText: string;
  homeLineText: string;
}

export function normalizeHandicapPick(pick: string): string {
  if (!pick) return pick;
  if (pick === '让分主负') return '让分客胜';
  return pick;
}

export function formatHandicapDisplay(
  handicapLineNum: number | null | undefined,
  handicapPick: string | null | undefined,
  homeTeam: string,
  awayTeam: string,
): HandicapDisplay {
  const line = handicapLineNum ?? 0;
  const hasLine = handicapLineNum !== null && handicapLineNum !== undefined && line !== 0;
  const pick = normalizeHandicapPick(handicapPick ?? '');
   const pickIsWait = !pick || pick.includes('观望');
   const pickIsHomeWin = pick.includes('主胜');
   const pickIsAwayWin = pick.includes('客胜');
   const pickIsDraw = pick.includes('平') && !pickIsHomeWin && !pickIsAwayWin;

  // 主队视角的让分数值：负=主队让分，正=主队受让
  const homeLine = line;
  const awayLine = -line;
  const homeGives = line < 0;
  const homeFavored = line < 0;

  // 主队视角让分线文本
  const homeLineText = homeLine > 0 ? `+${homeLine.toFixed(1)}` : homeLine.toFixed(1);
  // 为了兼容：coverTeam/coverLine/coverLineText 保持原语义（推荐方视角）
  const coverTeam = pickIsHomeWin ? homeTeam : awayTeam;
  const coverLine = pickIsHomeWin ? homeLine : awayLine;
  const coverLineText = coverLine > 0 ? `+${coverLine.toFixed(1)}` : coverLine.toFixed(1);

  let subText = '推荐待定';
  let mainLabel = '让分 · 观望';
  let explainerText = '';

  if (!hasLine) {
    subText = '待开售';
    mainLabel = '让分 · 待开售';
  } else if (pickIsWait) {
    subText = `${homeTeam} ${homeLineText}`;
    mainLabel = '让分 · 观望';
   } else if (pickIsDraw) {
     mainLabel = '让分 · 让平';
     subText = `${homeTeam} ${homeLineText} · 让分平`;
     explainerText = homeGives
       ? `主队让${Math.abs(line).toFixed(1)}分后双方打平指数（走盘场景）`
       : `主队受让${line.toFixed(1)}分后双方打平指数（走盘场景）`;
   } else {
     const pickLabel = pickIsHomeWin ? '让分主胜' : '让分客胜';
    mainLabel = `让分 · ${pickLabel}`;
    // 副标题：主队名 + 主队让分线 + 结论（主队视角）
    subText = `${homeTeam} ${homeLineText} · ${pickLabel}`;
    // 释义小字
    if (pickIsHomeWin) {
      explainerText = homeGives
        ? `主队让${Math.abs(line).toFixed(1)}分后仍赢指数（净胜${Math.abs(line).toFixed(1)}分以上）`
        : `主队受让${line.toFixed(1)}分后赢指数（不输或输不超过${line - 0.5 < 0 ? Math.abs(line) : line}分）`;
    } else {
      explainerText = homeGives
        ? `主队让${Math.abs(line).toFixed(1)}分后输指数（押客队/受让方赢盘）`
        : `主队受让${line.toFixed(1)}分后输指数（输${line}分以上）`;
    }
  }

  return {
    homeLine,
    awayLine,
    homeGives,
    homeFavored,
    pickIsHomeWin,
    coverTeam,
    coverLine,
    coverLineText,
    subText,
    mainLabel,
    explainerText,
    homeLineText,
  };
}

export function calcHandicapHit(
  homeScore: number | null | undefined,
  awayScore: number | null | undefined,
  handicapLineNum: number | null | undefined,
  handicapPick: string | null | undefined,
): boolean | null {
  const normalizedPick = normalizeHandicapPick(handicapPick ?? '');
  if (
    homeScore == null ||
    awayScore == null ||
    handicapLineNum == null ||
    handicapLineNum === 0 ||
    !normalizedPick ||
    normalizedPick.includes('观望')
  ) {
    return null;
  }
   const cover = (homeScore - awayScore) + handicapLineNum;
   const pickIsDraw = normalizedPick.includes('平')
     && !normalizedPick.includes('主胜')
     && !normalizedPick.includes('客胜')
     && !normalizedPick.includes('让胜')
     && !normalizedPick.includes('让负');
    if (cover === 0) {
      if (pickIsDraw) return true;
      return false;
    }
    const pickIsHomeWin = normalizedPick.includes('主胜') || normalizedPick.includes('让胜');
    const pickIsAwayWin = normalizedPick.includes('客胜') || normalizedPick.includes('让负');
  if (cover > 0) return pickIsHomeWin;
  return pickIsAwayWin;
}

export function calcOverUnderHit(
  homeScore: number | null | undefined,
  awayScore: number | null | undefined,
  totalLineNum: number | null | undefined,
  totalPick: string | null | undefined,
): boolean | null {
  if (
    homeScore == null ||
    awayScore == null ||
    totalLineNum == null ||
    totalLineNum <= 0 ||
    !totalPick ||
    totalPick.includes('观望')
  ) {
    return null;
  }
  const total = homeScore + awayScore;
  if (total === totalLineNum) return null;
  const predOver = totalPick.includes('大');
  const actualOver = total > totalLineNum;
  return predOver === actualOver;
}

export function formatHandicapLineText(
  line: number | null | undefined,
  side: 'home' | 'away',
): string {
  if (line == null || line === 0) return '';
  const value = side === 'home' ? line : -line;
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}
