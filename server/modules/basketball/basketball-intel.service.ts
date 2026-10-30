import { Injectable, Logger } from '@nestjs/common';

export interface IntelInjuryItem {
  name: string;
  detail?: string;
  status?: string;
}

export interface IntelKeyPlayerItem {
  name: string;
  stats?: string;
  ppg?: number;
}

export interface IntelH2hRecord {
  date?: string;
  home?: string;
  away?: string;
  homeScore?: number;
  awayScore?: number;
  result?: 'W' | 'L' | '胜' | '负';
  daysAgo?: number;
}

export interface IntelH2h {
  records?: IntelH2hRecord[];
  summary?: string;
}

export interface IntelData {
  h2h?: IntelH2h | null;
  homeInjuries?: IntelInjuryItem[];
  awayInjuries?: IntelInjuryItem[];
  homeRecentForm?: string[];
  awayRecentForm?: string[];
  homeKeyPlayers?: IntelKeyPlayerItem[];
  awayKeyPlayers?: IntelKeyPlayerItem[];
  teamNews?: string;
  homeTeam?: string;
  awayTeam?: string;
}

export interface IntelAdjustmentRule {
  spread: number;
  total: number;
  detail: string;
}

export interface IntelAdjustments {
  r44H2h: IntelAdjustmentRule | null;
  r80Injury: (IntelAdjustmentRule & { homeCoreMissing: number; awayCoreMissing: number }) | null;
  r81Form: (IntelAdjustmentRule & { homeFormScore: number; awayFormScore: number }) | null;
  totalSpreadAdjust: number;
  totalTotalAdjust: number;
  hasIntel: boolean;
  rules: string[];
}

const OUT_MISS_STATUS = [
  '赛季报销', '报销', '缺阵', '缺席', '缺战', '休战', '伤缺',
  '无法出战', '未出战', '伤停', '无限期缺阵',
  'Out', 'OUT', 'out', 'Out Indefinitely', 'Season Out', 'Sidelined',
];
const DOUBTFUL_STATUS = [
  '出战成疑', '带伤出战', '预计出战', '带伤', '恢复中', '可能出战', '存疑',
  'Questionable', 'QUESTIONABLE', 'questionable',
  'Doubtful', 'DOUBTFUL', 'doubtful',
  'Probable', 'PROBABLE', 'probable',
  'Day-To-Day', 'DAY-TO-DAY', 'day-to-day', 'DTD',
];
const DEBUT_STATUS = ['首秀', '复出首秀', 'Debut', 'Return'];

const R44_PER_GAME_SPREAD = 0.533;
const R44_MAX_SPREAD = 1.245;

const R80_CORE_SPREAD = 3.620;
const R80_ROLE_SPREAD = 1.286;
const R80_CORE_TOTAL = 2.895;
const R80_ROLE_TOTAL = 0.132;

const R81_STREAK_PER = 0.408;
const R81_WINRATE_SCALE = 3.982;
const R81_SPREAD_COEF = 2.768;
const R81_TOTAL_COEF = 1.391;
const R81_MAX_SCORE = 2.825;

const TOT_ASYM = 0.160;
const HCP_SP_BOOST = 3.146;
const HC_SIGMA = 6.796;
const OU_SIGMA = 14.162;
const OU_THRESH_RATIO = 0.452;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function parseIntelFromRow(row: {
  h2hHistory?: unknown;
  injuries?: unknown;
  recentForm?: unknown;
  keyPlayers?: unknown;
  teamNews?: string | null;
  homeTeam?: string;
  awayTeam?: string;
}): IntelData {
  const result: IntelData = {};

  const safeParse = (val: unknown): unknown => {
    if (val == null || val === '') return null;
    if (typeof val === 'object') return val;
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    }
    return null;
  };

  const h2h = safeParse(row.h2hHistory);
  if (h2h && typeof h2h === 'object') {
    const h = h2h as Record<string, unknown>;
    result.h2h = {
      records: Array.isArray(h.records) ? (h.records as IntelH2hRecord[]) : [],
      summary: typeof h.summary === 'string' ? h.summary : undefined,
    };
  }

  const inj = safeParse(row.injuries);
  if (inj && typeof inj === 'object') {
    const i = inj as Record<string, unknown>;
    const normalizeInjuries = (arr: unknown[]): IntelInjuryItem[] => {
      return arr
        .filter((x: unknown) => {
          if (!x || typeof x !== 'object') return false;
          const obj = x as Record<string, unknown>;
          return typeof obj.name === 'string' || typeof obj.playerName === 'string';
        })
        .map((x: unknown) => {
          const obj = x as Record<string, unknown>;
          const name = (obj.name as string) ?? (obj.playerName as string);
          const detail = (obj.detail as string | undefined) ?? (obj.shortComment as string | undefined);
          const status = (obj.status as string | undefined);
          return { name, detail, status };
        });
    };
    if (Array.isArray(i.home)) result.homeInjuries = normalizeInjuries(i.home);
    if (Array.isArray(i.away)) result.awayInjuries = normalizeInjuries(i.away);
  }

  const form = safeParse(row.recentForm);
  if (form && typeof form === 'object') {
    const f = form as Record<string, unknown>;
    if (Array.isArray(f.home)) result.homeRecentForm = f.home as string[];
    if (Array.isArray(f.away)) result.awayRecentForm = f.away as string[];
  }

  const kp = safeParse(row.keyPlayers);
  if (kp && typeof kp === 'object') {
    const k = kp as Record<string, unknown>;
    if (Array.isArray(k.home)) result.homeKeyPlayers = k.home.filter((x: unknown) => x && typeof (x as Record<string, unknown>).name === 'string') as IntelKeyPlayerItem[];
    if (Array.isArray(k.away)) result.awayKeyPlayers = k.away.filter((x: unknown) => x && typeof (x as Record<string, unknown>).name === 'string') as IntelKeyPlayerItem[];
  }

  if (row.teamNews && typeof row.teamNews === 'string' && row.teamNews.trim()) {
    result.teamNews = row.teamNews;
  }

  if (row.homeTeam) result.homeTeam = row.homeTeam;
  if (row.awayTeam) result.awayTeam = row.awayTeam;

  return result;
}

