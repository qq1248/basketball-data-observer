export interface HandicapGateInput {
  handicapLine: string;
  handicapRecommendation: string;
  predictionDirection: string;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  confidence: number;
  mostLikelyScore: string;
  handicapWinProb: number;
  handicapDrawProb: number;
  handicapLoseProb: number;
  league: string;
  existingModelRules: string[];
}

export interface HandicapGateOutput {
  recommendation: string;
  triggeredRules: string[];
}

function parseHandicapLine(line: string): number {
  const clean = line.replace(/\.0$/, '');
  if (clean.startsWith('+')) return parseFloat(clean.slice(1));
  if (clean.startsWith('-')) return -parseFloat(clean.slice(1));
  return parseFloat(clean);
}

function parseScore(score: string): { home: number; away: number } {
  if (!score || !score.includes('-')) return { home: 0, away: 0 };
  const parts = score.split('-');
  const h = parseInt(parts[0], 10);
  const a = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(a)) return { home: 0, away: 0 };
  return { home: h, away: a };
}

function isCupLeague(league: string): boolean {
  return /联赛杯|足总杯|杯/.test(league);
}

export function applyHandicapRules(input: HandicapGateInput): HandicapGateOutput {
  let rec = input.handicapRecommendation;
  const triggered: string[] = [...input.existingModelRules];
  const addRule = (rule: string) => {
    if (!triggered.includes(rule)) triggered.push(rule);
  };

  const line = parseHandicapLine(input.handicapLine);
  const { home: expHome, away: expAway } = parseScore(input.mostLikelyScore);
  const marginExp = expHome - expAway + line;
  const totalExp = expHome + expAway;

  const maxWdwProb = Math.max(input.homeWinProb, input.drawProb, input.awayWinProb);
  const maxHcpProb = Math.max(input.handicapWinProb, input.handicapDrawProb, input.handicapLoseProb);
  const hasHcpProbs = maxHcpProb > 0;

  // R57 平手盘一致性
  if (line === 0) {
    let expected = '';
    if (input.predictionDirection === '主胜') expected = '让胜';
    else if (input.predictionDirection === '平') expected = '让平';
    else if (input.predictionDirection === '客胜') expected = '让负';
    if (expected && rec !== expected && rec !== '观望') {
      rec = expected;
      addRule('R57');
    }
  }

  // R61 深盘走水边界（line=-2 或 +2）
  if (line === -2) {
    const homeNet = expHome - expAway;
    if (rec === '让胜' && homeNet >= 1.55 && homeNet <= 2.45) {
      rec = '让平';
      addRule('R61');
    } else if ((rec === '让平' || rec === '让负') && homeNet >= 2.6) {
      rec = '让胜';
      addRule('R61');
    } else if (rec === '让胜' && homeNet < 1.3) {
      rec = '让负';
      addRule('R61');
    }
  } else if (line === 2) {
    const awayNet = expAway - expHome;
    if (rec === '让负' && awayNet >= 1.55 && awayNet <= 2.45) {
      rec = '让平';
      addRule('R61');
    } else if ((rec === '让平' || rec === '让胜') && awayNet >= 2.6) {
      rec = '让负';
      addRule('R61');
    } else if (rec === '让负' && awayNet < 1.3) {
      rec = '让胜';
      addRule('R61');
    }
  }

  // R58 让平收缩
  if (rec === '让平' && line !== 0) {
    if (marginExp >= 0.85 && input.homeWinProb >= 58) {
      rec = '让胜';
      addRule('R58');
    } else if (marginExp <= -0.85 && input.awayWinProb >= 55) {
      rec = '让负';
      addRule('R58');
    } else if (Math.abs(marginExp) >= 1.15 && totalExp >= 2.9) {
      rec = marginExp > 0 ? '让胜' : '让负';
      addRule('R58');
    }
  }

  // R59 客让1球过线 / 主让1球对称
  if (line === 1 && rec === '让胜' && input.awayWinProb >= 55) {
    const awayNet = expAway - expHome;
    if (input.awayWinProb >= 66 || awayNet >= 0.95) {
      rec = '让负';
      addRule('R59');
    } else if (awayNet >= 0.6) {
      rec = '让平';
      addRule('R59');
    }
  } else if (line === -1 && (rec === '让负' || rec === '让平') && input.homeWinProb >= 66) {
    const homeNet = expHome - expAway;
    if (homeNet >= 0.95) {
      rec = '让胜';
      addRule('R59');
    }
  }

  // R60 杯赛低信心观望
  if (isCupLeague(input.league) && (input.confidence < 50 || maxWdwProb < 48)) {
    rec = '观望';
    addRule('R60');
  }

  // R62 通用低信心观望
  if (rec !== '观望') {
    if (hasHcpProbs) {
      if (maxHcpProb < 38 && input.confidence < 48) {
        rec = '观望';
        addRule('R62');
      }
    } else {
      if (maxWdwProb < 42 && input.confidence < 45) {
        rec = '观望';
        addRule('R62');
      }
    }
  }

  return { recommendation: rec, triggeredRules: triggered };
}
