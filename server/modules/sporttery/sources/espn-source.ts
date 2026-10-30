/**
 * ESPN Scoreboard API adapter.
 *
 * Fetches live/upcoming match scoreboard data from ESPN site API,
 * parses events[], and returns normalized match objects with Chinese
 * team names (via team-mappings).
 */

import {
  mapFootballTeam,
  mapBasketballTeam,
  isFootballTeamMapped,
  isBasketballTeamMapped,
} from '../team-mappings';

// --- League constants ---

export const ESPN_FOOTBALL_LEAGUES: Record<string, string> = {
  'eng.1': '英超',
  'eng.2': '英冠',
  'esp.1': '西甲',
  'ita.1': '意甲',
  'ger.1': '德甲',
  'fra.1': '法甲',
  'uefa.champions': '欧冠',
  'uefa.europa': '欧罗巴',
  'uefa.europa.conf': '欧协联',
  'afc.champions': '亚冠精英',
  'afc.cup': 'AFC杯',
  'chn.1': '中超',
  'jpn.1': 'J联赛',
  // kor.1 已停用：ESPN scoreboard 对 K 联赛当前返回 400，K 联赛由竞彩 / 球美宝等其他源覆盖
  'conmebol.libertadores': '解放者杯',
  'conmebol.sudamericana': '南美杯',
  'usa.1': '美职联',
  'bra.1': '巴甲',
  'arg.1': '阿甲',
  'fifa.worldq.afc': '世预赛亚洲区',
  'nor.1': '挪超',
  'swe.1': '瑞超',
  'den.1': '丹麦超',
  'ned.1': '荷甲',
  'ned.2': '荷乙',
  'bel.1': '比甲',
  'sco.1': '苏超',
  'aut.1': '奥甲',
  'tur.1': '土超',
  'por.1': '葡超',
  'fin.1': '芬超',
  'ger.2': '德乙',
  'fra.2': '法乙',
};

export const ESPN_BASKETBALL_LEAGUES: Record<string, string> = {
  wnba: 'WNBA',
  nba: 'NBA',
  nbl: '澳NBL',
  euroleague: '欧洲篮球联赛',
  acb: '西班牙篮球联赛',
  fiba: 'FIBA',
};

export const ESPN_BASKETBALL_PRIMARY_LEAGUES: string[] = ['wnba', 'nba', 'nbl'];

// --- Normalized data types ---

export interface ESPNFootballMatch {
  sourceId: string;
  league: string;
  leagueCode: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamEn: string;
  awayTeamEn: string;
  kickoffTime: string;
  status: 'pre' | 'in' | 'post';
  statusText: string;
  homeScore: number | null;
  awayScore: number | null;
  displayClock?: string;
  period?: number;
  oddsHomeWin?: number | null;
  oddsDraw?: number | null;
  oddsAwayWin?: number | null;
  handicapLine?: number | null;
  totalLine?: number | null;
  handicapHomeOdds?: number | null;
  handicapAwayOdds?: number | null;
  totalOverOdds?: number | null;
  totalUnderOdds?: number | null;
}

export interface ESPNBasketballMatch {
  sourceId: string;
  league: string;
  leagueCode: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamEn: string;
  awayTeamEn: string;
  kickoffTime: string;
  status: 'pre' | 'in' | 'post';
  statusText: string;
  homeScore: number | null;
  awayScore: number | null;
  displayClock?: string;
  period?: number;
  homeTeamId?: string;
  awayTeamId?: string;
  oddsHomeWin?: number | null;
  oddsAwayWin?: number | null;
  handicapLine?: number | null;
  totalLine?: number | null;
  handicapHomeOdds?: number | null;
  handicapAwayOdds?: number | null;
  totalOverOdds?: number | null;
  totalUnderOdds?: number | null;
}

// --- Deep data types ---

export interface EspnKeyPlayer {
  name: string;
  position: string;
  ppg?: number;
  rpg?: number;
  apg?: number;
}

export interface EspnTeamStats {
  winRate?: number;
  homeRecord?: string;
  awayRecord?: string;
}

