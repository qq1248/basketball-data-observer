export interface StrengthDisplay {
  strongerTeam: string;
  weakerTeam: string;
  strongerSide: 'home' | 'away' | 'even';
  expectedSpread: number;
  spreadText: string;
  mainLabel: string;
  subText: string;
  quality: 'high' | 'mid' | 'low';
}

export function formatStrengthDisplay(
  homeTeam: string,
  awayTeam: string,
  predictedHomeScore: number | null | undefined,
  predictedAwayScore: number | null | undefined,
  confidence?: number | null,
): StrengthDisplay {
  const homeScore = predictedHomeScore ?? 0;
  const awayScore = predictedAwayScore ?? 0;
  const hasRealScore = homeScore > 0 && awayScore > 0;

  if (!hasRealScore) {
    return {
      strongerTeam: '',
      weakerTeam: '',
      strongerSide: 'even',
      expectedSpread: 0,
      spreadText: '—',
      mainLabel: '数据收集中',
      subText: '实力对比待生成',
      quality: 'low',
    };
  }

  const spread = homeScore - awayScore;
  const absSpread = Math.abs(spread);
  const roundedSpread = Math.round(absSpread * 2) / 2;

  const isHomeStronger = spread > 0.5;
  const isAwayStronger = spread < -0.5;
  const isEven = !isHomeStronger && !isAwayStronger;

  let strongerSide: 'home' | 'away' | 'even' = 'even';
  let strongerTeam = '';
  let weakerTeam = '';
  let spreadText = '';
  let mainLabel = '';
  let subText = '';

  if (isEven) {
    strongerSide = 'even';
    strongerTeam = '';
    weakerTeam = '';
    spreadText = '≈ 0';
    mainLabel = '势均力敌';
    subText = '双方实力接近';
  } else if (isHomeStronger) {
    strongerSide = 'home';
    strongerTeam = homeTeam;
    weakerTeam = awayTeam;
    spreadText = `+${roundedSpread.toFixed(1)}`;
    mainLabel = `${homeTeam} 更强`;
    subText = `预期净胜 ${roundedSpread.toFixed(1)} 分`;
  } else {
    strongerSide = 'away';
    strongerTeam = awayTeam;
    weakerTeam = homeTeam;
    spreadText = `-${roundedSpread.toFixed(1)}`;
    mainLabel = `${awayTeam} 更强`;
    subText = `预期净胜 ${roundedSpread.toFixed(1)} 分`;
  }

  const conf = confidence ?? 0;
  let quality: 'high' | 'mid' | 'low' = 'low';
  if (conf >= 65) quality = 'high';
  else if (conf >= 58) quality = 'mid';

  return {
    strongerTeam,
    weakerTeam,
    strongerSide,
    expectedSpread: roundedSpread,
    spreadText,
    mainLabel,
    subText,
    quality,
  };
}

export function calcStrengthHit(
  homeScore: number | null | undefined,
  awayScore: number | null | undefined,
  predictedHomeScore: number | null | undefined,
  predictedAwayScore: number | null | undefined,
): boolean | null {
  if (
    homeScore === null || homeScore === undefined ||
    awayScore === null || awayScore === undefined ||
    predictedHomeScore === null || predictedHomeScore === undefined ||
    predictedAwayScore === null || predictedAwayScore === undefined
  ) return null;

  const actualSpread = homeScore - awayScore;
  const predictedSpread = predictedHomeScore - predictedAwayScore;

  if (Math.abs(predictedSpread) < 0.5) return actualSpread === 0 ? true : false;

  return (actualSpread > 0 && predictedSpread > 0) || (actualSpread < 0 && predictedSpread < 0);
}