export function hasMeaningfulIntel(intel: IntelData): boolean {
  const hasH2h = !!(intel.h2h && ((intel.h2h.records && intel.h2h.records.length > 0) || intel.h2h.summary));
  const hasInj = !!(
    (intel.homeInjuries && intel.homeInjuries.length > 0) ||
    (intel.awayInjuries && intel.awayInjuries.length > 0)
  );
  const hasForm = !!(
    (intel.homeRecentForm && intel.homeRecentForm.length > 0) ||
    (intel.awayRecentForm && intel.awayRecentForm.length > 0)
  );
  const hasKp = !!(
    (intel.homeKeyPlayers && intel.homeKeyPlayers.length > 0) ||
    (intel.awayKeyPlayers && intel.awayKeyPlayers.length > 0)
  );
  return hasH2h || hasInj || hasForm || hasKp || !!intel.teamNews;
}

function nameMatch(injName: string | undefined | null, kpNames: (string | undefined | null)[]): boolean {
  if (!injName) return false;
  const n = injName.replace(/[\s·•\-]/g, '');
  if (!n) return false;
  for (const kp of kpNames) {
    if (!kp) continue;
    const k = kp.replace(/[\s·•\-]/g, '');
    if (!k) continue;
    if (n === k) return true;
    if (k.includes(n) && n.length >= 2) return true;
    if (n.includes(k) && k.length >= 2) return true;
    if (n.length >= 2 && k.length >= 2) {
      if (n.slice(-2) === k.slice(-2)) return true;
    }
  }
  return false;
}

function injuryStatusFactor(status: string | undefined): number {
  if (!status) return 0.3;
  const s = status.toLowerCase().trim();
  if (s.includes('out') || s.includes('sidelined') || s.includes('indefinitely')
    || s.includes('赛季报销') || s.includes('报销') || s.includes('缺阵')
    || s.includes('缺席') || s.includes('缺战') || s.includes('休战')
    || s.includes('伤缺') || s.includes('无法出战') || s.includes('未出战')
    || s.includes('伤停') || s.includes('无限期缺阵')
  ) return 1.0;
  if (s.includes('questionable') || s.includes('doubtful')
    || s.includes('probable') || s.includes('day-to-day') || s.includes('dtd')
    || s.includes('出战成疑') || s.includes('带伤出战') || s.includes('预计出战')
    || s.includes('带伤') || s.includes('恢复中') || s.includes('可能出战')
    || s.includes('存疑')
  ) return 0.5;
  if (DEBUT_STATUS.some((k: string) => status.includes(k))) return 0.3;
  return 0.3;
}

