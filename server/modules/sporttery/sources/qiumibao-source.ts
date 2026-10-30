/**
 * Qiumibao (球美宝 / 直播吧) live score source adapter.
 *
 * Full-feed JSON from matchs.qiumibao.com/live/all.htm (~300KB, 600+ matches).
 * Used as fallback for leagues not covered by ESPN (Asian Games, Euro leagues, etc.)
 *
  * Row format (array):
  *   row[1]  = league id
  *   row[2]  = status: 1=pre, 2=live(inprogress), 8=finished
  *   row[3]  = kickoff unix timestamp (seconds)
  *   row[4]  = live status: 0=upcoming, timestamp=live(last update)
  *   row[5]  = home team array: [id, name, score, score2, ...]
  *   row[6]  = away team array
  *   row[10] = competition no array: row[10][0] = match no (e.g. "周一303")
  *   row[17] = period/clock text (e.g. "第3节 07:55" or "下半场 45'" or "补6′")
  *   row[28] = stage/round text (e.g. "小组赛")
  *   row[32] = odds array: ["胜平负,h,d,a", "让球-1,h,d,a", "大小2.5,o,,u"] (football)
  *                        ["胜负,h,a", "让分-1.5,h,a", "大小177.5,o,u"] (basketball)
  *
  * Sport detection: odds type is the most reliable signal.
  *   Football: odds[0] starts with "胜平负"  OR  matchNo number < 300 (e.g. 周四002)
  *   Basketball: odds[0] starts with "胜负"  OR  matchNo number >= 300 (e.g. 周二304)
  *   Fallback: check odds array length (football has 3-way odds, basketball 2-way)
 */

import { Logger } from '@nestjs/common';

const logger = new Logger('QiumibaoSource');

const BASE_URL = 'https://matchs.qiumibao.com/live/all.htm';
const REFERER = 'https://www.188bifen.com/';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Team name aliases: qiumibao name -> canonical name used in DB/竞彩
const TEAM_ALIASES: Record<string, string> = {
  // 亚运女篮
  印度尼西亚女篮: '印尼女篮',
  印尼女篮: '印尼女篮',
  中国女篮: '中国女篮',
  韩国女篮: '韩国女篮',
  蒙古女篮: '蒙古女篮',
  中国香港女篮: '香港女篮',
  香港女篮: '香港女篮',
  日本女篮: '日本女篮',
  泰国女篮: '泰国女篮',
  菲律宾女篮: '菲律宾女篮',
  哈萨克斯坦女篮: '哈萨克女篮',
  马来西亚女篮: '马来西亚女篮',
  中国台北女篮: '中华台北女篮',
  中华台北女篮: '中华台北女篮',
  // 男篮
  中国男篮: '中国男篮',
  韩国男篮: '韩国男篮',
  日本男篮: '日本男篮',
  // WNBA 别名
  达拉斯飞翼: '达拉斯飞翼',
  达拉斯飞马: '达拉斯飞翼',
  菲尼克斯水星: '菲尼克斯水星',
  凤凰城水星: '菲尼克斯水星',
  // NBL 别名
  塔斯马尼亚跳蚁: '塔斯马尼亚跳蚁',
  跳蚁: '塔斯马尼亚跳蚁',
  东南墨尔本凤凰: '东南墨尔本凤凰',
  凤凰: '东南墨尔本凤凰',
};

// Asian Games league ids from qiumibao
export const QIUMIBAO_ASIAN_GAMES_WBB_LEAGUE_ID = '3340';
export const QIUMIBAO_AUS_NBL_LEAGUE_ID = '2905';
export const QIUMIBAO_WNBA_LEAGUE_ID = '1381';

export interface QiumibaoBasketballMatch {
  sourceId: string;
  leagueId: string;
  league: string;
  matchNo: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: number; // unix seconds
  status: 'pre' | 'in' | 'post';
  homeScore: number | null;
  awayScore: number | null;
  periodText: string; // raw row[17]
  period: number | null; // 1-4 for quarters, 5+ for OT
  stage: string;
  oddsText: string; // raw row[32]
  // parsed odds
  handicapLine: string; // e.g. "-58.5"
  handicapHomeOdds: number | null;
  handicapAwayOdds: number | null;
  totalLine: string; // e.g. "154.5"
  totalOverOdds: number | null;
  totalUnderOdds: number | null;
  winHomeOdds: number | null;
  winAwayOdds: number | null;
}