export interface EspnH2hItem {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

export interface EspnBasketballDeepData {
  keyPlayersHome: EspnKeyPlayer[];
  keyPlayersAway: EspnKeyPlayer[];
  homeStats: EspnTeamStats;
  awayStats: EspnTeamStats;
  homeForm: string;
  awayForm: string;
  h2h: EspnH2hItem[];
  injuries: string;
}

// --- Summary data types (pickcenter / injuries / news) ---

export interface EspnPickcenterOdds {
  provider: string;
  details: string;
  spread: number | null;
  overUnder: number | null;
  overOdds: number | null;
  underOdds: number | null;
  homeMoneyLine: number | null;
  awayMoneyLine: number | null;
  drawMoneyLine: number | null;
  homeSpreadOdds: number | null;
  awaySpreadOdds: number | null;
  homeFavorite: boolean;
  homeFavoriteAtOpen: boolean;
}

export interface EspnInjuryItem {
  athleteName: string;
  status: string;
  date: string | null;
  type: string | null;
}

export interface EspnTeamInjuries {
  teamName: string;
  teamAbbr: string;
  injuries: EspnInjuryItem[];
}

export interface EspnNewsItem {
  id: string;
  headline: string;
  description: string | null;
  lastModified: string | null;
  type: string | null;
}

export interface EspnMatchStats {
  totalShots: number;
  shotsOnTarget: number;
  wonCorners: number;
  possessionPct: number;
  foulsCommitted: number;
  passPct: number;
}

export interface EspnSummaryData {
  eventId: string;
  pickcenter: EspnPickcenterOdds[];
  homeInjuries: EspnInjuryItem[];
  awayInjuries: EspnInjuryItem[];
  news: EspnNewsItem[];
  homeTeamStats: Record<string, string>;
  awayTeamStats: Record<string, string>;
  fetchedAt: string;
}

// --- Internal raw response shapes (partial) ---

interface EspnCompetitor {
  id?: string;
  uid?: string;
  name?: string;
  displayName?: string;
  shortDisplayName?: string;
  homeAway?: 'home' | 'away';
  score?: string;
  winner?: boolean;
  team?: {
    id?: string | number;
    displayName?: string;
    shortDisplayName?: string;
    name?: string;
    abbreviation?: string;
  };
}

interface EspnCompetition {
  id?: string;
  competitors?: EspnCompetitor[];
  status?: {
    type?: {
      id?: string;
      name?: string;
      state?: string;
      completed?: boolean;
      description?: string;
      detail?: string;
      shortDetail?: string;
    };
    displayClock?: string;
    period?: number;
  };
  odds?: unknown[];
  series?: {
    type?: string;
    title?: string;
    summary?: string;
    completed?: boolean;
    totalCompetitions?: number;
  };
  type?: {
    id?: string;
    abbreviation?: string;
  };
}

interface EspnEvent {
  id?: string;
  uid?: string;
  name?: string;
  shortName?: string;
  date?: string;
  status?: {
    type?: {
      id?: string;
      name?: string;
      state?: string;
      completed?: boolean;
      description?: string;
      detail?: string;
      shortDetail?: string;
    };
    displayClock?: string;
    period?: number;
  };
  competitions?: EspnCompetition[];
  league?: {
    id?: string;
    name?: string;
    abbreviation?: string;
  };
  season?: {
    year?: number;
    type?: number;
    slug?: string;
  };
}

interface EspnScoreboardResponse {
  events?: EspnEvent[];
  leagues?: Array<Record<string, unknown>>;
  season?: Record<string, unknown>;
  [key: string]: unknown;
}

// --- Helpers ---

const USER_AGENT = 'Mozilla/5.0 (compatible; MatchInsight/1.0)';

function mapStatusState(state: string | undefined): 'pre' | 'in' | 'post' {
  if (!state) return 'pre';
  const s: string = state.toLowerCase();
  if (s === 'in' || s === 'in_progress') return 'in';
  if (s === 'post' || s === 'final') return 'post';
  return 'pre';
}

function extractTeamName(competitor: EspnCompetitor): string {
  // ESPN sometimes nests team info, sometimes puts it flat
  return (
    competitor.team?.displayName ??
    competitor.displayName ??
    competitor.name ??
    ''
  );
}

function parseScore(score: string | undefined): number | null {
  if (score === undefined || score === null || score === '') return null;
  const num: number = parseInt(score, 10);
  return Number.isNaN(num) ? null : num;
}

function americanToDecimal(american: number | null | undefined): number | null {
  if (american === null || american === undefined || Number.isNaN(american) || american === 0) return null;
  if (american > 0) {
    return +((american / 100) + 1).toFixed(2);
  }
  return +((100 / Math.abs(american)) + 1).toFixed(2);
}

function extractOddsFromCompetition(
  competition: EspnCompetition,
): {
  homeWin: number | null;
  awayWin: number | null;
  draw: number | null;
  handicapLine: number | null;
  handicapHomeOdds: number | null;
  handicapAwayOdds: number | null;
  totalLine: number | null;
  totalOverOdds: number | null;
  totalUnderOdds: number | null;
} {
  const oddsArr = competition.odds;
  if (!Array.isArray(oddsArr) || oddsArr.length === 0) {
    return { homeWin: null, awayWin: null, draw: null, handicapLine: null, handicapHomeOdds: null, handicapAwayOdds: null, totalLine: null, totalOverOdds: null, totalUnderOdds: null };
  }
  const first = oddsArr[0] as Record<string, unknown> | undefined;
  if (!first) return { homeWin: null, awayWin: null, draw: null, handicapLine: null, handicapHomeOdds: null, handicapAwayOdds: null, totalLine: null, totalOverOdds: null, totalUnderOdds: null };

  const moneyline = first.moneyline as Record<string, unknown> | undefined;
  const pointSpread = first.pointSpread as Record<string, unknown> | undefined;
  const total = first.total as Record<string, unknown> | undefined;
  const overUnder = typeof first.overUnder === 'number' ? first.overUnder : null;

  const homeMl = moneyline?.home ? (moneyline.home as Record<string, unknown>).close : undefined;
  const awayMl = moneyline?.away ? (moneyline.away as Record<string, unknown>).close : undefined;
  const drawMl = moneyline?.draw ? (moneyline.draw as Record<string, unknown>).close : undefined;

  const homeMlOdds = homeMl ? Number((homeMl as Record<string, unknown>).odds) : 0;
  const awayMlOdds = awayMl ? Number((awayMl as Record<string, unknown>).odds) : 0;
  const drawMlOdds = drawMl ? Number((drawMl as Record<string, unknown>).odds) : 0;

  const psHome = pointSpread?.home ? (pointSpread.home as Record<string, unknown>).close : undefined;
  const psAway = pointSpread?.away ? (pointSpread.away as Record<string, unknown>).close : undefined;
  const handicapLineVal = psHome ? Number((psHome as Record<string, unknown>).line) : 0;
  const hHomeOdds = psHome ? Number((psHome as Record<string, unknown>).odds) : 0;
  const hAwayOdds = psAway ? Number((psAway as Record<string, unknown>).odds) : 0;

  const totalOver = total?.over ? (total.over as Record<string, unknown>).close : undefined;
  const totalUnder = total?.under ? (total.under as Record<string, unknown>).close : undefined;
  const tOverOdds = totalOver ? Number((totalOver as Record<string, unknown>).odds) : 0;
  const tUnderOdds = totalUnder ? Number((totalUnder as Record<string, unknown>).odds) : 0;

  return {
    homeWin: americanToDecimal(homeMlOdds || null),
    awayWin: americanToDecimal(awayMlOdds || null),
    draw: americanToDecimal(drawMlOdds || null),
    handicapLine: handicapLineVal !== 0 ? handicapLineVal : null,
    handicapHomeOdds: americanToDecimal(hHomeOdds || null),
    handicapAwayOdds: americanToDecimal(hAwayOdds || null),
    totalLine: overUnder ?? null,
    totalOverOdds: americanToDecimal(tOverOdds || null),
    totalUnderOdds: americanToDecimal(tUnderOdds || null),
  };
}

// --- ESPN Source ---

export class EspnSource {
  /**
   * Fetch football (soccer) scoreboard for a given league code.
   *
   * @param leagueCode ESPN league code (e.g. "eng.1", "esp.1")
   * @param date YYYYMMDD date string (optional, defaults to today)
   */
  async fetchFootballScoreboard(
    leagueCode: string,
    date?: string,
  ): Promise<{
    matches: ESPNFootballMatch[];
    pendingMappings: string[];
    statusCode: number;
  }> {
    const url: string =
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/scoreboard` +
      (date ? `?dates=${date}` : '');

    const response: Response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    const statusCode: number = response.status;

    if (!response.ok) {
      throw new Error(
        `ESPN football scoreboard request failed: ${statusCode} ${response.statusText} (league=${leagueCode})`,
      );
    }

    const data: EspnScoreboardResponse = (await response.json()) as EspnScoreboardResponse;
    const events: EspnEvent[] = data.events ?? [];

    const matches: ESPNFootballMatch[] = [];
    const pendingSet: Set<string> = new Set<string>();
    const leagueName: string =
      ESPN_FOOTBALL_LEAGUES[leagueCode] ?? leagueCode;

    for (const event of events) {
      const competition: EspnCompetition | undefined =
        event.competitions?.[0];
      if (!competition || !competition.competitors) continue;

      const competitors: EspnCompetitor[] = competition.competitors;
      const home: EspnCompetitor | undefined = competitors.find(
        (c: EspnCompetitor) => c.homeAway === 'home',
      );
      const away: EspnCompetitor | undefined = competitors.find(
        (c: EspnCompetitor) => c.homeAway === 'away',
      );
      if (!home || !away) continue;

      const homeNameEn: string = extractTeamName(home);
      const awayNameEn: string = extractTeamName(away);

      if (!homeNameEn || !awayNameEn) continue;

      const homeNameZh: string = mapFootballTeam(homeNameEn);
      const awayNameZh: string = mapFootballTeam(awayNameEn);

      if (!isFootballTeamMapped(homeNameEn)) pendingSet.add(homeNameEn);
      if (!isFootballTeamMapped(awayNameEn)) pendingSet.add(awayNameEn);

      // Status: prefer competition-level status, fall back to event-level
      const statusType = competition.status?.type ?? event.status?.type;
      const state: string = statusType?.state ?? '';
      const statusText: string =
        statusType?.description ?? statusType?.shortDetail ?? '';

      const displayClock: string | undefined =
        competition.status?.displayClock ?? event.status?.displayClock;
      const period: number | undefined =
        competition.status?.period ?? event.status?.period;

      const odds = extractOddsFromCompetition(competition);

      matches.push({
        sourceId: event.id ?? '',
        league: leagueName,
        leagueCode,
        homeTeam: homeNameZh,
        awayTeam: awayNameZh,
        homeTeamEn: homeNameEn,
        awayTeamEn: awayNameEn,
        kickoffTime: event.date ?? '',
        status: mapStatusState(state),
        statusText,
        homeScore: parseScore(home.score),
        awayScore: parseScore(away.score),
        displayClock,
        period,
        oddsHomeWin: odds.homeWin,
        oddsDraw: odds.draw,
        oddsAwayWin: odds.awayWin,
        handicapLine: odds.handicapLine,
        totalLine: odds.totalLine,
        handicapHomeOdds: odds.handicapHomeOdds,
        handicapAwayOdds: odds.handicapAwayOdds,
        totalOverOdds: odds.totalOverOdds,
        totalUnderOdds: odds.totalUnderOdds,
      });
    }

    return {
      matches,
      pendingMappings: Array.from(pendingSet),
      statusCode,
    };
  }

  /**
   * Fetch basketball scoreboard for a given league.
   *
   * @param league "wnba" | "nba"
   * @param date YYYYMMDD date string (optional, defaults to today)
   */
  async fetchBasketballScoreboard(
    league: string,
    date?: string,
  ): Promise<{
    matches: ESPNBasketballMatch[];
    pendingMappings: string[];
    statusCode: number;
    rawEventCount: number;
  }> {
    const url: string =
      `https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/scoreboard` +
      (date ? `?dates=${date}` : '');

    const response: Response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    const statusCode: number = response.status;

    if (!response.ok) {
      throw new Error(
        `ESPN basketball scoreboard request failed: ${statusCode} ${response.statusText} (league=${league})`,
      );
    }

    const data: EspnScoreboardResponse = (await response.json()) as EspnScoreboardResponse;
    const events: EspnEvent[] = data.events ?? [];

    const matches: ESPNBasketballMatch[] = [];
    const pendingSet: Set<string> = new Set<string>();
    const leagueName: string =
      ESPN_BASKETBALL_LEAGUES[league] ?? league;

    for (const event of events) {
      const competition: EspnCompetition | undefined =
        event.competitions?.[0];
      if (!competition || !competition.competitors) continue;

      const competitors: EspnCompetitor[] = competition.competitors;
      const home: EspnCompetitor | undefined = competitors.find(
        (c: EspnCompetitor) => c.homeAway === 'home',
      );
      const away: EspnCompetitor | undefined = competitors.find(
        (c: EspnCompetitor) => c.homeAway === 'away',
      );
      if (!home || !away) continue;

      const homeNameEn: string = extractTeamName(home);
      const awayNameEn: string = extractTeamName(away);

      if (!homeNameEn || !awayNameEn) continue;

      const homeNameZh: string = mapBasketballTeam(homeNameEn);
      const awayNameZh: string = mapBasketballTeam(awayNameEn);

      if (!isBasketballTeamMapped(homeNameEn)) pendingSet.add(homeNameEn);
      if (!isBasketballTeamMapped(awayNameEn)) pendingSet.add(awayNameEn);

      const statusType = competition.status?.type ?? event.status?.type;
      const state: string = statusType?.state ?? '';
      const statusText: string =
        statusType?.description ?? statusType?.shortDetail ?? '';

      const displayClock: string | undefined =
        competition.status?.displayClock ?? event.status?.displayClock;
      const period: number | undefined =
        competition.status?.period ?? event.status?.period;

      const odds = extractOddsFromCompetition(competition);

      let matchLeague = leagueName;
      const seasonType = event.season?.type;
      if (seasonType === 3) {
        const series = competition.series as Record<string, unknown> | undefined;
        if (series?.type === 'playoff') {
          const compType = competition.type as Record<string, unknown> | undefined;
          const compAbbr = compType?.abbreviation as string | undefined;
          if (compAbbr === 'FINAL' || compAbbr === 'FINALS') {
            matchLeague = leagueName.replace('常规赛', '') + '总决赛';
          } else {
            matchLeague = leagueName.replace('常规赛', '') + '季后赛';
          }
        }
      }

      matches.push({
        sourceId: event.id ?? '',
        league: matchLeague,
        leagueCode: league,
        homeTeam: homeNameZh,
        awayTeam: awayNameZh,
        homeTeamEn: homeNameEn,
        awayTeamEn: awayNameEn,
        homeTeamId: home.team?.id ? String(home.team.id) : undefined,
        awayTeamId: away.team?.id ? String(away.team.id) : undefined,
        kickoffTime: event.date ?? '',
        status: mapStatusState(state),
        statusText,
        homeScore: parseScore(home.score),
        awayScore: parseScore(away.score),
        displayClock,
        period,
        oddsHomeWin: odds.homeWin,
        oddsAwayWin: odds.awayWin,
        handicapLine: odds.handicapLine,
        totalLine: odds.totalLine,
        handicapHomeOdds: odds.handicapHomeOdds,
        handicapAwayOdds: odds.handicapAwayOdds,
        totalOverOdds: odds.totalOverOdds,
        totalUnderOdds: odds.totalUnderOdds,
      });
    }

    return {
      matches,
      pendingMappings: Array.from(pendingSet),
      statusCode,
      rawEventCount: events.length,
    };
  }

  /**
   * Fetch basketball team summary (leaders, record, form) from ESPN summary endpoint.
   * Uses the event id to get detailed match info including team leaders.
   */
  async fetchBasketballEventSummary(
    league: string,
    eventId: string,
   ): Promise<{
     homeLeaders: EspnKeyPlayer[];
     awayLeaders: EspnKeyPlayer[];
     homeRecord: string;
     awayRecord: string;
     homeHomeRecord: string;
     awayRoadRecord: string;
     homeForm: string;
     awayForm: string;
     homeTeamId: string;
     awayTeamId: string;
     homeTeamName: string;
     awayTeamName: string;
     homeTeamStats: Record<string, string>;
     awayTeamStats: Record<string, string>;
     statusCode: number;
   }> {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/summary?event=${eventId}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    const statusCode = response.status;
    if (!response.ok) {
      throw new Error(
        `ESPN basketball summary failed: ${statusCode} ${response.statusText} (league=${league}, event=${eventId})`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Parse header / team info
    const header = (data?.header as Record<string, unknown> | undefined) ?? {};
    const competitions = (header.competitions as unknown[] | undefined) ?? [];
    const competition = competitions[0] as Record<string, unknown> | undefined;
    const competitors = (competition?.competitors as unknown[] | undefined) ?? [];

    let homeTeamId = '';
    let awayTeamId = '';
    let homeTeamName = '';
    let awayTeamName = '';
    let homeRecord = '';
    let awayRecord = '';
    let homeHomeRecord = '';
    let awayRoadRecord = '';

    for (const c of competitors) {
      const comp = c as Record<string, unknown>;
      const isHome = comp.homeAway === 'home';
      const team = comp.team as Record<string, unknown> | undefined;
      if (!team) continue;
      const tid = String(team.id ?? '');
      const tname = (team.displayName as string) || '';
      const records = (comp.record as unknown[] | undefined) ?? [];
      let totalRecord = '';
      let hRecord = '';
      let rRecord = '';
      for (const r of records) {
        const rec = r as { type?: string; summary?: string; displayValue?: string };
        if (rec.type === 'total') {
          totalRecord = rec.summary || rec.displayValue || '';
        } else if (rec.type === 'home') {
          hRecord = rec.summary || rec.displayValue || '';
        } else if (rec.type === 'road' || rec.type === 'away') {
          rRecord = rec.summary || rec.displayValue || '';
        }
      }
      if (isHome) {
        homeTeamId = tid;
        homeTeamName = tname;
        homeRecord = totalRecord;
        homeHomeRecord = hRecord;
      } else {
        awayTeamId = tid;
        awayTeamName = tname;
        awayRecord = totalRecord;
        awayRoadRecord = rRecord;
      }
    }

    // Parse top-level leaders (data.leaders = [{team, leaders:[{displayName,name,athletes:[{athlete,stat}]}]}])
    const parseLeadersFromTop = (
      teamLeadersObj: unknown,
    ): EspnKeyPlayer[] => {
      const players: EspnKeyPlayer[] = [];
      const tl = teamLeadersObj as { leaders?: Array<{ displayName?: string; name?: string; leaders?: Array<{ athlete?: { displayName?: string; position?: { abbreviation?: string } }; displayValue?: string; value?: string | number }> }> } | undefined;
      const cats = tl?.leaders ?? [];
      for (const cat of cats) {
        const catName = cat.displayName ?? cat.name ?? '';
        const athletes = cat.leaders ?? [];
        for (const a of athletes) {
          const name = a.athlete?.displayName ?? '';
          const pos = a.athlete?.position?.abbreviation ?? '';
          const rawVal = a.displayValue ?? a.value ?? '0';
          const value = parseFloat(String(rawVal)) || 0;
          if (!name) continue;
          let existing = players.find((p) => p.name === name);
          if (!existing) {
            existing = { name, position: pos, ppg: 0, rpg: 0, apg: 0 };
            players.push(existing);
          }
          if (catName.includes('Points') || catName.includes('points') || cat.name === 'pointsPerGame') {
            existing.ppg = value;
          } else if (catName.includes('Rebounds') || catName.includes('rebounds') || cat.name === 'reboundsPerGame') {
            existing.rpg = value;
          } else if (catName.includes('Assists') || catName.includes('assists') || cat.name === 'assistsPerGame') {
            existing.apg = value;
          }
        }
      }
      return players.slice(0, 5);
    };

    let homeLeaders: EspnKeyPlayer[] = [];
    let awayLeaders: EspnKeyPlayer[] = [];
    const topLeaders = (data.leaders as unknown[] | undefined) ?? [];
    for (const tl of topLeaders) {
      const tlObj = tl as Record<string, unknown>;
      const team = tlObj.team as Record<string, unknown> | undefined;
      const tid = String(team?.id ?? '');
      if (tid === homeTeamId) {
        homeLeaders = parseLeadersFromTop(tlObj);
      } else if (tid === awayTeamId) {
        awayLeaders = parseLeadersFromTop(tlObj);
      }
    }

    // Parse lastFiveGames (data.lastFiveGames = [{team, events:[{gameResult, ...}]}])
    let homeForm = '';
    let awayForm = '';
    const lastFive = (data.lastFiveGames as unknown[] | undefined) ?? [];
    for (const l5 of lastFive) {
      const l5Obj = l5 as Record<string, unknown>;
      const team = l5Obj.team as Record<string, unknown> | undefined;
      const tid = String(team?.id ?? '');
      const events = (l5Obj.events as unknown[] | undefined) ?? [];
      const results: string[] = [];
        for (const e of events) {
          const ev = e as { gameResult?: string };
          const gr = (ev.gameResult ?? '').toLowerCase();
          if (gr === 'win' || gr === 'w') {
            results.push('胜');
          } else if (gr === 'loss' || gr === 'l') {
            results.push('负');
          } else if (gr === 'draw' || gr === 'tie' || gr === 'd' || gr === 't') {
            results.push('平');
          }
        }
      const formStr = results.join('');
      if (tid === homeTeamId) {
        homeForm = formStr;
      } else if (tid === awayTeamId) {
        awayForm = formStr;
      }
    }

     const boxscore = (data?.boxscore as Record<string, unknown> | undefined) ?? {};
     const boxTeams = (boxscore.teams as unknown[] | undefined) ?? [];
     const homeTeamStats: Record<string, string> = {};
     const awayTeamStats: Record<string, string> = {};
     for (const bt of boxTeams) {
       const btRec = bt as Record<string, unknown>;
       const team = btRec.team as Record<string, unknown> | undefined;
       const teamId = team ? String(team.id ?? '') : '';
       const stats = (btRec.statistics as unknown[] | undefined) ?? [];
       const statMap: Record<string, string> = {};
       for (const s of stats) {
         const sRec = s as Record<string, unknown>;
         const name = String(sRec.name ?? '');
         const val = String(sRec.displayValue ?? '');
         if (name) statMap[name] = val;
       }
       if (teamId === homeTeamId) {
         Object.assign(homeTeamStats, statMap);
       } else if (teamId === awayTeamId) {
         Object.assign(awayTeamStats, statMap);
       }
     }

      return {
        homeLeaders,
        awayLeaders,
        homeRecord,
        awayRecord,
        homeHomeRecord,
        awayRoadRecord,
        homeForm,
        awayForm,
        homeTeamId,
        awayTeamId,
        homeTeamName,
        awayTeamName,
        homeTeamStats,
        awayTeamStats,
        statusCode,
      };
  }

  /**
   * Fetch basketball team statistics.
   */
  async fetchBasketballTeamStats(
    league: string,
    teamId: string,
  ): Promise<{ stats: Record<string, string>; statusCode: number }> {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/teams/${teamId}/statistics`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    const statusCode = response.status;
    if (!response.ok) {
      throw new Error(
        `ESPN basketball team stats failed: ${statusCode} ${response.statusText} (league=${league}, team=${teamId})`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const results: Record<string, string> = {};
    const resultsObj = (data.results as Record<string, unknown> | undefined) ?? {};
    const statsObj = resultsObj.stats as Record<string, unknown> | undefined;
    const categories = ((statsObj?.categories as unknown[] | undefined) ?? []) as Array<{ name?: string; displayName?: string; stats?: Array<{ name?: string; displayName?: string; displayValue?: string }> }>;
    for (const cat of categories) {
      const catStats = cat.stats ?? [];
      for (const s of catStats) {
        if (s.name && s.displayValue !== undefined) {
          results[s.name] = s.displayValue;
        }
        if (s.displayName && s.displayValue !== undefined) {
          results[s.displayName] = s.displayValue;
        }
      }
    }

    return { stats: results, statusCode };
  }

  /**
   * Fetch team head-to-head history for a basketball matchup.
   * Uses the summary endpoint's "odds and trends" / "head to head" section if available.
   */
  async fetchBasketballH2h(
    league: string,
    eventId: string,
  ): Promise<{ h2h: EspnH2hItem[]; statusCode: number }> {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/summary?event=${eventId}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    const statusCode = response.status;
    if (!response.ok) {
      throw new Error(
        `ESPN basketball H2H failed: ${statusCode} ${response.statusText} (league=${league}, event=${eventId})`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const h2hItems: EspnH2hItem[] = [];

    // ESPN summary has "seasonseries" array with events containing H2H matchups
    const seasonSeries = (data.seasonseries as unknown[] | undefined) ?? [];
    for (const series of seasonSeries) {
      const s = series as Record<string, unknown>;
      const events = (s.events as unknown[] | undefined) ?? [];
      for (const ev of events) {
        const evt = ev as { date?: string; competitors?: Array<{ homeAway?: string; team?: { displayName?: string; abbreviation?: string }; score?: string | number; winner?: boolean }> };
        const competitors = evt.competitors;
        if (!competitors || competitors.length < 2) continue;
        const home = competitors.find((c) => c.homeAway === 'home');
        const away = competitors.find((c) => c.homeAway === 'away');
        if (!home || !away) continue;
        const homeScore = typeof home.score === 'string' ? parseInt(home.score, 10) || 0 : (home.score ?? 0);
        const awayScore = typeof away.score === 'string' ? parseInt(away.score, 10) || 0 : (away.score ?? 0);
        if (homeScore <= 0 && awayScore <= 0) continue;
        h2hItems.push({
          date: evt.date ?? '',
          homeTeam: home.team?.displayName ?? home.team?.abbreviation ?? '',
          awayTeam: away.team?.displayName ?? away.team?.abbreviation ?? '',
          homeScore,
          awayScore,
        });
      }
    }

    return { h2h: h2hItems.slice(0, 6), statusCode };
  }

  /**
   * Fetch football (soccer) team statistics.
   */
  async fetchFootballTeamStats(
    leagueCode: string,
    teamId: string,
  ): Promise<{ stats: Record<string, string>; statusCode: number }> {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/teams/${teamId}/statistics`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    const statusCode = response.status;
    if (!response.ok) {
      throw new Error(
        `ESPN football team stats failed: ${statusCode} ${response.statusText} (league=${leagueCode}, team=${teamId})`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const results: Record<string, string> = {};
    const resultsObj = (data.results as Record<string, unknown> | undefined) ?? {};
    const statsObj = resultsObj.stats as Record<string, unknown> | undefined;
    const categories = ((statsObj?.categories as unknown[] | undefined) ?? []) as Array<{ name?: string; displayName?: string; stats?: Array<{ name?: string; displayName?: string; displayValue?: string }> }>;
    for (const cat of categories) {
      const catStats = cat.stats ?? [];
      for (const s of catStats) {
        if (s.name && s.displayValue !== undefined) {
          results[s.name] = s.displayValue;
        }
        if (s.displayName && s.displayValue !== undefined) {
          results[s.displayName] = s.displayValue;
        }
      }
    }

    return { stats: results, statusCode };
  }

  /**
   * Fetch football (soccer) event summary with form/H2H/predictor data.
   */
  async fetchFootballEventSummary(
    leagueCode: string,
    eventId: string,
  ): Promise<{
    homeTeamId: string;
    awayTeamId: string;
    homeForm: { result: string; opponent: string; score: string; date: string }[];
    awayForm: { result: string; opponent: string; score: string; date: string }[];
    matchStats: { home: EspnMatchStats | null; away: EspnMatchStats | null };
    statusCode: number;
  }> {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/summary?event=${eventId}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    const statusCode = response.status;
    if (!response.ok) {
      throw new Error(
        `ESPN football event summary failed: ${statusCode} ${response.statusText} (league=${leagueCode}, event=${eventId})`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const header = (data.header as Record<string, unknown>) || {};
    const competitions = (header.competitions as unknown[] | undefined) ?? [];
    let homeTeamId = '';
    let awayTeamId = '';
    if (competitions.length > 0) {
      const comp = competitions[0] as Record<string, unknown>;
      const comps = (comp.competitors as unknown[] | undefined) ?? [];
      for (const c of comps) {
        const competitor = c as Record<string, unknown>;
        const team = (competitor.team as Record<string, unknown>) || {};
        const tid = String(team.id || '');
        const homeAway = String(competitor.homeAway || '');
        if (homeAway === 'home') homeTeamId = tid;
        if (homeAway === 'away') awayTeamId = tid;
      }
    }

    const parseForm = (formEvents: unknown[]): { result: string; opponent: string; score: string; date: string }[] => {
      const results: { result: string; opponent: string; score: string; date: string }[] = [];
      for (const ev of formEvents) {
        const event = ev as Record<string, unknown>;
        const oppObj = (event.opponent || {}) as Record<string, unknown>;
        const opponent = String(oppObj.displayName || oppObj.name || oppObj.abbreviation || '');
        const score = String(event.score || '');
        const date = String(event.gameDate || event.date || '');
        const gameResult = String(event.gameResult || '').toUpperCase();
        let result = '';
        if (gameResult.includes('WIN') || gameResult === 'W') result = '胜';
        else if (gameResult.includes('LOSS') || gameResult.includes('LOSE') || gameResult === 'L') result = '负';
        else if (gameResult.includes('DRAW') || gameResult.includes('TIE') || gameResult === 'D') result = '平';
        if (opponent) results.push({ result, opponent, score, date });
      }
      return results;
    };

    let homeForm: { result: string; opponent: string; score: string; date: string }[] = [];
    let awayForm: { result: string; opponent: string; score: string; date: string }[] = [];
    const lastFiveGames = (data.lastFiveGames as unknown[] | undefined) ?? [];
    for (const tf of lastFiveGames) {
      const teamForm = tf as Record<string, unknown>;
      const team = (teamForm.team as Record<string, unknown>) || {};
      const tid = String(team.id || '');
      const events = (teamForm.events as unknown[] | undefined) ?? [];
      const parsed = parseForm(events);
      if (tid === homeTeamId) homeForm = parsed;
      else if (tid === awayTeamId) awayForm = parsed;
    }

    const parseMatchStats = (
      teamStats: unknown[],
    ): EspnMatchStats | null => {
      const map: Record<string, number> = {};
      for (const s of teamStats) {
        const stat = s as Record<string, unknown>;
        const name = String(stat.name || '');
        const raw = stat.value !== undefined ? stat.value : stat.displayValue;
        const num = typeof raw === 'number' ? raw : parseFloat(String(raw || '0').replace(/[^0-9.]/g, ''));
        if (name && !Number.isNaN(num)) map[name] = num;
      }
      const totalShots = map['totalShots'] ?? map['shots'] ?? 0;
      const shotsOnTarget = map['shotsOnTarget'] ?? map['onTarget'] ?? 0;
      const wonCorners = map['wonCorners'] ?? map['cornerKicks'] ?? map['corners'] ?? 0;
      const possessionPct = Math.round(map['possessionPct'] ?? map['possession'] ?? 0);
      const foulsCommitted = map['foulsCommitted'] ?? map['fouls'] ?? 0;
      const passPctRaw = map['passPct'] ?? map['passCompletionPct'] ?? map['passAccuracy'] ?? map['passCompletion'] ?? 0;
      const passPct = passPctRaw > 0 && passPctRaw <= 1 ? Math.round(passPctRaw * 100) : Math.round(passPctRaw);
      const hasAny = totalShots > 0 || shotsOnTarget > 0 || wonCorners > 0
        || possessionPct > 0 || foulsCommitted > 0 || passPct > 0;
      if (!hasAny) return null;
      return { totalShots, shotsOnTarget, wonCorners, possessionPct, foulsCommitted, passPct };
    };

    let homeMatchStats: EspnMatchStats | null = null;
    let awayMatchStats: EspnMatchStats | null = null;
    const boxscore = (data.boxscore as Record<string, unknown>) || {};
    const boxTeams = (boxscore.teams as unknown[] | undefined) ?? [];
    for (const bt of boxTeams) {
      const teamBox = bt as Record<string, unknown>;
      const team = (teamBox.team as Record<string, unknown>) || {};
      const tid = String(team.id || '');
      const homeAway = String(teamBox.homeAway || team.homeAway || '');
      const statistics = (teamBox.statistics as unknown[] | undefined) ?? [];
      const parsed = parseMatchStats(statistics);
      if (homeAway === 'home' || tid === homeTeamId) homeMatchStats = parsed;
      else if (homeAway === 'away' || tid === awayTeamId) awayMatchStats = parsed;
    }

    return {
      homeTeamId,
      awayTeamId,
      homeForm,
      awayForm,
      matchStats: { home: homeMatchStats, away: awayMatchStats },
      statusCode,
    };
  }

  /**
   * Fetch football (soccer) H2H history for an event.
   */
  async fetchFootballH2h(
    leagueCode: string,
    eventId: string,
  ): Promise<{
    h2h: { date: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }[];
    statusCode: number;
  }> {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/summary?event=${eventId}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    const statusCode = response.status;
    if (!response.ok) {
      throw new Error(
        `ESPN football H2H failed: ${statusCode} ${response.statusText} (league=${leagueCode}, event=${eventId})`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const seasonseries = (data.seasonseries as unknown[] | undefined) ?? [];
    const h2hItems: { date: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }[] = [];

    for (const ss of seasonseries) {
      const series = ss as Record<string, unknown>;
      const events = (series.events as unknown[] | undefined) ?? [];
      for (const ev of events) {
        const event = ev as Record<string, unknown>;
        const comps = (event.competitions as unknown[] | undefined) ?? [];
        if (comps.length === 0) continue;
        const comp = comps[0] as Record<string, unknown>;
        const competitors = (comp.competitors as unknown[] | undefined) ?? [];
        let homeTeam = '';
        let awayTeam = '';
        let homeScore = 0;
        let awayScore = 0;
        for (const c of competitors) {
          const competitor = c as Record<string, unknown>;
          const team = (competitor.team as Record<string, unknown>) || {};
          const name = String(team.displayName || team.name || '');
          const score = Number(competitor.score) || 0;
          const homeAway = String(competitor.homeAway || '');
          if (homeAway === 'home') {
            homeTeam = name;
            homeScore = score;
          } else {
            awayTeam = name;
            awayScore = score;
          }
        }
        if (homeTeam && awayTeam) {
          h2hItems.push({
            date: String(event.date || ''),
            homeTeam,
            awayTeam,
            homeScore,
            awayScore,
          });
        }
      }
    }

    return { h2h: h2hItems, statusCode };
  }

  /**
   * Fetch football (soccer) match summary: odds (pickcenter), injuries, news.
   *
   * @param eventId ESPN event id
   * @param leagueCode ESPN league code (e.g. "eng.1")
   * @returns Parsed summary data or null on any error
   */
  async fetchFootballSummary(
    eventId: string,
    leagueCode: string,
  ): Promise<EspnSummaryData | null> {
    return this.fetchSummary(`soccer/${leagueCode}`, eventId, true);
  }

  /**
   * Fetch basketball match summary: odds (pickcenter), injuries, news.
   *
   * @param eventId ESPN event id
   * @param leagueCode ESPN league code (e.g. "wnba", "nba")
   * @returns Parsed summary data or null on any error
   */
  async fetchBasketballSummary(
    eventId: string,
    leagueCode: string,
  ): Promise<EspnSummaryData | null> {
    return this.fetchSummary(`basketball/${leagueCode}`, eventId, false);
  }

  /**
   * Private: fetch ESPN summary endpoint and parse pickcenter / injuries / news.
   * Returns null on any failure (network, non-200, parse error).
   */
  private async fetchSummary(
    sportPath: string,
    eventId: string,
    hasDraw: boolean,
  ): Promise<EspnSummaryData | null> {
    try {
      const url: string =
        `https://site.web.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${eventId}`;

      const response: Response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://www.espn.com/',
          Accept: 'application/json',
        },
      });

      if (response.status !== 200) return null;

      let data: Record<string, unknown>;
      try {
        data = (await response.json()) as Record<string, unknown>;
      } catch {
        return null;
      }

      // --- pickcenter ---
      const pickcenterRaw: unknown[] =
        (data.pickcenter as unknown[] | undefined) ?? [];
      const pickcenter: EspnPickcenterOdds[] = [];
      for (const item of pickcenterRaw) {
        const odds = this.parsePickcenterItem(item, hasDraw);
        if (odds) pickcenter.push(odds);
      }

      // --- injuries ---
      const injuriesRaw: unknown[] =
        (data.injuries as unknown[] | undefined) ?? [];
      const teamInjuries: EspnTeamInjuries[] = [];
      for (const item of injuriesRaw) {
        const ti = this.parseInjuryTeam(item);
        if (ti) teamInjuries.push(ti);
      }
      const headerForInj = (data?.header as Record<string, unknown> | undefined) ?? {};
      const hCompForInj = ((headerForInj.competitions as unknown[] | undefined) ?? [])[0] as Record<string, unknown> | undefined;
      const hCompForInjItems = (hCompForInj?.competitors as unknown[] | undefined) ?? [];
      let homeTeamName = '';
      let awayTeamName = '';
      let homeTeamAbbr = '';
      let awayTeamAbbr = '';
      for (const c of hCompForInjItems) {
        const comp = c as Record<string, unknown>;
        const team = comp.team as Record<string, unknown> | undefined;
        const tName = String(team?.displayName ?? '');
        const tAbbr = String(team?.abbreviation ?? '');
        if (comp.homeAway === 'home') {
          homeTeamName = tName;
          homeTeamAbbr = tAbbr;
        } else {
          awayTeamName = tName;
          awayTeamAbbr = tAbbr;
        }
      }
      let homeInjuries: EspnInjuryItem[] = [];
      let awayInjuries: EspnInjuryItem[] = [];
      for (const ti of teamInjuries) {
        if (ti.teamName === homeTeamName || ti.teamAbbr === homeTeamAbbr) {
          homeInjuries = ti.injuries;
        } else if (ti.teamName === awayTeamName || ti.teamAbbr === awayTeamAbbr) {
          awayInjuries = ti.injuries;
        } else if (homeInjuries.length === 0) {
          homeInjuries = ti.injuries;
        } else {
          awayInjuries = ti.injuries;
        }
      }

      // --- news ---
      const newsRaw: unknown[] = (data.news as unknown[] | undefined) ?? [];
      const news: EspnNewsItem[] = [];
      for (const item of newsRaw.slice(0, 10)) {
        const n = this.parseNewsItem(item);
        if (n) news.push(n);
      }

      // --- team stats (from boxscore, basketball & soccer both may have) ---
      const homeTeamStats: Record<string, string> = {};
      const awayTeamStats: Record<string, string> = {};
      const header = (data?.header as Record<string, unknown> | undefined) ?? {};
      const hCompetitions = (header.competitions as unknown[] | undefined) ?? [];
      const hCompetition = hCompetitions[0] as Record<string, unknown> | undefined;
      const hCompetitors = (hCompetition?.competitors as unknown[] | undefined) ?? [];
      const hIds: { home: string; away: string } = { home: '', away: '' };
      for (const c of hCompetitors) {
        const comp = c as Record<string, unknown>;
        const team = comp.team as Record<string, unknown> | undefined;
        const tid = String(team?.id ?? '');
        if (comp.homeAway === 'home') hIds.home = tid;
        else hIds.away = tid;
      }
      const boxscore = (data?.boxscore as Record<string, unknown> | undefined) ?? {};
      const boxTeams = (boxscore.teams as unknown[] | undefined) ?? [];
      for (const bt of boxTeams) {
        const btRec = bt as Record<string, unknown>;
        const team = btRec.team as Record<string, unknown> | undefined;
        const teamId = team ? String(team.id ?? '') : '';
        const stats = (btRec.statistics as unknown[] | undefined) ?? [];
        const statMap: Record<string, string> = {};
        for (const s of stats) {
          const sRec = s as Record<string, unknown>;
          const name = String(sRec.name ?? '');
          const val = String(sRec.displayValue ?? '');
          if (name) statMap[name] = val;
        }
        if (teamId === hIds.home) Object.assign(homeTeamStats, statMap);
        else if (teamId === hIds.away) Object.assign(awayTeamStats, statMap);
      }

      return {
        eventId,
        pickcenter,
        homeInjuries,
        awayInjuries,
        news,
        homeTeamStats,
        awayTeamStats,
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  /** Parse a single pickcenter entry into EspnPickcenterOdds. */
  private parsePickcenterItem(
    raw: unknown,
    hasDraw: boolean,
  ): EspnPickcenterOdds | null {
    const item = raw as Record<string, unknown> | undefined;
    if (!item) return null;

    const providerObj = item.provider as Record<string, unknown> | undefined;
    const provider: string = (providerObj?.name as string) || '';
    const details: string = (item.details as string) || '';

    const spreadRaw = item.spread;
    const spread: number | null =
      typeof spreadRaw === 'number' ? spreadRaw : null;

    const overUnderRaw = item.overUnder;
    const overUnder: number | null =
      typeof overUnderRaw === 'number' ? overUnderRaw : null;

    const overOddsRaw = item.overOdds;
    const overOdds: number | null =
      typeof overOddsRaw === 'number' ? overOddsRaw : null;

    const underOddsRaw = item.underOdds;
    const underOdds: number | null =
      typeof underOddsRaw === 'number' ? underOddsRaw : null;

    const homeTeamOdds = item.homeTeamOdds as Record<string, unknown> | undefined;
    const awayTeamOdds = item.awayTeamOdds as Record<string, unknown> | undefined;

    const homeMoneyLine: number | null =
      typeof homeTeamOdds?.moneyLine === 'number'
        ? homeTeamOdds.moneyLine
        : null;
    const awayMoneyLine: number | null =
      typeof awayTeamOdds?.moneyLine === 'number'
        ? awayTeamOdds.moneyLine
        : null;
    const homeSpreadOdds: number | null =
      typeof homeTeamOdds?.spreadOdds === 'number'
        ? homeTeamOdds.spreadOdds
        : null;
    const awaySpreadOdds: number | null =
      typeof awayTeamOdds?.spreadOdds === 'number'
        ? awayTeamOdds.spreadOdds
        : null;
    const homeFavorite: boolean = homeTeamOdds?.favorite === true;
    const homeFavoriteAtOpen: boolean =
      homeTeamOdds?.favoriteAtOpen === true;

    let drawMoneyLine: number | null = null;
    if (hasDraw) {
      const drawOdds = item.drawOdds as Record<string, unknown> | undefined;
      drawMoneyLine =
        typeof drawOdds?.moneyLine === 'number' ? drawOdds.moneyLine : null;
    }

    return {
      provider,
      details,
      spread,
      overUnder,
      overOdds,
      underOdds,
      homeMoneyLine,
      awayMoneyLine,
      drawMoneyLine,
      homeSpreadOdds,
      awaySpreadOdds,
      homeFavorite,
      homeFavoriteAtOpen,
    };
  }

  /** Parse a single team injury entry from the injuries array. */
  private parseInjuryTeam(raw: unknown): EspnTeamInjuries | null {
    const item = raw as Record<string, unknown> | undefined;
    if (!item) return null;

    const teamObj = item.team as Record<string, unknown> | undefined;
    const teamName: string = (teamObj?.displayName as string) || '';
    const teamAbbr: string = (teamObj?.abbreviation as string) || '';

    const injuriesRaw: unknown[] =
      (item.injuries as unknown[] | undefined) ?? [];
    const injuries: EspnInjuryItem[] = [];
    for (const inj of injuriesRaw) {
      const parsed = this.parseInjuryItem(inj);
      if (parsed) injuries.push(parsed);
    }

    return { teamName, teamAbbr, injuries };
  }

  /** Parse a single athlete injury record. */
  private parseInjuryItem(raw: unknown): EspnInjuryItem | null {
    const item = raw as Record<string, unknown> | undefined;
    if (!item) return null;

    const athlete = item.athlete as Record<string, unknown> | undefined;
    const athleteName: string = (athlete?.displayName as string) || '';
    if (!athleteName) return null;

    const status: string = (item.status as string) || '';
    const dateRaw = item.date;
    const date: string | null =
      typeof dateRaw === 'string' && dateRaw ? dateRaw : null;

    const typeObj = item.type as Record<string, unknown> | undefined;
    const type: string | null =
      ((typeObj?.description as string) ||
        (typeObj?.name as string) ||
        null);

    return { athleteName, status, date, type };
  }

  /** Parse a single news item. */
  private parseNewsItem(raw: unknown): EspnNewsItem | null {
    const item = raw as Record<string, unknown> | undefined;
    if (!item) return null;

    const id: string = (item.id as string) || '';
    const headline: string = (item.headline as string) || '';
    if (!id && !headline) return null;

    const descRaw = item.description;
    const description: string | null =
      typeof descRaw === 'string' && descRaw ? descRaw : null;

    const lastModRaw = item.lastModified;
    const lastModified: string | null =
      typeof lastModRaw === 'string' && lastModRaw ? lastModRaw : null;

    const typeRaw = item.type;
    const type: string | null =
      typeof typeRaw === 'string' && typeRaw ? typeRaw : null;

    return { id, headline, description, lastModified, type };
  }

  /**
   * Fetch a single basketball match status + final score from the ESPN
   * summary endpoint. Used as a backstop for matches whose kickoff time has
   * passed but the scoreboard sweep still shows them as upcoming (e.g. WNBA
   * Finals series games that fall outside the scoreboard date window).
   *
   * Returns null on network / parse / non-200 errors so the caller can
   * decide how to degrade (warn only, never block the pipeline).
   */
  async fetchBasketballMatchStatus(
    league: string,
    eventId: string,
  ): Promise<{
    status: 'pre' | 'in' | 'post';
    statusText: string;
    homeScore: number | null;
    awayScore: number | null;
    homeTeamEn: string;
    awayTeamEn: string;
  } | null> {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/summary?event=${eventId}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
      });

      if (!response.ok) return null;

      const data = (await response.json()) as Record<string, unknown>;
      const header = (data?.header as Record<string, unknown> | undefined) ?? {};
      const competitions = (header.competitions as unknown[] | undefined) ?? [];
      const competition = competitions[0] as Record<string, unknown> | undefined;
      if (!competition || !competition.competitors) return null;

      const competitors = competition.competitors as EspnCompetitor[];
      const home = competitors.find((c: EspnCompetitor) => c.homeAway === 'home');
      const away = competitors.find((c: EspnCompetitor) => c.homeAway === 'away');
      if (!home || !away) return null;

      const status = competition.status as Record<string, unknown> | undefined;
      const statusType = status?.type as Record<string, unknown> | undefined;
      const state: string = String(statusType?.state ?? '');
      const statusText: string =
        String(statusType?.description ?? statusType?.shortDetail ?? '');

      return {
        status: mapStatusState(state),
        statusText,
        homeScore: parseScore(home.score),
        awayScore: parseScore(away.score),
        homeTeamEn: extractTeamName(home),
        awayTeamEn: extractTeamName(away),
      };
    } catch {
      return null;
    }
  }
}