function computeR44H2h(
  h2h: IntelH2h | null | undefined,
  homeTeam: string | undefined,
  awayTeam: string | undefined,
): IntelAdjustmentRule | null {
  if (!h2h) return null;

  const summary = h2h.summary || '';
  if (!summary && (!h2h.records || h2h.records.length === 0)) return null;

  let spread = 0;
  let detail = '';

  const findTeamRecord = (teamName: string | undefined | null, isHome: boolean): { found: boolean; adj: number; desc: string } => {
    if (!teamName) return { found: false, adj: 0, desc: '' };
    const pattern = new RegExp(`${teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^，,；;。]*近(\\d+)\\s*次[^，,；;。]*`, 'u');
    const m = summary.match(pattern);
    if (!m) return { found: false, adj: 0, desc: '' };

    const n = parseInt(m[1], 10);
    const start = m.index ?? 0;
    const end = Math.min(start + 50, summary.length);
    const snippet = summary.slice(start, end);

    const wl = snippet.match(/(\d+)\s*胜[^，,。；;：:\d]*?(\d+)\s*负/);
    if (wl) {
      const w = parseInt(wl[1], 10);
      const l = parseInt(wl[2], 10);
      const diff = w - l;
      let adj = diff * R44_PER_GAME_SPREAD;
      adj = clamp(adj, -R44_MAX_SPREAD, R44_MAX_SPREAD);
      if (!isHome) adj = -adj;
      return {
        found: true,
        adj,
        desc: `${teamName}近${w + l}场${w}胜${l}负→${adj >= 0 ? '+' : ''}${adj.toFixed(1)}分`,
      };
    }

    if (/全胜|保持不败|未尝败绩/.test(snippet)) {
      let adj = clamp(n * R44_PER_GAME_SPREAD, 0, R44_MAX_SPREAD);
      if (!isHome) adj = -adj;
      return { found: true, adj, desc: `${teamName}近${n}场全胜→${adj >= 0 ? '+' : ''}${adj.toFixed(1)}分` };
    }

    if (/全负|未尝一胜|全败/.test(snippet)) {
      let adj = -clamp(n * R44_PER_GAME_SPREAD, 0, R44_MAX_SPREAD);
      if (!isHome) adj = -adj;
      return { found: true, adj, desc: `${teamName}近${n}场全负→${adj >= 0 ? '+' : ''}${adj.toFixed(1)}分` };
    }

    return { found: false, adj: 0, desc: '' };
  };

  const homeResult = findTeamRecord(homeTeam || '', true);
  const awayResult = findTeamRecord(awayTeam || '', false);

  if (homeResult.found) {
    spread += homeResult.adj;
    detail = homeResult.desc;
  } else if (awayResult.found) {
    spread += awayResult.adj;
    detail = awayResult.desc;
  }

  if (!detail) {
    const genericWl = summary.match(/(\d+)\s*[-—:：]\s*(\d+)\s*(?:全胜|保持不败|领先|占优|优势)/);
    if (genericWl) {
      const w = parseInt(genericWl[1], 10);
      const l = parseInt(genericWl[2], 10);
      const diff = w - l;
      spread = clamp(diff * R44_PER_GAME_SPREAD * 0.9, -R44_MAX_SPREAD, R44_MAX_SPREAD);
      detail = `交锋${w}胜${l}负→主队${spread >= 0 ? '+' : ''}${spread.toFixed(1)}分`;
    }
  }

  if (!detail && h2h.records && h2h.records.length > 0) {
    const records = h2h.records;
    let weightedWins = 0;
    let weightedTotal = 0;
    for (const rec of records) {
      const daysAgo = rec.daysAgo ?? 365;
      const weight = Math.max(0.3, 1 - daysAgo / 365);
      const isWin = rec.result === 'W' || rec.result === '胜';
      weightedWins += (isWin ? 1 : 0) * weight;
      weightedTotal += weight;
    }
    if (weightedTotal > 0) {
      const winRate = weightedWins / weightedTotal;
      spread = clamp((winRate - 0.5) * 4, -R44_MAX_SPREAD, R44_MAX_SPREAD);
      detail = `近${records.length}场交锋加权→主队${spread >= 0 ? '+' : ''}${spread.toFixed(1)}分`;
    }
  }

  if (!detail) return null;

  return {
    spread,
    total: 0,
    detail: `R44 交锋优势：${detail}`,
  };
}

function computeR80Injury(
  homeInjuries: IntelInjuryItem[] | undefined,
  awayInjuries: IntelInjuryItem[] | undefined,
  homeKeyPlayers: IntelKeyPlayerItem[] | undefined,
  awayKeyPlayers: IntelKeyPlayerItem[] | undefined,
): (IntelAdjustmentRule & { homeCoreMissing: number; awayCoreMissing: number }) | null {
  const kpHomeNames = (homeKeyPlayers ?? []).map((p: IntelKeyPlayerItem) => p.name);
  const kpAwayNames = (awayKeyPlayers ?? []).map((p: IntelKeyPlayerItem) => p.name);

  const calcSide = (
    injuries: IntelInjuryItem[] | undefined,
    kpNames: string[],
  ): { sp: number; tot: number; core: number; names: string[] } => {
    if (!injuries || injuries.length === 0) return { sp: 0, tot: 0, core: 0, names: [] };
    let sp = 0;
    let tot = 0;
    let core = 0;
    const names: string[] = [];
    for (const inj of injuries) {
      const factor = injuryStatusFactor(inj.status);
      const isCore = nameMatch(inj.name, kpNames);
      const spBase = isCore ? R80_CORE_SPREAD : R80_ROLE_SPREAD;
      const totBase = isCore ? R80_CORE_TOTAL : R80_ROLE_TOTAL;
      sp += spBase * factor;
      tot += totBase * factor;
      if (isCore && factor >= 1.0) {
        core += 1;
        names.push(inj.name);
      }
    }
    return { sp, tot, core, names };
  };

  const h = calcSide(homeInjuries, kpHomeNames);
  const a = calcSide(awayInjuries, kpAwayNames);

  if (h.core === 0 && a.core === 0 && h.sp === 0 && a.sp === 0) return null;

  const spreadAdjust = a.sp - h.sp;
  const totalAdjust = -(h.tot + a.tot);

  const parts: string[] = [];
  if (h.core > 0) parts.push(`主队核心缺阵${h.core}人(${h.names.join('、')})`);
  if (a.core > 0) parts.push(`客队核心缺阵${a.core}人(${a.names.join('、')})`);
  if (parts.length === 0) parts.push('角色球员缺阵');

  return {
    spread: spreadAdjust,
    total: totalAdjust,
    homeCoreMissing: h.core,
    awayCoreMissing: a.core,
    detail: `R80 伤停影响：${parts.join('，')} → 净胜${spreadAdjust >= 0 ? '+' : ''}${spreadAdjust.toFixed(1)}分`,
  };
}