export interface QiumibaoFootballMatch {
  sourceId: string;
  leagueId: string;
  league: string;
  matchNo: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: number; // unix seconds
  status: 'pre' | 'in' | 'post';
  homeScore: number | null;
  awayScore: number | null;
  halfHomeScore: number | null;
  halfAwayScore: number | null;
  periodText: string; // raw row[17]
  stage: string;
  oddsText: string; // raw row[32]
  // parsed odds
  handicapLine: string; // e.g. "-1"
  handicapHomeOdds: number | null;
  handicapDrawOdds: number | null;
  handicapAwayOdds: number | null;
  totalLine: string; // e.g. "2.5"
  totalOverOdds: number | null;
  totalUnderOdds: number | null;
  winHomeOdds: number | null;
  winDrawOdds: number | null;
  winAwayOdds: number | null;
}

function normalizeTeamName(name: string): string {
  if (!name) return '';
  const trimmed = String(name).trim();
  return TEAM_ALIASES[trimmed] ?? trimmed;
}

function parseStatus(statusCode: number | string): 'pre' | 'in' | 'post' {
  const s = Number(statusCode);
  if (s === 2 || s === 3 || s === 4 || s === 5 || s === 6 || s === 7 || s === 9 || s === 10) return 'in';
  if (s === 8 || s === 11 || s === 12 || s === 13) return 'post';
  return 'pre';
}