export function countCoreInjuriesFromIntel(intel: IntelData | null | undefined): {
  homeCore: number;
  awayCore: number;
  homeWeighted: number;
  awayWeighted: number;
} {
  if (!intel) return { homeCore: 0, awayCore: 0, homeWeighted: 0, awayWeighted: 0 };
  const result = computeR80Injury(
    intel.homeInjuries,
    intel.awayInjuries,
    intel.homeKeyPlayers,
    intel.awayKeyPlayers,
  );
  if (!result) return { homeCore: 0, awayCore: 0, homeWeighted: 0, awayWeighted: 0 };
  const homeWeighted = intel.homeInjuries?.reduce((sum: number, inj: IntelInjuryItem) => {
    const factor = injuryStatusFactor(inj.status);
    const isCore = nameMatch(inj.name, (intel.homeKeyPlayers ?? []).map((p: IntelKeyPlayerItem) => p.name));
    return sum + factor * (isCore ? 1 : 0.3);
  }, 0) ?? 0;
  const awayWeighted = intel.awayInjuries?.reduce((sum: number, inj: IntelInjuryItem) => {
    const factor = injuryStatusFactor(inj.status);
    const isCore = nameMatch(inj.name, (intel.awayKeyPlayers ?? []).map((p: IntelKeyPlayerItem) => p.name));
    return sum + factor * (isCore ? 1 : 0.3);
  }, 0) ?? 0;
  return {
    homeCore: result.homeCoreMissing,
    awayCore: result.awayCoreMissing,
    homeWeighted: Math.round(homeWeighted * 10) / 10,
    awayWeighted: Math.round(awayWeighted * 10) / 10,
  };
}

function extractFormFromText(sent: string): number {
  let sc = 0;

  let bestStreak = 0;
  const streakRe = /(\d+)\s*连胜/g;
  let sm: RegExpExecArray | null;
  while ((sm = streakRe.exec(sent)) !== null) {
    bestStreak = Math.max(bestStreak, parseInt(sm[1], 10));
  }
  if (bestStreak > 0) {
    sc = bestStreak * R81_STREAK_PER;
  }

  let worstStreak = 0;
  const loseRe = /(\d+)\s*连败/g;
  let lm: RegExpExecArray | null;
  while ((lm = loseRe.exec(sent)) !== null) {
    worstStreak = Math.max(worstStreak, parseInt(lm[1], 10));
  }
  if (worstStreak > 0) {
    const v = -worstStreak * R81_STREAK_PER;
    if (v < sc) sc = v;
  }

  const wlRe = /(?:开局|赛季|近期|战绩|近\d+场)[^，,。；;]*?(\d+)\s*[-—:：]\s*(\d+)(?!分|板|助|个)/;
  const wl = sent.match(wlRe);
  if (wl) {
    const w = parseInt(wl[1], 10);
    const l = parseInt(wl[2], 10);
    const total = w + l;
    if (total >= 2) {
      const rate = w / total;
      const v = (rate - 0.5) * R81_WINRATE_SCALE;
      if (Math.abs(v) > Math.abs(sc)) sc = v;
    }
  }

  if (/强势|火热|状态好|出色|稳定|不败|战力强|势头猛/.test(sent)) {
    if (sc < 0.3) sc += 0.3;
  }
  if (/低迷|不佳|状态差|糟糕|垫底|下滑|起伏|挣扎/.test(sent)) {
    if (sc > -0.3) sc -= 0.3;
  }

  return clamp(sc, -R81_MAX_SCORE, R81_MAX_SCORE);
}

function sentenceBelongsToTeam(sent: string, teamName: string | undefined): boolean {
  if (!teamName) return false;
  const tn = teamName.replace(/\s/g, '');
  const s = sent.replace(/\s/g, '');
  if (s.includes(tn)) return true;
  for (let i = 0; i < tn.length - 1; i += 1) {
    const chunk = tn.slice(i, i + 3);
    if (chunk.length >= 2 && /[\u4e00-\u9fa5]/.test(chunk) && s.includes(chunk)) {
      return true;
    }
  }
  return false;
}

function computeR81Form(
  intel: IntelData,
): (IntelAdjustmentRule & { homeFormScore: number; awayFormScore: number }) | null {
  let hSc = 0;
  let aSc = 0;
  let found = false;

  if (intel.homeRecentForm && intel.homeRecentForm.length > 0) {
    const form = intel.homeRecentForm;
    const n = Math.min(form.length, 10);
    let score = 0;
    for (let i = 0; i < n; i += 1) {
      const w = n - i;
      if (form[i] === 'W' || form[i] === '胜') score += w;
      else if (form[i] === 'L' || form[i] === '负') score -= w;
    }
    const maxScore = (n * (n + 1)) / 2;
    if (maxScore > 0) hSc = (score / maxScore) * R81_MAX_SCORE;
    found = true;
  }

  if (intel.awayRecentForm && intel.awayRecentForm.length > 0) {
    const form = intel.awayRecentForm;
    const n = Math.min(form.length, 10);
    let score = 0;
    for (let i = 0; i < n; i += 1) {
      const w = n - i;
      if (form[i] === 'W' || form[i] === '胜') score += w;
      else if (form[i] === 'L' || form[i] === '负') score -= w;
    }
    const maxScore = (n * (n + 1)) / 2;
    if (maxScore > 0) aSc = (score / maxScore) * R81_MAX_SCORE;
    found = true;
  }

  if (intel.teamNews) {
    const text = intel.teamNews + '。' + (intel.h2h?.summary || '');
    const sents = text
      .replace(/[；;]/g, '。')
      .split('。')
      .map((s: string) => s.trim())
      .filter(Boolean);

    for (const sent of sents) {
      const hOwn = sentenceBelongsToTeam(sent, intel.homeTeam);
      const aOwn = sentenceBelongsToTeam(sent, intel.awayTeam);
      if (hOwn && !aOwn) {
        const s = extractFormFromText(sent);
        if (Math.abs(s) > Math.abs(hSc)) hSc = s;
        else if (s !== 0 && ((s > 0 && hSc > 0) || (s < 0 && hSc < 0))) {
          hSc = s + hSc * 0.3;
        }
        found = true;
      } else if (aOwn && !hOwn) {
        const s = extractFormFromText(sent);
        if (Math.abs(s) > Math.abs(aSc)) aSc = s;
        else if (s !== 0 && ((s > 0 && aSc > 0) || (s < 0 && aSc < 0))) {
          aSc = s + aSc * 0.3;
        }
        found = true;
      }
    }
  }

  if (!found) return null;

  hSc = clamp(hSc, -R81_MAX_SCORE, R81_MAX_SCORE);
  aSc = clamp(aSc, -R81_MAX_SCORE, R81_MAX_SCORE);

  const spreadAdjust = (hSc - aSc) * R81_SPREAD_COEF;
  const hTot = hSc > 0 ? hSc : hSc * TOT_ASYM;
  const aTot = aSc > 0 ? aSc : aSc * TOT_ASYM;
  const totalAdjust = (hTot + aTot) * R81_TOTAL_COEF;

  const parts: string[] = [];
  if (Math.abs(hSc) > 0.1) parts.push(`主队状态${hSc >= 0 ? '+' : ''}${hSc.toFixed(1)}`);
  if (Math.abs(aSc) > 0.1) parts.push(`客队状态${aSc >= 0 ? '+' : ''}${aSc.toFixed(1)}`);

  if (parts.length === 0) return null;

  return {
    spread: spreadAdjust,
    total: totalAdjust,
    homeFormScore: hSc,
    awayFormScore: aSc,
    detail: `R81 状态校准：${parts.join('，')} → 净胜${spreadAdjust >= 0 ? '+' : ''}${spreadAdjust.toFixed(1)}分`,
  };
}