function parseScore(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function numOrNull(val: string): number | null {
  if (val === '' || val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function extractLineAfterPrefix(text: string, prefix: string): string {
  const idx = text.indexOf(prefix);
  if (idx < 0) return '';
  const tail = text.substring(idx + prefix.length);
  const commaIdx = tail.indexOf(',');
  return commaIdx < 0 ? tail : tail.substring(0, commaIdx);
}

interface ParsedOdds {
  handicapLine: string;
  handicapHomeOdds: number | null;
  handicapDrawOdds: number | null;
  handicapAwayOdds: number | null;
  totalLine: string;
  totalOverOdds: number | null;
  totalUnderOdds: number | null;
  winHomeOdds: number | null;
  winDrawOdds: number | null;
  winAwayOdds: number | null;
}

function parseOddsText(text: string): ParsedOdds {
  const result: ParsedOdds = {
    handicapLine: '',
    handicapHomeOdds: null,
    handicapDrawOdds: null,
    handicapAwayOdds: null,
    totalLine: '',
    totalOverOdds: null,
    totalUnderOdds: null,
    winHomeOdds: null,
    winDrawOdds: null,
    winAwayOdds: null,
  };
  if (!text) return result;

  const parts = text.split(',');
  const get = (i: number): string => (i < parts.length ? parts[i] ?? '' : '');

  // Basketball format: 胜负,h,,a,让分line,h,,a,大小line,over,,under
  // Football format:   胜平负,h,d,a,让球line,h,d,a,大小line,over,,under

  // Find "让分" or "让球" and "大小" positions
  const handicapIdx = parts.findIndex(p => /^(让分|让球)([+-]?\d)/.test(p));
  const totalIdx = parts.findIndex(p => /^大小\d/.test(p));

  if (handicapIdx >= 0) {
    result.handicapLine = extractLineAfterPrefix(parts[handicapIdx], parts[handicapIdx].startsWith('让分') ? '让分' : '让球');
    result.handicapHomeOdds = numOrNull(get(handicapIdx + 1));
    result.handicapDrawOdds = numOrNull(get(handicapIdx + 2));
    result.handicapAwayOdds = numOrNull(get(handicapIdx + 3));
  }

  if (totalIdx >= 0) {
    result.totalLine = extractLineAfterPrefix(parts[totalIdx], '大小');
    result.totalOverOdds = numOrNull(get(totalIdx + 1));
    result.totalUnderOdds = numOrNull(get(totalIdx + 3));
  }

  // Win/1X2: if first segment is "胜负" or "胜平负" or empty then win odds follow
  if (parts[0] === '胜负' || parts[0] === '胜平负') {
    result.winHomeOdds = numOrNull(get(1));
    result.winDrawOdds = numOrNull(get(2));
    result.winAwayOdds = numOrNull(get(3));
  } else if (handicapIdx > 0) {
    // No explicit prefix, first values are win odds (if they look numeric)
    // Only read if first 3 parts look like odds and there's no other label
    const firstIsNumeric = numOrNull(get(0)) !== null;
    if (firstIsNumeric && parts[0] && parts.length > 2) {
      result.winHomeOdds = numOrNull(get(0));
      result.winDrawOdds = numOrNull(get(1));
      result.winAwayOdds = numOrNull(get(2));
    }
  }

  return result;
}

function parseBasketballPeriod(text: string): { period: number | null; clock: string } {
  if (!text) return { period: null, clock: '' };
  const t = text.trim();

  // 明确节次白名单：只有能可靠识别的才给 period 值
  // 第N节
  const qMatch = t.match(/第([一二三四1234])节\s*(.*)/);
  if (qMatch) {
    const cnMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '1': 1, '2': 2, '3': 3, '4': 4 };
    const period = cnMap[qMatch[1]] ?? null;
    const clock = qMatch[2]?.trim() || t;
    return { period, clock };
  }

  // Q1/Q2/Q3/Q4
  const qnMatch = t.match(/^Q([1-4])\s*(.*)/i);
  if (qnMatch) {
    return { period: Number(qnMatch[1]), clock: qnMatch[2]?.trim() || t };
  }

  // 中场 / 半场 -> period 2
  if (/中场|半场|halftime/i.test(t)) {
    return { period: 2, clock: t };
  }

  // 明确加时：必须含"加时"或"OT"且能匹配数字，否则不给 period 避免误判
  const otMatch = t.match(/加时\s*(\d*)|OT\s*(\d*)/i);
  if (otMatch && (/加时|OT/i.test(t))) {
    const otNum = otMatch[1] || otMatch[2] ? Number(otMatch[1] || otMatch[2]) : 1;
    if (otNum >= 1 && otNum <= 10) return { period: 4 + otNum, clock: t };
    return { period: 5, clock: t };
  }

  return { period: null, clock: t };
}

function extractLeagueName(leagueId: string, stage: string, sport: 'football' | 'basketball' = 'basketball'): string {
  if (sport === 'football') {
    return stage ? `足球${stage}` : '足球';
  }
  switch (leagueId) {
    case QIUMIBAO_ASIAN_GAMES_WBB_LEAGUE_ID:
      return stage ? `亚运女篮${stage}` : '亚运女篮';
    case QIUMIBAO_AUS_NBL_LEAGUE_ID:
      return '澳NBL';
    case QIUMIBAO_WNBA_LEAGUE_ID:
      return 'WNBA';
    default:
      return stage ? `篮球${stage}` : '篮球';
  }
}

type QiumibaoSport = 'football' | 'basketball' | 'unknown';

function detectSportFromRow(row: unknown[]): QiumibaoSport {
  const m19: string = String(row[19] ?? '');
  if (m19 === '1') return 'football';
  if (m19 === '2') return 'basketball';

  const matchNo = row[10]?.[0] ? String(row[10][0]).trim() : '';
  const oddsArr = Array.isArray(row[32]) ? row[32] : [];
  const firstOddType: string = oddsArr[0] ? String(oddsArr[0]) : '';

  if (firstOddType.startsWith('胜平负')) return 'football';
  if (firstOddType.startsWith('胜负')) return 'basketball';
  if (firstOddType.includes('让球')) return 'football';
  if (firstOddType.includes('让分')) return 'basketball';

  if (matchNo) {
    const numStr = matchNo.replace(/^周./, '');
    const num = parseInt(numStr, 10);
    if (Number.isFinite(num) && num >= 100) {
      return num >= 300 ? 'basketball' : 'football';
    }
  }

  return 'unknown';
}

export class QiumibaoSource {
  private lastFetchAt: Date | null = null;
  private lastRawCount = 0;

  getLastFetchAt(): Date | null {
    return this.lastFetchAt;
  }

  getLastRawCount(): number {
    return this.lastRawCount;
  }

  async fetchBasketballAll(): Promise<{
    matches: QiumibaoBasketballMatch[];
    rawTotal: number;
    basketballCount: number;
    withMatchNoCount: number;
  }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(BASE_URL, {
        method: 'GET',
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: REFERER,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const text = await res.text();
      this.lastFetchAt = new Date();

      let data: { matches?: unknown[] };
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error(`JSON parse error: ${(parseErr as Error).message}`);
      }

      const rows = data.matches || [];
      this.lastRawCount = rows.length;

      const basketball: QiumibaoBasketballMatch[] = [];
      let bbCount = 0;
      let withNoCount = 0;

      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const sport = detectSportFromRow(row);
        if (sport !== 'basketball') continue;
        bbCount += 1;

        const matchNo = row[10]?.[0] ? String(row[10][0]).trim() : '';
        if (matchNo) withNoCount += 1;

        const homeArr = row[5];
        const awayArr = row[6];
        if (!Array.isArray(homeArr) || !Array.isArray(awayArr)) continue;

        const homeName = normalizeTeamName(String(homeArr[1] || ''));
        const awayName = normalizeTeamName(String(awayArr[1] || ''));
        if (!homeName || !awayName) continue;

        const status = parseStatus(row[2]);
        const kickoffTs = Number(row[3]) || 0;
        if (!kickoffTs) continue;

        const homeScore = parseScore(homeArr[2]);
        const awayScore = parseScore(awayArr[2]);

        // For pre-match, force scores to null (don't trust 0-0 from source)
        const finalHome = status === 'pre' ? null : homeScore;
        const finalAway = status === 'pre' ? null : awayScore;

        const rawPeriod = row[17] ? String(row[17]) : '';
        const { period, clock: periodClock } = parseBasketballPeriod(rawPeriod);

        const leagueId = String(row[1] || '');
        const stage = row[28] ? String(row[28]) : '';
        const rawOddsText = row[32] ? String(row[32]) : '';
        const parsedOdds = parseOddsText(rawOddsText);

        basketball.push({
          sourceId: `qmb-${row[0] ?? `${leagueId}-${homeName}-${awayName}`}`,
          leagueId,
          league: extractLeagueName(leagueId, stage, 'basketball'),
          matchNo,
          homeTeam: homeName,
          awayTeam: awayName,
          kickoffTime: kickoffTs,
          status,
          homeScore: finalHome,
          awayScore: finalAway,
          periodText: periodClock || rawPeriod,
          period,
          stage,
          oddsText: rawOddsText,
          handicapLine: parsedOdds.handicapLine,
          handicapHomeOdds: parsedOdds.handicapHomeOdds,
          handicapAwayOdds: parsedOdds.handicapAwayOdds,
          totalLine: parsedOdds.totalLine,
          totalOverOdds: parsedOdds.totalOverOdds,
          totalUnderOdds: parsedOdds.totalUnderOdds,
          winHomeOdds: parsedOdds.winHomeOdds,
          winAwayOdds: parsedOdds.winAwayOdds,
        });
      }

      return {
        matches: basketball,
        rawTotal: rows.length,
        basketballCount: bbCount,
        withMatchNoCount: withNoCount,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Qiumibao fetch failed: ${msg}`);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fetchFootballAll(): Promise<{
    matches: QiumibaoFootballMatch[];
    rawTotal: number;
    footballCount: number;
    withMatchNoCount: number;
  }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(BASE_URL, {
        method: 'GET',
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: REFERER,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const text = await res.text();
      this.lastFetchAt = new Date();

      let data: { matches?: unknown[] };
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error(`JSON parse error: ${(parseErr as Error).message}`);
      }

      const rows = data.matches || [];
      this.lastRawCount = rows.length;

      const football: QiumibaoFootballMatch[] = [];
      let fbCount = 0;
      let withNoCount = 0;

      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const sport = detectSportFromRow(row);
        if (sport !== 'football') continue;
        fbCount += 1;

        const matchNo = row[10]?.[0] ? String(row[10][0]).trim() : '';
        if (matchNo) withNoCount += 1;

        const homeArr = row[5];
        const awayArr = row[6];
        if (!Array.isArray(homeArr) || !Array.isArray(awayArr)) continue;

        const homeName = normalizeTeamName(String(homeArr[1] || ''));
        const awayName = normalizeTeamName(String(awayArr[1] || ''));
        if (!homeName || !awayName) continue;

        const status = parseStatus(row[2]);
        const kickoffTs = Number(row[3]) || 0;
        if (!kickoffTs) continue;

        const homeScore = parseScore(homeArr[2]);
        const awayScore = parseScore(awayArr[2]);

        const finalHome = status === 'pre' ? null : homeScore;
        const finalAway = status === 'pre' ? null : awayScore;

        // Half-time scores: row[7] commonly carries half-time info in some feeds.
        // Since exact index varies and we don't want to guess, leave them null.
        const halfHome = null;
        const halfAway = null;

        const leagueId = String(row[1] || '');
        const stage = row[28] ? String(row[28]) : '';
        const rawOddsText = row[32] ? String(row[32]) : '';
        const parsedOdds = parseOddsText(rawOddsText);

        football.push({
          sourceId: `qmb-${row[0] ?? `${leagueId}-${homeName}-${awayName}`}`,
          leagueId,
          league: extractLeagueName(leagueId, stage, 'football'),
          matchNo,
          homeTeam: homeName,
          awayTeam: awayName,
          kickoffTime: kickoffTs,
          status,
          homeScore: finalHome,
          awayScore: finalAway,
          halfHomeScore: halfHome,
          halfAwayScore: halfAway,
          periodText: row[17] ? String(row[17]) : '',
          stage,
          oddsText: rawOddsText,
          handicapLine: parsedOdds.handicapLine,
          handicapHomeOdds: parsedOdds.handicapHomeOdds,
          handicapDrawOdds: parsedOdds.handicapDrawOdds,
          handicapAwayOdds: parsedOdds.handicapAwayOdds,
          totalLine: parsedOdds.totalLine,
          totalOverOdds: parsedOdds.totalOverOdds,
          totalUnderOdds: parsedOdds.totalUnderOdds,
          winHomeOdds: parsedOdds.winHomeOdds,
          winDrawOdds: parsedOdds.winDrawOdds,
          winAwayOdds: parsedOdds.winAwayOdds,
        });
      }

      return {
        matches: football,
        rawTotal: rows.length,
        footballCount: fbCount,
        withMatchNoCount: withNoCount,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Qiumibao football fetch failed: ${msg}`);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