export function computeIntelAdjustments(intel: IntelData): IntelAdjustments {
  const hasIntel = hasMeaningfulIntel(intel);
  if (!hasIntel) {
    return {
      r44H2h: null,
      r80Injury: null,
      r81Form: null,
      totalSpreadAdjust: 0,
      totalTotalAdjust: 0,
      hasIntel: false,
      rules: [],
    };
  }

  const rules: string[] = [];
  let totalSpread = 0;
  let totalTotal = 0;

  const r44 = computeR44H2h(intel.h2h, intel.homeTeam, intel.awayTeam);
  if (r44) {
    totalSpread += r44.spread;
    totalTotal += r44.total;
    rules.push(r44.detail);
  }

  const r80 = computeR80Injury(
    intel.homeInjuries,
    intel.awayInjuries,
    intel.homeKeyPlayers,
    intel.awayKeyPlayers,
  );
  if (r80) {
    totalSpread += r80.spread;
    totalTotal += r80.total;
    rules.push(r80.detail);
  }

  const r81 = computeR81Form(intel);
  if (r81) {
    totalSpread += r81.spread;
    totalTotal += r81.total;
    rules.push(r81.detail);
  }

  if (rules.length > 0) {
    rules.unshift('情报驱动重算：R44交锋/R80伤停/R81状态三规则下沉到预测模型内部，单一出口');
  }

  return {
    r44H2h: r44,
    r80Injury: r80,
    r81Form: r81,
    totalSpreadAdjust: totalSpread,
    totalTotalAdjust: totalTotal,
    hasIntel: rules.length > 0,
    rules,
  };
}

export interface IntelBaselinePrediction {
  homeWinProb: number;
  awayWinProb: number;
  predictionDirection: string;
  handicapPick: string;
  handicapCoverProb: number;
  handicapConfidence: '高' | '中' | '低';
  totalPick: string;
  overProb: number;
  underProb: number;
  ouConfidence: '高' | '中' | '低';
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedTotal: number;
  confidence: number;
  modelRules: string[];
  handicapLineNum: number | null;
  totalLineNum: number | null;
  league: string;
  modelSpread: number;
}

export interface IntelAdjustedPrediction {
  homeWinProb: number;
  awayWinProb: number;
  predictionDirection: string;
  handicapPick: string;
  handicapCoverProb: number;
  handicapPickProb: number;
  handicapConfidence: '高' | '中' | '低';
  totalPick: string;
  overProb: number;
  underProb: number;
  totalPickProb: number;
  ouConfidence: '高' | '中' | '低';
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedTotal: number;
  confidence: number;
  modelRules: string[];
  intelApplied: boolean;
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) return 1 - prob;
  return prob;
}

function getHandicapSigma(league: string): number {
  const name = league || '';
  if (name.includes('WNBA')) return 10;
  if (name.includes('FIBA') || name.includes('亚运') || name.includes('世界杯')) return 9;
  return 7;
}

function getTotalSigma(league: string): number {
  return getHandicapSigma(league) * 1.8;
}

export function applyIntelToPrediction(
  baseline: IntelBaselinePrediction,
  adjustments: IntelAdjustments,
): IntelAdjustedPrediction {
  if (!adjustments.hasIntel) {
    const basePickProb = baseline.handicapPick === '让分主胜'
      ? baseline.handicapCoverProb
      : baseline.handicapPick === '让分客胜'
        ? 100 - baseline.handicapCoverProb
        : Math.max(baseline.handicapCoverProb, 100 - baseline.handicapCoverProb);
    const baseTotalPickProb = baseline.totalPick === '大分'
      ? baseline.overProb
      : baseline.totalPick === '小分'
        ? 100 - baseline.overProb
        : Math.max(baseline.overProb, 100 - baseline.overProb);
    return {
      homeWinProb: baseline.homeWinProb,
      awayWinProb: baseline.awayWinProb,
      predictionDirection: baseline.predictionDirection,
      handicapPick: baseline.handicapPick,
      handicapCoverProb: baseline.handicapCoverProb,
      handicapPickProb: basePickProb,
      handicapConfidence: baseline.handicapConfidence,
      totalPick: baseline.totalPick,
      overProb: baseline.overProb,
      underProb: baseline.underProb,
      totalPickProb: baseTotalPickProb,
      ouConfidence: baseline.ouConfidence,
      predictedHomeScore: baseline.predictedHomeScore,
      predictedAwayScore: baseline.predictedAwayScore,
      predictedTotal: baseline.predictedTotal,
      confidence: baseline.confidence,
      modelRules: baseline.modelRules,
      intelApplied: false,
    };
  }

  const league = baseline.league;
  const hcSigma = getHandicapSigma(league);
  const ouSigma = getTotalSigma(league);
  const lineAbs = baseline.handicapLineNum ? Math.abs(baseline.handicapLineNum) : 0;

  const impliedSpread = -(baseline.handicapLineNum ?? 0);
  const baselineSpread = baseline.predictedHomeScore - baseline.predictedAwayScore;
  let modelSpread = baselineSpread + adjustments.totalSpreadAdjust;
  const handicapFinalRules: string[] = [];

  // V11.7 NBA赛季初稳定化（intel路径v3）：双层收缩
  // 第一层：anchor端已50%收缩 → intel端再向指数线收缩50%（总体效率模型权重25%）
  // 第二层：情报调整量收缩75%（赛季初情报/伤停可靠性降低）
  // 目标：305级别场次信心落在75-80%区间
  const isNba = league.includes('NBA') || league.includes('美职篮') || league.includes('美国职业篮球');
  const hasV117Rule = baseline.modelRules?.some((r: string) => r.includes('V11.7 NBA赛季初稳定化'));
  if (isNba && hasV117Rule && baseline.handicapLineNum !== null && baseline.handicapLineNum !== 0) {
    const originalBaseline = baselineSpread;
    const anchorBaseline = baseline.modelSpread ?? baselineSpread;
    const intelAdjust = adjustments.totalSpreadAdjust;
    const shrunkIntel = intelAdjust * 0.25;
    const doubleShrunkBaseline = impliedSpread + (anchorBaseline - impliedSpread) * 0.5;
    modelSpread = doubleShrunkBaseline + shrunkIntel;
    const totalShrinkPct = Math.round(((originalBaseline - (doubleShrunkBaseline + shrunkIntel)) / Math.max(Math.abs(originalBaseline - impliedSpread), 0.1)) * 100);
    handicapFinalRules.push(`V11.7 NBA赛季初稳定化（情报端）：anchor基线对齐+情报65%收缩，净胜${originalBaseline.toFixed(1)}→${modelSpread.toFixed(1)}分（总收缩${totalShrinkPct}%）`);
  }

  const spreadVsLine = modelSpread - impliedSpread;

  let handicapPick = '观望';
  let handicapCoverProb = 50;
  let handicapPickProb = 0;
  let handicapConfidence: '高' | '中' | '低' = '低';

  if (baseline.handicapLineNum !== null && baseline.handicapLineNum !== 0) {
    const z = spreadVsLine / hcSigma;
    const rawCoverProb = Math.round(normalCdf(z) * 100);

    const isDeepLine = lineAbs >= 25;
    const isMidDeepLine = lineAbs >= 12 && lineAbs < 25;

    if (isDeepLine) {
       if (rawCoverProb >= 50) {
         handicapPick = '让分主胜';
         handicapCoverProb = clamp(rawCoverProb, 45, 55);
         handicapConfidence = rawCoverProb >= 60 ? '中' : '低';
       } else {
         handicapPick = '让分客胜';
         handicapCoverProb = clamp(rawCoverProb, 45, 55);
         handicapConfidence = rawCoverProb <= 40 ? '中' : '低';
       }
       handicapFinalRules.push(
         `情报自洽让分·V10.2深盘强制出方向：穿盘差${spreadVsLine >= 0 ? '+' : ''}${spreadVsLine.toFixed(1)}分 → ${handicapPick}（${handicapConfidence}信心）`,
       );
     } else {
       const isNearLine = Math.abs(spreadVsLine) < 1.5 && rawCoverProb < 65 && rawCoverProb > 35;

        if (spreadVsLine > 0) {
          handicapPick = '让分主胜';
        } else {
          handicapPick = '让分客胜';
        }
       handicapCoverProb = Math.round(clamp(50 + (rawCoverProb - 50) * 0.85, 10, 90));
       const probGap = Math.abs(handicapCoverProb - 50);
       if (isNearLine) {
         handicapConfidence = '低';
         handicapFinalRules.push(
           `情报自洽让分·V10.2边缘盘强制出方向：穿盘差${spreadVsLine >= 0 ? '+' : ''}${spreadVsLine.toFixed(1)}分 → ${handicapPick}（低信心）`,
         );
       } else {
         handicapConfidence = probGap >= 15 ? '高' : probGap >= 8 ? '中' : '低';
         handicapFinalRules.push(
            `情报自洽让分：预期净胜${modelSpread >= 0 ? '+' : ''}${modelSpread.toFixed(1)}分 vs 线${baseline.handicapLineNum.toFixed(1)} → 穿盘差${spreadVsLine >= 0 ? '+' : ''}${spreadVsLine.toFixed(1)}分 → ${handicapPick}${handicapPick === '让分主胜' ? handicapCoverProb : 100 - handicapCoverProb}%（${handicapConfidence}信心，shrinkage 0.85）`,
         );
       }
     }

    if (handicapPick === '让分主胜') {
      handicapPickProb = handicapCoverProb;
    } else if (handicapPick === '让分客胜') {
      handicapPickProb = 100 - handicapCoverProb;
    } else {
      handicapPickProb = Math.max(handicapCoverProb, 100 - handicapCoverProb);
    }
  }

  let totalPick = '观望';
  let overProb = 50;
  let underProb = 50;
  let ouConfidence: '高' | '中' | '低' = '低';
  let predictedTotal = baseline.predictedTotal;

  if (baseline.totalLineNum && baseline.totalLineNum > 0) {
    const useV112 = baseline.modelRules?.some((r: string) => r.includes('V11.2 攻防效率均值模型')) ?? false;

    if (useV112) {
      // V11.2 已融合伤停压小、近期战绩、H2H交锋、效率均值等全部大小分特征
      // intel 路径不再二次叠加 totalTotalAdjust（避免双重计算导致系统性偏差）
      predictedTotal = baseline.predictedTotal;
      const diff = predictedTotal - (baseline.totalLineNum ?? 0);
      const absDiff = Math.abs(diff);
      let rawProb: number;
      if (absDiff >= 3) {
        rawProb = Math.min(0.7, 0.5 + absDiff * 0.02);
      } else {
        rawProb = 0.5 + (absDiff / 3) * 0.05;
        rawProb = Math.min(rawProb, 0.55);
      }
      if (diff >= 0) {
        overProb = Math.round(rawProb * 100);
        totalPick = '大分';
      } else {
        overProb = Math.round((1 - rawProb) * 100);
        totalPick = '小分';
      }
      underProb = 100 - overProb;
      const ouDev = Math.abs(overProb - 50);
      // V11.12 小分方向校准：回测显示小分中信心(58-64%)命中率偏低，小分中信心门槛提高
      if (ouDev >= 15) {
        ouConfidence = '高';
      } else if (ouDev >= 12 && totalPick === '小分') {
        ouConfidence = '中';
      } else if (ouDev >= 8 && totalPick === '大分') {
        ouConfidence = '中';
      } else {
        ouConfidence = '低';
      }
    } else {
      const baseTotal = baseline.predictedTotal;
      const newTotal = baseTotal + adjustments.totalTotalAdjust;
      predictedTotal = Math.round(newTotal * 10) / 10;
      const totalVsLine = newTotal - (baseline.totalLineNum ?? 0);
      const ouZ = totalVsLine / ouSigma;
      const rawOver = Math.round(normalCdf(ouZ) * 100);
      overProb = clamp(rawOver, 40, 60);
      underProb = 100 - overProb;

      const absAdj = Math.abs(totalVsLine);
      let baseThreshold = 4;
      if (absAdj >= 15) baseThreshold = 3;
      else if (absAdj >= 8) baseThreshold = 2;
      const threshold = baseThreshold * OU_THRESH_RATIO;

      const meetsThreshold = absAdj >= threshold;

      if (meetsThreshold && overProb >= 52) {
        totalPick = '大分';
      } else if (meetsThreshold && underProb >= 52) {
        totalPick = '小分';
      } else {
        totalPick = '观望';
        overProb = 51;
        underProb = 49;
      }

      const ouDeviation = Math.abs(overProb - 50);
      if (ouDeviation >= 12) ouConfidence = '高';
      else if (ouDeviation >= 8) ouConfidence = '中';
      else ouConfidence = '低';
    }
  }

  const expectedMargin = modelSpread;
  const ph = Math.round(predictedTotal / 2 + expectedMargin / 2);
  const pa = Math.round(predictedTotal / 2 - expectedMargin / 2);
  const predictedHomeScore = Math.max(40, ph);
  const predictedAwayScore = Math.max(40, pa);

  const wdwRaw = normalCdf(modelSpread / 12);
  const wdwProb = Math.round(wdwRaw * 100);
  const homeWinProb = clamp(wdwProb, 5, 95);
  const awayWinProb = 100 - homeWinProb;
  const predictionDirection = homeWinProb >= 50 ? '主胜' : '客胜';
  const confidence = Math.max(homeWinProb, awayWinProb);

  const intelRuleHeader = `情报独立预测：净胜${modelSpread >= 0 ? '+' : ''}${modelSpread.toFixed(1)}分，总分${predictedTotal.toFixed(1)}分`;
  const newRules: string[] = [intelRuleHeader, ...adjustments.rules, ...handicapFinalRules];

  const baselineNonV = baseline.modelRules.filter((r: string) => !r.startsWith('V10') && !r.startsWith('V9') && !r.startsWith('V8'));
  const modelRules = [...newRules, ...baselineNonV];

  const totalPickProb = totalPick === '大分' ? overProb : totalPick === '小分' ? underProb : Math.max(overProb, underProb);

  return {
    homeWinProb,
    awayWinProb,
    predictionDirection,
    handicapPick,
    handicapCoverProb,
    handicapPickProb,
    handicapConfidence,
    totalPick,
    overProb,
    underProb,
    totalPickProb,
    ouConfidence,
    predictedHomeScore,
    predictedAwayScore,
    predictedTotal,
    confidence,
    modelRules,
    intelApplied: true,
  };
}

@Injectable()
export class BasketballIntelService {
  private readonly logger = new Logger(BasketballIntelService.name);

  computeAdjustments(intel: IntelData): IntelAdjustments {
    return computeIntelAdjustments(intel);
  }

  parseFromRow(row: Parameters<typeof parseIntelFromRow>[0]): IntelData {
    return parseIntelFromRow(row);
  }

  applyToPrediction(
    baseline: IntelBaselinePrediction,
    adjustments: IntelAdjustments,
  ): IntelAdjustedPrediction {
    return applyIntelToPrediction(baseline, adjustments);
  }
}
