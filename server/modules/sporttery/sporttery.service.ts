import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { count, eq, and, or, sql, gte, lt, lte, inArray, isNotNull, isNull, gt, ne, asc, not, ilike } from 'drizzle-orm';
import { matches, basketballMatches, appSettings, oddsSnapshots, basketballOddsSnapshots, injuryReports, teamSeasonStats } from '@server/database/schema';
import {
  insertFootballOddsSnapshotIfChanged,
  insertBasketballOddsSnapshotIfChanged,
} from '@server/common/odds-snapshots';
 import type {
    SyncHealthDto,
    SyncTriggerResult,
    SyncConfig,
    SportteryExternalPayload,
    BeidanMatch,
    BeidanSyncResult,
    IngestFootballItem,
    IngestBasketballItem,
    IngestBeidanItem,
    IngestResult,
  } from './sporttery.types';
import {
  EspnSource,
  ESPN_FOOTBALL_LEAGUES,
  ESPN_BASKETBALL_LEAGUES,
} from './sources/espn-source';
import { QiumibaoSource } from './sources/qiumibao-source';
import { NblOfficialSource } from './sources/nbl-official-source';
import type {
  QiumibaoBasketballMatch,
  QiumibaoFootballMatch,
} from './sources/qiumibao-source';
import type {
  ESPNFootballMatch,
  ESPNBasketballMatch,
  EspnSummaryData,
} from './sources/espn-source';
import { TheOddsSource } from './sources/the-odds-source';
import { FootballDataSource } from './sources/football-data-source';
import type { FootballDataMatch } from './sources/football-data-source';
import { TheRundownSource } from './sources/the-rundown-source';
import type { TheRundownOddsData } from './sources/the-rundown-source';
import { TheSportsDbSource } from './sources/thesportsdb-source';
import { ApiSportsSource } from './sources/api-sports-source';
import type {
  ApiSportsFootballFixture,
  ApiSportsBasketballGame,
} from './sources/api-sports-source';
import { InjurySource, type InjuryRecord } from './sources/injury-source';
import { NBA_TEAM_NAME_MAP, WNBA_TEAM_NAME_MAP } from './sources/team-name-map';
import { EuroLeagueInjurySource, isEuroLeagueMatch } from './sources/euroleague-source';
import { FootballPoissonService } from './football-poisson.service';
import { EloService } from '../elo/elo.service';
import { EloHistoryService } from '../elo/elo-history.service';
import { XgProxyService } from '../xg/xg-proxy.service';
import { MlEnsembleService } from '../ml-ensemble/ml-ensemble.service';
import {
  FeatureEngineeringService,
  type FootballFeatureInput,
} from '../ml-ensemble/feature-engineering.service';
import { GbdtService } from '../ml-ensemble/gbdt.service';
import { BasketballAnchorPredictionService } from '../basketball/basketball-anchor-prediction.service';
import { BasketballIntelService, type IntelData, parseIntelFromRow, countCoreInjuriesFromIntel } from '../basketball/basketball-intel.service';
import {
  shouldSkipPredictionWrite,
  stripPredictionFieldsFromPatch,
  buildLineMovementPatch,
  buildInitialOddsMovements,
  shouldRecalcHandicapByLine,
  shouldRecalcTotalByLine,
  isDataDrivenEngine,
  isProtectedPredictionEngine,
  extractOpenLineFromMovements,
} from '@server/common/utils/basketball-prediction-guard';
import { BasketballDataDrivenPredictionService } from '../basketball-prediction/basketball-data-driven.service';
import { FootballDataOrgSource, FDO_DEFAULT_COMPETITIONS } from './sources/football-data-org-source';
import { serverSecrets, isBeidanEnabled } from '@server/config/secrets.config';
import type { OddsData } from './sources/the-odds-source';
import {
  isFootballTeamMapped,
  isBasketballTeamMapped,
  mapFootballTeam,
  mapBasketballTeam,
  normalizeBasketballTeamName,
} from './team-mappings';

// --- Constants ---

const FOOTBALL_MODEL_VERSION = 'football-v12.0-unified';

// --- Helpers ---

function isWithinBeijingT0T1(kickoff: Date, now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr: string = fmt.format(now);
  const today: Date = new Date(`${todayStr}T00:00:00+08:00`);
  const dayAfterTomorrow: Date = new Date(`${todayStr}T00:00:00+08:00`);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
  return kickoff.getTime() >= today.getTime() && kickoff.getTime() < dayAfterTomorrow.getTime();
}

const TEAM_NAME_ALIASES: Record<string, string> = {
  达拉斯飞翼: '达拉斯Wings',
  达拉斯飞马: '达拉斯Wings',
  凤凰城水星: '菲尼克斯水星',
  菲尼克斯水星: '菲尼克斯水星',
  凤凰城太阳: '菲尼克斯太阳',
  菲尼克斯太阳: '菲尼克斯太阳',
  南安普敦: 'Southampton',
  曼彻斯特城: 'Manchester City',
  曼彻斯特联: '曼联',
  托特纳姆热刺: '热刺',
  纽卡斯尔联: '纽卡斯尔',
  莱斯特城: '莱切斯特城',
  伊普斯维奇: '伊普斯威奇',
  维戈塞尔塔: 'Celta Vigo',
  皇家贝蒂斯: 'Real Betis',
  巴伦西亚: 'Valencia',
  毕尔巴鄂竞技: '毕尔巴鄂',
  门兴格拉德巴赫: "Borussia M'gladbach",
  莱比锡红牛: 'RB莱比锡',
  国际米兰: '国米',
  尤文图斯: 'Juventus',
  名古屋鲸八: 'Nagoya Grampus',
  '利物浦': 'Liverpool',
  '埃弗顿': 'Everton',
  '水晶宫': 'Crystal Palace',
  '诺丁汉森林': 'Nottingham Forest',
  '赫尔城': 'Hull City',
  '朴次茅斯': 'Portsmouth',
  '埃尔切': 'Elche',
  '奥萨苏纳': 'Osasuna',
  '拉科鲁尼亚': 'Deportivo La Coruna',
  '桑坦德竞技': 'Racing Santander',
  '皇家社会': 'Real Sociedad',
  'AC米兰': 'AC Milan',
  '博洛尼亚': 'Bologna',
  '卡利亚里': 'Cagliari',
  '拉齐奥': 'Lazio',
  '科莫': 'Como',
  '罗马': 'Roma',
  '莱切': 'Lecce',
  '萨索洛': 'Sassuolo',
  '蒙扎': 'Monza',
  '弗赖堡': 'Freiburg',
  '沙尔克04': 'Schalke 04',
  '科隆': 'FC Cologne',
  '尼斯': 'Nice',
  '斯特拉斯堡': 'Strasbourg',
  '特鲁瓦': 'Troyes',
  '马赛': 'Marseille',
  '乌德勒支': 'Utrecht',
  '兹沃勒': 'Zwolle',
  '坎布尔': 'Cambuur',
  '威廉二世': 'Willem II',
  '吉马良斯': 'Guimaraes',
  '本菲卡': 'Benfica',
  '利勒斯特罗姆': 'Lillestrom',
  '特罗姆瑟': 'Tromso',
  '腓特烈斯塔': 'Fredrikstad',
  '莫尔德': 'Molde',
  '桑托斯': 'Santos',
  '米内罗竞技': 'Atletico Mineiro',
  '圣路易斯城': 'St. Louis City',
  '洛杉矶银河': 'LA Galaxy',
  '川崎前锋': 'Kawasaki Frontale',
  '磐城FC': 'Iwaki FC',
  '秋田蓝色闪电': 'Blaublitz Akita',
  '光州FC': 'Gwangju',
  '蔚山现代': 'Ulsan HD',
  '国际图尔库': 'Inter Turku',
  '库奥皮奥': 'KuPS',
  '拉科': 'Deportivo La Coruna',
  '弗洛西诺': 'Frosinone',
  '弗洛西诺内': 'Frosinone',
  '布鲁马波': 'Brommapojkarna',
  '布鲁马波卡纳': 'Brommapojkarna',
  'IF Brommapojkarna': 'Brommapojkarna',
  '哈特堡格': 'Hartberg',
  'TSV Hartberg': 'Hartberg',
  '兰讷斯': 'Randers',
  '兰德斯': 'Randers',
  '利勒斯特': 'Lillestrom',
  '萨迪纳摩': 'Dinamo Zagreb',
  '萨格勒布迪纳摩': 'Dinamo Zagreb',
  'GNK Dinamo Zagreb': 'Dinamo Zagreb',
  '圣吉联合': 'Union SG',
  '圣吉罗斯联合': 'Union SG',
  'Royale Union Saint-Gilloise': 'Union SG',
  '安德莱赫': 'Anderlecht',
  '安德莱赫特': 'Anderlecht',
  'RSC Anderlecht': 'Anderlecht',
  '格风暴': 'Sturm Graz',
  '格拉茨风暴': 'Sturm Graz',
  'SK Sturm Graz': 'Sturm Graz',
  '波兹莱赫': 'Lech Poznan',
  '波兹南莱赫': 'Lech Poznan',
  '比亚韦': 'Jagiellonia Bialystok',
  '比亚韦斯托克': 'Jagiellonia Bialystok',
  'Jagiellonia': 'Jagiellonia Bialystok',
  '杜连斯': 'Torino',
  '都灵': 'Torino',
  'FC Torino': 'Torino',
  '布斯巴达': 'Sparta Prague',
  '布拉格斯巴达': 'Sparta Prague',
  'AC Sparta Prague': 'Sparta Prague',
  '索列夫': 'Levski Sofia',
  '索非亚列夫斯基': 'Levski Sofia',
  '奈梅亨': 'NEC Nijmegen',
  'NEC奈梅亨': 'NEC Nijmegen',
  '亚拉腊': 'Ararat-Armenia',
  '阿拉拉特': 'Ararat-Armenia',
  'FC Ararat-Armenia': 'Ararat-Armenia',
  '波兹南': 'Lech Poznan',
  '萨尔茨堡': 'RB Salzburg',
  '萨尔茨堡红牛': 'RB Salzburg',
  'FC Red Bull Salzburg': 'RB Salzburg',
  '勒沃库森': 'Bayer Leverkusen',
  '拜耳勒沃库森': 'Bayer Leverkusen',
  '伯恩茅斯': 'Bournemouth',
  'AFC Bournemouth': 'Bournemouth',
  '里昂': 'Lyon',
  'Olympique Lyonnais': 'Lyon',
  '桑德兰': 'Sunderland',
  'AFC Sunderland': 'Sunderland',
  '米兰': 'AC Milan',
  '塞尔塔': 'Celta Vigo',
  'RC Celta': 'Celta Vigo',
};

function parseFootballHandicapLine(text: string | null | undefined): number {
  if (text == null) return NaN;
  const t = String(text).trim();
  if (t === '') return NaN;
  const num = Number(t);
  if (!Number.isNaN(num)) return num;
  let negative = false;
  let raw = t;
  if (raw.startsWith('受让') || raw.startsWith('客让') || raw.startsWith('-')) {
    negative = true;
    raw = raw.replace(/^[\-受让客让]+/, '');
  } else if (raw.startsWith('让') || raw.startsWith('主让') || raw.startsWith('+')) {
    raw = raw.replace(/^[\+让主让]+/, '');
  }
  const asianMap: Record<string, number> = {
    '平手': 0,
    '平半': 0.25,
    '平手半球': 0.25,
    '半球': 0.5,
    '半一': 0.75,
    '半球一球': 0.75,
    '一球': 1,
    '一球球半': 1.25,
    '一球球半两球': 1.5,
    '球半': 1.5,
    '球半两球': 1.75,
    '两球': 2,
    '两球两球半': 2.25,
    '两球半': 2.5,
    '两球半三球': 2.75,
    '三球': 3,
  };
  const cnNumMap: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  };
  if (asianMap[raw] !== undefined) {
    return negative ? -asianMap[raw] : asianMap[raw];
  }
  const slashMatch = raw.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    return negative ? -((a + b) / 2) : (a + b) / 2;
  }
  return NaN;
}

function parseFootballTotalLine(text: string | null | undefined): number {
  if (text == null) return NaN;
  const t = String(text).trim();
  if (t === '') return NaN;
  const num = Number(t);
  if (!Number.isNaN(num)) return num;
  return NaN;
}

function normalizeTeamName(name: string): string {
  const alias = TEAM_NAME_ALIASES[name.trim()];
  const base = alias ?? name;
  return base
    .toLowerCase()
    .replace(/[\s\-._·]/g, '')
    .replace(/\bfc\b|\bafc\b|\bsc\b|\bcf\b|\bifk\b|\bff\b|\bbk\b|\bsk\b/gi, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

function getBeijingDateStr(utcDate: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(utcDate);
}

function getNextDateStr(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function americanToDecimal(american: number | null | undefined): string | null {
  if (american === null || american === undefined || !Number.isFinite(american)) return null;

  if (american > 0) {
    return (1 + american / 100).toFixed(2);
  }
  return (1 - 100 / american).toFixed(2);
}

const WEEKDAY_MAP: Record<string, number> = {
  周日: 0,
  周一: 1,
  周二: 2,
  周三: 3,
  周四: 4,
  周五: 5,
  周六: 6,
};

const WEEKDAY_PREFIX = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function getWeekdayPrefix(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return '';
  return WEEKDAY_PREFIX[d.getDay()] || '';
}

function computeBusinessDateFromMatchNo(matchNo: string, matchDateStr: string): string {
  const prefix = matchNo.match(/^(周[一二三四五六日])/)?.[1];
  if (!prefix) return matchDateStr;
  const targetWeekday = WEEKDAY_MAP[prefix];
  if (targetWeekday === undefined) return matchDateStr;
  const matchDate = new Date(`${matchDateStr}T12:00:00+08:00`);
  if (Number.isNaN(matchDate.getTime())) return matchDateStr;
  const matchWeekday = matchDate.getDay();
  let diff = targetWeekday - matchWeekday;
  if (diff > 3) diff -= 7;
  if (diff < -3) diff += 7;
  const businessDate = new Date(matchDate);
  businessDate.setDate(matchDate.getDate() + diff);
  return businessDate.toISOString().slice(0, 10);
}

// --- Internal types for sporttery API response ---

interface SportteryHadOdds {
  h: string | number;
  d: string | number;
  a: string | number;
  updateDate?: string;
  updateTime?: string;
}

interface SportteryHhadOdds {
  h: string | number;
  d: string | number;
  a: string | number;
  goalLine: string | number;
  goalLineValue: number;
  updateDate?: string;
  updateTime?: string;
}

interface SportteryTtgOdds {
  totalGoal?: string;
  [key: string]: unknown;
}

interface SportterySubMatch {
  matchId: number;
  matchNum: number;
  matchStatus: string;
  matchDate: string;
  matchTime: string;
  businessDate?: string;
  leagueId?: string;
  leagueAllName?: string;
  leagueAbbName?: string;
  leagueCode?: string;
  homeTeamAllName: string;
  awayTeamAllName: string;
  homeTeamId?: string;
  awayTeamId?: string;
  had?: SportteryHadOdds;
  hhad?: SportteryHhadOdds;
  ttg?: SportteryTtgOdds;
  [key: string]: unknown;
}

interface SportteryMatchInfo {
  matchDate?: string;
  businessDate?: string;
  subMatchList?: SportterySubMatch[];
}

interface SportteryResponseValue {
  matchInfoList?: SportteryMatchInfo[];
  totalCount?: number;
  lastUpdateTime?: string;
  [key: string]: unknown;
}

interface SportteryFootballResponse {
  success?: boolean;
  emptyFlag?: boolean;
  matchInfoList?: SportteryMatchInfo[];
  value?: SportteryResponseValue;
  [key: string]: unknown;
}

interface SportteryBasketballResponse {
  success?: boolean;
  emptyFlag?: boolean;
  matchInfoList?: SportteryMatchInfo[];
  value?: SportteryResponseValue;
  [key: string]: unknown;
}

// --- Normalized internal match shape ---

interface NormalizedFootballMatch {
  matchNo: string;
  matchDate: string;
  businessDate: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  matchStatus: string;
  oddsOpenHome: string;
  oddsOpenDraw: string;
  oddsOpenAway: string;
  handicap: string;
  handicapRecommendation: string;
  handicapOddsHome: string;
  handicapOddsDraw: string;
  handicapOddsAway: string;
  overUnder: string;
  totalGoals: string;
  totalOddsOver: string;
  totalOddsUnder: string;
  isPresale?: boolean;
  sourceMatchId?: string;
  source?: 'sporttery' | 'sporttery-pending' | 'qiumibao' | 'espn' | 'thesportsdb';
}

interface NormalizedBasketballMatch {
  sourceMatchId?: string;
  matchNo: string;
  matchDate: string;
  businessDate: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  matchStatus: string;
  handicap: string;
  handicapHf: string;
  handicapAf: string;
  totalLine: string;
  homeWinOdds: string;
  awayWinOdds: string;
  handicapOddsHome: string;
  handicapOddsAway: string;
  totalOddsOver: string;
  totalOddsUnder: string;
  source?: 'sporttery' | 'sporttery-pending' | 'qiumibao' | 'espn' | 'thesportsdb';
  isPendingSale?: boolean;
}

const FOOTBALL_SCHEDULE_URL =
  'https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=hhad,had,ttg&channel=c';
const BASKETBALL_SCHEDULE_URL =
  'https://webapi.sporttery.cn/gateway/jc/basketball/getMatchCalculatorV1.qry?poolCode=sfc,hdc,hilo&channel=c';

const SPORTTERY_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.sporttery.cn/',
  Origin: 'https://www.sporttery.cn',
};
const SPORTTERY_BASKETBALL_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.sporttery.cn/jc/lqszsc/index.html',
  Origin: 'https://www.sporttery.cn',
};
const SPORTTERY_TIMEOUT_MS = 10000;
const SPORTTERY_MAX_RETRIES = 2;

const SCHEDULE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (adaptive: nighttime skips)
const BEIDAN_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const ESPN_ADAPTIVE_INTERVAL_MS = 60 * 1000; // adaptive check every 60s
const ODDS_API_POLL_INTERVAL_MS = 15 * 60 * 1000; // poll every 15 minutes (adaptive inside)

type EspnRhythm = 'live' | 'upcoming' | 'idle';
type OddsApiRhythm = 'pre-match' | 'daily' | 'idle';
type DirectStatus = 'auto' | 'degraded' | 'failed' | 'blocked';

// ESPN rhythm -> minimum interval between full runs
const ESPN_LIVE_INTERVAL_MS = 30 * 1000;
const ESPN_UPCOMING_INTERVAL_MS = 10 * 60 * 1000;
const ESPN_IDLE_INTERVAL_MS = 30 * 60 * 1000;

// Qiumibao rhythm -> minimum interval
const QIUMIBAO_ADAPTIVE_INTERVAL_MS = 45 * 1000; // check every 45s
const QIUMIBAO_LIVE_INTERVAL_MS = 30 * 1000;
const QIUMIBAO_UPCOMING_INTERVAL_MS = 90 * 1000;
const QIUMIBAO_IDLE_INTERVAL_MS = 30 * 60 * 1000;
const QIUMIBAO_FINAL_AUTHORITATIVE_TIMEOUT_MS = 120 * 60 * 1000; // 2 hours: qiumibao post + no ESPN confirmation → authoritative fallback

// Multi-source odds: ESPN summary pre-match refresh interval (20-30min)
const ESPN_SUMMARY_PRE_MATCH_INTERVAL_MS = 25 * 60 * 1000;
const ESPN_SUMMARY_DAILY_INTERVAL_MS = 6 * 60 * 60 * 1000;
// football-data.co.uk daily sync
const FOOTBALL_DATA_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;
// TheRundown sync interval
const THERUNDOWN_PRE_MATCH_INTERVAL_MS = 20 * 60 * 1000;
// Original Odds API rhythm intervals (kept for legacy The Odds API)
const ODDS_PRE_MATCH_INTERVAL_MS = 15 * 60 * 1000;
const ODDS_DAILY_INTERVAL_MS = 60 * 60 * 1000;
const ODDS_IDLE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TSDB_SYNC_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
const APISPORTS_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes (fallback source)

// Quota constants (free tier estimate: 500 requests/month ≈ 16/day)
const ODDS_API_MONTHLY_QUOTA_ESTIMATE = 500;
const ODDS_API_QUOTA_THRESHOLD_RATIO = 0.2; // <20% remaining triggers throttle
const ODDS_API_DAILY_QUOTA_ESTIMATE = Math.floor(
  ODDS_API_MONTHLY_QUOTA_ESTIMATE / 30,
);
const ODDS_API_QUOTA_LOW_RATIO = 0.5; // remaining/day < daily * 0.5 → throttle

type SyncCategory = 'football' | 'basketball' | 'score';

interface SyncStatusEntry {
  statusCode: number;
  success: boolean;
  message?: string;
  inserted?: number;
  updated?: number;
  skipped?: number;
}

function findSameMatchByTeams(
  rows: {
    id: string;
    matchStatus: string;
    homeTeam: string;
    awayTeam: string;
    kickoffTime: Date | string;
    source?: string;
  }[],
  home: string,
  away: string,
  kickoff: Date,
  windowHours: number = 6,
): { id: string; matchStatus: string } | null {
  const homeNorm: string = normalizeTeamName(home);
  const awayNorm: string = normalizeTeamName(away);
  const windowMs: number = windowHours * 3600 * 1000;
  let bestMatch: { id: string; matchStatus: string } | null = null;
  for (const row of rows) {
    const rowHomeNorm: string = normalizeTeamName(row.homeTeam);
    const rowAwayNorm: string = normalizeTeamName(row.awayTeam);
    const rowKickoff: number = new Date(row.kickoffTime).getTime();
    if (Math.abs(rowKickoff - kickoff.getTime()) > windowMs) continue;
    if (rowHomeNorm === homeNorm && rowAwayNorm === awayNorm) {
      if (!bestMatch || row.source === 'sporttery') {
        bestMatch = { id: row.id, matchStatus: row.matchStatus };
        if (row.source === 'sporttery') break;
      }
    }
    if (rowHomeNorm === awayNorm && rowAwayNorm === homeNorm) {
      if (!bestMatch || row.source === 'sporttery') {
        bestMatch = { id: row.id, matchStatus: row.matchStatus };
        if (row.source === 'sporttery') break;
      }
    }
  }
  return bestMatch;
}

@Injectable()
export class SportteryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SportteryService.name);
  private readonly anchorPrediction: BasketballAnchorPredictionService;
  private readonly dataDrivenService: BasketballDataDrivenPredictionService;
  private readonly intelService: BasketballIntelService = new BasketballIntelService();
  private readonly footballPoissonService: FootballPoissonService = new FootballPoissonService();
  private readonly eloService: EloService;
  private readonly eloHistoryService: EloHistoryService;
  private readonly xgProxyService: XgProxyService;
  private readonly mlEnsembleService: MlEnsembleService;
  private readonly featureEngineeringService: FeatureEngineeringService;
  private readonly gbdtService: GbdtService;
  private _perfCache: { timestamp: number; data: { footballListP50Ms: number; footballListP95Ms: number; basketballListP50Ms: number; basketballListP95Ms: number } } | null = null;

  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private espnLiveTimer: ReturnType<typeof setInterval> | null = null;
  private qiumibaoLiveTimer: ReturnType<typeof setTimeout> | null = null;
  private oddsApiTimer: ReturnType<typeof setInterval> | null = null;

  private _isSchedulerRunning = false;

  // --- Deep backfill async state + dedupe lock ---
  private _deepBackfillRunning = false;
  private _deepBackfillResult: {
    status: 'idle' | 'running' | 'done' | 'error';
    startedAt: Date | null;
    finishedAt: Date | null;
    footballChecked: number;
    footballUpdated: number;
    footballErrors: number;
    basketballChecked: number;
    basketballUpdated: number;
    basketballErrors: number;
    errorMessage?: string;
  } = {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    footballChecked: 0,
    footballUpdated: 0,
    footballErrors: 0,
    basketballChecked: 0,
    basketballUpdated: 0,
    basketballErrors: 0,
  };

  // --- ESPN sync state ---

  private espnFootballLastSync: Date | null = null;
  private espnFootballSuccess = false;
  private espnFootballLeaguesSynced = 0;
  private espnFootballPendingMappings: Set<string> = new Set();
  private espnFootballLeagueStats: Record<string, { success: boolean; matchCount: number; rawEventCount: number; error?: string }> = {};
  private espnFbRhythm: EspnRhythm = 'idle';
  private espnFbLastFullRun: Date | null = null;

  private espnBasketballLastSync: Date | null = null;
  private espnBasketballSuccess = false;
  private espnBasketballLeaguesSynced = 0;
  private espnBasketballPendingMappings: Set<string> = new Set();
  private espnBasketballLeagueStats: Record<string, { success: boolean; matchCount: number; rawEventCount: number; error?: string }> = {};
  private espnBbRhythm: EspnRhythm = 'idle';
  private espnBbLastFullRun: Date | null = null;

  private espnFbScoreUpdateResult: {
    inserted: number;
    updated: number;
    skipped: number;
    conflictCount: number;
    finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }>;
    liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }>;
    upcomingMatches: number;
    unmappedTeams: string[];
  } | null = null;

  private lastEspnFootballMatches: ESPNFootballMatch[] = [];

  private espnBbScoreUpdateResult: {
    inserted: number;
    updated: number;
    skipped: number;
    conflictCount: number;
    finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }>;
    liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }>;
    upcomingMatches: number;
    unmappedTeams: string[];
  } | null = null;

  // --- The Odds API sync state ---

  private oddsApiLastSync: Date | null = null;
  private oddsApiSuccess = false;
  private oddsApiSportsSynced = 0;
  private oddsApiRemaining: number | null = null;
  private oddsApiUsed: number | null = null;
  private oddsApiStatusCode: number | null = null;
  private oddsApiStatusMessage: string = '';
  private oddsApiQuotaThrottled = false;
  private oddsApiRhythm: OddsApiRhythm = 'idle';
  private oddsApiLastActualRun: Date | null = null;

  // --- TheSportsDB sync state ---

  private theSportsDbLastSync: Date | null = null;
  private theSportsDbSuccess = false;
  private theSportsDbTodayCount = 0;
  private theSportsDbFetchedCount = 0;
  private theSportsDbFootballCount = 0;
  private theSportsDbBasketballCount = 0;
  private theSportsDbLastError: string | null = null;
  private theSportsDbRhythm: 'daily' | 'idle' = 'idle';
  private theSportsDbTimer: ReturnType<typeof setInterval> | null = null;
  private theSportsDbFailStreak = 0;

  // --- api-sports sync state ---

  private apiSportsLastSync: Date | null = null;
  private apiSportsSuccess = false;
  private apiSportsTodayCount = 0;
  private apiSportsFootballCount = 0;
  private apiSportsBasketballCount = 0;
  private apiSportsLastError: string | null = null;
  private apiSportsTimer: ReturnType<typeof setInterval> | null = null;

  // --- injury sync state ---

  private injuryLastSync: Date | null = null;
  private injurySuccess = false;
  private injuryTeamCount = 0;
  private injuryPlayerCount = 0;
  private injuryTimer: NodeJS.Timeout | null = null;

  // --- football-data.org sync state ---

  private fdoLastSync: Date | null = null;
  private fdoSuccess = false;
  private fdoUpdated = 0;
  private fdoTodayCount = 0;
  private fdoTimer: NodeJS.Timeout | null = null;

  // --- Sporttery direct sync status ---

  private sportteryDirectStatus: DirectStatus = 'auto';
  private sportteryDirectFailStreak = 0;
  private sportteryDirectLastError: string | null = null;

  // --- External push sync state ---

  private sportteryExternalLastSync: Date | null = null;
  private sportteryExternalSuccess = false;
  private sportteryExternalLastError: string | null = null;

  // --- Today sync counts ---

  private espnFbTodayCount = 0;
  private espnBbTodayCount = 0;
  private oddsApiTodayCount = 0;
  private externalTodayCount = 0;
  private beidanLastSync: Date | null = null;
  private beidanSuccess = false;
  private beidanTodayCount = 0;
  private lastCountResetDate = '';

  // --- Multi-source odds sync state ---

  private espnSummaryLastSync: Date | null = null;
  private espnSummarySuccess = false;
  private espnSummaryUpdated = 0;
  private espnSummaryTodayCount = 0;

  private footballDataLastSync: Date | null = null;
  private footballDataSuccess = false;
  private footballDataUpdated = 0;
  private footballDataTodayCount = 0;

  private theRundownLastSync: Date | null = null;
  private theRundownSuccess = false;
  private theRundownUpdated = 0;
  private theRundownTodayCount = 0;

  private espnSummaryTimer: NodeJS.Timeout | null = null;
  private footballDataTimer: NodeJS.Timeout | null = null;
  private theRundownTimer: NodeJS.Timeout | null = null;
  private beidanTimer: NodeJS.Timeout | null = null;

  // --- Source instances ---

  private readonly espnSource: EspnSource;
  private readonly qiumibaoSource: QiumibaoSource;
  private readonly nblOfficialSource: NblOfficialSource;
  private readonly oddsSource: TheOddsSource;
  private readonly footballDataSource: FootballDataSource;
  private readonly theRundownSource: TheRundownSource;
  private readonly tsdbSource: TheSportsDbSource;
  private readonly apiSportsSource: ApiSportsSource;
  private readonly injurySource: InjurySource;
  private readonly fdoSource: FootballDataOrgSource;
  private readonly euroleagueInjurySource = new EuroLeagueInjurySource();

  private lastSyncAt: Record<SyncCategory, Date | null> = {
    football: null,
    basketball: null,
    score: null,
  };

  private lastSyncStatus: Record<SyncCategory, SyncStatusEntry | null> = {
    football: null,
    basketball: null,
    score: null,
  };

  private staleCount = 0;

  private espnBbLazySyncInProgress = false;
  private espnFbLazySyncInProgress = false;
  private qiumibaoLazySyncInProgress = false;

  // --- Deep data caches (ESPN) ---
  // Team stats cache: key = sport:league:teamId, value = { data, fetchedAt }
  private readonly bbTeamStatsCache = new Map<string, { data: Record<string, string>; fetchedAt: number }>();
  private readonly fbTeamStatsCache = new Map<string, { data: Record<string, string>; fetchedAt: number }>();
  // H2H / form cache: key = eventId, value = { data, fetchedAt }
  private readonly bbDeepCache = new Map<string, { data: unknown; fetchedAt: number }>();
  private readonly fbDeepCache = new Map<string, { data: unknown; fetchedAt: number }>();
  // Deep data sync in-progress flags
  private bbDeepSyncInProgress = false;
  private fbDeepSyncInProgress = false;

  readonly source: 'sporttery-live' | 'external' | 'hybrid' = 'hybrid';

  private readonly syncToken: string | null;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    eloService: EloService,
    eloHistoryService: EloHistoryService,
    xgProxyService: XgProxyService,
    mlEnsembleService: MlEnsembleService,
    featureEngineeringService: FeatureEngineeringService,
    gbdtService: GbdtService,
    dataDrivenService: BasketballDataDrivenPredictionService,
  ) {
    this.eloService = eloService;
    this.eloHistoryService = eloHistoryService;
    this.xgProxyService = xgProxyService;
    this.mlEnsembleService = mlEnsembleService;
    this.featureEngineeringService = featureEngineeringService;
    this.gbdtService = gbdtService;
    this.syncToken =
      serverSecrets.syncApiToken.length >= 32
        ? serverSecrets.syncApiToken
        : null;
    if (!this.syncToken) {
      this.logger.warn(
        'SYNC_API_TOKEN not configured or too short; sync write endpoint disabled (fail-closed)',
      );
    }

    this.espnSource = new EspnSource();
    this.qiumibaoSource = new QiumibaoSource();
    this.nblOfficialSource = new NblOfficialSource();
    this.oddsSource = new TheOddsSource(serverSecrets.oddsApiKey);
    if (!this.oddsSource.isEnabled()) {
      this.logger.warn(
        'ODDS_API_KEY not configured; The Odds API source disabled',
      );
    }

    this.footballDataSource = new FootballDataSource();
    this.theRundownSource = new TheRundownSource(serverSecrets.theRundownKey);
    if (this.theRundownSource.isEnabled()) {
      this.logger.log('TheRundown source enabled');
    }

    this.tsdbSource = new TheSportsDbSource();

    this.apiSportsSource = new ApiSportsSource(serverSecrets.apiSportsKey);
    if (!this.apiSportsSource.isEnabled()) {
      this.logger.warn(
        'APISPORTS_KEY not configured; apiSports source disabled',
      );
    }

    this.injurySource = new InjurySource();
    this.logger.log('Official injury source enabled (ESPN NBA + WNBA)');

    this.fdoSource = new FootballDataOrgSource(serverSecrets.footballDataOrgKey);
    if (this.fdoSource.isEnabled()) {
      this.logger.log('football-data.org source enabled');
    } else {
      this.logger.log('football-data.org source: key not configured, pending setup');
    }

    this.anchorPrediction = new BasketballAnchorPredictionService();
  }

  /**
   * 返回所有数据源的同步配置（只读展示用）。
   */
  async getSyncConfig(): Promise<SyncConfig> {
    const oddsEnabled = this.oddsSource.isEnabled();
    const rundownEnabled = this.theRundownSource.isEnabled();
    const apiSportsEnabled = serverSecrets.apiSportsKey.length > 0;
    const beidanEnabled = isBeidanEnabled();

    // 查询各源实际贡献场次
    const [
      sportteryFbRes,
      sportteryBbRes,
      espnFbRes,
      espnBbRes,
      qmbFbRes,
      qmbBbRes,
      beidanFbRes,
      oddsSnapRes,
      bbOddsSnapRes,
      espnFbLastRes,
    ] = await Promise.all([
      this.db.select({ count: count() }).from(matches).where(eq(matches.source, 'sporttery')),
      this.db.select({ count: count() }).from(basketballMatches).where(eq(basketballMatches.source, 'sporttery')),
      this.db.select({ count: count() }).from(matches).where(eq(matches.source, 'ESPN')),
      this.db.select({ count: count() }).from(basketballMatches).where(eq(basketballMatches.source, 'espn')),
      this.db.select({ count: count() }).from(matches).where(eq(matches.source, 'qiumibao')),
      this.db.select({ count: count() }).from(basketballMatches).where(eq(basketballMatches.source, 'qiumibao')),
      this.db.select({ count: count() }).from(matches).where(eq(matches.source, 'beidan')),
      this.db.select({ count: count() }).from(oddsSnapshots),
      this.db.select({ count: count() }).from(basketballOddsSnapshots),
      this.db
        .select({ maxKickoff: sql<string>`max(${matches.kickoffTime})` })
        .from(matches)
        .where(eq(matches.source, 'ESPN')),
    ]);

    const sportteryCount = Number(sportteryFbRes[0]?.count ?? 0) + Number(sportteryBbRes[0]?.count ?? 0);
    const espnCount = Number(espnFbRes[0]?.count ?? 0) + Number(espnBbRes[0]?.count ?? 0);
    const qiumibaoCount = Number(qmbFbRes[0]?.count ?? 0) + Number(qmbBbRes[0]?.count ?? 0);
    const beidanCount = Number(beidanFbRes[0]?.count ?? 0);
    const theOddsApiCount = Number(oddsSnapRes[0]?.count ?? 0) + Number(bbOddsSnapRes[0]?.count ?? 0);
    const espnFbLastUpdated = espnFbLastRes[0]?.maxKickoff ?? null;

    const sources: SyncConfig['sources'] = [
      {
         name: '官方数据源',
         intervalMs: SCHEDULE_INTERVAL_MS,
         intervalLabel: '10分钟',
         enabled: true,
         type: '官方赛程数据',
         actualMatchesCount: sportteryCount,
         dataNote: sportteryCount > 0 ? '官方开售场次权威来源' : '主数据来源',
      },
      {
        name: 'ESPN',
        intervals: {
          live: ESPN_LIVE_INTERVAL_MS,
          upcoming: ESPN_UPCOMING_INTERVAL_MS,
          idle: ESPN_IDLE_INTERVAL_MS,
        },
        enabled: true,
        type: '比分/深度数据',
        actualMatchesCount: espnCount,
        dataNote: espnCount > 0 ? '海外联赛比分与深度数据补充' : '数据量较少',
        lastUpdated: espnFbLastUpdated,
      },
      {
        name: '球美宝',
        intervalMs: QIUMIBAO_ADAPTIVE_INTERVAL_MS,
        enabled: true,
        type: '比分补充',
        actualMatchesCount: qiumibaoCount,
        dataNote: qiumibaoCount > 0 ? '主数据来源，覆盖联赛最广' : '主数据来源',
      },
      {
        name: 'TheSportsDB',
        intervalMs: TSDB_SYNC_INTERVAL_MS,
        enabled: true,
        type: '兜底源',
        actualMatchesCount: 0,
        dataNote: '兜底备用，当前无独立入库数据',
      },
      {
        name: 'The Odds API',
        intervalMs: ODDS_API_POLL_INTERVAL_MS,
        enabled: oddsEnabled,
        monthlyQuota: 500,
        thresholdRatio: 0.2,
        type: '指数',
        actualMatchesCount: theOddsApiCount,
        dataNote: oddsEnabled
          ? '指数快照已接入'
          : '未配置或密钥失效，接入后自动更新',
        note: oddsEnabled
          ? undefined
          : '接入后可补充海外联赛指数线数据',
      },
      {
        name: 'TheRundown',
        intervalMs: THERUNDOWN_PRE_MATCH_INTERVAL_MS,
        enabled: rundownEnabled,
        type: '指数备用',
        actualMatchesCount: 0,
        dataNote: rundownEnabled
          ? '指数备用源已接入'
          : '未配置或密钥失效，接入后自动更新',
        note: rundownEnabled
          ? undefined
          : '接入后可补充美职篮等联赛指数线',
      },
      {
        name: 'apiSports',
        intervalMs: FOOTBALL_DATA_SYNC_INTERVAL_MS,
        enabled: apiSportsEnabled,
        dailyQuota: 500,
        type: '赛程/比分兜底',
        actualMatchesCount: 0,
        dataNote: apiSportsEnabled
          ? '赛程比分兜底源已接入'
          : '未配置或密钥失效，接入后自动更新',
        note: apiSportsEnabled
          ? undefined
          : '接入后可补全球赛程比分兜底',
      },
      {
         name: '足球二台',
         intervalMs: BEIDAN_SYNC_INTERVAL_MS,
         intervalLabel: '15分钟',
         enabled: beidanEnabled,
         type: '独立数据源',
         actualMatchesCount: beidanCount,
         dataNote: beidanEnabled ? '足球二台独立数据源' : '默认关闭',
         note: beidanEnabled
           ? '已启用，服务端主动抓取足球二台数据'
           : '默认关闭；开启请设置环境变量 BEIDAN_ENABLED=true',
       },
    ];

    return { sources };
  }

  onModuleInit(): void {
    void this.loadDbKeys();
    this.startScheduler();
  }

  private async loadDbKeys(): Promise<void> {
    try {
      const rows = await this.db
        .select({ key: appSettings.key, value: appSettings.value })
        .from(appSettings)
        .where(
          sql`${appSettings.key} IN ('api_sports_key', 'therundown_key')`,
        );
      const map = new Map<string, string>();
      for (const row of rows) {
        map.set(row.key, row.value);
      }

      const envApiSports = process.env.APISPORTS_KEY;
      if (!envApiSports || envApiSports.length === 0) {
        const dbVal = map.get('api_sports_key');
        if (dbVal && dbVal.length > 0) {
          this.apiSportsSource.setApiKey(dbVal);
          this.logger.log(`apiSports key loaded from db: ****${dbVal.slice(-4)}`);
        }
      } else {
        this.logger.log('apiSports key from env takes precedence over db');
      }

      const envTheRundown = process.env.THERUNDOWN_KEY;
      if (!envTheRundown || envTheRundown.length === 0) {
        const dbVal = map.get('therundown_key');
        if (dbVal && dbVal.length > 0) {
          this.theRundownSource.setApiKey(dbVal);
          this.logger.log(`TheRundown key loaded from db: ****${dbVal.slice(-4)}`);
        }
      } else {
        this.logger.log('TheRundown key from env takes precedence over db');
      }
    } catch (err) {
      this.logger.error('Failed to load data source keys from db', err instanceof Error ? err.stack : String(err));
    }
  }

  onModuleDestroy(): void {
    this.stopScheduler();
  }

  // --- Scheduler control ---

  startScheduler(): void {
    if (this._isSchedulerRunning) return;
    this._isSchedulerRunning = true;
    this.logger.log('Starting sporttery sync scheduler');

    // Schedule sync: run once soon, then every 6 hours
    void this.runFullSync().catch((err: unknown) => {
      this.logger.error(`Initial sync failed: ${this.errorMessage(err)}`);
    });

    this.scheduleTimer = setInterval(() => {
      void this.runFullSync().catch((err: unknown) => {
        this.logger.error(`Scheduled sync failed: ${this.errorMessage(err)}`);
      });
    }, SCHEDULE_INTERVAL_MS);
    if (this.scheduleTimer && typeof this.scheduleTimer.unref === 'function') {
      this.scheduleTimer.unref();
    }

    // ESPN live score sync: adaptive check every 60s
    this.espnLiveTimer = setInterval(() => {
      void this.runEspnLiveSync().catch((err: unknown) => {
        this.logger.error(`ESPN live sync failed: ${this.errorMessage(err)}`);
      });
    }, ESPN_ADAPTIVE_INTERVAL_MS);
    if (this.espnLiveTimer && typeof this.espnLiveTimer.unref === 'function') {
      this.espnLiveTimer.unref();
    }

    // The Odds API odds sync: poll every 15 min, adaptive inside
    this.oddsApiTimer = setInterval(() => {
      void this.runOddsApiSync().catch((err: unknown) => {
        this.logger.error(`Odds API sync failed: ${this.errorMessage(err)}`);
      });
    }, ODDS_API_POLL_INTERVAL_MS);
    if (this.oddsApiTimer && typeof this.oddsApiTimer.unref === 'function') {
      this.oddsApiTimer.unref();
    }

    // Run odds API sync immediately on startup if enabled
    if (this.oddsSource.isEnabled()) {
      void this.runOddsApiSync().catch((err: unknown) => {
        this.logger.error(`Initial odds API sync failed: ${this.errorMessage(err)}`);
      });
    }

    // Qiumibao live score sync: self-scheduling with ±5s jitter on 45s base
    this.scheduleNextQiumibaoRun();

    // TheSportsDB daily fallback sync: every 20 minutes
    this.theSportsDbTimer = setInterval(() => {
      void this.runTheSportsDbSync().catch((err: unknown) => {
        this.logger.error(`TheSportsDB sync failed: ${this.errorMessage(err)}`);
      });
    }, TSDB_SYNC_INTERVAL_MS);
    if (this.theSportsDbTimer && typeof this.theSportsDbTimer.unref === 'function') {
      this.theSportsDbTimer.unref();
    }
    // Initial run
    void this.runTheSportsDbSync().catch((err: unknown) => {
      this.logger.error(`Initial TheSportsDB sync failed: ${this.errorMessage(err)}`);
    });

    // api-sports.io fallback sync: every 30 minutes (only if key configured)
    if (this.apiSportsSource.isEnabled()) {
      this.apiSportsTimer = setInterval(() => {
        void this.runApiSportsSync().catch((err: unknown) => {
          this.logger.error(`apiSports sync failed: ${this.errorMessage(err)}`);
        });
      }, APISPORTS_SYNC_INTERVAL_MS);
      if (this.apiSportsTimer && typeof this.apiSportsTimer.unref === 'function') {
        this.apiSportsTimer.unref();
      }
      void this.runApiSportsSync().catch((err: unknown) => {
        this.logger.error(`Initial apiSports sync failed: ${this.errorMessage(err)}`);
      });
    }

    // ESPN summary (odds + injuries + news) refresh: every 25 min for pre-match
    this.espnSummaryTimer = setInterval(() => {
      void this.runEspnSummarySync().catch((err: unknown) => {
        this.logger.error(`ESPN summary sync failed: ${this.errorMessage(err)}`);
      });
    }, ESPN_SUMMARY_PRE_MATCH_INTERVAL_MS);
    if (this.espnSummaryTimer && typeof this.espnSummaryTimer.unref === 'function') {
      this.espnSummaryTimer.unref();
    }
    void this.runEspnSummarySync().catch((err: unknown) => {
      this.logger.error(`Initial ESPN summary sync failed: ${this.errorMessage(err)}`);
    });

    // football-data.co.uk daily sync
    this.footballDataTimer = setInterval(() => {
      void this.runFootballDataSync().catch((err: unknown) => {
        this.logger.error(`Football-Data sync failed: ${this.errorMessage(err)}`);
      });
    }, FOOTBALL_DATA_SYNC_INTERVAL_MS);
    if (this.footballDataTimer && typeof this.footballDataTimer.unref === 'function') {
      this.footballDataTimer.unref();
    }
    void this.runFootballDataSync().catch((err: unknown) => {
      this.logger.error(`Initial Football-Data sync failed: ${this.errorMessage(err)}`);
    });

    // TheRundown odds sync (only if key configured)
    if (this.theRundownSource.isEnabled()) {
      this.theRundownTimer = setInterval(() => {
        void this.runTheRundownSync().catch((err: unknown) => {
          this.logger.error(`TheRundown sync failed: ${this.errorMessage(err)}`);
        });
      }, THERUNDOWN_PRE_MATCH_INTERVAL_MS);
      if (this.theRundownTimer && typeof this.theRundownTimer.unref === 'function') {
        this.theRundownTimer.unref();
      }
      void this.runTheRundownSync().catch((err: unknown) => {
        this.logger.error(`Initial TheRundown sync failed: ${this.errorMessage(err)}`);
      });
    }

    // Beijing Beidan (北京北单) active fetch from zgzcw
    if (isBeidanEnabled()) {
      this.beidanTimer = setInterval(() => {
        void this.runBeidanSync().catch((err: unknown) => {
          this.logger.error(`Beidan sync failed: ${this.errorMessage(err)}`);
        });
      }, BEIDAN_SYNC_INTERVAL_MS);
      if (this.beidanTimer && typeof this.beidanTimer.unref === 'function') {
        this.beidanTimer.unref();
      }
      void this.runBeidanSync().catch((err: unknown) => {
        this.logger.error(`Initial beidan sync failed: ${this.errorMessage(err)}`);
      });
    }

    // Official injury source: every 30 minutes
    this.injuryTimer = setInterval(() => {
      void this.runInjurySync().catch((err: unknown) => {
        this.logger.error(`Injury sync failed: ${this.errorMessage(err)}`);
      });
    }, 30 * 60 * 1000);
    if (this.injuryTimer && typeof this.injuryTimer.unref === 'function') {
      this.injuryTimer.unref();
    }
    void this.runInjurySync().catch((err: unknown) => {
      this.logger.error(`Initial injury sync failed: ${this.errorMessage(err)}`);
    });

    // football-data.org sync (only if key configured)
    if (this.fdoSource.isEnabled()) {
      this.fdoTimer = setInterval(() => {
        void this.runFdoSync().catch((err: unknown) => {
          this.logger.error(`football-data.org sync failed: ${this.errorMessage(err)}`);
        });
      }, 2 * 60 * 60 * 1000);
      if (this.fdoTimer && typeof this.fdoTimer.unref === 'function') {
        this.fdoTimer.unref();
      }
      void this.runFdoSync().catch((err: unknown) => {
        this.logger.error(`Initial football-data.org sync failed: ${this.errorMessage(err)}`);
      });
    }
  }

  stopScheduler(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    if (this.espnLiveTimer) {
      clearInterval(this.espnLiveTimer);
      this.espnLiveTimer = null;
    }
    if (this.oddsApiTimer) {
      clearInterval(this.oddsApiTimer);
      this.oddsApiTimer = null;
    }
    if (this.qiumibaoLiveTimer) {
      clearTimeout(this.qiumibaoLiveTimer);
      this.qiumibaoLiveTimer = null;
    }
    if (this.theSportsDbTimer) {
      clearInterval(this.theSportsDbTimer);
      this.theSportsDbTimer = null;
    }
    if (this.espnSummaryTimer) {
      clearInterval(this.espnSummaryTimer);
      this.espnSummaryTimer = null;
    }
    if (this.footballDataTimer) {
      clearInterval(this.footballDataTimer);
      this.footballDataTimer = null;
    }
    if (this.theRundownTimer) {
      clearInterval(this.theRundownTimer);
      this.theRundownTimer = null;
    }
    if (this.beidanTimer) {
      clearInterval(this.beidanTimer);
      this.beidanTimer = null;
    }
    if (this.injuryTimer) {
      clearInterval(this.injuryTimer);
      this.injuryTimer = null;
    }
    if (this.fdoTimer) {
      clearInterval(this.fdoTimer);
      this.fdoTimer = null;
    }
    if (this.apiSportsTimer) {
      clearInterval(this.apiSportsTimer);
      this.apiSportsTimer = null;
    }
    this._isSchedulerRunning = false;
    this.logger.log('Sporttery sync scheduler stopped');
  }

  get isSchedulerRunning(): boolean {
    return this._isSchedulerRunning;
  }

  isSyncWriteEnabled(): boolean {
    return this.syncToken !== null;
  }

  isOddsApiEnabled(): boolean {
    return this.oddsSource.isEnabled();
  }

  verifySyncToken(token: string): boolean {
    if (!this.syncToken) return false;
    if (token.length !== this.syncToken.length) return false;
    let diff = 0;
    for (let i = 0; i < token.length; i += 1) {
      diff |= token.charCodeAt(i) ^ this.syncToken.charCodeAt(i);
    }
    return diff === 0;
  }

  // --- Public trigger ---

  async triggerSync(): Promise<SyncTriggerResult> {
    this.logger.log('Manual sync triggered');
    const fb = await this.syncFootball();
    const bb = await this.syncBasketball();
    return { football: fb, basketball: bb };
  }

  // --- Backfill empty modelRules ---

  async backfillEmptyModelRules(): Promise<{
    basketballFilled: number;
    footballFilled: number;
    basketballTotalEmpty: number;
    footballTotalEmpty: number;
  }> {
    this.logger.log('Starting modelRules backfill for empty predictions');

    // --- Basketball ---
    const bbRows = await this.db
      .select({
        id: basketballMatches.id,
        handicapOddsHome: basketballMatches.handicapOddsHome,
        handicapOddsAway: basketballMatches.handicapOddsAway,
        handicap: basketballMatches.handicap,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLine: basketballMatches.totalLine,
        totalLineNum: basketballMatches.totalLineNum,
        league: basketballMatches.league,
        teamStats: basketballMatches.teamStats,
      })
      .from(basketballMatches)
      .where(
        and(
          sql`(${basketballMatches.modelRules} IS NULL OR cardinality(${basketballMatches.modelRules}) = 0)`,
          gte(basketballMatches.confidence, 1),
          isNotNull(basketballMatches.handicapOddsHome),
          isNotNull(basketballMatches.handicapOddsAway),
        ),
      );

    const basketballTotalEmpty: number = bbRows.length;
    let basketballFilled = 0;

    for (const row of bbRows) {
      const hOdds = Number(row.handicapOddsHome);
      const aOdds = Number(row.handicapOddsAway);
      if (!Number.isFinite(hOdds) || !Number.isFinite(aOdds)) continue;

      // 优先使用 *_line_num（官方数字字段），文本字段常为空
      const hcpNum = row.handicapLineNum != null ? Number(row.handicapLineNum) : 0;
      const hcpStr = hcpNum !== 0 ? String(hcpNum) : (row.handicap ?? '0');
      const tlNum = row.totalLineNum != null ? Number(row.totalLineNum) : 0;
      const tlStr = tlNum > 0 ? String(tlNum) : (row.totalLine && row.totalLine.trim() ? row.totalLine.trim() : undefined);

      const prediction = this.generateBasketballPrediction(
        hOdds,
        aOdds,
        hcpStr,
        tlStr,
        row.league,
        '',
        { teamStats: row.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined },
      );
      if (!prediction) continue;
      if (!prediction.modelRules || prediction.modelRules.length === 0) continue;

      await this.db
        .update(basketballMatches)
        .set({ modelRules: prediction.modelRules })
        .where(eq(basketballMatches.id, row.id));
      basketballFilled += 1;
    }

    // --- Football ---
    const fbRows = await this.db
      .select({
        id: matches.id,
            oddsOpenHome: matches.oddsOpenHome,
             oddsOpenDraw: matches.oddsOpenDraw,
             oddsOpenAway: matches.oddsOpenAway,
            handicap: matches.handicap,
            overUnder: matches.overUnder,
            league: matches.league,
            homeGoalsAvg: matches.homeGoalsAvg,
            awayGoalsAvg: matches.awayGoalsAvg,
            homeConcededAvg: matches.homeConcededAvg,
            awayConcededAvg: matches.awayConcededAvg,
      })
      .from(matches)
      .where(
        and(
          sql`(${matches.modelRules} IS NULL OR cardinality(${matches.modelRules}) = 0)`,
          gte(matches.confidence, 1),
          isNotNull(matches.oddsOpenHome),
          isNotNull(matches.oddsOpenDraw),
          isNotNull(matches.oddsOpenAway),
        ),
      );

    const footballTotalEmpty: number = fbRows.length;
    let footballFilled = 0;

    for (const row of fbRows) {
      const hOdds = Number(row.oddsOpenHome);
      const dOdds = Number(row.oddsOpenDraw);
      const aOdds = Number(row.oddsOpenAway);
      if (
        !Number.isFinite(hOdds) ||
        !Number.isFinite(dOdds) ||
        !Number.isFinite(aOdds)
      )
        continue;

      const hAvg = Number(row.homeGoalsAvg) || 0;
      const aAvg = Number(row.awayGoalsAvg) || 0;
      const hcAvg = Number(row.homeConcededAvg) || 0;
      const acAvg = Number(row.awayConcededAvg) || 0;
      const strengthInput = (hAvg > 0 && aAvg > 0 && hcAvg > 0 && acAvg > 0)
        ? { homeGoalsAvg: hAvg, awayGoalsAvg: aAvg, homeConcededAvg: hcAvg, awayConcededAvg: acAvg }
        : undefined;

      const prediction = this.generateFootballPrediction(
        hOdds,
        dOdds,
        aOdds,
        String(row.handicap || 0),
        String(row.overUnder || 2.5),
        row.league || '',
        strengthInput,
      );
      if (!prediction) continue;
      if (!prediction.modelRules || prediction.modelRules.length === 0) continue;

      await this.db
        .update(matches)
        .set({ modelRules: prediction.modelRules })
        .where(eq(matches.id, row.id));
      footballFilled += 1;
    }

    this.logger.log(
      `modelRules backfill done: basketball ${basketballFilled}/${basketballTotalEmpty}, football ${footballFilled}/${footballTotalEmpty}`,
    );

    return {
      basketballFilled,
      footballFilled,
      basketballTotalEmpty,
      footballTotalEmpty,
    };
  }

  async backfillDerivedScoreData(): Promise<{
    checked: number;
    updated: number;
    failed: number;
  }> {
    this.logger.log('Starting derived score data backfill for football matches');

    const rows = await this.db
      .select({
        id: matches.id,
        homeWinProb: matches.homeWinProb,
        drawProb: matches.drawProb,
        awayWinProb: matches.awayWinProb,
        handicap: matches.handicap,
        totalGoals: matches.totalGoals,
        overProb: matches.overProb,
        predictionDirection: matches.predictionDirection,
      })
      .from(matches)
      .where(gt(matches.homeWinProb, 0));

    let checked = 0;
    let updated = 0;
    let failed = 0;

    for (const row of rows) {
      checked += 1;
      try {
        const tgVal = Number(row.totalGoals);
        const totalGoalsNum = Number.isFinite(tgVal) && tgVal > 0 ? tgVal : 2.5;
        // back-calculate odds from probabilities for generateFootballPrediction
        // Use simple inverse: odds = 1 / (prob / 100), normalize vig out
        const hP = row.homeWinProb / 100;
        const dP = row.drawProb / 100;
        const aP = row.awayWinProb / 100;
        const sumP = hP + dP + aP;
        if (sumP <= 0) continue;
        // Add a small vig (3%) to make odds realistic
        const vig = 1.03;
        const oddsH = 1 / (hP / sumP) / vig;
        const oddsD = 1 / (dP / sumP) / vig;
        const oddsA = 1 / (aP / sumP) / vig;

        const prediction = this.generateFootballPrediction(
          oddsH,
          oddsD,
          oddsA,
          String(row.handicap || 0),
          String(totalGoalsNum),
        );
        if (!prediction) continue;

        await this.db
          .update(matches)
          .set({
            mostLikelyScore: prediction.mostLikelyScore,
            scoreProbs: prediction.scoreProbs,
            halfFullProb: prediction.halfFullProb as unknown as string[],
            totalGoalsProb: prediction.totalGoalsProb as unknown as string[],
          })
          .where(eq(matches.id, row.id));
        updated += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(`backfill derived failed for ${row.id}`, err);
      }
    }

    this.logger.log(
      `backfillDerivedScoreData done: checked=${checked} updated=${updated} failed=${failed}`,
    );
    return { checked, updated, failed };
  }

  getDeepBackfillStatus(): typeof this._deepBackfillResult {
    return { ...this._deepBackfillResult };
  }

  startDeepBackfillAsync(): { accepted: boolean; message: string } {
    if (this._deepBackfillRunning) {
      return {
        accepted: false,
        message: `回填任务进行中（开始于 ${this._deepBackfillResult.startedAt?.toISOString() ?? '未知时间'}），请等待完成后再触发`,
      };
    }
    this._deepBackfillRunning = true;
    this._deepBackfillResult = {
      status: 'running',
      startedAt: new Date(),
      finishedAt: null,
      footballChecked: 0,
      footballUpdated: 0,
      footballErrors: 0,
      basketballChecked: 0,
      basketballUpdated: 0,
      basketballErrors: 0,
    };
    void (async () => {
      try {
        const result = await this.backfillDeepData();
        this._deepBackfillResult = {
          status: 'done',
          startedAt: this._deepBackfillResult.startedAt,
          finishedAt: new Date(),
          ...result,
        };
        this.logger.log(
          `Deep backfill done: fb=${result.footballChecked}/${result.footballUpdated}/${result.footballErrors} ` +
            `bb=${result.basketballChecked}/${result.basketballUpdated}/${result.basketballErrors}`,
        );
      } catch (err) {
        this._deepBackfillResult = {
          ...this._deepBackfillResult,
          status: 'error',
          finishedAt: new Date(),
          errorMessage: err instanceof Error ? err.message : String(err),
        };
        this.logger.error('Deep backfill failed', err instanceof Error ? err.stack : String(err));
      } finally {
        this._deepBackfillRunning = false;
      }
    })();
    return { accepted: true, message: '回填任务已提交，后台执行中' };
  }

  async backfillNbaSourceIds(): Promise<{ checked: number; updated: number; failed: number; espnMatches: number; details: Array<{ matchNo: string; sourceId: string; homeTeam: string; awayTeam: string; homeEng: string | null; awayEng: string | null; status: string }> }> {
    this.logger.log('Starting NBA sourceId quick backfill for upcoming matches');
    let checked = 0;
    let updated = 0;
    let failed = 0;
    const details: Array<{ matchNo: string; sourceId: string; homeTeam: string; awayTeam: string; homeEng: string | null; awayEng: string | null; status: string }> = [];

    const bbRows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        sourceId: basketballMatches.sourceId,
        sourceLeagueCode: basketballMatches.sourceLeagueCode,
        league: basketballMatches.league,
      })
      .from(basketballMatches)
      .where(and(
        eq(basketballMatches.source, 'sporttery'),
        eq(basketballMatches.matchStatus, 'upcoming' as const),
        or(
          ilike(basketballMatches.league, '%NBA%'),
          ilike(basketballMatches.league, '%美国职业%'),
          ilike(basketballMatches.league, '%美职篮%'),
        ),
      ));

    this.logger.log(`NBA sourceId backfill: total upcoming NBA=${bbRows.length}, ` +
      `withSourceId=${bbRows.filter(r => r.sourceId).length}, withoutSourceId=${bbRows.filter(r => !r.sourceId).length}`);

    if (bbRows.length === 0) {
      return { checked: 0, updated: 0, failed: 0, espnMatches: 0, details: [] };
    }

    const needBackfill = bbRows.filter((r) => !r.sourceId);
    if (needBackfill.length === 0) {
      return { checked: bbRows.length, updated: 0, failed: 0, espnMatches: 0, details: [] };
    }

    let espnBbMatches: ESPNBasketballMatch[] = [];
    let espnError = '';
    try {
      const todayStr: string = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const tomorrowStr: string = new Date(Date.now() + 86400000).toISOString().slice(0, 10).replace(/-/g, '');
      for (const d of [todayStr, tomorrowStr]) {
        const result = await this.espnSource.fetchBasketballScoreboard('nba', d);
        this.logger.log(`ESPN NBA scoreboard (${d}): ${result.matches.length} matches`);
        for (const m of result.matches) {
          if (!espnBbMatches.some((e) => e.sourceId === m.sourceId)) espnBbMatches.push(m);
        }
      }
    } catch (err) {
      espnError = this.errorMessage(err);
      this.logger.error(`Failed to fetch ESPN NBA scoreboard: ${espnError}`);
    }

    if (espnBbMatches.length === 0) {
      return { checked: bbRows.length, updated: 0, failed: needBackfill.length, espnMatches: 0, details: needBackfill.map(r => ({ matchNo: r.matchNo || '', sourceId: '', homeTeam: r.homeTeam, awayTeam: r.awayTeam, homeEng: null, awayEng: null, status: espnError ? `espn_error: ${espnError}` : 'espn_empty' })) };
    }

    for (const dbRow of needBackfill) {
      checked += 1;
      const findEngName = (cnName: string): string | null => {
        for (const [eng, aliases] of Object.entries(NBA_TEAM_NAME_MAP)) {
          if (aliases.some((a: string) => cnName.includes(a) || a.includes(cnName))) return eng;
        }
        return null;
      };
      const homeEng = findEngName(dbRow.homeTeam);
      const awayEng = findEngName(dbRow.awayTeam);
      const homeNorm = normalizeTeamName(dbRow.homeTeam);
      const awayNorm = normalizeTeamName(dbRow.awayTeam);
      const homeEngNorm = homeEng ? normalizeTeamName(homeEng) : null;
      const awayEngNorm = awayEng ? normalizeTeamName(awayEng) : null;

      const matched = espnBbMatches.find((m) => {
        const mHome = normalizeTeamName(m.homeTeam);
        const mAway = normalizeTeamName(m.awayTeam);
        const mHomeHasCn = /[\u4e00-\u9fa5]/.test(m.homeTeam);
        if (mHomeHasCn) {
          const homeMatch = mHome.includes(homeNorm) || homeNorm.includes(mHome);
          const awayMatch = mAway.includes(awayNorm) || awayNorm.includes(mAway);
          if (homeMatch && awayMatch) return true;
          const reverseHomeMatch = mHome.includes(awayNorm) || awayNorm.includes(mHome);
          const reverseAwayMatch = mAway.includes(homeNorm) || homeNorm.includes(mAway);
          if (reverseHomeMatch && reverseAwayMatch) return true;
        } else if (homeEngNorm && awayEngNorm) {
          if (mHome === homeEngNorm && mAway === awayEngNorm) return true;
          if (mHome === awayEngNorm && mAway === homeEngNorm) return true;
        }
        return false;
      });

      if (matched && matched.sourceId) {
        try {
          await this.db.update(basketballMatches)
            .set({
              sourceId: matched.sourceId,
              sourceLeagueCode: matched.leagueCode,
              updatedAt: new Date(),
            })
            .where(eq(basketballMatches.id, dbRow.id));
          updated += 1;
          details.push({
            matchNo: dbRow.matchNo || '',
            sourceId: matched.sourceId,
            homeTeam: dbRow.homeTeam,
            awayTeam: dbRow.awayTeam,
            homeEng: homeEng,
            awayEng: awayEng,
            status: 'updated',
          });
          this.logger.log(`NBA sourceId backfilled: ${dbRow.homeTeam} vs ${dbRow.awayTeam} -> ${matched.sourceId}`);
        } catch (err) {
          failed += 1;
          this.logger.warn(`NBA sourceId backfill update failed: ${dbRow.homeTeam} vs ${dbRow.awayTeam}: ${this.errorMessage(err)}`);
        }
      } else {
        failed += 1;
        const espnCandidates = espnBbMatches.slice(0, 5).map((m) => `${m.homeTeam} vs ${m.awayTeam}`).join(' | ');
        details.push({
          matchNo: dbRow.matchNo || '',
          sourceId: '',
          homeTeam: dbRow.homeTeam,
          awayTeam: dbRow.awayTeam,
          homeEng: homeEng,
          awayEng: awayEng,
          status: `no_match_espn_candidates=${espnCandidates}`,
        });
        this.logger.warn(`NBA sourceId backfill: no match for ${dbRow.homeTeam} vs ${dbRow.awayTeam} (eng=${homeEng}/${awayEng})`);
      }
    }

    this.logger.log(`NBA sourceId backfill done: checked=${checked}, updated=${updated}, failed=${failed}, espn=${espnBbMatches.length}`);
    return { checked, updated, failed, espnMatches: espnBbMatches.length, details };
  }

  async backfillDeepData(): Promise<{
    footballChecked: number;
    footballUpdated: number;
    footballErrors: number;
    basketballChecked: number;
    basketballUpdated: number;
    basketballErrors: number;
  }> {
    this.logger.log('Starting deep data backfill for existing matches');

    let footballChecked = 0;
    let footballUpdated = 0;
    let footballErrors = 0;
    let basketballChecked = 0;
    let basketballUpdated = 0;
    let basketballErrors = 0;

    // --- Football: fetch upcoming scoreboards for all ESPN leagues, match, enrich ---
    const fbLeagueCodes = Object.keys(ESPN_FOOTBALL_LEAGUES);
    const espnFbMatches: ESPNFootballMatch[] = [];
    const today = new Date();
    const dateOffsets = [-1, 0, 1, 2, 3];
    for (const code of fbLeagueCodes) {
      for (const offset of dateOffsets) {
        const d = new Date(today.getTime() + offset * 24 * 60 * 60 * 1000);
        const dateStr =
          d.getFullYear().toString() +
          String(d.getMonth() + 1).padStart(2, '0') +
          String(d.getDate()).padStart(2, '0');
        try {
          const result = await this.espnSource.fetchFootballScoreboard(code, dateStr);
          espnFbMatches.push(...result.matches);
        } catch (_e) {
          // skip leagues/dates without scoreboard data
        }
      }
    }
    const seen = new Set<string>();
    const uniqueMatches: ESPNFootballMatch[] = [];
    for (const m of espnFbMatches) {
      const key = `${m.leagueCode}:${m.sourceId}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueMatches.push(m);
      }
    }
    espnFbMatches.length = 0;
    espnFbMatches.push(...uniqueMatches);

    const fbRows = await this.db
      .select({
        id: matches.id,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        matchDate: matches.matchDate,
        kickoffTime: matches.kickoffTime,
        homeForm: matches.homeForm,
        awayForm: matches.awayForm,
        h2h: matches.h2h,
        updatedAt: matches.updatedAt,
        sourceId: matches.sourceId,
        league: matches.league,
        sourceLeagueCode: matches.sourceLeagueCode,
        advancedStats: matches.advancedStats,
        matchStatus: matches.matchStatus,
        homeGoalsAvg: matches.homeGoalsAvg,
        awayGoalsAvg: matches.awayGoalsAvg,
        homeConcededAvg: matches.homeConcededAvg,
        awayConcededAvg: matches.awayConcededAvg,
        homeHomeRecord: matches.homeHomeRecord,
        awayAwayRecord: matches.awayAwayRecord,
        homeInjuries: matches.homeInjuries,
        awayInjuries: matches.awayInjuries,
      })
      .from(matches)
      .where(and(
        gte(matches.kickoffTime, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)),
        lte(matches.kickoffTime, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
        eq(matches.source, 'sporttery'),
      ));

    for (const dbRow of fbRows) {
      footballChecked += 1;
      let leagueCode = dbRow.sourceLeagueCode || '';
      let eventId = dbRow.sourceId || '';

      if (!leagueCode || !eventId) {
        const espnMatch = espnFbMatches.find((m) => {
          const homeMatch =
            normalizeTeamName(m.homeTeam) === normalizeTeamName(dbRow.homeTeam) ||
            normalizeTeamName(m.homeTeam).includes(normalizeTeamName(dbRow.homeTeam).slice(0, 4)) ||
            normalizeTeamName(dbRow.homeTeam).includes(normalizeTeamName(m.homeTeam).slice(0, 4));
          const awayMatch =
            normalizeTeamName(m.awayTeam) === normalizeTeamName(dbRow.awayTeam) ||
            normalizeTeamName(m.awayTeam).includes(normalizeTeamName(dbRow.awayTeam).slice(0, 4)) ||
            normalizeTeamName(dbRow.awayTeam).includes(normalizeTeamName(m.awayTeam).slice(0, 4));
          return homeMatch && awayMatch;
        });
        if (!espnMatch || !espnMatch.sourceId) continue;
        if (espnMatch.kickoffTime) {
          const dayDiff = Math.abs(
            new Date(espnMatch.kickoffTime).getTime() - dbRow.kickoffTime.getTime(),
          ) / (1000 * 60 * 60 * 24);
          if (dayDiff > 2) continue;
        }
        leagueCode = espnMatch.leagueCode;
        eventId = espnMatch.sourceId;
      }

      const hasForm =
        dbRow.homeForm && dbRow.homeForm.length > 0 && dbRow.awayForm && dbRow.awayForm.length > 0;
      const hasH2h = dbRow.h2h && dbRow.h2h.length > 0;
      const hasAdv =
        dbRow.advancedStats &&
        Object.keys(dbRow.advancedStats as Record<string, unknown> || {}).length > 0;
      if (hasForm && hasH2h && hasAdv) continue;

      try {
        this.logger.warn(`backfill fb: ${dbRow.homeTeam} vs ${dbRow.awayTeam} [${leagueCode}/${eventId}]`);
        const summary = await this.espnSource.fetchFootballEventSummary(
          leagueCode,
          eventId,
        );
        this.logger.warn(`backfill summary: homeForm=${summary.homeForm.length} awayForm=${summary.awayForm.length} homeTeamId=${summary.homeTeamId} awayTeamId=${summary.awayTeamId}`);

        const fetchTeamStats = async (teamId: string | undefined): Promise<Record<string, string>> => {
          if (!teamId) return {};
          try {
            const result = await this.espnSource.fetchFootballTeamStats(
              leagueCode,
              teamId,
            );
            return result.stats;
          } catch (_err) {
            return {};
          }
        };

        const [homeStatsRaw, awayStatsRaw] = await Promise.all([
          fetchTeamStats(summary.homeTeamId),
          fetchTeamStats(summary.awayTeamId),
        ]);

        let h2hItems: Array<{
          date: string;
          homeTeam: string;
          awayTeam: string;
          homeScore: number;
          awayScore: number;
        }> = [];
        try {
          const h2hResult = await this.espnSource.fetchFootballH2h(
            leagueCode,
            eventId,
          );
          h2hItems = h2hResult.h2h;
        } catch (_err) {
          // H2H may not be available
        }

        const updateSet: Partial<typeof matches.$inferInsert> = {};
        const fbHomeFormEmpty = !dbRow.homeForm || dbRow.homeForm.length === 0;
        const fbAwayFormEmpty = !dbRow.awayForm || dbRow.awayForm.length === 0;
        if (summary && summary.homeForm.length > 0 && fbHomeFormEmpty) {
          updateSet.homeForm = summary.homeForm.map(
            (f) => `${f.result} ${f.opponent} ${f.score}`.trim(),
          );
        }
        if (summary && summary.awayForm.length > 0 && fbAwayFormEmpty) {
          updateSet.awayForm = summary.awayForm.map(
            (f) => `${f.result} ${f.opponent} ${f.score}`.trim(),
          );
        }
        const existingAdvancedStats = (dbRow.advancedStats as Record<string, unknown> | undefined) || {};
        const fbAdvEmpty = Object.keys(existingAdvancedStats).length === 0;
        if (summary.matchStats.home && summary.matchStats.away && fbAdvEmpty) {
          updateSet.advancedStats = {
            ...existingAdvancedStats,
            dataSource: 'espn_summary',
            quality: 'high',
            shotsHome: summary.matchStats.home.totalShots,
            shotsAway: summary.matchStats.away.totalShots,
            shotsOnTargetHome: summary.matchStats.home.shotsOnTarget,
            shotsOnTargetAway: summary.matchStats.away.shotsOnTarget,
            cornersHome: summary.matchStats.home.wonCorners,
            cornersAway: summary.matchStats.away.wonCorners,
            possessionHome: summary.matchStats.home.possessionPct,
            possessionAway: summary.matchStats.away.possessionPct,
            foulsHome: summary.matchStats.home.foulsCommitted,
            foulsAway: summary.matchStats.away.foulsCommitted,
            passAccuracyHome: summary.matchStats.home.passPct,
            passAccuracyAway: summary.matchStats.away.passPct,
          };
        }
        const filteredH2h = h2hItems.filter(
          (h) => h.homeScore > 0 || h.awayScore > 0,
        );
        const fbH2hEmpty = !dbRow.h2h || dbRow.h2h.length === 0;
        if (filteredH2h.length > 0 && fbH2hEmpty) {
          updateSet.h2h = filteredH2h
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map(
              (h) =>
                `${h.date.slice(0, 10)} ${h.homeTeam} ${h.homeScore}-${h.awayScore} ${h.awayTeam}`,
            );
        }
        const isEmptyText = (v: string | null) => v === null || v === '';

        if (Object.keys(homeStatsRaw).length > 0 || Object.keys(awayStatsRaw).length > 0) {
          const parseNum = (v: string | undefined): number => {
            if (!v) return 0;
            const n = Number(v.replace(/[^0-9.]/g, ''));
            return Number.isNaN(n) ? 0 : n;
          };
          const findStatKey = (stats: Record<string, string>, keywords: string[]): string | undefined => {
            const lowerKeys = Object.keys(stats);
            for (const k of lowerKeys) {
              const kl = k.toLowerCase();
              if (keywords.every(kw => kl.includes(kw.toLowerCase()))) {
                return stats[k];
              }
            }
            return undefined;
          };
          const homeGoalsFor = findStatKey(homeStatsRaw, ['goals for', 'per game']) ||
            findStatKey(homeStatsRaw, ['goals per game']) ||
            findStatKey(homeStatsRaw, ['scored per']);
          const awayGoalsFor = findStatKey(awayStatsRaw, ['goals for', 'per game']) ||
            findStatKey(awayStatsRaw, ['goals per game']) ||
            findStatKey(awayStatsRaw, ['scored per']);
          const homeGoalsAgainst = findStatKey(homeStatsRaw, ['goals against', 'per game']) ||
            findStatKey(homeStatsRaw, ['against per']) ||
            findStatKey(homeStatsRaw, ['concede per']);
          const awayGoalsAgainst = findStatKey(awayStatsRaw, ['goals against', 'per game']) ||
            findStatKey(awayStatsRaw, ['against per']) ||
            findStatKey(awayStatsRaw, ['concede per']);
          if (dbRow.homeGoalsAvg === null || Number(dbRow.homeGoalsAvg) === 0) {
            const v = parseNum(homeGoalsFor);
            if (v > 0) updateSet.homeGoalsAvg = String(v);
          }
          if (dbRow.awayGoalsAvg === null || Number(dbRow.awayGoalsAvg) === 0) {
            const v = parseNum(awayGoalsFor);
            if (v > 0) updateSet.awayGoalsAvg = String(v);
          }
          if (dbRow.homeConcededAvg === null || Number(dbRow.homeConcededAvg) === 0) {
            const v = parseNum(homeGoalsAgainst);
            if (v > 0) updateSet.homeConcededAvg = String(v);
          }
          if (dbRow.awayConcededAvg === null || Number(dbRow.awayConcededAvg) === 0) {
            const v = parseNum(awayGoalsAgainst);
            if (v > 0) updateSet.awayConcededAvg = String(v);
          }
          const teamStatsAdvanced: Record<string, number> = {};
          const homeShots = parseNum(homeStatsRaw['Shots Per Game']);
          const awayShots = parseNum(awayStatsRaw['Shots Per Game']);
          const homePossession = parseNum(homeStatsRaw['Possession Percentage']);
          const awayPossession = parseNum(awayStatsRaw['Possession Percentage']);
          const homePassAcc = parseNum(homeStatsRaw['Pass Completion Percentage']);
          const awayPassAcc = parseNum(awayStatsRaw['Pass Completion Percentage']);
          if (homeShots > 0) teamStatsAdvanced.shotsHome = homeShots;
          if (awayShots > 0) teamStatsAdvanced.shotsAway = awayShots;
          if (homePossession > 0) teamStatsAdvanced.possessionHome = homePossession;
          if (awayPossession > 0) teamStatsAdvanced.possessionAway = awayPossession;
          if (homePassAcc > 0) teamStatsAdvanced.passAccuracyHome = homePassAcc;
          if (awayPassAcc > 0) teamStatsAdvanced.passAccuracyAway = awayPassAcc;
          if (Object.keys(teamStatsAdvanced).length > 0 && !hasAdv) {
            updateSet.advancedStats = {
              ...((dbRow.advancedStats as Record<string, number> | undefined) || {}),
              ...teamStatsAdvanced,
              ...(updateSet.advancedStats as Record<string, unknown> | undefined),
            };
          }
        }

        const calcAvgFromForm = (
          formItems: Array<{ result: string; score: string; opponent: string }>,
        ): { scored: number; conceded: number } | null => {
          if (!formItems || formItems.length < 3) return null;
          let totalScored = 0;
          let totalConceded = 0;
          let count = 0;
          for (const f of formItems) {
            const parts = f.score ? f.score.trim().split(/[-:]/) : [];
            if (parts.length === 2) {
              const a = parseInt(parts[0], 10);
              const b = parseInt(parts[1], 10);
              if (!Number.isNaN(a) && !Number.isNaN(b)) {
                if (f.result === '胜') {
                  totalScored += Math.max(a, b);
                  totalConceded += Math.min(a, b);
                } else if (f.result === '负') {
                  totalScored += Math.min(a, b);
                  totalConceded += Math.max(a, b);
                } else {
                  totalScored += a;
                  totalConceded += b;
                }
                count += 1;
              }
            }
          }
          if (count < 3) return null;
          return { scored: totalScored / count, conceded: totalConceded / count };
        };

        const homeAvg = calcAvgFromForm(summary?.homeForm || []);
        const awayAvg = calcAvgFromForm(summary?.awayForm || []);
        if (homeAvg && (dbRow.homeGoalsAvg === null || Number(dbRow.homeGoalsAvg) === 0)) {
          updateSet.homeGoalsAvg = homeAvg.scored.toFixed(2);
        }
        if (homeAvg && (dbRow.homeConcededAvg === null || Number(dbRow.homeConcededAvg) === 0)) {
          updateSet.homeConcededAvg = homeAvg.conceded.toFixed(2);
        }
        if (awayAvg && (dbRow.awayGoalsAvg === null || Number(dbRow.awayGoalsAvg) === 0)) {
          updateSet.awayGoalsAvg = awayAvg.scored.toFixed(2);
        }
        if (awayAvg && (dbRow.awayConcededAvg === null || Number(dbRow.awayConcededAvg) === 0)) {
          updateSet.awayConcededAvg = awayAvg.conceded.toFixed(2);
        }

        if (isEmptyText(dbRow.homeHomeRecord) && summary && summary.homeForm.length > 0) {
          const homeHomeForm = summary.homeForm
            .filter(f => f.result === '胜' || f.result === '负' || f.result === '平')
            .slice(0, 10)
            .map(f => f.result.slice(0, 1))
            .join('');
          if (homeHomeForm.length >= 3) updateSet.homeHomeRecord = homeHomeForm;
        }
        if (isEmptyText(dbRow.awayAwayRecord) && summary && summary.awayForm.length > 0) {
          const awayAwayForm = summary.awayForm
            .filter(f => f.result === '胜' || f.result === '负' || f.result === '平')
            .slice(0, 10)
            .map(f => f.result.slice(0, 1))
            .join('');
          if (awayAwayForm.length >= 3) updateSet.awayAwayRecord = awayAwayForm;
        }

        if (isEmptyText(dbRow.homeInjuries) || isEmptyText(dbRow.awayInjuries)) {
          try {
            const summaryData = await this.espnSource.fetchFootballSummary(
              eventId,
              leagueCode,
            );
            if (summaryData) {
              const injuryToText = (inj: { athleteName: string; status: string }) =>
                `${inj.athleteName} - ${inj.status}`;
              if (isEmptyText(dbRow.homeInjuries) && summaryData.homeInjuries.length > 0) {
                updateSet.homeInjuries = summaryData.homeInjuries.map(injuryToText).join('\n') + '\n[ESPN 来源]';
              }
              if (isEmptyText(dbRow.awayInjuries) && summaryData.awayInjuries.length > 0) {
                updateSet.awayInjuries = summaryData.awayInjuries.map(injuryToText).join('\n') + '\n[ESPN 来源]';
              }
              updateSet.injuriesJson = {
                home: summaryData.homeInjuries,
                away: summaryData.awayInjuries,
                source: 'espn',
                fetchedAt: summaryData.fetchedAt,
              };
            }
          } catch (_err) {
            // injuries may not be available
          }
        }

        if (!dbRow.sourceId) updateSet.sourceId = eventId;
        if (!dbRow.sourceLeagueCode) updateSet.sourceLeagueCode = leagueCode;

        const hasRealUpdate = Object.keys(updateSet).length > 0;
        if (hasRealUpdate) {
          updateSet.updatedAt = new Date();
          updateSet.intelUpdatedAt = new Date();
          await this.db.update(matches).set(updateSet).where(eq(matches.id, dbRow.id));
          footballUpdated += 1;
        }
      } catch (err) {
        footballErrors += 1;
        this.logger.warn(
          `Football deep backfill failed for ${dbRow.homeTeam} vs ${dbRow.awayTeam}: ${this.errorMessage(err)}`,
        );
      }
    }

    // --- Basketball: fetch upcoming scoreboards for all ESPN leagues, match, enrich ---
    const bbLeagueCodes = Object.keys(ESPN_BASKETBALL_LEAGUES);
    const espnBbMatches: ESPNBasketballMatch[] = [];
    for (const code of bbLeagueCodes) {
      try {
        const result = await this.espnSource.fetchBasketballScoreboard(code);
        espnBbMatches.push(...result.matches);
      } catch (_e) {
        // skip leagues without scoreboard data
      }
    }

    const bbRows = await this.db
      .select({
        id: basketballMatches.id,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        matchStatus: basketballMatches.matchStatus,
        keyPlayers: basketballMatches.keyPlayers,
        h2hHistory: basketballMatches.h2hHistory,
        teamStats: basketballMatches.teamStats,
        recentForm: basketballMatches.recentForm,
        sourceId: basketballMatches.sourceId,
        sourceLeagueCode: basketballMatches.sourceLeagueCode,
        league: basketballMatches.league,
        updatedAt: basketballMatches.updatedAt,
      })
      .from(basketballMatches)
      .where(and(
        gte(basketballMatches.kickoffTime, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)),
        lte(basketballMatches.kickoffTime, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
        eq(basketballMatches.source, 'sporttery'),
      ));

    for (const dbRow of bbRows) {
      basketballChecked += 1;
      const isNBA = dbRow.league?.includes('NBA') || dbRow.league?.includes('美国职业');
      const isWNBA = dbRow.league?.includes('WNBA') || dbRow.league?.includes('女子');
      const lookupMap = isWNBA ? WNBA_TEAM_NAME_MAP : (isNBA ? NBA_TEAM_NAME_MAP : null);
      const findBbEngName = (cnName: string): string | null => {
        if (!lookupMap) return null;
        for (const [eng, aliases] of Object.entries(lookupMap)) {
          if (aliases.some((a: string) => cnName.includes(a) || a.includes(cnName))) return eng;
        }
        return null;
      };
      const bbHomeEng = findBbEngName(dbRow.homeTeam);
      const bbAwayEng = findBbEngName(dbRow.awayTeam);
      const bbHomeNorm = bbHomeEng ? normalizeTeamName(bbHomeEng) : normalizeTeamName(dbRow.homeTeam);
      const bbAwayNorm = bbAwayEng ? normalizeTeamName(bbAwayEng) : normalizeTeamName(dbRow.awayTeam);

      const espnMatch = espnBbMatches.find((m) => {
        const mHome = normalizeTeamName(m.homeTeam);
        const mAway = normalizeTeamName(m.awayTeam);
        const exactFwd = mHome === bbHomeNorm && mAway === bbAwayNorm;
        const exactRev = mHome === bbAwayNorm && mAway === bbHomeNorm;
        if (exactFwd || exactRev) return true;
        const fuzzyHome = mHome.includes(bbHomeNorm.slice(0, 4)) || bbHomeNorm.includes(mHome.slice(0, 4));
        const fuzzyAway = mAway.includes(bbAwayNorm.slice(0, 4)) || bbAwayNorm.includes(mAway.slice(0, 4));
        return fuzzyHome && fuzzyAway;
      });
      if (!espnMatch || !espnMatch.sourceId) continue;

      const kpObj = dbRow.keyPlayers as Record<string, unknown> | undefined | null;
      const hasKeyPlayers = kpObj && kpObj.home && kpObj.away;
      const hasH2h =
        dbRow.h2hHistory && Array.isArray(dbRow.h2hHistory) && dbRow.h2hHistory.length > 0;
      const tsObj = dbRow.teamStats as Record<string, unknown> | undefined | null;
      const hasStats = tsObj && tsObj.home && tsObj.away;
      const rfObj = dbRow.recentForm as Record<string, unknown> | undefined | null;
      const hasForm = rfObj && rfObj.home && rfObj.away;
      if (hasKeyPlayers && hasH2h && hasStats && hasForm) continue;

      try {
        const summary = await this.espnSource.fetchBasketballEventSummary(
          espnMatch.leagueCode,
          espnMatch.sourceId,
        );

        const [homeStatsRaw, awayStatsRaw] = await Promise.all([
          summary?.homeTeamId
            ? this.espnSource
                .fetchBasketballTeamStats(espnMatch.leagueCode, summary.homeTeamId)
                .then((r) => r.stats)
                .catch(() => ({}))
            : {},
          summary?.awayTeamId
            ? this.espnSource
                .fetchBasketballTeamStats(espnMatch.leagueCode, summary.awayTeamId)
                .then((r) => r.stats)
                .catch(() => ({}))
            : {},
        ]);

        let h2hItems: Array<{
          date: string;
          homeTeam: string;
          awayTeam: string;
          homeScore: number;
          awayScore: number;
        }> = [];
        try {
          const h2hResult = await this.espnSource.fetchBasketballH2h(
            espnMatch.leagueCode,
            espnMatch.sourceId,
          );
          h2hItems = h2hResult.h2h;
        } catch (_err) {
          // H2H may not be available
        }

        const updateSet: Partial<typeof basketballMatches.$inferInsert> = {};
        if (!dbRow.sourceId) updateSet.sourceId = espnMatch.sourceId;
        if (!dbRow.sourceLeagueCode) updateSet.sourceLeagueCode = espnMatch.leagueCode;
        const kpObj = dbRow.keyPlayers as Record<string, unknown> | undefined | null;
        const hasKeyPlayers = kpObj && kpObj.home && kpObj.away;
        if ((summary?.homeLeaders.length || summary?.awayLeaders.length) && !hasKeyPlayers) {
          updateSet.keyPlayers = {
            home: summary.homeLeaders,
            away: summary.awayLeaders,
          };
        }
        const rfObj = dbRow.recentForm as Record<string, unknown> | undefined | null;
        const hasForm = rfObj && rfObj.home && rfObj.away;
        if ((summary?.homeForm || summary?.awayForm) && !hasForm) {
          updateSet.recentForm = {
            home: summary.homeForm,
            away: summary.awayForm,
          };
        }
        const bbH2hEmpty = !dbRow.h2hHistory || !Array.isArray(dbRow.h2hHistory) || dbRow.h2hHistory.length === 0;
        if (h2hItems.length > 0 && bbH2hEmpty) {
          updateSet.h2hHistory = h2hItems;
        }
        const tsObj = dbRow.teamStats as Record<string, unknown> | undefined | null;
        const hasStats = tsObj && tsObj.home && tsObj.away;
        if ((Object.keys(homeStatsRaw).length > 0 || Object.keys(awayStatsRaw).length > 0) && !hasStats) {
          const homeStatsObj = {
            winRate: homeStatsRaw['Win Percentage'] || '',
            pointsPerGame: homeStatsRaw['Points Per Game'] || '',
            reboundsPerGame: homeStatsRaw['Rebounds Per Game'] || '',
            assistsPerGame: homeStatsRaw['Assists Per Game'] || '',
            fieldGoalPct: homeStatsRaw['Field Goal Percentage'] || '',
            threePointPct: homeStatsRaw['Three Point Percentage'] || '',
            gamesPlayed: homeStatsRaw['Games Played'] || homeStatsRaw['gamesPlayed'] || '',
            homeRecord: summary?.homeHomeRecord || '',
            awayRecord: '',
          };
          const awayStatsObj = {
            winRate: awayStatsRaw['Win Percentage'] || '',
            pointsPerGame: awayStatsRaw['Points Per Game'] || '',
            reboundsPerGame: awayStatsRaw['Rebounds Per Game'] || '',
            assistsPerGame: awayStatsRaw['Assists Per Game'] || '',
            fieldGoalPct: awayStatsRaw['Field Goal Percentage'] || '',
            threePointPct: awayStatsRaw['Three Point Percentage'] || '',
            gamesPlayed: awayStatsRaw['Games Played'] || awayStatsRaw['gamesPlayed'] || '',
            homeRecord: '',
            awayRecord: summary?.awayRoadRecord || '',
          };
          updateSet.teamStats = {
            home: homeStatsObj,
            away: awayStatsObj,
          };
        }

        if (Object.keys(updateSet).length > 0) {
          updateSet.updatedAt = new Date();
          updateSet.intelUpdatedAt = new Date();
          await this.db
            .update(basketballMatches)
            .set(updateSet)
            .where(eq(basketballMatches.id, dbRow.id));
          basketballUpdated += 1;
        }
      } catch (err) {
        basketballErrors += 1;
        this.logger.warn(
          `Basketball deep backfill failed for ${dbRow.homeTeam} vs ${dbRow.awayTeam}: ${this.errorMessage(err)}`,
        );
      }
    }

    this.logger.log(
      `Deep data backfill done: fb ${footballUpdated}/${footballChecked} (errors=${footballErrors}), bb ${basketballUpdated}/${basketballChecked} (errors=${basketballErrors})`,
    );
    return {
      footballChecked,
      footballUpdated,
      footballErrors,
      basketballChecked,
      basketballUpdated,
      basketballErrors,
    };
  }

  async triggerOddsApiSync(): Promise<{ sportsSynced: number; wnbaGames: number; nbaGames: number; eplGames: number; nbaUpdated: number; success: boolean; remaining: number | null; statusCode: number | null; statusMessage: string; excludedMarkets?: string[] }> {
    let wnbaGames = 0;
    let nbaGames = 0;
    let nbaUpdated = 0;
    let eplGames = 0;
    let sportsSynced = 0;
    let ok = true;
    let remaining: number | null = null;
    let lastStatusCode: number = 0;
    let statusMessage: string = '';
    let excludedMarkets: string[] | undefined;

    const wnbaResp = await this.oddsSource.fetchBasketballOdds(
      'basketball_wnba',
    );
    wnbaGames = wnbaResp.data.length;
    if (wnbaResp.remaining !== null) remaining = wnbaResp.remaining;
    lastStatusCode = wnbaResp.statusCode;
    if (wnbaResp.statusCode >= 200 && wnbaResp.statusCode < 300) {
      const { updated } = await this.updateBasketballOddsFromApi(
        wnbaResp.data,
        'WNBA',
      );
      sportsSynced += 1;
      this.logger.log(
        `Odds API WNBA manual sync: ${wnbaResp.data.length} games, updated=${updated}`,
      );
    } else {
      ok = false;
      this.logger.error(
        `Odds API WNBA manual sync failed: ${wnbaResp.statusCode} ${wnbaResp.errorMessage ?? ''}`,
      );
    }

    const nbaResp = await this.oddsSource.fetchBasketballOdds(
      'basketball_nba',
    );
    nbaGames = nbaResp.data.length;
    excludedMarkets = nbaResp.excludedMarkets;
    if (nbaResp.remaining !== null) remaining = nbaResp.remaining;
    if (nbaResp.statusCode !== 200) lastStatusCode = nbaResp.statusCode;
    if (nbaResp.statusCode >= 200 && nbaResp.statusCode < 300) {
      const { updated } = await this.updateBasketballOddsFromApi(
        nbaResp.data,
        'NBA',
      );
      nbaUpdated = updated;
      sportsSynced += 1;
      this.logger.log(
        `Odds API NBA manual sync: ${nbaResp.data.length} games, updated=${updated}, excluded=${excludedMarkets?.join(',') ?? 'none'}`,
      );
    } else {
      ok = false;
      this.logger.error(
        `Odds API NBA manual sync failed: ${nbaResp.statusCode} ${nbaResp.errorMessage ?? ''}`,
      );
    }

    const eplResp = await this.oddsSource.fetchFootballOdds(
      'soccer_epl',
    );
    eplGames = eplResp.data.length;
    if (eplResp.remaining !== null) remaining = eplResp.remaining;
    if (eplResp.statusCode !== 200) lastStatusCode = eplResp.statusCode;
    if (eplResp.statusCode >= 200 && eplResp.statusCode < 300) {
      const { updated } = await this.updateFootballOddsFromApi(
        eplResp.data,
        '英超',
      );
      sportsSynced += 1;
      this.logger.log(
        `Odds API EPL manual sync: ${eplResp.data.length} games, updated=${updated}`,
      );
    } else {
      ok = false;
      this.logger.error(
        `Odds API EPL manual sync failed: ${eplResp.statusCode} ${eplResp.errorMessage ?? ''}`,
      );
    }

    if (lastStatusCode === 429 || remaining === 0) {
       statusMessage = '指数源配额用尽，指数以官方数据源为准';
     } else if (!ok) {
       statusMessage = '指数源不可用，指数以官方数据源为准';
     } else if (ok && remaining !== null && remaining < 100) {
       statusMessage = '指数源配额紧张，指数以官方数据源为准';
    } else {
      statusMessage = '';
    }

    this.oddsApiLastSync = new Date();
    this.oddsApiLastActualRun = new Date();
    this.oddsApiSuccess = ok;
    this.oddsApiSportsSynced = sportsSynced;
    this.oddsApiTodayCount += 1;
    this.oddsApiRemaining = remaining;
    this.oddsApiStatusCode = lastStatusCode === 0 ? null : lastStatusCode;
    this.oddsApiStatusMessage = statusMessage;
    if (remaining !== null) {
      this.oddsApiQuotaThrottled = this.isOddsQuotaThrottled(remaining);
    }
    return {
      sportsSynced,
      wnbaGames,
      nbaGames,
      eplGames,
      nbaUpdated,
      success: ok,
      remaining,
      statusCode: lastStatusCode === 0 ? null : lastStatusCode,
      statusMessage,
      excludedMarkets,
    };
  }

  async receiveExternalData(
    payload: SportteryExternalPayload,
  ): Promise<SyncTriggerResult> {
    this.logger.log(
      `Received external data: football=${payload.football?.length ?? 0}, basketball=${payload.basketball?.length ?? 0}`,
    );
    let fbResult = { inserted: 0, updated: 0, skipped: 0, skipReasons: [] as { matchNo: string; reason: string }[] };
    let bbResult = { inserted: 0, updated: 0, skipped: 0, skipReasons: [] as { matchNo: string; reason: string }[] };

    if (payload.football && payload.football.length > 0) {
      const normalized: NormalizedFootballMatch[] = payload.football
        .filter((m) => m && m.matchNo && m.matchDate)
        .map((m) => ({
          matchNo: String(m.matchNo),
          matchDate: String(m.matchDate),
          businessDate:
            (m as { businessDate?: string }).businessDate || String(m.matchDate),
          league: m.league || '',
          homeTeam: m.homeTeam || '',
          awayTeam: m.awayTeam || '',
          kickoffTime: m.kickoffTime || '',
          matchStatus: m.matchStatus || 'upcoming',
          oddsOpenHome: String(m.oddsOpenHome ?? ''),
          oddsOpenDraw: String(m.oddsOpenDraw ?? ''),
          oddsOpenAway: String(m.oddsOpenAway ?? ''),
          handicap: m.handicap || '0',
          handicapRecommendation: m.handicapRecommendation ?? undefined,
          handicapOddsHome: String((m as { handicapOddsHome?: string | number }).handicapOddsHome ?? ''),
          handicapOddsDraw: String((m as { handicapOddsDraw?: string | number }).handicapOddsDraw ?? ''),
          handicapOddsAway: String((m as { handicapOddsAway?: string | number }).handicapOddsAway ?? ''),
          overUnder: m.overUnder || '2.5',
          totalGoals: String(m.totalGoals ?? '2.5'),
          totalOddsOver: String((m as { totalOddsOver?: string | number }).totalOddsOver ?? ''),
          totalOddsUnder: String((m as { totalOddsUnder?: string | number }).totalOddsUnder ?? ''),
          source: m.source,
        }));
      const valid: NormalizedFootballMatch[] = [];
      for (const item of normalized) {
        const v = this.validateFootballMatch(item);
        if (v.ok) valid.push(item);
        else {
          fbResult.skipped += 1;
          fbResult.skipReasons.push({ matchNo: item.matchNo, reason: v.reason ?? 'validation failed' });
        }
      }
      const upsertResult = await this.upsertFootballMatches(valid);
      fbResult.inserted = upsertResult.inserted;
      fbResult.updated = upsertResult.updated;
      fbResult.skipped += upsertResult.skipped;
      this.lastSyncAt.football = new Date();
      this.lastSyncStatus.football = {
        statusCode: 200,
        success: true,
        inserted: fbResult.inserted,
        updated: fbResult.updated,
        skipped: fbResult.skipped,
        message: `external data: inserted=${fbResult.inserted}, updated=${fbResult.updated}, skipped=${fbResult.skipped}`,
      };
    }

    if (payload.basketball && payload.basketball.length > 0) {
      const normalized: NormalizedBasketballMatch[] = payload.basketball
        .filter((m) => m && m.matchNo && m.matchDate)
        .map((m) => ({
          matchNo: String(m.matchNo),
          matchDate: String(m.matchDate),
          businessDate: String(m.matchDate),
          league: m.league || '',
          homeTeam: m.homeTeam || '',
          awayTeam: m.awayTeam || '',
          kickoffTime: m.kickoffTime || '',
          matchStatus: m.matchStatus || 'upcoming',
          handicap: m.handicap || '0',
          handicapHf: String((m as { handicapHf?: string | number }).handicapHf ?? '0'),
          handicapAf: String((m as { handicapAf?: string | number }).handicapAf ?? '0'),
          totalLine: m.totalLine || '',
          homeWinOdds: String(m.homeWinOdds ?? ''),
          awayWinOdds: String(m.awayWinOdds ?? ''),
          handicapOddsHome: String(m.handicapOddsHome ?? ''),
          handicapOddsAway: String(m.handicapOddsAway ?? ''),
          totalOddsOver: String(m.totalOddsOver ?? ''),
          totalOddsUnder: String(m.totalOddsUnder ?? ''),
          source: m.source,
        }));
      const validBb: NormalizedBasketballMatch[] = [];
      for (const item of normalized) {
        const v = this.validateBasketballMatch(item);
        if (v.ok) validBb.push(item);
        else {
          bbResult.skipped += 1;
          bbResult.skipReasons.push({ matchNo: item.matchNo, reason: v.reason ?? 'validation failed' });
        }
      }
      const upsertBbResult = await this.upsertBasketballMatches(validBb);
      bbResult.inserted = upsertBbResult.inserted;
      bbResult.updated = upsertBbResult.updated;
      bbResult.skipped += upsertBbResult.skipped;
      this.lastSyncAt.basketball = new Date();
      this.lastSyncStatus.basketball = {
        statusCode: 200,
        success: true,
        inserted: bbResult.inserted,
        updated: bbResult.updated,
        skipped: bbResult.skipped,
        message: `external data: inserted=${bbResult.inserted}, updated=${bbResult.updated}, skipped=${bbResult.skipped}`,
      };
    }

    this.sportteryExternalLastSync = new Date();
    this.sportteryExternalSuccess = true;
    this.sportteryDirectStatus = 'degraded';
    this.externalTodayCount += 1;

    if (this.staleCount > 0) this.staleCount = 0;
    return { football: fbResult, basketball: bbResult };
  }

  // --- Beidan (北单) active fetch from zgzcw ---

  private async fetchBeidanPage(lotteryId: 200 | 210): Promise<BeidanMatch[]> {
    const url = `https://cp.zgzcw.com/lottery/bdplayvsforJsp.action?lotteryId=${lotteryId}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://cp.zgzcw.com/',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status !== 200 && response.status !== 418) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    if (!html || html.length < 1000) {
      throw new Error('Empty or too-short response');
    }

    let issue = '';
    const selectMatch = html.match(/<select[^>]*id="selectissue"[^>]*>([\s\S]*?)<\/select>/i);
    if (selectMatch) {
      const selectedMatch = selectMatch[1].match(/<option[^>]*selected[^>]*value="([^"]+)"/i);
      if (selectedMatch) {
        issue = selectedMatch[1];
      } else {
        const firstOptionMatch = selectMatch[1].match(/<option[^>]*value="([^"]+)"/i);
        if (firstOptionMatch) issue = firstOptionMatch[1];
      }
    }
    if (!issue) {
      const preview = html.slice(0, 300).replace(/\s+/g, ' ');
      throw new Error(`Cannot extract issue number (htmlLen=${html.length}, preview=${preview})`);
    }

    const trRegex = /<tr\s+show="1"[^>]*>([\s\S]*?)<\/tr>/gi;
    const items: BeidanMatch[] = [];
    let trMatch: RegExpExecArray | null;

    while ((trMatch = trRegex.exec(html)) !== null) {
      const trHtml = trMatch[0];
      const trInner = trMatch[1];

      const mMatch = trHtml.match(/\s+m="([^"]*)"/);
      const rqMatch = trHtml.match(/\s+rq="([^"]*)"/);
      const iMatch = trHtml.match(/\s+i="([^"]*)"/);
      const tMatch = trHtml.match(/\s+t="([^"]*)"/);

      const league = mMatch ? mMatch[1] : '';
      const handicapAttr = rqMatch ? rqMatch[1] : '0';
      const matchNoRaw = iMatch ? iMatch[1] : '';
      const kickoffRaw = tMatch ? tMatch[1] : '';

      if (!matchNoRaw || !kickoffRaw) continue;

      const homeMatch = trInner.match(/<td[^>]*class="[^"]*wh-4[^"]*t-r[^"]*"[^>]*tn="([^"]*)"/i);
      const homeTeam = homeMatch ? homeMatch[1] : '';

      const awayMatch = trInner.match(/<td[^>]*class="[^"]*wh-6[^"]*t-l[^"]*"[^>]*tn="([^"]*)"/i);
      const awayTeam = awayMatch ? awayMatch[1] : '';

      if (!homeTeam || !awayTeam) continue;

      let handicap = handicapAttr;
      let hspHome = '';
      let hspDraw = '';
      let hspAway = '';
      const wh8Match = trInner.match(/<td[^>]*class="[^"]*wh-8[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
      if (wh8Match) {
        const wh8Html = wh8Match[1];
        const rqEmMatch = wh8Html.match(/<em[^>]*class="[^"]*rq[^"]*"[^>]*>([^<]*)<\/em>/i);
        if (rqEmMatch && rqEmMatch[1].trim() !== '') {
          handicap = rqEmMatch[1].trim();
        }
        const aRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
        const spVals: string[] = [];
        let aMatch2: RegExpExecArray | null;
        while ((aMatch2 = aRegex.exec(wh8Html)) !== null && spVals.length < 3) {
          const raw = aMatch2[1].replace(/<[^>]+>/g, '').trim();
          spVals.push(raw);
        }
        if (spVals.length > 0) hspHome = spVals[0];
        if (spVals.length > 1) hspDraw = spVals[1];
        if (spVals.length > 2) hspAway = spVals[2];
      }

      let spHome = '';
      let spDraw = '';
      let spAway = '';
      let totalOverSp = '';
      let totalUnderSp = '';
      if (lotteryId === 200) {
        const wh11Match = trInner.match(/<td[^>]*class="[^"]*wh-11[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
        if (wh11Match) {
          const text = wh11Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const parts = text.split(/\s+/);
          const nums = parts.filter((p: string) => !Number.isNaN(Number(p)) && Number(p) > 0);
          if (nums.length >= 1) spHome = nums[0];
          if (nums.length >= 2) spDraw = nums[1];
          if (nums.length >= 3) spAway = nums[2];
        }
      } else if (lotteryId === 210) {
        const wh7Match = trInner.match(/<td[^>]*class="[^"]*wh-7[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
        if (wh7Match) {
          const text = wh7Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const parts = text.split(/\s+/);
          const nums = parts.filter((p: string) => !Number.isNaN(Number(p)) && Number(p) > 0);
          if (nums.length >= 4) {
            const overOdd = Number(nums[0]);
            const overEven = Number(nums[1]);
            const underOdd = Number(nums[2]);
            const underEven = Number(nums[3]);
            if (overOdd > 0 && overEven > 0) {
              totalOverSp = String(1 / (1 / overOdd + 1 / overEven));
            }
            if (underOdd > 0 && underEven > 0) {
              totalUnderSp = String(1 / (1 / underOdd + 1 / underEven));
            }
          }
        }
      }

      const bfMatch = trInner.match(/<td[^>]*class="[^"]*wh-5[^"]*bf[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
      const scoreText = bfMatch ? bfMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      // Parse structured score from "数字-数字" format (e.g. "1-0", "2-1", "0-0")
      // Non-score text like "vs", "延期", or empty string skips parsing.
      let scoreHome: number | undefined;
      let scoreAway: number | undefined;
      if (scoreText) {
        const scoreMatch = scoreText.match(/^(\d+)-(\d+)$/);
        if (scoreMatch) {
          scoreHome = parseInt(scoreMatch[1], 10);
          scoreAway = parseInt(scoreMatch[2], 10);
        }
      }

      const matchDate = kickoffRaw.slice(0, 10);
      const kickoffBeijing = `${kickoffRaw.replace(' ', 'T')}+08:00`;
      let kickoffIso = '';
      try {
        const kickoffDate = new Date(kickoffBeijing);
        if (!Number.isNaN(kickoffDate.getTime())) {
          kickoffIso = kickoffDate.toISOString();
        }
      } catch {
        // ignore
      }

      // 北单源只有赛前赔率和即时比分文字展示，没有权威赛果回传。
      // 始终保持为 upcoming，finished 状态和真实比分由球美宝/ESPN 等源回填。
      const matchStatus = 'upcoming';

      const paddedNo = String(parseInt(matchNoRaw, 10) || 0).padStart(3, '0');
      const fullMatchNo = `beidan-${issue}-${paddedNo}`;

      items.push({
        matchNo: fullMatchNo,
        matchDate,
        league,
        homeTeam,
        awayTeam,
        kickoffTime: kickoffIso || undefined,
        handicap,
        spHome: spHome || undefined,
        spDraw: spDraw || undefined,
        spAway: spAway || undefined,
        handicapSpHome: hspHome || undefined,
        handicapSpDraw: hspDraw || undefined,
        handicapSpAway: hspAway || undefined,
        totalOverSp: totalOverSp || undefined,
        totalUnderSp: totalUnderSp || undefined,
        matchStatus,
        score: scoreText || undefined,
        scoreHome,
        scoreAway,
        oddsSource: 'zgzcw.com',
      });
    }

    return items;
  }

  private async runBeidanSync(): Promise<BeidanSyncResult> {
    try {
      this.logger.log('Fetching beidan data from zgzcw (lotteryId=200)...');
      const wdwItems = await this.fetchBeidanPage(200);
      this.logger.log(`Beidan lotteryId=200: ${wdwItems.length} matches parsed`);

      let totalOverUnderItems: BeidanMatch[] = [];
      try {
        totalOverUnderItems = await this.fetchBeidanPage(210);
        this.logger.log(`Beidan lotteryId=210: ${totalOverUnderItems.length} matches parsed`);
      } catch (err2) {
        this.logger.warn(`Beidan lotteryId=210 fetch failed: ${this.errorMessage(err2)}`);
      }

      const merged = new Map<string, BeidanMatch>();
      for (const item of wdwItems) {
        merged.set(String(item.matchNo), { ...item });
      }
      for (const item of totalOverUnderItems) {
        const key = String(item.matchNo);
        const existing = merged.get(key);
        if (existing) {
          existing.totalOverSp = item.totalOverSp ?? existing.totalOverSp;
          existing.totalUnderSp = item.totalUnderSp ?? existing.totalUnderSp;
        } else {
          merged.set(key, { ...item });
        }
      }

      const items: BeidanMatch[] = Array.from(merged.values());
      if (items.length === 0) {
         this.logger.warn('Beidan sync: 0 matches parsed from page');
         this.beidanLastSync = new Date();
         return { inserted: 0, updated: 0, skipped: 0, skipReasons: [] };
       }

      const issue = items[0].matchNo?.toString().split('-')[1] ?? '';
      this.logger.log(
        `Beidan sync: parsed ${items.length} matches (wdw=${wdwItems.length}, ou=${totalOverUnderItems.length}), issue=${issue}, source=zgzcw.com`,
      );
      return await this.receiveBeidanData(items);
    } catch (err) {
      this.logger.error(`Beidan fetch failed: ${this.errorMessage(err)}`);
      return {
        inserted: 0,
        updated: 0,
        skipped: 0,
        skipReasons: [{ matchNo: '', reason: this.errorMessage(err) }],
      };
    }
  }

  // --- Beidan (北单) external sync ---

  async receiveBeidanData(items: BeidanMatch[]): Promise<BeidanSyncResult> {
    this.logger.log(`Received beidan data: ${items.length} matches`);
    const result: BeidanSyncResult = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      skipReasons: [],
    };

    const valid: BeidanMatch[] = [];
    for (const item of items) {
      const matchNo = String(item.matchNo ?? '').trim();
      const matchDate = String(item.matchDate ?? '').trim();
      const homeTeam = item.homeTeam?.trim() ?? '';
      const awayTeam = item.awayTeam?.trim() ?? '';

      if (!matchNo || !matchDate) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'matchNo or matchDate missing' });
        continue;
      }
      if (!homeTeam || !awayTeam) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'homeTeam or awayTeam missing' });
        continue;
      }
      if (homeTeam === awayTeam) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'homeTeam equals awayTeam' });
        continue;
      }

      valid.push({
        ...item,
        matchNo,
        matchDate,
        homeTeam,
        awayTeam,
      });
    }

    const upsertResult = await this.upsertBeidanMatches(valid);
    result.inserted = upsertResult.inserted;
    result.updated = upsertResult.updated;

    this.beidanLastSync = new Date();
    this.beidanSuccess = true;
    this.beidanTodayCount += 1;

    if (this.staleCount > 0) this.staleCount = 0;
    this.logger.log(
      `Beidan sync complete: inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}`,
    );
    return result;
  }

  private async upsertBeidanMatches(
    items: BeidanMatch[],
  ): Promise<{ inserted: number; updated: number }> {
    if (items.length === 0) return { inserted: 0, updated: 0 };

    let inserted = 0;
    let updated = 0;

    const sorted = [...items].sort((a, b) =>
      String(a.matchNo).localeCompare(String(b.matchNo)),
    );

    await this.runWithDeadlockRetry(async (tx) => {
      await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
      for (const item of sorted) {
        const matchNo = String(item.matchNo);
        const matchDate = String(item.matchDate);
        const oddsH = Number(item.spHome ?? 0);
        const oddsD = Number(item.spDraw ?? 0);
        const oddsA = Number(item.spAway ?? 0);
        const handicapStr = item.handicap ?? '0';

        const hasPredictionInput =
          item.homeWinProb !== undefined &&
          item.drawProb !== undefined &&
          item.awayWinProb !== undefined;

        // Lookup existing by matchNo + matchDate + source='beidan'
        const existing = await tx
          .select({
            id: matches.id,
            matchStatus: matches.matchStatus,
            confidence: matches.confidence,
            predictionDirection: matches.predictionDirection,
            oddsOpenHome: matches.oddsOpenHome,
            oddsOpenDraw: matches.oddsOpenDraw,
            oddsOpenAway: matches.oddsOpenAway,
            handicap: matches.handicap,
            totalGoals: matches.totalGoals,
            handicapRecommendation: matches.handicapRecommendation,
            totalPick: matches.totalPick,
          })
          .from(matches)
          .where(
            and(
              eq(matches.matchNo, matchNo),
              eq(matches.matchDate, matchDate),
              eq(matches.source, 'beidan'),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          const row = existing[0];
          const updateSet: Record<string, unknown> = {
            updatedAt: sql`CURRENT_TIMESTAMP`,
          };

          // --- PATCH: odds fields (oddsOpen locked after first write) ---
          const newOddsHome = this.validOddsOrNull(item.spHome);
          const newOddsDraw = this.validOddsOrNull(item.spDraw);
          const newOddsAway = this.validOddsOrNull(item.spAway);
          const dbOpenHome = row.oddsOpenHome != null ? String(row.oddsOpenHome) : null;
          const dbOpenDraw = row.oddsOpenDraw != null ? String(row.oddsOpenDraw) : null;
          const dbOpenAway = row.oddsOpenAway != null ? String(row.oddsOpenAway) : null;
          if (dbOpenHome === null && newOddsHome !== null) updateSet.oddsOpenHome = newOddsHome;
          if (dbOpenDraw === null && newOddsDraw !== null) updateSet.oddsOpenDraw = newOddsDraw;
          if (dbOpenAway === null && newOddsAway !== null) updateSet.oddsOpenAway = newOddsAway;
          if (newOddsHome !== null) updateSet.oddsLiveHome = newOddsHome;
          if (newOddsDraw !== null) updateSet.oddsLiveDraw = newOddsDraw;
          if (newOddsAway !== null) updateSet.oddsLiveAway = newOddsAway;

          // --- PATCH: handicap odds (SP for let-ball market) ---
          const newHandicapSpHome = this.validOddsOrNull(item.handicapSpHome);
          const newHandicapSpDraw = this.validOddsOrNull(item.handicapSpDraw);
          const newHandicapSpAway = this.validOddsOrNull(item.handicapSpAway);
          if (newHandicapSpHome !== null) updateSet.handicapOddsHome = newHandicapSpHome;
          if (newHandicapSpDraw !== null) updateSet.handicapOddsDraw = newHandicapSpDraw;
          if (newHandicapSpAway !== null) updateSet.handicapOddsAway = newHandicapSpAway;

          // --- PATCH: total odds (over/under SP from lotteryId=210) ---
          const newTotalOver = this.validOddsOrNull(item.totalOverSp);
          const newTotalUnder = this.validOddsOrNull(item.totalUnderSp);
          if (newTotalOver !== null) updateSet.totalOddsOver = newTotalOver;
          if (newTotalUnder !== null) updateSet.totalOddsUnder = newTotalUnder;

          // --- PATCH: handicap (non-empty string only) ---
          if (this.isNonEmptyStr(handicapStr)) {
            updateSet.handicap = handicapStr;
          }

          // --- PATCH: totalGoals (non-empty only; no default on update) ---
          const newTotalGoals = this.numStrOrNull(item.totalGoals);
          if (newTotalGoals !== null) {
            updateSet.totalGoals = newTotalGoals;
          }

          // --- PATCH: kickoffTime / league / score ---
          if (item.kickoffTime) {
            updateSet.kickoffTime = new Date(item.kickoffTime);
          }
          if (item.league !== undefined && item.league !== '') {
            updateSet.league = item.league;
          }
          if (item.score !== undefined && item.score !== '') {
             updateSet.mostLikelyScore = item.score;
           }

           // --- PATCH: structured home/away score from beidan source ---
           // 北单源的比分文字（如 "1-0"）解析为结构化比分，写入 home_score/away_score。
           // most_likely_score 继续保留原始文字作为展示备用，不破坏现有逻辑。
           const hasValidScore =
             item.scoreHome !== undefined
             && item.scoreAway !== undefined
             && !Number.isNaN(item.scoreHome)
             && !Number.isNaN(item.scoreAway)
             && item.scoreHome >= 0
             && item.scoreAway >= 0;
           if (hasValidScore) {
             updateSet.homeScore = item.scoreHome;
             updateSet.awayScore = item.scoreAway;
             updateSet.lastScoreAt = sql`CURRENT_TIMESTAMP`;
             updateSet.liveScoreSource = 'zgzcw';
             // 有比分说明比赛在进行中或已结束，从 upcoming/score_pending 推进到 live。
             // 注意：不推进到 finished，北单源不是权威终场源。
             // finished 仍由球美宝/ESPN fallback 或 stale backstop 决定。
             if (row.matchStatus === 'upcoming' || row.matchStatus === 'score_pending') {
               updateSet.matchStatus = 'live';
             }
           }

           // 北单源没有权威赛果回传，禁止自行推进到 finished。
           // 状态和比分必须由球美宝/ESPN 等权威源通过 cross-source match 回填。
           // 仅允许 upcoming→live 用于即时比分文字展示，finished 一律阻断。
           if (
             item.matchStatus
             && row.matchStatus === 'upcoming'
             && item.matchStatus !== 'upcoming'
             && item.matchStatus !== 'finished'
           ) {
             updateSet.matchStatus = item.matchStatus;
           }

          // --- Detect handicap / odds / totalGoals changes for recalc ---
          const dbOddsHome = row.oddsOpenHome != null ? String(row.oddsOpenHome) : null;
          const dbOddsDraw = row.oddsOpenDraw != null ? String(row.oddsOpenDraw) : null;
          const dbOddsAway = row.oddsOpenAway != null ? String(row.oddsOpenAway) : null;
          const dbTotalGoals = row.totalGoals != null ? String(row.totalGoals) : null;
          const oddsChanged =
            (newOddsHome !== null && dbOddsHome !== newOddsHome) ||
            (newOddsDraw !== null && dbOddsDraw !== newOddsDraw) ||
            (newOddsAway !== null && dbOddsAway !== newOddsAway);
          const handicapChanged =
            this.isNonEmptyStr(handicapStr) && row.handicap !== handicapStr;
          const totalGoalsChanged =
            newTotalGoals !== null && dbTotalGoals !== newTotalGoals;
          const shouldRecalc = oddsChanged || handicapChanged || totalGoalsChanged;

          // --- PATCH: prediction fields ---
          // Priority: provided predictions from payload > recalc on odds change > keep existing
          let appliedPrediction: ReturnType<typeof this.generateFootballPrediction> = null;
          const hasProvidedPred =
            item.homeWinProb !== undefined ||
            item.drawProb !== undefined ||
            item.awayWinProb !== undefined ||
            item.predictionDirection !== undefined ||
            item.confidence !== undefined ||
            item.intel !== undefined;

          if (hasProvidedPred) {
            // PATCH: only write fields that are actually provided and non-empty
            if (item.homeWinProb !== undefined) updateSet.homeWinProb = item.homeWinProb;
            if (item.drawProb !== undefined) updateSet.drawProb = item.drawProb;
            if (item.awayWinProb !== undefined) updateSet.awayWinProb = item.awayWinProb;
            if (this.isNonEmptyStr(item.predictionDirection)) {
              updateSet.predictionDirection = item.predictionDirection;
            }
            if (item.confidence !== undefined) {
              updateSet.confidence = item.confidence;
              updateSet.lowConfidence = item.confidence < 50;
            }
            if (this.isNonEmptyStr(item.intel)) {
              updateSet.intel = item.intel;
            }
          } else if (shouldRecalc && oddsH > 0 && oddsD > 0 && oddsA > 0) {
            // Odds/handicap changed → full recalc and overwrite all prediction fields
            // P0-1 赛中方向锁定：live/finished 场保留赛前方向，不被赔率波动重算覆盖
            const isLiveOrFinished = row.matchStatus === 'live'
              || row.matchStatus === 'in-play'
              || row.matchStatus === 'finished';
            const hasPreMatchDir = this.isNonEmptyStr(row.predictionDirection)
              && row.predictionDirection !== '观望';
            const hasPreMatchHc = this.isNonEmptyStr(row.handicapRecommendation)
              && row.handicapRecommendation !== '观望';
            const hasPreMatchTotal = this.isNonEmptyStr(row.totalPick)
              && row.totalPick !== '观望';
            appliedPrediction = this.generateFootballPrediction(
              oddsH, oddsD, oddsA, handicapStr,
              this.numStrOrNull(item.totalGoals) ?? undefined,
            );
            if (appliedPrediction) {
              updateSet.homeWinProb = appliedPrediction.homeWinProb;
              updateSet.drawProb = appliedPrediction.drawProb;
              updateSet.awayWinProb = appliedPrediction.awayWinProb;
              updateSet.confidence = appliedPrediction.confidence;
              updateSet.lowConfidence = appliedPrediction.lowConfidence;
              updateSet.handicapWinProb = String(appliedPrediction.handicapWinProb);
              updateSet.handicapDrawProb = String(appliedPrediction.handicapDrawProb);
              updateSet.handicapLoseProb = String(appliedPrediction.handicapLoseProb);
              updateSet.handicapSecondChoice = appliedPrediction.handicapSecondChoice;
              updateSet.overProb = appliedPrediction.overProb;
              updateSet.underProb = appliedPrediction.underProb;
              updateSet.totalPickProb = appliedPrediction.totalPickProb;
              updateSet.mostLikelyScore = appliedPrediction.mostLikelyScore;
              updateSet.scoreProbs = appliedPrediction.scoreProbs;
              updateSet.totalGoalsProb = appliedPrediction.totalGoalsProb;
              updateSet.halfFullProb = appliedPrediction.halfFullProb;
              updateSet.modelRules = appliedPrediction.modelRules;
              updateSet.predEngineVersion = FOOTBALL_MODEL_VERSION;
              if (isLiveOrFinished && hasPreMatchDir) {
                // 锁定赛前胜平负方向，跳过重算写入
              } else {
                updateSet.predictionDirection = appliedPrediction.predictionDirection;
              }
              if (isLiveOrFinished && hasPreMatchHc) {
                // 锁定赛前让球方向，跳过重算写入
              } else {
                updateSet.handicapRecommendation = appliedPrediction.handicapRecommendation;
              }
              if (isLiveOrFinished && hasPreMatchTotal) {
                // 锁定赛前大小球方向，跳过重算写入
              } else {
                updateSet.totalPick = appliedPrediction.totalPick;
              }
              appliedPrediction = null; // already written into updateSet
            }
          } else if (
            !hasProvidedPred &&
            oddsH > 0 && oddsD > 0 && oddsA > 0 &&
            row.confidence === 35 &&
            row.predictionDirection === '观望'
          ) {
            // Baseline default (35/30/35 + 观望) with valid odds → force recalc
            // Catches cold-start / legacy bad data where prediction was never computed
            appliedPrediction = this.generateFootballPrediction(
              oddsH, oddsD, oddsA, handicapStr,
              this.numStrOrNull(item.totalGoals) ?? undefined,
            );
            if (appliedPrediction) {
              updateSet.homeWinProb = appliedPrediction.homeWinProb;
              updateSet.drawProb = appliedPrediction.drawProb;
              updateSet.awayWinProb = appliedPrediction.awayWinProb;
              updateSet.predictionDirection = appliedPrediction.predictionDirection;
              updateSet.confidence = appliedPrediction.confidence;
              updateSet.lowConfidence = appliedPrediction.lowConfidence;
              updateSet.handicapRecommendation = appliedPrediction.handicapRecommendation;
              updateSet.handicapWinProb = String(appliedPrediction.handicapWinProb);
              updateSet.handicapDrawProb = String(appliedPrediction.handicapDrawProb);
              updateSet.handicapLoseProb = String(appliedPrediction.handicapLoseProb);
              updateSet.handicapSecondChoice = appliedPrediction.handicapSecondChoice;
              updateSet.overProb = appliedPrediction.overProb;
              updateSet.underProb = appliedPrediction.underProb;
              updateSet.totalPick = appliedPrediction.totalPick;
              updateSet.totalPickProb = appliedPrediction.totalPickProb;
              updateSet.mostLikelyScore = appliedPrediction.mostLikelyScore;
              updateSet.scoreProbs = appliedPrediction.scoreProbs;
              updateSet.totalGoalsProb = appliedPrediction.totalGoalsProb;
              updateSet.halfFullProb = appliedPrediction.halfFullProb;
              updateSet.modelRules = appliedPrediction.modelRules;
              updateSet.predEngineVersion = FOOTBALL_MODEL_VERSION;
            }
          }

          const hasPredictionUpdate = hasProvidedPred || appliedPrediction !== null;
          if (hasPredictionUpdate) {
             const rowOddsEmpty = dbOddsHome === null && dbOddsDraw === null && dbOddsAway === null;
             const updateOddsEmpty = newOddsHome === null && newOddsDraw === null && newOddsAway === null;
             if (rowOddsEmpty && updateOddsEmpty && !hasProvidedPred) {
               this.applyFootballDataInsufficientGuard(updateSet);
             } else {
               this.finalizeFootballPick(updateSet, row.handicapRecommendation ?? null, rowOddsEmpty);
             }
             this.applyBeidanDataQualityGuard(updateSet);
           }
          await tx.update(matches).set(updateSet).where(eq(matches.id, row.id));

          // --- Write odds snapshots if odds changed ---
          const sourceStr = 'beidan';
          // 1x2
          if (updateSet.oddsLiveHome !== undefined || updateSet.oddsLiveDraw !== undefined || updateSet.oddsLiveAway !== undefined) {
            const h = newOddsHome ? Number(newOddsHome) : 0;
            const d = newOddsDraw ? Number(newOddsDraw) : 0;
            const a = newOddsAway ? Number(newOddsAway) : 0;
            if (h > 0 || d > 0 || a > 0) {
              await insertFootballOddsSnapshotIfChanged(
                tx, row.id, '1x2',
                { home: h > 0 ? h : undefined, draw: d > 0 ? d : undefined, away: a > 0 ? a : undefined },
                sourceStr,
              );
            }
          }
          // handicap
          if (updateSet.handicapOddsHome !== undefined || updateSet.handicapOddsDraw !== undefined || updateSet.handicapOddsAway !== undefined || updateSet.handicap !== undefined) {
            const hh = newHandicapSpHome ? Number(newHandicapSpHome) : 0;
            const hd = newHandicapSpDraw ? Number(newHandicapSpDraw) : 0;
            const ha = newHandicapSpAway ? Number(newHandicapSpAway) : 0;
            const hLine = handicapStr ? Number(handicapStr) : undefined;
            if (hh > 0 || hd > 0 || ha > 0) {
              await insertFootballOddsSnapshotIfChanged(
                tx, row.id, 'handicap',
                { home: hh > 0 ? hh : undefined, draw: hd > 0 ? hd : undefined, away: ha > 0 ? ha : undefined, line: hLine },
                sourceStr,
              );
            }
          }
          // total
          if (updateSet.totalOddsOver !== undefined || updateSet.totalOddsUnder !== undefined || updateSet.totalGoals !== undefined) {
            const to = newTotalOver ? Number(newTotalOver) : 0;
            const tu = newTotalUnder ? Number(newTotalUnder) : 0;
            const tLine = newTotalGoals ? Number(newTotalGoals) : undefined;
            if (to > 0 || tu > 0) {
              await insertFootballOddsSnapshotIfChanged(
                tx, row.id, 'total',
                { over: to > 0 ? to : undefined, under: tu > 0 ? tu : undefined, line: tLine },
                sourceStr,
              );
            }
          }

          updated += 1;
        } else {
          // Insert new record
          let prediction: ReturnType<typeof this.generateFootballPrediction> = null;
          const insertOddsValid = oddsH > 0 && oddsD > 0 && oddsA > 0;
          if (!hasPredictionInput && insertOddsValid) {
             prediction = this.generateFootballPrediction(
               oddsH, oddsD, oddsA, handicapStr,
               this.numStrOrNull(item.totalGoals) ?? undefined,
             );
           }

          const homeWinProb = hasPredictionInput ? (item.homeWinProb ?? 0) : (prediction?.homeWinProb ?? 0);
          const drawProb = hasPredictionInput ? (item.drawProb ?? 0) : (prediction?.drawProb ?? 0);
          const awayWinProb = hasPredictionInput ? (item.awayWinProb ?? 0) : (prediction?.awayWinProb ?? 0);
          const predictionDirection = hasPredictionInput
            ? (item.predictionDirection ?? '')
            : (prediction?.predictionDirection ?? '');
          const confidence = hasPredictionInput
            ? (item.confidence ?? 0)
            : (prediction?.confidence ?? 0);
          const lowConfidence = hasPredictionInput
            ? (item.confidence ?? 0) < 50
            : (prediction?.lowConfidence ?? false);
          const handicapRecommendation = hasPredictionInput
            ? ''
            : (prediction?.handicapRecommendation ?? '');
          const handicapWinProb = prediction?.handicapWinProb ?? 0;
          const handicapDrawProb = prediction?.handicapDrawProb ?? 0;
          const handicapLoseProb = prediction?.handicapLoseProb ?? 0;
          const handicapSecondChoice = prediction?.handicapSecondChoice ?? '';
          const overProb = prediction?.overProb ?? 50;
          const underProb = prediction?.underProb ?? 50;
          const totalPick = prediction?.totalPick ?? '';
          const totalPickProb = prediction?.totalPickProb ?? 50;
          const mostLikelyScore = item.score ?? prediction?.mostLikelyScore ?? '';
          const totalGoalsProb = prediction?.totalGoalsProb ?? [];
          const halfFullProb = prediction?.halfFullProb ?? [];
          const modelRules = hasPredictionInput ? [] : (prediction?.modelRules ?? []);

          // Structured score from beidan source (insert path)
          const hasValidScore =
            item.scoreHome !== undefined
            && item.scoreAway !== undefined
            && !Number.isNaN(item.scoreHome)
            && !Number.isNaN(item.scoreAway)
            && item.scoreHome >= 0
            && item.scoreAway >= 0;
          const insertHomeScore = hasValidScore ? item.scoreHome : null;
          const insertAwayScore = hasValidScore ? item.scoreAway : null;
          const insertLastScoreAt = hasValidScore ? sql`CURRENT_TIMESTAMP` : null;
          const insertLiveScoreSource = hasValidScore ? 'zgzcw' : '';
          // 有比分时从 upcoming 推进到 live；不推进到 finished（北单非权威终场源）
          const insertMatchStatus = hasValidScore && (item.matchStatus ?? 'upcoming') === 'upcoming'
            ? 'live'
            : (item.matchStatus ?? 'upcoming');

          let insertObj = {
            matchNo,
            matchDate,
            businessDate: matchDate,
            league: item.league ?? '',
            homeTeam: item.homeTeam ?? '',
            awayTeam: item.awayTeam ?? '',
            kickoffTime: item.kickoffTime ? new Date(item.kickoffTime) : new Date(matchDate),
            matchStatus: insertMatchStatus,
             source: 'beidan',
              liveScoreSource: insertLiveScoreSource,
              oddsOpenHome: this.validOddsOrNull(item.spHome),
              oddsOpenDraw: this.validOddsOrNull(item.spDraw),
              oddsOpenAway: this.validOddsOrNull(item.spAway),
               oddsLiveHome: this.validOddsOrNull(item.spHome),
               oddsLiveDraw: this.validOddsOrNull(item.spDraw),
               oddsLiveAway: this.validOddsOrNull(item.spAway),
               handicapOddsHome: this.validOddsOrNull(item.handicapSpHome),
               handicapOddsDraw: this.validOddsOrNull(item.handicapSpDraw),
               handicapOddsAway: this.validOddsOrNull(item.handicapSpAway),
               totalOddsOver: this.validOddsOrNull(item.totalOverSp),
               totalOddsUnder: this.validOddsOrNull(item.totalUnderSp),
              handicap: handicapStr,
             handicapRecommendation,
             handicapWinProb: String(handicapWinProb),
             handicapDrawProb: String(handicapDrawProb),
             handicapLoseProb: String(handicapLoseProb),
             handicapSecondChoice,
             overUnder: '2.5',
             overProb,
             underProb,
             totalPick,
             totalPickProb,
             totalGoals: this.numStrOrNull(item.totalGoals) ?? '2.5',
             homeWinProb,
             drawProb,
             awayWinProb,
             predictionDirection,
             confidence,
             lowConfidence,
             intel: item.intel ?? '',
             modelRules,
             mostLikelyScore,
             homeScore: insertHomeScore,
             awayScore: insertAwayScore,
             lastScoreAt: insertLastScoreAt,
             totalGoalsProb,
             halfFullProb,
             tacticsHome: '',
             tacticsAway: '',
             keyPlayersHome: '',
             keyPlayersAway: '',
             upsetWarning: '',
             predEngineVersion: FOOTBALL_MODEL_VERSION,
             handicapConfidence: '低',
             ouConfidence: '低',
           };
           if (!insertOddsValid && !hasPredictionInput) {
             this.applyFootballDataInsufficientGuard(insertObj);
           } else {
             this.finalizeFootballPick(insertObj);
           }
           this.applyBeidanDataQualityGuard(insertObj);
          const insertedRows = await tx.insert(matches)
            .values(insertObj)
            .onConflictDoNothing({
              target: [matches.matchNo, matches.businessDate],
            })
            .returning({ id: matches.id });
          if (insertedRows.length > 0) {
            inserted += 1;
          }
        }
      }
    });

    return { inserted, updated };
  }

  // --- Ingest endpoints (unified external data intake) ---

  async ingestFootball(items: IngestFootballItem[]): Promise<IngestResult> {
    this.logger.log(`[ingest] football: ${items.length} items`);
    const result: IngestResult = { inserted: 0, updated: 0, skipped: 0, skipReasons: [] };

    const valid: NormalizedFootballMatch[] = [];
    const providedPredictions = new Map<string, IngestFootballItem>();

    for (const item of items) {
      const matchNo = String(item.matchNo ?? '').trim();
      const matchDate = String(item.matchDate ?? '').trim();
      const homeTeam = item.homeTeam?.trim() ?? '';
      const awayTeam = item.awayTeam?.trim() ?? '';

      if (!matchNo || !matchDate) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'matchNo or matchDate missing' });
        continue;
      }
      if (!homeTeam || !awayTeam) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'homeTeam or awayTeam missing' });
        continue;
      }
      if (homeTeam === awayTeam) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'homeTeam equals awayTeam' });
        continue;
      }

      const normalized: NormalizedFootballMatch = {
        sourceMatchId: item.sourceMatchId?.trim() || undefined,
        matchNo,
        matchDate,
        businessDate: (item as { businessDate?: string }).businessDate || matchDate,
        league: item.league ?? '',
        homeTeam,
        awayTeam,
        kickoffTime: item.kickoffTime ?? new Date(matchDate).toISOString(),
        matchStatus: item.matchStatus ?? 'upcoming',
        oddsOpenHome: String(item.oddsOpenHome ?? ''),
        oddsOpenDraw: String(item.oddsOpenDraw ?? ''),
        oddsOpenAway: String(item.oddsOpenAway ?? ''),
        handicap: item.handicap ?? '0',
        handicapRecommendation: item.handicapRecommendation ?? '',
        handicapOddsHome: String(item.handicapOddsHome ?? ''),
        handicapOddsDraw: String(item.handicapOddsDraw ?? ''),
        handicapOddsAway: String(item.handicapOddsAway ?? ''),
        overUnder: '2.5',
        totalGoals: String(item.totalGoals ?? '2.5'),
        totalOddsOver: String(item.totalOddsOver ?? ''),
        totalOddsUnder: String(item.totalOddsUnder ?? ''),
      };

      const v = this.validateFootballMatch(normalized);
      if (!v.ok) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: v.reason ?? 'validation failed' });
        continue;
      }

      // Total goals self-consistency check
      const totalGoalsNum = Number(item.totalGoals);
      const overOdds = Number(item.totalOddsOver);
      const underOdds = Number(item.totalOddsUnder);
      if (totalGoalsNum > 0 && overOdds > 0 && underOdds > 0) {
        const impliedProbOver = 1 / overOdds;
        const impliedProbUnder = 1 / underOdds;
        if (Math.abs(impliedProbOver + impliedProbUnder - 1) > 0.6) {
          result.skipped += 1;
          result.skipReasons.push({
            matchNo,
            reason: `total goals odds self-inconsistent (over=${overOdds}, under=${underOdds})`,
          });
          continue;
        }
      }

      valid.push(normalized);

      const hasPred = item.homeWinProb !== undefined
        && item.drawProb !== undefined
        && item.awayWinProb !== undefined;
      const hasExplicitDirection = this.isNonEmptyStr(item.predictionDirection)
        || this.isNonEmptyStr(item.handicapRecommendation)
        || this.isNonEmptyStr(item.totalPick);
      if (hasPred || hasExplicitDirection) {
        providedPredictions.set(matchNo + '_' + ((item as { businessDate?: string }).businessDate || matchDate), item);
      }
    }

    if (valid.length === 0) return result;

    valid.sort((a: NormalizedFootballMatch, b: NormalizedFootballMatch) =>
      a.matchNo.localeCompare(b.matchNo),
    );

    await this.runWithDeadlockRetry(async (tx) => {
      await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
      for (const item of valid) {
        try {
        const key = item.matchNo + '_' + item.businessDate;
        const provided = providedPredictions.get(key);

        const existing = await tx
          .select({
            id: matches.id,
            source: matches.source,
            intel: matches.intel,
            matchStatus: matches.matchStatus,
            confidence: matches.confidence,
            predictionDirection: matches.predictionDirection,
            oddsOpenHome: matches.oddsOpenHome,
            oddsOpenDraw: matches.oddsOpenDraw,
            oddsOpenAway: matches.oddsOpenAway,
            handicap: matches.handicap,
            handicapRecommendation: matches.handicapRecommendation,
            totalGoals: matches.totalGoals,
            totalPick: matches.totalPick,
            modelRules: matches.modelRules,
            league: matches.league,
          })
          .from(matches)
          .where(
            and(
              eq(matches.matchNo, item.matchNo),
              eq(matches.businessDate, item.businessDate),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          const row = existing[0];
          const updateSet: Record<string, unknown> = {
            updatedAt: sql`CURRENT_TIMESTAMP`,
            businessDate: item.businessDate,
          };

          // Upgrade source to 'sporttery' if placeholder came from another source
          if (row.source !== 'sporttery') {
            updateSet.source = 'sporttery';
            if (item.homeTeam) updateSet.homeTeam = item.homeTeam;
            if (item.awayTeam) updateSet.awayTeam = item.awayTeam;
            // Keep existing intel from placeholder
          }

          // --- PATCH: odds fields (only oddsLive updates; oddsOpen is locked after first write) ---
          const newOddsHome = this.numStrOrNull(item.oddsOpenHome);
          const newOddsDraw = this.numStrOrNull(item.oddsOpenDraw);
          const newOddsAway = this.numStrOrNull(item.oddsOpenAway);
          const dbOpenHome = row.oddsOpenHome != null ? String(row.oddsOpenHome) : null;
          const dbOpenDraw = row.oddsOpenDraw != null ? String(row.oddsOpenDraw) : null;
          const dbOpenAway = row.oddsOpenAway != null ? String(row.oddsOpenAway) : null;
          // Initialize oddsOpen if not yet set (first odds capture).
          if (dbOpenHome === null && newOddsHome !== null) updateSet.oddsOpenHome = newOddsHome;
          if (dbOpenDraw === null && newOddsDraw !== null) updateSet.oddsOpenDraw = newOddsDraw;
          if (dbOpenAway === null && newOddsAway !== null) updateSet.oddsOpenAway = newOddsAway;
          // Always update oddsLive with the latest capture.
          if (newOddsHome !== null) updateSet.oddsLiveHome = newOddsHome;
          if (newOddsDraw !== null) updateSet.oddsLiveDraw = newOddsDraw;
          if (newOddsAway !== null) updateSet.oddsLiveAway = newOddsAway;

          // --- PATCH: handicap (non-empty string only, never blank out existing) ---
          if (this.isNonEmptyStr(item.handicap)) {
            updateSet.handicap = item.handicap;
          }

          // --- PATCH: totalGoals (non-empty only; no default on update) ---
          const newTotalGoals = this.numStrOrNull(item.totalGoals);
          if (newTotalGoals !== null) {
            updateSet.totalGoals = newTotalGoals;
          }

          // --- PATCH: handicap odds (non-empty only) ---
          const newHandicapOddsHome = this.numStrOrNull(item.handicapOddsHome);
          const newHandicapOddsDraw = this.numStrOrNull(item.handicapOddsDraw);
          const newHandicapOddsAway = this.numStrOrNull(item.handicapOddsAway);
          if (newHandicapOddsHome !== null) updateSet.handicapOddsHome = newHandicapOddsHome;
          if (newHandicapOddsDraw !== null) updateSet.handicapOddsDraw = newHandicapOddsDraw;
          if (newHandicapOddsAway !== null) updateSet.handicapOddsAway = newHandicapOddsAway;

          // --- PATCH: total odds (non-empty only) ---
          const newTotalOddsOver = this.numStrOrNull(item.totalOddsOver);
          const newTotalOddsUnder = this.numStrOrNull(item.totalOddsUnder);
          if (newTotalOddsOver !== null) updateSet.totalOddsOver = newTotalOddsOver;
          if (newTotalOddsUnder !== null) updateSet.totalOddsUnder = newTotalOddsUnder;

          // --- PATCH: overUnder (non-empty only) ---
          if (this.isNonEmptyStr(item.overUnder)) {
            updateSet.overUnder = item.overUnder;
          }

          // --- PATCH: kickoffTime / league ---
          if (item.kickoffTime) {
            updateSet.kickoffTime = new Date(item.kickoffTime);
          }
          if (this.isNonEmptyStr(item.league) && !row.league) {
            updateSet.league = item.league;
          }
          if (item.matchStatus && row.matchStatus === 'upcoming' && item.matchStatus !== 'upcoming') {
            updateSet.matchStatus = item.matchStatus;
          }

          // --- Detect handicap / odds / totalGoals changes for recalc ---
          const dbOddsHome = row.oddsOpenHome != null ? String(row.oddsOpenHome) : null;
          const dbOddsDraw = row.oddsOpenDraw != null ? String(row.oddsOpenDraw) : null;
          const dbOddsAway = row.oddsOpenAway != null ? String(row.oddsOpenAway) : null;
          const dbTotalGoals = row.totalGoals != null ? String(row.totalGoals) : null;
          const oddsChanged =
            (newOddsHome !== null && dbOddsHome !== newOddsHome) ||
            (newOddsDraw !== null && dbOddsDraw !== newOddsDraw) ||
            (newOddsAway !== null && dbOddsAway !== newOddsAway);
          const handicapChanged =
            this.isNonEmptyStr(item.handicap) && row.handicap !== item.handicap;
          const totalGoalsChanged =
            newTotalGoals !== null && dbTotalGoals !== newTotalGoals;
          const hOddsH = Number(item.handicapOddsHome);
          const hOddsD = Number(item.handicapOddsDraw);
          const hOddsA = Number(item.handicapOddsAway);
          const hasHandicapOdds = hOddsH > 0 && hOddsD > 0 && hOddsA > 0;
          const dbHandicapRec = (row as { handicapRecommendation?: string }).handicapRecommendation ?? '';
          const handicapRecMissing = hasHandicapOdds && !this.isNonEmptyStr(dbHandicapRec);
          const shouldRecalc =
            oddsChanged || handicapChanged || totalGoalsChanged || handicapRecMissing;

          // --- Prediction fields: provided > recalc > keep existing ---
          let recalcPrediction: ReturnType<typeof this.generateFootballPrediction> = null;
          if (provided) {
            // PATCH: only write fields that are actually provided and non-empty
            if (provided.homeWinProb !== undefined) updateSet.homeWinProb = provided.homeWinProb;
            if (provided.drawProb !== undefined) updateSet.drawProb = provided.drawProb;
            if (provided.awayWinProb !== undefined) updateSet.awayWinProb = provided.awayWinProb;
            if (this.isNonEmptyStr(provided.predictionDirection)) {
              updateSet.predictionDirection = provided.predictionDirection;
            }
            if (this.isNonEmptyStr(provided.handicapRecommendation)) {
              updateSet.handicapRecommendation = provided.handicapRecommendation;
            }
            if (provided.handicapWinProb !== undefined) {
              updateSet.handicapWinProb = String(provided.handicapWinProb);
            }
            if (provided.handicapDrawProb !== undefined) {
              updateSet.handicapDrawProb = String(provided.handicapDrawProb);
            }
            if (provided.handicapLoseProb !== undefined) {
              updateSet.handicapLoseProb = String(provided.handicapLoseProb);
            }
            if (this.isNonEmptyStr(provided.handicapSecondChoice)) {
              updateSet.handicapSecondChoice = provided.handicapSecondChoice;
            }
            if (provided.overProb !== undefined) {
              updateSet.overProb = provided.overProb;
            }
            if (provided.underProb !== undefined) {
              updateSet.underProb = provided.underProb;
            }
            if (this.isNonEmptyStr(provided.totalPick)) {
              updateSet.totalPick = provided.totalPick;
            }
            if (provided.totalPickProb !== undefined) {
              updateSet.totalPickProb = provided.totalPickProb;
            }
            if (provided.confidence !== undefined) {
              updateSet.confidence = provided.confidence;
              updateSet.lowConfidence = provided.lowConfidence ?? provided.confidence < 45;
            }
            if (this.isNonEmptyStr(provided.intel)) {
              updateSet.intel = provided.intel;
            }
            if (provided.modelRules !== undefined && provided.modelRules.length > 0) {
              updateSet.modelRules = provided.modelRules;
            }
            // P2-8 模型版本号真实化：provided 预测同样标记引擎版本
            updateSet.predEngineVersion = FOOTBALL_MODEL_VERSION;
            // v6.8.7 有大小球指数但没显式给 totalPick/overProb/underProb 时，
            // 调用统一公共函数 generateTotalPickFromOdds 推导（与定时同步同一条路）
            const provTotalOver = this.numStrOrNull(item.totalOddsOver);
            const provTotalUnder = this.numStrOrNull(item.totalOddsUnder);
            if (provided.totalPick === undefined && provided.overProb === undefined
                && provTotalOver !== null && provTotalUnder !== null
                && Number(provTotalOver) > 0 && Number(provTotalUnder) > 0) {
              const tPick = this.generateTotalPickFromOdds(Number(provTotalOver), Number(provTotalUnder));
              if (tPick) {
                updateSet.overProb = tPick.overProb;
                updateSet.underProb = tPick.underProb;
                updateSet.totalPick = tPick.pick;
                updateSet.totalPickProb = Math.max(tPick.overProb, tPick.underProb);
              }
            }
          } else if (shouldRecalc) {
            const oddsH = Number(item.oddsOpenHome);
            const oddsD = Number(item.oddsOpenDraw);
            const oddsA = Number(item.oddsOpenAway);
            if (oddsH > 0 && oddsD > 0 && oddsA > 0) {
              recalcPrediction = this.generateFootballPrediction(
                oddsH, oddsD, oddsA, item.handicap,
                this.numStrOrNull(item.totalGoals) ?? undefined,
              );
              if (recalcPrediction) {
                updateSet.homeWinProb = recalcPrediction.homeWinProb;
                updateSet.drawProb = recalcPrediction.drawProb;
                updateSet.awayWinProb = recalcPrediction.awayWinProb;
                updateSet.confidence = recalcPrediction.confidence;
                updateSet.lowConfidence = recalcPrediction.lowConfidence;
                updateSet.handicapWinProb = String(recalcPrediction.handicapWinProb);
                updateSet.handicapDrawProb = String(recalcPrediction.handicapDrawProb);
                updateSet.handicapLoseProb = String(recalcPrediction.handicapLoseProb);
                updateSet.handicapSecondChoice = recalcPrediction.handicapSecondChoice;
                updateSet.overProb = recalcPrediction.overProb;
                updateSet.underProb = recalcPrediction.underProb;
                updateSet.totalPickProb = recalcPrediction.totalPickProb;
                updateSet.mostLikelyScore = recalcPrediction.mostLikelyScore;
                updateSet.scoreProbs = recalcPrediction.scoreProbs;
                updateSet.totalGoalsProb = recalcPrediction.totalGoalsProb;
                updateSet.halfFullProb = recalcPrediction.halfFullProb;
                updateSet.modelRules = recalcPrediction.modelRules;
                // P0-1 赛中方向锁定：live/in-play/finished 场保留赛前方向，不被赔率波动重算覆盖
                const isLiveOrFinished = row.matchStatus === 'live'
                  || row.matchStatus === 'in-play'
                  || row.matchStatus === 'finished';
                const hasPreMatchDirection = this.isNonEmptyStr(row.predictionDirection)
                  && row.predictionDirection !== '观望';
                const hasPreMatchHandicap = this.isNonEmptyStr(row.handicapRecommendation)
                  && row.handicapRecommendation !== '观望';
                const hasPreMatchTotal = this.isNonEmptyStr(row.totalPick)
                  && row.totalPick !== '观望';
                if (isLiveOrFinished && hasPreMatchDirection) {
                  // 锁定赛前胜平负方向，跳过重算写入
                } else {
                  updateSet.predictionDirection = recalcPrediction.predictionDirection;
                }
                if (isLiveOrFinished && hasPreMatchHandicap) {
                  // 锁定赛前让球方向，跳过重算写入
                } else {
                  updateSet.handicapRecommendation = recalcPrediction.handicapRecommendation;
                }
                if (isLiveOrFinished && hasPreMatchTotal) {
                  // 锁定赛前大小球方向，跳过重算写入
                } else {
                  updateSet.totalPick = recalcPrediction.totalPick;
                }
                // P2-8 模型版本号真实化
                updateSet.predEngineVersion = FOOTBALL_MODEL_VERSION;
              }
            } else {
              const hasRowOdds = dbOddsHome !== null && dbOddsDraw !== null && dbOddsAway !== null;
              if (hasRowOdds) {
                const totalOver = Number(item.totalOddsOver);
                const totalUnder = Number(item.totalOddsUnder);
                if (totalOver > 0 && totalUnder > 0) {
                  const totalPick = this.generateTotalPickFromOdds(totalOver, totalUnder);
                  if (totalPick) {
                    updateSet.overProb = totalPick.overProb;
                    updateSet.underProb = totalPick.underProb;
                    updateSet.totalPick = totalPick.pick;
                    updateSet.totalPickProb = Math.max(totalPick.overProb, totalPick.underProb);
                  }
                }
              } else {
                this.applyFootballDataInsufficientGuard(updateSet);
                const totalOver = Number(item.totalOddsOver);
                const totalUnder = Number(item.totalOddsUnder);
                if (totalOver > 0 && totalUnder > 0) {
                  const totalPick = this.generateTotalPickFromOdds(totalOver, totalUnder);
                  if (totalPick) {
                    updateSet.overProb = totalPick.overProb;
                    updateSet.underProb = totalPick.underProb;
                    updateSet.totalPick = totalPick.pick;
                    updateSet.totalPickProb = Math.max(totalPick.overProb, totalPick.underProb);
                  }
                }
              }
            }
          }

          if (provided) {
            const existingRules = Array.isArray(row.modelRules) ? [...row.modelRules] : [];
            if (!existingRules.some((r: string) => r.includes('官方数据锁定'))) {
              updateSet.modelRules = [...existingRules, '官方数据锁定'];
            }
          }

          const rowInsufficient = dbOddsHome === null && dbOddsDraw === null && dbOddsAway === null;
          if (provided) {
            this.finalizeFootballPick(updateSet, row.handicapRecommendation ?? null, rowInsufficient, {
              predictionDirection: this.isNonEmptyStr(provided.predictionDirection),
              handicapRecommendation: this.isNonEmptyStr(provided.handicapRecommendation),
              totalPick: this.isNonEmptyStr(provided.totalPick),
            });
          } else {
            // v6.8.8 修复：模型 generateFootballPrediction 输出的 handicapRecommendation
            // （n=1/n=2 规则结果）应视为显式输出，受 finalizeFootballPick 保护，
            // 不被让球指数去水推导覆盖。周三001 handicap=-1 + 主胜p<0.46 → 让负 必须保留。
            const modelHasHandicapRec = recalcPrediction !== null
              && this.isNonEmptyStr(recalcPrediction.handicapRecommendation);
            const modelHasPredDir = recalcPrediction !== null
              && this.isNonEmptyStr(recalcPrediction.predictionDirection);
            const modelHasTotalPick = recalcPrediction !== null
              && this.isNonEmptyStr(recalcPrediction.totalPick);
            this.finalizeFootballPick(updateSet, row.handicapRecommendation ?? null, rowInsufficient, {
              predictionDirection: modelHasPredDir,
              handicapRecommendation: modelHasHandicapRec,
              totalPick: modelHasTotalPick,
            });
          }
          await tx.update(matches).set(updateSet).where(eq(matches.id, row.id));

          // --- Write odds snapshots if odds changed ---
          const sourceStr = (row.source === 'sporttery' || row.source === 'beidan') ? 'sporttery' : String(row.source || 'unknown');
          if (updateSet.oddsLiveHome !== undefined || updateSet.oddsLiveDraw !== undefined || updateSet.oddsLiveAway !== undefined) {
            const snapshotHome = Number(newOddsHome ?? row.oddsOpenHome ?? 0);
            const snapshotDraw = Number(newOddsDraw ?? row.oddsOpenDraw ?? 0);
            const snapshotAway = Number(newOddsAway ?? row.oddsOpenAway ?? 0);
            if (snapshotHome > 0 || snapshotDraw > 0 || snapshotAway > 0) {
              await insertFootballOddsSnapshotIfChanged(
                tx, row.id, '1x2',
                { home: snapshotHome || undefined, draw: snapshotDraw || undefined, away: snapshotAway || undefined },
                sourceStr,
              );
            }
          }
          if (updateSet.handicapOddsHome !== undefined || updateSet.handicapOddsDraw !== undefined || updateSet.handicapOddsAway !== undefined || updateSet.handicap !== undefined) {
            const hcpHome = Number(newHandicapOddsHome ?? 0);
            const hcpDraw = Number(newHandicapOddsDraw ?? 0);
            const hcpAway = Number(newHandicapOddsAway ?? 0);
            const hcpLine = item.handicap ? Number(item.handicap) : undefined;
            if (hcpHome > 0 || hcpDraw > 0 || hcpAway > 0) {
              await insertFootballOddsSnapshotIfChanged(
                tx, row.id, 'handicap',
                { home: hcpHome || undefined, draw: hcpDraw || undefined, away: hcpAway || undefined, line: hcpLine },
                sourceStr,
              );
            }
          }
          if (updateSet.totalOddsOver !== undefined || updateSet.totalOddsUnder !== undefined || updateSet.overUnder !== undefined) {
            const totalOver = Number(newTotalOddsOver ?? 0);
            const totalUnder = Number(newTotalOddsUnder ?? 0);
            const totalLine = item.overUnder ? Number(item.overUnder) : undefined;
            if (totalOver > 0 || totalUnder > 0) {
              await insertFootballOddsSnapshotIfChanged(
                tx, row.id, 'total',
                { over: totalOver || undefined, under: totalUnder || undefined, line: totalLine },
                sourceStr,
              );
            }
          }

          result.updated += 1;
        } else {
          const oddsH = Number(item.oddsOpenHome);
          const oddsD = Number(item.oddsOpenDraw);
          const oddsA = Number(item.oddsOpenAway);
          let prediction: ReturnType<typeof this.generateFootballPrediction> = null;
          let totalOnlyPick: ReturnType<typeof this.generateTotalPickFromOdds> = null;
          let dataInsufficient = false;
          if (!provided && oddsH > 0 && oddsD > 0 && oddsA > 0) {
            prediction = this.generateFootballPrediction(
              oddsH, oddsD, oddsA, item.handicap,
              this.numStrOrNull(item.totalGoals) ?? undefined,
            );
          } else if (!provided) {
            // v6.8.3 数据不足：无三项真实指数时写入基线默认值 + 数据不足标签，
            // 交由 finalizeFootballPick 统一关口处理，三项全观望
            dataInsufficient = true;
            const tOver = Number(item.totalOddsOver);
            const tUnder = Number(item.totalOddsUnder);
            if (tOver > 0 && tUnder > 0) {
              totalOnlyPick = this.generateTotalPickFromOdds(tOver, tUnder);
            }
          }

          const homeWinProb = provided
            ? (provided.homeWinProb ?? 0)
            : (prediction?.homeWinProb ?? (dataInsufficient ? 35 : 0));
          const drawProb = provided
            ? (provided.drawProb ?? 0)
            : (prediction?.drawProb ?? (dataInsufficient ? 30 : 0));
          const awayWinProb = provided
            ? (provided.awayWinProb ?? 0)
            : (prediction?.awayWinProb ?? (dataInsufficient ? 35 : 0));
          const predictionDirection = provided
            ? (provided.predictionDirection ?? '')
            : (prediction?.predictionDirection ?? '');
          const confidence = provided
            ? (provided.confidence ?? 0)
            : (prediction?.confidence ?? (dataInsufficient ? 35 : 0));
          const lowConfidence = provided
            ? (provided.lowConfidence ?? (provided.confidence ?? 0) < 45)
            : (prediction?.lowConfidence ?? dataInsufficient);
          const handicapRecommendation = provided
            ? (provided.handicapRecommendation ?? '')
            : (prediction?.handicapRecommendation ?? '');
          const handicapWinProb = prediction?.handicapWinProb ?? (dataInsufficient ? 35 : 0);
          const handicapDrawProb = prediction?.handicapDrawProb ?? (dataInsufficient ? 30 : 0);
          const handicapLoseProb = prediction?.handicapLoseProb ?? (dataInsufficient ? 35 : 0);
          const handicapSecondChoice = prediction?.handicapSecondChoice ?? '';
          const overProb = prediction?.overProb ?? totalOnlyPick?.overProb ?? 50;
          const underProb = prediction?.underProb ?? totalOnlyPick?.underProb ?? 50;
          const totalPick = prediction?.totalPick ?? totalOnlyPick?.pick ?? '';
          const totalPickProb = prediction?.totalPickProb ?? (totalOnlyPick ? Math.max(totalOnlyPick.overProb, totalOnlyPick.underProb) : 50);
          const mostLikelyScore = prediction?.mostLikelyScore ?? '';
          const totalGoalsProb = prediction?.totalGoalsProb ?? [];
          const halfFullProb = prediction?.halfFullProb ?? [];
          const modelRules = provided
            ? (provided.modelRules ?? [])
            : (prediction?.modelRules ?? (dataInsufficient ? ['数据不足：基线默认值（v12.0 低信心方向）'] : []));

          const insertObj = {
            matchNo: item.matchNo,
            matchDate: item.matchDate,
            businessDate: item.businessDate,
            league: item.league ?? '',
            homeTeam: item.homeTeam,
            awayTeam: item.awayTeam,
            kickoffTime: new Date(item.kickoffTime),
            matchStatus: item.matchStatus ?? 'upcoming',
            source: 'sporttery',
            liveScoreSource: '',
            oddsOpenHome: this.numStrOrNull(item.oddsOpenHome),
            oddsOpenDraw: this.numStrOrNull(item.oddsOpenDraw),
            oddsOpenAway: this.numStrOrNull(item.oddsOpenAway),
            oddsLiveHome: this.numStrOrNull(item.oddsOpenHome),
            oddsLiveDraw: this.numStrOrNull(item.oddsOpenDraw),
            oddsLiveAway: this.numStrOrNull(item.oddsOpenAway),
            handicap: item.handicap,
             handicapOddsHome: this.numStrOrNull(item.handicapOddsHome),
             handicapOddsDraw: this.numStrOrNull(item.handicapOddsDraw),
             handicapOddsAway: this.numStrOrNull(item.handicapOddsAway),
             handicapRecommendation,
            handicapWinProb: String(handicapWinProb),
            handicapDrawProb: String(handicapDrawProb),
            handicapLoseProb: String(handicapLoseProb),
            handicapSecondChoice,
            overUnder: '2.5',
            overProb,
            underProb,
            totalPick,
            totalPickProb,
            totalGoals: this.numStrOrNull(item.totalGoals) ?? '2.5',
            homeWinProb,
            drawProb,
            awayWinProb,
            predictionDirection,
            confidence,
            lowConfidence,
            intel: provided?.intel ?? '',
            modelRules,
            mostLikelyScore,
            totalGoalsProb,
            halfFullProb,
            tacticsHome: '',
            tacticsAway: '',
            keyPlayersHome: '',
            keyPlayersAway: '',
            upsetWarning: '',
            predEngineVersion: FOOTBALL_MODEL_VERSION,
            handicapConfidence: '低',
            ouConfidence: '低',
          };
          this.finalizeFootballPick(insertObj);
          const insertedRows = await tx.insert(matches)
            .values(insertObj)
            .onConflictDoNothing({
              target: [matches.matchNo, matches.businessDate],
            })
            .returning({ id: matches.id });
          if (insertedRows.length > 0) {
            result.inserted += 1;
          }
        }
        } catch (err: unknown) {
          result.skipped += 1;
          result.skipReasons.push({
            matchNo: item.matchNo,
            reason: `db error: ${this.errorMessage(err)}`,
          });
        }
      }
    });

    this.sportteryExternalLastSync = new Date();
    this.sportteryExternalSuccess = true;
    this.sportteryDirectStatus = 'degraded';
    this.externalTodayCount += 1;
    this.lastSyncAt.football = new Date();
    this.lastSyncStatus.football = {
      statusCode: 200,
      success: true,
      message: `ingest: inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}`,
    };
    return result;
  }

  async ingestBasketball(items: IngestBasketballItem[]): Promise<IngestResult> {
    this.logger.log(`[ingest] basketball: ${items.length} items`);
    const result: IngestResult = { inserted: 0, updated: 0, skipped: 0, skipReasons: [] };

    const valid: NormalizedBasketballMatch[] = [];
    const providedPredictions = new Map<string, IngestBasketballItem>();

    for (const item of items) {
      const matchNo = String(item.matchNo ?? '').trim();
      const matchDate = String(item.matchDate ?? '').trim();
      const homeTeam = item.homeTeam?.trim() ?? '';
      const awayTeam = item.awayTeam?.trim() ?? '';

      if (!matchNo || !matchDate) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'matchNo or matchDate missing' });
        continue;
      }
      if (!homeTeam || !awayTeam) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'homeTeam or awayTeam missing' });
        continue;
      }
      if (homeTeam === awayTeam) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'homeTeam equals awayTeam' });
        continue;
      }

      let finalHome = homeTeam;
      let finalAway = awayTeam;
      let finalHandicap = item.handicap ?? '';
      let finalHandicapOddsHome = String(item.handicapOddsHome ?? '');
      let finalHandicapOddsAway = String(item.handicapOddsAway ?? '');
      let finalTotalLine = item.totalLine ?? '';
      let finalTotalOddsOver = String(item.totalOddsOver ?? '');
      let finalTotalOddsUnder = String(item.totalOddsUnder ?? '');
      let finalHomeWinOdds = String(item.homeWinOdds ?? '');
      let finalAwayWinOdds = String(item.awayWinOdds ?? '');
      const hcNum = Number(item.handicap) || 0;

      const kickoffIso = item.kickoffTime ?? new Date(matchDate + 'T19:30:00+08:00').toISOString();
      const matchDateFromKickoff = kickoffIso.slice(0, 10);
      const normalized: NormalizedBasketballMatch = {
        sourceMatchId: item.sourceMatchId?.trim() || undefined,
        matchNo,
        matchDate: matchDateFromKickoff,
        businessDate: matchDate,
        league: item.league ?? '',
        homeTeam: finalHome,
        awayTeam: finalAway,
        kickoffTime: kickoffIso,
        matchStatus: item.matchStatus ?? 'upcoming',
        handicap: finalHandicap || '0',
        handicapHf: String((item as { handicapHf?: string | number | null }).handicapHf ?? '0'),
        handicapAf: String((item as { handicapAf?: string | number | null }).handicapAf ?? '0'),
        totalLine: finalTotalLine || '',
        homeWinOdds: finalHomeWinOdds,
        awayWinOdds: finalAwayWinOdds,
        handicapOddsHome: finalHandicapOddsHome,
        handicapOddsAway: finalHandicapOddsAway,
        totalOddsOver: finalTotalOddsOver,
        totalOddsUnder: finalTotalOddsUnder,
      };

      const v = this.validateBasketballMatch(normalized);
      if (!v.ok) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: v.reason ?? 'validation failed' });
        continue;
      }

      const totalLineNum = Number(item.totalLine);
      const overOdds = Number(item.totalOddsOver);
      const underOdds = Number(item.totalOddsUnder);
      if (totalLineNum > 0 && overOdds > 0 && underOdds > 0) {
        const impliedOver = 1 / overOdds;
        const impliedUnder = 1 / underOdds;
        if (Math.abs(impliedOver + impliedUnder - 1) > 0.6) {
          result.skipped += 1;
          result.skipReasons.push({
            matchNo,
            reason: `total line odds self-inconsistent (over=${overOdds}, under=${underOdds})`,
          });
          continue;
        }
      }

      valid.push(normalized);

      const hasPred = item.homeWinProb !== undefined && item.awayWinProb !== undefined;
      if (hasPred) {
        providedPredictions.set(normalized.matchNo + '_' + normalized.businessDate, item);
      }
    }

    if (valid.length === 0) return result;

    valid.sort((a: NormalizedBasketballMatch, b: NormalizedBasketballMatch) =>
      a.matchNo.localeCompare(b.matchNo),
    );

    const lineRecalcTriggers = new Map<string, { matchId: string; matchNo: string }>();
    const newlyInsertedIds: string[] = [];

    await this.runWithDeadlockRetry(async (tx) => {
      await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
      await tx.execute(sql`SET LOCAL app.official_line_update = 'true'`);
      for (const item of valid) {
        try {
        const key = item.matchNo + '_' + item.businessDate;
        const provided = providedPredictions.get(key);

         const existing = await tx
           .select({
             id: basketballMatches.id,
             source: basketballMatches.source,
             intel: basketballMatches.intel,
             matchStatus: basketballMatches.matchStatus,
             confidence: basketballMatches.confidence,
             predictionDirection: basketballMatches.predictionDirection,
             handicap: basketballMatches.handicap,
             totalLine: basketballMatches.totalLine,
             homeWinOdds: basketballMatches.homeWinOdds,
             awayWinOdds: basketballMatches.awayWinOdds,
             handicapRecommendation: basketballMatches.handicapRecommendation,
             totalDirection: basketballMatches.totalDirection,
             predictedHomeScore: basketballMatches.predictedHomeScore,
             predictedAwayScore: basketballMatches.predictedAwayScore,
              league: basketballMatches.league,
               isOfficialLocked: basketballMatches.isOfficialLocked,
               modelRules: basketballMatches.modelRules,
              handicapLineNum: basketballMatches.handicapLineNum,
               totalLineNum: basketballMatches.totalLineNum,
               teamStats: basketballMatches.teamStats,
               predEngineVersion: basketballMatches.predEngineVersion,
               oddsMovements: basketballMatches.oddsMovements,
               oddsOpenHandicapLine: basketballMatches.oddsOpenHandicapLine,
               oddsOpenTotalLine: basketballMatches.oddsOpenTotalLine,
            })
           .from(basketballMatches)
           .where(
             and(
               eq(basketballMatches.matchNo, item.matchNo),
               eq(basketballMatches.businessDate, item.businessDate),
             ),
           )
           .limit(1);

        if (existing.length > 0) {
          const row = existing[0];
          const updateSet: Record<string, unknown> = {
            updatedAt: sql`CURRENT_TIMESTAMP`,
            businessDate: item.businessDate,
          };

          // Upgrade source to 'sporttery' if placeholder came from another source
          if (row.source !== 'sporttery') {
            updateSet.source = 'sporttery';
            if (item.homeTeam) updateSet.homeTeam = item.homeTeam;
            if (item.awayTeam) updateSet.awayTeam = item.awayTeam;
            // Keep existing intel from placeholder
          }

          // --- PATCH: odds / line fields (non-empty only) ---
          const newHomeOdds = this.numStrOrNull(item.homeWinOdds);
          const newAwayOdds = this.numStrOrNull(item.awayWinOdds);
          const newHandicapOddsH = this.numStrOrNull(item.handicapOddsHome);
          const newHandicapOddsA = this.numStrOrNull(item.handicapOddsAway);
          const newTotalOver = this.numStrOrNull(item.totalOddsOver);
          const newTotalUnder = this.numStrOrNull(item.totalOddsUnder);

          if (newHomeOdds !== null) updateSet.homeWinOdds = newHomeOdds;
          if (newAwayOdds !== null) updateSet.awayWinOdds = newAwayOdds;
          if (newHandicapOddsH !== null) updateSet.handicapOddsHome = newHandicapOddsH;
          if (newHandicapOddsA !== null) updateSet.handicapOddsAway = newHandicapOddsA;
          if (newTotalOver !== null) updateSet.totalOddsOver = newTotalOver;
          if (newTotalUnder !== null) updateSet.totalOddsUnder = newTotalUnder;

           // --- 官方数据锁定：跳过让分方向/概率/盘口线覆盖，保留既有值 ---
           // sporttery官方源ingest时已设置 app.official_line_update='true' GUC，
           // 触发器会放行官方源的线值/赔率更新；此处同样放行线值写入以确保一致。
           // 非官方源（球美宝等）的写入不设此GUC，由应用层+触发器双重拦截。
           const isOfficialLocked = (Boolean(row.isOfficialLocked) ||
             (Array.isArray(row.modelRules) && row.modelRules.some((r: string) => r.includes('官方数据锁定'))))
             && row.source !== 'sporttery';

           // --- PATCH: handicap / totalLine (non-empty only) ---
           // 锁定场：跳过盘口线/让分文字更新，保留官方复核基准值
           let newHcpNum: number | null = null;
           let newTotalNum: number | null = null;
           const oldHcpNum = row.handicapLineNum != null ? Number(row.handicapLineNum) : 0;
           const oldTotalNum = row.totalLineNum != null ? Number(row.totalLineNum) : 0;
           if (!isOfficialLocked && this.isNonEmptyStr(item.handicap)) {
             const hNum = this.convertHandicapLine(item.handicap);
             if (!Number.isNaN(hNum)) {
               if (hNum === 0 && Math.abs(oldHcpNum) > 0) {
                 // 新线值为0但旧线值有效→竞彩下架/停售，保留最后有效线值，不覆盖不记录变动
               } else {
                 updateSet.handicap = item.handicap;
                 updateSet.handicapLineNum = String(hNum);
                 newHcpNum = hNum;
               }
             }
           }
           if (!isOfficialLocked && this.isNonEmptyStr(item.totalLine)) {
             const tNum = Number(item.totalLine);
             if (!Number.isNaN(tNum)) {
               if (tNum === 0 && oldTotalNum > 0) {
                 // 新大小分线为0但旧线值有效→竞彩下架/停售，保留最后有效线值
               } else {
                 updateSet.totalLine = item.totalLine;
                 updateSet.totalLineNum = String(tNum);
                 newTotalNum = tNum;
               }
             }
           }
            // 线值变动追踪
            if (newHcpNum !== null || newTotalNum !== null) {
              const linePatch = buildLineMovementPatch({
                existingHandicapLineNum: row.handicapLineNum,
                existingTotalLineNum: row.totalLineNum,
                newHandicapLineNum: newHcpNum ?? row.handicapLineNum,
                newTotalLineNum: newTotalNum ?? row.totalLineNum,
                existingOddsMovements: row.oddsMovements as unknown[] | null | undefined,
                existingOddsOpenHandicapLine: row.oddsOpenHandicapLine,
                existingOddsOpenTotalLine: row.oddsOpenTotalLine,
              });
              Object.assign(updateSet, linePatch);

              // 线值变动超阈值 → 收集为重算候选（后续批量执行）
              if (
                row.matchStatus === 'upcoming' &&
                isProtectedPredictionEngine(row.predEngineVersion) &&
                (shouldRecalcHandicapByLine(row.handicapLineNum, newHcpNum ?? row.handicapLineNum) ||
                  shouldRecalcTotalByLine(row.totalLineNum, newTotalNum ?? row.totalLineNum))
              ) {
                lineRecalcTriggers.set(row.id, { matchId: row.id, matchNo: item.matchNo });
              }
            }

          // --- PATCH: kickoffTime / league / status ---
          if (item.kickoffTime) {
            updateSet.kickoffTime = new Date(item.kickoffTime);
          }
          if (this.isNonEmptyStr(item.league)) {
            updateSet.league = item.league;
          }
          if (item.matchStatus && row.matchStatus === 'upcoming' && item.matchStatus !== 'upcoming') {
            updateSet.matchStatus = item.matchStatus;
          }

          // --- Detect handicap / odds / totalLine changes for recalc ---
          const dbHomeOdds = row.homeWinOdds != null ? String(row.homeWinOdds) : null;
          const dbAwayOdds = row.awayWinOdds != null ? String(row.awayWinOdds) : null;
          const oddsChanged =
            (newHomeOdds !== null && dbHomeOdds !== newHomeOdds) ||
            (newAwayOdds !== null && dbAwayOdds !== newAwayOdds);
          const handicapChanged =
            this.isNonEmptyStr(item.handicap) && row.handicap !== item.handicap;
          const totalLineChanged =
            this.isNonEmptyStr(item.totalLine) && row.totalLine !== item.totalLine;
           const isDataDriven = row.predEngineVersion?.startsWith('data-driven');
           // 官方线值变动时，即使锁定场也触发预测重算（跟线）
           // 非官方源且锁定的场次，保持跳过重算
           const hasLineChange = handicapChanged || totalLineChanged || oddsChanged;
           const isOfficialLineUpdate = row.source === 'sporttery' && hasLineChange;
           const shouldRecalc = (!isOfficialLocked || isOfficialLineUpdate) && !isDataDriven && hasLineChange;

           // --- Prediction fields: provided > recalc > keep existing ---
           // data-driven 比赛：sync 只更新赔率/线值，不碰预测字段（防止旧引擎覆盖）
           if (provided && !isDataDriven) {
            // PATCH: only write provided and non-empty prediction fields
            if (provided.homeWinProb !== undefined) updateSet.homeWinProb = provided.homeWinProb;
            if (provided.awayWinProb !== undefined) updateSet.awayWinProb = provided.awayWinProb;
            if (this.isNonEmptyStr(provided.predictionDirection)) {
              updateSet.predictionDirection = provided.predictionDirection;
            }
            if (this.isNonEmptyStr(provided.handicapRecommendation)) {
              updateSet.handicapRecommendation = provided.handicapRecommendation;
              updateSet.handicapPick = provided.handicapRecommendation;
            }
            if (this.isNonEmptyStr(provided.totalRecommendation)) {
              updateSet.totalDirection = provided.totalRecommendation;
              updateSet.totalPick = provided.totalRecommendation;
            }
            if (provided.confidence !== undefined) {
              updateSet.confidence = provided.confidence;
            }
            if (this.isNonEmptyStr(provided.intel)) {
              updateSet.intel = provided.intel;
            }
            if (provided.modelRules !== undefined && provided.modelRules.length > 0) {
              updateSet.modelRules = provided.modelRules;
            }
          } else if (shouldRecalc) {
            const hwOdds = Number(item.homeWinOdds);
            const awOdds = Number(item.awayWinOdds);
            const hcLine = item.handicap ?? '0';
            const hcNum = Number(hcLine) || 0;
            const tlStr = item.totalLine || '';
            const hasLine = Math.abs(hcNum) > 0 || (tlStr && Number(tlStr) > 0);
            if (hwOdds > 0 && awOdds > 0) {
              const prediction = this.generateBasketballPrediction(
                hwOdds, awOdds, hcLine,
                tlStr,
                item.league || 'default',
                '',
                {
                  teamStats: row.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined,
                },
              );
              if (prediction) {
                updateSet.homeWinProb = prediction.homeWinProb;
                updateSet.awayWinProb = prediction.awayWinProb;
                updateSet.predictionDirection = prediction.predictionDirection;
                updateSet.confidence = prediction.confidence;
                updateSet.handicapRecommendation = prediction.handicapRecommendation;
                updateSet.handicapPick = prediction.handicapRecommendation;
                updateSet.handicapCoverProb = prediction.handicapCoverProb;
                updateSet.handicapPickProb = prediction.handicapPickProb;
                updateSet.totalDirection = prediction.totalDirection;
                updateSet.totalPick = prediction.totalDirection;
                updateSet.overProb = prediction.overProb;
                updateSet.underProb = prediction.underProb;
                updateSet.totalPickProb = prediction.totalPickProb;
                updateSet.modelRules = prediction.modelRules;
                updateSet.predictedHomeScore = prediction.predictedHomeScore;
                updateSet.predictedAwayScore = prediction.predictedAwayScore;
                updateSet.predictedTotal = String(prediction.predictedTotal);
                updateSet.handicapConfidence = prediction.handicapConfidence;
                updateSet.ouConfidence = prediction.ouConfidence;
                updateSet.ouDiffVsLine = String(prediction.ouDiffVsLine);
                updateSet.predEngineVersion = prediction.predEngineVersion;
              }
             } else if (hasLine) {
               const prediction = this.generateBasketballPrediction(
                  0, 0, hcLine,
                  tlStr,
                  item.league || 'default',
                  '',
                  {
                    teamStats: row.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined,
                  },
              );
              if (prediction) {
                updateSet.homeWinProb = prediction.homeWinProb;
                updateSet.awayWinProb = prediction.awayWinProb;
                updateSet.predictionDirection = prediction.predictionDirection;
                updateSet.confidence = prediction.confidence;
                updateSet.handicapRecommendation = prediction.handicapRecommendation;
                updateSet.handicapPick = prediction.handicapRecommendation;
                updateSet.handicapCoverProb = prediction.handicapCoverProb;
                updateSet.totalDirection = prediction.totalDirection;
                updateSet.totalPick = prediction.totalDirection;
                updateSet.overProb = prediction.overProb;
                updateSet.underProb = prediction.underProb;
                updateSet.modelRules = prediction.modelRules;
                updateSet.predictedHomeScore = prediction.predictedHomeScore;
                updateSet.predictedAwayScore = prediction.predictedAwayScore;
                updateSet.predictedTotal = String(prediction.predictedTotal);
                updateSet.handicapConfidence = prediction.handicapConfidence;
                updateSet.ouConfidence = prediction.ouConfidence;
                updateSet.ouDiffVsLine = String(prediction.ouDiffVsLine);
                updateSet.predEngineVersion = prediction.predEngineVersion;
              }
            } else {
              const hOddsH = Number(item.handicapOddsHome);
              const hOddsA = Number(item.handicapOddsAway);
              if (hOddsH > 0 && hOddsA > 0) {
                const hPick = this.generateBasketballHandicapFromOdds(hOddsH, hOddsA);
                if (hPick) {
                  updateSet.handicapRecommendation = hPick.handicapRecommendation;
                  updateSet.handicapPick = hPick.handicapRecommendation;
                  updateSet.handicapCoverProb = hPick.homeCoverProb;
                }
              }
              const tOver = Number(item.totalOddsOver);
              const tUnder = Number(item.totalOddsUnder);
              if (tOver > 0 && tUnder > 0) {
                const tPick = this.generateTotalPickFromOdds(tOver, tUnder);
                if (tPick) {
                  updateSet.overProb = tPick.overProb;
                  updateSet.underProb = tPick.underProb;
                  updateSet.totalDirection = tPick.pick === '大球' ? '大分' : '小分';
                  updateSet.totalPick = tPick.pick === '大球' ? '大分' : '小分';
                }
              }
            }
          }

          // 预期比分自洽校验：仅当模型尚未生成有效推荐时，用预期比分兜底计算
          // 模型已输出方向/观望时，尊重模型输出，禁止用简化线性公式覆盖概率
          const phs = Number(row.predictedHomeScore) || 0;
          const pas = Number(row.predictedAwayScore) || 0;
          const hasModelHandicap = row.handicapRecommendation && row.handicapRecommendation !== '';
          const hasModelTotal = row.totalDirection && row.totalDirection !== '';
          if (phs > 0 && pas > 0 && this.isNonEmptyStr(item.handicap)) {
            const fromScore = this.calcBasketballFromPredictedScore(
              phs, pas, item.handicap, item.totalLine || '',
            );
            if (!hasModelHandicap) {
              updateSet.handicapCoverProb = fromScore.handicapCoverProb;
            }
            if (!hasModelTotal) {
              updateSet.overProb = fromScore.overProb;
              updateSet.underProb = fromScore.underProb;
            }
          }

           // 锁定场 / data-driven场次：跳过预测重算和finalize，保留已有方向/概率/信心/规则
           if (!isOfficialLocked && !isDataDriven) {
              this.finalizeBasketballPick(updateSet, row.handicapRecommendation ?? null, row.totalDirection ?? null, row.league ?? 'default');
              this.appendBasketballPredictionHistory(updateSet, 'sporttery_odds_update');
            } else {
              const existingRules = Array.isArray(row.modelRules) ? [...row.modelRules] : [];
              updateSet.modelRules = existingRules;
            }
           await tx.update(basketballMatches).set(updateSet).where(eq(basketballMatches.id, row.id));

          // --- Write basketball odds snapshots if odds changed ---
          const sourceStr = 'sporttery';
          // h2h
          if (updateSet.homeWinOdds !== undefined || updateSet.awayWinOdds !== undefined) {
            const h = newHomeOdds ? Number(newHomeOdds) : 0;
            const a = newAwayOdds ? Number(newAwayOdds) : 0;
            if (h > 0 || a > 0) {
              await insertBasketballOddsSnapshotIfChanged(
                tx, row.id, 'h2h',
                { home: h > 0 ? h : undefined, away: a > 0 ? a : undefined },
                sourceStr,
              );
            }
          }
          // handicap
          if (updateSet.handicapOddsHome !== undefined || updateSet.handicapOddsAway !== undefined || updateSet.handicap !== undefined) {
            const hh = newHandicapOddsH ? Number(newHandicapOddsH) : 0;
            const ha = newHandicapOddsA ? Number(newHandicapOddsA) : 0;
            const hLine = item.handicap ? Number(item.handicap) : undefined;
            if (hh > 0 || ha > 0) {
              await insertBasketballOddsSnapshotIfChanged(
                tx, row.id, 'handicap',
                { home: hh > 0 ? hh : undefined, away: ha > 0 ? ha : undefined, line: hLine },
                sourceStr,
              );
            }
          }
          // total
          if (updateSet.totalOddsOver !== undefined || updateSet.totalOddsUnder !== undefined || updateSet.totalLine !== undefined) {
            const to = newTotalOver ? Number(newTotalOver) : 0;
            const tu = newTotalUnder ? Number(newTotalUnder) : 0;
            const tLine = item.totalLine ? Number(item.totalLine) : undefined;
            if (to > 0 || tu > 0) {
              await insertBasketballOddsSnapshotIfChanged(
                tx, row.id, 'total',
                { over: to > 0 ? to : undefined, under: tu > 0 ? tu : undefined, line: tLine },
                sourceStr,
              );
            }
          }

          result.updated += 1;
        } else {
          let homeWinProb = 0;
          let awayWinProb = 0;
          let confidence = 0;
          let predictionDirection = '';
          let handicapPick = '';
          let totalDirection = '';
          let overProb = 50;
          let underProb = 50;
          let handicapCoverProb = 50;
          let handicapPickProb = 50;
          let totalPickProb = 0;
          let intel = '';
          let modelRules: string[] = [];
          let predictedHomeScore = 0;
          let predictedAwayScore = 0;
          let predictedTotal = 0;
          let handicapConfidence: '高' | '中' | '低' = '低';
          let ouConfidence: '高' | '中' | '低' = '低';
          let ouDiffVsLine = 0;
          let predEngineVersion = 'v9.0-fallback';

          if (provided) {
            homeWinProb = provided.homeWinProb ?? 0;
            awayWinProb = provided.awayWinProb ?? 0;
            predictionDirection = provided.predictionDirection ?? '';
            confidence = provided.confidence ?? 0;
            handicapPick = provided.handicapRecommendation ?? '';
            totalDirection = provided.totalRecommendation ?? '';
            intel = provided.intel ?? '';
            modelRules = provided.modelRules ?? [];
          } else {
            const hwOdds = Number(item.homeWinOdds);
            const awOdds = Number(item.awayWinOdds);
            const hcLine = item.handicap ?? '0';
            const hcNum = Number(hcLine) || 0;
            const tlStr = item.totalLine || '';
            const hasLine = Math.abs(hcNum) > 0 || (tlStr && Number(tlStr) > 0);
            if (hwOdds > 0 && awOdds > 0) {
              const prediction = this.generateBasketballPrediction(
                hwOdds, awOdds, hcLine,
                tlStr,
                item.league || 'default',
              );
              if (prediction) {
                homeWinProb = prediction.homeWinProb;
                awayWinProb = prediction.awayWinProb;
                predictionDirection = prediction.predictionDirection;
                confidence = prediction.confidence;
                handicapPick = prediction.handicapRecommendation;
                handicapCoverProb = prediction.handicapCoverProb;
                handicapPickProb = prediction.handicapPickProb;
                totalDirection = prediction.totalDirection;
                overProb = prediction.overProb;
                underProb = prediction.underProb;
                totalPickProb = prediction.totalPickProb;
                modelRules = prediction.modelRules;
                predictedHomeScore = prediction.predictedHomeScore;
                predictedAwayScore = prediction.predictedAwayScore;
                predictedTotal = prediction.predictedTotal;
               handicapConfidence = prediction.handicapConfidence;
                 ouConfidence = prediction.ouConfidence;
                 ouDiffVsLine = prediction.ouDiffVsLine;
                 predEngineVersion = prediction.predEngineVersion;
               }
            } else if (hasLine) {
              const prediction = this.generateBasketballPrediction(
                0, 0, hcLine,
                tlStr,
                item.league || 'default',
              );
              if (prediction) {
                homeWinProb = prediction.homeWinProb;
                awayWinProb = prediction.awayWinProb;
                predictionDirection = prediction.predictionDirection;
                confidence = prediction.confidence;
                handicapPick = prediction.handicapRecommendation;
                handicapCoverProb = prediction.handicapCoverProb;
                totalDirection = prediction.totalDirection;
                overProb = prediction.overProb;
                underProb = prediction.underProb;
                modelRules = prediction.modelRules;
                predictedHomeScore = prediction.predictedHomeScore;
                predictedAwayScore = prediction.predictedAwayScore;
                predictedTotal = prediction.predictedTotal;
                handicapConfidence = prediction.handicapConfidence;
                 ouConfidence = prediction.ouConfidence;
                 ouDiffVsLine = prediction.ouDiffVsLine;
                 predEngineVersion = prediction.predEngineVersion;
               }
            } else {
              const hOddsH = Number(item.handicapOddsHome);
              const hOddsA = Number(item.handicapOddsAway);
              if (hOddsH > 0 && hOddsA > 0) {
                const hPick = this.generateBasketballHandicapFromOdds(hOddsH, hOddsA);
                if (hPick) {
                  handicapPick = hPick.handicapRecommendation;
                  handicapCoverProb = hPick.homeCoverProb;
                  handicapPickProb = hPick.handicapRecommendation === '让分主胜' ? hPick.homeCoverProb : 100 - hPick.homeCoverProb;
                }
              }
              const tOver = Number(item.totalOddsOver);
              const tUnder = Number(item.totalOddsUnder);
              if (tOver > 0 && tUnder > 0) {
                const tPick = this.generateTotalPickFromOdds(tOver, tUnder);
                if (tPick) {
                  overProb = tPick.overProb;
                  underProb = tPick.underProb;
                  totalDirection = tPick.pick === '大球' ? '大分' : '小分';
                }
              }
            }
          }

          const totalPickVal = totalDirection || '';
          const insertObj = {
            matchNo: item.matchNo,
            matchDate: item.matchDate,
            businessDate: item.businessDate,
            league: item.league ?? '',
            homeTeam: item.homeTeam,
            awayTeam: item.awayTeam,
            kickoffTime: new Date(item.kickoffTime),
            matchStatus: item.matchStatus ?? 'upcoming',
            source: 'sporttery',
            liveScoreSource: '',
            venue: '主场',
            category: 'official',
            isNeutral: false,
            handicap: item.handicap ?? '0',
            handicapLineNum: String(
              this.convertHandicapLine(
                item.handicap,
              ),
            ),
            totalLine: item.totalLine || '',
            totalLineNum: item.totalLine ? String(Number(item.totalLine)) : '0',
            homeWinOdds: this.numStrOrNull(item.homeWinOdds),
            awayWinOdds: this.numStrOrNull(item.awayWinOdds),
            handicapOddsHome: this.numStrOrNull(item.handicapOddsHome),
            handicapOddsAway: this.numStrOrNull(item.handicapOddsAway),
            totalOddsOver: this.numStrOrNull(item.totalOddsOver),
            totalOddsUnder: this.numStrOrNull(item.totalOddsUnder),
            homeWinProb,
            awayWinProb,
            predictionDirection,
            confidence,
            handicapRecommendation: handicapPick,
            handicapCoverProb,
            handicapPick,
            handicapPickProb,
            totalDirection,
            totalPick: totalDirection,
            totalPickProb,
            overProb,
            underProb,
            spreadProb15: 20,
            spreadProb610: 20,
            spreadProb1115: 20,
            spreadProb1620: 20,
            spreadProb21Plus: 20,
            spreadTopRange: '6-10分',
            intel,
            riskWarning: '',
            modelRules,
            predictedHomeScore,
            predictedAwayScore,
            predictedTotal: String(predictedTotal),
            handicapConfidence,
            ouConfidence,
             ouDiffVsLine: String(ouDiffVsLine),
            predEngineVersion,
             oddsMovements: buildInitialOddsMovements(item.handicap, item.totalLine),
           };
          this.finalizeBasketballPick(insertObj, undefined, undefined, item.league ?? 'default');
          const insertedRows = await tx.insert(basketballMatches)
            .values(insertObj)
            .onConflictDoNothing({
              target: [basketballMatches.matchNo, basketballMatches.businessDate],
            })
            .returning({ id: basketballMatches.id });
          if (insertedRows.length > 0) {
            result.inserted += 1;
            const newId = insertedRows[0].id;
            newlyInsertedIds.push(newId);
            const snapshotSource = 'sporttery';
            const hwOdds = Number(item.homeWinOdds) || 0;
            const awOdds = Number(item.awayWinOdds) || 0;
            const hcpHome = Number(item.handicapOddsHome) || 0;
            const hcpAway = Number(item.handicapOddsAway) || 0;
            const hcpLine = item.handicap ? Number(item.handicap) : undefined;
            const tOver = Number(item.totalOddsOver) || 0;
            const tUnder = Number(item.totalOddsUnder) || 0;
            const tLine = item.totalLine ? Number(item.totalLine) : undefined;
            if (hwOdds > 0 || awOdds > 0) {
              await insertBasketballOddsSnapshotIfChanged(
                tx, newId, 'h2h',
                { home: hwOdds > 0 ? hwOdds : undefined, away: awOdds > 0 ? awOdds : undefined },
                snapshotSource,
              );
            }
            if (hcpHome > 0 || hcpAway > 0) {
              await insertBasketballOddsSnapshotIfChanged(
                tx, newId, 'handicap',
                { home: hcpHome > 0 ? hcpHome : undefined, away: hcpAway > 0 ? hcpAway : undefined, line: hcpLine },
                snapshotSource,
              );
            }
            if (tOver > 0 || tUnder > 0) {
              await insertBasketballOddsSnapshotIfChanged(
                tx, newId, 'total',
                { over: tOver > 0 ? tOver : undefined, under: tUnder > 0 ? tUnder : undefined, line: tLine },
                snapshotSource,
              );
            }
          }
        }
        } catch (err: unknown) {
          result.skipped += 1;
          result.skipReasons.push({
            matchNo: item.matchNo,
            reason: `db error: ${this.errorMessage(err)}`,
          });
        }
      }
    });

    if (lineRecalcTriggers.size > 0) {
      try {
        const allTriggers = [...lineRecalcTriggers.values()];
        const triggerIds = allTriggers.map((t) => t.matchId).filter(Boolean);
        const triggerRows = await this.db.select({
          id: basketballMatches.id,
          matchNo: basketballMatches.matchNo,
          matchStatus: basketballMatches.matchStatus,
          league: basketballMatches.league,
          homeTeam: basketballMatches.homeTeam,
          awayTeam: basketballMatches.awayTeam,
          homeWinOdds: basketballMatches.homeWinOdds,
          awayWinOdds: basketballMatches.awayWinOdds,
          handicapLineNum: basketballMatches.handicapLineNum,
          totalLineNum: basketballMatches.totalLineNum,
          totalLine: basketballMatches.totalLine,
          handicap: basketballMatches.handicap,
           predEngineVersion: basketballMatches.predEngineVersion,
           teamStats: basketballMatches.teamStats,
           keyPlayers: basketballMatches.keyPlayers,
           injuries: basketballMatches.injuries,
          recentForm: basketballMatches.recentForm,
          h2hHistory: basketballMatches.h2hHistory,
           intelSummary: basketballMatches.intelSummary,
           intel: basketballMatches.intel,
           isPredictionFrozen: basketballMatches.isPredictionFrozen,
         })
           .from(basketballMatches)
           .where(inArray(basketballMatches.id, triggerIds));

         const v11Triggers = triggerRows.filter(
           (r) => r.predEngineVersion?.startsWith('v11.0-unified') && !r.isPredictionFrozen
             && r.matchStatus === 'upcoming',
         );
         const ddTriggerInputs = allTriggers.filter((t) => {
           const row = triggerRows.find((r) => r.id === t.matchId);
           return row?.predEngineVersion?.startsWith('data-driven') && !row.isPredictionFrozen
             && row.matchStatus === 'upcoming';
         });

        if (ddTriggerInputs.length > 0 && this.dataDrivenService) {
          const outcomes = await this.dataDrivenService.recalcByLineTrigger(ddTriggerInputs);
          const applied = outcomes.filter((o) => o.applied).length;
          if (applied > 0) {
            this.logger.log(
              `[line-recalc] basketball ingest: data-driven ${applied}/${outcomes.length} matches recalculated`,
            );
          }
        }

        if (v11Triggers.length > 0) {
          const eloTeams: Array<{ teamName: string }> = [];
          const v11TeamNames: string[] = [];
          for (const r of v11Triggers) {
            if (r.homeTeam) {
              eloTeams.push({ teamName: r.homeTeam });
              if (!v11TeamNames.includes(r.homeTeam)) v11TeamNames.push(r.homeTeam);
            }
            if (r.awayTeam) {
              eloTeams.push({ teamName: r.awayTeam });
              if (!v11TeamNames.includes(r.awayTeam)) v11TeamNames.push(r.awayTeam);
            }
          }
          const eloMap = await this.eloHistoryService.getTeamRatings('basketball', eloTeams);

          const recentStatsMap = new Map<string, { recent10Ppg: number; recent10Oppg: number; recent20Ppg: number; recent20Oppg: number; sampleCount: number }>();
          if (v11TeamNames.length > 0) {
            const normTargets = new Map<string, string>();
            const keywords: string[] = [];
            for (const t of v11TeamNames) {
              const norm = normalizeBasketballTeamName(t);
              if (norm && norm.length >= 2) {
                normTargets.set(norm, t);
                const kw = norm.length <= 4 ? norm : norm.slice(-2);
                if (kw.length >= 2 && !keywords.includes(kw)) keywords.push(kw);
              }
            }
            if (keywords.length > 0) {
              const keywordOr = sql.join(
                keywords.map((kw) => sql`lower(${basketballMatches.homeTeam}) LIKE ${'%' + kw.toLowerCase() + '%'} OR lower(${basketballMatches.awayTeam}) LIKE ${'%' + kw.toLowerCase() + '%'}`),
                sql` OR `,
              );
              const recentRows = await this.db
                .select({
                  homeTeam: basketballMatches.homeTeam,
                  awayTeam: basketballMatches.awayTeam,
                  homeScore: basketballMatches.homeScore,
                  awayScore: basketballMatches.awayScore,
                  kickoffTime: basketballMatches.kickoffTime,
                })
                .from(basketballMatches)
                .where(and(
                  eq(basketballMatches.matchStatus, 'finished'),
                  isNotNull(basketballMatches.homeScore),
                  isNotNull(basketballMatches.awayScore),
                  sql`${basketballMatches.homeScore} > 0`,
                  keywordOr,
                ))
                .orderBy(sql`${basketballMatches.kickoffTime} DESC`)
                .limit(500);

              const byTeam = new Map<string, Array<{ ppg: number; oppg: number; kickoffTime: Date }>>();
              const pushGame = (teamKey: string, ppg: number, oppg: number, kt: Date) => {
                const arr = byTeam.get(teamKey) ?? [];
                arr.push({ ppg, oppg, kickoffTime: kt });
                byTeam.set(teamKey, arr);
              };
              const seenKeys = new Set<string>();
              for (const row of recentRows) {
                const hs = Number(row.homeScore) || 0;
                const as = Number(row.awayScore) || 0;
                if (hs <= 0 && as <= 0) continue;
                const kt = row.kickoffTime instanceof Date ? row.kickoffTime : new Date(String(row.kickoffTime));
                const hNorm = row.homeTeam ? normalizeBasketballTeamName(row.homeTeam) : '';
                const aNorm = row.awayTeam ? normalizeBasketballTeamName(row.awayTeam) : '';
                for (const origTeam of v11TeamNames) {
                  const targetNorm = normalizeBasketballTeamName(origTeam);
                  if (!targetNorm) continue;
                  const isHomeMatch = hNorm === targetNorm;
                  const isAwayMatch = aNorm === targetNorm;
                  if (!isHomeMatch && !isAwayMatch) continue;
                  const key = `${origTeam}_${row.homeTeam}_${row.awayTeam}_${kt.getTime()}`;
                  if (seenKeys.has(key)) continue;
                  seenKeys.add(key);
                  if (isHomeMatch) pushGame(origTeam, hs, as, kt);
                  if (isAwayMatch) pushGame(origTeam, as, hs, kt);
                }
              }
              for (const team of v11TeamNames) {
                const games = byTeam.get(team);
                if (!games || games.length === 0) continue;
                const sorted = games.sort((a, b) => b.kickoffTime.getTime() - a.kickoffTime.getTime());
                const recent20 = sorted.slice(0, 20);
                const recent10 = sorted.slice(0, 10);
                const avg = (arr: typeof recent20, field: 'ppg' | 'oppg'): number => {
                  if (arr.length === 0) return 0;
                  return arr.reduce((s, g) => s + g[field], 0) / arr.length;
                };
                recentStatsMap.set(team, {
                  recent10Ppg: avg(recent10, 'ppg'),
                  recent10Oppg: avg(recent10, 'oppg'),
                  recent20Ppg: avg(recent20, 'ppg'),
                  recent20Oppg: avg(recent20, 'oppg'),
                  sampleCount: sorted.length,
                });
              }
             }
           }

           // 赛季基线兜底：当球队本赛季完赛场次不足5场时，用2024-25赛季StatMuse基线填充近期攻防数据
           // 解决赛季初大小分贴线50/50问题
           const baselineRows = await this.db
             .select({
               teamName: teamSeasonStats.teamName,
               ppg: teamSeasonStats.ppg,
               oppg: teamSeasonStats.oppg,
             })
             .from(teamSeasonStats)
             .where(and(
               eq(teamSeasonStats.season, '2024-25'),
               eq(teamSeasonStats.dataSource, 'statmuse_2024-25'),
             ));

           if (baselineRows.length > 0) {
             const seasonBaselineMap = new Map<string, { ppg: number; oppg: number }>();
             for (const br of baselineRows) {
               if (br.teamName && br.ppg != null && br.oppg != null) {
                 seasonBaselineMap.set(br.teamName.toLowerCase(), {
                   ppg: Number(br.ppg),
                   oppg: Number(br.oppg),
                 });
               }
             }

             const findSeasonBaseline = (teamName: string): { ppg: number; oppg: number } | null => {
               const norm = normalizeBasketballTeamName(teamName).toLowerCase();
               if (!norm) return null;
               // 精确匹配规范化名称
               if (seasonBaselineMap.has(norm)) return seasonBaselineMap.get(norm)!;
               // 模糊匹配：基线表中的名字可能是"凯尔特人"而teamName是"波士顿凯尔特人"
               for (const [key, val] of seasonBaselineMap.entries()) {
                 if (key.length >= 2 && (norm.includes(key) || key.includes(norm))) {
                   return val;
                 }
               }
               return null;
             };

             for (const team of v11TeamNames) {
               const existing = recentStatsMap.get(team);
               const currentSample = existing?.sampleCount ?? 0;

               // 样本量不足5场时启用赛季基线
               if (currentSample >= 5) continue;

               const baseline = findSeasonBaseline(team);
               if (!baseline) continue;

               const baselinePpg = baseline.ppg;
               const baselineOppg = baseline.oppg;
               const baselinePd = baselinePpg - baselineOppg;
               // 等效样本量：用15场历史数据作为先验
               const effectiveSample = 15;

               if (!existing || currentSample === 0) {
                 recentStatsMap.set(team, {
                   recent10Ppg: baselinePpg,
                   recent10Oppg: baselineOppg,
                   recent20Ppg: baselinePpg,
                   recent20Oppg: baselineOppg,
                   sampleCount: effectiveSample,
                 });
               } else {
                 // 本赛季有少量样本：按比例与基线融合
                 const seasonRatio = Math.min(currentSample / 20, 1);
                 const baselineRatio = 1 - seasonRatio;
                 const fused20Ppg = existing.recent20Ppg * seasonRatio + baselinePpg * baselineRatio;
                 const fused20Oppg = existing.recent20Oppg * seasonRatio + baselineOppg * baselineRatio;
                 // recent10 也用同样的融合比例
                 const fused10Ppg = (existing.recent10Ppg || baselinePpg) * seasonRatio + baselinePpg * baselineRatio;
                 const fused10Oppg = (existing.recent10Oppg || baselineOppg) * seasonRatio + baselineOppg * baselineRatio;
                 recentStatsMap.set(team, {
                   recent10Ppg: fused10Ppg,
                   recent10Oppg: fused10Oppg,
                   recent20Ppg: fused20Ppg,
                   recent20Oppg: fused20Oppg,
                   sampleCount: effectiveSample,
                 });
               }
             }
           }

           let v11RecalcCount = 0;
          for (const row of v11Triggers) {
            try {
              const hwOdds = Number(row.homeWinOdds) || 0;
              const awOdds = Number(row.awayWinOdds) || 0;
              const hOddsH = 1.0;
              const hOddsA = 1.0;
              const handicapVal = row.handicapLineNum != null ? Number(row.handicapLineNum) : 0;
              const hasLine = Math.abs(handicapVal) > 0;
              let hw = hwOdds;
              let aw = awOdds;
              if ((hw <= 0 || aw <= 0) && hasLine) {
                const midLine = Math.abs(handicapVal);
                const baseWinRate = 0.5 + midLine / 30;
                const clamped = Math.max(0.15, Math.min(0.85, baseWinRate));
                hw = handicapVal < 0 ? 1 / (clamped * 1.06) : 1 / ((1 - clamped) * 1.06);
                aw = handicapVal < 0 ? 1 / ((1 - clamped) * 1.06) : 1 / (clamped * 1.06);
              }

              const totalLineNum = row.totalLineNum != null ? Number(row.totalLineNum) : 0;
              const rowLeague = row.league || 'default';
              const totalValid = totalLineNum > 0;
              const totalLineForPred = totalValid ? String(totalLineNum) : undefined;
              const handicapValid = hasLine;
              const handicapStrForPred = handicapValid ? String(handicapVal) : '';

              let homePpg: number | undefined;
              let awayPpg: number | undefined;
              let homeOppg: number | undefined;
              let awayOppg: number | undefined;
              if (row.teamStats && typeof row.teamStats === 'object') {
                const ts = row.teamStats as Record<string, unknown>;
                const hs = ts.home as Record<string, unknown> | null;
                const as = ts.away as Record<string, unknown> | null;
                if (hs) {
                  const rawVal = hs.pointsPerGame != null && hs.pointsPerGame !== '' ? hs.pointsPerGame : hs.ppg;
                  const n = Number(rawVal);
                  if (!Number.isNaN(n) && n > 0) homePpg = n;
                  const oppgVal = hs.oppg != null && hs.oppg !== '' ? hs.oppg : hs.pointsAllowedPerGame;
                  const on = Number(oppgVal);
                  if (!Number.isNaN(on) && on > 0) homeOppg = on;
                }
                if (as) {
                  const rawVal = as.pointsPerGame != null && as.pointsPerGame !== '' ? as.pointsPerGame : as.ppg;
                  const n = Number(rawVal);
                  if (!Number.isNaN(n) && n > 0) awayPpg = n;
                  const oppgVal = as.oppg != null && as.oppg !== '' ? as.oppg : as.pointsAllowedPerGame;
                  const on = Number(oppgVal);
                  if (!Number.isNaN(on) && on > 0) awayOppg = on;
                }
              }
              const homeRecent = row.homeTeam ? recentStatsMap.get(row.homeTeam) : undefined;
              const awayRecent = row.awayTeam ? recentStatsMap.get(row.awayTeam) : undefined;
              if (homeRecent && homeRecent.recent20Ppg > 0) {
                if (!homePpg) homePpg = homeRecent.recent20Ppg;
                if (!homeOppg) homeOppg = homeRecent.recent20Oppg;
              }
              if (awayRecent && awayRecent.recent20Ppg > 0) {
                if (!awayPpg) awayPpg = awayRecent.recent20Ppg;
                if (!awayOppg) awayOppg = awayRecent.recent20Oppg;
              }

              const intelText = row.intelSummary ?? (typeof row.intel === 'string' ? row.intel : '');
              const prediction = this.generateBasketballPrediction(
                hw, aw, handicapStrForPred, totalLineForPred, rowLeague, '',
                {
                  homePpg,
                  awayPpg,
                 intelData: parseIntelFromRow({
                   homeTeam: row.homeTeam ?? '',
                   awayTeam: row.awayTeam ?? '',
                   h2hHistory: row.h2hHistory,
                   injuries: row.injuries,
                   keyPlayers: row.keyPlayers,
                   recentForm: row.recentForm,
                   teamNews: intelText,
                 }),
                  eloHome: row.homeTeam ? eloMap.get(row.homeTeam)?.rating : undefined,
                  eloAway: row.awayTeam ? eloMap.get(row.awayTeam)?.rating : undefined,
                  eloGap:
                     row.homeTeam && row.awayTeam && eloMap.get(row.homeTeam) && eloMap.get(row.awayTeam)
                       ? eloMap.get(row.homeTeam)!.rating - eloMap.get(row.awayTeam)!.rating
                       : undefined,
                   teamStats: row.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined,
                   recent10HomePpg: homeRecent?.recent10Ppg > 0 ? homeRecent.recent10Ppg : undefined,
                   recent10AwayPpg: awayRecent?.recent10Ppg > 0 ? awayRecent.recent10Ppg : undefined,
                   recent10HomeOppg: homeRecent?.recent10Oppg > 0 ? homeRecent.recent10Oppg : undefined,
                   recent10AwayOppg: awayRecent?.recent10Oppg > 0 ? awayRecent.recent10Oppg : undefined,
                   recent20HomePpg: homeRecent?.recent20Ppg > 0 ? homeRecent.recent20Ppg : undefined,
                   recent20AwayPpg: awayRecent?.recent20Ppg > 0 ? awayRecent.recent20Ppg : undefined,
                   recent20HomeOppg: homeRecent?.recent20Oppg > 0 ? homeRecent.recent20Oppg : undefined,
                   recent20AwayOppg: awayRecent?.recent20Oppg > 0 ? awayRecent.recent20Oppg : undefined,
                   recentSampleCount:
                     homeRecent && awayRecent
                       ? Math.min(homeRecent.sampleCount, awayRecent.sampleCount)
                       : homeRecent
                       ? homeRecent.sampleCount
                       : awayRecent
                       ? awayRecent.sampleCount
                       : 0,
                    playoffSeriesGames: this.buildBbPlayoffSeriesGames(
                      row.h2hHistory,
                      row.homeTeam ?? '',
                      row.awayTeam ?? '',
                    ),
                 },
               );

               if (prediction) {
                 const patch: Record<string, unknown> = {
                   homeWinProb: prediction.homeWinProb,
                  awayWinProb: prediction.awayWinProb,
                  predictionDirection: prediction.predictionDirection,
                  confidence: prediction.confidence,
                  handicapRecommendation: prediction.handicapRecommendation,
                  handicapPick: prediction.handicapRecommendation,
                  handicapCoverProb: prediction.handicapCoverProb,
                  handicapPickProb: prediction.handicapPickProb,
                  totalLineNum: totalLineNum,
                  totalDirection: prediction.totalDirection,
                  overProb: prediction.overProb,
                  underProb: prediction.underProb,
                  totalPick: prediction.totalDirection,
                  totalPickProb: prediction.totalPickProb,
                  modelRules: prediction.modelRules,
                  predictedHomeScore: prediction.predictedHomeScore,
                  predictedAwayScore: prediction.predictedAwayScore,
                  predictedTotal: String(prediction.predictedTotal),
                  handicapConfidence: prediction.handicapConfidence,
                  ouConfidence: prediction.ouConfidence,
                  ouDiffVsLine: String(prediction.ouDiffVsLine),
                  predEngineVersion: prediction.predEngineVersion,
                };
                this.finalizeBasketballPick(patch, null, null, rowLeague);
                this.appendBasketballPredictionHistory(patch, 'line_recalc_v11');
                await this.db.update(basketballMatches)
                  .set(patch)
                  .where(eq(basketballMatches.id, row.id));
                v11RecalcCount += 1;
              }
            } catch (err2: unknown) {
              this.logger.warn(
                `[line-recalc] V11 recalc failed for ${row.matchNo}: ${this.errorMessage(err2)}`,
              );
            }
          }
          if (v11RecalcCount > 0) {
            this.logger.log(
              `[line-recalc] basketball ingest: V11 ${v11RecalcCount}/${v11Triggers.length} matches recalculated`,
            );
          }
        }
      } catch (err: unknown) {
        this.logger.error(
          `[line-recalc] basketball ingest failed: ${this.errorMessage(err)}`,
        );
      }
    }

    if (newlyInsertedIds.length > 0 && this.dataDrivenService) {
      try {
        const preds = await this.dataDrivenService.predictByIds(newlyInsertedIds);
        const applyResult = await this.dataDrivenService.applyPredictions(preds);
        this.logger.log(
          `[data-driven-init] basketball ingest: ${applyResult.updated}/${newlyInsertedIds.length} new matches predicted`,
        );
      } catch (err: unknown) {
        this.logger.error(
          `[data-driven-init] basketball ingest failed: ${this.errorMessage(err)}`,
        );
      }
    }

    this.sportteryExternalLastSync = new Date();
    this.sportteryExternalSuccess = true;
    this.sportteryDirectStatus = 'degraded';
    this.externalTodayCount += 1;
    this.lastSyncAt.basketball = new Date();
    this.lastSyncStatus.basketball = {
      statusCode: 200,
      success: true,
      message: `ingest: inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}`,
    };
    return result;
  }

  async ingestBeidan(items: IngestBeidanItem[]): Promise<IngestResult> {
    this.logger.log(`[ingest] beidan: ${items.length} items`);
    const result: IngestResult = { inserted: 0, updated: 0, skipped: 0, skipReasons: [] };

    const valid: BeidanMatch[] = [];

    for (const item of items) {
      const matchNo = String(item.matchNo ?? '').trim();
      const matchDate = String(item.matchDate ?? '').trim();
      const homeTeam = item.homeTeam?.trim() ?? '';
      const awayTeam = item.awayTeam?.trim() ?? '';

      if (!matchNo || !matchDate) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'matchNo or matchDate missing' });
        continue;
      }
      if (!homeTeam || !awayTeam) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'homeTeam or awayTeam missing' });
        continue;
      }
      if (homeTeam === awayTeam) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: 'homeTeam equals awayTeam' });
        continue;
      }

      const oddsH = Number(item.spHome ?? 0);
      const oddsD = Number(item.spDraw ?? 0);
      const oddsA = Number(item.spAway ?? 0);
      const hasOdds = oddsH > 0 && oddsD > 0 && oddsA > 0;
      if (hasOdds && oddsH + oddsD + oddsA <= 3) {
        result.skipped += 1;
        result.skipReasons.push({ matchNo, reason: `WDW odds sum too low: ${oddsH + oddsD + oddsA}` });
        continue;
      }

      const handicap = Number(item.handicap ?? 0);
      if (hasOdds && handicap > 0 && oddsH < oddsA * 0.7) {
        result.skipped += 1;
        result.skipReasons.push({
          matchNo,
          reason: `handicap direction contradicts odds (handicap=${handicap}, homeOdds=${oddsH}, awayOdds=${oddsA})`,
        });
        continue;
      }

      const totalGoalsNum = Number(item.totalGoals);
      const overOdds = Number(item.totalOddsOver);
      const underOdds = Number(item.totalOddsUnder);
      if (totalGoalsNum > 0 && overOdds > 0 && underOdds > 0) {
        const impliedOver = 1 / overOdds;
        const impliedUnder = 1 / underOdds;
        if (Math.abs(impliedOver + impliedUnder - 1) > 0.6) {
          result.skipped += 1;
          result.skipReasons.push({
            matchNo,
            reason: `total goals odds self-inconsistent (over=${overOdds}, under=${underOdds})`,
          });
          continue;
        }
      }

      valid.push({
        ...item,
        matchNo,
        matchDate,
        homeTeam,
        awayTeam,
      });
    }

    const upsertResult = await this.upsertBeidanMatches(valid);
    result.inserted = upsertResult.inserted;
    result.updated = upsertResult.updated;

    this.beidanLastSync = new Date();
    this.beidanSuccess = true;
    this.beidanTodayCount += 1;

    return result;
  }

  // --- Manual refresh triggers ---

  async triggerLiveRefresh(): Promise<{
    football: { success: boolean; leaguesSynced: number; rhythm: EspnRhythm };
    basketball: { success: boolean; leaguesSynced: number; rhythm: EspnRhythm };
  }> {
    this.logger.log('Manual live refresh triggered');
    // Force a full run by resetting last full run timestamps
    this.espnFbLastFullRun = null;
    this.espnBbLastFullRun = null;
    await this.runEspnLiveSync();
    return {
      football: {
        success: this.espnFootballSuccess,
        leaguesSynced: this.espnFootballLeaguesSynced,
        rhythm: this.espnFbRhythm,
      },
      basketball: {
        success: this.espnBasketballSuccess,
        leaguesSynced: this.espnBasketballLeaguesSynced,
        rhythm: this.espnBbRhythm,
      },
    };
  }

  triggerLiveRefreshAsync(): void {
    this.logger.log('Manual live refresh triggered (async)');
    this.espnFbLastFullRun = null;
    this.espnBbLastFullRun = null;
    void this.runEspnLiveSync().catch((err: unknown) => {
      this.logger.error(`Async live refresh failed: ${this.errorMessage(err)}`);
    });
  }

  lazyTriggerBasketballSync(lastSync: Date | null, status: 'live' | 'upcoming' | 'finished'): boolean {
    if (this.espnBbLazySyncInProgress) return false;
    const now = Date.now();
    const ageMs = lastSync ? now - lastSync.getTime() : Infinity;
    const threshold =
      status === 'live'
        ? 45 * 1000
        : status === 'upcoming'
          ? 120 * 1000
          : 10 * 60 * 1000;
    const jitter = threshold * 0.2;
    const effectiveThreshold = threshold - jitter + Math.random() * jitter * 2;
    if (ageMs < effectiveThreshold) return false;
    this.espnBbLazySyncInProgress = true;
    this.logger.log(`Lazy-triggering basketball ESPN sync (status=${status}, age=${Math.round(ageMs / 1000)}s)`);
    void this.runEspnLiveSync()
      .catch((err: unknown) => {
        this.logger.error(`Lazy basketball sync failed: ${this.errorMessage(err)}`);
      })
      .finally(() => {
        this.espnBbLazySyncInProgress = false;
      });
    return true;
  }

  lazyTriggerFootballSync(lastSync: Date | null, status: 'live' | 'upcoming' | 'finished'): boolean {
    if (this.espnFbLazySyncInProgress) return false;
    const now = Date.now();
    const ageMs = lastSync ? now - lastSync.getTime() : Infinity;
    const threshold =
      status === 'live'
        ? 45 * 1000
        : status === 'upcoming'
          ? 120 * 1000
          : 10 * 60 * 1000;
    const jitter = threshold * 0.2;
    const effectiveThreshold = threshold - jitter + Math.random() * jitter * 2;
    if (ageMs < effectiveThreshold) return false;
    this.espnFbLazySyncInProgress = true;
    this.logger.log(`Lazy-triggering football ESPN sync (status=${status}, age=${Math.round(ageMs / 1000)}s)`);
    void this.runEspnLiveSync()
      .catch((err: unknown) => {
        this.logger.error(`Lazy football sync failed: ${this.errorMessage(err)}`);
      })
      .finally(() => {
        this.espnFbLazySyncInProgress = false;
      });
    return true;
  }

  async triggerOddsRefresh(): Promise<{
    sportsSynced: number;
    remaining: number | null;
    success: boolean;
    statusCode: number | null;
    statusMessage: string;
  }> {
    this.logger.log('Manual odds refresh triggered');
    this.oddsApiLastActualRun = null; // bypass throttle
    const result = await this.triggerOddsApiSync();
    return {
      sportsSynced: result.sportsSynced,
      remaining: result.remaining,
      success: result.success,
      statusCode: result.statusCode,
      statusMessage: result.statusMessage,
    };
  }

  // --- Health ---

  setApiSportsKey(key: string): void {
    this.apiSportsSource.setApiKey(key);
    this.logger.log(`apiSports key updated: ${key ? `****${key.slice(-4)}` : 'disabled'}`);
  }

  setTheRundownKey(key: string): void {
    this.theRundownSource.setApiKey(key);
    this.logger.log(`TheRundown key updated: ${key ? `****${key.slice(-4)}` : 'disabled'}`);
  }

  triggerSyncAsync(): void {
     void this.triggerSync();
   }

   async triggerBeidanSync(): Promise<BeidanSyncResult> {
     if (!isBeidanEnabled()) {
       throw new Error('北单数据源未启用');
     }
     return this.runBeidanSync();
   }

  triggerOddsApiSyncAsync(): void {
    void this.triggerOddsApiSync();
  }

  async getHealth(): Promise<SyncHealthDto> {
    const [fbCount, bbCount, beidanCount, fbStatus, bbStatus] = await Promise.all([
      this.db.select({ value: count() }).from(matches),
      this.db.select({ value: count() }).from(basketballMatches),
      this.db.select({ value: count() }).from(matches).where(eq(matches.source, 'beidan')),
      this.getDayMatchStatus('football'),
      this.getDayMatchStatus('basketball'),
    ]);

    // Recompute rhythms from today's match status
    this.espnFbRhythm =
      fbStatus.live > 0 ? 'live' : fbStatus.upcoming > 0 ? 'upcoming' : 'idle';
    this.espnBbRhythm =
      bbStatus.live > 0 ? 'live' : bbStatus.upcoming > 0 ? 'upcoming' : 'idle';

    // Odds API rhythm: pre-match if any game starts within 3h today
    const fbHasPreMatch = await this.hasUpcomingWithinHours('football', 3);
    const bbHasPreMatch = await this.hasUpcomingWithinHours('basketball', 3);
    const anyMatchToday = fbStatus.total > 0 || bbStatus.total > 0;
    if (fbHasPreMatch || bbHasPreMatch) {
      this.oddsApiRhythm = 'pre-match';
    } else if (anyMatchToday) {
      this.oddsApiRhythm = 'daily';
    } else {
      this.oddsApiRhythm = 'idle';
    }

    const formatEntry = (
      cat: SyncCategory,
    ): { at: string | null; statusCode: number | null; success: boolean; message?: string; inserted?: number; updated?: number; skipped?: number } => {
      const at = this.lastSyncAt[cat];
      const status = this.lastSyncStatus[cat];
      return {
        at: at ? at.toISOString() : null,
        statusCode: status?.statusCode ?? null,
        success: status?.success ?? false,
        message: status?.message,
        inserted: status?.inserted,
        updated: status?.updated,
        skipped: status?.skipped,
      };
    };

    const espnNextSync = (
      rhythm: EspnRhythm,
      last: Date | null,
    ): string | null => {
      if (!last) return null;
      const interval =
        rhythm === 'live'
          ? ESPN_LIVE_INTERVAL_MS
          : rhythm === 'upcoming'
            ? ESPN_UPCOMING_INTERVAL_MS
            : ESPN_IDLE_INTERVAL_MS;
      return new Date(last.getTime() + interval).toISOString();
    };

    const oddsNextSync = (): string | null => {
      // If never run but rhythm is pre-match/daily, sync is imminent (startup run pending)
      if (!this.oddsApiLastActualRun) {
        if (this.oddsApiRhythm !== 'idle') {
          return new Date().toISOString();
        }
        return null;
      }
      let interval =
        this.oddsApiRhythm === 'pre-match'
          ? ODDS_PRE_MATCH_INTERVAL_MS
          : this.oddsApiRhythm === 'daily'
            ? ODDS_DAILY_INTERVAL_MS
            : ODDS_IDLE_INTERVAL_MS;
      if (this.oddsApiQuotaThrottled) interval *= 2;
      return new Date(this.oddsApiLastActualRun.getTime() + interval).toISOString();
    };

    // Reset daily counts if date changed
    const todayStr = this.getBeijingTodayStr();
    if (todayStr !== this.lastCountResetDate) {
      this.lastCountResetDate = todayStr;
      this.espnFbTodayCount = 0;
      this.espnBbTodayCount = 0;
      this.oddsApiTodayCount = 0;
      this.externalTodayCount = 0;
      this.beidanTodayCount = 0;
      this.qiumibaoFbTodayCount = 0;
      this.qiumibaoBbTodayCount = 0;
      this.theSportsDbTodayCount = 0;
      this.apiSportsTodayCount = 0;
      this.fdoTodayCount = 0;
    }

    return {
      schedulerRunning: this._isSchedulerRunning,
      source: this.source,
      lastSync: {
        football: formatEntry('football'),
        basketball: formatEntry('basketball'),
        score: formatEntry('score'),
      },
      staleCount: this.staleCount,
      footballCount: fbCount[0]?.value ?? 0,
      basketballCount: bbCount[0]?.value ?? 0,
      beidanCount: beidanCount[0]?.value ?? 0,
      footballDataFreshAt: this.lastSyncAt.football ? this.lastSyncAt.football.toISOString() : null,
      basketballDataFreshAt: this.lastSyncAt.basketball ? this.lastSyncAt.basketball.toISOString() : null,
      syncWriteEnabled: this.isSyncWriteEnabled(),
      sources: {
        espnFootball: {
          enabled: true,
          lastSyncAt: this.espnFootballLastSync?.toISOString() ?? null,
          success: this.espnFootballSuccess,
          leaguesSynced: this.espnFootballLeaguesSynced,
          pendingMappings: this.espnFootballPendingMappings.size,
          leagueStats: { ...this.espnFootballLeagueStats },
          rhythm: this.espnFbRhythm,
          nextSyncAt: espnNextSync(this.espnFbRhythm, this.espnFbLastFullRun),
        },
        espnBasketball: {
          enabled: true,
          lastSyncAt: this.espnBasketballLastSync?.toISOString() ?? null,
          success: this.espnBasketballSuccess,
          leaguesSynced: this.espnBasketballLeaguesSynced,
          pendingMappings: this.espnBasketballPendingMappings.size,
          leagueStats: { ...this.espnBasketballLeagueStats },
          rhythm: this.espnBbRhythm,
          nextSyncAt: espnNextSync(this.espnBbRhythm, this.espnBbLastFullRun),
          scoreUpdate: this.espnBbScoreUpdateResult
            ? {
                finishedUpdates: this.espnBbScoreUpdateResult.finishedUpdates.slice(0, 20),
                liveMatches: this.espnBbScoreUpdateResult.liveMatches.slice(0, 20),
                upcomingMatches: this.espnBbScoreUpdateResult.upcomingMatches,
                unmappedTeams: this.espnBbScoreUpdateResult.unmappedTeams.slice(0, 50),
              }
            : null,
        },
        oddsApi: {
          enabled: this.oddsSource.isEnabled(),
          lastSyncAt: this.oddsApiLastSync?.toISOString() ?? null,
          success: this.oddsApiSuccess,
          sportsSynced: this.oddsApiSportsSynced,
          remaining: this.oddsApiRemaining,
          used: this.oddsApiUsed,
          statusCode: this.oddsApiStatusCode,
          statusMessage: this.oddsApiStatusMessage,
          quotaThrottled: this.oddsApiQuotaThrottled,
          quotaExhausted:
            this.oddsApiStatusCode === 429 ||
            this.oddsApiRemaining === 0 ||
            (this.oddsApiRemaining !== null && this.oddsApiRemaining <= 5),
          rhythm: this.oddsApiRhythm,
          nextSyncAt: oddsNextSync(),
        },
        sportteryExternal: {
          enabled: this.isSyncWriteEnabled(),
          lastSyncAt: this.sportteryExternalLastSync?.toISOString() ?? null,
          success: this.sportteryExternalSuccess,
          directStatus: this.sportteryDirectStatus,
          lastError: this.sportteryDirectLastError,
          setupHint: this.isSyncWriteEnabled()
            ? ''
            : 'SYNC_API_TOKEN 未配置，请在妙搭部署后台→环境变量添加 SYNC_API_TOKEN（≥32位）',
          todayCount: this.externalTodayCount,
          scheduleIntervalSeconds: 600,
          scheduleIntervalLabel: '约10分钟(带随机抖动)',
        },
        beidan: {
          enabled: isBeidanEnabled(),
          lastSyncAt: this.beidanLastSync?.toISOString() ?? null,
          success: this.beidanSuccess,
          todayCount: this.beidanTodayCount,
        },
        qiumibao: {
          enabled: true,
          totalMatchCount: this.qiumibaoTotalRawCount,
          footballMatchCount: this.qiumibaoFootballCount,
          basketballMatchCount: this.qiumibaoBasketballCount,
          footballJcAligned: this.qiumibaoFbJcAligned,
          basketballJcAligned: this.qiumibaoBbJcAligned,
          football: {
            lastSyncAt: this.qiumibaoFbLastSync?.toISOString() ?? null,
            success: this.qiumibaoFbSuccess,
            todayCount: this.qiumibaoFbTodayCount,
            rhythm: this.qiumibaoFbRhythm,
            liveUpdated: this.qiumibaoFbScoreUpdateResult?.updated ?? 0,
          },
          basketball: {
            lastSyncAt: this.qiumibaoBbLastSync?.toISOString() ?? null,
            success: this.qiumibaoBbSuccess,
            todayCount: this.qiumibaoBbTodayCount,
            rhythm: this.qiumibaoBbRhythm,
            liveUpdated: this.qiumibaoBbScoreUpdateResult?.updated ?? 0,
          },
          lastScheduleSyncAt: this.qiumibaoLastScheduleSync?.toISOString() ?? null,
        },
        theSportsDb: {
          enabled: this.tsdbSource.isEnabled(),
          lastSyncAt: this.theSportsDbLastSync?.toISOString() ?? null,
          success: this.theSportsDbSuccess,
          todayCount: this.theSportsDbTodayCount,
          matchCount: this.theSportsDbFetchedCount,
          fetchedCount: this.theSportsDbFetchedCount,
          basketballMatchCount: this.theSportsDbBasketballCount,
          footballMatchCount: this.theSportsDbFootballCount,
          lastError: this.theSportsDbLastError,
          nextSyncAt: this.theSportsDbLastSync
            ? new Date(this.theSportsDbLastSync.getTime() + TSDB_SYNC_INTERVAL_MS).toISOString()
            : null,
        },
        espnSummary: {
          enabled: true,
          lastSyncAt: this.espnSummaryLastSync?.toISOString() ?? null,
          success: this.espnSummarySuccess,
          todayCount: this.espnSummaryTodayCount,
          updated: this.espnSummaryUpdated,
        },
        footballData: {
          enabled: this.footballDataSource.isEnabled(),
          lastSyncAt: this.footballDataLastSync?.toISOString() ?? null,
          success: this.footballDataSuccess,
          todayCount: this.footballDataTodayCount,
          updated: this.footballDataUpdated,
        },
        injurySource: {
          enabled: this.injurySource.isEnabled(),
          lastSyncAt: this.injuryLastSync?.toISOString() ?? null,
          success: this.injurySuccess,
          teamCount: this.injuryTeamCount,
          playerCount: this.injuryPlayerCount,
          lastError: this.injurySource.getLastError(),
          nextSyncAt: this.injuryLastSync
            ? new Date(this.injuryLastSync.getTime() + 30 * 60 * 1000).toISOString()
            : null,
        },
        footballDataOrg: {
          enabled: this.fdoSource.isEnabled(),
          lastSyncAt: this.fdoLastSync?.toISOString() ?? null,
          success: this.fdoSuccess,
          todayCount: this.fdoTodayCount,
          updated: this.fdoUpdated,
          lastError: this.fdoSource.getLastError(),
          requestCount: this.fdoSource.getRequestCount(),
          nextSyncAt: this.fdoLastSync && this.fdoSource.isEnabled()
            ? new Date(this.fdoLastSync.getTime() + 2 * 60 * 60 * 1000).toISOString()
            : null,
        },
        theRundown: {
          enabled: this.theRundownSource.isEnabled(),
          lastSyncAt: this.theRundownLastSync?.toISOString() ?? null,
          success: this.theRundownSuccess,
          todayCount: this.theRundownTodayCount,
          updated: this.theRundownUpdated,
        },
        apiSports: {
          enabled: this.apiSportsSource.isEnabled(),
          lastSyncAt: this.apiSportsLastSync?.toISOString() ?? null,
          success: this.apiSportsSuccess,
          todayCount: this.apiSportsTodayCount,
          footballMatchCount: this.apiSportsFootballCount,
          basketballMatchCount: this.apiSportsBasketballCount,
          quotaUsed: this.apiSportsSource.getQuotaUsed(),
          dailyLimit: this.apiSportsSource.getDailyLimit(),
          lastError: this.apiSportsLastError,
          nextSyncAt: this.apiSportsLastSync
            ? new Date(this.apiSportsLastSync.getTime() + APISPORTS_SYNC_INTERVAL_MS).toISOString()
            : null,
        },
      },
      syncTokenConfigured: this.isSyncWriteEnabled(),
      espnFootballTodayCount: this.espnFbTodayCount,
      espnBasketballTodayCount: this.espnBbTodayCount,
      oddsApiTodayCount: this.oddsApiTodayCount,
      pendingMappingTeams: {
        football: Array.from(this.espnFootballPendingMappings).slice(0, 50),
        basketball: Array.from(this.espnBasketballPendingMappings).slice(0, 50),
      },
      adaptive: {
        espnFootballRhythm: this.espnFbRhythm,
        espnBasketballRhythm: this.espnBbRhythm,
        oddsApiRhythm: this.oddsApiRhythm,
        oddsApiQuotaThrottled: this.oddsApiQuotaThrottled,
        oddsApiQuotaExhausted:
          this.oddsApiStatusCode === 429 ||
          this.oddsApiRemaining === 0 ||
          (this.oddsApiRemaining !== null && this.oddsApiRemaining <= 5),
        sportteryDirectStatus: this.sportteryDirectStatus,
        qiumibaoFbRhythm: this.qiumibaoFbRhythm,
        qiumibaoBbRhythm: this.qiumibaoBbRhythm,
        liveScoreIntervalLabel: '30-45秒(球美宝/ESPN)',
        todayFbLiveCount: fbStatus.live,
        todayFbUpcomingCount: fbStatus.upcoming,
        todayFbFinishedCount: fbStatus.finished,
        todayBbLiveCount: bbStatus.live,
        todayBbUpcomingCount: bbStatus.upcoming,
         todayBbFinishedCount: bbStatus.finished,
       },
       performance: this.computeListPerformance(),
       deployInfo: {
         version: process.env.npm_package_version || '8.0.0',
         buildTime: process.env.BUILD_TIME || new Date().toISOString(),
       },
     };
  }

  private computeListPerformance(): {
    footballListP50Ms: number;
    footballListP95Ms: number;
    basketballListP50Ms: number;
    basketballListP95Ms: number;
    timestamp: string;
  } {
    const cached = this._perfCache;
    const now = Date.now();
    if (cached && now - cached.timestamp < 60000) {
      return { ...cached.data, timestamp: new Date(cached.timestamp).toISOString() };
    }
    void this.runPerformanceBenchmark();
    return {
      footballListP50Ms: cached?.data.footballListP50Ms ?? 0,
      footballListP95Ms: cached?.data.footballListP95Ms ?? 0,
      basketballListP50Ms: cached?.data.basketballListP50Ms ?? 0,
      basketballListP95Ms: cached?.data.basketballListP95Ms ?? 0,
      timestamp: cached ? new Date(cached.timestamp).toISOString() : new Date(now).toISOString(),
    };
  }

  private async runPerformanceBenchmark(): Promise<void> {
    try {
      const today = this.getBeijingTodayStr();
      const nextDate = getNextDateStr(today);
      const footballTimes: number[] = [];
      for (let i = 0; i < 3; i++) {
        const start = process.hrtime.bigint();
        await this.db
          .select({ id: matches.id })
          .from(matches)
          .where(and(gte(matches.matchDate, today), lt(matches.matchDate, nextDate)))
          .orderBy(asc(matches.kickoffTime))
          .limit(50);
        footballTimes.push(Number(process.hrtime.bigint() - start) / 1e6);
      }
      const basketballTimes: number[] = [];
      for (let i = 0; i < 3; i++) {
        const start = process.hrtime.bigint();
        await this.db
          .select({ id: basketballMatches.id })
          .from(basketballMatches)
          .where(and(gte(basketballMatches.businessDate, today), lt(basketballMatches.businessDate, nextDate)))
          .orderBy(asc(basketballMatches.kickoffTime))
          .limit(50);
        basketballTimes.push(Number(process.hrtime.bigint() - start) / 1e6);
      }
      const fbSorted = [...footballTimes].sort((a: number, b: number) => a - b);
      const bbSorted = [...basketballTimes].sort((a: number, b: number) => a - b);
      this._perfCache = {
        timestamp: Date.now(),
        data: {
          footballListP50Ms: Math.round(fbSorted[1] * 100) / 100,
          footballListP95Ms: Math.round(fbSorted[2] * 100) / 100,
          basketballListP50Ms: Math.round(bbSorted[1] * 100) / 100,
          basketballListP95Ms: Math.round(bbSorted[2] * 100) / 100,
        },
      };
    } catch (err) {
      this.logger.warn(`perf benchmark failed: ${this.errorMessage(err)}`);
    }
  }

  // --- Internal: adaptive helpers ---

  private getBeijingTodayStr(): string {
    return getBeijingDateStr(new Date());
  }

  private async getDayMatchStatus(sport: 'football' | 'basketball'): Promise<{
    live: number;
    upcoming: number;
    finished: number;
    total: number;
  }> {
    const todayStr: string = this.getBeijingTodayStr();
    const table = sport === 'football' ? matches : basketballMatches;
    const condition =
      sport === 'football'
        ? eq(table.matchDate, sql`${todayStr}::date`)
        : eq(table.matchDate, todayStr);
    const rows = await this.db
      .select({ matchStatus: table.matchStatus })
      .from(table)
      .where(condition);

    let live = 0;
    let upcoming = 0;
    let finished = 0;
    for (const row of rows) {
      const s = row.matchStatus;
      if (s === 'live' || s === 'in-progress') {
        live += 1;
      } else if (s === 'upcoming' || s === 'pre') {
        upcoming += 1;
      } else if (s === 'finished' || s === 'post' || s === 'cancelled') {
        finished += 1;
      } else {
        upcoming += 1;
      }
    }
    return { live, upcoming, finished, total: rows.length };
  }

  private async hasUpcomingWithinHours(
    sport: 'football' | 'basketball',
    hours: number,
  ): Promise<boolean> {
    const table = sport === 'football' ? matches : basketballMatches;
    const now = new Date();
    const horizon = new Date(now.getTime() + hours * 3600 * 1000);
    const result = await this.db
      .select({ value: count() })
      .from(table)
      .where(
        and(
          eq(table.matchStatus, 'upcoming'),
          gte(table.kickoffTime, now),
          lt(table.kickoffTime, horizon),
        ),
      )
      .limit(1);
    return (result[0]?.value ?? 0) > 0;
  }

  private isOddsQuotaThrottled(remaining: number): boolean {
    // Rule 1: remaining < monthly total * 20%
    if (remaining < ODDS_API_MONTHLY_QUOTA_ESTIMATE * ODDS_API_QUOTA_THRESHOLD_RATIO) {
      return true;
    }
    // Rule 2: remaining / daysLeft < daily estimate * 0.5
    const now = new Date();
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    const msPerDay = 24 * 3600 * 1000;
    const daysLeft = Math.max(1, Math.ceil((endOfMonth.getTime() - now.getTime()) / msPerDay));
    const perDayRemaining = remaining / daysLeft;
    if (perDayRemaining < ODDS_API_DAILY_QUOTA_ESTIMATE * ODDS_API_QUOTA_LOW_RATIO) {
      return true;
    }
    return false;
  }

  // --- Internal: full sync flow ---

  private getBeijingHour(date: Date): number {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
    });
    return parseInt(fmt.format(date), 10);
  }

  private async runFullSync(): Promise<void> {
    // Jitter: 0-60s random delay to avoid thundering herd
    const jitterMs = Math.floor(Math.random() * 60 * 1000);
    if (jitterMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, jitterMs));
    }
    // Adaptive frequency: daytime(09:00-24:00 Beijing) ~10min, nighttime ~6h
    const now = new Date();
    const beijingHour = this.getBeijingHour(now);
    const isNighttime = beijingHour >= 0 && beijingHour < 9;
    if (isNighttime && this.lastSyncAt.football) {
      const elapsedMs = now.getTime() - this.lastSyncAt.football.getTime();
      if (elapsedMs < 6 * 60 * 60 * 1000) {
        return; // nighttime: skip until 6h elapsed
      }
    }
    this.logger.log('Running scheduled full sync');
    try {
      await this.syncFootball();
    } catch (err) {
      this.logger.error(`Football sync error: ${this.errorMessage(err)}`);
    }
    try {
      await this.syncBasketball();
    } catch (err) {
      this.logger.error(`Basketball sync error: ${this.errorMessage(err)}`);
    }
  }

  private async syncFootball(): Promise<{ inserted: number; updated: number; skipped: number }> {
    try {
      let items: NormalizedFootballMatch[] = [];
      let sourceUsed = 'sporttery';
      let fetchError: string | null = null;

      try {
        items = await this.fetchFootballSchedule();
      } catch (directErr) {
        fetchError = this.errorMessage(directErr);
        const errMsg = fetchError.toLowerCase();
        const isWafBlocked = /http 403|http 401|http 451|http 418|http 502|http 503|http 520|http 521|forbidden|unauthorized|waf|intercepted|security check/i.test(errMsg);
        this.logger.warn(
          `Sporttery direct football API failed (${fetchError}), falling back to qiumibao`,
        );
         const wafLabel = isWafBlocked ? '官方网站WAF拦截数据中心IP(HTTP403)' : null;
         this.sportteryDirectLastError = wafLabel ?? fetchError;
         this.sportteryDirectFailStreak += 1;
         if (isWafBlocked) {
           this.sportteryDirectStatus = 'blocked';
         } else if (this.sportteryDirectFailStreak >= 3) {
           this.sportteryDirectStatus = 'failed';
         }
       }

       if (items.length === 0) {
         try {
           const qmbResult = await this.qiumibaoSource.fetchFootballAll();
           sourceUsed = fetchError ? 'qiumibao-fallback' : 'qiumibao-supplement';
           items = this.normalizeQiumibaoFootball(qmbResult.matches);
        } catch (qmbErr) {
          if (!fetchError) throw qmbErr;
          throw new Error(
            `Sporttery direct failed (${fetchError}) AND qiumibao fallback failed (${this.errorMessage(qmbErr)})`,
          );
        }
      }

      const validItems: NormalizedFootballMatch[] = [];
      let skipped = 0;

      for (const item of items) {
        const result = this.validateFootballMatch(item);
        if (result.ok) {
          validItems.push(item);
        } else {
          skipped += 1;
          this.logger.warn(
            `Football match validation skipped (${item.matchNo}/${item.matchDate}): ${result.reason}`,
          );
        }
      }

      const upsertFbResult = await this.upsertFootballMatches(validItems);
      this.lastSyncAt.football = new Date();
      this.lastSyncStatus.football = {
        statusCode: 200,
        success: true,
        inserted: upsertFbResult.inserted,
        updated: upsertFbResult.updated,
        skipped: upsertFbResult.skipped + skipped,
        message: `inserted=${upsertFbResult.inserted}, updated=${upsertFbResult.updated}, skipped=${upsertFbResult.skipped + skipped}, source=${sourceUsed}${
          fetchError ? ` (direct: ${fetchError})` : ''
        }${upsertFbResult.lastError ? ` (lastError: ${upsertFbResult.lastError})` : ''}`,
      };
       this.sportteryExternalLastSync = new Date();
       this.sportteryExternalSuccess = !fetchError;
       if (!fetchError && upsertFbResult.lastError) {
         this.sportteryDirectLastError = upsertFbResult.lastError;
       }
       this.externalTodayCount += 1;
       if (!fetchError) {
         this.sportteryDirectFailStreak = 0;
         if (this.sportteryDirectStatus === 'failed' || this.sportteryDirectStatus === 'blocked') {
           this.sportteryDirectStatus = 'auto';
         }
       }
       this.logger.log(
         `Football sync complete (${sourceUsed}): inserted=${upsertFbResult.inserted}, updated=${upsertFbResult.updated}, skipped=${upsertFbResult.skipped + skipped}`,
       );
      return {
        inserted: upsertFbResult.inserted,
        updated: upsertFbResult.updated,
        skipped: upsertFbResult.skipped + skipped,
      };
    } catch (err) {
      this.lastSyncAt.football = new Date();
      this.lastSyncStatus.football = {
        statusCode: 500,
        success: false,
        message: this.errorMessage(err),
      };
      this.sportteryDirectLastError = this.errorMessage(err);
      this.sportteryDirectFailStreak += 1;
      if (this.sportteryDirectFailStreak >= 2) {
        this.sportteryDirectStatus = 'failed';
      }
      this.staleCount += 1;
      this.logger.error(`Football sync failed: ${this.errorMessage(err)}`);
      return { inserted: 0, updated: 0, skipped: 0 };
    }
  }

  private async syncBasketball(): Promise<{ inserted: number; updated: number; skipped: number }> {
    try {
      let items: NormalizedBasketballMatch[] = [];
      let sourceUsed = 'sporttery';
      let fetchError: string | null = null;

      try {
        items = await this.fetchBasketballSchedule();
      } catch (directErr) {
        fetchError = this.errorMessage(directErr);
        const errMsg = fetchError.toLowerCase();
        const isWafBlocked = /http 403|http 401|http 451|http 418|http 502|http 503|http 520|http 521|forbidden|unauthorized|waf|intercepted|security check/i.test(errMsg);
        this.logger.warn(
          `Sporttery direct basketball API failed (${fetchError}), falling back to qiumibao`,
        );
         const wafLabel = isWafBlocked ? '官方网站WAF拦截数据中心IP(HTTP403)' : null;
         this.sportteryDirectLastError = wafLabel ?? fetchError;
         this.sportteryDirectFailStreak += 1;
         if (isWafBlocked) {
           this.sportteryDirectStatus = 'blocked';
         } else if (this.sportteryDirectFailStreak >= 3) {
           this.sportteryDirectStatus = 'failed';
         }
       }

      if (items.length === 0) {
        try {
          const qmbResult = await this.qiumibaoSource.fetchBasketballAll();
          sourceUsed = fetchError ? 'qiumibao-fallback' : 'qiumibao-supplement';
          items = this.normalizeQiumibaoBasketball(qmbResult.matches);
        } catch (qmbErr) {
          if (!fetchError) throw qmbErr;
          throw new Error(
            `Sporttery direct failed (${fetchError}) AND qiumibao fallback failed (${this.errorMessage(qmbErr)})`,
          );
        }
      } else {
        // 从球美宝补充带竞彩场次号但尚未在竞彩官方接口出现的赛程（pending_sale）
        try {
          const qmbResult = await this.qiumibaoSource.fetchBasketballAll();
          const sportteryMatchNos = new Set(items.map((it: NormalizedBasketballMatch) => it.matchNo));
          const qmbAll = this.normalizeQiumibaoBasketball(qmbResult.matches);
          const pendingSales: NormalizedBasketballMatch[] = [];
          for (const m of qmbAll) {
            if (!m.matchNo || m.matchNo.startsWith('QMB-')) continue;
            if (sportteryMatchNos.has(m.matchNo)) continue;
            const isOfficialMatchNo = /^[\u4e00-\u9fa5]+\d+$/.test(m.matchNo) || /^\d{4,}$/.test(m.matchNo);
            if (!isOfficialMatchNo) continue;
            if (m.matchStatus !== 'upcoming') continue;
            pendingSales.push({
              ...m,
              source: 'sporttery-pending',
              isPendingSale: true,
              matchStatus: 'pending_sale',
              handicap: '',
              totalLine: '',
              homeWinOdds: '',
              awayWinOdds: '',
              handicapOddsHome: '',
              handicapOddsAway: '',
              totalOddsOver: '',
              totalOddsUnder: '',
            });
          }
          if (pendingSales.length > 0) {
            items = [...items, ...pendingSales];
            sourceUsed = `${sourceUsed}+qmb-pending(${pendingSales.length})`;
          }
        } catch (qmbErr) {
          this.logger.warn(`Qiumibao pending sale supplement failed: ${this.errorMessage(qmbErr)}`);
        }
      }

      if (items.length === 0) {
        this.lastSyncAt.basketball = new Date();
        const allSourcesEmpty = !!fetchError;
        const statusCode = allSourcesEmpty ? 502 : 200;
        this.lastSyncStatus.basketball = {
          statusCode,
          success: !allSourcesEmpty,
          message: allSourcesEmpty
            ? `All basketball sources returned empty (sporttery blocked/failed + qiumibao empty)`
            : `No basketball matches available (source=${sourceUsed})`,
        };
        this.sportteryExternalLastSync = new Date();
        this.sportteryExternalSuccess = !allSourcesEmpty;
        this.sportteryExternalLastError = allSourcesEmpty
          ? `官方直连被拦截/失败且球美宝无数据（${fetchError ?? ''}）`
          : null;
        this.logger.warn('Basketball sync: all sources returned empty');
        return { inserted: 0, updated: 0, skipped: 0 };
      }

      const upsertBbResult = await this.upsertBasketballMatches(items);

      if (this.dataDrivenService && upsertBbResult.inserted > 0) {
        try {
          const newMatchIds = await this.db
            .select({ id: basketballMatches.id })
            .from(basketballMatches)
            .where(and(
              eq(basketballMatches.source, 'sporttery'),
              eq(basketballMatches.matchStatus, 'upcoming'),
              ne(basketballMatches.predEngineVersion, 'data-driven-v1.0'),
            ));
          if (newMatchIds.length > 0) {
            const preds = await this.dataDrivenService.predictByIds(
              newMatchIds.map((r) => r.id),
            );
            const applyResult = await this.dataDrivenService.applyPredictions(preds);
            this.logger.log(
              `[data-driven-init] basketball sync: ${applyResult.updated}/${newMatchIds.length} new matches predicted (source=${sourceUsed})`,
            );
          }
        } catch (ddErr: unknown) {
          this.logger.error(
            `[data-driven-init] basketball sync failed: ${this.errorMessage(ddErr)}`,
          );
        }
      }

       this.lastSyncAt.basketball = new Date();
       this.lastSyncStatus.basketball = {
         statusCode: 200,
         success: true,
         inserted: upsertBbResult.inserted,
         updated: upsertBbResult.updated,
         skipped: upsertBbResult.skipped,
         message: `inserted=${upsertBbResult.inserted}, updated=${upsertBbResult.updated}, skipped=${upsertBbResult.skipped}, source=${sourceUsed}${
           fetchError ? ` (direct: ${fetchError})` : ''
         }${upsertBbResult.lastError ? ` (lastError: ${upsertBbResult.lastError})` : ''}`,
       };
       this.sportteryExternalLastSync = new Date();
       this.sportteryExternalSuccess = !fetchError;
       if (!fetchError && upsertBbResult.lastError) {
         this.sportteryDirectLastError = upsertBbResult.lastError;
       }
       this.externalTodayCount += 1;
       if (!fetchError) {
         this.sportteryDirectFailStreak = 0;
         if (this.sportteryDirectStatus === 'failed' || this.sportteryDirectStatus === 'blocked') {
           this.sportteryDirectStatus = 'auto';
         }
       }
       this.logger.log(
         `Basketball sync complete (${sourceUsed}): inserted=${upsertBbResult.inserted}, updated=${upsertBbResult.updated}, skipped=${upsertBbResult.skipped}`,
       );
      return {
        inserted: upsertBbResult.inserted,
        updated: upsertBbResult.updated,
        skipped: upsertBbResult.skipped,
      };
    } catch (err) {
      this.lastSyncAt.basketball = new Date();
      this.lastSyncStatus.basketball = {
        statusCode: 500,
        success: false,
        message: this.errorMessage(err),
      };
      this.sportteryDirectLastError = this.errorMessage(err);
      this.sportteryDirectFailStreak += 1;
      if (this.sportteryDirectFailStreak >= 2) {
        this.sportteryDirectStatus = 'failed';
      }
      this.staleCount += 1;
      this.logger.error(`Basketball sync failed: ${this.errorMessage(err)}`);
      return { inserted: 0, updated: 0, skipped: 0 };
    }
  }

  private async checkLiveScores(): Promise<void> {
    // Sporttery score APIs are WAF-blocked; ESPN is now the primary live score source.
    // Delegate to ESPN live sync for backward compatibility with the score category.
    await this.runEspnLiveSync();
  }

  // --- ESPN deep data sync (team stats, key players, H2H, form) ---

  private readonly BB_TEAM_STATS_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  private readonly BB_DEEP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d
  private readonly FB_TEAM_STATS_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  private readonly FB_DEEP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d

  private async enrichBasketballDeepData(
    espnMatches: ESPNBasketballMatch[],
  ): Promise<{ updated: number; errors: number }> {
    if (this.bbDeepSyncInProgress) return { updated: 0, errors: 0 };
    this.bbDeepSyncInProgress = true;
    let updated = 0;
    let errors = 0;

    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const allDb = await this.db
        .select({
          id: basketballMatches.id,
          homeTeam: basketballMatches.homeTeam,
          awayTeam: basketballMatches.awayTeam,
          matchDate: basketballMatches.matchDate,
          kickoffTime: basketballMatches.kickoffTime,
          keyPlayers: basketballMatches.keyPlayers,
          h2hHistory: basketballMatches.h2hHistory,
          updatedAt: basketballMatches.updatedAt,
          sourceId: basketballMatches.sourceId,
          league: basketballMatches.league,
          sourceLeagueCode: basketballMatches.sourceLeagueCode,
          injuries: basketballMatches.injuries,
          teamStats: basketballMatches.teamStats,
        })
        .from(basketballMatches)
        .where(
          and(
            gte(basketballMatches.kickoffTime, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)),
            lte(basketballMatches.kickoffTime, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
          ),
        );

      for (const dbRow of allDb) {
        const isNBA = dbRow.league?.includes('NBA') || dbRow.league?.includes('美国职业');
        const isWNBA = dbRow.league?.includes('WNBA') || dbRow.league?.includes('女子');
        const lookupMap = isWNBA ? WNBA_TEAM_NAME_MAP : (isNBA ? NBA_TEAM_NAME_MAP : null);

        const findEnglishName = (cnName: string): string | null => {
          if (!lookupMap) return null;
          for (const [eng, aliases] of Object.entries(lookupMap)) {
            if (aliases.some((a: string) => cnName.includes(a) || a.includes(cnName))) {
              return eng;
            }
          }
          return null;
        };

        const dbHomeEng = findEnglishName(dbRow.homeTeam);
        const dbAwayEng = findEnglishName(dbRow.awayTeam);
        const dbHomeNorm = dbHomeEng ? normalizeTeamName(dbHomeEng) : normalizeTeamName(dbRow.homeTeam);
        const dbAwayNorm = dbAwayEng ? normalizeTeamName(dbAwayEng) : normalizeTeamName(dbRow.awayTeam);

        const espnMatch = espnMatches.find((m) => {
          const mHome = normalizeTeamName(m.homeTeam);
          const mAway = normalizeTeamName(m.awayTeam);
          const exactFwd = mHome === dbHomeNorm && mAway === dbAwayNorm;
          const exactRev = mHome === dbAwayNorm && mAway === dbHomeNorm;
          if (exactFwd || exactRev) return true;
          const fuzzyHome =
            mHome.includes(dbHomeNorm.slice(0, 4)) || dbHomeNorm.includes(mHome.slice(0, 4));
          const fuzzyAway =
            mAway.includes(dbAwayNorm.slice(0, 4)) || dbAwayNorm.includes(mAway.slice(0, 4));
          return fuzzyHome && fuzzyAway;
        });
        if (!espnMatch || !espnMatch.sourceId) continue;

        const hasKeyPlayers = dbRow.keyPlayers && Object.keys(dbRow.keyPlayers as Record<string, unknown>).length > 0;
        const hasH2h = dbRow.h2hHistory && Array.isArray(dbRow.h2hHistory) && dbRow.h2hHistory.length > 0;
        const hasInjuries = dbRow.injuries && Object.keys(dbRow.injuries as Record<string, unknown>).length > 0;
        const isFresh = dbRow.updatedAt && dbRow.updatedAt > oneWeekAgo;
        if (hasKeyPlayers && hasH2h && hasInjuries && isFresh) continue;

        try {
          const deepCacheKey = `summary:${espnMatch.leagueCode}:${espnMatch.sourceId}`;
          const cached = this.bbDeepCache.get(deepCacheKey);
          let summary: Awaited<ReturnType<EspnSource['fetchBasketballEventSummary']>> | null = null;
          if (cached && Date.now() - cached.fetchedAt < this.BB_DEEP_TTL_MS) {
            summary = cached.data as typeof summary;
          } else {
            try {
              summary = await this.espnSource.fetchBasketballEventSummary(
                espnMatch.leagueCode, espnMatch.sourceId,
              );
              this.bbDeepCache.set(deepCacheKey, { data: summary, fetchedAt: Date.now() });
            } catch (_err) {
              // leave fields empty
            }
          }

          const fetchTeamStats = async (teamId: string | undefined): Promise<Record<string, string>> => {
            if (!teamId) return {};
            const cacheKey = `${espnMatch.leagueCode}:${teamId}`;
            const cachedStats = this.bbTeamStatsCache.get(cacheKey);
            if (cachedStats && Date.now() - cachedStats.fetchedAt < this.BB_TEAM_STATS_TTL_MS) {
              return cachedStats.data;
            }
            try {
              const result = await this.espnSource.fetchBasketballTeamStats(
                espnMatch.leagueCode, teamId,
              );
              this.bbTeamStatsCache.set(cacheKey, { data: result.stats, fetchedAt: Date.now() });
              return result.stats;
            } catch (_err) {
              return {};
            }
          };

          const [homeStatsRaw, awayStatsRaw] = await Promise.all([
            fetchTeamStats(summary?.homeTeamId || espnMatch.homeTeamId),
            fetchTeamStats(summary?.awayTeamId || espnMatch.awayTeamId),
          ]);

          const keyPlayersHome: { name: string; position: string; ppg: number; rpg: number; apg: number }[] = [];
          const keyPlayersAway: { name: string; position: string; ppg: number; rpg: number; apg: number }[] = [];
          if (summary) {
            for (const p of summary.homeLeaders) {
              keyPlayersHome.push({ name: p.name, position: p.position, ppg: p.ppg ?? 0, rpg: p.rpg ?? 0, apg: p.apg ?? 0 });
            }
            for (const p of summary.awayLeaders) {
              keyPlayersAway.push({ name: p.name, position: p.position, ppg: p.ppg ?? 0, rpg: p.rpg ?? 0, apg: p.apg ?? 0 });
            }
          }

           const homeStats = {
             winRate: homeStatsRaw['Win Percentage'] || '',
             pointsPerGame: homeStatsRaw['Points Per Game'] || '',
             reboundsPerGame: homeStatsRaw['Rebounds Per Game'] || '',
             assistsPerGame: homeStatsRaw['Assists Per Game'] || '',
             fieldGoalPct: homeStatsRaw['Field Goal Percentage'] || '',
             threePointPct: homeStatsRaw['Three Point Percentage'] || '',
             fieldGoalsAttemptedPerGame: homeStatsRaw['Average Field Goals Attempted'] || '',
             freeThrowsAttemptedPerGame: homeStatsRaw['Average Free Throws Attempted'] || '',
             turnoversPerGame: homeStatsRaw['Turnovers Per Game'] || '',
             offensiveReboundsPerGame: homeStatsRaw['Offensive Rebounds Per Game'] || '',
             defensiveReboundsPerGame: homeStatsRaw['Defensive Rebounds Per Game'] || '',
             freeThrowPct: homeStatsRaw['Free Throw Percentage'] || '',
             stealsPerGame: homeStatsRaw['Steals Per Game'] || '',
             blocksPerGame: homeStatsRaw['Blocks Per Game'] || '',
             homeRecord: summary?.homeHomeRecord || '',
             awayRecord: '',
           };
           const awayStats = {
             winRate: awayStatsRaw['Win Percentage'] || '',
             pointsPerGame: awayStatsRaw['Points Per Game'] || '',
             reboundsPerGame: awayStatsRaw['Rebounds Per Game'] || '',
             assistsPerGame: awayStatsRaw['Assists Per Game'] || '',
             fieldGoalPct: awayStatsRaw['Field Goal Percentage'] || '',
             threePointPct: awayStatsRaw['Three Point Percentage'] || '',
             fieldGoalsAttemptedPerGame: awayStatsRaw['Average Field Goals Attempted'] || '',
             freeThrowsAttemptedPerGame: awayStatsRaw['Average Free Throws Attempted'] || '',
             turnoversPerGame: awayStatsRaw['Turnovers Per Game'] || '',
             offensiveReboundsPerGame: awayStatsRaw['Offensive Rebounds Per Game'] || '',
             defensiveReboundsPerGame: awayStatsRaw['Defensive Rebounds Per Game'] || '',
             freeThrowPct: awayStatsRaw['Free Throw Percentage'] || '',
             stealsPerGame: awayStatsRaw['Steals Per Game'] || '',
             blocksPerGame: awayStatsRaw['Blocks Per Game'] || '',
             homeRecord: '',
             awayRecord: summary?.awayRoadRecord || '',
           };

          let h2hItems: { date: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }[] = [];
          const h2hCacheKey = `h2h:${espnMatch.leagueCode}:${espnMatch.sourceId}`;
          const h2hCached = this.bbDeepCache.get(h2hCacheKey);
          if (h2hCached && Date.now() - h2hCached.fetchedAt < this.BB_DEEP_TTL_MS) {
            h2hItems = h2hCached.data as typeof h2hItems;
          } else {
            try {
              const h2hResult = await this.espnSource.fetchBasketballH2h(
                espnMatch.leagueCode, espnMatch.sourceId,
              );
              h2hItems = h2hResult.h2h;
              this.bbDeepCache.set(h2hCacheKey, { data: h2hItems, fetchedAt: Date.now() });
            } catch (_err) {
              // H2H may not be available
            }
          }

          const updateSet: Partial<typeof basketballMatches.$inferInsert> = {};

          if (!dbRow.sourceId && espnMatch.sourceId) {
            updateSet.sourceId = espnMatch.sourceId;
          }
          if (!dbRow.sourceLeagueCode && espnMatch.leagueCode) {
            updateSet.sourceLeagueCode = espnMatch.leagueCode;
          }

          if (keyPlayersHome.length > 0 || keyPlayersAway.length > 0) {
            updateSet.keyPlayers = {
              home: keyPlayersHome,
              away: keyPlayersAway,
            };
          }

          if (h2hItems.length > 0) {
            updateSet.h2hHistory = h2hItems;
          }

          if (Object.keys(homeStatsRaw).length > 0 || Object.keys(awayStatsRaw).length > 0) {
            updateSet.teamStats = {
              home: homeStats,
              away: awayStats,
            };
          }

          if (summary?.homeForm || summary?.awayForm) {
            updateSet.recentForm = {
              home: summary.homeForm,
              away: summary.awayForm,
            };
          }

          if (Object.keys(updateSet).length > 0) {
            updateSet.updatedAt = new Date();
            updateSet.intelUpdatedAt = new Date();
            await this.db.update(basketballMatches)
              .set(updateSet)
              .where(eq(basketballMatches.id, dbRow.id));
            updated += 1;
          }
        } catch (err) {
          errors += 1;
          this.logger.warn(
            `Deep data enrichment failed for basketball match ${dbRow.homeTeam} vs ${dbRow.awayTeam}: ${this.errorMessage(err)}`,
          );
        }
      }
    } finally {
      this.bbDeepSyncInProgress = false;
    }

    if (updated > 0 || errors > 0) {
      this.logger.log(`Basketball deep data enrichment: updated=${updated}, errors=${errors}`);
    }
    return { updated, errors };
  }

  private async enrichFootballDeepData(
    espnMatches: ESPNFootballMatch[],
  ): Promise<{ updated: number; errors: number }> {
    if (this.fbDeepSyncInProgress) return { updated: 0, errors: 0 };
    this.fbDeepSyncInProgress = true;
    let updated = 0;
    let errors = 0;

    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const allDb = await this.db
        .select({
          id: matches.id,
          homeTeam: matches.homeTeam,
          awayTeam: matches.awayTeam,
          matchDate: matches.matchDate,
          kickoffTime: matches.kickoffTime,
          homeForm: matches.homeForm,
          awayForm: matches.awayForm,
          h2h: matches.h2h,
          updatedAt: matches.updatedAt,
          sourceId: matches.sourceId,
          league: matches.league,
          sourceLeagueCode: matches.sourceLeagueCode,
          advancedStats: matches.advancedStats,
          homeGoalsAvg: matches.homeGoalsAvg,
          awayGoalsAvg: matches.awayGoalsAvg,
          homeConcededAvg: matches.homeConcededAvg,
          awayConcededAvg: matches.awayConcededAvg,
          homeHomeRecord: matches.homeHomeRecord,
          awayAwayRecord: matches.awayAwayRecord,
          homeInjuries: matches.homeInjuries,
          awayInjuries: matches.awayInjuries,
        })
        .from(matches)
        .where(
          and(
            gte(matches.kickoffTime, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)),
            lte(matches.kickoffTime, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
            eq(matches.source, 'sporttery'),
          ),
        );

      for (const dbRow of allDb) {
        const dbHomeNorm = normalizeTeamName(dbRow.homeTeam);
        const dbAwayNorm = normalizeTeamName(dbRow.awayTeam);
        let espnMatch = espnMatches.find((m) =>
          normalizeTeamName(m.homeTeam) === dbHomeNorm && normalizeTeamName(m.awayTeam) === dbAwayNorm,
        );
        if (!espnMatch) {
          espnMatch = espnMatches.find((m) => {
            const espnHome = normalizeTeamName(m.homeTeam);
            const espnAway = normalizeTeamName(m.awayTeam);
            const homeMatch = espnHome.includes(dbHomeNorm.slice(0, 4)) ||
              dbHomeNorm.includes(espnHome.slice(0, 4));
            const awayMatch = espnAway.includes(dbAwayNorm.slice(0, 4)) ||
              dbAwayNorm.includes(espnAway.slice(0, 4));
            return homeMatch && awayMatch;
          });
        }
        if (!espnMatch || !espnMatch.sourceId) continue;

        const hasForm = dbRow.homeForm && dbRow.homeForm.length > 0 && dbRow.awayForm && dbRow.awayForm.length > 0;
        const hasH2h = dbRow.h2h && dbRow.h2h.length > 0;
        const hasAdv = dbRow.advancedStats && Object.keys(dbRow.advancedStats as Record<string, unknown> || {}).length > 0;
        const isFresh = dbRow.updatedAt && dbRow.updatedAt > oneWeekAgo;
        if (hasForm && hasH2h && hasAdv && isFresh) continue;

        const isEmptyText = (v: string | null) => v === null || v === '';

        try {
          const deepCacheKey = `fb:summary:${espnMatch.leagueCode}:${espnMatch.sourceId}`;
          const cached = this.fbDeepCache.get(deepCacheKey);
          let summary: Awaited<ReturnType<EspnSource['fetchFootballEventSummary']>> | null = null;
          if (cached && Date.now() - cached.fetchedAt < this.FB_DEEP_TTL_MS) {
            summary = cached.data as typeof summary;
          } else {
            try {
              summary = await this.espnSource.fetchFootballEventSummary(
                espnMatch.leagueCode, espnMatch.sourceId,
              );
              this.fbDeepCache.set(deepCacheKey, { data: summary, fetchedAt: Date.now() });
            } catch (_err) {
              // leave fields empty
            }
          }

          const fetchTeamStats = async (teamId: string | undefined): Promise<Record<string, string>> => {
            if (!teamId) return {};
            const cacheKey = `fb:stats:${espnMatch.leagueCode}:${teamId}`;
            const cachedStats = this.fbTeamStatsCache.get(cacheKey);
            if (cachedStats && Date.now() - cachedStats.fetchedAt < this.FB_TEAM_STATS_TTL_MS) {
              return cachedStats.data;
            }
            try {
              const result = await this.espnSource.fetchFootballTeamStats(
                espnMatch.leagueCode, teamId,
              );
              this.fbTeamStatsCache.set(cacheKey, { data: result.stats, fetchedAt: Date.now() });
              return result.stats;
            } catch (_err) {
              return {};
            }
          };

          const [homeStatsRaw, awayStatsRaw] = await Promise.all([
            fetchTeamStats(summary?.homeTeamId),
            fetchTeamStats(summary?.awayTeamId),
          ]);

          let h2hItems: { date: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }[] = [];
          const h2hCacheKey = `fb:h2h:${espnMatch.leagueCode}:${espnMatch.sourceId}`;
          const h2hCached = this.fbDeepCache.get(h2hCacheKey);
          if (h2hCached && Date.now() - h2hCached.fetchedAt < this.FB_DEEP_TTL_MS) {
            h2hItems = h2hCached.data as typeof h2hItems;
          } else {
            try {
              const h2hResult = await this.espnSource.fetchFootballH2h(
                espnMatch.leagueCode, espnMatch.sourceId,
              );
              h2hItems = h2hResult.h2h;
              this.fbDeepCache.set(h2hCacheKey, { data: h2hItems, fetchedAt: Date.now() });
            } catch (_err) {
              // H2H may not be available
            }
          }

          const updateSet: Partial<typeof matches.$inferInsert> = {};

          // 近期战绩 (homeForm/awayForm text[])
          if (summary && summary.homeForm.length > 0) {
            updateSet.homeForm = summary.homeForm.map((f) => `${f.result} ${f.opponent} ${f.score}`.trim());
          }
          if (summary && summary.awayForm.length > 0) {
            updateSet.awayForm = summary.awayForm.map((f) => `${f.result} ${f.opponent} ${f.score}`.trim());
          }

          // H2H (text[]) - 过滤未赛场次
          const filteredH2h = h2hItems.filter(
            (h) => h.homeScore > 0 || h.awayScore > 0,
          );
          if (filteredH2h.length > 0) {
            updateSet.h2h = filteredH2h
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              .map((h) => `${h.date.slice(0, 10)} ${h.homeTeam} ${h.homeScore}-${h.awayScore} ${h.awayTeam}`);
          }

          const existingAdvancedStats = (dbRow.advancedStats as Record<string, unknown> | undefined) || {};
          if (summary && summary.matchStats.home && summary.matchStats.away) {
            updateSet.advancedStats = {
              ...existingAdvancedStats,
              dataSource: 'espn_summary',
              quality: 'high',
              shotsHome: summary.matchStats.home.totalShots,
              shotsAway: summary.matchStats.away.totalShots,
              shotsOnTargetHome: summary.matchStats.home.shotsOnTarget,
              shotsOnTargetAway: summary.matchStats.away.shotsOnTarget,
              cornersHome: summary.matchStats.home.wonCorners,
              cornersAway: summary.matchStats.away.wonCorners,
              possessionHome: summary.matchStats.home.possessionPct,
              possessionAway: summary.matchStats.away.possessionPct,
              foulsHome: summary.matchStats.home.foulsCommitted,
              foulsAway: summary.matchStats.away.foulsCommitted,
              passAccuracyHome: summary.matchStats.home.passPct,
              passAccuracyAway: summary.matchStats.away.passPct,
            };
          }

          // advancedStats (jsonb) - 场均数据
          if (Object.keys(homeStatsRaw).length > 0 || Object.keys(awayStatsRaw).length > 0) {
            const parseNum = (v: string | undefined): number => {
              if (!v) return 0;
              const n = Number(v.replace(/[^0-9.]/g, ''));
              return Number.isNaN(n) ? 0 : n;
            };
            const findStatKey = (stats: Record<string, string>, keywords: string[]): string | undefined => {
              const lowerKeys = Object.keys(stats);
              for (const k of lowerKeys) {
                const kl = k.toLowerCase();
                if (keywords.every(kw => kl.includes(kw.toLowerCase()))) {
                  return stats[k];
                }
              }
              return undefined;
            };
            const homeGoalsFor = findStatKey(homeStatsRaw, ['goals for', 'per game']) ||
              findStatKey(homeStatsRaw, ['goals per game']) ||
              findStatKey(homeStatsRaw, ['scored per']);
            const awayGoalsFor = findStatKey(awayStatsRaw, ['goals for', 'per game']) ||
              findStatKey(awayStatsRaw, ['goals per game']) ||
              findStatKey(awayStatsRaw, ['scored per']);
            const homeGoalsAgainst = findStatKey(homeStatsRaw, ['goals against', 'per game']) ||
              findStatKey(homeStatsRaw, ['against per']) ||
              findStatKey(homeStatsRaw, ['concede per']);
            const awayGoalsAgainst = findStatKey(awayStatsRaw, ['goals against', 'per game']) ||
              findStatKey(awayStatsRaw, ['against per']) ||
              findStatKey(awayStatsRaw, ['concede per']);
            if (dbRow.homeGoalsAvg === null || Number(dbRow.homeGoalsAvg) === 0) {
              const v = parseNum(homeGoalsFor);
              if (v > 0) updateSet.homeGoalsAvg = String(v);
            }
            if (dbRow.awayGoalsAvg === null || Number(dbRow.awayGoalsAvg) === 0) {
              const v = parseNum(awayGoalsFor);
              if (v > 0) updateSet.awayGoalsAvg = String(v);
            }
            if (dbRow.homeConcededAvg === null || Number(dbRow.homeConcededAvg) === 0) {
              const v = parseNum(homeGoalsAgainst);
              if (v > 0) updateSet.homeConcededAvg = String(v);
            }
            if (dbRow.awayConcededAvg === null || Number(dbRow.awayConcededAvg) === 0) {
              const v = parseNum(awayGoalsAgainst);
              if (v > 0) updateSet.awayConcededAvg = String(v);
            }
            const teamStatsAdvanced: Record<string, number> = {};
            const homeShots = parseNum(homeStatsRaw['Shots Per Game']);
            const awayShots = parseNum(awayStatsRaw['Shots Per Game']);
            const homePossession = parseNum(homeStatsRaw['Possession Percentage']);
            const awayPossession = parseNum(awayStatsRaw['Possession Percentage']);
            const homePassAcc = parseNum(homeStatsRaw['Pass Completion Percentage']);
            const awayPassAcc = parseNum(awayStatsRaw['Pass Completion Percentage']);
            if (homeShots > 0) teamStatsAdvanced.shotsHome = homeShots;
            if (awayShots > 0) teamStatsAdvanced.shotsAway = awayShots;
            if (homePossession > 0) teamStatsAdvanced.possessionHome = homePossession;
            if (awayPossession > 0) teamStatsAdvanced.possessionAway = awayPossession;
            if (homePassAcc > 0) teamStatsAdvanced.passAccuracyHome = homePassAcc;
            if (awayPassAcc > 0) teamStatsAdvanced.passAccuracyAway = awayPassAcc;
            if (Object.keys(teamStatsAdvanced).length > 0) {
              updateSet.advancedStats = {
                ...((dbRow.advancedStats as Record<string, number> | undefined) || {}),
                ...teamStatsAdvanced,
                ...(updateSet.advancedStats as Record<string, unknown> | undefined),
              };
            }
          }

          if (isEmptyText(dbRow.homeHomeRecord) && summary && summary.homeForm.length > 0) {
            const homeHomeForm = summary.homeForm
              .filter(f => f.result === '胜' || f.result === '负' || f.result === '平')
              .slice(0, 10)
              .map(f => f.result.slice(0, 1))
              .join('');
            if (homeHomeForm.length >= 3) updateSet.homeHomeRecord = homeHomeForm;
          }
          if (isEmptyText(dbRow.awayAwayRecord) && summary && summary.awayForm.length > 0) {
            const awayAwayForm = summary.awayForm
              .filter(f => f.result === '胜' || f.result === '负' || f.result === '平')
              .slice(0, 10)
              .map(f => f.result.slice(0, 1))
              .join('');
            if (awayAwayForm.length >= 3) updateSet.awayAwayRecord = awayAwayForm;
          }

          if (isEmptyText(dbRow.homeInjuries) || isEmptyText(dbRow.awayInjuries)) {
            try {
              const summaryData = await this.espnSource.fetchFootballSummary(
                espnMatch.sourceId,
                espnMatch.leagueCode,
              );
              if (summaryData) {
                const injuryToText = (inj: { athleteName: string; status: string }) =>
                  `${inj.athleteName} - ${inj.status}`;
                if (isEmptyText(dbRow.homeInjuries) && summaryData.homeInjuries.length > 0) {
                  updateSet.homeInjuries = summaryData.homeInjuries.map(injuryToText).join('\n') + '\n[ESPN 来源]';
                }
                if (isEmptyText(dbRow.awayInjuries) && summaryData.awayInjuries.length > 0) {
                  updateSet.awayInjuries = summaryData.awayInjuries.map(injuryToText).join('\n') + '\n[ESPN 来源]';
                }
              }
            } catch (_err) {
              // injuries may not be available
            }
          }

          if (Object.keys(updateSet).length > 0) {
            updateSet.updatedAt = new Date();
            updateSet.intelUpdatedAt = new Date();
            await this.db.update(matches)
              .set(updateSet)
              .where(eq(matches.id, dbRow.id));
            updated += 1;
          }
        } catch (err) {
          errors += 1;
          this.logger.warn(
            `Deep data enrichment failed for football match ${dbRow.homeTeam} vs ${dbRow.awayTeam}: ${this.errorMessage(err)}`,
          );
        }
      }
    } finally {
      this.fbDeepSyncInProgress = false;
    }

    if (updated > 0 || errors > 0) {
      this.logger.log(`Football deep data enrichment: updated=${updated}, errors=${errors}`);
    }
    return { updated, errors };
  }

  // --- ESPN live score sync ---

  private async runEspnLiveSync(): Promise<void> {
    const now = Date.now();

    // Determine per-sport rhythm from DB
    const [fbStatus, bbStatus] = await Promise.all([
      this.getDayMatchStatus('football'),
      this.getDayMatchStatus('basketball'),
    ]);

    const fbRhythm: EspnRhythm =
      fbStatus.live > 0 ? 'live' : fbStatus.upcoming > 0 ? 'upcoming' : 'idle';
    const bbRhythm: EspnRhythm =
      bbStatus.live > 0 ? 'live' : bbStatus.upcoming > 0 ? 'upcoming' : 'idle';

    this.espnFbRhythm = fbRhythm;
    this.espnBbRhythm = bbRhythm;

    const fbMinInterval =
      fbRhythm === 'live'
        ? ESPN_LIVE_INTERVAL_MS
        : fbRhythm === 'upcoming'
          ? ESPN_UPCOMING_INTERVAL_MS
          : ESPN_IDLE_INTERVAL_MS;
    const bbMinInterval =
      bbRhythm === 'live'
        ? ESPN_LIVE_INTERVAL_MS
        : bbRhythm === 'upcoming'
          ? ESPN_UPCOMING_INTERVAL_MS
          : ESPN_IDLE_INTERVAL_MS;

    const fbShouldRun =
      !this.espnFbLastFullRun ||
      now - this.espnFbLastFullRun.getTime() >= fbMinInterval;
    const bbShouldRun =
      !this.espnBbLastFullRun ||
      now - this.espnBbLastFullRun.getTime() >= bbMinInterval;

    // If neither sport needs a run, skip entirely
    if (!fbShouldRun && !bbShouldRun) {
      return;
    }

    const fbAllMatches: ESPNFootballMatch[] = [];
    const fbPending: Set<string> = new Set();
    let fbLeagues = 0;
    const fbLeagueStats: Record<string, { success: boolean; matchCount: number; rawEventCount: number; error?: string }> = {};

    if (fbShouldRun) {
      const footballLeagueCodes: string[] = Object.keys(ESPN_FOOTBALL_LEAGUES);
      const fbDateFmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const fbDates: string[] = [];
      for (let offset = -1; offset <= 1; offset += 1) {
        const d = new Date(now + offset * 24 * 3600 * 1000);
        const parts = fbDateFmt.format(d).split('-');
        fbDates.push(parts.join(''));
      }
      const fbSeenSourceIds: Set<string> = new Set();
      for (const leagueCode of footballLeagueCodes) {
        try {
          let leagueRawCount = 0;
          const leagueMatches: ESPNFootballMatch[] = [];
          const leaguePending: Set<string> = new Set();
          for (const dateStr of fbDates) {
            try {
              const result = await this.espnSource.fetchFootballScoreboard(leagueCode, dateStr);
              leagueRawCount += result.matches.length;
              for (const m of result.matches) {
                if (fbSeenSourceIds.has(m.sourceId)) continue;
                fbSeenSourceIds.add(m.sourceId);
                leagueMatches.push(m);
              }
              for (const name of result.pendingMappings) {
                leaguePending.add(name);
              }
            } catch (_e) {
              // skip date without scoreboard data for this league
            }
          }
          fbLeagues += 1;
          let validCount = 0;
          for (const m of leagueMatches) {
            if (this.validateEspnFootballMatch(m)) {
              fbAllMatches.push(m);
              validCount += 1;
            }
          }
          for (const name of leaguePending) {
            fbPending.add(name);
          }
          fbLeagueStats[leagueCode] = { success: true, matchCount: validCount, rawEventCount: leagueRawCount };
        } catch (err) {
           fbLeagueStats[leagueCode] = {
              success: false,
              matchCount: 0,
              rawEventCount: 0,
              error: this.errorMessage(err),
            };
           this.logger.warn(
             `ESPN football scoreboard failed (league=${leagueCode}): ${this.errorMessage(err)}`,
           );
        }
      }
      this.espnFbLastFullRun = new Date();
    } else {
      // Use previous state
      fbLeagues = this.espnFootballLeaguesSynced;
      Object.assign(fbLeagueStats, this.espnFootballLeagueStats);
    }

    const bbAllMatches: ESPNBasketballMatch[] = [];
    const bbPending: Set<string> = new Set();
    let bbLeagues = 0;
    const bbLeagueStats: Record<string, { success: boolean; matchCount: number; rawEventCount: number; error?: string }> = {};

    if (bbShouldRun) {
      const basketballLeagues: string[] = ['wnba', 'nba', 'nbl'];
      const bbExtraLeagues: string[] = ['euroleague', 'acb', 'fiba'];
      // Build US/Eastern date list: yesterday, today, tomorrow (3 days)
      const usEastFmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const now = new Date();
      const usDates: string[] = [];
      for (let offset = -1; offset <= 1; offset += 1) {
        const d = new Date(now.getTime() + offset * 24 * 3600 * 1000);
        // format YYYYMMDD from YYYY-MM-DD
        const parts = usEastFmt.format(d).split('-');
        usDates.push(parts.join(''));
      }
      const bbSeenSourceIds: Set<string> = new Set();
      for (const league of [...basketballLeagues, ...bbExtraLeagues]) {
        let leagueRawEventCount = 0;
        const leagueMatches: ESPNBasketballMatch[] = [];
        const leaguePending: Set<string> = new Set();
        let leagueError: string | null = null;
        let leagueSuccess = true;
        let leagueHasEvents = false;
        for (const dateStr of usDates) {
          try {
            const result = await this.espnSource.fetchBasketballScoreboard(league, dateStr);
            leagueRawEventCount += result.rawEventCount;
            if (result.rawEventCount > 0) leagueHasEvents = true;
            for (const m of result.matches) {
              if (bbSeenSourceIds.has(m.sourceId)) continue;
              bbSeenSourceIds.add(m.sourceId);
              leagueMatches.push(m);
            }
            for (const name of result.pendingMappings) {
              leaguePending.add(name);
            }
          } catch (err) {
            leagueSuccess = false;
            leagueError = this.errorMessage(err);
            this.logger.warn(
              `ESPN basketball scoreboard failed (league=${league}, date=${dateStr}): ${this.errorMessage(err)}`,
            );
            break;
          }
        }
        const isPrimary: boolean = basketballLeagues.includes(league);
        if (!isPrimary && !leagueHasEvents) {
          continue;
        }
        bbLeagues += 1;
        let validCount = 0;
        for (const m of leagueMatches) {
          if (this.validateEspnBasketballMatch(m)) {
            bbAllMatches.push(m);
            validCount += 1;
          }
        }
        for (const name of leaguePending) {
          bbPending.add(name);
        }
        if (leagueSuccess) {
          bbLeagueStats[league] = { success: true, matchCount: validCount, rawEventCount: leagueRawEventCount };
        } else {
          bbLeagueStats[league] = {
            success: false,
            matchCount: 0,
            rawEventCount: 0,
            error: leagueError ?? 'unknown error',
          };
        }
      }
      this.espnBbLastFullRun = new Date();
    } else {
      bbLeagues = this.espnBasketballLeaguesSynced;
      Object.assign(bbLeagueStats, this.espnBasketballLeagueStats);
    }

    // Update state for football
    if (fbShouldRun) {
      this.espnFootballLastSync = new Date();
      this.espnFbTodayCount += 1;
      this.espnFootballSuccess = fbLeagues > 0;
      this.espnFootballLeaguesSynced = fbLeagues;
      this.espnFootballPendingMappings = fbPending;
      this.espnFootballLeagueStats = fbLeagueStats;
    }

    // Update state for basketball
    if (bbShouldRun) {
      this.espnBasketballLastSync = new Date();
      this.espnBbTodayCount += 1;
      this.espnBasketballSuccess = bbLeagues > 0;
      this.espnBasketballLeaguesSynced = bbLeagues;
      this.espnBasketballPendingMappings = bbPending;
      this.espnBasketballLeagueStats = bbLeagueStats;
    }

    // Update DB scores
    if (fbShouldRun) {
      try {
        const fbResult = await this.updateFootballScoresFromEspn(fbAllMatches);
        this.espnFbScoreUpdateResult = fbResult;
        this.lastEspnFootballMatches = fbAllMatches;
        if (fbResult.inserted > 0 || fbResult.updated > 0 || fbResult.skipped > 0 || fbResult.conflictCount > 0) {
          this.logger.log(
            `ESPN football score update: inserted=${fbResult.inserted}, updated=${fbResult.updated}, skipped=${fbResult.skipped}, conflicts=${fbResult.conflictCount}`,
          );
        }
        await this.enrichFootballDeepData(fbAllMatches).catch((err: unknown) => {
          this.logger.warn(`Football deep data enrichment failed: ${this.errorMessage(err)}`);
        });
      } catch (err) {
        this.logger.error(
          `ESPN football score update error: ${this.errorMessage(err)}`,
        );
      }
    }

    if (bbShouldRun) {
      try {
        // NBL official source (primary for Australian NBL, ahead of ESPN/qiumibao)
        let nblOfficialSynced = false;
        try {
          this.logger.log('NBL official sync: starting fetchLiveMatches');
          const nblLive = await this.nblOfficialSource.fetchLiveMatches();
          this.logger.log(`NBL official sync: found ${nblLive.matches.length} live matches`);
          if (nblLive.matches.length > 0) {
            const nblResult = await this.updateBasketballScoresFromNblOfficial(nblLive.matches);
            nblOfficialSynced = nblResult.updated > 0;
            this.logger.log(
              `NBL official live score update: updated=${nblResult.updated}, skipped=${nblResult.skipped}, live=${nblResult.liveMatches.length}`,
            );
          }
        } catch (nblErr) {
          this.logger.warn(
            `NBL official live sync failed (fallback to qiumibao/espn for NBL): ${this.errorMessage(nblErr)}`,
          );
        }

        // If NBL official source synced successfully, filter NBL matches out of
        // ESPN update to avoid overwriting higher-fidelity NBL official scores.
        let espnBbMatches = bbAllMatches;
        if (nblOfficialSynced) {
          espnBbMatches = bbAllMatches.filter(
            (m: ESPNBasketballMatch) => m.leagueCode !== 'nbl',
          );
        }

        const bbResult = await this.updateBasketballScoresFromEspn(espnBbMatches);
        this.espnBbScoreUpdateResult = bbResult;
        if (bbResult.inserted > 0 || bbResult.updated > 0 || bbResult.skipped > 0 || bbResult.conflictCount > 0) {
          this.logger.log(
            `ESPN basketball score update: inserted=${bbResult.inserted}, updated=${bbResult.updated}, skipped=${bbResult.skipped}, conflicts=${bbResult.conflictCount}`,
          );
        }
        this.crossValidateBasketballScores('espn').catch((cvErr: unknown) => {
          this.logger.warn(`Basketball cross-validate (after espn) failed: ${this.errorMessage(cvErr)}`);
        });
        // Deep data enrichment (serial execution to avoid deadlock with sporttery upsert)
        await this.enrichBasketballDeepData(bbAllMatches).catch((err: unknown) => {
          this.logger.warn(`Basketball deep data enrichment failed: ${this.errorMessage(err)}`);
        });
      } catch (err) {
        this.logger.error(
          `ESPN basketball score update error: ${this.errorMessage(err)}`,
        );
      }
    }

    // Also mark score category for backward compat
    this.lastSyncAt.score = new Date();
    this.lastSyncStatus.score = {
      statusCode: this.espnFootballSuccess || this.espnBasketballSuccess ? 200 : 502,
      success: this.espnFootballSuccess || this.espnBasketballSuccess,
      message: `ESPN live sync (adaptive): fbRhythm=${fbRhythm}, bbRhythm=${bbRhythm}`,
    };
  }

  /**
   * Stale-upcoming backstop for ESPN basketball matches.
   *
   * Problem: ESPN scoreboard only sweeps a narrow date window
   * (yesterday/today/tomorrow US Eastern). Matches that finished two or more
   * days ago (e.g. WNBA Finals series games on off-days) can fall out of that
   * window and remain stuck at match_status='upcoming' forever.
   *
   * This pass finds all ESPN-source basketball matches whose kickoff_time is
   * more than 2 hours in the past but are still marked upcoming, then calls
   * the ESPN summary endpoint directly per-event to pull the real status and
   * score. Only 'post' status with a plausible final score is promoted to
   * 'finished'; anything else is left alone.
   *
   * Safe: summary failures are warn-only and never block the overall sync.
   * Capped at 20 matches per run to avoid runaway API calls.
   */
  async fixStaleUpcomingEspnBasketballMatches(): Promise<{
    checked: number;
    fixed: number;
    failed: number;
  }> {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const MAX_FIX = 20;

    const bbReverseMap: Record<string, string> = {};
    for (const [code, name] of Object.entries(ESPN_BASKETBALL_LEAGUES)) {
      bbReverseMap[name] = code;
    }

    const candidates = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        sourceId: basketballMatches.sourceId,
        league: basketballMatches.league,
        sourceLeagueCode: basketballMatches.sourceLeagueCode,
        kickoffTime: basketballMatches.kickoffTime,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        matchStatus: basketballMatches.matchStatus,
        predictionDirection: basketballMatches.predictionDirection,
        handicapLineNum: basketballMatches.handicapLineNum,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        totalLineNum: basketballMatches.totalLineNum,
        totalDirection: basketballMatches.totalDirection,
        frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
        frozenHandicapLine: basketballMatches.frozenHandicapLine,
        frozenHandicapRec: basketballMatches.frozenHandicapRec,
        frozenTotalLine: basketballMatches.frozenTotalLine,
        frozenTotalDirection: basketballMatches.frozenTotalDirection,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'upcoming'),
          isNotNull(basketballMatches.sourceId),
          lt(basketballMatches.kickoffTime, twoHoursAgo),
          or(
            eq(basketballMatches.source, 'espn'),
            isNotNull(basketballMatches.sourceId),
          ),
        ),
      )
      .orderBy(asc(basketballMatches.kickoffTime))
      .limit(MAX_FIX);

    let fixed = 0;
    let failed = 0;

    for (const row of candidates) {
      if (!row.sourceId) continue;

      const leagueCode =
        row.sourceLeagueCode || bbReverseMap[row.league];
      if (!leagueCode) continue;

      try {
        const detail = await this.espnSource.fetchBasketballMatchStatus(
          leagueCode,
          row.sourceId,
        );

        if (!detail) {
          failed += 1;
          this.logger.warn(
            `[stale-upcoming-fix] ESPN summary returned null: ` +
              `match=${row.matchNo} sourceId=${row.sourceId} league=${leagueCode}`,
          );
          continue;
        }

        // Only act on post + plausible final score
        if (detail.status !== 'post') {
          this.logger.log(
            `[stale-upcoming-fix] Still not final: ` +
              `match=${row.matchNo} status=${detail.status} ` +
              `text="${detail.statusText}"`,
          );
          continue;
        }

        const homeScore = detail.homeScore;
        const awayScore = detail.awayScore;
        if (
          homeScore === null ||
          awayScore === null ||
          !Number.isInteger(homeScore) ||
          !Number.isInteger(awayScore)
        ) {
          this.logger.warn(
            `[stale-upcoming-fix] Post but no valid score: ` +
              `match=${row.matchNo} home=${homeScore} away=${awayScore}`,
          );
          continue;
        }

        const totalScore = homeScore + awayScore;
        const scoreDiff = Math.abs(homeScore - awayScore);
        const scorePlausible =
          homeScore >= 20 &&
          awayScore >= 20 &&
          totalScore >= 60 &&
          totalScore <= 300 &&
          scoreDiff <= 80;

        if (!scorePlausible) {
          this.logger.warn(
            `[stale-upcoming-fix] Post score implausible: ` +
              `match=${row.matchNo} ${homeScore}-${awayScore}`,
          );
          continue;
        }

        // Compute hits and update to finished
        const hits = this.computeBasketballHits(
          homeScore,
          awayScore,
          row.predictionDirection ?? (row.frozenPredictionDirection as string | null),
          row.handicapLineNum ?? (row.frozenHandicapLine as string | number | null),
          row.handicapRecommendation ?? (row.frozenHandicapRec as string | null),
          row.totalLineNum ?? (row.frozenTotalLine as string | number | null),
          row.totalDirection ?? (row.frozenTotalDirection as string | null),
        );

        const updateSet: Record<string, unknown> = {
          matchStatus: 'finished',
          homeScore,
          awayScore,
          lastScoreAt: sql`CURRENT_TIMESTAMP`,
          liveScoreSource: 'espn',
        };
        if (hits.hitWdw !== null) updateSet.hitWdw = hits.hitWdw;
        if (hits.hitHandicap !== undefined) updateSet.hitHandicap = hits.hitHandicap;
        if (hits.hitOverunder !== undefined) updateSet.hitOverunder = hits.hitOverunder;

        const updated = await this.db
          .update(basketballMatches)
          .set(updateSet)
          .where(eq(basketballMatches.id, row.id))
          .returning({ id: basketballMatches.id });

        if (updated.length > 0) {
          fixed += 1;
          this.logger.log(
            `[stale-upcoming-fix] Fixed ${row.matchNo}: ` +
              `${row.homeTeam} vs ${row.awayTeam} -> finished ${homeScore}-${awayScore}`,
          );
        }
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `[stale-upcoming-fix] Error for match ${row.matchNo} ` +
            `(sourceId=${row.sourceId}): ${this.errorMessage(err)}`,
        );
      }
    }

    const checked = candidates.length;
    if (checked > 0) {
      this.logger.log(
        `[stale-upcoming-fix] done: checked=${checked} fixed=${fixed} failed=${failed}`,
      );
    }

    return { checked, fixed, failed };
  }

  /**
   * NBL live 场次终场 backstop：NBL 官方 schedule-live 端点只返回进行中比赛，
   * 比赛结束后从 live 列表消失，系统收不到 complete 信号，导致场次卡在 live 状态。
   *
   * 判定规则：NBL 比赛 + match_status='live' + live_score_source='nbl-official'
   *   + 比分 30 分钟以上无变化（last_score_at > 30min ago）
   *   + 总分 >= 150（排除中场休息等假阳性）
   *   + 开赛 > 3 小时（NBL 比赛通常 2-2.5 小时）
   * 则标记为 finished 并计算命中。
   */
  async fixStaleLiveNblBasketballMatches(): Promise<{
    checked: number;
    fixed: number;
  }> {
    const now = new Date();
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const nblLeagues = ['澳NBL', 'NBL', '澳大利亚NBL', '澳大利亚篮球联赛'];

    const candidates = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        lastScoreAt: basketballMatches.lastScoreAt,
        kickoffTime: basketballMatches.kickoffTime,
        livePeriod: basketballMatches.livePeriod,
        predictionDirection: basketballMatches.predictionDirection,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLineNum: basketballMatches.totalLineNum,
        totalDirection: basketballMatches.totalDirection,
        frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
        frozenHandicapLine: basketballMatches.frozenHandicapLine,
        frozenHandicapRec: basketballMatches.frozenHandicapRec,
        frozenTotalLine: basketballMatches.frozenTotalLine,
        frozenTotalDirection: basketballMatches.frozenTotalDirection,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'live'),
          eq(basketballMatches.liveScoreSource, 'nbl-official'),
          lt(basketballMatches.lastScoreAt, thirtyMinAgo),
          lt(basketballMatches.kickoffTime, threeHoursAgo),
          inArray(basketballMatches.league, nblLeagues),
          isNotNull(basketballMatches.homeScore),
          isNotNull(basketballMatches.awayScore),
        ),
      )
      .orderBy(asc(basketballMatches.kickoffTime))
      .limit(10);

    let fixed = 0;
    for (const row of candidates) {
      if (row.homeScore === null || row.awayScore === null) continue;
      const totalScore = row.homeScore + row.awayScore;
      const kickoffMs = row.kickoffTime ? new Date(row.kickoffTime).getTime() : 0;
      const elapsedHours = kickoffMs > 0 ? (now.getTime() - kickoffMs) / (1000 * 60 * 60) : 0;
      const isHalftimeStuck =
        row.livePeriod === 2 && elapsedHours >= 4;
      if (totalScore < 100 && !isHalftimeStuck) continue;

      const hits = this.computeBasketballHits(
        row.homeScore,
        row.awayScore,
        row.predictionDirection ?? row.frozenPredictionDirection,
        row.handicapLineNum ?? row.frozenHandicapLine,
        row.handicapRecommendation ?? row.frozenHandicapRec,
        row.totalLineNum ?? row.frozenTotalLine,
        row.totalDirection ?? row.frozenTotalDirection,
      );

      const updateSet: Record<string, unknown> = {
        matchStatus: 'finished',
        lastScoreAt: sql`CURRENT_TIMESTAMP`,
        liveClock: '终场',
        livePeriod: 4,
        livePeriodEstimated: true,
      };
      if (hits.hitWdw !== null) updateSet.hitWdw = hits.hitWdw;
      if (hits.hitHandicap !== undefined) updateSet.hitHandicap = hits.hitHandicap;
      if (hits.hitOverunder !== undefined) updateSet.hitOverunder = hits.hitOverunder;

      const reason = isHalftimeStuck ? 'halftime-feed-lost' : 'total-score-threshold';
      const updated = await this.db
        .update(basketballMatches)
        .set(updateSet)
        .where(eq(basketballMatches.id, row.id))
        .returning({ id: basketballMatches.id });

      if (updated.length > 0) {
        fixed += 1;
        this.logger.log(
          `[nbl-live-finish-fix] Fixed ${row.matchNo} (${reason}): ` +
            `${row.homeTeam} vs ${row.awayTeam} -> finished ${row.homeScore}-${row.awayScore} (total=${totalScore}, elapsed=${elapsedHours.toFixed(1)}h)`,
        );
      }
    }

    const checked = candidates.length;
    if (checked > 0) {
      this.logger.log(
        `[nbl-live-finish-fix] done: checked=${checked} fixed=${fixed}`,
      );
    }

    return { checked, fixed };
  }

  /**
   * 通用小联赛 live 场次终场 backstop：球美宝/sporttery 源的小联赛比赛，
   * 开赛已久但比分不再更新，导致场次卡在 live 状态。
   *
   * 判定规则：
   *   - match_status='live'
   *   - live_score_source 为 'qiumibao-final-pending' 或 'qiumibao'
   *   - _updated_at < NOW() - 6 小时（卡了很久）
   *   - kickoff_time < NOW() - 4 小时（开赛超过 4 小时，比赛应该打完了）
   *   - home_score 和 away_score 都不为 null
   *   - 总分 >= 60（排除极低比分假阳性，女篮也够用）
   *   - league 不在 NBL 专用列表（NBL 有自己专用的 backstop）
   * 则标记为 finished 并计算命中。
   */
  async fixStaleLiveMinorLeagueBasketballMatches(): Promise<{
    checked: number;
    fixed: number;
  }> {
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const nblLeagues = ['澳NBL', 'NBL', '澳大利亚NBL', '澳大利亚篮球联赛'];

    const candidates = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        lastScoreAt: basketballMatches.lastScoreAt,
        predictionDirection: basketballMatches.predictionDirection,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLineNum: basketballMatches.totalLineNum,
        totalDirection: basketballMatches.totalDirection,
        frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
        frozenHandicapLine: basketballMatches.frozenHandicapLine,
        frozenHandicapRec: basketballMatches.frozenHandicapRec,
        frozenTotalLine: basketballMatches.frozenTotalLine,
        frozenTotalDirection: basketballMatches.frozenTotalDirection,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'live'),
          or(
            eq(basketballMatches.liveScoreSource, 'qiumibao-final-pending'),
            eq(basketballMatches.liveScoreSource, 'qiumibao'),
          ),
          lt(basketballMatches.updatedAt, sixHoursAgo),
          lt(basketballMatches.kickoffTime, fourHoursAgo),
          not(inArray(basketballMatches.league, nblLeagues)),
          isNotNull(basketballMatches.homeScore),
          isNotNull(basketballMatches.awayScore),
        ),
      )
      .orderBy(asc(basketballMatches.kickoffTime))
      .limit(20);

    let fixed = 0;
    for (const row of candidates) {
      if (row.homeScore === null || row.awayScore === null) continue;
      const totalScore = row.homeScore + row.awayScore;
      if (totalScore < 60) continue;

      const hits = this.computeBasketballHits(
        row.homeScore,
        row.awayScore,
        row.predictionDirection ?? row.frozenPredictionDirection,
        row.handicapLineNum ?? row.frozenHandicapLine,
        row.handicapRecommendation ?? row.frozenHandicapRec,
        row.totalLineNum ?? row.frozenTotalLine,
        row.totalDirection ?? row.frozenTotalDirection,
      );

      const updateSet: Record<string, unknown> = {
        matchStatus: 'finished',
        lastScoreAt: sql`CURRENT_TIMESTAMP`,
        liveClock: '终场',
        livePeriod: 4,
        livePeriodEstimated: true,
      };
      if (hits.hitWdw !== null) updateSet.hitWdw = hits.hitWdw;
      if (hits.hitHandicap !== undefined) updateSet.hitHandicap = hits.hitHandicap;
      if (hits.hitOverunder !== undefined) updateSet.hitOverunder = hits.hitOverunder;

      const updated = await this.db
        .update(basketballMatches)
        .set(updateSet)
        .where(eq(basketballMatches.id, row.id))
        .returning({ id: basketballMatches.id });

      if (updated.length > 0) {
        fixed += 1;
        this.logger.log(
          `[minor-league-live-fix] Fixed ${row.matchNo}: ` +
            `${row.homeTeam} vs ${row.awayTeam} (${row.league}) -> finished ${row.homeScore}-${row.awayScore} (total=${totalScore})`,
        );
      }
    }

    const checked = candidates.length;
    if (checked > 0) {
      this.logger.log(
        `[minor-league-live-fix] done: checked=${checked} fixed=${fixed}`,
      );
    }

    return { checked, fixed };
  }

  private validateEspnFootballMatch(m: ESPNFootballMatch): boolean {
    // 1. Score non-negative integer or null
    if (m.homeScore !== null) {
      if (!Number.isInteger(m.homeScore) || m.homeScore < 0) return false;
    }
    if (m.awayScore !== null) {
      if (!Number.isInteger(m.awayScore) || m.awayScore < 0) return false;
    }
    // 2. Status vs score consistency
    if (m.status === 'pre') {
      if (
        (m.homeScore !== null && m.homeScore !== 0) ||
        (m.awayScore !== null && m.awayScore !== 0)
      )
        return false;
    } else if (m.status === 'post') {
      if (m.homeScore === null || m.awayScore === null) return false;
    }
    // 3. Home != away
    if (m.homeTeam === m.awayTeam) return false;
    if (!m.homeTeam || !m.awayTeam) return false;
    return true;
  }

  private computeBasketballHits(
    homeScore: number,
    awayScore: number,
    predictionDirection: string | null,
    handicapLineNum: string | number | null,
    handicapRecommendation: string | null,
    totalLineNum: string | number | null,
    totalDirection: string | null,
  ): { hitWdw: boolean | null; hitHandicap: boolean | null; hitOverunder: boolean | null } {
    let hitWdw: boolean | null = null;
    let hitHandicap: boolean | null = null;
    let hitOverunder: boolean | null = null;

    if (predictionDirection === '主胜') {
      hitWdw = homeScore > awayScore;
    } else if (predictionDirection === '客胜') {
      hitWdw = homeScore < awayScore;
    }

    const hLine = handicapLineNum !== null && handicapLineNum !== '' ? Number(handicapLineNum) : NaN;
    if (!Number.isNaN(hLine) && handicapRecommendation && handicapRecommendation !== '观望') {
      const v = (homeScore - awayScore) + hLine;
      if (v === 0) {
        hitHandicap = null;
      } else if (handicapRecommendation === '让分主胜') {
        hitHandicap = v > 0;
      } else if (handicapRecommendation === '让分客胜') {
        hitHandicap = v < 0;
      }
    }

    const tLine = totalLineNum !== null && totalLineNum !== '' ? Number(totalLineNum) : NaN;
    if (!Number.isNaN(tLine) && totalDirection && totalDirection !== '观望') {
      const total = homeScore + awayScore;
      if (total === tLine) {
        hitOverunder = null;
      } else if (totalDirection === '大分') {
        hitOverunder = total > tLine;
      } else if (totalDirection === '小分') {
        hitOverunder = total < tLine;
      }
    }

    return { hitWdw, hitHandicap, hitOverunder };
  }

  private validateBasketballScoreDirection(params: {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    srcHomeTeam: string;
    srcAwayTeam: string;
    srcHomeScore: number;
    srcAwayScore: number;
    source: 'espn' | 'qiumibao' | 'manual';
    matchId: string;
    matchNo: string;
    prevHomeScore: number | null;
    prevAwayScore: number | null;
    matchStatus: string;
    period?: number | null;
  }): { valid: boolean; reason: string; finalHomeScore: number; finalAwayScore: number } {
    const {
      homeTeam, awayTeam, homeScore, awayScore,
      srcHomeTeam, srcAwayTeam, srcHomeScore, srcAwayScore,
      source, matchId, matchNo,
      prevHomeScore, prevAwayScore,
      matchStatus, period,
    } = params;

    let finalHome = homeScore;
    let finalAway = awayScore;
    let valid = true;
    let reason = '';

    const dbHomeNorm = normalizeTeamName(homeTeam);
    const dbAwayNorm = normalizeTeamName(awayTeam);
    const srcHomeNorm = normalizeTeamName(srcHomeTeam);
    const srcAwayNorm = normalizeTeamName(srcAwayTeam);

    const srcMatchesDirect = srcHomeNorm === dbHomeNorm && srcAwayNorm === dbAwayNorm;
    const srcMatchesReversed = srcHomeNorm === dbAwayNorm && srcAwayNorm === dbHomeNorm;

    if (srcMatchesDirect) {
      finalHome = srcHomeScore;
      finalAway = srcAwayScore;
    } else if (srcMatchesReversed) {
      finalHome = srcAwayScore;
      finalAway = srcHomeScore;
    } else {
      valid = false;
      reason = `方向不一致: source=${source} srcHome=${srcHomeTeam} srcAway=${srcAwayTeam} dbHome=${homeTeam} dbAway=${awayTeam}`;
      finalHome = prevHomeScore ?? homeScore;
      finalAway = prevAwayScore ?? awayScore;
      void matchId;
      void matchNo;
      return { valid, reason, finalHomeScore: finalHome, finalAwayScore: finalAway };
    }

    if (matchStatus === 'live') {
      const total = finalHome + finalAway;
      const diff = Math.abs(finalHome - finalAway);
      const plausible = finalHome >= 0 && finalAway >= 0 && total <= 300 && diff <= 80;
      if (!plausible) {
        valid = false;
        reason = `比分不合理(live): home=${finalHome} away=${finalAway} total=${total} diff=${diff}`;
        finalHome = prevHomeScore ?? finalHome;
        finalAway = prevAwayScore ?? finalAway;
        return { valid, reason, finalHomeScore: finalHome, finalAwayScore: finalAway };
      }
    } else if (matchStatus === 'finished') {
      const total = finalHome + finalAway;
      const diff = Math.abs(finalHome - finalAway);
      const plausible = finalHome >= 20 && finalAway >= 20 && total >= 60 && total <= 300 && diff <= 80;
      if (!plausible) {
        valid = false;
        reason = `比分不合理(finished): home=${finalHome} away=${finalAway} total=${total} diff=${diff}`;
        finalHome = prevHomeScore ?? finalHome;
        finalAway = prevAwayScore ?? finalAway;
        return { valid, reason, finalHomeScore: finalHome, finalAwayScore: finalAway };
      }
    }

    if (prevHomeScore !== null && prevAwayScore !== null && (matchStatus === 'live' || matchStatus === 'finished')) {
      const prevDiff = prevHomeScore - prevAwayScore;
      const currDiff = finalHome - finalAway;
      const isOvertime = (period ?? 0) > 4;
      if (prevDiff * currDiff < 0 && Math.abs(Math.abs(currDiff) - Math.abs(prevDiff)) > 30 && !isOvertime) {
        valid = false;
        reason = `分差方向突变: prev=${prevHomeScore}-${prevAwayScore}(diff=${prevDiff}) curr=${finalHome}-${finalAway}(diff=${currDiff})`;
        finalHome = prevHomeScore;
        finalAway = prevAwayScore;
        return { valid, reason, finalHomeScore: finalHome, finalAwayScore: finalAway };
      }
    }

    return { valid, reason, finalHomeScore: finalHome, finalAwayScore: finalAway };
  }

  private async logScoreSentinelEvent(params: {
    matchId: string;
    matchNo: string;
    source: string;
    errorType: 'direction_mismatch' | 'score_unreasonable' | 'swing_detected';
    prevHomeScore: number | null;
    prevAwayScore: number | null;
    wrongHomeScore: number;
    wrongAwayScore: number;
    correctHomeScore: number;
    correctAwayScore: number;
    reason: string;
  }): Promise<void> {
    const {
      matchId, matchNo, source, errorType,
      prevHomeScore, prevAwayScore,
      wrongHomeScore, wrongAwayScore,
      correctHomeScore, correctAwayScore,
      reason,
    } = params;
    try {
      await this.db.execute(sql`
        INSERT INTO score_sentinel_logs (match_id, match_no, source, error_type, prev_home_score, prev_away_score, wrong_home_score, wrong_away_score, correct_home_score, correct_away_score, reason)
        VALUES (${matchId}::uuid, ${matchNo}, ${source}, ${errorType}, ${prevHomeScore ?? null}, ${prevAwayScore ?? null}, ${wrongHomeScore}, ${wrongAwayScore}, ${correctHomeScore}, ${correctAwayScore}, ${reason})
      `);
    } catch (logErr) {
      this.logger.warn(`[SCORE-SENTINEL] log insert failed: ${this.errorMessage(logErr)}`);
    }
  }

  private async crossValidateBasketballScores(source: 'espn' | 'qiumibao'): Promise<{ mismatches: number; checked: number }> {
    const espn = this.espnBbScoreUpdateResult;
    const qmb = this.qiumibaoBbScoreUpdateResult;
    if (!espn || !qmb) return { mismatches: 0, checked: 0 };

    const espnMap = new Map<string, { homeScore: number | null; awayScore: number | null; status: string }>();
    const espnMatches = [...espn.liveMatches, ...espn.finishedUpdates];
    for (const m of espnMatches) {
      const isFinished = espn.finishedUpdates.some((f: { matchNo: string }) => f.matchNo === m.matchNo);
      espnMap.set(m.matchNo, {
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        status: isFinished ? 'finished' : 'live',
      });
    }

    const qmbMap = new Map<string, { homeScore: number | null; awayScore: number | null; status: string }>();
    const qmbMatches = [...qmb.liveMatches, ...qmb.finishedUpdates];
    for (const m of qmbMatches) {
      const isFinished = qmb.finishedUpdates.some((f: { matchNo: string }) => f.matchNo === m.matchNo);
      qmbMap.set(m.matchNo, {
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        status: isFinished ? 'finished' : 'live',
      });
    }

    let mismatches = 0;
    let checked = 0;
    const primaryMap = source === 'espn' ? espnMap : qmbMap;
    const otherMap = source === 'espn' ? qmbMap : espnMap;

    for (const [matchNo, primary] of primaryMap) {
      const other = otherMap.get(matchNo);
      if (!other) continue;
      if (primary.homeScore === null || primary.awayScore === null) continue;
      if (other.homeScore === null || other.awayScore === null) continue;
      checked += 1;
      const homeDiff = Math.abs(primary.homeScore - other.homeScore);
      const awayDiff = Math.abs(primary.awayScore - other.awayScore);
      const statusDiff = primary.status !== other.status;
      if (homeDiff >= 2 || awayDiff >= 2 || statusDiff) {
        mismatches += 1;
        const espnScore = `${espnMap.get(matchNo)?.homeScore ?? '?'}-${espnMap.get(matchNo)?.awayScore ?? '?'}`;
        const qmbScore = `${qmbMap.get(matchNo)?.homeScore ?? '?'}-${qmbMap.get(matchNo)?.awayScore ?? '?'}`;
        this.logger.warn(`[CROSS-VALIDATE] mismatch for ${matchNo}: espn=${espnScore} vs qiumibao=${qmbScore}`);
        try {
          const existing = await this.db
            .select({
              id: basketballMatches.id,
              liveScoreSource: basketballMatches.liveScoreSource,
              resultPendingReason: basketballMatches.resultPendingReason,
            })
            .from(basketballMatches)
            .where(eq(basketballMatches.matchNo, matchNo))
            .limit(1);
          if (existing.length > 0 && existing[0].liveScoreSource !== 'espn') {
            const currentSource = existing[0].liveScoreSource || '';
            const newSource = currentSource.includes('espn-primary-qmb-mismatch')
              ? currentSource
              : `${currentSource ? currentSource + '+' : ''}espn-primary-qmb-mismatch`;
            const currentReason = existing[0].resultPendingReason || '';
            const newReason = currentReason.includes('多源比分不一致')
              ? currentReason
              : currentReason
                ? `${currentReason}; 多源比分不一致，以ESPN为准`
                : '多源比分不一致，以ESPN为准';
            await this.db
              .update(basketballMatches)
              .set({
                liveScoreSource: newSource.slice(0, 30),
                resultPendingReason: newReason.slice(0, 255),
                updatedAt: sql`CURRENT_TIMESTAMP`,
              })
              .where(eq(basketballMatches.id, existing[0].id));
          }
        } catch (cvErr) {
          this.logger.warn(`[CROSS-VALIDATE] update failed for ${matchNo}: ${this.errorMessage(cvErr)}`);
        }
      }
    }
    return { mismatches, checked };
  }

  private estimateBasketballPeriod(
    kickoffDate: Date,
    totalScore: number = 0,
  ): { period: number; clock: string; isEstimated: boolean } {
    const elapsedMs = Date.now() - kickoffDate.getTime();
    const elapsedMin = elapsedMs / 60000;
    const quarterMin = 10;
    const breakShort = 2;
    const breakLong = 15;
    const q1End = quarterMin;
    const q2End = q1End + breakShort + quarterMin;
    const q3End = q2End + breakLong + quarterMin;
    const q4End = q3End + breakShort + quarterMin;
    let period = 0;
    let remainingInQ = 0;
    if (elapsedMin < q1End) {
      period = 1;
      remainingInQ = q1End - elapsedMin;
    } else if (elapsedMin < q2End) {
      period = 2;
      remainingInQ = q2End - breakShort - elapsedMin;
      if (remainingInQ > quarterMin) remainingInQ = quarterMin;
      if (remainingInQ < 0) remainingInQ = 0;
    } else if (elapsedMin < q3End) {
      period = 3;
      remainingInQ = q3End - breakLong - (q2End - breakShort) - (elapsedMin - q2End);
      const q3Start = q2End + breakLong;
      remainingInQ = quarterMin - (elapsedMin - q3Start);
      if (remainingInQ > quarterMin) remainingInQ = quarterMin;
      if (remainingInQ < 0) remainingInQ = 0;
    } else if (elapsedMin < q4End) {
      period = 4;
      const q4Start = q3End + breakShort;
      remainingInQ = quarterMin - (elapsedMin - q4Start);
      if (remainingInQ > quarterMin) remainingInQ = quarterMin;
      if (remainingInQ < 0) remainingInQ = 0;
    } else {
      period = 4;
      remainingInQ = 0;
    }
    const mins = Math.floor(Math.max(0, remainingInQ));
    const secs = Math.floor((Math.max(0, remainingInQ) - mins) * 60);
    const clock = `${mins}:${secs.toString().padStart(2, '0')}`;
    return { period, clock, isEstimated: true };
  }

  private validateEspnBasketballMatch(m: ESPNBasketballMatch): boolean {
    if (m.homeScore !== null) {
      if (!Number.isInteger(m.homeScore) || m.homeScore < 0) return false;
    }
    if (m.awayScore !== null) {
      if (!Number.isInteger(m.awayScore) || m.awayScore < 0) return false;
    }
    if (m.status === 'pre') {
      if (
        (m.homeScore !== null && m.homeScore !== 0) ||
        (m.awayScore !== null && m.awayScore !== 0)
      )
        return false;
    } else if (m.status === 'post') {
      if (m.homeScore === null || m.awayScore === null) return false;
      if (!Number.isInteger(m.homeScore) || !Number.isInteger(m.awayScore)) return false;
      if (m.homeScore < 20 || m.awayScore < 20) return false;
      const total: number = m.homeScore + m.awayScore;
      if (total < 60) return false;
      if (total > 300) return false;
      const diff: number = Math.abs(m.homeScore - m.awayScore);
      if (diff > 80) return false;
    }
    if (m.homeTeam === m.awayTeam) return false;
    if (!m.homeTeam || !m.awayTeam) return false;
    return true;
  }

  private async updateFootballScoresFromEspn(
    espnMatches: ESPNFootballMatch[],
  ): Promise<{
    inserted: number;
    updated: number;
    skipped: number;
    conflictCount: number;
    finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }>;
    liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }>;
    upcomingMatches: number;
    unmappedTeams: string[];
  }> {
    if (espnMatches.length === 0)
      return {
        inserted: 0, updated: 0, skipped: 0, conflictCount: 0,
        finishedUpdates: [], liveMatches: [], upcomingMatches: 0, unmappedTeams: [],
      };

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let conflictCount = 0;
    const finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }> = [];
    const liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }> = [];
    let upcomingMatches = 0;
    const unmappedTeams: Set<string> = new Set();

    await this.db.transaction(async (tx) => {
      for (const m of espnMatches) {
        const kickoffDate: Date = new Date(m.kickoffTime);
        if (Number.isNaN(kickoffDate.getTime())) {
          skipped += 1;
          continue;
        }
        const beijingDateStr: string = getBeijingDateStr(kickoffDate);
        const homeNorm: string = normalizeTeamName(m.homeTeam);
        const awayNorm: string = normalizeTeamName(m.awayTeam);

        let mappedStatus: string =
          m.status === 'pre'
            ? 'upcoming'
            : m.status === 'in'
              ? 'live'
              : 'finished';

        // 1. source_id 精确匹配（最高优先级，有source_id的场次直接命中，跳过队名/联赛校验）
        if (m.sourceId) {
          const sourceIdMatch = await tx
            .select({
              id: matches.id,
              matchStatus: matches.matchStatus,
              homeTeam: matches.homeTeam,
              awayTeam: matches.awayTeam,
              kickoffTime: matches.kickoffTime,
              source: matches.source,
              oddsOpenHome: matches.oddsOpenHome,
              oddsOpenDraw: matches.oddsOpenDraw,
              oddsOpenAway: matches.oddsOpenAway,
              handicap: matches.handicap,
              overUnder: matches.overUnder,
              modelRules: matches.modelRules,
              predictionDirection: matches.predictionDirection,
              handicapRecommendation: matches.handicapRecommendation,
              totalPick: matches.totalPick,
            })
            .from(matches)
            .where(eq(matches.sourceId, m.sourceId));

          if (sourceIdMatch.length > 0) {
            let hitCount = 0;
            for (const row of sourceIdMatch) {
              // 状态保护：finished不回退、canceled跳过
              if (row.matchStatus === 'finished' && mappedStatus !== 'finished') {
                this.logger.warn(`Football status rollback skipped (sourceId): match=${row.id} db=finished espn=${mappedStatus}`);
                skipped += 1;
                continue;
              }
              if (row.matchStatus === 'canceled') {
                skipped += 1;
                continue;
              }
              const wasFinished = row.matchStatus === 'finished';
              const updateObj: Record<string, unknown> = {
                matchStatus: mappedStatus,
                kickoffTime: kickoffDate,
                sourceLeagueCode: m.leagueCode,
                lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
                liveScoreSource: 'espn',
                updatedAt: sql`CURRENT_TIMESTAMP`,
              };
              if (mappedStatus === 'upcoming') {
                updateObj.lastScoreAt = null;
                updateObj.homeScore = null;
                updateObj.awayScore = null;
                updateObj.livePeriod = null;
                updateObj.liveClock = null;
              } else if (mappedStatus === 'live') {
                updateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
                updateObj.homeScore = m.homeScore;
                updateObj.awayScore = m.awayScore;
                updateObj.livePeriod = m.period ?? null;
                updateObj.liveClock = m.displayClock ?? null;
              } else {
                if (!wasFinished) {
                  updateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
                }
                updateObj.homeScore = m.homeScore;
                updateObj.awayScore = m.awayScore;
                updateObj.livePeriod = m.period ?? null;
                updateObj.liveClock = m.displayClock ?? null;
              }
              if (mappedStatus === 'finished' && m.homeScore !== null && m.awayScore !== null) {
                const homeScore: number = m.homeScore;
                const awayScore: number = m.awayScore;
                if (row.predictionDirection === '主胜') {
                  updateObj.hitWdw = homeScore > awayScore;
                } else if (row.predictionDirection === '客胜') {
                  updateObj.hitWdw = homeScore < awayScore;
                } else if (row.predictionDirection === '平') {
                  updateObj.hitWdw = homeScore === awayScore;
                }
                const hLine: number = Number(row.handicap);
                if (!Number.isNaN(hLine) && row.handicapRecommendation) {
                  const v: number = (homeScore - awayScore) + hLine;
                  if (row.handicapRecommendation === '让平') {
                    updateObj.hitHandicap = v === 0;
                  } else if (v === 0) {
                    updateObj.hitHandicap = null;
                  } else if (row.handicapRecommendation === '让球主胜' || row.handicapRecommendation === '让胜') {
                    updateObj.hitHandicap = v > 0;
                  } else if (row.handicapRecommendation === '让球主负' || row.handicapRecommendation === '让负') {
                    updateObj.hitHandicap = v < 0;
                  }
                }
                const tLine: number = Number(row.overUnder);
                if (!Number.isNaN(tLine) && row.totalPick) {
                  const total: number = homeScore + awayScore;
                  if (total === tLine) {
                    updateObj.hitOverunder = null;
                  } else if (row.totalPick === '大球' || row.totalPick === '大') {
                    updateObj.hitOverunder = total > tLine;
                  } else if (row.totalPick === '小球' || row.totalPick === '小') {
                    updateObj.hitOverunder = total < tLine;
                  }
                }
              }
              await tx.update(matches).set(updateObj).where(eq(matches.id, row.id));
              if (mappedStatus === 'finished' && m.homeScore !== null && m.awayScore !== null) {
                finishedUpdates.push({ matchNo: row.id, homeScore: m.homeScore, awayScore: m.awayScore, league: m.league });
              } else if (mappedStatus === 'live') {
                liveMatches.push({ matchNo: row.id, homeScore: m.homeScore, awayScore: m.awayScore, league: m.league });
              } else if (mappedStatus === 'upcoming') {
                upcomingMatches += 1;
              }
              if (!wasFinished && mappedStatus === 'finished' && m.sourceId && m.leagueCode) {
                void this.fetchFootballMatchStatsAsync(row.id, m.sourceId, m.leagueCode);
              }
              hitCount += 1;
            }
            if (hitCount > 0) {
              updated += hitCount;
              continue;
            }
          }
        }

        if (
          !isFootballTeamMapped(m.homeTeamEn) ||
          !isFootballTeamMapped(m.awayTeamEn)
        ) {
          skipped += 1;
          if (!isFootballTeamMapped(m.homeTeamEn)) unmappedTeams.add(m.homeTeamEn);
          if (!isFootballTeamMapped(m.awayTeamEn)) unmappedTeams.add(m.awayTeamEn);
          continue;
        }

        const sameDayLeague = await tx
          .select({
            id: matches.id,
            matchStatus: matches.matchStatus,
            homeTeam: matches.homeTeam,
            awayTeam: matches.awayTeam,
            kickoffTime: matches.kickoffTime,
            source: matches.source,
            oddsOpenHome: matches.oddsOpenHome,
            oddsOpenDraw: matches.oddsOpenDraw,
            oddsOpenAway: matches.oddsOpenAway,
            handicap: matches.handicap,
            overUnder: matches.overUnder,
            modelRules: matches.modelRules,
            isOfficialLocked: matches.isOfficialLocked,
            predictionDirection: matches.predictionDirection,
            handicapRecommendation: matches.handicapRecommendation,
            totalPick: matches.totalPick,
          })
          .from(matches)
          .where(
            and(
              gte(matches.matchDate, sql`${beijingDateStr}::date - interval '1 day'`),
              lt(matches.matchDate, sql`${beijingDateStr}::date + interval '2 days'`),
              eq(matches.league, m.league),
            ),
          );

        const exactMatches: Array<{ id: string; matchStatus: string; oddsOpenHome: string | null; oddsOpenDraw: string | null; oddsOpenAway: string | null; handicap: string; overUnder: string; modelRules: string[] | null; isOfficialLocked: boolean; predictionDirection: string | null; handicapRecommendation: string | null; totalPick: string | null }> = [];
        const reverseMatches: Array<{ id: string; matchStatus: string }> = [];

        for (const row of sameDayLeague) {
          const rowHomeNorm: string = normalizeTeamName(row.homeTeam);
          const rowAwayNorm: string = normalizeTeamName(row.awayTeam);
          const rowKickoffMs: number = new Date(row.kickoffTime).getTime();
          if (Math.abs(rowKickoffMs - kickoffDate.getTime()) > 36 * 3600 * 1000) continue;
          if (rowHomeNorm === homeNorm && rowAwayNorm === awayNorm) {
            exactMatches.push({
              id: row.id,
              matchStatus: row.matchStatus,
              oddsOpenHome: (row.oddsOpenHome as string | null) ?? null,
              oddsOpenDraw: (row.oddsOpenDraw as string | null) ?? null,
              oddsOpenAway: (row.oddsOpenAway as string | null) ?? null,
              handicap: row.handicap ?? '',
              overUnder: row.overUnder ?? '',
              modelRules: (row.modelRules as string[] | null) ?? null,
              isOfficialLocked: Boolean(row.isOfficialLocked),
              predictionDirection: (row.predictionDirection as string | null) ?? null,
              handicapRecommendation: (row.handicapRecommendation as string | null) ?? null,
              totalPick: (row.totalPick as string | null) ?? null,
            });
          }
          if (rowHomeNorm === awayNorm && rowAwayNorm === homeNorm) {
            reverseMatches.push({ id: row.id, matchStatus: row.matchStatus });
          }
        }

        if (exactMatches.length > 0) {
          for (const exactMatch of exactMatches) {
            if (exactMatch.matchStatus === 'finished' && mappedStatus !== 'finished') {
              this.logger.warn(
                `Football status rollback skipped: match=${exactMatch.id} db=finished espn=${mappedStatus}`,
              );
              skipped += 1;
              continue;
            }
            if (exactMatch.matchStatus === 'canceled') {
              skipped += 1;
              continue;
            }
            const wasFinishedFb = exactMatch.matchStatus === 'finished';
          const fbUpdateExact: Record<string, unknown> = {
            matchStatus: mappedStatus,
            kickoffTime: kickoffDate,
            sourceId: m.sourceId,
            sourceLeagueCode: m.leagueCode,
            lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
            liveScoreSource: 'espn',
            updatedAt: sql`CURRENT_TIMESTAMP`,
          };
          if (mappedStatus === 'upcoming') {
             fbUpdateExact.lastScoreAt = null;
             fbUpdateExact.homeScore = null;
             fbUpdateExact.awayScore = null;
             fbUpdateExact.livePeriod = null;
             fbUpdateExact.liveClock = null;
           } else if (mappedStatus === 'live') {
             fbUpdateExact.lastScoreAt = sql`CURRENT_TIMESTAMP`;
             fbUpdateExact.homeScore = m.homeScore;
             fbUpdateExact.awayScore = m.awayScore;
             fbUpdateExact.livePeriod = m.period ?? null;
             fbUpdateExact.liveClock = m.displayClock ?? null;
            } else {
              if (!wasFinishedFb) {
                fbUpdateExact.lastScoreAt = sql`CURRENT_TIMESTAMP`;
              }
              fbUpdateExact.homeScore = m.homeScore;
              fbUpdateExact.awayScore = m.awayScore;
              fbUpdateExact.livePeriod = m.period ?? null;
              fbUpdateExact.liveClock = m.displayClock ?? null;
            }

            const espnHasOdds =
              m.oddsHomeWin != null && m.oddsHomeWin > 0 &&
              m.oddsDraw != null && m.oddsDraw > 0 &&
              m.oddsAwayWin != null && m.oddsAwayWin > 0;
            const targetOddsEmpty =
              !exactMatch.oddsOpenHome || Number(exactMatch.oddsOpenHome) === 0;

             const isOfficialLocked = Boolean(exactMatch.isOfficialLocked) ||
               (Array.isArray(exactMatch.modelRules)
                 && exactMatch.modelRules.some((r: string) => r.includes('官方数据锁定')));

            if (espnHasOdds && targetOddsEmpty && !isOfficialLocked) {
              fbUpdateExact.oddsOpenHome = m.oddsHomeWin;
              fbUpdateExact.oddsOpenDraw = m.oddsDraw;
              fbUpdateExact.oddsOpenAway = m.oddsAwayWin;
              if (m.handicapLine != null) {
                fbUpdateExact.handicap = String(m.handicapLine);
                fbUpdateExact.handicapOddsHome = m.handicapHomeOdds ?? null;
                fbUpdateExact.handicapOddsAway = m.handicapAwayOdds ?? null;
              }
              if (m.totalLine != null && m.totalLine > 0) {
                fbUpdateExact.overUnder = String(m.totalLine);
                fbUpdateExact.totalOddsOver = m.totalOverOdds ?? null;
                fbUpdateExact.totalOddsUnder = m.totalUnderOdds ?? null;
              }
              fbUpdateExact.lastOddsUpdateAt = sql`CURRENT_TIMESTAMP`;
              fbUpdateExact.sourceLeagueCode = m.leagueCode;

              const prediction = this.generateFootballPrediction(
                m.oddsHomeWin,
                m.oddsDraw,
                m.oddsAwayWin,
                m.handicapLine != null ? String(m.handicapLine) : '',
                m.totalLine != null ? String(m.totalLine) : '',
                m.league,
              );
              if (prediction) {
                fbUpdateExact.homeWinProb = prediction.homeWinProb;
                fbUpdateExact.drawProb = prediction.drawProb;
                fbUpdateExact.awayWinProb = prediction.awayWinProb;
                fbUpdateExact.confidence = prediction.confidence;
                fbUpdateExact.lowConfidence = prediction.lowConfidence;
                fbUpdateExact.modelRules = prediction.modelRules;
                fbUpdateExact.mostLikelyScore = prediction.mostLikelyScore;
                // P0-1 赛中方向锁定：live/in-play/finished 场保留赛前方向
                const isLiveOrFinishedFb = exactMatch.matchStatus === 'live'
                  || exactMatch.matchStatus === 'in-play'
                  || exactMatch.matchStatus === 'finished'
                  || mappedStatus === 'live'
                  || mappedStatus === 'finished';
                const hasPreMatchDir = this.isNonEmptyStr(exactMatch.predictionDirection)
                  && exactMatch.predictionDirection !== '观望';
                const hasPreMatchHc = this.isNonEmptyStr(exactMatch.handicapRecommendation)
                  && exactMatch.handicapRecommendation !== '观望';
                const hasPreMatchTotal = this.isNonEmptyStr(exactMatch.totalPick)
                  && exactMatch.totalPick !== '观望';
                if (isLiveOrFinishedFb && hasPreMatchDir) {
                  // 锁定赛前胜平负方向
                } else {
                  fbUpdateExact.predictionDirection = prediction.predictionDirection;
                }
                if (isLiveOrFinishedFb && hasPreMatchHc) {
                  // 锁定赛前让球方向
                } else {
                  fbUpdateExact.handicapRecommendation = prediction.handicapRecommendation;
                }
                if (isLiveOrFinishedFb && hasPreMatchTotal) {
                  // 锁定赛前大小球方向
                } else {
                  fbUpdateExact.totalPick = prediction.totalPick;
                }
                // P2-8 模型版本号真实化
                fbUpdateExact.predEngineVersion = FOOTBALL_MODEL_VERSION;
              }
            }

           await tx
              .update(matches)
              .set(fbUpdateExact)
              .where(eq(matches.id, exactMatch.id));
           if (mappedStatus === 'finished' && m.homeScore !== null && m.awayScore !== null) {
             finishedUpdates.push({ matchNo: exactMatch.id, homeScore: m.homeScore, awayScore: m.awayScore, league: m.league });
           } else if (mappedStatus === 'live') {
             liveMatches.push({ matchNo: exactMatch.id, homeScore: m.homeScore, awayScore: m.awayScore, league: m.league });
           } else if (mappedStatus === 'upcoming') {
             upcomingMatches += 1;
           }
           if (!wasFinishedFb && mappedStatus === 'finished' && m.sourceId && m.leagueCode) {
             void this.fetchFootballMatchStatsAsync(exactMatch.id, m.sourceId, m.leagueCode);
           }
           updated += 1;
          }
          continue;
        }

         if (reverseMatches.length > 0) {
          conflictCount += reverseMatches.length;
          for (const reverseMatch of reverseMatches) {
            this.logger.warn(
              `Football home/away conflict: ESPN ${m.homeTeam} vs ${m.awayTeam} vs DB ${reverseMatch.id}`,
            );
          }
          skipped += reverseMatches.length;
          continue;
        }

        const sameDayAll = await tx
          .select({
            id: matches.id,
            matchStatus: matches.matchStatus,
            homeTeam: matches.homeTeam,
            awayTeam: matches.awayTeam,
            kickoffTime: matches.kickoffTime,
            source: matches.source,
          })
          .from(matches)
          .where(
            and(
              gte(matches.matchDate, sql`${beijingDateStr}::date - interval '1 day'`),
              lt(matches.matchDate, sql`${beijingDateStr}::date + interval '2 days'`),
            ),
          );

        const crossSourceMatch = findSameMatchByTeams(
          sameDayAll,
          m.homeTeam,
          m.awayTeam,
          kickoffDate,
          12,
        );

        if (crossSourceMatch) {
          if (crossSourceMatch.matchStatus === 'finished' && mappedStatus !== 'finished') {
            this.logger.warn(
              `Football status rollback skipped (cross-source): match=${crossSourceMatch.id} db=finished espn=${mappedStatus}`,
            );
            skipped += 1;
            continue;
          }
          if (crossSourceMatch.matchStatus === 'canceled') {
            skipped += 1;
            continue;
          }
          const fbCrossWasFinished = crossSourceMatch.matchStatus === 'finished';
          const fbUpdateCross: Record<string, unknown> = {
            matchStatus: mappedStatus,
            kickoffTime: kickoffDate,
            sourceId: m.sourceId,
            sourceLeagueCode: m.leagueCode,
            lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
            liveScoreSource: 'espn',
            updatedAt: sql`CURRENT_TIMESTAMP`,
          };
          if (mappedStatus === 'upcoming') {
             fbUpdateCross.lastScoreAt = null;
             fbUpdateCross.homeScore = null;
             fbUpdateCross.awayScore = null;
             fbUpdateCross.livePeriod = null;
             fbUpdateCross.liveClock = null;
           } else if (mappedStatus === 'live') {
             fbUpdateCross.lastScoreAt = sql`CURRENT_TIMESTAMP`;
             fbUpdateCross.homeScore = m.homeScore;
             fbUpdateCross.awayScore = m.awayScore;
             fbUpdateCross.livePeriod = m.period ?? null;
             fbUpdateCross.liveClock = m.displayClock ?? null;
           } else {
             if (!fbCrossWasFinished) {
               fbUpdateCross.lastScoreAt = sql`CURRENT_TIMESTAMP`;
             }
             fbUpdateCross.homeScore = m.homeScore;
             fbUpdateCross.awayScore = m.awayScore;
             fbUpdateCross.livePeriod = m.period ?? null;
             fbUpdateCross.liveClock = m.displayClock ?? null;
           }
          await tx
            .update(matches)
            .set(fbUpdateCross)
            .where(eq(matches.id, crossSourceMatch.id));
          if (mappedStatus === 'finished' && m.homeScore !== null && m.awayScore !== null) {
            finishedUpdates.push({ matchNo: crossSourceMatch.id, homeScore: m.homeScore, awayScore: m.awayScore, league: m.league });
          } else if (mappedStatus === 'live') {
            liveMatches.push({ matchNo: crossSourceMatch.id, homeScore: m.homeScore, awayScore: m.awayScore, league: m.league });
          } else if (mappedStatus === 'upcoming') {
            upcomingMatches += 1;
          }
          if (!fbCrossWasFinished && mappedStatus === 'finished' && m.sourceId && m.leagueCode) {
            void this.fetchFootballMatchStatsAsync(crossSourceMatch.id, m.sourceId, m.leagueCode);
          }
          updated += 1;
          continue;
        }

        skipped += 1;
      }
    });

    return {
      inserted, updated, skipped, conflictCount,
      finishedUpdates, liveMatches, upcomingMatches,
      unmappedTeams: Array.from(unmappedTeams),
    };
  }

  private async fetchFootballMatchStatsAsync(
    matchId: string, sourceId: string, leagueCode: string,
  ): Promise<void> {
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 10 * 1000));
      const summary = await this.espnSource.fetchFootballEventSummary(leagueCode, sourceId);
      if (summary.matchStats.home && summary.matchStats.away) {
        const existing = await this.db.select({ advancedStats: matches.advancedStats })
          .from(matches).where(eq(matches.id, matchId));
        const existingAdvancedStats = (existing[0]?.advancedStats as Record<string, unknown> | undefined) || {};
        await this.db.update(matches).set({
          advancedStats: {
            ...existingAdvancedStats,
            dataSource: 'espn_summary',
            quality: 'high',
            shotsHome: summary.matchStats.home.totalShots,
            shotsAway: summary.matchStats.away.totalShots,
            shotsOnTargetHome: summary.matchStats.home.shotsOnTarget,
            shotsOnTargetAway: summary.matchStats.away.shotsOnTarget,
            cornersHome: summary.matchStats.home.wonCorners,
            cornersAway: summary.matchStats.away.wonCorners,
            possessionHome: summary.matchStats.home.possessionPct,
            possessionAway: summary.matchStats.away.possessionPct,
            foulsHome: summary.matchStats.home.foulsCommitted,
            foulsAway: summary.matchStats.away.foulsCommitted,
            passAccuracyHome: summary.matchStats.home.passPct,
            passAccuracyAway: summary.matchStats.away.passPct,
          },
          updatedAt: sql`CURRENT_TIMESTAMP`,
        }).where(eq(matches.id, matchId));
        this.logger.log(`Match stats backfilled for ${matchId} (${leagueCode}/${sourceId})`);
      }
    } catch (err) {
      this.logger.warn(`Failed to backfill match stats for ${matchId}: ${this.errorMessage(err)}`);
    }
  }

  private async updateBasketballScoresFromNblOfficial(
    nblMatches: Array<{
      id: string;
      homeTeamName: string;
      awayTeamName: string;
      homeTeamCode: string;
      awayTeamCode: string;
      homeScore: number | null;
      awayScore: number | null;
      phase: 'upcoming' | 'live' | 'complete';
      displayClock: string;
      currentPeriod: number | null;
      clock: string | null;
      startsAtMs: number;
    }>,
  ): Promise<{
    updated: number;
    skipped: number;
    liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }>;
    finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }>;
  }> {
    if (nblMatches.length === 0) {
      return { updated: 0, skipped: 0, liveMatches: [], finishedUpdates: [] };
    }

    let updated = 0;
    let skipped = 0;
    const liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }> = [];
    const finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }> = [];

    const nblLeagueNames = ['澳NBL', 'NBL', '澳大利亚NBL', '澳大利亚篮球联赛'];

    await this.db.transaction(async (tx) => {
      for (const m of nblMatches) {
        if (m.startsAtMs <= 0) {
          skipped += 1;
          continue;
        }
        const matchDate: Date = new Date(m.startsAtMs);
        const beijingDateStr: string = getBeijingDateStr(matchDate);
        const homeNorm: string = this.normalizeNblTeamName(m.homeTeamName, m.homeTeamCode);
        const awayNorm: string = this.normalizeNblTeamName(m.awayTeamName, m.awayTeamCode);

        const candidates = await tx
          .select({
            id: basketballMatches.id,
            matchNo: basketballMatches.matchNo,
            matchStatus: basketballMatches.matchStatus,
            league: basketballMatches.league,
            homeTeam: basketballMatches.homeTeam,
            awayTeam: basketballMatches.awayTeam,
            homeScore: basketballMatches.homeScore,
            awayScore: basketballMatches.awayScore,
            liveScoreSource: basketballMatches.liveScoreSource,
            lastScoreAt: basketballMatches.lastScoreAt,
            livePeriod: basketballMatches.livePeriod,
            liveClock: basketballMatches.liveClock,
            predictionDirection: basketballMatches.predictionDirection,
            handicapRecommendation: basketballMatches.handicapRecommendation,
            handicapLineNum: basketballMatches.handicapLineNum,
            totalDirection: basketballMatches.totalDirection,
            totalLineNum: basketballMatches.totalLineNum,
            confidence: basketballMatches.confidence,
            predEngineVersion: basketballMatches.predEngineVersion,
            isPredictionFrozen: basketballMatches.isPredictionFrozen,
            frozenHandicapRec: basketballMatches.frozenHandicapRec,
            frozenTotalDirection: basketballMatches.frozenTotalDirection,
            frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
            frozenConfidence: basketballMatches.frozenConfidence,
            frozenHandicapLine: basketballMatches.frozenHandicapLine,
            frozenTotalLine: basketballMatches.frozenTotalLine,
          })
          .from(basketballMatches)
          .where(
            and(
              gte(
                sql`${basketballMatches.matchDate}::date`,
                sql`${beijingDateStr}::date - interval '1 day'`,
              ),
              lt(
                sql`${basketballMatches.matchDate}::date`,
                sql`${beijingDateStr}::date + interval '2 days'`,
              ),
              inArray(basketballMatches.league, nblLeagueNames),
            ),
          );

        let target: {
          id: string;
          matchNo: string;
          matchStatus: string;
          league: string;
          homeTeam: string;
          awayTeam: string;
          homeScore: number | null;
          awayScore: number | null;
          liveScoreSource: string | null;
          lastScoreAt: Date | null;
          livePeriod: number | null;
          liveClock: string | null;
          predictionDirection: string | null;
          handicapRecommendation: string | null;
          handicapLineNum: string | null;
          totalDirection: string | null;
          totalLineNum: string | null;
          confidence: number | null;
          predEngineVersion: string | null;
          isPredictionFrozen: boolean;
          frozenHandicapRec: string | null;
          frozenTotalDirection: string | null;
          frozenPredictionDirection: string | null;
          frozenConfidence: number | null;
          frozenHandicapLine: string | number | null;
          frozenTotalLine: string | number | null;
        } | null = null;

        for (const row of candidates) {
          const rowHome = this.normalizeNblTeamName(row.homeTeam, '');
          const rowAway = this.normalizeNblTeamName(row.awayTeam, '');
          if (rowHome === homeNorm && rowAway === awayNorm) {
            target = row;
            break;
          }
          if (rowHome === awayNorm && rowAway === homeNorm) {
            target = row;
            break;
          }
        }

        if (!target) {
          skipped += 1;
          continue;
        }

        const rowHome = this.normalizeNblTeamName(target.homeTeam, '');
        const needReverse: boolean = rowHome === awayNorm;
        const homeScoreNum: number | null = needReverse ? m.awayScore : m.homeScore;
        const awayScoreNum: number | null = needReverse ? m.homeScore : m.awayScore;

        const mappedStatus: string =
          m.phase === 'upcoming'
            ? 'upcoming'
            : m.phase === 'live'
              ? 'live'
              : 'finished';

        const updateObj: Record<string, unknown> = {
          matchStatus: mappedStatus,
          lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
          liveScoreSource: 'nbl-official',
          updatedAt: sql`CURRENT_TIMESTAMP`,
        };

        if (mappedStatus === 'upcoming') {
          updateObj.lastScoreAt = null;
          updateObj.homeScore = null;
          updateObj.awayScore = null;
          updateObj.livePeriod = null;
          updateObj.liveClock = null;
        } else if (mappedStatus === 'live') {
          const scoreChanged: boolean = target.homeScore !== homeScoreNum || target.awayScore !== awayScoreNum;
          if (scoreChanged) updateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
          updateObj.homeScore = homeScoreNum;
          updateObj.awayScore = awayScoreNum;
          if (m.currentPeriod != null && m.currentPeriod > 0) {
            updateObj.livePeriod = m.currentPeriod;
            updateObj.liveClock = m.displayClock || null;
            updateObj.livePeriodEstimated = false;
          } else {
            updateObj.livePeriod = null;
            updateObj.liveClock = m.displayClock || null;
            updateObj.livePeriodEstimated = true;
          }
        } else {
          if (target.matchStatus !== 'finished') {
            updateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
          }
          updateObj.homeScore = homeScoreNum;
          updateObj.awayScore = awayScoreNum;
          updateObj.liveClock = '终场';
          updateObj.livePeriod = m.currentPeriod && m.currentPeriod > 0 ? m.currentPeriod : 4;
          updateObj.livePeriodEstimated = !(m.currentPeriod && m.currentPeriod > 0);
        }

        if (mappedStatus === 'live') {
          updateObj.hitWdw = null;
          updateObj.hitHandicap = null;
          updateObj.hitOverunder = null;
        }

        // 开赛冻结：从 upcoming 首次进入 live/finished 时，快照当前推荐到 frozen_* 字段
        const wasUpcomingNbl = target.matchStatus === 'upcoming';
        const isNowLiveOrFinishedNbl = mappedStatus === 'live' || mappedStatus === 'finished';
        if (wasUpcomingNbl && isNowLiveOrFinishedNbl && !target.isPredictionFrozen) {
          updateObj.frozenHandicapRec = target.handicapRecommendation;
          updateObj.frozenTotalDirection = target.totalDirection;
          updateObj.frozenPredictionDirection = target.predictionDirection;
          updateObj.frozenConfidence = target.confidence;
          updateObj.frozenHandicapLine = target.handicapLineNum;
          updateObj.frozenTotalLine = target.totalLineNum;
          updateObj.isPredictionFrozen = true;
        }

        // 预测写入守卫：开赛冻结 + V11 高质量保护
        if (shouldSkipPredictionWrite(
          target.predEngineVersion,
          mappedStatus,
          'nbl-official-ingest',
          undefined,
          target.isPredictionFrozen,
        )) {
          stripPredictionFieldsFromPatch(updateObj);
        }

        if (
          mappedStatus === 'finished' &&
          homeScoreNum !== null &&
          awayScoreNum !== null
        ) {
          const hits = this.computeBasketballHits(
            homeScoreNum,
            awayScoreNum,
            target.predictionDirection ?? target.frozenPredictionDirection,
            target.handicapLineNum ?? target.frozenHandicapLine,
            target.handicapRecommendation ?? target.frozenHandicapRec,
            target.totalLineNum ?? target.frozenTotalLine,
            target.totalDirection ?? target.frozenTotalDirection,
          );
          if (hits.hitWdw !== null) updateObj.hitWdw = hits.hitWdw;
          if (hits.hitHandicap !== undefined) updateObj.hitHandicap = hits.hitHandicap;
          if (hits.hitOverunder !== undefined) updateObj.hitOverunder = hits.hitOverunder;
        }

        await tx
          .update(basketballMatches)
          .set(updateObj)
          .where(eq(basketballMatches.id, target.id));

        updated += 1;
        if (mappedStatus === 'live') {
          liveMatches.push({
            matchNo: target.matchNo,
            homeScore: homeScoreNum,
            awayScore: awayScoreNum,
            league: target.league,
          });
        }
        if (mappedStatus === 'finished' && homeScoreNum !== null && awayScoreNum !== null) {
          finishedUpdates.push({
            matchNo: target.matchNo,
            homeScore: homeScoreNum,
            awayScore: awayScoreNum,
            league: target.league,
          });
        }
      }
    });

    return { updated, skipped, liveMatches, finishedUpdates };
  }

  private normalizeNblTeamName(name: string, code: string): string {
    const lower: string = name.toLowerCase().trim();
    const codeUp: string = code.toUpperCase().trim();

    const aliasMap: Array<{ keys: string[]; norm: string }> = [
      { keys: ['tasmania jackjumpers', 'jackjumpers', 'tassie', '跳蚁', '塔斯马尼亚'], norm: 'tasmania_jackjumpers' },
      { keys: ['brisbane bullets', 'bullets', '子弹', '布里斯班子弹', '布里斯本'], norm: 'brisbane_bullets' },
      { keys: ['sydney kings', 'kings', '国王', '悉尼'], norm: 'sydney_kings' },
      { keys: ['melbourne united', 'melbourne', 'united', '墨尔本', '墨尔本联'], norm: 'melbourne_united' },
      { keys: ['perth wildcats', 'wildcats', '野猫', '珀斯', '珀斯野猫'], norm: 'perth_wildcats' },
      { keys: ['adelaide 36ers', '36ers', '阿德莱德', '阿德莱德36人'], norm: 'adelaide_36ers' },
      { keys: ['cairns taipans', 'taipans', '大班', '凯恩斯', '凯恩斯大班'], norm: 'cairns_taipans' },
      { keys: ['illawarra hawks', 'hawks', '老鹰', '伊拉瓦拉', '伊拉瓦拉老鹰'], norm: 'illawarra_hawks' },
      { keys: ['new zealand breakers', 'nz breakers', 'breakers', '新西兰', '破坏者', '新西兰破坏者'], norm: 'nz_breakers' },
      { keys: ['south east melbourne phoenix', 'sem phoenix', 'phoenix', '凤凰', '东南墨尔本'], norm: 'sem_phoenix' },
    ];

    for (const entry of aliasMap) {
      if (entry.keys.some((k: string) => lower.includes(k))) return entry.norm;
    }
    if (codeUp) {
      const codeMap: Record<string, string> = {
        TAS: 'tasmania_jackjumpers',
        BRI: 'brisbane_bullets',
        SYD: 'sydney_kings',
        MEL: 'melbourne_united',
        PER: 'perth_wildcats',
        ADL: 'adelaide_36ers',
        CNS: 'cairns_taipans',
        ILL: 'illawarra_hawks',
        NZB: 'nz_breakers',
        SEM: 'sem_phoenix',
      };
      if (codeMap[codeUp]) return codeMap[codeUp];
    }
    return lower.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  private async updateBasketballScoresFromEspn(
    espnMatches: ESPNBasketballMatch[],
  ): Promise<{
    inserted: number;
    updated: number;
    skipped: number;
    conflictCount: number;
    finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }>;
    liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }>;
    upcomingMatches: number;
    unmappedTeams: string[];
  }> {
    if (espnMatches.length === 0)
      return {
        inserted: 0, updated: 0, skipped: 0, conflictCount: 0,
        finishedUpdates: [], liveMatches: [], upcomingMatches: 0, unmappedTeams: [],
      };

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let conflictCount = 0;
    const finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }> = [];
    const liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }> = [];
    let upcomingMatches = 0;
    const unmappedTeams: Set<string> = new Set();

    await this.db.transaction(async (tx) => {
      for (const m of espnMatches) {
        if (
          !isBasketballTeamMapped(m.homeTeamEn) ||
          !isBasketballTeamMapped(m.awayTeamEn)
        ) {
          skipped += 1;
          if (!isBasketballTeamMapped(m.homeTeamEn)) unmappedTeams.add(m.homeTeamEn);
          if (!isBasketballTeamMapped(m.awayTeamEn)) unmappedTeams.add(m.awayTeamEn);
          continue;
        }

        const kickoffDate: Date = new Date(m.kickoffTime);
        if (Number.isNaN(kickoffDate.getTime())) {
          skipped += 1;
          continue;
        }
        const beijingDateStr: string = getBeijingDateStr(kickoffDate);
        const homeNorm: string = normalizeTeamName(m.homeTeam);
        const awayNorm: string = normalizeTeamName(m.awayTeam);

        let finalHome = m.homeTeam;
        let finalAway = m.awayTeam;
        let finalHomeScore = m.homeScore;
        let finalAwayScore = m.awayScore;
        let finalOddsHomeWin = m.oddsHomeWin;
        let finalOddsAwayWin = m.oddsAwayWin;
        let finalHandicapLine = m.handicapLine;
        let finalHandicapHomeOdds = m.handicapHomeOdds;
        let finalHandicapAwayOdds = m.handicapAwayOdds;
        let finalTotalLine = m.totalLine;
        let finalTotalOverOdds = m.totalOverOdds;
        let finalTotalUnderOdds = m.totalUnderOdds;
        let flippedForSporttery = false;

        const sportterySameDay = await tx
          .select({
            id: basketballMatches.id,
            homeTeam: basketballMatches.homeTeam,
            awayTeam: basketballMatches.awayTeam,
          })
          .from(basketballMatches)
          .where(
            and(
              gte(
                sql`${basketballMatches.matchDate}::date`,
                sql`${beijingDateStr}::date - interval '1 day'`,
              ),
              lt(
                sql`${basketballMatches.matchDate}::date`,
                sql`${beijingDateStr}::date + interval '2 days'`,
              ),
              eq(basketballMatches.source, 'sporttery'),
            ),
          );

        for (const row of sportterySameDay) {
          const rowHomeNorm = normalizeTeamName(row.homeTeam);
          const rowAwayNorm = normalizeTeamName(row.awayTeam);
          if (rowHomeNorm === awayNorm && rowAwayNorm === homeNorm) {
            finalHome = m.awayTeam;
            finalAway = m.homeTeam;
            finalHomeScore = m.awayScore;
            finalAwayScore = m.homeScore;
            finalOddsHomeWin = m.oddsAwayWin;
            finalOddsAwayWin = m.oddsHomeWin;
            if (m.handicapLine != null) {
              finalHandicapLine = -m.handicapLine;
            }
            finalHandicapHomeOdds = m.handicapAwayOdds;
            finalHandicapAwayOdds = m.handicapHomeOdds;
            finalTotalLine = m.totalLine;
            finalTotalOverOdds = m.totalOverOdds;
            finalTotalUnderOdds = m.totalUnderOdds;
            flippedForSporttery = true;
            this.logger.log(
              `[espn-bball] flipped home/away to align with sporttery: ${m.homeTeam} vs ${m.awayTeam} → ${finalHome} vs ${finalAway}`,
            );
            break;
          }
        }

        const matchHomeNorm: string = normalizeTeamName(finalHome);
        const matchAwayNorm: string = normalizeTeamName(finalAway);

        const sameDayLeague = await tx
          .select({
            id: basketballMatches.id,
            matchNo: basketballMatches.matchNo,
            league: basketballMatches.league,
            matchStatus: basketballMatches.matchStatus,
            homeTeam: basketballMatches.homeTeam,
            awayTeam: basketballMatches.awayTeam,
            kickoffTime: basketballMatches.kickoffTime,
            source: basketballMatches.source,
            predictionDirection: basketballMatches.predictionDirection,
             handicapRecommendation: basketballMatches.handicapRecommendation,
             handicapLineNum: basketballMatches.handicapLineNum,
             totalDirection: basketballMatches.totalDirection,
             totalLineNum: basketballMatches.totalLineNum,
            homeWinOdds: basketballMatches.homeWinOdds,
            awayWinOdds: basketballMatches.awayWinOdds,
             handicap: basketballMatches.handicap,
             totalLine: basketballMatches.totalLine,
             intelSummary: basketballMatches.intelSummary,
             teamNews: basketballMatches.teamNews,
              intel: basketballMatches.intel,
              injuries: basketballMatches.injuries,
              teamStats: basketballMatches.teamStats,
              predEngineVersion: basketballMatches.predEngineVersion,
              oddsMovements: basketballMatches.oddsMovements,
              oddsOpenHandicapLine: basketballMatches.oddsOpenHandicapLine,
             oddsOpenTotalLine: basketballMatches.oddsOpenTotalLine,
             homeScore: basketballMatches.homeScore,
              awayScore: basketballMatches.awayScore,
              isPredictionFrozen: basketballMatches.isPredictionFrozen,
              confidence: basketballMatches.confidence,
              frozenHandicapRec: basketballMatches.frozenHandicapRec,
              frozenTotalDirection: basketballMatches.frozenTotalDirection,
              frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
              frozenConfidence: basketballMatches.frozenConfidence,
              frozenHandicapLine: basketballMatches.frozenHandicapLine,
              frozenTotalLine: basketballMatches.frozenTotalLine,
             })
            .from(basketballMatches)
           .where(
              and(
                gte(
                  sql`${basketballMatches.matchDate}::date`,
                 sql`${beijingDateStr}::date - interval '1 day'`,
               ),
               lt(
                 sql`${basketballMatches.matchDate}::date`,
                 sql`${beijingDateStr}::date + interval '2 days'`,
               ),
             ),
           );

        type BbMatchHitRow = {
           id: string;
           matchNo: string;
           league: string;
           matchStatus: string;
           homeTeam: string;
           awayTeam: string;
            predictionDirection: string;
            handicapRecommendation: string | null;
            handicapLineNum: string | null;
            totalDirection: string | null;
            totalLineNum: string | null;
           homeWinOdds: string | null;
           awayWinOdds: string | null;
           handicap: string;
           totalLine: string;
           intelSummary: string | null;
           teamNews: string | null;
           intel: string | null;
           injuries: unknown;
           teamStats: unknown;
           predEngineVersion: string | null;
           oddsMovements: unknown;
           oddsOpenHandicapLine: string | null;
           oddsOpenTotalLine: string | null;
            homeScore: number | null;
            awayScore: number | null;
            isPredictionFrozen: boolean;
            confidence: number | null;
            frozenHandicapRec: string | null;
            frozenTotalDirection: string | null;
            frozenPredictionDirection: string | null;
            frozenConfidence: number | null;
            frozenHandicapLine: string | number | null;
            frozenTotalLine: string | number | null;
          };

         let exactMatch: BbMatchHitRow | null = null;
        let reverseMatch: { id: string; matchStatus: string; predEngineVersion: string | null } | null = null;

         for (const row of sameDayLeague) {
           const rowHomeNorm: string = normalizeTeamName(row.homeTeam);
           const rowAwayNorm: string = normalizeTeamName(row.awayTeam);
           const rowKickoffMs: number = new Date(row.kickoffTime).getTime();
           if (Math.abs(rowKickoffMs - kickoffDate.getTime()) > 36 * 3600 * 1000) continue;
            if (rowHomeNorm === matchHomeNorm && rowAwayNorm === matchAwayNorm) {
             if (!exactMatch || row.source === 'sporttery') {
               exactMatch = {
                 id: row.id,
                 matchNo: row.matchNo,
                 league: row.league,
                 matchStatus: row.matchStatus,
                 homeTeam: row.homeTeam,
                 awayTeam: row.awayTeam,
                  predictionDirection: row.predictionDirection,
                  handicapRecommendation: row.handicapRecommendation,
                  handicapLineNum: row.handicapLineNum,
                  totalDirection: row.totalDirection,
                  totalLineNum: row.totalLineNum,
                 homeWinOdds: row.homeWinOdds ?? null,
                 awayWinOdds: row.awayWinOdds ?? null,
                 handicap: row.handicap ?? '',
                 totalLine: row.totalLine ?? '',
                 intelSummary: row.intelSummary ?? null,
                 teamNews: row.teamNews ?? null,
                 intel: row.intel ?? null,
                 injuries: row.injuries ?? null,
                  teamStats: row.teamStats ?? null,
                 predEngineVersion: row.predEngineVersion ?? null,
                 oddsMovements: row.oddsMovements ?? null,
                 oddsOpenHandicapLine: row.oddsOpenHandicapLine ?? null,
                 oddsOpenTotalLine: row.oddsOpenTotalLine ?? null,
                  homeScore: row.homeScore ?? null,
                  awayScore: row.awayScore ?? null,
                  isPredictionFrozen: row.isPredictionFrozen,
                  confidence: row.confidence ?? null,
                  frozenHandicapRec: row.frozenHandicapRec ?? null,
                  frozenTotalDirection: row.frozenTotalDirection ?? null,
                  frozenPredictionDirection: row.frozenPredictionDirection ?? null,
                  frozenConfidence: row.frozenConfidence ?? null,
                  frozenHandicapLine: row.frozenHandicapLine ?? null,
                  frozenTotalLine: row.frozenTotalLine ?? null,
                };
               if (row.source === 'sporttery') break;
             }
           }
           if (rowHomeNorm === matchAwayNorm && rowAwayNorm === matchHomeNorm) {
            if (!reverseMatch || row.source === 'sporttery') {
              reverseMatch = {
                id: row.id,
                matchStatus: row.matchStatus,
                predEngineVersion: row.predEngineVersion ?? null,
              };
            }
          }
        }

        let mappedStatus: string =
          m.status === 'pre'
            ? 'upcoming'
            : m.status === 'in'
              ? 'live'
              : 'finished';

        if (exactMatch) {
          if (exactMatch.matchStatus === 'finished' && mappedStatus !== 'finished') {
            this.logger.warn(
              `Basketball status rollback skipped: match=${exactMatch.id} db=finished espn=${mappedStatus}`,
            );
            skipped += 1;
            continue;
          }
          if (exactMatch.matchStatus === 'canceled') {
            skipped += 1;
            continue;
          }
          if (exactMatch.matchStatus === 'pending_sale' && mappedStatus === 'upcoming') {
            this.logger.warn(
              `Basketball pending_sale not upgraded: match=${exactMatch.id} no odds yet`,
            );
          }
          const wasFinishedBb = exactMatch.matchStatus === 'finished';
          const isPendingBb = exactMatch.matchStatus === 'pending_sale';
          const updateObj: Record<string, unknown> = {
            kickoffTime: kickoffDate,
            sourceId: m.sourceId,
            sourceLeagueCode: m.leagueCode,
            lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
            liveScoreSource: 'espn',
            updatedAt: sql`CURRENT_TIMESTAMP`,
          };
          if (!isPendingBb || mappedStatus !== 'upcoming') {
            updateObj.matchStatus = mappedStatus;
          }
          if (mappedStatus === 'upcoming') {
             updateObj.lastScoreAt = null;
             updateObj.homeScore = null;
             updateObj.awayScore = null;
             updateObj.livePeriod = null;
             updateObj.liveClock = null;
           } else if (mappedStatus === 'live') {
             updateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
             updateObj.homeScore = finalHomeScore;
             updateObj.awayScore = finalAwayScore;
             updateObj.livePeriod = m.period ?? null;
             updateObj.liveClock = m.displayClock ?? null;
           } else {
             if (!wasFinishedBb) {
               updateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
             }
             updateObj.homeScore = finalHomeScore;
             updateObj.awayScore = finalAwayScore;
             updateObj.livePeriod = m.period ?? null;
             updateObj.liveClock = m.displayClock ?? null;
           }
          if (mappedStatus === 'live') {
            updateObj.hitWdw = null;
            updateObj.hitHandicap = null;
            updateObj.hitOverunder = null;
          }
          if (mappedStatus === 'finished' && finalHomeScore !== null && finalAwayScore !== null) {
            const homeScore: number = finalHomeScore;
            const awayScore: number = finalAwayScore;
            const totalScore: number = homeScore + awayScore;
            const scoreDiff: number = Math.abs(homeScore - awayScore);
            const espnIsFinal = m.status === 'post';
            const scorePlausible =
              homeScore >= 20 &&
              awayScore >= 20 &&
              totalScore >= 60 &&
              totalScore <= 300 &&
              scoreDiff <= 80;
            if (!espnIsFinal || !scorePlausible) {
              mappedStatus = 'live';
              updateObj.matchStatus = 'live';
              updateObj.liveScoreSource = 'espn-pending-review';
              this.logger.warn(
                `Basketball ESPN final score flagged: match=${exactMatch.matchNo} ` +
                  `${homeScore}-${awayScore} plausible=${scorePlausible} status=${m.status}, keeping live`,
              );
            }
            if (mappedStatus === 'finished' && finalHomeScore !== null && finalAwayScore !== null) {
            const hits = this.computeBasketballHits(
              homeScore,
              awayScore,
              exactMatch.predictionDirection ?? exactMatch.frozenPredictionDirection as string | null,
              exactMatch.handicapLineNum ?? exactMatch.frozenHandicapLine,
              exactMatch.handicapRecommendation ?? exactMatch.frozenHandicapRec,
              exactMatch.totalLineNum ?? exactMatch.frozenTotalLine,
              exactMatch.totalDirection ?? exactMatch.frozenTotalDirection,
            );
            if (hits.hitWdw !== null) updateObj.hitWdw = hits.hitWdw;
            if (hits.hitHandicap !== undefined) updateObj.hitHandicap = hits.hitHandicap;
            if (hits.hitOverunder !== undefined) updateObj.hitOverunder = hits.hitOverunder;
          }
          }

          const espnBbHasOdds =
            finalOddsHomeWin != null && finalOddsHomeWin > 0 &&
            finalOddsAwayWin != null && finalOddsAwayWin > 0;
          const bbOddsEmpty =
            !exactMatch.homeWinOdds || Number(exactMatch.homeWinOdds) === 0;

           if (espnBbHasOdds && bbOddsEmpty) {
              updateObj.homeWinOdds = finalOddsHomeWin;
              updateObj.awayWinOdds = finalOddsAwayWin;
              if (finalHandicapLine != null) {
                updateObj.handicap = String(finalHandicapLine);
                updateObj.handicapLineNum = finalHandicapLine;
                updateObj.handicapOddsHome = finalHandicapHomeOdds ?? null;
                updateObj.handicapOddsAway = finalHandicapAwayOdds ?? null;
              }
              if (finalTotalLine != null && finalTotalLine > 0) {
                updateObj.totalLine = String(finalTotalLine);
                updateObj.totalLineNum = finalTotalLine;
                updateObj.totalOddsOver = finalTotalOverOdds ?? null;
                updateObj.totalOddsUnder = finalTotalUnderOdds ?? null;
              }
             updateObj.lastOddsUpdateAt = sql`CURRENT_TIMESTAMP`;
             // 线值变动追踪
              const espnLinePatch = buildLineMovementPatch({
                existingHandicapLineNum: exactMatch.handicapLineNum,
                existingTotalLineNum: exactMatch.totalLineNum,
                newHandicapLineNum: finalHandicapLine ?? exactMatch.handicapLineNum,
                newTotalLineNum: finalTotalLine ?? exactMatch.totalLineNum,
               existingOddsMovements: exactMatch.oddsMovements as unknown[] | null | undefined,
               existingOddsOpenHandicapLine: exactMatch.oddsOpenHandicapLine,
               existingOddsOpenTotalLine: exactMatch.oddsOpenTotalLine,
             });
             Object.assign(updateObj, espnLinePatch);

             const hasIntelData = !!(exactMatch.intelSummary && exactMatch.intelSummary.trim())
               || !!(exactMatch.teamNews && exactMatch.teamNews.trim())
               || !!(exactMatch.intel && exactMatch.intel.trim())
               || this.hasValidInjuries(exactMatch.injuries);
              if (!hasIntelData) {
                 const espnBbIsDataDriven = exactMatch.predEngineVersion?.startsWith('data-driven');
                 if (!espnBbIsDataDriven) {
                    const bbPrediction = this.generateBasketballPrediction(
                   finalOddsHomeWin,
                   finalOddsAwayWin,
                   finalHandicapLine != null ? String(finalHandicapLine) : '0',
                   finalTotalLine != null ? String(finalTotalLine) : undefined,
                  m.league,
                  '',
                  {
                    kickoffMonth: kickoffDate.getMonth() + 1,
                    teamStats: exactMatch.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined,
                  },
                );
               if (bbPrediction) {
                 updateObj.homeWinProb = bbPrediction.homeWinProb;
                 updateObj.awayWinProb = bbPrediction.awayWinProb;
                 updateObj.predictionDirection = bbPrediction.predictionDirection;
                 updateObj.confidence = bbPrediction.confidence;
                 updateObj.lowConfidence = bbPrediction.lowConfidence;
                 updateObj.handicapRecommendation = bbPrediction.handicapRecommendation;
                 updateObj.handicapCoverProb = bbPrediction.handicapCoverProb;
                 updateObj.totalDirection = bbPrediction.totalDirection;
                 updateObj.overProb = bbPrediction.overProb;
                 updateObj.underProb = bbPrediction.underProb;
                 updateObj.modelRules = bbPrediction.modelRules;
                 updateObj.predictedHomeScore = bbPrediction.predictedHomeScore;
                 updateObj.predictedAwayScore = bbPrediction.predictedAwayScore;
                 updateObj.predictedTotal = bbPrediction.predictedTotal;
                 updateObj.handicapConfidence = bbPrediction.handicapConfidence;
                 updateObj.ouConfidence = bbPrediction.ouConfidence;
                   updateObj.ouDiffVsLine = bbPrediction.ouDiffVsLine;
                  updateObj.predEngineVersion = bbPrediction.predEngineVersion;
                 }
                 }
              }
           }

            // 开赛冻结：从 upcoming 首次进入 live/finished 时，快照当前推荐到 frozen_* 字段
            const wasUpcomingBb = exactMatch.matchStatus === 'upcoming';
            const isNowLiveOrFinishedBb = mappedStatus === 'live' || mappedStatus === 'finished';
            if (wasUpcomingBb && isNowLiveOrFinishedBb && !exactMatch.isPredictionFrozen) {
              updateObj.frozenHandicapRec = exactMatch.handicapRecommendation;
              updateObj.frozenTotalDirection = exactMatch.totalDirection;
              updateObj.frozenPredictionDirection = exactMatch.predictionDirection;
              updateObj.frozenConfidence = exactMatch.confidence;
              updateObj.frozenHandicapLine = exactMatch.handicapLineNum;
              updateObj.frozenTotalLine = exactMatch.totalLineNum;
              updateObj.isPredictionFrozen = true;
            }

            // 预测写入守卫：开赛冻结 + V11 高质量保护
            if (shouldSkipPredictionWrite(
              exactMatch.predEngineVersion,
              mappedStatus,
              'espn-ingest',
              (updateObj as Record<string, unknown>).predEngineVersion as string | undefined,
              exactMatch.isPredictionFrozen,
            )) {
             stripPredictionFieldsFromPatch(updateObj as Record<string, unknown>);
            }

          if ((mappedStatus === 'live' || mappedStatus === 'finished') && finalHomeScore !== null && finalAwayScore !== null) {
            const sentinel = this.validateBasketballScoreDirection({
              homeTeam: exactMatch.homeTeam,
              awayTeam: exactMatch.awayTeam,
              homeScore: finalHomeScore,
              awayScore: finalAwayScore,
              srcHomeTeam: m.homeTeam,
              srcAwayTeam: m.awayTeam,
              srcHomeScore: m.homeScore ?? 0,
              srcAwayScore: m.awayScore ?? 0,
              source: 'espn',
              matchId: exactMatch.id,
              matchNo: exactMatch.matchNo,
              prevHomeScore: (exactMatch as unknown as { homeScore?: number | null }).homeScore ?? null,
              prevAwayScore: (exactMatch as unknown as { awayScore?: number | null }).awayScore ?? null,
              matchStatus: mappedStatus,
              period: m.period ?? null,
            });
            if (!sentinel.valid) {
              this.logger.warn(`[SCORE-SENTINEL] espn direction anomaly: ${sentinel.reason}`);
              let errorType: 'direction_mismatch' | 'score_unreasonable' | 'swing_detected' = 'direction_mismatch';
              if (sentinel.reason.startsWith('比分不合理')) errorType = 'score_unreasonable';
              else if (sentinel.reason.startsWith('分差方向突变')) errorType = 'swing_detected';
              await this.logScoreSentinelEvent({
                matchId: exactMatch.id,
                matchNo: exactMatch.matchNo,
                source: 'espn',
                errorType,
                prevHomeScore: (exactMatch as unknown as { homeScore?: number | null }).homeScore ?? null,
                prevAwayScore: (exactMatch as unknown as { awayScore?: number | null }).awayScore ?? null,
                wrongHomeScore: finalHomeScore,
                wrongAwayScore: finalAwayScore,
                correctHomeScore: sentinel.finalHomeScore,
                correctAwayScore: sentinel.finalAwayScore,
                reason: sentinel.reason,
              });
            }
            updateObj.homeScore = sentinel.finalHomeScore;
            updateObj.awayScore = sentinel.finalAwayScore;
            if (mappedStatus === 'finished') {
              const totalScore = sentinel.finalHomeScore + sentinel.finalAwayScore;
              const scoreDiff = Math.abs(sentinel.finalHomeScore - sentinel.finalAwayScore);
              const scorePlausible = sentinel.finalHomeScore >= 20 && sentinel.finalAwayScore >= 20
                && totalScore >= 60 && totalScore <= 300 && scoreDiff <= 80;
              if (!scorePlausible) {
                mappedStatus = 'live';
                updateObj.matchStatus = 'live';
                updateObj.liveScoreSource = 'espn-pending-review';
              }
            }
          }

          this.appendBasketballPredictionHistory(updateObj, 'espn_ingest');
          await tx
            .update(basketballMatches)
            .set(updateObj)
            .where(eq(basketballMatches.id, exactMatch.id));
          if (mappedStatus === 'finished' && finalHomeScore !== null && finalAwayScore !== null) {
            finishedUpdates.push({ matchNo: exactMatch.matchNo, homeScore: finalHomeScore, awayScore: finalAwayScore, league: exactMatch.league });
          } else if (mappedStatus === 'live') {
            liveMatches.push({ matchNo: exactMatch.matchNo, homeScore: finalHomeScore, awayScore: finalAwayScore, league: exactMatch.league });
          } else if (mappedStatus === 'upcoming') {
            upcomingMatches += 1;
          }
          updated += 1;
          continue;
        }

        if (reverseMatch) {
          conflictCount += 1;
          this.logger.warn(
            `Basketball home/away conflict (will update swapped): ESPN ${m.homeTeam} vs ${m.awayTeam} vs DB ${reverseMatch.id}`,
          );
          if (reverseMatch.matchStatus === 'finished' && mappedStatus !== 'finished') {
            skipped += 1;
            continue;
          }
          if (reverseMatch.matchStatus === 'canceled') {
            skipped += 1;
            continue;
          }
          const revRow = sameDayLeague.find(
             (r: BbMatchHitRow) =>
               r.id === reverseMatch!.id,
           );
          const revWasFinished = reverseMatch.matchStatus === 'finished';
          const revUpdateObj: Record<string, unknown> = {
            matchStatus: mappedStatus,
            kickoffTime: kickoffDate,
            sourceId: m.sourceId,
            sourceLeagueCode: m.leagueCode,
            lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
            liveScoreSource: 'espn',
            updatedAt: sql`CURRENT_TIMESTAMP`,
          };
          if (mappedStatus === 'upcoming') {
            revUpdateObj.lastScoreAt = null;
            revUpdateObj.homeScore = null;
            revUpdateObj.awayScore = null;
            revUpdateObj.livePeriod = null;
            revUpdateObj.liveClock = null;
          } else if (mappedStatus === 'live') {
            revUpdateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
            revUpdateObj.homeScore = m.awayScore;
            revUpdateObj.awayScore = m.homeScore;
            revUpdateObj.livePeriod = m.period ?? null;
            revUpdateObj.liveClock = m.displayClock ?? null;
          } else {
            if (!revWasFinished) {
              revUpdateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
            }
            revUpdateObj.homeScore = m.awayScore;
            revUpdateObj.awayScore = m.homeScore;
            revUpdateObj.livePeriod = m.period ?? null;
            revUpdateObj.liveClock = m.displayClock ?? null;
          }
          if (mappedStatus === 'live') {
             revUpdateObj.hitWdw = null;
             revUpdateObj.hitHandicap = null;
             revUpdateObj.hitOverunder = null;
           }

          // 开赛冻结：从 upcoming 首次进入 live/finished 时，快照当前推荐到 frozen_* 字段
          const wasUpcomingRev = reverseMatch!.matchStatus === 'upcoming';
          const isNowLiveOrFinishedRev = mappedStatus === 'live' || mappedStatus === 'finished';
          if (wasUpcomingRev && isNowLiveOrFinishedRev && revRow && !revRow.isPredictionFrozen) {
            revUpdateObj.frozenHandicapRec = revRow.handicapRecommendation;
            revUpdateObj.frozenTotalDirection = revRow.totalDirection;
            revUpdateObj.frozenPredictionDirection = revRow.predictionDirection;
            revUpdateObj.frozenConfidence = revRow.confidence;
            revUpdateObj.frozenHandicapLine = revRow.handicapLineNum;
            revUpdateObj.frozenTotalLine = revRow.totalLineNum;
            revUpdateObj.isPredictionFrozen = true;
          }

          if (
             mappedStatus === 'finished' &&
             m.homeScore !== null &&
             m.awayScore !== null &&
             revRow
           ) {
             const homeScore: number = m.awayScore;
             const awayScore: number = m.homeScore;
             const hits = this.computeBasketballHits(
               homeScore,
               awayScore,
               revRow.predictionDirection ?? revRow.frozenPredictionDirection as string | null,
               revRow.handicapLineNum ?? revRow.frozenHandicapLine,
               revRow.handicapRecommendation ?? revRow.frozenHandicapRec,
               revRow.totalLineNum ?? revRow.frozenTotalLine,
               revRow.totalDirection ?? revRow.frozenTotalDirection,
             );
            if (hits.hitWdw !== null) revUpdateObj.hitWdw = hits.hitWdw;
            if (hits.hitHandicap !== undefined) revUpdateObj.hitHandicap = hits.hitHandicap;
            if (hits.hitOverunder !== undefined) revUpdateObj.hitOverunder = hits.hitOverunder;
          }
          const revBbHasOdds =
            m.oddsHomeWin != null && m.oddsHomeWin > 0 &&
            m.oddsAwayWin != null && m.oddsAwayWin > 0;
          const revOddsEmpty =
            revRow && (!revRow.homeWinOdds || Number(revRow.homeWinOdds) === 0);
          const revIsOfficial = revRow?.source === 'sporttery' || revRow?.source === 'official';
          if (revBbHasOdds && revOddsEmpty && !revIsOfficial) {
            revUpdateObj.homeWinOdds = m.oddsAwayWin;
            revUpdateObj.awayWinOdds = m.oddsHomeWin;
            if (m.handicapLine != null) {
              revUpdateObj.handicap = String(-m.handicapLine);
              revUpdateObj.handicapLineNum = String(-m.handicapLine);
              revUpdateObj.handicapOddsHome = m.handicapAwayOdds ?? null;
              revUpdateObj.handicapOddsAway = m.handicapHomeOdds ?? null;
            }
            if (m.totalLine != null && m.totalLine > 0) {
              revUpdateObj.totalLine = String(m.totalLine);
              revUpdateObj.totalLineNum = m.totalLine;
              revUpdateObj.totalOddsOver = m.totalOverOdds ?? null;
              revUpdateObj.totalOddsUnder = m.totalUnderOdds ?? null;
            }
             revUpdateObj.lastOddsUpdateAt = sql`CURRENT_TIMESTAMP`;
             // 线值变动追踪（反向匹配）
             if (revRow) {
               const revLinePatch = buildLineMovementPatch({
                 existingHandicapLineNum: revRow.handicapLineNum,
                 existingTotalLineNum: revRow.totalLineNum,
                 newHandicapLineNum: m.handicapLine != null ? -m.handicapLine : revRow.handicapLineNum,
                 newTotalLineNum: m.totalLine ?? revRow.totalLineNum,
                 existingOddsMovements: revRow.oddsMovements as unknown[] | null | undefined,
                 existingOddsOpenHandicapLine: revRow.oddsOpenHandicapLine,
                 existingOddsOpenTotalLine: revRow.oddsOpenTotalLine,
               });
               Object.assign(revUpdateObj, revLinePatch);
             }
             const revLeague = revRow?.league ?? m.league;
            const revHasIntel = !!(revRow && (revRow as Record<string, unknown>).intelSummary && String((revRow as Record<string, unknown>).intelSummary).trim())
              || !!(revRow && (revRow as Record<string, unknown>).teamNews && String((revRow as Record<string, unknown>).teamNews).trim())
              || !!(revRow && (revRow as Record<string, unknown>).intel && String((revRow as Record<string, unknown>).intel).trim())
              || !!(revRow && this.hasValidInjuries((revRow as Record<string, unknown>).injuries));
            if (!revHasIntel) {
              const revPrediction = this.generateBasketballPrediction(
                m.oddsAwayWin,
                m.oddsHomeWin,
                m.handicapLine != null ? String(-m.handicapLine) : '0',
                m.totalLine != null ? String(m.totalLine) : undefined,
                revLeague,
                '',
                { kickoffMonth: kickoffDate.getMonth() + 1 },
              );
              if (revPrediction) {
                revUpdateObj.homeWinProb = revPrediction.homeWinProb;
                revUpdateObj.awayWinProb = revPrediction.awayWinProb;
                revUpdateObj.predictionDirection = revPrediction.predictionDirection;
                revUpdateObj.confidence = revPrediction.confidence;
                revUpdateObj.lowConfidence = revPrediction.lowConfidence;
                revUpdateObj.handicapRecommendation = revPrediction.handicapRecommendation;
                revUpdateObj.handicapCoverProb = revPrediction.handicapCoverProb;
                revUpdateObj.totalDirection = revPrediction.totalDirection;
                revUpdateObj.overProb = revPrediction.overProb;
                revUpdateObj.underProb = revPrediction.underProb;
                revUpdateObj.modelRules = revPrediction.modelRules;
                revUpdateObj.predictedHomeScore = revPrediction.predictedHomeScore;
                revUpdateObj.predictedAwayScore = revPrediction.predictedAwayScore;
                revUpdateObj.predictedTotal = revPrediction.predictedTotal;
                revUpdateObj.handicapConfidence = revPrediction.handicapConfidence;
                revUpdateObj.ouConfidence = revPrediction.ouConfidence;
                 revUpdateObj.ouDiffVsLine = revPrediction.ouDiffVsLine;
                revUpdateObj.predEngineVersion = revPrediction.predEngineVersion;
               }
             }
           }
          // 预测写入守卫：开赛冻结 + V11 高质量保护
           if (shouldSkipPredictionWrite(
             reverseMatch.predEngineVersion,
             mappedStatus,
             'espn-ingest-reverse',
             (revUpdateObj as Record<string, unknown>).predEngineVersion as string | undefined,
             revRow?.isPredictionFrozen,
           )) {
             stripPredictionFieldsFromPatch(revUpdateObj as Record<string, unknown>);
           }
           this.appendBasketballPredictionHistory(revUpdateObj, 'espn_ingest_reverse');
           await tx
             .update(basketballMatches)
             .set(revUpdateObj)
             .where(eq(basketballMatches.id, reverseMatch.id));
           if (mappedStatus === 'finished' && m.homeScore !== null && m.awayScore !== null) {
             finishedUpdates.push({ matchNo: reverseMatch.id, homeScore: m.awayScore, awayScore: m.homeScore, league: m.league });
           } else if (mappedStatus === 'live') {
             liveMatches.push({ matchNo: reverseMatch.id, homeScore: m.awayScore, awayScore: m.homeScore, league: m.league });
           } else if (mappedStatus === 'upcoming') {
             upcomingMatches += 1;
           }
           updated += 1;
           continue;
        }

        const sameDayAllBball = await tx
          .select({
            id: basketballMatches.id,
            matchStatus: basketballMatches.matchStatus,
            homeTeam: basketballMatches.homeTeam,
            awayTeam: basketballMatches.awayTeam,
            kickoffTime: basketballMatches.kickoffTime,
            source: basketballMatches.source,
            predictionDirection: basketballMatches.predictionDirection,
             handicapRecommendation: basketballMatches.handicapRecommendation,
             handicapLineNum: basketballMatches.handicapLineNum,
             totalDirection: basketballMatches.totalDirection,
             totalLineNum: basketballMatches.totalLineNum,
            predEngineVersion: basketballMatches.predEngineVersion,
            isPredictionFrozen: basketballMatches.isPredictionFrozen,
            confidence: basketballMatches.confidence,
            frozenHandicapRec: basketballMatches.frozenHandicapRec,
            frozenTotalDirection: basketballMatches.frozenTotalDirection,
            frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
            frozenConfidence: basketballMatches.frozenConfidence,
            frozenHandicapLine: basketballMatches.frozenHandicapLine,
            frozenTotalLine: basketballMatches.frozenTotalLine,
          })
          .from(basketballMatches)
          .where(
            and(
              gte(
                sql`${basketballMatches.matchDate}::date`,
                sql`${beijingDateStr}::date - interval '1 day'`,
              ),
              lt(
                sql`${basketballMatches.matchDate}::date`,
                sql`${beijingDateStr}::date + interval '2 days'`,
              ),
            ),
          );

        const crossSourceMatchBball = findSameMatchByTeams(
          sameDayAllBball,
          m.homeTeam,
          m.awayTeam,
          kickoffDate,
          12,
        );

        if (crossSourceMatchBball) {
          if (crossSourceMatchBball.matchStatus === 'finished' && mappedStatus !== 'finished') {
            this.logger.warn(
              `Basketball status rollback skipped (cross-source): match=${crossSourceMatchBball.id} db=finished espn=${mappedStatus}`,
            );
            skipped += 1;
            continue;
          }
          if (crossSourceMatchBball.matchStatus === 'canceled') {
            skipped += 1;
            continue;
          }
          const crossRow = sameDayAllBball.find(
             (r: { id: string; predictionDirection: string; handicapRecommendation: string | null; handicapLineNum: string | null; totalDirection: string | null; totalLineNum: string | null; isPredictionFrozen: boolean; confidence: number | null; frozenHandicapRec: string | null; frozenTotalDirection: string | null; frozenPredictionDirection: string | null; frozenConfidence: number | null; frozenHandicapLine: string | number | null; frozenTotalLine: string | number | null }) =>
               r.id === crossSourceMatchBball.id,
           );
          const crossWasFinished = crossSourceMatchBball.matchStatus === 'finished';
          const crossUpdateObj: Record<string, unknown> = {
            matchStatus: mappedStatus,
            kickoffTime: kickoffDate,
            sourceId: m.sourceId,
            sourceLeagueCode: m.leagueCode,
            lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
            liveScoreSource: 'espn',
            updatedAt: sql`CURRENT_TIMESTAMP`,
          };
          if (mappedStatus === 'upcoming') {
             crossUpdateObj.lastScoreAt = null;
             crossUpdateObj.homeScore = null;
             crossUpdateObj.awayScore = null;
             crossUpdateObj.livePeriod = null;
             crossUpdateObj.liveClock = null;
           } else if (mappedStatus === 'live') {
             crossUpdateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
             crossUpdateObj.homeScore = m.homeScore;
             crossUpdateObj.awayScore = m.awayScore;
             crossUpdateObj.livePeriod = m.period ?? null;
             crossUpdateObj.liveClock = m.displayClock ?? null;
           } else {
             if (!crossWasFinished) {
               crossUpdateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
             }
             crossUpdateObj.homeScore = m.homeScore;
             crossUpdateObj.awayScore = m.awayScore;
             crossUpdateObj.livePeriod = m.period ?? null;
             crossUpdateObj.liveClock = m.displayClock ?? null;
           }
          if (mappedStatus === 'live') {
             crossUpdateObj.hitWdw = null;
             crossUpdateObj.hitHandicap = null;
             crossUpdateObj.hitOverunder = null;
           }

          // 开赛冻结：从 upcoming 首次进入 live/finished 时，快照当前推荐到 frozen_* 字段
          const wasUpcomingCross = crossSourceMatchBball.matchStatus === 'upcoming';
          const isNowLiveOrFinishedCross = mappedStatus === 'live' || mappedStatus === 'finished';
          if (wasUpcomingCross && isNowLiveOrFinishedCross && crossRow && !crossRow.isPredictionFrozen) {
            crossUpdateObj.frozenHandicapRec = crossRow.handicapRecommendation;
            crossUpdateObj.frozenTotalDirection = crossRow.totalDirection;
            crossUpdateObj.frozenPredictionDirection = crossRow.predictionDirection;
            crossUpdateObj.frozenConfidence = crossRow.confidence;
            crossUpdateObj.frozenHandicapLine = crossRow.handicapLineNum;
            crossUpdateObj.frozenTotalLine = crossRow.totalLineNum;
            crossUpdateObj.isPredictionFrozen = true;
          }

          if (
             mappedStatus === 'finished' &&
             m.homeScore !== null &&
             m.awayScore !== null &&
             crossRow
           ) {
             const homeScore: number = m.homeScore;
             const awayScore: number = m.awayScore;
             const hits = this.computeBasketballHits(
               homeScore,
               awayScore,
               crossRow.predictionDirection ?? crossRow.frozenPredictionDirection as string | null,
               crossRow.handicapLineNum ?? crossRow.frozenHandicapLine,
               crossRow.handicapRecommendation ?? crossRow.frozenHandicapRec,
               crossRow.totalLineNum ?? crossRow.frozenTotalLine,
               crossRow.totalDirection ?? crossRow.frozenTotalDirection,
             );
            if (hits.hitWdw !== null) crossUpdateObj.hitWdw = hits.hitWdw;
            if (hits.hitHandicap !== undefined) crossUpdateObj.hitHandicap = hits.hitHandicap;
            if (hits.hitOverunder !== undefined) crossUpdateObj.hitOverunder = hits.hitOverunder;
          }
          // 预测写入守卫：开赛冻结 + V11 高质量保护
          const crossRowWithPred = crossSourceMatchBball as { id: string; matchStatus: string; predEngineVersion?: string | null; isPredictionFrozen?: boolean };
           if (shouldSkipPredictionWrite(
             crossRowWithPred.predEngineVersion,
             mappedStatus,
             'espn-ingest-cross',
             (crossUpdateObj as Record<string, unknown>).predEngineVersion as string | undefined,
             crossRow?.isPredictionFrozen ?? crossRowWithPred.isPredictionFrozen,
           )) {
             stripPredictionFieldsFromPatch(crossUpdateObj as Record<string, unknown>);
           }
           this.appendBasketballPredictionHistory(crossUpdateObj as Record<string, unknown>, 'espn_ingest_cross');
           await tx
             .update(basketballMatches)
             .set(crossUpdateObj)
             .where(eq(basketballMatches.id, crossSourceMatchBball.id));
           if (mappedStatus === 'finished' && m.homeScore !== null && m.awayScore !== null) {
            finishedUpdates.push({ matchNo: crossSourceMatchBball.id, homeScore: m.homeScore, awayScore: m.awayScore, league: m.league });
          } else if (mappedStatus === 'live') {
            liveMatches.push({ matchNo: crossSourceMatchBball.id, homeScore: m.homeScore, awayScore: m.awayScore, league: m.league });
          } else if (mappedStatus === 'upcoming') {
            upcomingMatches += 1;
          }
          updated += 1;
          continue;
        }

         const espnBbHasOddsForInsert =
           m.oddsHomeWin != null && m.oddsHomeWin > 0 &&
           m.oddsAwayWin != null && m.oddsAwayWin > 0;

          if (espnBbHasOddsForInsert) {
            const bbBeijingDateStr: string = getBeijingDateStr(kickoffDate);
            const classified = this.classifyBasketballLeague(m.league, m.homeTeam, m.awayTeam, kickoffDate);
           const hcLine: number = m.handicapLine ?? 0;
           const tLine: number = m.totalLine ?? 0;
           const hcValid = hcLine !== 0 && this.isBasketballLineValid(classified.league, 'spread', hcLine);
           const tValid = tLine > 0 && this.isBasketballLineValid(classified.league, 'total', tLine);
           const bbPred = this.generateBasketballPrediction(
             m.oddsHomeWin,
             m.oddsAwayWin,
             hcValid ? String(hcLine) : '',
             tValid ? String(tLine) : undefined,
             classified.league,
             '',
             { kickoffMonth: kickoffDate.getMonth() + 1 },
           );
           const bbInsertObj: Record<string, unknown> = {
             matchNo: `ESPN-${m.sourceId}`,
             matchDate: bbBeijingDateStr,
             businessDate: bbBeijingDateStr,
             league: classified.league,
             category: classified.category,
             homeTeam: m.homeTeam,
             awayTeam: m.awayTeam,
             kickoffTime: kickoffDate,
             matchStatus: mappedStatus,
             source: 'espn',
             sourceId: m.sourceId,
             sourceLeagueCode: m.leagueCode,
             liveScoreSource: 'espn',
             homeWinOdds: m.oddsHomeWin,
             awayWinOdds: m.oddsAwayWin,
             handicap: hcValid ? String(hcLine) : '',
             handicapLineNum: hcValid ? String(hcLine) : '0',
             handicapOddsHome: m.handicapHomeOdds ?? null,
             handicapOddsAway: m.handicapAwayOdds ?? null,
             totalLine: tValid ? String(tLine) : '',
             totalLineNum: tValid ? String(tLine) : '0',
             totalOddsOver: m.totalOverOdds ?? null,
             totalOddsUnder: m.totalUnderOdds ?? null,
             homeWinProb: bbPred?.homeWinProb ?? 50,
             awayWinProb: bbPred?.awayWinProb ?? 50,
             predictionDirection: bbPred?.predictionDirection ?? '主胜',
             confidence: bbPred?.confidence ?? 0,
             lowConfidence: bbPred?.lowConfidence ?? true,
             handicapRecommendation: bbPred?.handicapRecommendation ?? '',
             handicapCoverProb: bbPred?.handicapCoverProb ?? 50,
             totalDirection: bbPred?.totalDirection ?? '',
             overProb: bbPred?.overProb ?? 50,
             underProb: bbPred?.underProb ?? 50,
             modelRules: bbPred?.modelRules ?? [],
             predictedHomeScore: bbPred?.predictedHomeScore ?? 0,
             predictedAwayScore: bbPred?.predictedAwayScore ?? 0,
             predictedTotal: bbPred ? String(bbPred.predictedTotal) : '0',
             handicapConfidence: bbPred?.handicapConfidence ?? '低',
             ouConfidence: bbPred?.ouConfidence ?? '低',
             ouDiffVsLine: bbPred ? String(bbPred.ouDiffVsLine) : '0',
             homeScore: m.homeScore,
             awayScore: m.awayScore,
             livePeriod: m.period ?? null,
             liveClock: m.displayClock ?? null,
             lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
             lastOddsUpdateAt: sql`CURRENT_TIMESTAMP`,
             updatedAt: sql`CURRENT_TIMESTAMP`,
           };
            this.finalizeBasketballPick(bbInsertObj, undefined, undefined, classified.league);
            try {
              const [newRow] = await tx.insert(basketballMatches).values(bbInsertObj as typeof basketballMatches.$inferInsert).returning({ id: basketballMatches.id });
              inserted += 1;
              if (newRow) {
                const hh = m.handicapHomeOdds ?? null;
                const ha = m.handicapAwayOdds ?? null;
                if (hcValid && ((hh != null && hh > 0) || (ha != null && ha > 0))) {
                  await insertBasketballOddsSnapshotIfChanged(
                    tx, newRow.id, 'handicap',
                    {
                      home: hh && hh > 0 ? hh : undefined,
                      away: ha && ha > 0 ? ha : undefined,
                      line: hcLine,
                    },
                    'ESPN',
                  );
                }
                const to = m.totalOverOdds ?? null;
                const tu = m.totalUnderOdds ?? null;
                if (tValid && ((to != null && to > 0) || (tu != null && tu > 0))) {
                  await insertBasketballOddsSnapshotIfChanged(
                    tx, newRow.id, 'total',
                    {
                      over: to && to > 0 ? to : undefined,
                      under: tu && tu > 0 ? tu : undefined,
                      line: tLine,
                    },
                    'ESPN',
                  );
                }
              }
             if (mappedStatus === 'upcoming') {
               upcomingMatches += 1;
             } else if (mappedStatus === 'live') {
               liveMatches.push({ matchNo: `ESPN-${m.sourceId}`, homeScore: m.homeScore, awayScore: m.awayScore, league: classified.league });
             } else if (mappedStatus === 'finished' && m.homeScore !== null && m.awayScore !== null) {
               finishedUpdates.push({ matchNo: `ESPN-${m.sourceId}`, homeScore: m.homeScore, awayScore: m.awayScore, league: classified.league });
             }
             continue;
           } catch (insertErr: unknown) {
             const code = this.extractPostgresCode(insertErr);
             if (code === '23505') {
               updated += 1;
               continue;
             }
             this.logger.warn(`ESPN bb insert failed: ${m.homeTeam} vs ${m.awayTeam}`, insertErr instanceof Error ? insertErr.message : String(insertErr));
           }
         }

         skipped += 1;
      }
    });

    return {
      inserted, updated, skipped, conflictCount,
      finishedUpdates, liveMatches, upcomingMatches,
      unmappedTeams: Array.from(unmappedTeams),
    };
  }

  // --- Qiumibao live score sync ---

  private qiumibaoBbLastFullRun: Date | null = null;
  private qiumibaoBbSuccess = false;
  private qiumibaoBbTodayCount = 0;
  private qiumibaoBbRhythm: EspnRhythm = 'idle';
  private qiumibaoBbLastSync: Date | null = null;
  private qiumibaoBbScoreUpdateResult: {
    updated: number; skipped: number;
    liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }>;
    finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }>;
  } | null = null;

  private qiumibaoFbLastFullRun: Date | null = null;
  private qiumibaoFbSuccess = false;
  private qiumibaoFbTodayCount = 0;
  private qiumibaoFbRhythm: EspnRhythm = 'idle';
  private qiumibaoFbLastSync: Date | null = null;
  private qiumibaoFbScoreUpdateResult: {
    updated: number; skipped: number;
    liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }>;
    finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }>;
  } | null = null;

  private qiumibaoLastScheduleSync: Date | null = null;
  private qiumibaoScheduleNextInterval = 7 * 60 * 1000; // 7 min default
  private qiumibaoTotalRawCount = 0;
  private qiumibaoFootballCount = 0;
  private qiumibaoBasketballCount = 0;
  private qiumibaoFbJcAligned = 0;
  private qiumibaoBbJcAligned = 0;

  private scheduleNextQiumibaoRun(): void {
    // Self-scheduling with ±5s jitter on the 45s adaptive base
    const jitter = 5 * 1000;
    const delay = QIUMIBAO_ADAPTIVE_INTERVAL_MS + Math.random() * jitter - jitter / 2;
    this.qiumibaoLiveTimer = setTimeout(() => {
      void this.runQiumibaoLiveSync().catch((err: unknown) => {
        this.logger.error(`Qiumibao live sync failed: ${this.errorMessage(err)}`);
      });
    }, delay);
    if (this.qiumibaoLiveTimer && typeof this.qiumibaoLiveTimer.unref === 'function') {
      this.qiumibaoLiveTimer.unref();
    }
  }

  private async runQiumibaoLiveSync(): Promise<void> {
    try {
      const now = new Date();

      const bbStatus = await this.getDayMatchStatus('basketball');
      const bbRhythm: EspnRhythm =
        bbStatus.live > 0 ? 'live' : bbStatus.upcoming > 0 ? 'upcoming' : 'idle';
      this.qiumibaoBbRhythm = bbRhythm;

      const bbMinInterval =
        bbRhythm === 'live'
          ? QIUMIBAO_LIVE_INTERVAL_MS
          : bbRhythm === 'upcoming'
            ? QIUMIBAO_UPCOMING_INTERVAL_MS
            : QIUMIBAO_IDLE_INTERVAL_MS;

      const bbShouldRun =
        !this.qiumibaoBbLastFullRun ||
        now.getTime() - this.qiumibaoBbLastFullRun.getTime() >= bbMinInterval;

      // Schedule & odds reconciliation: 7 min ± 3 min (4~10 min range)
      const shouldRunSchedule =
        !this.qiumibaoLastScheduleSync ||
        now.getTime() - this.qiumibaoLastScheduleSync.getTime() >= this.qiumibaoScheduleNextInterval;

      try {
        const result = await this.qiumibaoSource.fetchBasketballAll();
        this.qiumibaoBbSuccess = true;
        this.qiumibaoBbLastFullRun = new Date();
        this.qiumibaoBbTodayCount += 1;
        this.qiumibaoBbLastSync = new Date();
        this.qiumibaoBasketballCount = result.basketballCount;
        this.qiumibaoBbJcAligned = result.withMatchNoCount;
        this.qiumibaoTotalRawCount = result.rawTotal;

        const bbResult = await this.updateBasketballScoresFromQiumibao(result.matches);
        this.qiumibaoBbScoreUpdateResult = bbResult;
        this.crossValidateBasketballScores('qiumibao').catch((cvErr: unknown) => {
          this.logger.warn(`Basketball cross-validate (after qiumibao) failed: ${this.errorMessage(cvErr)}`);
        });

        // 球美宝终场超时兜底：qiumibao-final-pending/degraded 超过 120 分钟且比分合理
        // 则升级为正式终场（qiumibao-final-authoritative）并回打命中
        void this.promoteQiumibaoDegradedFinals().catch((promoteErr: unknown) => {
          this.logger.warn(`Qiumibao degraded final promotion failed: ${this.errorMessage(promoteErr)}`);
        });

        if (shouldRunSchedule) {
          const sched = await this.syncBasketballScheduleOddsFromQiumibao(result.matches);
          if (sched.updated > 0 || sched.unmatched > 0) {
            this.logger.log(
              `Qiumibao basketball schedule/odds sync: updated=${sched.updated}, ` +
              `skipped=${sched.skipped}, unmatched=${sched.unmatched}`,
            );
          }
        }

        if (bbResult.updated > 0 || bbResult.skipped > 0 || bbResult.finishedUpdates.length > 0 || bbResult.liveMatches.length > 0) {
          this.logger.log(
            `Qiumibao basketball sync: raw=${result.rawTotal}, bb=${result.basketballCount}, ` +
            `withNo=${result.withMatchNoCount}, updated=${bbResult.updated}, ` +
            `skipped=${bbResult.skipped}, live=${bbResult.liveMatches.length}, ` +
            `finished=${bbResult.finishedUpdates.length}`,
          );
        }
      } catch (err) {
        this.qiumibaoBbSuccess = false;
        this.logger.warn(
          `Qiumibao basketball live sync failed: ${this.errorMessage(err)}`,
        );
      }

      // Football sync
      const fbStatus = await this.getDayMatchStatus('football');
      const fbRhythm: EspnRhythm =
        fbStatus.live > 0 ? 'live' : fbStatus.upcoming > 0 ? 'upcoming' : 'idle';
      this.qiumibaoFbRhythm = fbRhythm;

      try {
        const fbResult = await this.qiumibaoSource.fetchFootballAll();
        this.qiumibaoFbSuccess = true;
        this.qiumibaoFbLastFullRun = new Date();
        this.qiumibaoFbTodayCount += 1;
        this.qiumibaoFbLastSync = new Date();
        this.qiumibaoFootballCount = fbResult.footballCount;
        this.qiumibaoFbJcAligned = fbResult.withMatchNoCount;

        const fbUpdateResult = await this.updateFootballScoresFromQiumibao(fbResult.matches);
        this.qiumibaoFbScoreUpdateResult = fbUpdateResult;

        if (shouldRunSchedule) {
          const sched = await this.syncFootballScheduleOddsFromQiumibao(fbResult.matches);
          if (sched.updated > 0 || sched.unmatched > 0) {
            this.logger.log(
              `Qiumibao football schedule/odds sync: updated=${sched.updated}, ` +
              `skipped=${sched.skipped}, unmatched=${sched.unmatched}`,
            );
          }
        }

        if (fbUpdateResult.updated > 0 || fbUpdateResult.skipped > 0 || fbUpdateResult.finishedUpdates.length > 0 || fbUpdateResult.liveMatches.length > 0) {
          this.logger.log(
            `Qiumibao football sync: raw=${fbResult.rawTotal}, fb=${fbResult.footballCount}, ` +
            `withNo=${fbResult.withMatchNoCount}, updated=${fbUpdateResult.updated}, ` +
            `skipped=${fbUpdateResult.skipped}, live=${fbUpdateResult.liveMatches.length}, ` +
            `finished=${fbUpdateResult.finishedUpdates.length}`,
          );
        }
      } catch (err) {
        this.qiumibaoFbSuccess = false;
        this.logger.warn(
          `Qiumibao football live sync failed: ${this.errorMessage(err)}`,
        );
      }

      if (shouldRunSchedule) {
        this.qiumibaoLastScheduleSync = new Date();
        // Adaptive schedule sync interval based on match rhythm
        // live: ~2min, upcoming: 90s ± 30s (60-120s), idle: 7min ± 3min
        const bbStatus = await this.getDayMatchStatus('basketball');
        const fbStatus = await this.getDayMatchStatus('football');
        const hasLive = bbStatus.live > 0 || fbStatus.live > 0;
        const hasUpcoming = bbStatus.upcoming > 0 || fbStatus.upcoming > 0;
        if (hasLive) {
          this.qiumibaoScheduleNextInterval =
            2 * 60 * 1000 + (Math.random() - 0.5) * 60 * 1000; // 1.5~2.5 min
        } else if (hasUpcoming) {
          this.qiumibaoScheduleNextInterval =
            90 * 1000 + (Math.random() - 0.5) * 60 * 1000; // 60~120s
        } else {
          this.qiumibaoScheduleNextInterval =
            7 * 60 * 1000 + (Math.random() - 0.5) * 6 * 60 * 1000; // 4~10 min
        }
      }
    } finally {
      this.scheduleNextQiumibaoRun();
    }
  }

  // --- api-sports.io fallback sync ---

  private async runApiSportsSync(): Promise<void> {
    if (!this.apiSportsSource.isEnabled()) return;
    try {
      const [fbResult, bbResult] = await Promise.all([
        this.runApiSportsFootballSync(),
        this.runApiSportsBasketballSync(),
      ]);

      this.apiSportsLastSync = new Date();
      const srcErr = this.apiSportsSource.getLastError();
      const totalCount = fbResult.inserted + fbResult.updated + bbResult.inserted + bbResult.updated;
      if (srcErr) {
        this.apiSportsSuccess = false;
        this.apiSportsLastError = srcErr;
        this.logger.warn(`apiSports sync completed with error: ${srcErr}`);
      } else {
        this.apiSportsSuccess = true;
        this.apiSportsLastError = null;
      }
      this.apiSportsTodayCount += 1;
      this.apiSportsFootballCount = fbResult.inserted + fbResult.updated;
      this.apiSportsBasketballCount = bbResult.inserted + bbResult.updated;

      this.logger.log(
        `apiSports sync complete: ` +
        `football inserted=${fbResult.inserted} updated=${fbResult.updated} skipped=${fbResult.skipped}, ` +
        `basketball inserted=${bbResult.inserted} updated=${bbResult.updated} skipped=${bbResult.skipped}, ` +
        `total=${totalCount}, quotaUsed=${this.apiSportsSource.getQuotaUsed()}/${this.apiSportsSource.getDailyLimit()}` +
        (srcErr ? `, error=${srcErr}` : ''),
      );
    } catch (err) {
      this.apiSportsLastSync = new Date();
      this.apiSportsSuccess = false;
      this.apiSportsLastError = this.errorMessage(err);
      this.logger.error(`apiSports sync failed: ${this.errorMessage(err)}`);
    }
  }

  private async runApiSportsFootballSync(): Promise<{ inserted: number; updated: number; skipped: number }> {
    if (!this.apiSportsSource.isEnabled()) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }
    const todayStr = this.getBeijingTodayStr();
    const fixtures: ApiSportsFootballFixture[] = await this.apiSportsSource.getFixturesByDate(todayStr);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    if (fixtures.length === 0) {
      return { inserted, updated, skipped };
    }

    // Fetch today's existing football matches for matching
    const existingRows = await this.db
      .select({
        id: matches.id,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        kickoffTime: matches.kickoffTime,
        matchStatus: matches.matchStatus,
        homeScore: matches.homeScore,
        awayScore: matches.awayScore,
        matchDate: matches.matchDate,
      })
      .from(matches)
      .where(eq(matches.matchDate, sql`${todayStr}::date`));

    for (const fx of fixtures) {
      try {
        const fxDate = new Date(fx.date);
        if (Number.isNaN(fxDate.getTime())) {
          skipped += 1;
          continue;
        }

        const homeNorm = normalizeTeamName(fx.homeTeam);
        const awayNorm = normalizeTeamName(fx.awayTeam);

        // Find matching existing match by team name normalization + kickoff proximity
        let matched: {
          id: string;
          matchStatus: string;
          homeScore: number | null;
          awayScore: number | null;
        } | null = null;

        for (const row of existingRows) {
          const rowHome = normalizeTeamName(row.homeTeam);
          const rowAway = normalizeTeamName(row.awayTeam);
          const rowKickoff = new Date(row.kickoffTime as unknown as string).getTime();
          if (Math.abs(rowKickoff - fxDate.getTime()) > 12 * 3600 * 1000) continue;
          if (
            (rowHome === homeNorm && rowAway === awayNorm) ||
            (rowHome.includes(homeNorm) && rowAway.includes(awayNorm) && homeNorm.length >= 3 && awayNorm.length >= 3) ||
            (homeNorm.includes(rowHome) && awayNorm.includes(rowAway) && rowHome.length >= 3 && rowAway.length >= 3)
          ) {
            matched = row;
            break;
          }
        }

        if (!matched) {
          skipped += 1;
          continue;
        }

        // Only fill in when both score AND status are missing (ESPN + 球美宝都没覆盖)
        const hasScore = matched.homeScore !== null && matched.awayScore !== null;
        const hasStatus = matched.matchStatus !== 'upcoming' && matched.matchStatus !== 'pre';
        if (hasScore || hasStatus) {
          skipped += 1;
          continue;
        }

        // Map api-sports status to our matchStatus
        const status = fx.status;
        let mappedStatus: string = matched.matchStatus;
        let homeScore: number | null = fx.homeScore;
        let awayScore: number | null = fx.awayScore;

        if (status === 'FT' || status === 'AET' || status === 'PEN' || status === 'AWD' || status === 'WO') {
          mappedStatus = 'finished';
        } else if (
          status === '1H' || status === 'HT' || status === '2H' ||
          status === 'LIVE' || status === 'BT' || status === 'INT' || status === 'SUSP'
        ) {
          mappedStatus = 'live';
        } else if (status === 'CANC' || status === 'ABD' || status === 'PST') {
          mappedStatus = 'cancelled';
          homeScore = null;
          awayScore = null;
        } else {
          // 'NS' (Not Started) or other - keep as upcoming, no score
          skipped += 1;
          continue;
        }

        await this.db
          .update(matches)
          .set({
            matchStatus: mappedStatus,
            homeScore,
            awayScore,
            lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
            liveScoreSource: 'api-sports',
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(matches.id, matched.id));
        updated += 1;
      } catch {
        skipped += 1;
      }
    }

    return { inserted, updated, skipped };
  }

  private async runApiSportsBasketballSync(): Promise<{ inserted: number; updated: number; skipped: number }> {
    if (!this.apiSportsSource.isEnabled()) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }
    const todayStr = this.getBeijingTodayStr();
    const games: ApiSportsBasketballGame[] = await this.apiSportsSource.getGamesByDate(todayStr);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    if (games.length === 0) {
      return { inserted, updated, skipped };
    }

    // Fetch today's existing basketball matches for matching
    const existingRows = await this.db
      .select({
        id: basketballMatches.id,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        kickoffTime: basketballMatches.kickoffTime,
        matchStatus: basketballMatches.matchStatus,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        matchDate: basketballMatches.matchDate,
      })
      .from(basketballMatches)
      .where(eq(basketballMatches.matchDate, todayStr));

    for (const g of games) {
      try {
        const gDate = new Date(g.date);
        if (Number.isNaN(gDate.getTime())) {
          skipped += 1;
          continue;
        }

        const homeNorm = normalizeTeamName(g.homeTeam);
        const awayNorm = normalizeTeamName(g.awayTeam);

        let matched: {
          id: string;
          matchStatus: string;
          homeScore: number | null;
          awayScore: number | null;
        } | null = null;

        for (const row of existingRows) {
          const rowHome = normalizeTeamName(row.homeTeam);
          const rowAway = normalizeTeamName(row.awayTeam);
          const rowKickoff = new Date(row.kickoffTime as unknown as string).getTime();
          if (Math.abs(rowKickoff - gDate.getTime()) > 12 * 3600 * 1000) continue;
          if (
            (rowHome === homeNorm && rowAway === awayNorm) ||
            (rowHome.includes(homeNorm) && rowAway.includes(awayNorm) && homeNorm.length >= 3 && awayNorm.length >= 3) ||
            (homeNorm.includes(rowHome) && awayNorm.includes(rowAway) && rowHome.length >= 3 && rowAway.length >= 3)
          ) {
            matched = row;
            break;
          }
        }

        if (!matched) {
          skipped += 1;
          continue;
        }

        // Only fill in when both score AND status are missing (ESPN + 球美宝都没覆盖)
        const hasScore = matched.homeScore !== null && matched.awayScore !== null;
        const hasStatus = matched.matchStatus !== 'upcoming' && matched.matchStatus !== 'pre';
        if (hasScore || hasStatus) {
          skipped += 1;
          continue;
        }

        const status = g.status;
        let mappedStatus: string = matched.matchStatus;
        let homeScore: number | null = g.homeScore;
        let awayScore: number | null = g.awayScore;

        if (status === 'FT' || status === 'Finished' || status === 'AOT') {
          mappedStatus = 'finished';
        } else if (
          status === 'Q1' || status === 'Q2' || status === 'Q3' || status === 'Q4' ||
          status === 'HT' || status === 'OT' || status === 'LIVE' || status === 'In Progress'
        ) {
          mappedStatus = 'live';
        } else if (status === 'CANC' || status === 'ABD' || status === 'Postponed' || status === 'SUSP') {
          mappedStatus = 'cancelled';
          homeScore = null;
          awayScore = null;
        } else {
          // 'NS' / Not Started or unknown - keep as upcoming, no score update
          skipped += 1;
          continue;
        }

        await this.db
          .update(basketballMatches)
          .set({
            matchStatus: mappedStatus,
            homeScore,
            awayScore,
            lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
            liveScoreSource: 'api-sports',
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(basketballMatches.id, matched.id));
        updated += 1;
      } catch {
        skipped += 1;
      }
    }

    return { inserted, updated, skipped };
  }

  // --- TheSportsDB sync (read-only fallback source) ---

  private async runTheSportsDbSync(): Promise<void> {
    try {
      const todayStr = this.getBeijingTodayStr();
      const [fbMatches, bbMatches] = await Promise.all([
        this.tsdbSource.fetchFootballByDate(todayStr),
        this.tsdbSource.fetchBasketballByDate(todayStr),
      ]);

      this.theSportsDbLastSync = new Date();
      this.theSportsDbSuccess = true;
      this.theSportsDbTodayCount += 1;
      this.theSportsDbFootballCount = fbMatches.length;
      this.theSportsDbBasketballCount = bbMatches.length;
      this.theSportsDbFetchedCount = fbMatches.length + bbMatches.length;
      this.theSportsDbFailStreak = 0;
      this.theSportsDbLastError = null;

      const allMatches = [...fbMatches, ...bbMatches];
      const hasLive = allMatches.some((m) => m.matchStatus === 'live');
      const hasUpcoming = allMatches.some((m) => m.matchStatus === 'upcoming');
      this.theSportsDbRhythm = hasLive || hasUpcoming ? 'daily' : 'idle';

      this.logger.log(
        `TheSportsDB sync complete: total=${allMatches.length}, ` +
        `football=${fbMatches.length}, basketball=${bbMatches.length}, ` +
        `live=${allMatches.filter((m) => m.matchStatus === 'live').length}, ` +
        `upcoming=${allMatches.filter((m) => m.matchStatus === 'upcoming').length}, ` +
        `finished=${allMatches.filter((m) => m.matchStatus === 'finished').length}`,
      );
    } catch (err) {
      this.theSportsDbLastSync = new Date();
      this.theSportsDbSuccess = false;
      this.theSportsDbFailStreak += 1;
      this.theSportsDbLastError = this.errorMessage(err);
      this.theSportsDbRhythm = 'idle';
      this.logger.error(`TheSportsDB sync failed: ${this.errorMessage(err)}`);
    }
  }

  private async updateBasketballScoresFromQiumibao(
    qmbMatches: Array<{
      sourceId: string;
      league: string;
      leagueId: string;
      matchNo: string;
      homeTeam: string;
      awayTeam: string;
      kickoffTime: number;
      status: 'pre' | 'in' | 'post';
      homeScore: number | null;
      awayScore: number | null;
      periodText: string;
      period: number | null;
      stage: string;
      oddsText: string;
    }>,
  ): Promise<{
    updated: number;
    skipped: number;
    liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }>;
    finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }>;
  }> {
    if (qmbMatches.length === 0) {
      return { updated: 0, skipped: 0, liveMatches: [], finishedUpdates: [] };
    }

    let updated = 0;
    let skipped = 0;
    const liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }> = [];
    const finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }> = [];

    await this.db.transaction(async (tx) => {
      for (const m of qmbMatches) {
        const kickoffDate: Date = new Date(m.kickoffTime * 1000);
        if (Number.isNaN(kickoffDate.getTime())) {
          skipped += 1;
          continue;
        }

        let mappedStatus: string =
          m.status === 'pre'
            ? 'upcoming'
            : m.status === 'in'
              ? 'live'
              : 'finished';

        // 球美宝仅用于live比分跳动；终场权威以ESPN为准
        // 球美宝报finished时，仍保持live状态并标记qiumibao-final-pending，等待ESPN二次确认
        if (mappedStatus === 'finished') {
          mappedStatus = 'live';
        }

        // 1. Match by matchNo (官方编号, most reliable)
        let target: {
          id: string;
          matchStatus: string;
          matchNo: string;
          league: string;
          homeTeam: string;
          awayTeam: string;
          liveScoreSource: string;
          predictionDirection: string;
          handicapRecommendation: string | null;
          handicapLineNum: string | null;
          totalDirection: string | null;
          totalLineNum: string | null;
          homeScore: number | null;
          awayScore: number | null;
          lastScoreAt: Date | null;
          livePeriod: number | null;
          confidence: number | null;
          isPredictionFrozen: boolean;
          frozenHandicapRec: string | null;
          frozenTotalDirection: string | null;
          frozenPredictionDirection: string | null;
          frozenConfidence: number | null;
          frozenHandicapLine: string | number | null;
          frozenTotalLine: string | number | null;
        } | null = null;

        if (m.matchNo) {
          const beijingDateStr: string = getBeijingDateStr(kickoffDate);
          const rows = await tx
              .select({
                id: basketballMatches.id,
                matchStatus: basketballMatches.matchStatus,
                matchNo: basketballMatches.matchNo,
                league: basketballMatches.league,
                homeTeam: basketballMatches.homeTeam,
                awayTeam: basketballMatches.awayTeam,
                liveScoreSource: basketballMatches.liveScoreSource,
                predictionDirection: basketballMatches.predictionDirection,
                handicapRecommendation: basketballMatches.handicapRecommendation,
                handicapLineNum: basketballMatches.handicapLineNum,
                totalDirection: basketballMatches.totalDirection,
                totalLineNum: basketballMatches.totalLineNum,
                homeScore: basketballMatches.homeScore,
                awayScore: basketballMatches.awayScore,
                lastScoreAt: basketballMatches.lastScoreAt,
                livePeriod: basketballMatches.livePeriod,
                confidence: basketballMatches.confidence,
                isPredictionFrozen: basketballMatches.isPredictionFrozen,
                frozenHandicapRec: basketballMatches.frozenHandicapRec,
                frozenTotalDirection: basketballMatches.frozenTotalDirection,
                frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
                frozenConfidence: basketballMatches.frozenConfidence,
                frozenHandicapLine: basketballMatches.frozenHandicapLine,
                frozenTotalLine: basketballMatches.frozenTotalLine,
              })
             .from(basketballMatches)
            .where(
              and(
                eq(basketballMatches.matchNo, m.matchNo),
                gte(
                  sql`${basketballMatches.matchDate}::date`,
                  sql`${beijingDateStr}::date - interval '1 day'`,
                ),
                lt(
                  sql`${basketballMatches.matchDate}::date`,
                  sql`${beijingDateStr}::date + interval '2 days'`,
                ),
              ),
            );
          if (rows.length > 0) {
            target = rows[0];
          }
        }

        // 2. Fallback: team name + kickoff date matching
        if (!target) {
          const beijingDateStr: string = getBeijingDateStr(kickoffDate);
          const homeNorm = normalizeTeamName(m.homeTeam);
          const awayNorm = normalizeTeamName(m.awayTeam);
          const sameDay = await tx
             .select({
               id: basketballMatches.id,
               matchStatus: basketballMatches.matchStatus,
               matchNo: basketballMatches.matchNo,
               league: basketballMatches.league,
               homeTeam: basketballMatches.homeTeam,
               awayTeam: basketballMatches.awayTeam,
               kickoffTime: basketballMatches.kickoffTime,
               liveScoreSource: basketballMatches.liveScoreSource,
               predictionDirection: basketballMatches.predictionDirection,
               handicapRecommendation: basketballMatches.handicapRecommendation,
               handicapLineNum: basketballMatches.handicapLineNum,
               totalDirection: basketballMatches.totalDirection,
               totalLineNum: basketballMatches.totalLineNum,
               homeScore: basketballMatches.homeScore,
               awayScore: basketballMatches.awayScore,
               lastScoreAt: basketballMatches.lastScoreAt,
               livePeriod: basketballMatches.livePeriod,
               confidence: basketballMatches.confidence,
               isPredictionFrozen: basketballMatches.isPredictionFrozen,
               frozenHandicapRec: basketballMatches.frozenHandicapRec,
               frozenTotalDirection: basketballMatches.frozenTotalDirection,
               frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
               frozenConfidence: basketballMatches.frozenConfidence,
               frozenHandicapLine: basketballMatches.frozenHandicapLine,
               frozenTotalLine: basketballMatches.frozenTotalLine,
             })
             .from(basketballMatches)
             .where(
               and(
                 gte(
                   sql`${basketballMatches.matchDate}::date`,
                   sql`${beijingDateStr}::date - interval '1 day'`,
                ),
                lt(
                  sql`${basketballMatches.matchDate}::date`,
                  sql`${beijingDateStr}::date + interval '2 days'`,
                ),
              ),
            );
          for (const row of sameDay) {
            const rowHome = normalizeTeamName(row.homeTeam);
            const rowAway = normalizeTeamName(row.awayTeam);
            const rowKickoff = new Date(row.kickoffTime as unknown as string).getTime();
            if (Math.abs(rowKickoff - kickoffDate.getTime()) > 12 * 3600 * 1000) continue;
            if (
              (rowHome === homeNorm && rowAway === awayNorm) ||
              (rowHome.includes(homeNorm) && rowAway.includes(awayNorm) && homeNorm.length >= 2 && awayNorm.length >= 2) ||
              (homeNorm.includes(rowHome) && awayNorm.includes(rowAway) && rowHome.length >= 2 && rowAway.length >= 2)
            ) {
              target = row;
              break;
            }
          }
        }

        if (!target) {
          skipped += 1;
          continue;
        }

        // Priority: ESPN / NBL official wins. If the match already has liveScoreSource='espn' or 'nbl-official',
        // skip qiumibao update for this match (higher-priority source).
        if (target.liveScoreSource === 'espn' || target.liveScoreSource === 'nbl-official') {
          skipped += 1;
          continue;
        }

        // State machine: never roll back from finished or score_pending
        // (score_pending set by stale-live cleanup must not be pushed back to live)
        const wasFinished = target.matchStatus === 'finished';
        const wasScorePending = target.matchStatus === 'score_pending';
        if ((wasFinished || wasScorePending) && mappedStatus !== 'finished') {
          skipped += 1;
          continue;
        }

        let isDegradedFinished: boolean = false;
        // 判断球美宝主客方向与库内主客是否一致
        // 球美宝API的home/away不一定等于竞彩主客，需按队名动态匹配
        const mHomeNorm = normalizeTeamName(m.homeTeam);
        const mAwayNorm = normalizeTeamName(m.awayTeam);
        const tHomeNorm = normalizeTeamName(target.homeTeam);
        const tAwayNorm = normalizeTeamName(target.awayTeam);
        const isSameDirection = mHomeNorm === tHomeNorm && mAwayNorm === tAwayNorm;
        const isReversed = mHomeNorm === tAwayNorm && mAwayNorm === tHomeNorm;
        const needReverse = isReversed || (!isSameDirection && !isReversed);

        const srcHomeScore = m.homeScore ?? 0;
        const srcAwayScore = m.awayScore ?? 0;
        const homeScoreNum = needReverse ? srcAwayScore : srcHomeScore;
        const awayScoreNum = needReverse ? srcHomeScore : srcAwayScore;
        const totalScore = homeScoreNum + awayScoreNum;
        const scoreDiff = Math.abs(homeScoreNum - awayScoreNum);
        const scorePlausible = (
          homeScoreNum >= 20 &&
          awayScoreNum >= 20 &&
          totalScore >= 60 &&
          totalScore <= 300 &&
          scoreDiff <= 80
        );
        const scoreStable = target.homeScore === homeScoreNum && target.awayScore === awayScoreNum;
        const lastScoreMs = target.lastScoreAt ? Date.now() - target.lastScoreAt.getTime() : 0;
        const isOvertime = (m.period !== null && m.period !== undefined && m.period > 4);
        const stableWindowMin = isOvertime ? 20 : 3;
        const scoreStableWindow = scoreStable && lastScoreMs >= stableWindowMin * 60 * 1000;
        if (
          mappedStatus === 'live' &&
          m.status === 'post' &&
          target.liveScoreSource !== 'espn' &&
          scorePlausible &&
          scoreStableWindow
        ) {
          mappedStatus = 'finished';
          isDegradedFinished = true;
        }

        const updateObj: Record<string, unknown> = {
          matchStatus: mappedStatus,
          lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
          liveScoreSource: isDegradedFinished
            ? 'qiumibao-final-degraded'
            : m.status === 'post' ? 'qiumibao-final-pending' : 'qiumibao',
          updatedAt: sql`CURRENT_TIMESTAMP`,
        };

        if (mappedStatus === 'upcoming') {
          updateObj.lastScoreAt = null;
          updateObj.homeScore = null;
          updateObj.awayScore = null;
          updateObj.livePeriod = null;
          updateObj.liveClock = null;
        } else if (mappedStatus === 'live') {
          const scoreChanged = target.homeScore !== homeScoreNum || target.awayScore !== awayScoreNum;
          if (scoreChanged) updateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
          updateObj.homeScore = needReverse ? m.awayScore : m.homeScore;
          updateObj.awayScore = needReverse ? m.homeScore : m.awayScore;
          const hasSourcePeriod = m.period !== null && m.period !== undefined && m.period > 0;
          if (hasSourcePeriod) {
            updateObj.livePeriod = m.period;
            updateObj.liveClock = m.periodText || null;
            updateObj.livePeriodEstimated = false;
          } else {
            updateObj.livePeriod = null;
            updateObj.liveClock = m.periodText || null;
            updateObj.livePeriodEstimated = true;
          }
        } else {
          if (!wasFinished) {
            updateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
          }
          updateObj.homeScore = needReverse ? m.awayScore : m.homeScore;
          updateObj.awayScore = needReverse ? m.homeScore : m.awayScore;
          updateObj.liveClock = m.periodText || '终场';
          updateObj.livePeriod = m.period && m.period > 0 ? m.period : 4;
          updateObj.livePeriodEstimated = !(m.period && m.period > 0);
        }

        if (mappedStatus === 'live') {
          updateObj.hitWdw = null;
          updateObj.hitHandicap = null;
          updateObj.hitOverunder = null;
        }

        if (
          mappedStatus === 'finished' &&
          m.homeScore !== null &&
          m.awayScore !== null
        ) {
          const homeScore: number = homeScoreNum;
          const awayScore: number = awayScoreNum;
          const hits = this.computeBasketballHits(
            homeScore,
            awayScore,
            target.predictionDirection ?? target.frozenPredictionDirection as string | null,
            target.handicapLineNum ?? target.frozenHandicapLine,
            target.handicapRecommendation ?? target.frozenHandicapRec as string | null,
            target.totalLineNum ?? target.frozenTotalLine,
            target.totalDirection ?? target.frozenTotalDirection as string | null,
          );
          if (hits.hitWdw !== null) updateObj.hitWdw = hits.hitWdw;
          if (hits.hitHandicap !== undefined) updateObj.hitHandicap = hits.hitHandicap;
          if (hits.hitOverunder !== undefined) updateObj.hitOverunder = hits.hitOverunder;
        }

        if (mappedStatus !== 'upcoming' && m.homeScore !== null && m.awayScore !== null) {
          const sentinel = this.validateBasketballScoreDirection({
            homeTeam: target.homeTeam,
            awayTeam: target.awayTeam,
            homeScore: homeScoreNum,
            awayScore: awayScoreNum,
            srcHomeTeam: m.homeTeam,
            srcAwayTeam: m.awayTeam,
            srcHomeScore: m.homeScore ?? 0,
            srcAwayScore: m.awayScore ?? 0,
            source: 'qiumibao',
            matchId: target.id,
            matchNo: target.matchNo,
            prevHomeScore: target.homeScore,
            prevAwayScore: target.awayScore,
            matchStatus: mappedStatus,
            period: m.period ?? null,
          });
          if (!sentinel.valid) {
            this.logger.warn(`[SCORE-SENTINEL] qiumibao direction anomaly: ${sentinel.reason}`);
            let errorType: 'direction_mismatch' | 'score_unreasonable' | 'swing_detected' = 'direction_mismatch';
            if (sentinel.reason.startsWith('比分不合理')) errorType = 'score_unreasonable';
            else if (sentinel.reason.startsWith('分差方向突变')) errorType = 'swing_detected';
            await this.logScoreSentinelEvent({
              matchId: target.id,
              matchNo: target.matchNo,
              source: 'qiumibao',
              errorType,
              prevHomeScore: target.homeScore,
              prevAwayScore: target.awayScore,
              wrongHomeScore: homeScoreNum,
              wrongAwayScore: awayScoreNum,
              correctHomeScore: sentinel.finalHomeScore,
              correctAwayScore: sentinel.finalAwayScore,
              reason: sentinel.reason,
            });
          }
          updateObj.homeScore = sentinel.finalHomeScore;
          updateObj.awayScore = sentinel.finalAwayScore;
        }

        await tx
          .update(basketballMatches)
          .set(updateObj)
          .where(eq(basketballMatches.id, target.id));

        if (mappedStatus === 'finished' && m.homeScore !== null && m.awayScore !== null) {
          finishedUpdates.push({
            matchNo: target.matchNo,
            homeScore: homeScoreNum,
            awayScore: awayScoreNum,
            league: target.league,
          });
        } else if (mappedStatus === 'live') {
          liveMatches.push({
            matchNo: target.matchNo,
            homeScore: homeScoreNum,
            awayScore: awayScoreNum,
            league: target.league,
          });
        }
        updated += 1;
      }
    });

    return { updated, skipped, liveMatches, finishedUpdates };
  }

  /**
   * 球美宝终场超时兜底机制。
   *
   * 对于 match_status = 'finished' 或 live_score_source 处于 qiumibao-final-pending /
   * qiumibao-final-degraded 的比赛，如果 last_score_at 距今超过 120 分钟（ESPN 确认链断裂）
   * 且比分合理（两队≥60分、总分≥130、分差≤60）且命中尚未回打，则：
   *   1. 将 match_status 设为 finished，live_score_source 改为 qiumibao-final-authoritative
   *   2. 回打 hit_wdw / hit_handicap / hit_overunder
   *   3. 日志标记 qiumibao-final-authoritative
   */
  async promoteQiumibaoDegradedFinals(): Promise<{ promoted: number; total: number }> {
    const cutoffTime: Date = new Date(Date.now() - QIUMIBAO_FINAL_AUTHORITATIVE_TIMEOUT_MS);

    const rows = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        matchStatus: basketballMatches.matchStatus,
        liveScoreSource: basketballMatches.liveScoreSource,
        lastScoreAt: basketballMatches.lastScoreAt,
        predictionDirection: basketballMatches.predictionDirection,
        handicapLineNum: basketballMatches.handicapLineNum,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        totalLineNum: basketballMatches.totalLineNum,
        totalDirection: basketballMatches.totalDirection,
        hitWdw: basketballMatches.hitWdw,
        hitHandicap: basketballMatches.hitHandicap,
        hitOverunder: basketballMatches.hitOverunder,
        frozenHandicapRec: basketballMatches.frozenHandicapRec,
        frozenTotalDirection: basketballMatches.frozenTotalDirection,
        frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
        frozenHandicapLine: basketballMatches.frozenHandicapLine,
        frozenTotalLine: basketballMatches.frozenTotalLine,
      })
      .from(basketballMatches)
      .where(
        and(
          sql`${basketballMatches.liveScoreSource} IN ('qiumibao-final-pending', 'qiumibao-final-degraded')`,
          sql`${basketballMatches.homeScore} IS NOT NULL`,
          sql`${basketballMatches.awayScore} IS NOT NULL`,
          sql`${basketballMatches.lastScoreAt} IS NOT NULL`,
          lt(basketballMatches.lastScoreAt, cutoffTime),
          gte(basketballMatches.homeScore, 60),
          gte(basketballMatches.awayScore, 60),
          sql`(${basketballMatches.homeScore} + ${basketballMatches.awayScore}) >= 130`,
          sql`ABS(${basketballMatches.homeScore} - ${basketballMatches.awayScore}) <= 60`,
          isNull(basketballMatches.hitWdw),
        ),
      );

    const total: number = rows.length;
    if (total === 0) return { promoted: 0, total: 0 };

    let promoted = 0;
    await this.db.transaction(async (tx) => {
      for (const row of rows) {
        const homeScore: number = row.homeScore as number;
        const awayScore: number = row.awayScore as number;

        const hits = this.computeBasketballHits(
          homeScore,
          awayScore,
          row.predictionDirection ?? row.frozenPredictionDirection as string | null,
          row.handicapLineNum ?? row.frozenHandicapLine,
          row.handicapRecommendation ?? row.frozenHandicapRec as string | null,
          row.totalLineNum ?? row.frozenTotalLine,
          row.totalDirection ?? row.frozenTotalDirection as string | null,
        );

        const patch: Record<string, unknown> = {
          matchStatus: 'finished',
          liveScoreSource: 'qiumibao-final-authoritative',
          updatedAt: sql`CURRENT_TIMESTAMP`,
        };
        if (hits.hitWdw !== null) patch.hitWdw = hits.hitWdw;
        if (hits.hitHandicap !== undefined) patch.hitHandicap = hits.hitHandicap;
        if (hits.hitOverunder !== undefined) patch.hitOverunder = hits.hitOverunder;

        const result = await tx
          .update(basketballMatches)
          .set(patch)
          .where(eq(basketballMatches.id, row.id))
          .returning({ id: basketballMatches.id });

        if (result.length > 0) {
          promoted += 1;
          this.logger.log(
            `[QIU-DEGRADED-PROMOTE] ${row.matchNo} ${row.league} ${row.homeTeam} vs ${row.awayTeam} ` +
            `${homeScore}-${awayScore} → qiumibao-final-authoritative ` +
            `(lastScoreAt=${row.lastScoreAt}, hwd=${hits.hitWdw}, hdc=${hits.hitHandicap}, ou=${hits.hitOverunder})`,
          );
        }
      }
    });

    if (promoted > 0) {
      this.logger.log(
        `Qiumibao degraded final promotion done: promoted=${promoted}, total=${total}`,
      );
    }
    return { promoted, total };
  }

  async settleFinishedBasketballMatches(): Promise<{ settled: number; total: number }> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        predictionDirection: basketballMatches.predictionDirection,
        handicapLineNum: basketballMatches.handicapLineNum,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        totalLineNum: basketballMatches.totalLineNum,
        totalDirection: basketballMatches.totalDirection,
        matchNo: basketballMatches.matchNo,
        livePeriod: basketballMatches.livePeriod,
        isPredictionFrozen: basketballMatches.isPredictionFrozen,
        frozenHandicapRec: basketballMatches.frozenHandicapRec,
        frozenTotalDirection: basketballMatches.frozenTotalDirection,
        frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
        frozenHandicapLine: basketballMatches.frozenHandicapLine,
        frozenTotalLine: basketballMatches.frozenTotalLine,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'finished'),
          or(
            isNull(basketballMatches.hitWdw),
            isNull(basketballMatches.hitHandicap),
            isNull(basketballMatches.hitOverunder),
          ),
        ),
      );

    let settled: number = 0;
    const total: number = rows.length;

    for (const row of rows) {
      if (row.homeScore === null || row.awayScore === null) continue;
      const sentinel = this.validateBasketballScoreDirection({
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        homeScore: row.homeScore,
        awayScore: row.awayScore,
        srcHomeTeam: row.homeTeam,
        srcAwayTeam: row.awayTeam,
        srcHomeScore: row.homeScore,
        srcAwayScore: row.awayScore,
        source: 'manual',
        matchId: row.id,
        matchNo: row.matchNo,
        prevHomeScore: row.homeScore,
        prevAwayScore: row.awayScore,
        matchStatus: 'finished',
        period: row.livePeriod ?? null,
      });
      if (!sentinel.valid) {
        this.logger.warn(`[SCORE-SENTINEL] settle anomaly: ${sentinel.reason}`);
        let errorType: 'direction_mismatch' | 'score_unreasonable' | 'swing_detected' = 'score_unreasonable';
        if (sentinel.reason.startsWith('比分不合理')) errorType = 'score_unreasonable';
        else if (sentinel.reason.startsWith('分差方向突变')) errorType = 'swing_detected';
        else errorType = 'direction_mismatch';
        await this.logScoreSentinelEvent({
          matchId: row.id,
          matchNo: row.matchNo,
          source: 'manual',
          errorType,
          prevHomeScore: row.homeScore,
          prevAwayScore: row.awayScore,
          wrongHomeScore: row.homeScore,
          wrongAwayScore: row.awayScore,
          correctHomeScore: sentinel.finalHomeScore,
          correctAwayScore: sentinel.finalAwayScore,
          reason: sentinel.reason,
        });
        continue;
      }
      const hits = this.computeBasketballHits(
        row.homeScore,
        row.awayScore,
        row.predictionDirection ?? row.frozenPredictionDirection,
        row.handicapLineNum ?? row.frozenHandicapLine,
        row.handicapRecommendation ?? row.frozenHandicapRec,
        row.totalLineNum ?? row.frozenTotalLine,
        row.totalDirection ?? row.frozenTotalDirection,
      );
      await this.db
        .update(basketballMatches)
        .set({
          hitWdw: hits.hitWdw,
          hitHandicap: hits.hitHandicap,
          hitOverunder: hits.hitOverunder,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(basketballMatches.id, row.id));
      settled += 1;
    }

    return { settled, total };
  }

  private async updateFootballScoresFromQiumibao(
    qmbMatches: Array<{
      sourceId: string;
      league: string;
      leagueId: string;
      matchNo: string;
      homeTeam: string;
      awayTeam: string;
      kickoffTime: number;
      status: 'pre' | 'in' | 'post';
      homeScore: number | null;
      awayScore: number | null;
      halfHomeScore: number | null;
      halfAwayScore: number | null;
      periodText: string;
      stage: string;
      oddsText: string;
    }>,
  ): Promise<{
    updated: number;
    skipped: number;
    liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }>;
    finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }>;
  }> {
    if (qmbMatches.length === 0) {
      return { updated: 0, skipped: 0, liveMatches: [], finishedUpdates: [] };
    }

    let updated = 0;
    let skipped = 0;
    const liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }> = [];
    const finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }> = [];

    await this.db.transaction(async (tx) => {
      for (const m of qmbMatches) {
        const kickoffDate: Date = new Date(m.kickoffTime * 1000);
        if (Number.isNaN(kickoffDate.getTime())) {
          skipped += 1;
          continue;
        }

        const mappedStatus: string =
          m.status === 'pre'
            ? 'upcoming'
            : m.status === 'in'
              ? 'live'
              : 'finished';

        const targets: Array<{
          id: string;
          matchStatus: string;
          matchNo: string;
          league: string;
          homeTeam: string;
          awayTeam: string;
          liveScoreSource: string;
          predictionDirection: string;
          handicapRecommendation: string;
          handicap: string;
        }> = [];

        // 1. Match by matchNo + 当日±1天 (官方编号, 必须限定日期防止跨日错配)
        if (m.matchNo) {
          const beijingDateStr: string = getBeijingDateStr(kickoffDate);
          const rows = await tx
            .select({
              id: matches.id,
              matchStatus: matches.matchStatus,
              matchNo: matches.matchNo,
              league: matches.league,
              homeTeam: matches.homeTeam,
              awayTeam: matches.awayTeam,
              liveScoreSource: matches.liveScoreSource,
              predictionDirection: matches.predictionDirection,
              handicapRecommendation: matches.handicapRecommendation,
              handicap: matches.handicap,
            })
            .from(matches)
            .where(
              and(
                eq(matches.matchNo, m.matchNo),
                gte(matches.businessDate, sql`${beijingDateStr}::date - interval '1 day'`),
                lt(matches.businessDate, sql`${beijingDateStr}::date + interval '2 days'`),
              ),
            );
          for (const row of rows) {
            targets.push(row);
          }
        }

        // 2. Fallback: team name + kickoff date matching (收集所有匹配)
        if (targets.length === 0) {
          const beijingDateStr: string = getBeijingDateStr(kickoffDate);
          const homeNorm = normalizeTeamName(m.homeTeam);
          const awayNorm = normalizeTeamName(m.awayTeam);
          const sameDay = await tx
            .select({
              id: matches.id,
              matchStatus: matches.matchStatus,
              matchNo: matches.matchNo,
              league: matches.league,
              homeTeam: matches.homeTeam,
              awayTeam: matches.awayTeam,
              kickoffTime: matches.kickoffTime,
              liveScoreSource: matches.liveScoreSource,
              predictionDirection: matches.predictionDirection,
              handicapRecommendation: matches.handicapRecommendation,
              handicap: matches.handicap,
            })
            .from(matches)
            .where(
              and(
                gte(
                  sql`${matches.matchDate}::date`,
                  sql`${beijingDateStr}::date - interval '1 day'`,
                ),
                lt(
                  sql`${matches.matchDate}::date`,
                  sql`${beijingDateStr}::date + interval '2 days'`,
                ),
              ),
            );
          for (const row of sameDay) {
            const rowHome = normalizeTeamName(row.homeTeam);
            const rowAway = normalizeTeamName(row.awayTeam);
            const rowKickoff = new Date(row.kickoffTime as unknown as string).getTime();
            if (Math.abs(rowKickoff - kickoffDate.getTime()) > 12 * 3600 * 1000) continue;
            if (
              (rowHome === homeNorm && rowAway === awayNorm) ||
              (rowHome.includes(homeNorm) && rowAway.includes(awayNorm) && homeNorm.length >= 2 && awayNorm.length >= 2) ||
              (homeNorm.includes(rowHome) && awayNorm.includes(rowAway) && rowHome.length >= 2 && rowAway.length >= 2)
            ) {
              targets.push(row);
            }
          }
        }

        if (targets.length === 0) {
          skipped += 1;
          continue;
        }

        for (const target of targets) {
          // Priority: ESPN wins. If already covered by ESPN, skip qiumibao.
          if (target.liveScoreSource === 'espn') {
            skipped += 1;
            continue;
          }

          // State machine: never roll back from finished or score_pending (football qiumibao score sync)
          const wasFinishedFb = target.matchStatus === 'finished';
          const wasScorePendingFb = target.matchStatus === 'score_pending';
          if ((wasFinishedFb || wasScorePendingFb) && mappedStatus !== 'finished') {
            skipped += 1;
            continue;
          }
          if (target.matchStatus === 'canceled') {
            skipped += 1;
            continue;
          }

          const updateObj: Record<string, unknown> = {
            matchStatus: mappedStatus,
            lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
            liveScoreSource: 'qiumibao',
            updatedAt: sql`CURRENT_TIMESTAMP`,
          };
          if (mappedStatus === 'upcoming') {
            updateObj.lastScoreAt = null;
            updateObj.homeScore = null;
            updateObj.awayScore = null;
            updateObj.livePeriod = null;
            updateObj.liveClock = null;
          } else if (mappedStatus === 'live') {
            updateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
            updateObj.homeScore = m.homeScore;
            updateObj.awayScore = m.awayScore;
            updateObj.liveClock = m.periodText || null;
          } else {
            if (!wasFinishedFb) {
              updateObj.lastScoreAt = sql`CURRENT_TIMESTAMP`;
            }
            updateObj.homeScore = m.homeScore;
            updateObj.awayScore = m.awayScore;
            updateObj.liveClock = m.periodText || null;
          }

          if (mappedStatus === 'live') {
            updateObj.hitWdw = null;
            updateObj.hitHandicap = null;
            updateObj.hitOverunder = null;
          }

          if (
            mappedStatus === 'finished' &&
            m.homeScore !== null &&
            m.awayScore !== null
          ) {
            const homeScore: number = m.homeScore;
            const awayScore: number = m.awayScore;

            if (target.predictionDirection === '主胜') {
              updateObj.hitWdw = homeScore > awayScore;
            } else if (target.predictionDirection === '客胜') {
              updateObj.hitWdw = homeScore < awayScore;
            } else if (target.predictionDirection === '平') {
              updateObj.hitWdw = homeScore === awayScore;
            }

            const hLine: number = Number(target.handicap);
            if (!Number.isNaN(hLine) && target.handicapRecommendation) {
              const v: number = (homeScore - awayScore) + hLine;
              if (target.handicapRecommendation === '让平') {
                updateObj.hitHandicap = v === 0;
              } else if (v === 0) {
                updateObj.hitHandicap = null;
              } else if (target.handicapRecommendation === '让球主胜' || target.handicapRecommendation === '让胜') {
                updateObj.hitHandicap = v > 0;
              } else if (target.handicapRecommendation === '让球主负' || target.handicapRecommendation === '让负') {
                updateObj.hitHandicap = v < 0;
              }
            }
          }

          await tx
            .update(matches)
            .set(updateObj)
            .where(eq(matches.id, target.id));

          if (mappedStatus === 'finished' && m.homeScore !== null && m.awayScore !== null) {
            finishedUpdates.push({
              matchNo: target.matchNo,
              homeScore: m.homeScore,
              awayScore: m.awayScore,
              league: target.league,
            });
          } else if (mappedStatus === 'live') {
            liveMatches.push({
              matchNo: target.matchNo,
              homeScore: m.homeScore,
              awayScore: m.awayScore,
              league: target.league,
            });
          }
          updated += 1;
        }
      }
    });

    return { updated, skipped, liveMatches, finishedUpdates };
  }

  // --- Qiumibao schedule & odds reconciliation ---

  private async syncBasketballScheduleOddsFromQiumibao(
    qmbMatches: QiumibaoBasketballMatch[],
  ): Promise<{
    updated: number;
    skipped: number;
    unmatched: number;
  }> {
    const candidates: QiumibaoBasketballMatch[] = qmbMatches.filter(
      (m: QiumibaoBasketballMatch) =>
        m.matchNo && (m.status === 'pre' || m.status === 'in'),
    );
    if (candidates.length === 0) {
      return { updated: 0, skipped: 0, unmatched: 0 };
    }

    let updated = 0;
    let skipped = 0;
    let unmatched = 0;

    const matchNos: string[] = candidates.map((m: QiumibaoBasketballMatch) => m.matchNo);

    const existing = await this.db
      .select({
        id: basketballMatches.id,
        matchNo: basketballMatches.matchNo,
        matchStatus: basketballMatches.matchStatus,
        kickoffTime: basketballMatches.kickoffTime,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLineNum: basketballMatches.totalLineNum,
        handicapOddsHome: basketballMatches.handicapOddsHome,
        handicapOddsAway: basketballMatches.handicapOddsAway,
        totalOddsOver: basketballMatches.totalOddsOver,
        totalOddsUnder: basketballMatches.totalOddsUnder,
        source: basketballMatches.source,
        oddsMovements: basketballMatches.oddsMovements,
      })
      .from(basketballMatches)
      .where(inArray(basketballMatches.matchNo, matchNos));

    const byMatchNo: Map<string, typeof existing[number]> = new Map();
    for (const row of existing) {
      byMatchNo.set(row.matchNo, row);
    }

    for (const m of candidates) {
      const target = byMatchNo.get(m.matchNo);
      if (!target) {
        unmatched += 1;
        continue;
      }

      // Status mapping: pre→upcoming, in→live, post→finished (post already filtered out)
      const mappedStatus: string = m.status === 'in' ? 'live' : 'upcoming';

      // Never roll back from finished
      if (target.matchStatus === 'finished') {
        skipped += 1;
        continue;
      }

      const nowIso: string = new Date().toISOString();
      const patch: Record<string, unknown> = {};
      const movements: Array<{ time: string; type: string; oldValue: string; newValue: string }> =
        Array.isArray(target.oddsMovements) ? [...target.oddsMovements] : [];
      let oddsChanged = false;

      // --- kickoffTime ---
      const newKickoff: Date = new Date(m.kickoffTime * 1000);
      const oldKickoff: Date = new Date(target.kickoffTime);
      if (Math.abs(newKickoff.getTime() - oldKickoff.getTime()) >= 1000) {
        patch.kickoffTime = newKickoff;
        movements.unshift({
          time: nowIso,
          type: 'schedule',
          oldValue: oldKickoff.toISOString(),
          newValue: newKickoff.toISOString(),
        });
      }

      // --- matchStatus ---
      if (target.matchStatus !== mappedStatus) {
        patch.matchStatus = mappedStatus;
        movements.unshift({
          time: nowIso,
          type: 'status',
          oldValue: String(target.matchStatus),
          newValue: mappedStatus,
        });
      }

      const isOfficialRecord = target.source === 'sporttery';

      if (!isOfficialRecord) {
        // --- handicap line ---
        // 仅在非官方记录（第三方源自建占位）时写入指数线
        // 官方记录（source=sporttery）的指数线受保护，第三方源不得覆盖
        const newHandicapLine: string = m.handicapLine.trim();
      const oldHandicapLine: string = target.handicapLineNum != null ? String(target.handicapLineNum).trim() : '';
      if (newHandicapLine && newHandicapLine !== oldHandicapLine) {
        patch.handicapLineNum = Number(newHandicapLine);
        oddsChanged = true;
        movements.unshift({
          time: nowIso,
          type: 'handicap',
          oldValue: oldHandicapLine,
          newValue: newHandicapLine,
        });
      }

      // --- total line ---
      const newTotalLine: string = m.totalLine.trim();
      const oldTotalLine: string = target.totalLineNum != null ? String(target.totalLineNum).trim() : '';
      if (newTotalLine && newTotalLine !== oldTotalLine) {
        patch.totalLineNum = Number(newTotalLine);
        oddsChanged = true;
        movements.unshift({
          time: nowIso,
          type: 'total',
          oldValue: oldTotalLine,
          newValue: newTotalLine,
        });
      }

      // --- handicap odds home ---
      const newHho: number | null = m.handicapHomeOdds;
      const oldHhoNum: number | null =
        target.handicapOddsHome != null ? Number(target.handicapOddsHome) : null;
      if (newHho !== null && oldHhoNum === null) {
        patch.handicapOddsHome = newHho;
        oddsChanged = true;
      } else if (newHho !== null && oldHhoNum !== null && Math.abs(newHho - oldHhoNum) > 1e-9) {
        patch.handicapOddsHome = newHho;
        oddsChanged = true;
      }

      // --- handicap odds away ---
      const newHao: number | null = m.handicapAwayOdds;
      const oldHaoNum: number | null =
        target.handicapOddsAway != null ? Number(target.handicapOddsAway) : null;
      if (newHao !== null && oldHaoNum === null) {
        patch.handicapOddsAway = newHao;
        oddsChanged = true;
      } else if (newHao !== null && oldHaoNum !== null && Math.abs(newHao - oldHaoNum) > 1e-9) {
        patch.handicapOddsAway = newHao;
        oddsChanged = true;
      }

      // --- total odds over ---
      const newToo: number | null = m.totalOverOdds;
      const oldTooNum: number | null =
        target.totalOddsOver != null ? Number(target.totalOddsOver) : null;
      if (newToo !== null && oldTooNum === null) {
        patch.totalOddsOver = newToo;
        oddsChanged = true;
      } else if (newToo !== null && oldTooNum !== null && Math.abs(newToo - oldTooNum) > 1e-9) {
        patch.totalOddsOver = newToo;
        oddsChanged = true;
      }

      // --- total odds under ---
      const newTuo: number | null = m.totalUnderOdds;
      const oldTuoNum: number | null =
        target.totalOddsUnder != null ? Number(target.totalOddsUnder) : null;
      if (newTuo !== null && oldTuoNum === null) {
        patch.totalOddsUnder = newTuo;
        oddsChanged = true;
      } else if (newTuo !== null && oldTuoNum !== null && Math.abs(newTuo - oldTuoNum) > 1e-9) {
        patch.totalOddsUnder = newTuo;
        oddsChanged = true;
      }

      }

      if (Object.keys(patch).length === 0) {
        if (mappedStatus === 'live' || mappedStatus === 'upcoming') {
          await this.db
            .update(basketballMatches)
            .set({
              lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
              updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(basketballMatches.id, target.id));
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      // Always push lastDataSyncAt on any change
      patch.lastDataSyncAt = sql`CURRENT_TIMESTAMP`;
      patch.updatedAt = sql`CURRENT_TIMESTAMP`;

      if (oddsChanged) {
        patch.lastOddsUpdateAt = sql`CURRENT_TIMESTAMP`;
        // Cap movements at 10 (newest first)
        const trimmed = movements.slice(0, 10);
        patch.oddsMovements = trimmed;
      } else if (movements.length > 0) {
        // schedule/status changes still add a movement entry
        const trimmed = movements.slice(0, 10);
        patch.oddsMovements = trimmed;
      }

      await this.db
        .update(basketballMatches)
        .set(patch)
        .where(eq(basketballMatches.id, target.id));

      // --- Write basketball odds snapshots if odds changed ---
      const sourceStr = 'qiumibao';
      // handicap
      if (patch.handicapOddsHome !== undefined || patch.handicapOddsAway !== undefined || patch.handicapLineNum !== undefined) {
        const hh = m.handicapHomeOdds ?? null;
        const ha = m.handicapAwayOdds ?? null;
        const hLine = m.handicapLine ? Number(m.handicapLine) : undefined;
        if ((hh != null && hh > 0) || (ha != null && ha > 0) || hLine !== undefined) {
          await insertBasketballOddsSnapshotIfChanged(
            this.db, target.id, 'handicap',
            {
              home: hh && hh > 0 ? hh : undefined,
              away: ha && ha > 0 ? ha : undefined,
              line: hLine,
            },
            sourceStr,
          );
        }
      }
      // total
      if (patch.totalOddsOver !== undefined || patch.totalOddsUnder !== undefined || patch.totalLineNum !== undefined) {
        const to = m.totalOverOdds ?? null;
        const tu = m.totalUnderOdds ?? null;
        const tLine = m.totalLine ? Number(m.totalLine) : undefined;
        if ((to != null && to > 0) || (tu != null && tu > 0) || tLine !== undefined) {
          await insertBasketballOddsSnapshotIfChanged(
            this.db, target.id, 'total',
            {
              over: to && to > 0 ? to : undefined,
              under: tu && tu > 0 ? tu : undefined,
              line: tLine,
            },
            sourceStr,
          );
        }
      }

      updated += 1;
    }

    return { updated, skipped, unmatched };
  }

  private normalizeQiumibaoFootball(
    qmbMatches: QiumibaoFootballMatch[],
  ): NormalizedFootballMatch[] {
    const results: NormalizedFootballMatch[] = [];
    for (const m of qmbMatches) {
      const kickoffDate = new Date(m.kickoffTime * 1000);
      const matchDateStr = getBeijingDateStr(kickoffDate);
      const hasRealMatchNo = !!m.matchNo;
      const matchNo = hasRealMatchNo
        ? m.matchNo
        : `QMB-${m.sourceId || `${m.leagueId}-${m.homeTeam}-${m.awayTeam}`}`.slice(0, 32);
      const businessDateStr = hasRealMatchNo
        ? computeBusinessDateFromMatchNo(matchNo, matchDateStr)
        : matchDateStr;

      const handicapRec =
        m.handicapHomeOdds !== null && m.handicapAwayOdds !== null
          ? m.handicapHomeOdds < m.handicapAwayOdds
            ? '主胜'
            : '客胜'
          : '';

      results.push({
        matchNo,
        matchDate: matchDateStr,
        businessDate: businessDateStr,
        league: m.league || '未知联赛',
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffTime: kickoffDate.toISOString(),
        matchStatus: m.status === 'in' ? 'live' : m.status === 'post' ? 'finished' : 'upcoming',
        oddsOpenHome: m.winHomeOdds !== null ? String(m.winHomeOdds) : '0',
        oddsOpenDraw: m.winDrawOdds !== null ? String(m.winDrawOdds) : '0',
        oddsOpenAway: m.winAwayOdds !== null ? String(m.winAwayOdds) : '0',
        handicap: m.handicapLine || '0',
        handicapRecommendation: handicapRec,
        handicapOddsHome: m.handicapHomeOdds !== null ? String(m.handicapHomeOdds) : '',
        handicapOddsDraw: m.handicapDrawOdds !== null ? String(m.handicapDrawOdds) : '',
        handicapOddsAway: m.handicapAwayOdds !== null ? String(m.handicapAwayOdds) : '',
        overUnder: m.totalLine || '2.5',
        totalGoals: m.totalLine || '2.5',
        totalOddsOver: m.totalOverOdds !== null ? String(m.totalOverOdds) : '',
        totalOddsUnder: m.totalUnderOdds !== null ? String(m.totalUnderOdds) : '',
        source: 'qiumibao',
        sourceMatchId: m.sourceId,
      });
    }
    return results;
  }

  private normalizeQiumibaoBasketball(
    qmbMatches: QiumibaoBasketballMatch[],
  ): NormalizedBasketballMatch[] {
    const results: NormalizedBasketballMatch[] = [];
    for (const m of qmbMatches) {
      const kickoffDate = new Date(m.kickoffTime * 1000);
      const matchDateStr = getBeijingDateStr(kickoffDate);
      const hasRealMatchNo = !!m.matchNo;
      const matchNo = hasRealMatchNo
        ? m.matchNo
        : `QMB-${m.sourceId || `${m.leagueId}-${m.homeTeam}-${m.awayTeam}`}`.slice(0, 32);
      const businessDateStr = hasRealMatchNo
        ? computeBusinessDateFromMatchNo(matchNo, matchDateStr)
        : matchDateStr;
      results.push({
        matchNo,
        matchDate: matchDateStr,
        businessDate: businessDateStr,
        league: m.league || '未知联赛',
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffTime: kickoffDate.toISOString(),
        matchStatus: m.status === 'in' ? 'live' : m.status === 'post' ? 'finished' : 'upcoming',
        handicap: m.handicapLine != null && String(m.handicapLine).trim() !== ''
          ? String(m.handicapLine)
          : '0',
         handicapHf: '0',
         handicapAf: '0',
         totalLine: m.totalLine || '',
         homeWinOdds: m.winHomeOdds !== null ? String(m.winHomeOdds) : '0',
         awayWinOdds: m.winAwayOdds !== null ? String(m.winAwayOdds) : '0',
         handicapOddsHome: m.handicapHomeOdds !== null ? String(m.handicapHomeOdds) : '0',
         handicapOddsAway: m.handicapAwayOdds !== null ? String(m.handicapAwayOdds) : '0',
        totalOddsOver: m.totalOverOdds !== null ? String(m.totalOverOdds) : '0',
        totalOddsUnder: m.totalUnderOdds !== null ? String(m.totalUnderOdds) : '0',
        source: 'qiumibao',
        sourceMatchId: m.sourceId,
      });
    }
    return results;
  }

  private async syncFootballScheduleOddsFromQiumibao(
    qmbMatches: QiumibaoFootballMatch[],
  ): Promise<{
    updated: number;
    skipped: number;
    unmatched: number;
  }> {
    const candidates: QiumibaoFootballMatch[] = qmbMatches.filter(
      (m: QiumibaoFootballMatch) =>
        m.matchNo && (m.status === 'pre' || m.status === 'in'),
    );
    if (candidates.length === 0) {
      return { updated: 0, skipped: 0, unmatched: 0 };
    }

    let updated = 0;
    let skipped = 0;
    let unmatched = 0;

    const matchNos: string[] = candidates.map((m: QiumibaoFootballMatch) => m.matchNo);

    const existing = await this.db
      .select({
        id: matches.id,
        matchNo: matches.matchNo,
        matchStatus: matches.matchStatus,
        kickoffTime: matches.kickoffTime,
        handicap: matches.handicap,
        overUnder: matches.overUnder,
        source: matches.source,
        oddsLiveHome: matches.oddsLiveHome,
        oddsLiveDraw: matches.oddsLiveDraw,
        oddsLiveAway: matches.oddsLiveAway,
        oddsMovements: matches.oddsMovements,
      })
      .from(matches)
      .where(inArray(matches.matchNo, matchNos));

    const byMatchNo: Map<string, typeof existing[number]> = new Map();
    for (const row of existing) {
      byMatchNo.set(row.matchNo, row);
    }

    for (const m of candidates) {
      const target = byMatchNo.get(m.matchNo);
      if (!target) {
        unmatched += 1;
        continue;
      }

      const mappedStatus: string = m.status === 'in' ? 'live' : 'upcoming';

      if (target.matchStatus === 'finished') {
        skipped += 1;
        continue;
      }

      const nowIso: string = new Date().toISOString();
      const patch: Record<string, unknown> = {};
      const movements: Array<{ time: string; type: string; oldValue: string; newValue: string }> =
        Array.isArray(target.oddsMovements) ? [...target.oddsMovements] : [];
      let oddsChanged = false;

      const isOfficialRecord = target.source === 'sporttery';

      // --- kickoffTime ---
      const newKickoff: Date = new Date(m.kickoffTime * 1000);
      const oldKickoff: Date = new Date(target.kickoffTime);
      if (Math.abs(newKickoff.getTime() - oldKickoff.getTime()) >= 1000) {
        patch.kickoffTime = newKickoff;
        movements.unshift({
          time: nowIso,
          type: 'schedule',
          oldValue: oldKickoff.toISOString(),
          newValue: newKickoff.toISOString(),
        });
      }

      // --- matchStatus ---
      if (target.matchStatus !== mappedStatus) {
        patch.matchStatus = mappedStatus;
        movements.unshift({
          time: nowIso,
          type: 'status',
          oldValue: String(target.matchStatus),
          newValue: mappedStatus,
        });
      }

      if (!isOfficialRecord) {
        // --- handicap line (varchar) ---
        // 仅在非官方记录（第三方源自建占位）时写入指数线
        // 官方记录（source=sporttery）的指数线受保护，第三方源不得覆盖
        const newHandicap: string = m.handicapLine.trim();
      const oldHandicap: string = String(target.handicap ?? '').trim();
      if (newHandicap && newHandicap !== oldHandicap) {
        patch.handicap = newHandicap;
        oddsChanged = true;
        movements.unshift({
          time: nowIso,
          type: 'handicap',
          oldValue: oldHandicap,
          newValue: newHandicap,
        });
      }

      // --- overUnder line (varchar) ---
      const newOu: string = m.totalLine.trim();
      const oldOu: string = String(target.overUnder ?? '').trim();
      if (newOu && newOu !== oldOu) {
        patch.overUnder = newOu;
        oddsChanged = true;
        movements.unshift({
          time: nowIso,
          type: 'total',
          oldValue: oldOu,
          newValue: newOu,
        });
      }

      // --- oddsLiveHome ---
      const newH: number | null = m.winHomeOdds;
      const oldHNum: number | null =
        target.oddsLiveHome != null ? Number(target.oddsLiveHome) : null;
      if (newH !== null && oldHNum === null) {
        patch.oddsLiveHome = newH;
        oddsChanged = true;
      } else if (newH !== null && oldHNum !== null && Math.abs(newH - oldHNum) > 1e-9) {
        patch.oddsLiveHome = newH;
        oddsChanged = true;
      }

      // --- oddsLiveDraw ---
      const newD: number | null = m.winDrawOdds;
      const oldDNum: number | null =
        target.oddsLiveDraw != null ? Number(target.oddsLiveDraw) : null;
      if (newD !== null && oldDNum === null) {
        patch.oddsLiveDraw = newD;
        oddsChanged = true;
      } else if (newD !== null && oldDNum !== null && Math.abs(newD - oldDNum) > 1e-9) {
        patch.oddsLiveDraw = newD;
        oddsChanged = true;
      }

      // --- oddsLiveAway ---
      const newA: number | null = m.winAwayOdds;
      const oldANum: number | null =
        target.oddsLiveAway != null ? Number(target.oddsLiveAway) : null;
      if (newA !== null && oldANum === null) {
        patch.oddsLiveAway = newA;
        oddsChanged = true;
      } else if (newA !== null && oldANum !== null && Math.abs(newA - oldANum) > 1e-9) {
        patch.oddsLiveAway = newA;
        oddsChanged = true;
      }

      }

      if (Object.keys(patch).length === 0) {
        if (mappedStatus === 'live' || mappedStatus === 'upcoming') {
          await this.db
            .update(matches)
            .set({
              lastDataSyncAt: sql`CURRENT_TIMESTAMP`,
              updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(matches.id, target.id));
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      patch.lastDataSyncAt = sql`CURRENT_TIMESTAMP`;
      patch.updatedAt = sql`CURRENT_TIMESTAMP`;

      if (oddsChanged) {
        patch.lastOddsUpdateAt = sql`CURRENT_TIMESTAMP`;
        const trimmed = movements.slice(0, 10);
        patch.oddsMovements = trimmed;
      } else if (movements.length > 0) {
        const trimmed = movements.slice(0, 10);
        patch.oddsMovements = trimmed;
      }

      await this.db
        .update(matches)
        .set(patch)
        .where(eq(matches.id, target.id));

      // --- Write odds snapshots if odds changed ---
      const sourceStr = 'qiumibao';
      if (patch.oddsLiveHome !== undefined || patch.oddsLiveDraw !== undefined || patch.oddsLiveAway !== undefined) {
        const snapHome = m.winHomeOdds ?? null;
        const snapDraw = m.winDrawOdds ?? null;
        const snapAway = m.winAwayOdds ?? null;
        if ((snapHome != null && snapHome > 0) || (snapDraw != null && snapDraw > 0) || (snapAway != null && snapAway > 0)) {
          await insertFootballOddsSnapshotIfChanged(
            this.db, target.id, '1x2',
            {
              home: snapHome && snapHome > 0 ? snapHome : undefined,
              draw: snapDraw && snapDraw > 0 ? snapDraw : undefined,
              away: snapAway && snapAway > 0 ? snapAway : undefined,
            },
            sourceStr,
          );
        }
      }
      if (patch.handicapOddsHome !== undefined || patch.handicapOddsDraw !== undefined || patch.handicapOddsAway !== undefined || patch.handicap !== undefined) {
        const snapHcpH = m.handicapHomeOdds ?? null;
        const snapHcpD = m.handicapDrawOdds ?? null;
        const snapHcpA = m.handicapAwayOdds ?? null;
        const snapHcpLine = m.handicapLine ? Number(m.handicapLine) : undefined;
        if ((snapHcpH != null && snapHcpH > 0) || (snapHcpD != null && snapHcpD > 0) || (snapHcpA != null && snapHcpA > 0)) {
          await insertFootballOddsSnapshotIfChanged(
            this.db, target.id, 'handicap',
            {
              home: snapHcpH && snapHcpH > 0 ? snapHcpH : undefined,
              draw: snapHcpD && snapHcpD > 0 ? snapHcpD : undefined,
              away: snapHcpA && snapHcpA > 0 ? snapHcpA : undefined,
              line: snapHcpLine,
            },
            sourceStr,
          );
        }
      }
      if (patch.totalOddsOver !== undefined || patch.totalOddsUnder !== undefined || patch.overUnder !== undefined) {
        const snapOver = m.totalOverOdds ?? null;
        const snapUnder = m.totalUnderOdds ?? null;
        const snapTotalLine = m.totalLine ? Number(m.totalLine) : undefined;
        if ((snapOver != null && snapOver > 0) || (snapUnder != null && snapUnder > 0)) {
          await insertFootballOddsSnapshotIfChanged(
            this.db, target.id, 'total',
            {
              over: snapOver && snapOver > 0 ? snapOver : undefined,
              under: snapUnder && snapUnder > 0 ? snapUnder : undefined,
              line: snapTotalLine,
            },
            sourceStr,
          );
        }
      }

      updated += 1;
    }

    return { updated, skipped, unmatched };
  }

  // --- The Odds API sync ---

  private async runOddsApiSync(): Promise<void> {
    if (!this.oddsSource.isEnabled()) {
      this.oddsApiLastSync = new Date();
      this.oddsApiSuccess = true;
      this.oddsApiSportsSynced = 0;
      return;
    }

    // Determine rhythm from current day match status
    const [fbStatus, bbStatus] = await Promise.all([
      this.getDayMatchStatus('football'),
      this.getDayMatchStatus('basketball'),
    ]);
    const fbHasPreMatch = await this.hasUpcomingWithinHours('football', 3);
    const bbHasPreMatch = await this.hasUpcomingWithinHours('basketball', 3);
    const anyMatchToday = fbStatus.total > 0 || bbStatus.total > 0;

    let rhythm: OddsApiRhythm;
    if (fbHasPreMatch || bbHasPreMatch) {
      rhythm = 'pre-match';
    } else if (anyMatchToday) {
      rhythm = 'daily';
    } else {
      rhythm = 'idle';
    }
    this.oddsApiRhythm = rhythm;

    // Determine minimum interval based on rhythm + quota throttle
    let minInterval =
      rhythm === 'pre-match'
        ? ODDS_PRE_MATCH_INTERVAL_MS
        : rhythm === 'daily'
          ? ODDS_DAILY_INTERVAL_MS
          : ODDS_IDLE_INTERVAL_MS;
    if (this.oddsApiQuotaThrottled) {
      minInterval *= 2;
    }

    const now = Date.now();
    const lastActual = this.oddsApiLastActualRun;
    if (lastActual && now - lastActual.getTime() < minInterval) {
      // Skip this cycle — too soon since last actual request
      this.logger.verbose(
        `Odds API sync skipped (rhythm=${rhythm}, throttled=${this.oddsApiQuotaThrottled}, lastRun=${lastActual.toISOString()})`,
      );
      return;
    }

    let sportsSynced = 0;
    let ok = true;
    let remaining: number | null = null;
    let used: number | null = null;
    let lastStatusCode: number = 0;
    let statusMessage: string = '';

    // Basketball: WNBA odds
    const wnbaResp = await this.oddsSource.fetchBasketballOdds(
      'basketball_wnba',
    );
    if (wnbaResp.remaining !== null) remaining = wnbaResp.remaining;
    if (wnbaResp.used !== null) used = wnbaResp.used;
    lastStatusCode = wnbaResp.statusCode;
    if (wnbaResp.statusCode >= 200 && wnbaResp.statusCode < 300) {
      const { updated, skipped } = await this.updateBasketballOddsFromApi(
        wnbaResp.data,
        'WNBA',
      );
      sportsSynced += 1;
      this.logger.log(
        `Odds API WNBA sync: ${wnbaResp.data.length} games, updated=${updated}, skipped=${skipped}`,
      );
    } else {
      ok = false;
      this.logger.error(
        `Odds API WNBA sync failed: ${wnbaResp.statusCode} ${wnbaResp.errorMessage ?? ''}`,
      );
    }

    // Basketball: NBA odds
    const nbaResp = await this.oddsSource.fetchBasketballOdds(
      'basketball_nba',
    );
    if (nbaResp.remaining !== null) remaining = nbaResp.remaining;
    if (nbaResp.used !== null) used = nbaResp.used;
    if (nbaResp.statusCode !== 200) lastStatusCode = nbaResp.statusCode;
    if (nbaResp.statusCode >= 200 && nbaResp.statusCode < 300) {
      const { updated, skipped } = await this.updateBasketballOddsFromApi(
        nbaResp.data,
        'NBA',
      );
      sportsSynced += 1;
      const excluded = nbaResp.excludedMarkets?.join(',') ?? 'none';
      this.logger.log(
        `Odds API NBA sync: ${nbaResp.data.length} games, updated=${updated}, skipped=${skipped}, excludedMarkets=${excluded}`,
      );
    } else {
      ok = false;
      this.logger.error(
        `Odds API NBA sync failed: ${nbaResp.statusCode} ${nbaResp.errorMessage ?? ''}`,
      );
    }

    // Football: EPL only (free quota is limited)
    const eplResp = await this.oddsSource.fetchFootballOdds(
      'soccer_epl',
    );
    if (eplResp.remaining !== null) remaining = eplResp.remaining;
    if (eplResp.used !== null) used = eplResp.used;
    if (eplResp.statusCode !== 200) lastStatusCode = eplResp.statusCode;
    if (eplResp.statusCode >= 200 && eplResp.statusCode < 300) {
      const { updated, skipped } = await this.updateFootballOddsFromApi(
        eplResp.data,
        '英超',
      );
      sportsSynced += 1;
      this.logger.log(
        `Odds API EPL sync: ${eplResp.data.length} games, updated=${updated}, skipped=${skipped}`,
      );
    } else {
      ok = false;
      this.logger.error(
        `Odds API EPL sync failed: ${eplResp.statusCode} ${eplResp.errorMessage ?? ''}`,
      );
    }

    // --- Status message logic ---
    const quotaExhausted = lastStatusCode === 429 || remaining === 0 || (remaining !== null && remaining <= 5);
    if (quotaExhausted) {
       statusMessage = '指数额度用尽，指数以球美宝/官方数据源为准';
     } else if (!ok) {
       statusMessage = '指数源不可用，指数以球美宝/官方数据源为准';
     } else if (ok && remaining !== null && remaining < 100) {
       statusMessage = '指数源配额紧张，指数以球美宝/官方数据源为准';
    } else {
      statusMessage = '';
    }

    this.oddsApiLastSync = new Date();
    this.oddsApiLastActualRun = new Date();
    this.oddsApiSuccess = ok || quotaExhausted;
    this.oddsApiSportsSynced = sportsSynced;
    this.oddsApiTodayCount += 1;
    this.oddsApiRemaining = remaining;
    this.oddsApiUsed = used;
    this.oddsApiStatusCode = lastStatusCode === 0 ? null : lastStatusCode;
    this.oddsApiStatusMessage = statusMessage;

    if (remaining !== null) {
      this.oddsApiQuotaThrottled = this.isOddsQuotaThrottled(remaining);
      if (this.oddsApiQuotaThrottled) {
        this.logger.warn(
          `Odds API quota low: remaining=${remaining}, throttling to 2x interval`,
        );
      }
    }
  }

  private async updateFootballOddsFromApi(
    oddsList: OddsData[],
    leagueName: string,
  ): Promise<{ updated: number; skipped: number }> {
    if (oddsList.length === 0) return { updated: 0, skipped: 0 };

    let updated = 0;
    let skipped = 0;

    await this.db.transaction(async (tx) => {
      for (const odd of oddsList) {
        const commenceDate: Date = new Date(odd.commenceTime);
        if (Number.isNaN(commenceDate.getTime())) {
          skipped += 1;
          continue;
        }
        const matchDateStr: string = commenceDate.toISOString().slice(0, 10);

        // The Odds API returns English team names; match via our stored teams
        // We try direct match first; mapping is handled at the caller level if needed.
        // Here we use homeTeam/awayTeam as-is (English) and try to match.
        // If no match, skip silently (odds update only, no new records).
        const existing = await tx
          .select({
            id: matches.id,
            matchStatus: matches.matchStatus,
          })
          .from(matches)
          .where(
            and(
              eq(matches.matchDate, matchDateStr),
              eq(matches.league, leagueName),
              eq(matches.homeTeam, odd.homeTeam),
              eq(matches.awayTeam, odd.awayTeam),
            ),
          )
          .limit(1);

        if (existing.length === 0) {
          skipped += 1;
          continue;
        }

        const row = existing[0];
        if (row.matchStatus === 'finished') {
          skipped += 1;
          continue;
        }

        // Only update odds fields; never touch intel/model/prediction
        const updateSet: Record<string, unknown> = {
          updatedAt: sql`CURRENT_TIMESTAMP`,
        };
        if (odd.h2h.home !== null) updateSet.oddsLiveHome = String(odd.h2h.home);
        if (odd.h2h.draw !== null) updateSet.oddsLiveDraw = String(odd.h2h.draw);
        if (odd.h2h.away !== null) updateSet.oddsLiveAway = String(odd.h2h.away);
        if (odd.spreads.point !== null) updateSet.handicap = String(odd.spreads.point);
        if (odd.totals.point !== null) updateSet.overUnder = String(odd.totals.point);

        await tx
          .update(matches)
          .set(updateSet)
          .where(eq(matches.id, row.id));

        // --- Write odds snapshots ---
        const sourceStr = 'the-odds-api';
        // 1x2
        if (odd.h2h.home !== null || odd.h2h.draw !== null || odd.h2h.away !== null) {
          const h = odd.h2h.home != null && odd.h2h.home > 0 ? odd.h2h.home : undefined;
          const d = odd.h2h.draw != null && odd.h2h.draw > 0 ? odd.h2h.draw : undefined;
          const a = odd.h2h.away != null && odd.h2h.away > 0 ? odd.h2h.away : undefined;
          if (h !== undefined || d !== undefined || a !== undefined) {
            await insertFootballOddsSnapshotIfChanged(
              this.db, row.id, '1x2',
              { home: h, draw: d, away: a },
              sourceStr,
            );
          }
        }
        // handicap (spreads)
        if (odd.spreads.point !== null || odd.spreads.home !== null || odd.spreads.away !== null) {
          const sh = odd.spreads.home != null && odd.spreads.home > 0 ? odd.spreads.home : undefined;
          const sa = odd.spreads.away != null && odd.spreads.away > 0 ? odd.spreads.away : undefined;
          const line = odd.spreads.point != null ? Number(odd.spreads.point) : undefined;
          if (sh !== undefined || sa !== undefined || line !== undefined) {
            await insertFootballOddsSnapshotIfChanged(
              this.db, row.id, 'handicap',
              { home: sh, away: sa, line },
              sourceStr,
            );
          }
        }
        // total (totals)
        if (odd.totals.point !== null || odd.totals.over !== null || odd.totals.under !== null) {
          const to = odd.totals.over != null && odd.totals.over > 0 ? odd.totals.over : undefined;
          const tu = odd.totals.under != null && odd.totals.under > 0 ? odd.totals.under : undefined;
          const line = odd.totals.point != null ? Number(odd.totals.point) : undefined;
          if (to !== undefined || tu !== undefined || line !== undefined) {
            await insertFootballOddsSnapshotIfChanged(
              this.db, row.id, 'total',
              { over: to, under: tu, line },
              sourceStr,
            );
          }
        }

        updated += 1;
      }
    });

    return { updated, skipped };
  }

  private async updateBasketballOddsFromApi(
    oddsList: OddsData[],
    leagueName: string,
  ): Promise<{ updated: number; skipped: number }> {
    if (oddsList.length === 0) return { updated: 0, skipped: 0 };

    let updated = 0;
    let skipped = 0;

    await this.db.transaction(async (tx) => {
      for (const odd of oddsList) {
        const commenceDate: Date = new Date(odd.commenceTime);
        if (Number.isNaN(commenceDate.getTime())) {
          skipped += 1;
          continue;
        }
        const matchDateStr: string = commenceDate.toISOString().slice(0, 10);
        const homeCn = mapBasketballTeam(odd.homeTeam);
        const awayCn = mapBasketballTeam(odd.awayTeam);

         const existing = await tx
           .select({
             id: basketballMatches.id,
             matchStatus: basketballMatches.matchStatus,
           })
           .from(basketballMatches)
           .where(
             and(
               eq(basketballMatches.matchDate, matchDateStr),
               eq(basketballMatches.league, leagueName),
               eq(basketballMatches.homeTeam, homeCn),
               eq(basketballMatches.awayTeam, awayCn),
               ne(basketballMatches.source, 'sporttery'),
             ),
           )
           .limit(1);

        if (existing.length === 0) {
          skipped += 1;
          continue;
        }

        const row = existing[0];
        if (row.matchStatus === 'finished') {
          skipped += 1;
          continue;
        }

        const updateSet: Record<string, unknown> = {
          updatedAt: sql`CURRENT_TIMESTAMP`,
          dataUpdatedAt: sql`CURRENT_TIMESTAMP`,
        };
        if (odd.h2h.home !== null) updateSet.homeWinOdds = String(odd.h2h.home);
        if (odd.h2h.away !== null) updateSet.awayWinOdds = String(odd.h2h.away);
        if (odd.spreads.home !== null) updateSet.handicapOddsHome = String(odd.spreads.home);
        if (odd.spreads.away !== null) updateSet.handicapOddsAway = String(odd.spreads.away);
        if (odd.spreads.point !== null) {
          updateSet.handicap = String(odd.spreads.point);
          updateSet.handicapLineNum = String(odd.spreads.point);
        }
        if (odd.totals.over !== null) updateSet.totalOddsOver = String(odd.totals.over);
        if (odd.totals.under !== null) updateSet.totalOddsUnder = String(odd.totals.under);
        if (odd.totals.point !== null) {
          updateSet.totalLine = String(odd.totals.point);
          updateSet.totalLineNum = String(odd.totals.point);
        }

        await tx
          .update(basketballMatches)
          .set(updateSet)
          .where(eq(basketballMatches.id, row.id));

        // --- Write basketball odds snapshots ---
        const sourceStr = 'the-odds-api';
        // h2h
        if (odd.h2h.home !== null || odd.h2h.away !== null) {
          const h = odd.h2h.home != null && odd.h2h.home > 0 ? odd.h2h.home : undefined;
          const a = odd.h2h.away != null && odd.h2h.away > 0 ? odd.h2h.away : undefined;
          if (h !== undefined || a !== undefined) {
            await insertBasketballOddsSnapshotIfChanged(
              this.db, row.id, 'h2h',
              { home: h, away: a },
              sourceStr,
            );
          }
        }
        // handicap (spreads)
        if (odd.spreads.point !== null || odd.spreads.home !== null || odd.spreads.away !== null) {
          const sh = odd.spreads.home != null && odd.spreads.home > 0 ? odd.spreads.home : undefined;
          const sa = odd.spreads.away != null && odd.spreads.away > 0 ? odd.spreads.away : undefined;
          const line = odd.spreads.point != null ? Number(odd.spreads.point) : undefined;
          if (sh !== undefined || sa !== undefined || line !== undefined) {
            await insertBasketballOddsSnapshotIfChanged(
              this.db, row.id, 'handicap',
              { home: sh, away: sa, line },
              sourceStr,
            );
          }
        }
        // total (totals)
        if (odd.totals.point !== null || odd.totals.over !== null || odd.totals.under !== null) {
          const to = odd.totals.over != null && odd.totals.over > 0 ? odd.totals.over : undefined;
          const tu = odd.totals.under != null && odd.totals.under > 0 ? odd.totals.under : undefined;
          const line = odd.totals.point != null ? Number(odd.totals.point) : undefined;
          if (to !== undefined || tu !== undefined || line !== undefined) {
            await insertBasketballOddsSnapshotIfChanged(
              this.db, row.id, 'total',
              { over: to, under: tu, line },
              sourceStr,
            );
          }
        }

        updated += 1;
      }
    });

    return { updated, skipped };
  }

  // --- Multi-source odds sync ---

  private async runEspnSummarySync(): Promise<void> {
    try {
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const fbReverseMap: Record<string, string> = {};
      for (const [code, name] of Object.entries(ESPN_FOOTBALL_LEAGUES)) fbReverseMap[name] = code;
      const bbReverseMap: Record<string, string> = {};
      for (const [code, name] of Object.entries(ESPN_BASKETBALL_LEAGUES)) bbReverseMap[name] = code;

       const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
       let updated = 0;
       const footballRows = await this.db.select({
         id: matches.id, sourceId: matches.sourceId, league: matches.league,
         matchStatus: matches.matchStatus, advancedStats: matches.advancedStats,
         sourceLeagueCode: matches.sourceLeagueCode,
       }).from(matches).where(and(
         isNotNull(matches.sourceId),
         or(
           and(ne(matches.matchStatus, 'finished'), gte(matches.kickoffTime, now), lt(matches.kickoffTime, in24h)),
           and(eq(matches.matchStatus, 'finished'), gte(matches.kickoffTime, twoHoursAgo), lte(matches.kickoffTime, now)),
         ),
       )).limit(40);

       const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
       const fbUnmappedRows = await this.db.select({
         id: matches.id, homeTeam: matches.homeTeam, awayTeam: matches.awayTeam,
         league: matches.league, kickoffTime: matches.kickoffTime,
         advancedStats: matches.advancedStats, source: matches.source,
       }).from(matches).where(and(
         eq(matches.matchStatus, 'finished'),
         isNull(matches.sourceId),
         gte(matches.kickoffTime, fortyEightHoursAgo),
         lte(matches.kickoffTime, now),
         inArray(matches.source, ['sporttery', 'beidan', 'qiumibao']),
       )).limit(100);

       if (fbUnmappedRows.length > 0 && this.lastEspnFootballMatches.length > 0) {
         this.logger.log(`Fallback source_id backfill: ${fbUnmappedRows.length} unmapped finished matches, ${this.lastEspnFootballMatches.length} ESPN candidates`);
         const espnCandidates = this.lastEspnFootballMatches.filter((m) => m.sourceId && m.leagueCode);
         for (const row of fbUnmappedRows) {
           const homeNorm = normalizeTeamName(row.homeTeam);
           const awayNorm = normalizeTeamName(row.awayTeam);
           const rowKickoff = new Date(row.kickoffTime).getTime();
           let matched: { sourceId: string; leagueCode: string } | null = null;

           for (const em of espnCandidates) {
             if (!em.sourceId || !em.leagueCode) continue;
             const emHome = normalizeTeamName(em.homeTeam);
             const emAway = normalizeTeamName(em.awayTeam);
             if (Math.abs(new Date(em.kickoffTime).getTime() - rowKickoff) > 3 * 3600 * 1000) continue;
             const exactFwd = emHome === homeNorm && emAway === awayNorm;
             const exactRev = emHome === awayNorm && emAway === homeNorm;
             if (exactFwd || exactRev) {
               matched = { sourceId: em.sourceId, leagueCode: em.leagueCode };
               break;
             }
             const fuzzyHome =
               emHome.includes(homeNorm.slice(0, 4)) || homeNorm.includes(emHome.slice(0, 4));
             const fuzzyAway =
               emAway.includes(awayNorm.slice(0, 4)) || awayNorm.includes(emAway.slice(0, 4));
             if (fuzzyHome && fuzzyAway && !matched) {
               matched = { sourceId: em.sourceId, leagueCode: em.leagueCode };
             }
           }

           if (matched) {
             try {
               const evt = await this.espnSource.fetchFootballEventSummary(
                 matched.leagueCode, matched.sourceId,
               );
               if (evt.matchStats.home && evt.matchStats.away) {
                 const existing = await this.db.select({ advancedStats: matches.advancedStats })
                   .from(matches).where(eq(matches.id, row.id));
                 const existingAdvancedStats =
                   (existing[0]?.advancedStats as Record<string, unknown> | undefined) || {};
                 await this.db.update(matches).set({
                   sourceId: matched.sourceId,
                   sourceLeagueCode: matched.leagueCode,
                   advancedStats: {
                     ...existingAdvancedStats,
                     dataSource: 'espn_summary',
                     quality: 'high',
                     shotsHome: evt.matchStats.home.totalShots,
                     shotsAway: evt.matchStats.away.totalShots,
                     shotsOnTargetHome: evt.matchStats.home.shotsOnTarget,
                     shotsOnTargetAway: evt.matchStats.away.shotsOnTarget,
                     cornersHome: evt.matchStats.home.wonCorners,
                     cornersAway: evt.matchStats.away.wonCorners,
                     possessionHome: evt.matchStats.home.possessionPct,
                     possessionAway: evt.matchStats.away.possessionPct,
                     foulsHome: evt.matchStats.home.foulsCommitted,
                     foulsAway: evt.matchStats.away.foulsCommitted,
                     passAccuracyHome: evt.matchStats.home.passPct,
                     passAccuracyAway: evt.matchStats.away.passPct,
                   },
                   updatedAt: sql`CURRENT_TIMESTAMP`,
                 }).where(eq(matches.id, row.id));
                 updated += 1;
                 this.logger.log(`Fallback stats backfilled: ${row.homeTeam} vs ${row.awayTeam} (${row.source})`);
               }
             } catch {
               // 单个失败不影响整体
             }
           }
         }
       }

      const basketballRows = await this.db.select({
        id: basketballMatches.id, sourceId: basketballMatches.sourceId, league: basketballMatches.league,
        sourceLeagueCode: basketballMatches.sourceLeagueCode,
      }).from(basketballMatches).where(and(
        ne(basketballMatches.matchStatus, 'finished'),
        isNotNull(basketballMatches.sourceId),
        gte(basketballMatches.kickoffTime, now),
        lt(basketballMatches.kickoffTime, in24h),
      )).limit(20);

      const bbFinishedRows = await this.db.select({
        id: basketballMatches.id, sourceId: basketballMatches.sourceId,
        league: basketballMatches.league, teamStats: basketballMatches.teamStats,
        sourceLeagueCode: basketballMatches.sourceLeagueCode,
      }).from(basketballMatches).where(and(
        eq(basketballMatches.matchStatus, 'finished'),
        isNotNull(basketballMatches.sourceId),
        gte(basketballMatches.kickoffTime, twoHoursAgo),
        lte(basketballMatches.kickoffTime, now),
       )).limit(20);

       type SummaryTask = { id: string; sourceId: string; leagueCode: string };
      const fbTasks: SummaryTask[] = footballRows
        .filter(r => {
          if (!r.sourceId) return false;
          const leagueCode = r.sourceLeagueCode || fbReverseMap[r.league];
          if (!leagueCode) return false;
          if (r.matchStatus === 'finished') {
            const adv = (r.advancedStats as Record<string, unknown> | undefined) || {};
            if (adv.dataSource === 'espn_summary' && adv.shotsHome !== undefined) return false;
          }
          return true;
        })
        .map(r => ({ id: r.id, sourceId: r.sourceId!, leagueCode: r.sourceLeagueCode || fbReverseMap[r.league]! }));

      for (let i = 0; i < fbTasks.length; i += 5) {
        const batch = fbTasks.slice(i, i + 5);
        const results = await Promise.all(batch.map(async t => {
          try {
            const s = await this.espnSource.fetchFootballSummary(t.sourceId, t.leagueCode);
            return s ? this.updateFootballMatchFromEspnSummary(t.id, s) : 0;
          } catch { return 0; }
        }));
        updated += results.reduce((s, n) => s + n, 0);
      }

      const fbFinishedStatsTasks: SummaryTask[] = footballRows
        .filter(r => {
          if (!r.sourceId) return false;
          const leagueCode = r.sourceLeagueCode || fbReverseMap[r.league];
          if (!leagueCode) return false;
          if (r.matchStatus !== 'finished') return false;
          const adv = (r.advancedStats as Record<string, unknown> | undefined) || {};
          return !(adv.dataSource === 'espn_summary' && adv.shotsHome !== undefined);
        })
        .map(r => ({ id: r.id, sourceId: r.sourceId!, leagueCode: r.sourceLeagueCode || fbReverseMap[r.league]! }));

      for (let i = 0; i < fbFinishedStatsTasks.length; i += 5) {
        const batch = fbFinishedStatsTasks.slice(i, i + 5);
        const statsResults = await Promise.all(batch.map(async t => {
          try {
            const evt = await this.espnSource.fetchFootballEventSummary(t.leagueCode, t.sourceId);
            if (evt.matchStats.home && evt.matchStats.away) {
              const existing = await this.db.select({ advancedStats: matches.advancedStats })
                .from(matches).where(eq(matches.id, t.id));
              const existingAdvancedStats =
                (existing[0]?.advancedStats as Record<string, unknown> | undefined) || {};
              await this.db.update(matches).set({
                advancedStats: {
                  ...existingAdvancedStats,
                  dataSource: 'espn_summary',
                  quality: 'high',
                  shotsHome: evt.matchStats.home.totalShots,
                  shotsAway: evt.matchStats.away.totalShots,
                  shotsOnTargetHome: evt.matchStats.home.shotsOnTarget,
                  shotsOnTargetAway: evt.matchStats.away.shotsOnTarget,
                  cornersHome: evt.matchStats.home.wonCorners,
                  cornersAway: evt.matchStats.away.wonCorners,
                  possessionHome: evt.matchStats.home.possessionPct,
                  possessionAway: evt.matchStats.away.possessionPct,
                  foulsHome: evt.matchStats.home.foulsCommitted,
                  foulsAway: evt.matchStats.away.foulsCommitted,
                  passAccuracyHome: evt.matchStats.home.passPct,
                  passAccuracyAway: evt.matchStats.away.passPct,
                },
                updatedAt: sql`CURRENT_TIMESTAMP`,
              }).where(eq(matches.id, t.id));
              return 1;
            }
            return 0;
          } catch { return 0; }
        }));
        updated += statsResults.reduce((s, n) => s + n, 0);
      }

      const bbTasks: SummaryTask[] = basketballRows
        .filter(r => r.sourceId && (r.sourceLeagueCode || bbReverseMap[r.league]))
        .map(r => ({ id: r.id, sourceId: r.sourceId!, leagueCode: r.sourceLeagueCode || bbReverseMap[r.league]! }));

      for (let i = 0; i < bbTasks.length; i += 5) {
        const batch = bbTasks.slice(i, i + 5);
        const results = await Promise.all(batch.map(async t => {
          try {
            const s = await this.espnSource.fetchBasketballSummary(t.sourceId, t.leagueCode);
            return s ? this.updateBasketballMatchFromEspnSummary(t.id, s) : 0;
          } catch { return 0; }
        }));
        updated += results.reduce((s, n) => s + n, 0);
      }

      const bbFinishedStatsTasks: SummaryTask[] = bbFinishedRows
        .filter(r => {
          if (!r.sourceId) return false;
          const leagueCode = r.sourceLeagueCode || bbReverseMap[r.league];
          if (!leagueCode) return false;
          const ts = (r.teamStats as Record<string, unknown> | undefined) || {};
          return !(ts.dataSource === 'espn_summary' && ts.stats);
        })
        .map(r => ({ id: r.id, sourceId: r.sourceId!, leagueCode: r.sourceLeagueCode || bbReverseMap[r.league]! }));

      for (let i = 0; i < bbFinishedStatsTasks.length; i += 5) {
        const batch = bbFinishedStatsTasks.slice(i, i + 5);
        const bbStatsResults = await Promise.all(batch.map(async t => {
          try {
            const s = await this.espnSource.fetchBasketballSummary(t.sourceId, t.leagueCode);
            if (s && s.homeTeamStats && Object.keys(s.homeTeamStats).length > 0
                && s.awayTeamStats && Object.keys(s.awayTeamStats).length > 0) {
              return await this.updateBasketballMatchFromEspnSummary(t.id, s);
            }
            return 0;
          } catch { return 0; }
        }));
        updated += bbStatsResults.reduce((s, n) => s + n, 0);
      }

      this.espnSummaryLastSync = new Date();
      this.espnSummarySuccess = true;
      this.espnSummaryUpdated = updated;
      this.espnSummaryTodayCount += updated;
      this.logger.log(`ESPN summary sync complete: updated ${updated} matches`);

      if (updated > 0) {
        const bb = await this.backfillBasketballInjuryReportsInternal();
        if (bb.inserted > 0) {
          this.logger.log(
            `[espn-summary->injury] backfilled ${bb.inserted} new injury reports from ${bb.processed} matches`,
          );
        }
      }
    } catch (error) {
      this.espnSummaryLastSync = new Date();
      this.espnSummarySuccess = false;
      this.logger.error('ESPN summary sync failed', error);
    }
  }

  private async updateFootballMatchFromEspnSummary(
    matchId: string, summary: EspnSummaryData,
  ): Promise<number> {
    const existing = await this.db.select({
      oddsLiveHome: matches.oddsLiveHome, oddsLiveDraw: matches.oddsLiveDraw,
      oddsLiveAway: matches.oddsLiveAway, handicap: matches.handicap,
      overUnder: matches.overUnder, homeInjuries: matches.homeInjuries,
      awayInjuries: matches.awayInjuries, teamNews: matches.teamNews,
    }).from(matches).where(eq(matches.id, matchId)).limit(1);
    if (existing.length === 0) return 0;
    const row = existing[0];
    const updateSet: Record<string, unknown> = {};
    let intelChanged = false;

    const pick = summary.pickcenter[0];
    if (pick) {
      const homeMl = americanToDecimal(pick.homeMoneyLine);
      const drawMl = americanToDecimal(pick.drawMoneyLine);
      const awayMl = americanToDecimal(pick.awayMoneyLine);
      if (row.oddsLiveHome === null && homeMl) updateSet.oddsLiveHome = homeMl;
      if (row.oddsLiveDraw === null && drawMl) updateSet.oddsLiveDraw = drawMl;
      if (row.oddsLiveAway === null && awayMl) updateSet.oddsLiveAway = awayMl;
      if (pick.spread !== null && !row.handicap) updateSet.handicap = String(pick.spread);
      if (pick.overUnder !== null && !row.overUnder) updateSet.overUnder = String(pick.overUnder);
    }

    const isEmptyText = (v: string | null) => v === null || v === '';
    const injuryToText = (inj: { athleteName: string; status: string }) => `${inj.athleteName} - ${inj.status}`;

    if (isEmptyText(row.homeInjuries) && summary.homeInjuries.length > 0) {
      updateSet.homeInjuries = summary.homeInjuries.map(injuryToText).join('\n') + '\n[ESPN 来源]';
      intelChanged = true;
    }
    if (isEmptyText(row.awayInjuries) && summary.awayInjuries.length > 0) {
      updateSet.awayInjuries = summary.awayInjuries.map(injuryToText).join('\n') + '\n[ESPN 来源]';
      intelChanged = true;
    }
    if (isEmptyText(row.teamNews) && summary.news.length > 0) {
      updateSet.teamNews = summary.news.slice(0, 3).map(n => n.headline).join('\n') + '\n[ESPN 来源]';
      intelChanged = true;
    }

    if (Object.keys(updateSet).length === 0) return 0;
    if (intelChanged) updateSet.intelUpdatedAt = sql`CURRENT_TIMESTAMP`;
    updateSet.updatedAt = sql`CURRENT_TIMESTAMP`;
    await this.db.update(matches).set(updateSet).where(eq(matches.id, matchId));
    return 1;
  }

  private async updateBasketballMatchFromEspnSummary(
    matchId: string, summary: EspnSummaryData,
  ): Promise<number> {
    const existing = await this.db.select({
      homeWinOdds: basketballMatches.homeWinOdds, awayWinOdds: basketballMatches.awayWinOdds,
      handicap: basketballMatches.handicap, totalLine: basketballMatches.totalLine,
      injuries: basketballMatches.injuries, teamNews: basketballMatches.teamNews,
      teamStats: basketballMatches.teamStats,
      league: basketballMatches.league,
    }).from(basketballMatches).where(eq(basketballMatches.id, matchId)).limit(1);
    if (existing.length === 0) return 0;
    const row = existing[0];
    const updateSet: Record<string, unknown> = {};
    let intelChanged = false;

    if (summary.homeTeamStats && Object.keys(summary.homeTeamStats).length > 0
        && summary.awayTeamStats && Object.keys(summary.awayTeamStats).length > 0
        && (row.teamStats === null || !(row.teamStats as Record<string, unknown>)?.dataSource)) {
      const statMap: Record<string, { home: string; away: string }> = {};
      for (const [key, val] of Object.entries(summary.homeTeamStats)) {
        if (!statMap[key]) statMap[key] = { home: '', away: '' };
        statMap[key].home = val;
      }
      for (const [key, val] of Object.entries(summary.awayTeamStats)) {
        if (!statMap[key]) statMap[key] = { home: '', away: '' };
        statMap[key].away = val;
      }
      updateSet.teamStats = { dataSource: 'espn_summary', stats: statMap, updatedAt: new Date().toISOString() };
    }

    const pick = summary.pickcenter[0];
    if (pick) {
      const homeMl = americanToDecimal(pick.homeMoneyLine);
      const awayMl = americanToDecimal(pick.awayMoneyLine);
      if (row.homeWinOdds === null && homeMl) updateSet.homeWinOdds = homeMl;
      if (row.awayWinOdds === null && awayMl) updateSet.awayWinOdds = awayMl;
      const currentHandicapVal = row.handicap ? Number(row.handicap) : 0;
      const currentTotalVal = row.totalLine ? Number(row.totalLine) : 0;
      const handicapValid = currentHandicapVal !== 0 && this.isBasketballLineValid(row.league, 'spread', currentHandicapVal);
      const totalValid = currentTotalVal > 0 && this.isBasketballLineValid(row.league, 'total', currentTotalVal);
      if (pick.spread !== null && !handicapValid) {
        const espnSpread = Number(pick.spread);
        if (this.isBasketballLineValid(row.league, 'spread', espnSpread)) {
          updateSet.handicap = String(pick.spread);
        }
      }
      if (pick.overUnder !== null && !totalValid) {
        const espnTotal = Number(pick.overUnder);
        if (this.isBasketballLineValid(row.league, 'total', espnTotal)) {
          updateSet.totalLine = String(pick.overUnder);
        }
      }
    }

    const injuriesEmpty = row.injuries === null || typeof row.injuries === 'string';
    const existingInj = row.injuries as Record<string, unknown> | null;
    const existingSource = injuriesEmpty ? null : (existingInj?.source as string | null);
    const existingStatus = injuriesEmpty ? null : (existingInj?.status as string | null);
    const existingHomeLen = injuriesEmpty ? 0 : Array.isArray(existingInj?.home) ? (existingInj.home as Array<unknown>).length : 0;
    const existingAwayLen = injuriesEmpty ? 0 : Array.isArray(existingInj?.away) ? (existingInj.away as Array<unknown>).length : 0;
    const homeChanged = summary.homeInjuries.length !== existingHomeLen || existingSource !== 'ESPN';
    const awayChanged = summary.awayInjuries.length !== existingAwayLen || existingSource !== 'ESPN';
    const hasEspnInjuries = summary.homeInjuries.length > 0 || summary.awayInjuries.length > 0;
    if ((injuriesEmpty || homeChanged || awayChanged) && hasEspnInjuries) {
      updateSet.injuries = {
        home: summary.homeInjuries.map(i => ({ name: i.athleteName, status: i.status })),
        away: summary.awayInjuries.map(i => ({ name: i.athleteName, status: i.status })),
        source: 'ESPN', updatedAt: new Date().toISOString(),
      };
      intelChanged = true;
    } else if (injuriesEmpty && !hasEspnInjuries) {
      // ESPN抓取成功但两队均无伤停 → 写入clean标记，区分「未抓取」和「已核实无伤停」
      updateSet.injuries = {
        home: [], away: [], source: 'ESPN', status: 'clean',
        updatedAt: new Date().toISOString(),
      };
      intelChanged = true;
    } else if (!injuriesEmpty && !hasEspnInjuries && existingStatus !== 'clean'
               && summary.homeInjuries.length === 0 && summary.awayInjuries.length === 0) {
      // 之前有伤停数据，现在ESPN返回空（球员已复出）→ 更新为clean状态
      updateSet.injuries = {
        home: [], away: [], source: 'ESPN', status: 'clean',
        updatedAt: new Date().toISOString(),
      };
      intelChanged = true;
    }
    if ((row.teamNews === null || row.teamNews === '') && summary.news.length > 0) {
      updateSet.teamNews = summary.news.slice(0, 3).map(n => n.headline).join('\n') + '\n[ESPN 来源]';
      intelChanged = true;
    }

    if (Object.keys(updateSet).length === 0) return 0;
    if (intelChanged) updateSet.intelUpdatedAt = sql`CURRENT_TIMESTAMP`;
    updateSet.updatedAt = sql`CURRENT_TIMESTAMP`;
    await this.db.update(basketballMatches).set(updateSet).where(eq(basketballMatches.id, matchId));
    return 1;
  }

  private async runFootballDataSync(): Promise<void> {
    try {
      const allMatches = await this.footballDataSource.fetchAllDivisions();
      if (allMatches.length === 0) {
        this.footballDataLastSync = new Date();
        this.footballDataSuccess = true;
        this.footballDataUpdated = 0;
        return;
      }
      const dates = Array.from(new Set(allMatches.map(m => m.date).filter(Boolean)));
      if (dates.length === 0) { this.footballDataLastSync = new Date(); this.footballDataSuccess = true; this.footballDataUpdated = 0; return; }

      type FbRow = {
        id: string; homeTeam: string; awayTeam: string; matchDate: string;
        source: string; oddsLiveHome: string | null; oddsLiveDraw: string | null; oddsLiveAway: string | null;
        handicap: string | null; oddsMovements: unknown;
      };
      const existingMatches: FbRow[] = await this.db.select({
        id: matches.id, homeTeam: matches.homeTeam, awayTeam: matches.awayTeam,
        matchDate: matches.matchDate, source: matches.source,
        oddsLiveHome: matches.oddsLiveHome, oddsLiveDraw: matches.oddsLiveDraw,
        oddsLiveAway: matches.oddsLiveAway, handicap: matches.handicap,
        oddsMovements: matches.oddsMovements,
      }).from(matches).where(and(
        inArray(matches.source, ['sporttery', 'espn']),
        inArray(matches.matchDate, dates),
      ));

      const dateStr = (d: string | Date) => d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
      let updated = 0;

      for (const fdMatch of allMatches) {
        const fdHome = normalizeTeamName(fdMatch.homeTeam);
        const fdAway = normalizeTeamName(fdMatch.awayTeam);
        const candidates = existingMatches.filter(m =>
          dateStr(m.matchDate) === fdMatch.date &&
          normalizeTeamName(m.homeTeam) === fdHome &&
          normalizeTeamName(m.awayTeam) === fdAway,
        );
        if (candidates.length === 0) continue;
        const existing = candidates[0];
        const updateSet: Record<string, unknown> = {};

        if (existing.oddsLiveHome === null && fdMatch.avgH !== null) updateSet.oddsLiveHome = String(fdMatch.avgH);
        if (existing.oddsLiveDraw === null && fdMatch.avgD !== null) updateSet.oddsLiveDraw = String(fdMatch.avgD);
        if (existing.oddsLiveAway === null && fdMatch.avgA !== null) updateSet.oddsLiveAway = String(fdMatch.avgA);
        if (fdMatch.ahHandicap !== null && !existing.handicap) updateSet.handicap = String(fdMatch.ahHandicap);

        const om = existing.oddsMovements;
        if ((om === null || (Array.isArray(om) && om.length === 0)) &&
            (fdMatch.avgCH !== null || fdMatch.avgCD !== null || fdMatch.avgCA !== null)) {
          updateSet.oddsMovements = [{
            time: fdMatch.date + 'T23:59:00', type: 'closing',
            avgCH: fdMatch.avgCH, avgCD: fdMatch.avgCD, avgCA: fdMatch.avgCA,
            source: 'football-data.co.uk',
          }];
        }

        if (Object.keys(updateSet).length === 0) continue;
        updateSet.updatedAt = sql`CURRENT_TIMESTAMP`;
        await this.db.update(matches).set(updateSet).where(eq(matches.id, existing.id));
        updated += 1;
      }

      this.footballDataLastSync = new Date();
      this.footballDataSuccess = true;
      this.footballDataUpdated = updated;
      this.footballDataTodayCount += updated;
      this.logger.log(`Football-data sync complete: updated ${updated} matches`);
    } catch (error) {
      this.footballDataLastSync = new Date();
      this.footballDataSuccess = false;
      this.logger.error('Football-data sync failed', error);
    }
  }

  private async runTheRundownSync(): Promise<void> {
    try {
      if (!this.theRundownSource.isEnabled()) {
        this.theRundownLastSync = new Date();
        this.theRundownSuccess = true;
        this.theRundownUpdated = 0;
        return;
      }
      const [nbaOdds, wnbaOdds, eplOdds] = await Promise.all([
        this.theRundownSource.fetchEvents(4),
        this.theRundownSource.fetchEvents(8),
        this.theRundownSource.fetchEvents(10),
      ]);
      const bbOdds = [...nbaOdds, ...wnbaOdds];
      const fbOdds = eplOdds;
      let updated = 0;

      const dateFromTime = (t: string) => {
        const d = new Date(t);
        return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
      };
      const dateStr = (d: string | Date) => d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
      const setIfNull = (set: Record<string, unknown>, key: string, cur: unknown, val: number | null) => {
        if (cur === null && val !== null) {
          const dec = americanToDecimal(val);
          if (dec) set[key] = dec;
        }
      };

      // Basketball
      if (bbOdds.length > 0) {
        const bbDates = Array.from(new Set(bbOdds.map(o => dateFromTime(o.commenceTime)).filter(Boolean)));
        if (bbDates.length > 0) {
          type BbRow = {
            id: string; homeTeam: string; awayTeam: string; matchDate: string;
            homeWinOdds: unknown; awayWinOdds: unknown; handicap: string;
            handicapOddsHome: unknown; handicapOddsAway: unknown; totalLine: string;
            totalOddsOver: unknown; totalOddsUnder: unknown;
          };
          const existingBb: BbRow[] = await this.db.select({
            id: basketballMatches.id, homeTeam: basketballMatches.homeTeam,
            awayTeam: basketballMatches.awayTeam, matchDate: basketballMatches.matchDate,
            homeWinOdds: basketballMatches.homeWinOdds, awayWinOdds: basketballMatches.awayWinOdds,
            handicap: basketballMatches.handicap, handicapOddsHome: basketballMatches.handicapOddsHome,
            handicapOddsAway: basketballMatches.handicapOddsAway, totalLine: basketballMatches.totalLine,
            totalOddsOver: basketballMatches.totalOddsOver, totalOddsUnder: basketballMatches.totalOddsUnder,
          }).from(basketballMatches).where(inArray(
            basketballMatches.matchDate,
            sql<string[]>`ARRAY[${sql.join(bbDates.map(d => sql`${d}`), sql`, `)}]::varchar[]`,
          ));

          for (const odd of bbOdds) {
            const d = dateFromTime(odd.commenceTime);
            const hn = normalizeTeamName(odd.homeTeam);
            const an = normalizeTeamName(odd.awayTeam);
            const cands = existingBb.filter(m => m.matchDate === d && normalizeTeamName(m.homeTeam) === hn && normalizeTeamName(m.awayTeam) === an);
            if (cands.length === 0) continue;
            const ex = cands[0];
            const us: Record<string, unknown> = {};
            setIfNull(us, 'homeWinOdds', ex.homeWinOdds, odd.moneyline.home);
            setIfNull(us, 'awayWinOdds', ex.awayWinOdds, odd.moneyline.away);
            if (odd.spread.point !== null && !ex.handicap) us.handicap = String(odd.spread.point);
            setIfNull(us, 'handicapOddsHome', ex.handicapOddsHome, odd.spread.home);
            setIfNull(us, 'handicapOddsAway', ex.handicapOddsAway, odd.spread.away);
            if (odd.total.point !== null && !ex.totalLine) us.totalLine = String(odd.total.point);
            setIfNull(us, 'totalOddsOver', ex.totalOddsOver, odd.total.over);
            setIfNull(us, 'totalOddsUnder', ex.totalOddsUnder, odd.total.under);
            if (Object.keys(us).length === 0) continue;
            us.updatedAt = sql`CURRENT_TIMESTAMP`;
            await this.db.update(basketballMatches).set(us).where(eq(basketballMatches.id, ex.id));
            updated += 1;
          }
        }
      }

      // Football
      if (fbOdds.length > 0) {
        const fbDates = Array.from(new Set(fbOdds.map(o => dateFromTime(o.commenceTime)).filter(Boolean)));
        if (fbDates.length > 0) {
          type FbRow = {
            id: string; homeTeam: string; awayTeam: string; matchDate: string | Date;
            oddsLiveHome: unknown; oddsLiveDraw: unknown; oddsLiveAway: unknown;
            handicap: string; handicapOddsHome: unknown; handicapOddsDraw: unknown;
            handicapOddsAway: unknown; overUnder: string; totalOddsOver: unknown;
            totalOddsUnder: unknown;
          };
          const existingFb: FbRow[] = await this.db.select({
            id: matches.id, homeTeam: matches.homeTeam, awayTeam: matches.awayTeam,
            matchDate: matches.matchDate, oddsLiveHome: matches.oddsLiveHome,
            oddsLiveDraw: matches.oddsLiveDraw, oddsLiveAway: matches.oddsLiveAway,
            handicap: matches.handicap, handicapOddsHome: matches.handicapOddsHome,
            handicapOddsDraw: matches.handicapOddsDraw, handicapOddsAway: matches.handicapOddsAway,
            overUnder: matches.overUnder, totalOddsOver: matches.totalOddsOver,
            totalOddsUnder: matches.totalOddsUnder,
          }).from(matches).where(inArray(
            matches.matchDate,
            sql<Date[]>`ARRAY[${sql.join(fbDates.map(d => sql`${d}::date`), sql`, `)}]::date[]`,
          ));

          for (const odd of fbOdds) {
            const d = dateFromTime(odd.commenceTime);
            const hn = normalizeTeamName(odd.homeTeam);
            const an = normalizeTeamName(odd.awayTeam);
            const cands = existingFb.filter(m =>
              dateStr(m.matchDate) === d &&
              normalizeTeamName(m.homeTeam) === hn &&
              normalizeTeamName(m.awayTeam) === an,
            );
            if (cands.length === 0) continue;
            const ex = cands[0];
            const us: Record<string, unknown> = {};
            setIfNull(us, 'oddsLiveHome', ex.oddsLiveHome, odd.moneyline.home);
            setIfNull(us, 'oddsLiveDraw', ex.oddsLiveDraw, odd.moneyline.draw ?? null);
            setIfNull(us, 'oddsLiveAway', ex.oddsLiveAway, odd.moneyline.away);
            if (odd.spread.point !== null && !ex.handicap) us.handicap = String(odd.spread.point);
            setIfNull(us, 'handicapOddsHome', ex.handicapOddsHome, odd.spread.home);
            setIfNull(us, 'handicapOddsAway', ex.handicapOddsAway, odd.spread.away);
            if (odd.total.point !== null && !ex.overUnder) us.overUnder = String(odd.total.point);
            setIfNull(us, 'totalOddsOver', ex.totalOddsOver, odd.total.over);
            setIfNull(us, 'totalOddsUnder', ex.totalOddsUnder, odd.total.under);
            if (Object.keys(us).length === 0) continue;
            us.updatedAt = sql`CURRENT_TIMESTAMP`;
            await this.db.update(matches).set(us).where(eq(matches.id, ex.id));
            updated += 1;
          }
        }
      }

      this.theRundownLastSync = new Date();
      const rundownErr = this.theRundownSource.getLastError();
      if (rundownErr) {
        this.theRundownSuccess = false;
        this.logger.warn(`TheRundown sync completed with error: ${rundownErr}`);
      } else {
        this.theRundownSuccess = true;
      }
      this.theRundownUpdated = updated;
      this.theRundownTodayCount += updated;
      this.logger.log(`TheRundown sync complete: updated ${updated} matches` + (rundownErr ? `, error=${rundownErr}` : ''));
    } catch (error) {
      this.theRundownLastSync = new Date();
      this.theRundownSuccess = false;
      this.logger.error('TheRundown sync failed', error);
    }
  }

  // --- Fetch: football ---

  async fetchFootballSchedule(): Promise<NormalizedFootballMatch[]> {
    this.logger.log('Fetching football schedule from sporttery');
    const data = await this.fetchSportteryJson<SportteryFootballResponse>(
      FOOTBALL_SCHEDULE_URL,
      'football',
    );

    const matchInfoList = (data.value?.matchInfoList) ?? data.matchInfoList;
    if (!matchInfoList || matchInfoList.length === 0 || data.emptyFlag === true) {
      this.logger.warn('Football API returned empty matchInfoList');
      return [];
    }

    const results: NormalizedFootballMatch[] = [];

    for (const info of matchInfoList) {
      if (!info.subMatchList || info.subMatchList.length === 0) continue;

      const infoBusinessDate = info.businessDate;

      for (const sub of info.subMatchList) {
        if (!sub.homeTeamAllName || !sub.awayTeamAllName) continue;

        const matchDateStr = sub.matchDate || info.matchDate || '';
        const rawMatchNo = String(sub.matchNum).slice(-3).padStart(3, '0');
        const businessDateStr = sub.businessDate || infoBusinessDate || computeBusinessDateFromMatchNo(rawMatchNo, matchDateStr);
        const weekdayPrefix = getWeekdayPrefix(businessDateStr);
        const matchNo = weekdayPrefix + rawMatchNo;
        const kickoffTime = this.buildKickoffTime(matchDateStr, sub.matchTime);

        const had = sub.had;
        const hhad = sub.hhad;
        const ttg = sub.ttg;

        const oddsH = had?.h ? String(had.h) : '0';
        const oddsD = had?.d ? String(had.d) : '0';
        const oddsA = had?.a ? String(had.a) : '0';

        const handicapLine = hhad?.goalLineValue !== undefined ? String(hhad.goalLineValue) : '0';
         const hhadH = hhad?.h ? Number(hhad.h) : 0;
         const hhadD = hhad?.d ? Number(hhad.d) : 0;
         const hhadA = hhad?.a ? Number(hhad.a) : 0;
         let handicapRec = '';
         if (hhadH > 0 && hhadA > 0) {
           handicapRec = hhadH < hhadA ? '主胜' : '客胜';
         }

         const totalLine = ttg?.goalLineValue != null && ttg.goalLineValue !== '' ? String(ttg.goalLineValue) : '2.5';
         const ttgH = ttg?.h ? Number(ttg.h) : 0;
         const ttgA = ttg?.a ? Number(ttg.a) : 0;

        results.push({
          matchNo: matchNo,
          matchDate: matchDateStr,
          businessDate: businessDateStr,
          league: sub.leagueAllName || sub.leagueAbbName || '未知联赛',
          homeTeam: sub.homeTeamAllName,
          awayTeam: sub.awayTeamAllName,
          kickoffTime,
          matchStatus: this.mapFootballStatus(sub.matchStatus),
          oddsOpenHome: oddsH,
          oddsOpenDraw: oddsD,
          oddsOpenAway: oddsA,
          handicap: handicapLine,
          handicapRecommendation: handicapRec,
          handicapOddsHome: hhadH > 0 ? String(hhadH) : '',
          handicapOddsDraw: hhadD > 0 ? String(hhadD) : '',
          handicapOddsAway: hhadA > 0 ? String(hhadA) : '',
          overUnder: totalLine,
          totalGoals: totalLine,
          totalOddsOver: ttgH > 0 ? String(ttgH) : '',
          totalOddsUnder: ttgA > 0 ? String(ttgA) : '',
          sourceMatchId: String(sub.matchId),
          source: 'sporttery',
        });
      }
    }

    this.logger.log(`Fetched ${results.length} football matches from sporttery`);
    return results;
  }

  // --- Handicap pick from raw handicap odds (football) ---
  // Used when WDW odds are missing but handicap 3-way odds are provided.
  // Computes implied probabilities directly from handicap odds and picks top/second.

  // v6.8.4 数据不足硬拦截公共函数（所有足球写入路径统一调用）
  // 作用：写入基线默认值 + 数据不足标签，三项（胜平负/让球/大小球）全部强制观望
  // 设计原则：单一入口、单一版本号，杜绝各路径标签/数值分叉
  private applyFootballDataInsufficientGuard(record: Record<string, unknown>): void {
    record.homeWinProb = 35;
    record.drawProb = 30;
    record.awayWinProb = 35;
    record.confidence = 35;
    record.lowConfidence = true;
    record.predictionDirection = '主胜';
    record.handicapWinProb = '35';
    record.handicapDrawProb = '30';
    record.handicapLoseProb = '35';
    record.handicapRecommendation = '让胜';
    record.handicapSecondChoice = '让负';
    record.handicapConfidence = '低';
    record.overProb = 50;
    record.underProb = 50;
    record.totalPick = '大球';
    record.totalPickProb = 50;
    record.ouConfidence = '低';
    record.predEngineVersion = FOOTBALL_MODEL_VERSION;
    const rules = record.modelRules as string[] | undefined;
    if (!Array.isArray(rules) || !rules.some((r: string) => /^数据不足：基线默认值/.test(r))) {
      record.modelRules = [...(rules ?? []), '数据不足：基线默认值（v12.0 低信心方向）'];
    }
  }

  private applyBeidanDataQualityGuard(record: Record<string, unknown>): void {
    const rules = record.modelRules as string[] | undefined;
    if (!Array.isArray(rules) || !rules.some((r: string) => /^北单数据不足/.test(r))) {
      record.modelRules = [...(rules ?? []), '北单数据不足：让球/大小球观望（纯赔率驱动精度不足）'];
    }
    record.handicapRecommendation = '观望';
    record.handicapWinProb = '33';
    record.handicapDrawProb = '33';
    record.handicapLoseProb = '34';
    record.handicapSecondChoice = '';
    record.totalPick = '观望';
    record.overProb = 50;
    record.underProb = 50;
    record.totalPickProb = 50;
    record.lowConfidence = true;
    if (typeof record.confidence === 'number' && record.confidence > 55) {
      record.confidence = 55;
    }
  }

  private finalizeFootballPick(
    record: Record<string, unknown>,
    existingRec?: string | null,
    existingRowInsufficient?: boolean,
    explicitInput?: {
      predictionDirection?: boolean;
      handicapRecommendation?: boolean;
      totalPick?: boolean;
    },
    dbHandicapOdds?: {
      home: string | null;
      draw: string | null;
      away: string | null;
    },
  ): void {
    // v6.8.7 显式入参保护：调用方明确传入的推荐字段（含"观望"），指数重算不得覆盖。
    // - 传了 explicitInput：只有标记为 true 的字段受保护
    // - 没传（兼容旧调用）：record 中非空的推荐字段一律视为受保护
    const hasExplicitFlag = explicitInput !== undefined;
    const inputHasPredDir = hasExplicitFlag
      ? (explicitInput.predictionDirection === true && this.isNonEmptyStr(record.predictionDirection))
      : this.isNonEmptyStr(record.predictionDirection);
    const inputHasHandicapRec = hasExplicitFlag
      ? (explicitInput.handicapRecommendation === true && this.isNonEmptyStr(record.handicapRecommendation))
      : this.isNonEmptyStr(record.handicapRecommendation);
    const inputHasTotalPick = hasExplicitFlag
      ? (explicitInput.totalPick === true && this.isNonEmptyStr(record.totalPick))
      : this.isNonEmptyStr(record.totalPick);

    // v9.0 数据不足硬拦截（收窄触发条件）：
    // 原v6.8.4：baseline默认值+低信心→全观望（过宽）
    // v9.0：仅当「无有效指数线（让球/大小球赔率均缺失）且无球队实力数据」时才全观望
    //   - 有胜平负指数线（h/d/a赔率存在） → 胜平负给方向
    //   - 有让球指数线（让球三项赔率存在） → 让球给方向
    //   - 有大小球指数线（大小球赔率存在） → 大小球给方向
    //   - 有任一指数线时，对应维度至少给低信心方向，不全观望
    const rules = record.modelRules as string[] | undefined;
    const hasInsufficientTag = Array.isArray(rules) && rules.some((r: string) => /^数据不足/.test(r));
    const hw = Number(record.homeWinProb ?? 0);
    const dr = Number(record.drawProb ?? 0);
    const aw = Number(record.awayWinProb ?? 0);
    const op = Number(record.overProb ?? 0);
    const up = Number(record.underProb ?? 0);
    const isBaselineDefault = hw === 35 && dr === 30 && aw === 35 && op === 50 && up === 50;
    const lowConf = record.lowConfidence === true;

    // v9.0 检测是否有指数线/球队数据可用
    const hOddsHVal = this.numStrOrNull(String(record.handicapOddsHome ?? ''));
    const hOddsDVal = this.numStrOrNull(String(record.handicapOddsDraw ?? ''));
    const hOddsAVal = this.numStrOrNull(String(record.handicapOddsAway ?? ''));
    const hasHandicapLine = hOddsHVal !== null && hOddsDVal !== null && hOddsAVal !== null;
    const tOddsOVal = this.numStrOrNull(String(record.totalOddsOver ?? ''));
    const tOddsUVal = this.numStrOrNull(String(record.totalOddsUnder ?? ''));
    const hasTotalLine = tOddsOVal !== null && tOddsUVal !== null;
    const oddsHVal = this.numStrOrNull(String(record.oddsOpenHome ?? ''));
    const oddsDVal = this.numStrOrNull(String(record.oddsOpenDraw ?? ''));
    const oddsAVal = this.numStrOrNull(String(record.oddsOpenAway ?? ''));
    const hasWdwLine = oddsHVal !== null && oddsDVal !== null && oddsAVal !== null;
    // 有任一指数线 或 有球队数据（teamStats/recentForm/h2h非空）视为有依据
    const teamStatsVal = record.teamStats;
    const recentFormVal = record.recentForm;
    const hasTeamData = teamStatsVal !== undefined && teamStatsVal !== null && teamStatsVal !== ''
      || recentFormVal !== undefined && recentFormVal !== null && recentFormVal !== '';
    const hasAnyBasis = hasWdwLine || hasHandicapLine || hasTotalLine || hasTeamData;

    // v9.0 仅在无任何依据时才全观望；有依据时走正常逻辑（低信心出方向）
    if ((existingRowInsufficient || hasInsufficientTag || (isBaselineDefault && lowConf)) && !hasAnyBasis) {
      this.applyFootballDataInsufficientGuard(record);
      return;
    }
    // v9.0 有依据但处于数据不足态：清除不足标签，保留低信心标记
    if (hasInsufficientTag && hasAnyBasis) {
      record.modelRules = (rules ?? []).filter((r: string) => !/^数据不足/.test(r));
    }

    // v12.0 胜平负概率全为0：归一为基线默认值，最高项即方向（主队优先），标低信心。
    // 真正无数据场景已由上方数据不足拦截处理。
    const isZeroWinProb = hw === 0 && dr === 0 && aw === 0;
    if (isZeroWinProb) {
      record.homeWinProb = 35;
      record.drawProb = 30;
      record.awayWinProb = 35;
      if (!inputHasPredDir) {
        record.predictionDirection = '主胜';
      }
      record.confidence = 35;
      record.lowConfidence = true;
    }

    // v12.0 胜平负闸门兜底：取消45%观望门槛，最高项即方向。
    // 只要有胜平负概率（不全为0）就给方向，信心按偏离度标注。
    // 情报方向优先保留，仅作为特殊标记。
    const topWinProb = Math.max(hw, dr, aw);
    const hasIntelDirection = Array.isArray(record.modelRules)
      && record.modelRules.some((r: string) => r.startsWith && r.startsWith('情报方向:'));

    // v10.2 让球观望根因修复：盘口赔率缺失不再强制观望
    // 原v7.4逻辑：无真实让球赔率→强制观望（即使泊松/模型算出60%让胜）
    // 新逻辑：有模型让球三项概率时保留模型输出，由下方阈值统一判定
    //   赢盘概率 > 50% → 出对应方向（低信心）
    //   概率 ≤ 50% → 观望
    // 只有"无模型让球概率 且 无盘口赔率"才硬观望
    // 有盘口赔率时走赔率去水真实概率（见下文让球赔率去水分支）
    let hOddsH = this.numStrOrNull(String(record.handicapOddsHome ?? ''));
    let hOddsD = this.numStrOrNull(String(record.handicapOddsDraw ?? ''));
    let hOddsA = this.numStrOrNull(String(record.handicapOddsAway ?? ''));
    // v11.1 赔率驱动兜底：本次更新未传让球赔率但数据库已有官方让球三项赔率时，
    // 用数据库赔率重算三向方向，防止非官方源更新覆盖官方正确结果
    if (hOddsH === null || hOddsD === null || hOddsA === null) {
      const dbH = dbHandicapOdds?.home;
      const dbD = dbHandicapOdds?.draw;
      const dbA = dbHandicapOdds?.away;
      if (dbH && dbD && dbA && Number(dbH) > 0 && Number(dbD) > 0 && Number(dbA) > 0) {
        hOddsH = dbH;
        hOddsD = dbD;
        hOddsA = dbA;
      }
    }
    const hasHandicapOdds = hOddsH !== null && hOddsD !== null && hOddsA !== null
      && Number(hOddsH) > 0 && Number(hOddsD) > 0 && Number(hOddsA) > 0;
    const preHcw = Number(record.handicapWinProb ?? 0);
    const preHcd = Number(record.handicapDrawProb ?? 0);
    const preHcl = Number(record.handicapLoseProb ?? 0);
    const hasModelHandicapProbs = preHcw > 0 && preHcd > 0 && preHcl > 0;
    const curHcRec = String(record.handicapRecommendation ?? '').trim();
    const hasModelHandicapRec = curHcRec && curHcRec !== '观望';
    if (!hasHandicapOdds && !hasModelHandicapProbs && !hasModelHandicapRec) {
      record.handicapRecommendation = '观望';
      record.handicapSecondChoice = '观望';
    }

    // v10.2 大小球观望根因修复：盘口赔率缺失不再强制观望
    // 原v7.4逻辑：无真实大小球赔率→强制观望（即使泊松模型算出81%大球）
    // 新逻辑：只要有球队场均数据（home_goals_avg/away_goals_avg非0）且
    //   过/小球概率 ≥ 55% → 出对应方向（低信心）
    //   概率 < 55% → 观望
    // 只有"无球队数据 且 无盘口赔率 且 模型未给出有效方向"才硬观望
    // 有盘口赔率时走赔率去水真实概率（见下文大小球赔率去水分支）
    const homeGoalsAvg = Number(record.homeGoalsAvg ?? 0);
    const awayGoalsAvg = Number(record.awayGoalsAvg ?? 0);
    const hasTeamAvgData = homeGoalsAvg > 0 && awayGoalsAvg > 0;
    const tOddsOver = this.numStrOrNull(String(record.totalOddsOver ?? ''));
    const tOddsUnder = this.numStrOrNull(String(record.totalOddsUnder ?? ''));
    const hasTotalOdds = tOddsOver !== null && tOddsUnder !== null;
    const curTotalPick = String(record.totalPick ?? '').trim();
    const curOver = Number(record.overProb ?? 0);
    const curUnder = Number(record.underProb ?? 0);
    const hasModelTotal = curTotalPick && curTotalPick !== '观望' && curOver > 0 && curUnder > 0;
    if (!hasTotalOdds && !hasTeamAvgData && !hasModelTotal) {
      record.totalPick = '观望';
    }

    // v12.0 胜平负赔率驱动（同让球三向逻辑）：
    // - 有官方胜平负赔率 → 用赔率去水后的真实隐含概率（覆盖模型估算值）
    // - 最高项即方向，取消概率观望门槛
    // - 平局为最高项时直接出"平"（平局天然概率偏低也给出方向）
    // - 信心按偏离度标注，<50%标低信心
    // - 显式输入（provided传入）仍受概率门槛约束，不得绕过
    const oddsH = this.numStrOrNull(String(record.oddsOpenHome ?? ''));
    const oddsD = this.numStrOrNull(String(record.oddsOpenDraw ?? ''));
    const oddsA = this.numStrOrNull(String(record.oddsOpenAway ?? ''));
    const hasWdwOdds = oddsH !== null && oddsD !== null && oddsA !== null
      && Number(oddsH) > 0 && Number(oddsD) > 0 && Number(oddsA) > 0;
    const wdwDirIsExplicit = hasExplicitFlag
      ? (explicitInput.predictionDirection === true && this.isNonEmptyStr(record.predictionDirection) && record.predictionDirection !== '观望')
      : false;
    const totalPickIsExplicit = hasExplicitFlag
      ? (explicitInput.totalPick === true && this.isNonEmptyStr(record.totalPick) && record.totalPick !== '观望')
      : false;
    if (hasWdwOdds && !wdwDirIsExplicit) {
      const invH = 1 / Number(oddsH);
      const invD = 1 / Number(oddsD);
      const invA = 1 / Number(oddsA);
      const totalInv = invH + invD + invA;
      const wdwHProb = Math.round((invH / totalInv) * 100);
      const wdwDProb = Math.round((invD / totalInv) * 100);
      let wdwAProb = 100 - wdwHProb - wdwDProb;
      if (wdwAProb < 0) { wdwAProb = 0; }
      record.homeWinProb = wdwHProb;
      record.drawProb = wdwDProb;
      record.awayWinProb = wdwAProb;
      const wdwTop = Math.max(wdwHProb, wdwDProb, wdwAProb);
      const drawIsTop = wdwDProb > wdwHProb && wdwDProb > wdwAProb;
      if (drawIsTop) {
        record.predictionDirection = '平';
      } else {
        record.predictionDirection = wdwHProb >= wdwAProb ? '主胜' : '客胜';
      }
      record.confidence = Math.max(15, Math.min(80, wdwTop));
      record.lowConfidence = wdwTop < 50;
      const rules = record.modelRules as string[] | undefined;
      const hasOddsRule = Array.isArray(rules)
        && rules.some((r: string) => r.startsWith('赔率驱动胜平负'));
      if (!hasOddsRule) {
        record.modelRules = [...(rules ?? []), '赔率驱动胜平负：官方赔率去水判定方向'];
      }
    }

    // v12.0 大小球赔率驱动：
    // - 有官方大小球赔率 → 用赔率去水后的真实隐含概率判定
    // - 最高项即方向，取消55%观望门槛
    // - 显式输入仍受概率门槛约束
    const tOddsO = this.numStrOrNull(String(record.totalOddsOver ?? ''));
    const tOddsU = this.numStrOrNull(String(record.totalOddsUnder ?? ''));
    const hasTotalOdds2 = tOddsO !== null && tOddsU !== null
      && Number(tOddsO) > 0 && Number(tOddsU) > 0;
    if (hasTotalOdds2 && !totalPickIsExplicit) {
      const invO = 1 / Number(tOddsO);
      const invU = 1 / Number(tOddsU);
      const totalInv = invO + invU;
      const ouOverProb = Math.round((invO / totalInv) * 100);
      const ouUnderProb = 100 - ouOverProb;
      record.overProb = ouOverProb;
      record.underProb = ouUnderProb;
      const ouTop = Math.max(ouOverProb, ouUnderProb);
      record.totalPick = ouOverProb >= ouUnderProb ? '大球' : '小球';
      record.totalPickProb = ouTop;
      const rules = record.modelRules as string[] | undefined;
      const hasOddsRule = Array.isArray(rules)
        && rules.some((r: string) => r.startsWith('赔率驱动大小球'));
      if (!hasOddsRule) {
        record.modelRules = [...(rules ?? []), '赔率驱动大小球：官方赔率去水判定方向'];
      }
    }

    // v11.0 让球三向输出（让胜/让平/让负）统一关口：
    // - 有真实让球三项赔率 → 始终用赔率去水后的真实隐含概率（覆盖模型估算值）
    // - 让胜/让负：最高项≥42%给出推荐
    // - 让平：最高项≥25%直接推荐"让平"（让平天然概率偏低，单独设门槛）
    // - 显式输入（模型n=1/n=2规则、provided传入）仍受概率门槛约束，不得绕过
    if (hasHandicapOdds) {
      const hPick = this.generateHandicapPickFromOdds(
        Number(hOddsH), Number(hOddsD), Number(hOddsA),
      );
      if (hPick) {
        record.handicapWinProb = String(hPick.handicapWinProb);
        record.handicapDrawProb = String(hPick.handicapDrawProb);
        record.handicapLoseProb = String(hPick.handicapLoseProb);
        record.handicapSecondChoice = hPick.handicapSecondChoice;
        const wP = hPick.handicapWinProb;
        const lP = hPick.handicapLoseProb;
        const dP = hPick.handicapDrawProb;
         const topProb = Math.max(wP, dP, lP);
         const drawHighest = dP > wP && dP > lP;
         // v12.0 三向输出：让平≥25%直接推让平；让胜/让负最高项即方向（取消42%门槛）
         // 让平不足25%时取次高项（让胜/让负）方向
          const drawThreshold = 25;
          if (drawHighest && dP >= drawThreshold) {
            record.handicapRecommendation = '让平';
          } else if (drawHighest) {
            record.handicapRecommendation = wP >= lP ? '让胜' : '让负';
          } else {
            record.handicapRecommendation = wP >= lP ? '让胜' : '让负';
          }
      }
    }

    const w = Number(record.handicapWinProb ?? 0);
    const d = Number(record.handicapDrawProb ?? 0);
    const l = Number(record.handicapLoseProb ?? 0);
    if (w > 0 && d > 0 && l > 0) {
      const entries: Array<{ key: 'win' | 'draw' | 'lose'; val: number }> = [
        { key: 'win', val: w },
        { key: 'draw', val: d },
        { key: 'lose', val: l },
      ];
      entries.sort((a, b) => b.val - a.val);
       // v12.0 让球三向输出统一：
       //   - 让平为最高项且≥25% → 推荐让平
       //   - 让平为最高项但<25% → 取次高项（让胜/让负）方向
       //   - 让胜/让负最高 → 最高项即方向（取消42%观望门槛）
       const topIsDraw = entries[0].key === 'draw';
        const drawThreshold = 25;
        const topVal = entries[0].val;
        let targetRec: string;
        if (topIsDraw && topVal >= drawThreshold) {
          targetRec = '让平';
        } else if (topIsDraw) {
          const secondKey = entries[1].key;
          targetRec = secondKey === 'win' ? '让胜' : '让负';
        } else {
          const labelMap: Record<'win' | 'draw' | 'lose', string> = {
            win: '让胜',
            draw: '让平',
            lose: '让负',
          };
          targetRec = labelMap[entries[0].key];
        }
        const cur = String(record.handicapRecommendation ?? '').trim();
        if (!cur || cur === '观望') {
          record.handicapRecommendation = targetRec;
          if (!String(record.handicapSecondChoice ?? '').trim()) {
            const labelMap2: Record<'win' | 'draw' | 'lose', string> = {
              win: '让胜',
              draw: '让平',
              lose: '让负',
            };
            record.handicapSecondChoice = labelMap2[entries[1].key];
          }
        }
    }
    // existingRec 回填仅在 record 自身让球三项概率缺失时才生效；
    // 有概率但没过门槛的场次已在上文被置为观望，不会走到这里
    if (existingRec && !String(record.handicapRecommendation ?? '').trim()) {
      record.handicapRecommendation = existingRec;
    }
    // v12.0 大小球：入参已明确给 totalPick 时不再由概率推导（尊重入参）
    // 最高项即方向，取消55%观望门槛，对齐篮球侧标准
    const overP = Number(record.overProb ?? 0);
    const underP = Number(record.underProb ?? 0);
    const topTotalProb = Math.max(overP, underP);
    const totalPickEmptyOrWait = !String(record.totalPick ?? '').trim() || record.totalPick === '观望';
    if (!inputHasTotalPick && overP > 0 && underP > 0 && totalPickEmptyOrWait) {
      record.totalPick = overP >= underP ? '大球' : '小球';
      record.totalPickProb = topTotalProb;
    }
    // ou_confidence 信心分级（仅大小球出方向时写入）
    // v12.0：高≥65% / 中58-65% / 低<58%，对齐读出端统一标准
    if (String(record.totalPick ?? '') !== '观望' && topTotalProb > 0) {
      if (topTotalProb >= 65) {
        record.ouConfidence = '高';
      } else if (topTotalProb >= 58) {
        record.ouConfidence = '中';
      } else {
        record.ouConfidence = '低';
      }
    }

    // v12.0 三项推荐字段非空保证（足球统一最终关口，最后一道防线）：
    // 最高项即方向——有概率值但未显式设方向时，按最高项补方向（低信心），
    // 不再默认填观望。仅 record 中存在该字段但值为空时才补。
    if ('predictionDirection' in record && !String(record.predictionDirection ?? '').trim()) {
      const hwFinal = Number(record.homeWinProb ?? 0);
      const drFinal = Number(record.drawProb ?? 0);
      const awFinal = Number(record.awayWinProb ?? 0);
      if (hwFinal > 0 || drFinal > 0 || awFinal > 0) {
        if (drFinal > hwFinal && drFinal > awFinal) {
          record.predictionDirection = '平';
        } else {
          record.predictionDirection = hwFinal >= awFinal ? '主胜' : '客胜';
        }
      } else {
        record.predictionDirection = '主胜';
      }
    }
    if ('handicapRecommendation' in record && !String(record.handicapRecommendation ?? '').trim()) {
      const wFinal = Number(record.handicapWinProb ?? 0);
      const dFinal = Number(record.handicapDrawProb ?? 0);
      const lFinal = Number(record.handicapLoseProb ?? 0);
      if (wFinal > 0 || dFinal > 0 || lFinal > 0) {
        if (dFinal > wFinal && dFinal > lFinal && dFinal >= 25) {
          record.handicapRecommendation = '让平';
        } else if (wFinal >= lFinal) {
          record.handicapRecommendation = '让胜';
        } else {
          record.handicapRecommendation = '让负';
        }
      } else {
        record.handicapRecommendation = '让胜';
      }
    }
    if ('totalPick' in record && !String(record.totalPick ?? '').trim()) {
      const oFinal = Number(record.overProb ?? 0);
      const uFinal = Number(record.underProb ?? 0);
      if (oFinal > 0 || uFinal > 0) {
        record.totalPick = oFinal >= uFinal ? '大球' : '小球';
      } else {
        record.totalPick = '大球';
        record.overProb = 50;
        record.underProb = 50;
      }
    }
    if (Number(record.handicapWinProb ?? 0) <= 0) record.handicapWinProb = '35';
    if (Number(record.handicapDrawProb ?? 0) <= 0) record.handicapDrawProb = '30';
    if (Number(record.handicapLoseProb ?? 0) <= 0) record.handicapLoseProb = '35';

    // v12.0 足球 handicap_confidence 信心分级（让球三向）
    // 基于最高项概率：高≥65% / 中58-65% / 低<58%
    const hcRec = String(record.handicapRecommendation ?? '').trim();
    if (hcRec && hcRec !== '观望') {
      const wP = Number(record.handicapWinProb ?? 0);
      const dP = Number(record.handicapDrawProb ?? 0);
      const lP = Number(record.handicapLoseProb ?? 0);
      let topHcProb = 0;
      if (hcRec === '让胜') topHcProb = wP;
      else if (hcRec === '让平') topHcProb = dP;
      else if (hcRec === '让负') topHcProb = lP;
      else topHcProb = Math.max(wP, dP, lP);
      if (topHcProb >= 65) {
        record.handicapConfidence = '高';
      } else if (topHcProb >= 58) {
        record.handicapConfidence = '中';
      } else {
        record.handicapConfidence = '低';
      }
    } else if ('handicapRecommendation' in record) {
      record.handicapConfidence = '低';
    }
  }

  finalizeBasketballPick(
    record: Record<string, unknown>,
    existingHandicap?: string | null,
    existingTotal?: string | null,
    league = 'default',
  ): void {
    // --- 数据不足硬拦截（篮球三项全观望）---
    // 判定：胜平负概率无效（0或50/50）且让分指数线为0且大小分指数线为0 → 全部置观望/0
    const hw = Number(record.homeWinProb ?? 0);
    const aw = Number(record.awayWinProb ?? 0);
    const wdwInvalid = hw === 0 || aw === 0 || (hw === 50 && aw === 50);
    const guardHLineRaw = String(record.handicapLineNum ?? '').trim();
    const guardHLineNum = guardHLineRaw && !Number.isNaN(Number(guardHLineRaw)) ? Number(guardHLineRaw) : 0;
    const guardTLineRaw = String(record.totalGoals ?? record.overUnder ?? '').trim();
    const guardTLineNum = guardTLineRaw && !Number.isNaN(Number(guardTLineRaw)) ? Number(guardTLineRaw) : 0;
    if (wdwInvalid && guardHLineNum === 0 && guardTLineNum === 0) {
      record.predictionDirection = '观望';
      record.confidence = 0;
      record.predictedHomeScore = 0;
      record.predictedAwayScore = 0;
      record.predictedTotal = '0';
      record.handicapRecommendation = '观望';
      record.handicapPick = '观望';
      record.handicapCoverProb = 0;
      record.handicapPickProb = 0;
      record.totalDirection = '观望';
      record.totalPick = '观望';
      record.overProb = 0;
      record.underProb = 0;
      record.totalPickProb = 0;
      record.lowConfidence = true;
      const rules = record.modelRules as string[] | undefined;
      if (!Array.isArray(rules) || !rules.some((r: string) => /^数据不足：无有效指数与指数线/.test(r))) {
        record.modelRules = [...(rules ?? []), '数据不足：无有效指数与指数线'];
      }
      return;
    }

    // --- 归一化措辞（写入端统一为 让分主胜/让分客胜）---
    const rec = String(record.handicapRecommendation ?? '').trim();
    if (rec === '让分主负') record.handicapRecommendation = '让分客胜';
    if (rec === '让分主胜客' || rec === '主胜客') record.handicapRecommendation = '让分客胜';

    const tdir = String(record.totalDirection ?? '').trim();
    if (tdir === '大球') record.totalDirection = '大分';
    if (tdir === '小球') record.totalDirection = '小分';

    const tpick = String(record.totalPick ?? '').trim();
    if (tpick === '大球') record.totalPick = '大分';
    if (tpick === '小球') record.totalPick = '小分';

    // --- 让分推荐：优先尊重模型已输出的方向/观望（非空即模型已判定） ---
    // 仅当模型未输出任何推荐（空串/undefined）时，才由 coverProb 兜底判定方向
    // 指数线无效判定：handicapLineNum=0 或 handicap 为空串 / 非数值
    const hcp = Number(record.handicapCoverProb ?? 0);
    const hLineRaw = String(record.handicapLineNum ?? '').trim();
    const hLineNum = hLineRaw && !Number.isNaN(Number(hLineRaw)) ? Number(hLineRaw) : 0;
    const handicapStr = String(record.handicap ?? '').trim();
    const hasValidHandicapLine =
      hLineNum !== 0 &&
      handicapStr !== '' &&
      /^[+-]?[0-9]+(\.[0-9]+)?$/.test(handicapStr) &&
      this.isBasketballLineValid(league, 'spread', hLineNum);

    const modelHasHandicapOutput = rec && rec !== '';

    if (!hasValidHandicapLine) {
      record.handicapRecommendation = '观望';
      record.handicapPick = '观望';
      record.handicapCoverProb = 50;
      record.handicapPickProb = 50;
      record.handicapConfidence = '低';
    } else if (modelHasHandicapOutput) {
      // 模型已输出方向/观望 → 原样保留，禁止用 coverProb 二次判定覆盖
      // 仅做 coverProb 与方向的一致性兜底：方向与coverProb明显矛盾时修正
       const finalRec = record.handicapRecommendation as string;
       if (finalRec === '让分主胜' && hcp < 50) {
         record.handicapCoverProb = Math.max(51, hcp || 51);
       } else if (finalRec === '让分客胜' && hcp > 50) {
          record.handicapCoverProb = Math.min(49, hcp || 49);
        }
       const finalHcp = record.handicapCoverProb as number;
      if (!record.handicapPickProb) {
        record.handicapPickProb = finalRec === '让分主胜' ? finalHcp : finalRec === '让分客胜' ? 100 - finalHcp : 50;
      }
      record.handicapPick = finalRec;
      if (!record.handicapConfidence) record.handicapConfidence = '低';
    } else if (hcp === 50 || hcp === 0) {
      record.handicapRecommendation = '观望';
      record.handicapPick = '观望';
      record.handicapCoverProb = 50;
      record.handicapPickProb = 50;
      if (!record.handicapConfidence) record.handicapConfidence = '低';
    } else {
      const expected = hcp > 50 ? '让分主胜' : '让分客胜';
      record.handicapRecommendation = expected;
      record.handicapPick = expected;
      record.handicapPickProb = hcp > 50 ? hcp : 100 - hcp;
    }
    // existingHandicap 兜底：仅在指数线无效（hasValidHandicapLine=false）且有历史推荐时兜底
    // 指数线有效但模型输出"观望"属于明确结论，不能用历史值覆盖
    if (
      !hasValidHandicapLine &&
      existingHandicap &&
      existingHandicap !== '观望'
    ) {
      record.handicapRecommendation = existingHandicap;
    }

    // --- 大小分：指数线有效才给方向；指数线无效 → 一律观望，禁止默认大分 ---
    const op = Number(record.overProb ?? 0);
    const up = Number(record.underProb ?? 0);
    const tLineRaw = String(record.totalLineNum ?? '').trim();
    const tLineNum = tLineRaw && !Number.isNaN(Number(tLineRaw)) ? Number(tLineRaw) : 0;
    const totalLineStr = String(record.totalLine ?? '').trim();
    const hasValidTotalLine =
      tLineNum > 0 &&
      totalLineStr !== '' &&
      /^[+-]?[0-9]+(\.[0-9]+)?$/.test(totalLineStr) &&
      this.isBasketballLineValid(league, 'total', tLineNum);

    if (!hasValidTotalLine) {
      // 无指数线 → 全部观望/50，禁止默认大分
      record.totalDirection = '观望';
      record.totalPick = '观望';
      record.overProb = 50;
      record.underProb = 50;
      record.totalPickProb = 50;
      record.ouConfidence = '低';
      record.ouDiffVsLine = '0';
    } else {
       // 模型已有明确输出（方向或观望）→ 尊重模型判定，不用概率数值反向覆盖
       // 仅补全缺失的 pickProb 和信心
       const modelTotal = String(record.totalDirection ?? '').trim();
       const maxProb = Math.max(op, up);
       if (modelTotal && modelTotal !== '') {
         record.totalPick = modelTotal;
         if (!record.totalPickProb) {
           record.totalPickProb = modelTotal === '大分' ? op : modelTotal === '小分' ? up : maxProb;
         }
         if (!record.ouConfidence) record.ouConfidence = '低';
         // 方向与概率一致性兜底
         if (modelTotal === '大分' && op < up) {
           record.overProb = Math.max(51, up);
           record.underProb = 100 - (record.overProb as number);
         } else if (modelTotal === '小分' && up < op) {
           record.underProb = Math.max(51, op);
           record.overProb = 100 - (record.underProb as number);
         } else if (modelTotal === '观望' && op !== up) {
           const avg = Math.round((op + up) / 2);
           record.overProb = avg;
           record.underProb = 100 - avg;
         }
       } else if (op > 0 && up > 0 && op + up > 0) {
         // 模型完全没输出方向 → 用概率兜底判定
         const dir = op >= up ? '大分' : '小分';
         record.totalDirection = dir;
         record.totalPick = dir;
         record.totalPickProb = maxProb;
       }
     }
    // existingTotal 仅在指数线有效且完全无概率时兜底（避免全空）
    if (
      hasValidTotalLine &&
      existingTotal &&
      existingTotal !== '观望' &&
      (op === 0 || up === 0) &&
      (!String(record.totalDirection ?? '').trim() ||
        String(record.totalDirection) === '观望')
    ) {
      record.totalDirection = existingTotal;
      record.totalPick = existingTotal;
    }

    // 统一信心分级：按 pickProb 阈值分档（高≥65% / 中58-65% / 低<58%）
    const finalHpp = Number(record.handicapPickProb ?? 0);
    if (finalHpp >= 65) {
      record.handicapConfidence = '高';
    } else if (finalHpp >= 58) {
      record.handicapConfidence = '中';
    } else if (finalHpp > 0 && finalHpp < 58) {
      record.handicapConfidence = '低';
    }
    const finalTpp = Number(record.totalPickProb ?? 0);
    if (finalTpp >= 65) {
      record.ouConfidence = '高';
    } else if (finalTpp >= 58) {
      record.ouConfidence = '中';
    } else if (finalTpp > 0 && finalTpp < 58) {
      record.ouConfidence = '低';
    }

    // P1-7 模型规则过滤：移除测试/调试/baseline/manual 等非生产规则
    if (Array.isArray(record.modelRules)) {
      const testRuleRe = /test|manual|baseline|调试|测试|debug/i;
      record.modelRules = (record.modelRules as string[]).filter(
        (r: string) => !testRuleRe.test(r),
      );
    }
  }

  /**
   * Build a prediction snapshot and append it to prediction_history JSONB array.
   * Only appends when the patch contains实质预测字段更新（handicapRecommendation /
   * totalDirection / confidence / predEngineVersion 任一）。
   * 数组上限 30 条，超出时丢弃最旧的。
   */
  appendBasketballPredictionHistory(
    patch: Record<string, unknown>,
    trigger: string,
  ): void {
    const hasPredictionUpdate =
      patch.handicapRecommendation !== undefined ||
      patch.totalDirection !== undefined ||
      patch.confidence !== undefined ||
      patch.predEngineVersion !== undefined;
    if (!hasPredictionUpdate) return;

    const handicapProbRaw =
      patch.handicapPickProb !== undefined
        ? patch.handicapPickProb
        : patch.handicapCoverProb;
    const handicapProb = Number(handicapProbRaw) || 0;

    const totalProbRaw =
      patch.totalPickProb !== undefined
        ? patch.totalPickProb
        : Math.max(
            Number(patch.overProb) || 0,
            Number(patch.underProb) || 0,
          );
    const totalProb = Number(totalProbRaw) || 0;

    const snapshot = {
      at: new Date().toISOString(),
      trigger,
      handicapDirection: String(patch.handicapRecommendation ?? ''),
      handicapProb,
      handicapLine: Number(patch.handicapLineNum) || 0,
      totalDirection: String(patch.totalDirection ?? ''),
      totalProb,
      totalLine: Number(patch.totalLineNum) || 0,
      confidence: Number(patch.confidence) || 0,
      engine: String(patch.predEngineVersion ?? 'unknown'),
    };

    const snapshotJson = JSON.stringify(snapshot);
    patch.predictionHistory = sql`
      CASE
        WHEN jsonb_array_length(${basketballMatches.predictionHistory}) >= 30
        THEN (${basketballMatches.predictionHistory} - 0) || ${snapshotJson}::jsonb
        ELSE ${basketballMatches.predictionHistory} || ${snapshotJson}::jsonb
      END
    `;
  }

  private generateHandicapPickFromOdds(
    handicapOddsHome: number,
    handicapOddsDraw: number,
    handicapOddsAway: number,
  ): {
    handicapWinProb: number;
    handicapDrawProb: number;
    handicapLoseProb: number;
    handicapRecommendation: string;
    handicapSecondChoice: string;
  } | null {
    if (handicapOddsHome <= 0 || handicapOddsDraw <= 0 || handicapOddsAway <= 0) {
      return null;
    }

    const invW = 1 / handicapOddsHome;
    const invD = 1 / handicapOddsDraw;
    const invL = 1 / handicapOddsAway;
    const totalInv = invW + invD + invL;
    if (totalInv <= 0) return null;

    let winProb = Math.round((invW / totalInv) * 100);
    let drawProb = Math.round((invD / totalInv) * 100);
    let loseProb = 100 - winProb - drawProb;
    if (loseProb < 0) loseProb = 0;

    const probs: { key: 'win' | 'draw' | 'lose'; val: number }[] = [
      { key: 'win', val: winProb },
      { key: 'draw', val: drawProb },
      { key: 'lose', val: loseProb },
    ];
    probs.sort((a, b) => b.val - a.val);

    const labelMap: Record<'win' | 'draw' | 'lose', string> = {
      win: '让胜',
      draw: '让平',
      lose: '让负',
    };

    // v12.0 让球三向输出（让胜/让平/让负）：
    // 让胜/让负：最高项即方向，取消概率门槛
    // 让平：最高项≥25%推荐"让平"（让平天然概率偏低，保留门槛）
    // 让平不足门槛时，取次高项（让胜/让负）作为方向
    const topIsDraw = probs[0].key === 'draw';
    const drawThreshold = 25;
    let recommendation = '观望';
    if (topIsDraw) {
      if (probs[0].val >= drawThreshold) {
        recommendation = labelMap[probs[0].key];
      } else {
        recommendation = labelMap[probs[1].key];
      }
    } else {
      recommendation = labelMap[probs[0].key];
    }

    return {
      handicapWinProb: winProb,
      handicapDrawProb: drawProb,
      handicapLoseProb: loseProb,
      handicapRecommendation: recommendation,
      handicapSecondChoice: labelMap[probs[1].key],
    };
  }

  // --- Over/Under pick from raw total odds (football / basketball) ---

  private generateTotalPickFromOdds(
    overOdds: number,
    underOdds: number,
  ): { overProb: number; underProb: number; pick: string } | null {
    if (overOdds <= 0 || underOdds <= 0) return null;
    const invOver = 1 / overOdds;
    const invUnder = 1 / underOdds;
    const totalInv = invOver + invUnder;
    if (totalInv <= 0) return null;
    const overProb = Math.round((invOver / totalInv) * 100);
    const underProb = 100 - overProb;
    return {
      overProb,
      underProb,
      pick: overProb >= underProb ? '大球' : '小球',
    };
  }

  // --- Prediction generation: football ---

  private generateFootballPrediction(
    oddsHome: number,
    oddsDraw: number,
    oddsAway: number,
    handicapStr: string,
    totalGoalsStr?: string,
    league?: string,
    strengthInput?: {
      homeFormWdl?: string;
      awayFormWdl?: string;
      homeGoalsAvg?: number;
      awayGoalsAvg?: number;
      homeConcededAvg?: number;
      awayConcededAvg?: number;
      homeHomeRecord?: string;
      awayAwayRecord?: string;
      h2hHomeWins?: number;
      h2hAwayWins?: number;
      h2hDraws?: number;
       homeInjuryImpact?: number;
       awayInjuryImpact?: number;
       footballInjury?: {
         homeAttackFactor: number;
         homeDefenseFactor: number;
         awayAttackFactor: number;
         awayDefenseFactor: number;
         homeWinShift: number;
         awayWinShift: number;
         summary: string;
         details: string[];
       };
      leagueHomeWinPct?: number;
       handicapImpliedHomePct?: number;
       homeShotsPerGame?: number;
       awayShotsPerGame?: number;
       eloHome?: number;
       eloAway?: number;
       eloGap?: number;
       homeXg?: number;
       awayXg?: number;
       xgQuality?: 'high' | 'medium' | 'low' | 'none';
       restDaysDiff?: number;
     },
  ): {
    homeWinProb: number;
    drawProb: number;
    awayWinProb: number;
    predictionDirection: string;
    confidence: number;
    lowConfidence: boolean;
    drawWarning: boolean;
    handicapRecommendation: string;
    handicapWinProb: number;
    handicapDrawProb: number;
    handicapLoseProb: number;
    handicapSecondChoice: string;
    overProb: number;
    underProb: number;
    totalPick: string;
    totalPickProb: number;
    mostLikelyScore: string;
    scoreProbs: string[];
    totalGoalsProb: { goals: string; prob: number }[];
    halfFullProb: { code: string; prob: number }[];
    modelRules: string[];
  } | null {
    if (oddsHome <= 0 || oddsDraw <= 0 || oddsAway <= 0) return null;
    if (Number.isNaN(oddsHome) || Number.isNaN(oddsDraw) || Number.isNaN(oddsAway)) return null;

    // 1. Implied probabilities from odds, normalized to 1 after removing vig
    const invH = 1 / oddsHome;
    const invD = 1 / oddsDraw;
    const invA = 1 / oddsAway;
    const totalInv = invH + invD + invA;
    let homeWinProb = Math.round((invH / totalInv) * 100);
    let drawProb = Math.round((invD / totalInv) * 100);
    let awayWinProb = Math.round((invA / totalInv) * 100);

    // Correct rounding drift so sum == 100
    const total = homeWinProb + drawProb + awayWinProb;
    if (total !== 100) {
      const diff = 100 - total;
      const probs: { key: 'homeWinProb' | 'drawProb' | 'awayWinProb'; val: number }[] = [
        { key: 'homeWinProb', val: homeWinProb },
        { key: 'drawProb', val: drawProb },
        { key: 'awayWinProb', val: awayWinProb },
      ];
      probs.sort((a, b) => b.val - a.val);
      if (probs[0].key === 'homeWinProb') homeWinProb += diff;
      else if (probs[0].key === 'drawProb') drawProb += diff;
      else awayWinProb += diff;
    }

    // 1b. 综合实力修正（v9.0）：基于战绩/攻防/主客场/H2H/伤停微调基础概率
    // 原则：赔率为主、实力为辅，修正幅度受限（±6%上限），避免越界
    const strengthFactors: string[] = [];
    if (strengthInput) {
      let hDelta = 0;
      // 近期战绩（WDL字符串如 "WWDLW"）
      const calcFormPts = (s: string | undefined): number => {
        if (!s) return -1;
        let pts = 0;
        for (const ch of s.toUpperCase()) {
          if (ch === 'W') pts += 3;
          else if (ch === 'D') pts += 1;
        }
        return pts;
      };
      const hPts = calcFormPts(strengthInput.homeFormWdl);
      const aPts = calcFormPts(strengthInput.awayFormWdl);
      if (hPts >= 0 && aPts >= 0 && strengthInput.homeFormWdl && strengthInput.awayFormWdl) {
        const diffPts = hPts - aPts;
        const adj = Math.max(-3, Math.min(3, diffPts * 0.3));
        if (Math.abs(adj) >= 0.6) {
          hDelta += adj;
          strengthFactors.push(adj > 0 ? `R91 近期战绩占优(主+${adj.toFixed(1)}%)` : `R91 近期战绩劣势(主${adj.toFixed(1)}%)`);
        }
      }
      // 攻防效率差（场均进失球差，转化为小幅度概率修正）
      if (strengthInput.homeGoalsAvg !== undefined && strengthInput.awayGoalsAvg !== undefined &&
          strengthInput.homeConcededAvg !== undefined && strengthInput.awayConcededAvg !== undefined &&
          strengthInput.homeGoalsAvg > 0 && strengthInput.awayGoalsAvg > 0) {
        const homeAttack = strengthInput.homeGoalsAvg + strengthInput.awayConcededAvg;
        const awayAttack = strengthInput.awayGoalsAvg + strengthInput.homeConcededAvg;
        const goalDiff = homeAttack - awayAttack; // 正=主队进攻预期更强
        const gAdj = Math.max(-2, Math.min(2, goalDiff * 1.5));
        if (Math.abs(gAdj) >= 0.5) {
          hDelta += gAdj;
          strengthFactors.push(gAdj > 0 ? `R92 攻防效率占优(主+${gAdj.toFixed(1)}%)` : `R92 攻防效率劣势(主${gAdj.toFixed(1)}%)`);
        }
      }
      // H2H 历史交锋修正
      const hw = strengthInput.h2hHomeWins ?? 0;
      const aw = strengthInput.h2hAwayWins ?? 0;
      const hd = strengthInput.h2hDraws ?? 0;
      const h2hTotal = hw + aw + hd;
      if (h2hTotal >= 3) {
        const h2hDiff = (hw - aw) / h2hTotal; // -1~1
        const h2hAdj = Math.max(-2, Math.min(2, h2hDiff * 3));
        if (Math.abs(h2hAdj) >= 0.5) {
          hDelta += h2hAdj;
          strengthFactors.push(h2hAdj > 0 ? `R93 历史交锋占优(主+${h2hAdj.toFixed(1)}%)` : `R93 历史交锋劣势(主${h2hAdj.toFixed(1)}%)`);
        }
      }
      // Elo 评分修正（v10.0）：基于 Elo 分差的对数几率近似转换，权重保守 15%
      const eloHomeVal: number | undefined = strengthInput.eloHome;
      const eloAwayVal: number | undefined = strengthInput.eloAway;
      if (eloHomeVal !== undefined && eloAwayVal !== undefined && eloHomeVal > 0 && eloAwayVal > 0) {
        const computedEloGap: number = (strengthInput.eloGap !== undefined) ? strengthInput.eloGap : (eloHomeVal - eloAwayVal);
        const eloAdjRaw: number = (computedEloGap / 400) * 100 * 0.15;
        const eloAdj: number = Math.max(-3, Math.min(3, eloAdjRaw));
        if (Math.abs(eloAdj) >= 0.3) {
          hDelta += eloAdj;
          strengthFactors.push(`R-ELO-ADJ Elo评分修正(主${eloAdj > 0 ? '+' : ''}${eloAdj.toFixed(1)}%, gap=${computedEloGap.toFixed(0)})`);
        }
      }
      // 伤停修正（R-INJURY-FB-V10）：基于新浪足彩伤停结构化数据
      // 优先使用结构化footballInjury（按位置+影响评级参数化），否则降级为旧版R94计数法
      const fbInjury = strengthInput.footballInjury;
      if (fbInjury) {
        const homeShift = fbInjury.homeWinShift || 0;
        const awayShift = fbInjury.awayWinShift || 0;
        const injDelta = homeShift - awayShift; // 正=主队更强→升主胜
        if (Math.abs(injDelta) >= 0.3) {
          hDelta += injDelta;
          strengthFactors.push(
            `R-INJURY-FB-V10 伤停融合(胜平负净${injDelta > 0 ? '+' : ''}${injDelta.toFixed(1)}%, ${fbInjury.summary})`,
          );
          for (const d of fbInjury.details.slice(0, 4)) {
            strengthFactors.push(`  - ${d}`);
          }
        }
      } else {
        const hInj = strengthInput.homeInjuryImpact ?? 0;
        const aInj = strengthInput.awayInjuryImpact ?? 0;
        const injDiff = aInj - hInj;
        if (Math.abs(injDiff) >= 0.5) {
          hDelta += injDiff;
          strengthFactors.push(injDiff > 0 ? `R94 客队伤停更重(主+${injDiff.toFixed(1)}%)` : `R94 主队伤停更重(主${injDiff.toFixed(1)}%)`);
        }
      }
      // 联赛主场偏差校正（基于联赛历史统计的主队胜率基准）
      // 不同联赛主场优势不同：北欧/南美主场优势强，德/英超中等，法/意甲偏弱
      if (strengthInput.leagueHomeWinPct !== undefined && strengthInput.leagueHomeWinPct > 0) {
        const leagueHw = strengthInput.leagueHomeWinPct;
        // 与全球平均主场胜率46%的偏差
        const homeBias = leagueHw - 46;
        const biasAdj = Math.max(-1.5, Math.min(1.5, homeBias * 0.06));
        if (Math.abs(biasAdj) >= 0.3) {
          hDelta += biasAdj;
          strengthFactors.push(biasAdj > 0 ? `R95 联赛主场优势强(主+${biasAdj.toFixed(1)}%)` : `R95 联赛主场优势弱(主${biasAdj.toFixed(1)}%)`);
        }
      }
      // 赔率-盘口一致性验证：让球盘方向与胜平负热门方一致时，小幅增强信心
      const impliedHcp = strengthInput.handicapImpliedHomePct;
      if (impliedHcp !== undefined && impliedHcp > 0) {
        const wdwHotHome = homeWinProb >= awayWinProb;
        const hcpHotHome = impliedHcp >= 50;
        if (wdwHotHome === hcpHotHome) {
          // 方向一致+0.8%，方向相反-0.8%
          const consAdj = wdwHotHome ? 0.8 : -0.8;
          hDelta += consAdj;
          strengthFactors.push(consAdj > 0 ? `R96 胜平负与让球盘方向一致(主+${consAdj.toFixed(1)}%)` : `R96 胜平负与让球盘方向背离(主${consAdj.toFixed(1)}%)`);
        }
      }
      // 修正上限 ±6%
      const clamped = Math.max(-6, Math.min(6, hDelta));
      if (Math.abs(clamped) >= 0.5) {
        const moveFromDraw = Math.min(drawProb * 0.3, Math.abs(clamped) * 0.6);
        if (clamped > 0) {
          homeWinProb += Math.round(clamped);
          drawProb -= Math.round(moveFromDraw);
          awayWinProb -= Math.round(clamped - moveFromDraw);
        } else {
          awayWinProb += Math.round(-clamped);
          drawProb -= Math.round(moveFromDraw);
          homeWinProb -= Math.round(-clamped - moveFromDraw);
        }
        // 边界保护
        homeWinProb = Math.max(5, Math.min(85, homeWinProb));
        awayWinProb = Math.max(5, Math.min(85, awayWinProb));
        drawProb = Math.max(10, Math.min(50, drawProb));
        // 重新归一化到100
        const s = homeWinProb + drawProb + awayWinProb;
        if (s !== 100) {
          const d = 100 - s;
          if (homeWinProb >= awayWinProb) homeWinProb += d;
          else awayWinProb += d;
        }
         strengthFactors.push(`R90 综合实力修正(净${clamped > 0 ? '+' : ''}${clamped.toFixed(1)}%)`);
       }
     }

    // 1c. 双泊松攻防强度模型（v10.0）
    // 当有完整攻防数据时，用泊松模型独立计算胜平负/大小球/比分矩阵
    // 融合策略：胜负 泊松40% + 赔率60%；大小球 泊松为主+盘口校准；比分矩阵完全由泊松生成
    const poissonModel = (() => {
      if (!strengthInput) return null;
      const hGf = strengthInput.homeGoalsAvg;
      const hGa = strengthInput.homeConcededAvg;
      const aGf = strengthInput.awayGoalsAvg;
      const aGa = strengthInput.awayConcededAvg;
      if (hGf === undefined || hGa === undefined || aGf === undefined || aGa === undefined) return null;
      if (hGf <= 0 || hGa <= 0 || aGf <= 0 || aGa <= 0) return null;
      const result = this.footballPoissonService.predict({
        homeGoalsFor: hGf,
        homeGoalsAgainst: hGa,
        awayGoalsFor: aGf,
        awayGoalsAgainst: aGa,
        homeAdvantage: 1.15,
        homeForm: strengthInput.homeFormWdl,
        awayForm: strengthInput.awayFormWdl,
        h2hHomeWins: strengthInput.h2hHomeWins,
        h2hAwayWins: strengthInput.h2hAwayWins,
        h2hDraws: strengthInput.h2hDraws,
        homeShotsPerGame: strengthInput.homeShotsPerGame,
        awayShotsPerGame: strengthInput.awayShotsPerGame,
        homeHomeRecord: strengthInput.homeHomeRecord,
        awayAwayRecord: strengthInput.awayAwayRecord,
      });
      return result;
    })();

    // 1d. xG 代理泊松λ修正（v10.0）：在泊松λ初始化后、buildMatrix 前加权融合 xG 代理值
    // 仅当 poissonModel 存在且双方 xG 均有效且数据质量不为 none 时触发
    const xgAdjInfo: { applied: boolean; oldLambdaH: number; oldLambdaA: number; newLambdaH: number; newLambdaA: number; quality: string } = {
      applied: false,
      oldLambdaH: 0,
      oldLambdaA: 0,
      newLambdaH: 0,
      newLambdaA: 0,
      quality: '',
    };

    if (poissonModel) {
      const wdwPoissonWeight = 0.40;
      const oddsWeight = 1 - wdwPoissonWeight;
      const blendedHome = homeWinProb * oddsWeight + poissonModel.homeWinProb * wdwPoissonWeight;
      const blendedDraw = drawProb * oddsWeight + poissonModel.drawProb * wdwPoissonWeight;
      const blendedAway = awayWinProb * oddsWeight + poissonModel.awayWinProb * wdwPoissonWeight;
      const blendedSum = blendedHome + blendedDraw + blendedAway;
      homeWinProb = Math.round((blendedHome / blendedSum) * 100);
      drawProb = Math.round((blendedDraw / blendedSum) * 100);
      awayWinProb = Math.round((blendedAway / blendedSum) * 100);
      const total = homeWinProb + drawProb + awayWinProb;
      if (total !== 100) {
        const diff = 100 - total;
        const probs2: { key: 'homeWinProb' | 'drawProb' | 'awayWinProb'; val: number }[] = [
          { key: 'homeWinProb', val: homeWinProb },
          { key: 'drawProb', val: drawProb },
          { key: 'awayWinProb', val: awayWinProb },
        ];
        probs2.sort((a, b) => b.val - a.val);
        if (probs2[0].key === 'homeWinProb') homeWinProb += diff;
        else if (probs2[0].key === 'drawProb') drawProb += diff;
        else awayWinProb += diff;
      }
      strengthFactors.push(`R100 双泊松模型融合（WDW权重${Math.round(wdwPoissonWeight * 100)}%）`);
      strengthFactors.push(`R101 泊松λ：主${poissonModel.lambdaHome.toFixed(2)} / 客${poissonModel.lambdaAway.toFixed(2)}，预期总进球${poissonModel.expectedTotal.toFixed(2)}`);

      // xG 代理λ修正：记录修正后的λ值，供后续比分矩阵校准起点使用
      const homeXgVal: number | undefined = strengthInput?.homeXg;
      const awayXgVal: number | undefined = strengthInput?.awayXg;
      const xgQualityVal: 'high' | 'medium' | 'low' | 'none' | undefined = strengthInput?.xgQuality;
      if (
        homeXgVal !== undefined && awayXgVal !== undefined &&
        homeXgVal > 0 && awayXgVal > 0 &&
        xgQualityVal !== undefined && xgQualityVal !== 'none'
      ) {
        const xgWeightMap: Record<'high' | 'medium' | 'low', number> = { high: 0.3, medium: 0.2, low: 0.1 };
        const xgWeight: number = xgWeightMap[xgQualityVal] ?? 0.1;
        xgAdjInfo.oldLambdaH = poissonModel.lambdaHome;
        xgAdjInfo.oldLambdaA = poissonModel.lambdaAway;
        xgAdjInfo.newLambdaH = this.xgProxyService.adjustPoissonLambda(poissonModel.lambdaHome, homeXgVal, xgWeight);
        xgAdjInfo.newLambdaA = this.xgProxyService.adjustPoissonLambda(poissonModel.lambdaAway, awayXgVal, xgWeight);
        xgAdjInfo.applied = true;
        xgAdjInfo.quality = xgQualityVal;
        strengthFactors.push(`R-XG-PROXY 代理xG融合(lambda主${xgAdjInfo.oldLambdaH.toFixed(2)}→${xgAdjInfo.newLambdaH.toFixed(2)}, 质量=${xgQualityVal})`);
      }
      // R-INJURY-FB-V10 泊松λ攻防调整：在xG之后、WDW融合与大小球计算之前
      // 攻强↓ → λ↓；防强↓ → 对方λ↑（即己方防守退化=对方进攻更容易）
      const fbInj = strengthInput?.footballInjury;
      if (fbInj && poissonModel) {
        const curH = xgAdjInfo.applied ? xgAdjInfo.newLambdaH : poissonModel.lambdaHome;
        const curA = xgAdjInfo.applied ? xgAdjInfo.newLambdaA : poissonModel.lambdaAway;
        // 主队进攻因子（<1=进攻削弱→主队进球λ下降）
        const hAtk = fbInj.homeAttackFactor ?? 1;
        // 主队防守因子（>1=防守削弱→客队进球λ上升，乘在客队λ上）
        const hDef = fbInj.homeDefenseFactor ?? 1;
        const aAtk = fbInj.awayAttackFactor ?? 1;
        const aDef = fbInj.awayDefenseFactor ?? 1;
        const newH = Math.max(0.3, curH * hAtk * aDef);
        const newA = Math.max(0.3, curA * aAtk * hDef);
        if (Math.abs(newH - curH) >= 0.02 || Math.abs(newA - curA) >= 0.02) {
          xgAdjInfo.oldLambdaH = curH;
          xgAdjInfo.oldLambdaA = curA;
          xgAdjInfo.newLambdaH = Math.round(newH * 100) / 100;
          xgAdjInfo.newLambdaA = Math.round(newA * 100) / 100;
          xgAdjInfo.applied = true;
          xgAdjInfo.quality = xgAdjInfo.quality || 'injury-v10';
          strengthFactors.push(
            `R-INJURY-FB-V10 伤停攻防λ调整(主${curH.toFixed(2)}→${xgAdjInfo.newLambdaH.toFixed(2)}, 客${curA.toFixed(2)}→${xgAdjInfo.newLambdaA.toFixed(2)})`,
          );
          strengthFactors.push(
            `  主队:攻${((hAtk-1)*100).toFixed(1)}% 防${((hDef-1)*100).toFixed(1)}%; 客队:攻${((aAtk-1)*100).toFixed(1)}% 防${((aDef-1)*100).toFixed(1)}%`,
          );
          // 重新生成泊松胜平负概率（基于修正后的λ）
          const rebuildBp = this.footballPoissonService.getOverUnderProb(newH, newA, 2.5);
          const wdwBp = (() => {
            let h = 0, d = 0, a = 0, s = 0;
            const MAX = 6;
            const pmfH: number[] = new Array(MAX + 1);
            const pmfA: number[] = new Array(MAX + 1);
            const calc = (k: number, lam: number): number => {
              if (k < 0) return 0;
              let r = Math.exp(-lam);
              for (let i = 1; i <= k; i++) r = (r * lam) / i;
              return r;
            };
            for (let i = 0; i <= MAX; i++) {
              pmfH[i] = calc(i, newH);
              pmfA[i] = calc(i, newA);
            }
            for (let hi = 0; hi <= MAX; hi++) {
              for (let ai = 0; ai <= MAX; ai++) {
                const p = pmfH[hi] * pmfA[ai];
                s += p;
                if (hi > ai) h += p;
                else if (hi === ai) d += p;
                else a += p;
              }
            }
            return { homeWin: h / s, draw: d / s, awayWin: a / s, over: rebuildBp.overProb };
          })();
          poissonModel.homeWinProb = Math.round(wdwBp.homeWin * 100);
          poissonModel.drawProb = Math.round(wdwBp.draw * 100);
          poissonModel.awayWinProb = Math.round(wdwBp.awayWin * 100);
          poissonModel.lambdaHome = xgAdjInfo.newLambdaH;
          poissonModel.lambdaAway = xgAdjInfo.newLambdaA;
          poissonModel.expectedTotal = xgAdjInfo.newLambdaH + xgAdjInfo.newLambdaA;
          if (poissonModel.modelRules) {
            poissonModel.modelRules.push('R-INJURY-FB-V10 伤停攻防修正');
          }
        }
      }
    }

    // 1e. ML 集成融合（v10.0）：当全部 12 个 ML 特征可用时，用 GBDT 预测 + 加权融合
    // 特征不全时跳过，不降级
    if (strengthInput) {
      const si = strengthInput;
       const hasAllMlFeatures: boolean =
         si.eloHome !== undefined && si.eloHome > 0 &&
         si.eloAway !== undefined && si.eloAway > 0 &&
         si.homeXg !== undefined && si.homeXg > 0 &&
         si.awayXg !== undefined && si.awayXg > 0 &&
         si.homeGoalsAvg !== undefined && si.homeGoalsAvg > 0 &&
         si.awayGoalsAvg !== undefined && si.awayGoalsAvg > 0 &&
         si.homeConcededAvg !== undefined && si.homeConcededAvg > 0 &&
         si.awayConcededAvg !== undefined && si.awayConcededAvg > 0 &&
         si.homeFormWdl !== undefined && si.homeFormWdl.length > 0 &&
         si.awayFormWdl !== undefined && si.awayFormWdl.length > 0;

      if (hasAllMlFeatures) {
        const eloGapVal: number = (si.eloGap !== undefined) ? si.eloGap : (si.eloHome - si.eloAway);
        const calcFormPtsForMl = (s: string): number => {
          let pts = 0;
          for (const ch of s.toUpperCase()) {
            if (ch === 'W') pts += 3;
            else if (ch === 'D') pts += 1;
          }
          return pts;
        };
        const hFormPts: number = calcFormPtsForMl(si.homeFormWdl!);
        const aFormPts: number = calcFormPtsForMl(si.awayFormWdl!);
        // 近5场积分率（每场最多3分，5场最多15分）
        const hFormRate: number = hFormPts / 15;
        const aFormRate: number = aFormPts / 15;
        const h2hTotal: number = (si.h2hHomeWins ?? 0) + (si.h2hAwayWins ?? 0) + (si.h2hDraws ?? 0);
        const h2hHomeWinRate: number = h2hTotal > 0 ? (si.h2hHomeWins ?? 0) / h2hTotal : 0;
        // 联赛场均进球估算：用双方攻防均值近似
        const leagueAvgGoalsApprox: number = (si.homeGoalsAvg! + si.awayGoalsAvg! + si.homeConcededAvg! + si.awayConcededAvg!) / 2;

        const featureInput: FootballFeatureInput = {
          eloGap: eloGapVal,
          homeXgAvg: si.homeXg!,
          awayXgAvg: si.awayXg!,
          homeGoalsAvg: si.homeGoalsAvg!,
          awayGoalsAvg: si.awayGoalsAvg!,
          homeConcededAvg: si.homeConcededAvg!,
          awayConcededAvg: si.awayConcededAvg!,
          leagueAvgGoals: leagueAvgGoalsApprox,
          homeFormPts: hFormRate,
          awayFormPts: aFormRate,
          homeAdvantageFlag: 1,
          h2hHomeWinRate,
          restDaysDiff: si.restDaysDiff ?? 0,
        };

        const { features } = this.featureEngineeringService.extractFootballFeatures(featureInput);
        const mlProbsArr: number[] = this.gbdtService.getFootballModel().predictMulti(features);
        const mlProbs = { homeWin: mlProbsArr[0], draw: mlProbsArr[1], awayWin: mlProbsArr[2] };
        const mlConfidence: number = this.mlEnsembleService.computeFootballMlConfidence(mlProbs);
        const baseProbs = { homeWin: homeWinProb / 100, draw: drawProb / 100, awayWin: awayWinProb / 100 };

        const ensembleResult = this.mlEnsembleService.ensembleFootballPrediction(
          baseProbs,
          mlProbs,
          mlConfidence,
          { mlMaxWeight: 0.5 },
        );

         const mlWeight: number = ensembleResult.mlWeight;
         if (mlWeight > 0) {
           homeWinProb = Math.round(ensembleResult.homeWinProb * 100);
           drawProb = Math.round(ensembleResult.drawProb * 100);
           awayWinProb = Math.round(ensembleResult.awayWinProb * 100);
           // 重新归一化到 100
           const mlTotal: number = homeWinProb + drawProb + awayWinProb;
           if (mlTotal !== 100) {
             const mlDiff: number = 100 - mlTotal;
             const mlProbs2: { key: 'homeWinProb' | 'drawProb' | 'awayWinProb'; val: number }[] = [
               { key: 'homeWinProb', val: homeWinProb },
               { key: 'drawProb', val: drawProb },
               { key: 'awayWinProb', val: awayWinProb },
             ];
             mlProbs2.sort((a, b) => b.val - a.val);
             if (mlProbs2[0].key === 'homeWinProb') homeWinProb += mlDiff;
             else if (mlProbs2[0].key === 'drawProb') drawProb += mlDiff;
             else awayWinProb += mlDiff;
           }
           strengthFactors.push(`R-ML-ENSEMBLE ML融合修正(权重${mlWeight.toFixed(2)})`);
         } else {
           strengthFactors.push('R-ML-ENSEMBLE ML评估完成(基线模型,权重0,待训练)');
         }
      }
    }

    // 2. Prediction direction = highest probability (v7.0.0 收紧：最高项≥60%才给方向)
    const maxProb = Math.max(homeWinProb, drawProb, awayWinProb);
    let predictionDirection = '主胜';
    if (drawProb === maxProb) predictionDirection = '平';
    if (awayWinProb === maxProb) predictionDirection = '客胜';

    // v12.0 胜平负出手闸门：取消观望门槛，最高项即方向
    //   三项概率中最高的一项就是预测方向（主胜/平/客胜）
    //   信心按偏离度标注，最高项<50%标低信心
    const topProb = maxProb;
    // 平局不可排除定义：平局概率 ≥ 25% 且 胜负差 ≤ 10%
    const drawNotExcludable = drawProb >= 25 && Math.abs(homeWinProb - awayWinProb) <= 10;

    // 3. Confidence = maxProb, clamped 15-80
    const confidence = Math.max(15, Math.min(80, maxProb));

    // 4. Low confidence: top < 50%（v12.0 对齐篮球口径：偏离50%即出方向）
    const lowConfidence = topProb < 50;

    // 4b. 胶着场防平（v6.8.0，1088场回测：双方胜率差≤8%且均<45%时平局率33%）
    // v7.0.0 扩展：只要平局不可排除即标防平
    const drawWarning = drawNotExcludable ||
      (Math.abs(homeWinProb - awayWinProb) <= 8 &&
        homeWinProb < 45 &&
        awayWinProb < 45);

    // 5. Handicap recommendation — v6.8.0 重写（1088场五大联赛回测校准）
    // 按"热门一方视角"判定再换算回主队视角输出
    // n = 热门一方让球数（整数），p = 热门一方归一化胜概率
    const handicap = Number(handicapStr) || 0;
    // Per goal of handicap: shift ~12-15% probability between win and lose
    const shiftPerGoal = 0.13; // 13%
    // handicap > 0 means home team receives goals (easier for home to "let win")
    // handicap < 0 means home team gives goals (harder for home to "let win")
    let hWinProb = homeWinProb / 100;
    let hDrawProb = drawProb / 100;
    let hLoseProb = awayWinProb / 100;

    if (handicap !== 0) {
      const shift = Math.abs(handicap) * shiftPerGoal;
      if (handicap > 0) {
        // Home receives goals: let-win probability goes up, let-lose goes down
        const move = Math.min(shift, hLoseProb * 0.8);
        hWinProb += move;
        hLoseProb -= move;
      } else {
        // Home gives goals: let-win probability goes down, let-lose goes up
        const move = Math.min(shift, hWinProb * 0.8);
        hWinProb -= move;
        hLoseProb += move;
      }
      // Redistribute small amounts to/from draw to keep sum ~1
      const sum = hWinProb + hDrawProb + hLoseProb;
      hWinProb = hWinProb / sum;
      hDrawProb = hDrawProb / sum;
      hLoseProb = hLoseProb / sum;
    }

    const handicapWinProb = Math.round(hWinProb * 100);
    const handicapDrawProb = Math.round(hDrawProb * 100);
    let handicapLoseProb = 100 - handicapWinProb - handicapDrawProb;
    if (handicapLoseProb < 0) handicapLoseProb = 0;

    // --- v6.8.0 让球推荐规则重写 ---
    // 先确定热门方与热门方视角下的让球数 n
    const isHomeFavored = homeWinProb >= awayWinProb;
    const hotWinProb01 = isHomeFavored ? homeWinProb / 100 : awayWinProb / 100;
    const handicapNum = Number(handicapStr) || 0;
    // n = 热门方让球数（正数=热门让球）
    // handicap 正数=主队受让，负数=主队让球
    let n = 0;
    if (isHomeFavored) {
      n = Math.abs(Math.round(handicapNum)); // 主队热门且让球 → handicap<0 → abs=n
      if (handicapNum > 0) n = 0; // 主队热门但还受让球 → 不算热门让球
    } else {
      n = Math.abs(Math.round(handicapNum));
      if (handicapNum < 0) n = 0; // 客队热门但主队让球 → 客队受让，不算热门让球
    }
    // v9.0 让球推荐：大幅放宽观望闸门，减少大面积观望
    // 核心变化：
    //   - n=1/2 胶着场（gap在±2%）不再观望，模型最高项≥48%按模型方向，否则按市场指数线方向（低信心）
    //   - n=0/≥3 阈值从 52% 降至 45%，让平最高时取次高项方向（差≤3个百分点）
    //   - 仅最高项<40% 才观望（极端不确定场景）
    let handicapRecommendation = '观望';
    // 热门方让球赢盘概率（让胜概率，从热门方视角=hotLetWinProb）
    const hotLetWinProb = isHomeFavored ? handicapWinProb : handicapLoseProb;
    const hotLetLoseProb = isHomeFavored ? handicapLoseProb : handicapWinProb;
    const letWinLoseGap = hotLetWinProb - hotLetLoseProb;

    const hProbsArr: { key: 'win' | 'draw' | 'lose'; val: number }[] = [
      { key: 'win', val: handicapWinProb },
      { key: 'draw', val: handicapDrawProb },
      { key: 'lose', val: handicapLoseProb },
    ];
    hProbsArr.sort((a, b) => b.val - a.val);
    const labelMapN: Record<'win' | 'draw' | 'lose', string> = {
      win: '让胜',
      draw: '让平',
      lose: '让负',
    };

    if (n === 1 || n === 2) {
      // v9.0 热门让1-2球：
      //   - |gap| ≥ 2%：方向明确，按热门方视角判定
      //   - |gap| < 2%（胶着场）：不再观望
      //       模型让球最高项 ≥ 48% → 按模型最高项方向（低信心）
      //       模型最高项 < 48% → 按市场指数线热门方方向（低信心，概率置信≥45%）
      if (letWinLoseGap >= 2) {
        handicapRecommendation = isHomeFavored ? '让胜' : '让负';
      } else if (letWinLoseGap <= -2) {
        handicapRecommendation = isHomeFavored ? '让负' : '让胜';
      } else {
        // 胶着场：模型最高项≥48% 按模型，否则按市场指数线热门方方向
        const topItem = hProbsArr[0];
        if (topItem.val >= 48 && topItem.key !== 'draw') {
          handicapRecommendation = labelMapN[topItem.key];
        } else if (topItem.key === 'draw' && hProbsArr[1].val >= 45) {
          handicapRecommendation = labelMapN[hProbsArr[1].key];
        } else {
          // 按市场指数线热门方方向：isHomeFavored 时热门是主队→主队让胜
          handicapRecommendation = isHomeFavored ? '让胜' : '让负';
        }
      }
    } else {
      // v12.0 n=0 或 n≥3：取消观望门槛，最高项即方向
      //   - 最高项非让平 → 直接给方向
      //   - 最高项是让平 → 取次高项（让胜/让负）方向
      if (hProbsArr[0].key !== 'draw') {
        handicapRecommendation = labelMapN[hProbsArr[0].key];
      } else {
        handicapRecommendation = labelMapN[hProbsArr[1].key];
      }
    }

    // 保留原 hProbs 数组用于 secondChoice 与信心差计算（向后兼容）
    const hProbs: { key: 'win' | 'draw' | 'lose'; val: number }[] = [
      { key: 'win', val: handicapWinProb },
      { key: 'draw', val: handicapDrawProb },
      { key: 'lose', val: handicapLoseProb },
    ];
    hProbs.sort((a, b) => b.val - a.val);
    const secondHandicap = hProbs[1].key;
    const handicapGap = hProbs[0].val - hProbs[1].val;
    const finalLowConfidence = lowConfidence || handicapGap <= 3;

    // 6. Over/Under (total goals) with Poisson
    // Expected goals: simplified model based on win probabilities
    const expectedHome = (awayWinProb / 100) * 1.5 + (homeWinProb / 100) * 1.2 + 1.0;
    const expectedAway = (homeWinProb / 100) * 1.5 + (awayWinProb / 100) * 1.2 + 0.8;
    // v8.1 大小球预期进球校准：基准×0.65
    // 以市场盘口为锚上下微调，配合联赛倾向/强弱差修正使大/小球分布均衡
    // 过高→几乎全大球；过低→差值不足全观望；0.65使2.5盘口约50-55%大球概率
    const lambda = (expectedHome + expectedAway) * 0.65;

    const tgVal = totalGoalsStr ? Number(totalGoalsStr) : 2.5;
    const totalLine = Number.isFinite(tgVal) && tgVal > 0 ? tgVal : 2.5;

    // v6.8.0 联赛倾向：仅指数线在 2.5 附近(2.0~3.0)时叠加小幅联赛倾向
    // 德甲偏大，意甲/法甲偏小，调整量 ±0.15 球（有界）
    let leagueTilt = 0;
    const lg = (league || '').toLowerCase();
    if (totalLine >= 2.0 && totalLine <= 3.0) {
      if (lg.includes('bundesliga') || lg.includes('德甲') || lg.includes('deutsche')) {
        leagueTilt = 0.15; // 德甲偏大
      } else if (
        lg.includes('serie') ||
        lg.includes('意甲') ||
        lg.includes('ligue') ||
        lg.includes('法甲')
      ) {
        leagueTilt = -0.15; // 意甲/法甲偏小
      }
    }

    // Poisson PMF helper (kept for score matrix calibration below)
    const poissonPmf = (k: number, lam: number): number => {
      if (k < 0) return 0;
      let result = Math.exp(-lam);
      for (let i = 1; i <= k; i++) {
        result = (result * lam) / i;
      }
      return result;
    };

    const lineFloor = Math.floor(totalLine - 0.001);

    // v10.0 大小球：泊松模型为主，市场盘口校准
    // 有泊松模型时：泊松overProb为核心（权重70%），市场盘口微调（30%）
    // 无泊松模型时：走原有 v8.1 逻辑（以市场指数线为锚）
    let overProb = 50;
    let underProb = 50;
    let totalPick = '大球';
    let totalPickProb = 50;
    let goalsConfidence: '高' | '中' | '低' = '低';

    if (poissonModel) {
      const poissonOu = this.footballPoissonService.getOverUnderProb(
        poissonModel.lambdaHome,
        poissonModel.lambdaAway,
        totalLine,
      );
      const poissonWeight = 0.70;
      const marketWeight = 0.30;

      const ouCupKeywords2 = ['杯', '欧冠', '欧罗巴', '欧联', '欧协', '欧会杯', '亚冠', '解放者', '世俱', '英联杯', '足总杯', '联赛杯'];
      const ouLgLower2 = (league || '').toLowerCase();
      const ouIsCup2 = ouCupKeywords2.some((kw: string) => ouLgLower2.includes(kw.toLowerCase()));

      let marketAdj = 0;
      if (totalLine >= 2.0 && totalLine <= 3.0) {
        if (leagueTilt > 0) marketAdj += 0.15;
        else if (leagueTilt < 0) marketAdj -= 0.15;
      }
      const ouWinGap2 = Math.abs(homeWinProb - awayWinProb);
      if (ouWinGap2 >= 35) marketAdj -= 0.15;
      else if (ouWinGap2 <= 15) marketAdj += 0.10;
      if (ouIsCup2) marketAdj -= 0.10;
      marketAdj = Math.max(-0.3, Math.min(0.3, marketAdj));

      const expectedFromLine = totalLine + marketAdj;
      const totalLambda = poissonModel.lambdaHome + poissonModel.lambdaAway;
      const blendedExpected = totalLambda * poissonWeight + expectedFromLine * marketWeight;

      const blendedOu = this.footballPoissonService.getOverUnderProb(
        blendedExpected / 2,
        blendedExpected / 2,
        totalLine,
      );

      overProb = blendedOu.overProb;
      underProb = blendedOu.underProb;
      totalPickProb = Math.max(overProb, underProb);

      const goalsDiff2 = Math.abs(blendedExpected - totalLine);
      if (totalPickProb >= 70 && goalsDiff2 >= 0.9) {
        goalsConfidence = '高';
      } else if (totalPickProb >= 60 && goalsDiff2 >= 0.6) {
        goalsConfidence = '中';
      } else {
        goalsConfidence = '低';
      }

      // v12.0 大小球：取消观望闸门，最高项即方向
      //   overProb >= underProb → 大球，否则 → 小球；等于时按大球
      totalPick = overProb >= underProb ? '大球' : '小球';

      strengthFactors.push(
        `R102 泊松大小球（λ总${totalLambda.toFixed(2)}，盘口${totalLine}，融合后预期${blendedExpected.toFixed(2)}）`,
      );
    } else {

    // 原方案从胜负赔率独立推导预期进球，系统性偏离盘口，导致全大球或全观望
    // 新方案：totalLine 是市场共识预期进球，模型在其基础上根据以下因素调整：
    //   - 联赛倾向（德甲+0.15，意甲/法甲-0.15）
    //   - 强弱差：深盘（让2球+）对攻场面少→-0.15偏小；胶着局+0.10偏大
    //   - 杯赛/淘汰赛：谨慎偏小-0.10
    // 调整量控制在 ±0.3 球内，确保大/小球分布均衡、不过度偏离市场
    const ouCupKeywords = ['杯', '欧冠', '欧罗巴', '欧联', '欧协', '欧会杯', '亚冠', '解放者', '世俱', '英联杯', '足总杯', '联赛杯'];
    const ouLgLower = (league || '').toLowerCase();
    const ouIsCup = ouCupKeywords.some((kw: string) => ouLgLower.includes(kw.toLowerCase()));
    
    // 强弱差修正
    const ouWinGap = Math.abs(homeWinProb - awayWinProb);
    let strengthTilt = 0;
    if (ouWinGap >= 35) {
      strengthTilt = -0.15; // 强弱悬殊→场面偏保守→偏小
    } else if (ouWinGap <= 15) {
      strengthTilt = 0.10; // 势均力敌→对攻→偏大
    }
    
    // 杯赛修正（v8.1）
    const cupTilt = ouIsCup ? -0.10 : 0;
    
    // 总调整量
    const totalAdjustment = leagueTilt + strengthTilt + cupTilt;
    
    // 调整后的预期进球（盘口线 + 调整量）
    const adjustedExpected = totalLine + totalAdjustment;
    const isOver = adjustedExpected >= totalLine;
    const goalsDiff = Math.abs(totalAdjustment);
    
    // 概率：差值越大信心越高，衰减公式，钳制[55%, 70%]
    const highSideProbRaw = 50 + 25 * (1 - Math.exp(-goalsDiff / 0.35));
    const clampedHigh = Math.max(55, Math.min(70, Math.round(highSideProbRaw)));
    
    if (isOver) {
      overProb = clampedHigh;
      underProb = 100 - clampedHigh;
    } else {
      overProb = 100 - clampedHigh;
      underProb = clampedHigh;
    }
    totalPickProb = clampedHigh;

    // v12.0 大小球出手闸门：取消观望门槛，最高项即方向
    //   overProb > underProb → 大球，反之 → 小球；等于时按大球
    totalPick = isOver ? '大球' : '小球';

    // v7.0.0 信心重校准：目标高信心对应真实更高命中率（≥70%）
    // 高信心：概率≥70% 且 差值≥0.9球
    // 中信心：概率≥60% 且 差值≥0.6球（满足闸门但未到高信心）
    // 低信心：其余，包括所有观望场
    if (clampedHigh >= 70 && goalsDiff >= 0.9) {
      goalsConfidence = '高';
    } else if (clampedHigh >= 60 && goalsDiff >= 0.6) {
      goalsConfidence = '中';
    } else {
      goalsConfidence = '低';
    }

    } // end of non-Poisson O/U fallback

    // 7. Bivariate Poisson score matrix (0..6 x 0..6)
    // Iteratively calibrate lambdaH/lambdaA so that:
    //   - P(home win) from matrix ≈ homeWinProb% (within ±8%)
    //   - P(draw) from matrix ≈ drawProb% (within ±8%)
    //   - P(over totalLine) from matrix ≈ overProb% (within ±10%)
    const totalLineNum = Number.isFinite(tgVal) && tgVal > 0 ? tgVal : 2.5;
    const SCORE_MAX = 6;

    let lambdaH: number;
    let lambdaA: number;
    if (poissonModel) {
      // 若已应用 xG 代理修正，则用修正后的λ作为比分矩阵校准起点
      if (xgAdjInfo.applied) {
        lambdaH = xgAdjInfo.newLambdaH;
        lambdaA = xgAdjInfo.newLambdaA;
        strengthFactors.push('R103 xG修正后泊松λ作为比分矩阵校准起点');
      } else {
        lambdaH = poissonModel.lambdaHome;
        lambdaA = poissonModel.lambdaAway;
        strengthFactors.push('R103 泊松λ作为比分矩阵校准起点');
      }
    } else {
      const winDiff2 = (homeWinProb - awayWinProb) / 100;
      const diffScale2 = 1 / 0.32;
      let goalDiff2 = winDiff2 * diffScale2;
      goalDiff2 = Math.max(-3.5, Math.min(3.5, goalDiff2));
      const overRatio = Math.max(0.6, Math.min(1.6, overProb / Math.max(1, underProb)));
      let totalLambda = totalLineNum * Math.pow(overRatio, 0.55);
      totalLambda = Math.max(0.6, Math.min(6.0, totalLambda));
      lambdaH = totalLambda / 2 + goalDiff2 / 2;
      lambdaA = totalLambda / 2 - goalDiff2 / 2;
      lambdaH = Math.max(0.15, lambdaH);
      lambdaA = Math.max(0.15, lambdaA);
    }

    const buildMatrix = (lh: number, la: number): { matrix: number[][]; home: number; draw: number; away: number; over: number } => {
      const matrix: number[][] = [];
      let home = 0, draw = 0, away = 0, over = 0, sum = 0;
      for (let h = 0; h <= SCORE_MAX; h++) {
        matrix[h] = [];
        for (let a = 0; a <= SCORE_MAX; a++) {
          const p = poissonPmf(h, lh) * poissonPmf(a, la);
          matrix[h][a] = p;
          sum += p;
        }
      }
      if (sum <= 0) sum = 1;
      for (let h = 0; h <= SCORE_MAX; h++) {
        for (let a = 0; a <= SCORE_MAX; a++) {
          const p = matrix[h][a] / sum;
          matrix[h][a] = p;
          if (h > a) home += p;
          else if (h === a) draw += p;
          else away += p;
          if (h + a > lineFloor) over += p;
        }
      }
      return { matrix, home, draw, away, over };
    };

    let result = buildMatrix(lambdaH, lambdaA);

    // Iterative calibration (max 60 iterations)
    for (let iter = 0; iter < 60; iter++) {
      const homeErr = result.home * 100 - homeWinProb;
      const drawErr = result.draw * 100 - drawProb;
      const awayErr = result.away * 100 - awayWinProb;
      const overErr = result.over * 100 - overProb;

      const wdwOk =
        Math.abs(homeErr) <= 6 &&
        Math.abs(drawErr) <= 6 &&
        Math.abs(awayErr) <= 6;
      const ouOk = Math.abs(overErr) <= 8;

      if (wdwOk && ouOk) break;

      // Adjust total goals: if over too high, reduce total; too low, increase
      const overSensitivity = Math.max(0.02, result.over * (1 - result.over) * 1.5);
      const totalAdjust = -overErr / 100 / overSensitivity * 0.06;
      const newTotal = Math.max(0.5, Math.min(7.0, (lambdaH + lambdaA) * (1 + totalAdjust)));

      // Adjust goal diff: if home win prob too high, reduce diff (shift toward away)
      const wdwSensitivity = Math.max(0.02, 0.8 * result.draw + 0.4);
      const diffAdjust = -homeErr / 100 / wdwSensitivity * 0.08;
      const curDiff = lambdaH - lambdaA;
      const newDiff = curDiff * (1 + diffAdjust);

      lambdaH = newTotal / 2 + newDiff / 2;
      lambdaA = newTotal / 2 - newDiff / 2;
      lambdaH = Math.max(0.1, lambdaH);
      lambdaA = Math.max(0.1, lambdaA);

      result = buildMatrix(lambdaH, lambdaA);
    }

    const scoreMatrix = result.matrix;
    const matHomePct = Math.round(result.home * 100);
    const matDrawPct = Math.round(result.draw * 100);
    const matAwayPct = 100 - matHomePct - matDrawPct;
    const matOverPct = Math.round(result.over * 100);

    // 7a. Total goals distribution (4 buckets) — real Poisson probabilities
    const totalGoalsProb: { goals: string; prob: number }[] = [];
    const buckets: { label: string; min: number; max: number }[] = [
      { label: '0-1球', min: 0, max: 1 },
      { label: '2-3球', min: 2, max: 3 },
      { label: '4-6球', min: 4, max: 6 },
      { label: '7+球', min: 7, max: 20 },
    ];
    const totalLam = lambdaH + lambdaA;
    for (const bucket of buckets) {
      let bucketProb = 0;
      for (let k = bucket.min; k <= bucket.max; k++) {
        bucketProb += poissonPmf(k, totalLam);
      }
      totalGoalsProb.push({
        goals: bucket.label,
        prob: Math.max(1, Math.round(bucketProb * 100)),
      });
    }
    // fix sum to 100
    {
      const total = totalGoalsProb.reduce((s, b) => s + b.prob, 0);
      if (total !== 100) {
        const diff = 100 - total;
        totalGoalsProb.sort((a, b) => b.prob - a.prob);
        totalGoalsProb[0].prob += diff;
        totalGoalsProb.sort((a, b) => b.prob - a.prob);
      }
    }

    // 8. Score Top 5 + mostLikelyScore
    const allScores: { h: number; a: number; prob: number }[] = [];
    for (let h = 0; h <= SCORE_MAX; h++) {
      for (let a = 0; a <= SCORE_MAX; a++) {
        allScores.push({ h, a, prob: scoreMatrix[h][a] });
      }
    }
    allScores.sort((a, b) => b.prob - a.prob);

    // 9. Half-full 9-grid (from bivariate Poisson, 45% first half / 55% second half)
    const FIRST_HALF_RATIO = 0.45;
    const SECOND_HALF_RATIO = 0.55;
    const h1 = lambdaH * FIRST_HALF_RATIO;
    const a1 = lambdaA * FIRST_HALF_RATIO;
    const h2 = lambdaH * SECOND_HALF_RATIO;
    const a2 = lambdaA * SECOND_HALF_RATIO;

    // half-time outcomes
    const HALF_MAX = 4;
    let halfHome = 0, halfDraw = 0, halfAway = 0;
    const halfHomeMatrix: number[] = []; // prob of each home score at HT given HT home win (index=homeGoals)
    const halfAwayMatrix: number[] = []; // given HT away win
    const halfDrawScores: { h: number; a: number; p: number }[] = [];

    for (let hh = 0; hh <= HALF_MAX; hh++) {
      for (let ha = 0; ha <= HALF_MAX; ha++) {
        const p = poissonPmf(hh, h1) * poissonPmf(ha, a1);
        if (hh > ha) halfHome += p;
        else if (hh === ha) halfDraw += p;
        else halfAway += p;
      }
    }

    // full-time outcome given half-time outcome (second half independent Poisson added)
    // Compute 3x3 joint: P(HT_win & FT_win), P(HT_win & FT_draw), P(HT_win & FT_lose), etc.
    const HF_CODES: Array<{ half: '胜' | '平' | '负'; full: '胜' | '平' | '负'; code: string }> = [
      { half: '胜', full: '胜', code: '胜胜' },
      { half: '胜', full: '平', code: '胜平' },
      { half: '胜', full: '负', code: '胜负' },
      { half: '平', full: '胜', code: '平胜' },
      { half: '平', full: '平', code: '平平' },
      { half: '平', full: '负', code: '平负' },
      { half: '负', full: '胜', code: '负胜' },
      { half: '负', full: '平', code: '负平' },
      { half: '负', full: '负', code: '负负' },
    ];

    const halfFullProb: { code: string; prob: number }[] = [];

    // For each HT outcome, compute FT outcome probabilities by convolving second half
    const SECOND_HALF_MAX = 6;

    const computeFtGivenHt = (
      hScoreAtHt: number,
      aScoreAtHt: number,
    ): { ftHome: number; ftDraw: number; ftAway: number } => {
      let ftHome = 0, ftDraw = 0, ftAway = 0;
      for (let h2g = 0; h2g <= SECOND_HALF_MAX; h2g++) {
        for (let a2g = 0; a2g <= SECOND_HALF_MAX; a2g++) {
          const p = poissonPmf(h2g, h2) * poissonPmf(a2g, a2);
          const fh = hScoreAtHt + h2g;
          const fa = aScoreAtHt + a2g;
          if (fh > fa) ftHome += p;
          else if (fh === fa) ftDraw += p;
          else ftAway += p;
        }
      }
      const sum = ftHome + ftDraw + ftAway;
      if (sum <= 0) return { ftHome: 0, ftDraw: 0, ftAway: 0 };
      return { ftHome: ftHome / sum, ftDraw: ftDraw / sum, ftAway: ftAway / sum };
    };

    // For HT home win: use typical scoreline (1-0 most common)
    // Approximate by computing average home lead in home-win half-times
    // Simplification: use modal HT score for each HT outcome
    const computeJoint = (): void => {
      // Enumerate all half-time scores and sum probability of each (ht, ft) combination
      const joint: Record<string, number> = {
        '胜胜': 0, '胜平': 0, '胜负': 0,
        '平胜': 0, '平平': 0, '平负': 0,
        '负胜': 0, '负平': 0, '负负': 0,
      };
      for (let hh = 0; hh <= HALF_MAX; hh++) {
        for (let ha = 0; ha <= HALF_MAX; ha++) {
          const htProb = poissonPmf(hh, h1) * poissonPmf(ha, a1);
          if (htProb <= 0) continue;
          const ft = computeFtGivenHt(hh, ha);
          let htLabel: '胜' | '平' | '负';
          if (hh > ha) htLabel = '胜';
          else if (hh === ha) htLabel = '平';
          else htLabel = '负';
          joint[`${htLabel}胜`] += htProb * ft.ftHome;
          joint[`${htLabel}平`] += htProb * ft.ftDraw;
          joint[`${htLabel}负`] += htProb * ft.ftAway;
        }
      }
      // normalize all 9 to sum=100
      const total = Object.values(joint).reduce((s, v) => s + v, 0);
      if (total <= 0) return;
      const items: { code: string; prob: number }[] = [];
      for (const entry of HF_CODES) {
        const rawPct = (joint[entry.code] / total) * 100;
        items.push({ code: entry.code, prob: Math.max(1, Math.round(rawPct)) });
      }
      // fix sum to 100
      const sumPct = items.reduce((s, it) => s + it.prob, 0);
      if (sumPct !== 100) {
        const diff = 100 - sumPct;
        items.sort((a, b) => b.prob - a.prob);
        items[0].prob += diff;
        if (items[0].prob < 1) items[0].prob = 1;
      }
      // sort by original order for output
      items.sort((a, b) => {
        const ia = HF_CODES.findIndex((c) => c.code === a.code);
        const ib = HF_CODES.findIndex((c) => c.code === b.code);
        return ia - ib;
      });
      for (const it of items) {
        halfFullProb.push({ code: it.code, prob: it.prob });
      }
    };
    computeJoint();

    const bestScore = allScores[0];
    let mostLikelyScore = `${bestScore.h}-${bestScore.a}`;

    // scoreProbs: raw joint probabilities from full matrix, top 5, NO renormalization
    const scoreProbs: string[] = [];
    const top5Raw = allScores.slice(0, 5);
    for (const s of top5Raw) {
      const pct = Math.max(1, Math.round(s.prob * 100));
      scoreProbs.push(`${s.h}-${s.a} ${pct}%`);
    }

    // Hard self-checks (fail-safe): if violated, fall back to adjusted lambdas
    // Checks: single score <= 20%, top5 sum in [30%, 75%], wdw err <=8%, ou err <=10%
    const topSum = top5Raw.reduce((s, it) => s + it.prob, 0);
    const maxSingle = allScores[0].prob;
    const wdwMaxErr = Math.max(
      Math.abs(matHomePct - homeWinProb),
      Math.abs(matDrawPct - drawProb),
      Math.abs(matAwayPct - awayWinProb),
    );
    const ouErr = Math.abs(matOverPct - overProb);

    if (
      maxSingle > 0.20 ||
      topSum < 0.30 ||
      topSum > 0.75 ||
      wdwMaxErr > 8 ||
      ouErr > 10
    ) {
      // Conservative fallback: flatten distribution by adding spread (increase total goals + balance)
      // Simply expand totalLambda by 20% and reduce diff by 20%, then recompute
      let fallbackLH = lambdaH * 1.15 + 0.1;
      let fallbackLA = lambdaA * 1.15 + 0.1;
      const fbResult = buildMatrix(fallbackLH, fallbackLA);
      // rebuild allScores
      const fbScores: { h: number; a: number; prob: number }[] = [];
      for (let h = 0; h <= SCORE_MAX; h++) {
        for (let a = 0; a <= SCORE_MAX; a++) {
          fbScores.push({ h, a, prob: fbResult.matrix[h][a] });
        }
      }
      fbScores.sort((a, b) => b.prob - a.prob);
      const fbTopSum = fbScores.slice(0, 5).reduce((s, it) => s + it.prob, 0);
      const fbMax = fbScores[0].prob;
      const fbHomePct = Math.round(fbResult.home * 100);
      const fbDrawPct = Math.round(fbResult.draw * 100);
      const fbAwayPct = 100 - fbHomePct - fbDrawPct;
      const fbOverPct = Math.round(fbResult.over * 100);
      const fbWdwErr = Math.max(
        Math.abs(fbHomePct - homeWinProb),
        Math.abs(fbDrawPct - drawProb),
        Math.abs(fbAwayPct - awayWinProb),
      );
      const fbOuErr = Math.abs(fbOverPct - overProb);

      // Only use fallback if it actually improves the worst violation
      const fallbackBetter =
        fbMax <= 0.22 &&
        fbTopSum >= 0.25 && fbTopSum <= 0.80 &&
        fbWdwErr <= 12 && fbOuErr <= 15;

      if (fallbackBetter) {
        for (let h = 0; h <= SCORE_MAX; h++)
          for (let a = 0; a <= SCORE_MAX; a++)
            scoreMatrix[h][a] = fbResult.matrix[h][a];
        allScores.length = 0;
        allScores.push(...fbScores);

        mostLikelyScore = `${fbScores[0].h}-${fbScores[0].a}`;

        scoreProbs.length = 0;
        for (const s of fbScores.slice(0, 5)) {
          const pct = Math.max(1, Math.round(s.prob * 100));
          scoreProbs.push(`${s.h}-${s.a} ${pct}%`);
        }
      }
    }

    // 10. Model rules
    const modelRules: string[] = [];
    modelRules.push('R20 胜负平基线模型');
    if (Math.abs(handicap) >= 2) {
      modelRules.push('R20a 深指数档位（≥2球）');
    } else if (Math.abs(handicap) >= 1) {
      modelRules.push('R20b 中指数档位（1球）');
    } else {
      modelRules.push('R20c 浅指数档位（<1球）');
    }
    if (homeWinProb > awayWinProb) {
      modelRules.push('R20d 主队优势倾向');
    } else if (awayWinProb > homeWinProb) {
      modelRules.push('R20d 客队优势倾向');
    } else {
      modelRules.push('R20d 势均力敌');
    }
    if (handicap === 1 && homeWinProb >= 45 && homeWinProb <= 65) {
      modelRules.push('R24 让1球中段观望（p.46-.74）');
    }
    if (handicap === 2 && homeWinProb > 60) {
      modelRules.push('R31 让2球深指数推荐让负（p<.85）');
    }
    if (drawWarning) {
      modelRules.push('R38 胶着场防平（平局率33%）');
    }
    if (finalLowConfidence) {
      modelRules.push('R39 低信心双选');
    }
    modelRules.push('R65 让球三向判定（v9.0）');
    modelRules.push('R66 大小球系统性看小修正（λ×1.08）');
    modelRules.push('R80 v8.0 大小球基准上修10%（纠正系统性看小偏差）');
    if (leagueTilt > 0) {
      modelRules.push('R67 德甲联赛倾向偏大');
    } else if (leagueTilt < 0) {
      modelRules.push('R67 意甲/法甲联赛倾向偏小');
    }
    // v12.0 大小球信心规则（取消观望闸门）
    if (goalsConfidence === '高') {
      modelRules.push('R25b v7.0 大小球高信心（差值≥0.9且概率≥70%）');
    } else if (goalsConfidence === '中') {
      modelRules.push('R25a v9.0 大小球中信心（差值≥0.4且概率≥55%）');
    } else {
      modelRules.push('R25c v12.0 大小球低信心（有方向，概率<55%或差值<0.4）');
    }

    // 确保至少一条基础规则
    if (modelRules.length === 0) {
      modelRules.push('R01 指数基准模型');
    }

    // 让球推荐最终兜底（确保非空字符串）
    if (!handicapRecommendation) {
      handicapRecommendation = '观望';
    }

    // 大小球推荐最终兜底（确保非空字符串）
    if (!totalPick) {
      totalPick = '大球';
    }

    // 胜平负方向最终兜底
    if (!predictionDirection) {
      predictionDirection = '主胜';
    }

    // ========== v12.0 三项规则改进 ==========
    // R81 中信心段保守化：confidence ∈ [58, 65)
    //   - 胜负方向保留，confidence 上限压至 60，标记 lowConfidence=true
    //   - 让球/大小球方向保留，不再因中信心段而观望（v12.0 取消观望门槛）
    //   - 仅降信心标记，方向保持不变
    const midConfidenceRange = confidence >= 58 && confidence < 65;
    let finalConfidence = confidence;
    let finalLow = finalLowConfidence;
    let finalHandicap = handicapRecommendation;
    let finalHandicapPickProb = Math.max(handicapWinProb, handicapLoseProb);
    let finalTotalPick = totalPick;
    let finalTotalPickProb = totalPickProb;

    if (midConfidenceRange) {
      finalConfidence = Math.min(finalConfidence, 60);
      finalLow = true;
      modelRules.push('R81 v12.0 中信心段保守化（[58,65) → cap60+低信心，保留方向）');
    }

    // R82 杯赛/两回合降权（v12.0 取消观望，仅降信心）
    //   - 保留方向，信心统一下调 8 个百分点
    //   - 胜率差小的场次标低信心，但方向仍给出（最高项即方向）
    const cupKeywords = ['杯', '欧冠', '欧罗巴', '欧联', '欧协', '欧会杯', '亚冠', '解放者', '世俱', '英联杯', '足总杯', '联赛杯'];
    const lgLower = (league || '').toLowerCase();
    const isCupMatch = cupKeywords.some((kw: string) => lgLower.includes(kw.toLowerCase()));
    if (isCupMatch) {
      finalConfidence = Math.max(15, finalConfidence - 8);
      finalLow = true;
      const winDiff = Math.abs(homeWinProb - awayWinProb);
      if (winDiff < 25) {
        modelRules.push('R82 v12.0 杯赛低信心（胜率差<25%，保留方向）');
      } else if (winDiff >= 25 && winDiff < 40) {
        modelRules.push('R82 v12.0 杯赛低信心出方向（胜率差25-40%，信心-8）');
      }
      modelRules.push('R82 v12.0 杯赛整体降权（confidence -8，保留方向）');
    }

    // R80 高信心大球保持强推（概率≥70% 且预期与指数线差值≥0.9）
    // 已由 goalsConfidence='高' 分支保证，此处再兜底确认
    if (goalsConfidence === '高' && overProb >= underProb && totalPickProb >= 70) {
      if (finalTotalPick === '观望') {
        finalTotalPick = '大球';
        finalTotalPickProb = totalPickProb;
      }
      if (!modelRules.includes('R80b v8.0 高信心大球强推（≥70%+差≥0.9）')) {
        modelRules.push('R80b v8.0 高信心大球强推（≥70%+差≥0.9）');
      }
    }

    if (Number.isNaN(finalConfidence) || Number.isNaN(homeWinProb) || Number.isNaN(awayWinProb)) {
      return null;
    }

    return {
      homeWinProb,
      drawProb,
      awayWinProb,
      predictionDirection,
      confidence: finalConfidence,
      lowConfidence: finalLow,
      drawWarning,
      handicapRecommendation: finalHandicap,
      handicapWinProb,
      handicapDrawProb,
      handicapLoseProb,
      handicapSecondChoice: secondHandicap === 'win' ? '让胜' : secondHandicap === 'draw' ? '让平' : '让负',
      overProb,
      underProb,
      totalPick: finalTotalPick,
      totalPickProb: finalTotalPickProb,
      mostLikelyScore,
      scoreProbs,
      totalGoalsProb,
      halfFullProb,
      modelRules: [...modelRules, ...strengthFactors],
    };
  }

  // --- Basketball handicap / total pick from raw odds ---
  // Used when moneyline odds are missing but spread / total odds are provided.

  private generateBasketballHandicapFromOdds(
    handicapOddsHome: number,
    handicapOddsAway: number,
  ): { handicapRecommendation: string; homeCoverProb: number } | null {
    if (handicapOddsHome <= 0 || handicapOddsAway <= 0) return null;
    const invH = 1 / handicapOddsHome;
    const invA = 1 / handicapOddsAway;
    const totalInv = invH + invA;
    if (totalInv <= 0) return null;
    const homeCoverProb = Math.round((invH / totalInv) * 100);
    return {
      homeCoverProb,
      handicapRecommendation: homeCoverProb >= 50 ? '让分主胜' : '让分客胜',
    };
  }

  // --- Prediction generation: basketball ---

  isBasketballLineValid(
    league: string,
    lineType: 'spread' | 'total',
    lineValue: number,
  ): boolean {
    if (!lineValue || Number.isNaN(lineValue)) return false;
    const key = this.leagueKey(league);
    let spreadMax = 25;
    let totalMin = 130;
    let totalMax = 200;
    switch (key) {
      case 'NBA':
        spreadMax = 25;
        totalMin = 180;
        totalMax = 250;
        break;
      case 'WNBA':
        spreadMax = 25;
        totalMin = 130;
        totalMax = 200;
        break;
      case 'NBL':
      case '澳NBL':
      case '澳大利亚NBL':
        spreadMax = 25;
        totalMin = 150;
        totalMax = 210;
        break;
      case '欧篮联':
      case '欧洲杯':
      case '西班牙ACB':
      case '德甲':
      case '法甲':
      case '意甲':
      case '希腊联赛':
      case '土耳其联赛':
      case 'VTB':
        spreadMax = 30;
        totalMin = 130;
        totalMax = 200;
        break;
      case 'CBA':
        spreadMax = 30;
        totalMin = 150;
        totalMax = 220;
        break;
      default:
        spreadMax = 40;
        totalMin = 100;
        totalMax = 250;
    }
    if (lineType === 'spread') {
      return Math.abs(lineValue) > 0 && Math.abs(lineValue) <= spreadMax;
    }
    return lineValue >= totalMin && lineValue <= totalMax;
  }

  hasValidInjuries(injuries: unknown): boolean {
    if (!injuries) return false;
    try {
      const obj = typeof injuries === 'string'
        ? JSON.parse(injuries) as Record<string, unknown>
        : (injuries as Record<string, unknown>);
      const hasHome = Array.isArray(obj.home) && obj.home.length > 0;
      const hasAway = Array.isArray(obj.away) && obj.away.length > 0;
      return hasHome || hasAway;
    } catch {
      return false;
    }
  }

  private applyBasketballFinalCalibrations<T extends {
    handicapRecommendation: string;
    totalDirection: string;
    confidence: number;
    modelRules: string[];
    handicapLineNum?: number;
    handicapConfidence?: string;
    handicapPickProb?: number | null;
    handicapCoverProb?: number | null;
  }>(pred: T): T {
    const lineAbs = Math.abs(pred.handicapLineNum ?? 0);
    const isLetAway = pred.handicapRecommendation === '让分客胜';
    const isLetHome = pred.handicapRecommendation === '让分主胜';
    const isOver = pred.totalDirection === '大分';
    let result = { ...pred };
    // V11.8 让客浅盘信心上限70%
    if (isLetAway && lineAbs > 0 && lineAbs < 6 && result.confidence > 70) {
      result.confidence = 70;
      if (!result.modelRules.some((r: string) => r.startsWith('V11.8 让客信心收缩'))) {
        result.modelRules = [...result.modelRules, 'V11.8 让客信心收缩：最终信心上限70%'];
      }
    }
    // V11.4 让客深盘55%上限（6≤|线|<10）
    if (isLetAway && lineAbs >= 6 && lineAbs < 10 && result.confidence > 55) {
      result.confidence = 55;
      if (!result.modelRules.some((r: string) => r.startsWith('V11.4 让客深盘降权：最终信心'))) {
        result.modelRules = [...result.modelRules, `V11.4 让客深盘降权：最终信心上限55%（|线|=${lineAbs.toFixed(1)}分）`];
      }
    }
    // V11.10 让主深盘70%上限（6≤|线|<10）
    if (isLetHome && lineAbs >= 6 && lineAbs < 10 && result.confidence > 70) {
      result.confidence = 70;
      if (!result.modelRules.some((r: string) => r.startsWith('V11.10 让主深盘降权'))) {
        result.modelRules = [...result.modelRules, `V11.10 让主深盘降权：最终信心上限70%（|线|=${lineAbs.toFixed(1)}分）`];
      }
    }
    // V11.13a 让客信心全线下压：≥68%→65%
    if (isLetAway && result.confidence >= 68) {
      result.confidence = 65;
      if (!result.modelRules.some((r: string) => r.startsWith('V11.13a 让客信心全线下压'))) {
        result.modelRules = [...result.modelRules, 'V11.13a 让客信心全线下压：高信心统一上限65%'];
      }
    }
    // V11.13b 大分方向信心收缩：>62%→62%
    if (isOver && result.confidence > 62) {
      result.confidence = 62;
      if (!result.modelRules.some((r: string) => r.startsWith('V11.13b 大分方向信心收缩'))) {
        result.modelRules = [...result.modelRules, 'V11.13b 大分方向信心收缩：上限62%'];
      }
    }
    // V11.13c 高信心门槛上调：非让客非大分 65-67%→64%
    if (!isLetAway && !isOver && result.confidence >= 65 && result.confidence < 68) {
      result.confidence = 64;
      if (!result.modelRules.some((r: string) => r.startsWith('V11.13c 高信心门槛上调'))) {
        result.modelRules = [...result.modelRules, 'V11.13c 高信心门槛上调：65-67%降为中信心'];
      }
    }
    // V11.14b 让主深盘上限66%（|线|≥8.5）
    if (isLetHome && lineAbs >= 8.5 && result.confidence > 66) {
      result.confidence = 66;
      if (!result.modelRules.some((r: string) => r.startsWith('V11.14b 让主深盘上限66%'))) {
        result.modelRules = [...result.modelRules, 'V11.14b 让主深盘上限66%：|线|≥8.5分'];
      }
    }
    if (result.handicapRecommendation !== '观望' && result.confidence <= 55) {
      result.handicapRecommendation = '观望';
      result.handicapConfidence = '观望';
      result.handicapPickProb = 0;
      result.handicapCoverProb = 0;
      if (!result.modelRules.some((r: string) => r.startsWith('V11.14a 让分低信心降级观望'))) {
        result.modelRules = [...result.modelRules, 'V11.14a 让分低信心降级观望：信心≤55%降为观望'];
      }
    }
    return result;
  }

  private ensureBasketballPredictionSelfConsistent<T extends {
    totalDirection: string;
    predictedTotal: number;
    predictedHomeScore: number;
    predictedAwayScore: number;
    modelRules: string[];
  }>(pred: T, totalLineNum: number): T {
    if (!totalLineNum || totalLineNum <= 0) return pred;
    if (pred.totalDirection !== '大分' && pred.totalDirection !== '小分') return pred;

    const isOver = pred.totalDirection === '大分';
    const diff = pred.predictedTotal - totalLineNum;
    const directionMatches = isOver ? diff >= 0 : diff <= 0;

    if (directionMatches) return pred;

    const alignedTotal = isOver ? totalLineNum + 0.1 : totalLineNum - 0.1;
    const totalDelta = alignedTotal - pred.predictedTotal;
    const halfDelta = totalDelta / 2;

    return {
      ...pred,
      predictedTotal: Math.round(alignedTotal * 10) / 10,
      predictedHomeScore: Math.round(pred.predictedHomeScore + halfDelta),
      predictedAwayScore: Math.round(pred.predictedAwayScore + halfDelta),
      modelRules: [...pred.modelRules, '自洽校准：预期总分与方向对齐至贴线临界'],
    };
  }

  generateBasketballPrediction(
    homeWinOdds: number,
    awayWinOdds: number,
    handicapStr: string,
    totalLineStr?: string,
    league = 'default',
    stage = '',
    options?: {
       coreInjuriesHome?: number;
       coreInjuriesAway?: number;
       freshWeightedInjuriesHome?: number;
       freshWeightedInjuriesAway?: number;
       freshCoreInjuriesHome?: number;
       freshCoreInjuriesAway?: number;
      strongTeamLocked?: boolean;
      homePpg?: number;
       awayPpg?: number;
       homeOppg?: number;
       awayOppg?: number;
       leagueAvgPpg?: number;
      kickoffMonth?: number;
      favoriteTeamSide?: 'home' | 'away' | null;
      favoriteCoreInjuries?: number;
      intelData?: IntelData | null;
       handicapLineNum?: number | null;
       totalLineNum?: number | null;
        teamStats?: {
          home?: Record<string, unknown>;
          away?: Record<string, unknown>;
        };
         eloHome?: number;
         eloAway?: number;
         eloGap?: number;
         recent10HomePpg?: number;
         recent10AwayPpg?: number;
         recent10HomeOppg?: number;
         recent10AwayOppg?: number;
         recent20HomePpg?: number;
         recent20AwayPpg?: number;
         recent20HomeOppg?: number;
         recent20AwayOppg?: number;
         recentSampleCount?: number;
          playoffSeriesGames?: Array<{ totalScore: number; totalLine: number; gameNumber: number }>;
          openTotalLineNum?: number;
          rowIntel?: {
         h2hHistory?: unknown;
         injuries?: unknown;
         recentForm?: unknown;
         keyPlayers?: unknown;
         teamNews?: string | null;
         homeTeam?: string;
         awayTeam?: string;
         teamStats?: {
           home?: Record<string, unknown>;
           away?: Record<string, unknown>;
         };
       };
     },
  ): {
    homeWinProb: number;
    awayWinProb: number;
    predictionDirection: string;
    confidence: number;
    lowConfidence: boolean;
    handicapRecommendation: string;
    handicapCoverProb: number;
    handicapPickProb: number;
    totalDirection: string;
    overProb: number;
    underProb: number;
    totalPickProb: number;
    modelRules: string[];
    predictedHomeScore: number;
    predictedAwayScore: number;
    predictedTotal: number;
    handicapConfidence: '高' | '中' | '低';
    ouConfidence: '高' | '中' | '低';
    ouDiffVsLine: number;
    adjustBreakdown: Record<string, number>;
    predEngineVersion: string;
  } | null {
    const handicapVal = Number(handicapStr) || 0;
    const totalValV10 = totalLineStr ? Number(totalLineStr) : 0;
    const favoriteTeamSide = options?.favoriteTeamSide ?? (handicapVal < 0 ? 'home' : handicapVal > 0 ? 'away' : null);

    let intelData: IntelData | null = null;
    if (options?.intelData) {
      intelData = options.intelData;
    } else if (options?.rowIntel) {
      intelData = parseIntelFromRow(options.rowIntel);
    }

    const injuryCounts = intelData ? countCoreInjuriesFromIntel(intelData) : null;
    const computedCoreHome = options?.coreInjuriesHome ?? injuryCounts?.homeCore ?? 0;
    const computedCoreAway = options?.coreInjuriesAway ?? injuryCounts?.awayCore ?? 0;
    const computedWeightedHome = injuryCounts?.homeWeighted;
    const computedWeightedAway = injuryCounts?.awayWeighted;

    const freshWeightedHome = options?.freshWeightedInjuriesHome ?? computedWeightedHome;
    const freshWeightedAway = options?.freshWeightedInjuriesAway ?? computedWeightedAway;
    const freshCoreHome = options?.freshCoreInjuriesHome ?? computedCoreHome;
    const freshCoreAway = options?.freshCoreInjuriesAway ?? computedCoreAway;

    let teamStatsForModel: { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined = options?.teamStats;
    if (!teamStatsForModel && options?.rowIntel?.teamStats) {
      teamStatsForModel = options.rowIntel.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> };
    }

    const v10Result = this.anchorPrediction.predict({
      handicapLineNum: handicapVal !== 0 ? handicapVal : null,
      totalLineNum: totalValV10 > 0 ? totalValV10 : null,
      league,
      kickoffMonth: options?.kickoffMonth,
      homePpg: options?.homePpg,
      awayPpg: options?.awayPpg,
      homeOppg: options?.homeOppg,
      awayOppg: options?.awayOppg,
      leagueAvgPpg: options?.leagueAvgPpg,
      coreInjuriesHome: computedCoreHome,
      coreInjuriesAway: computedCoreAway,
      weightedInjuriesHome: computedWeightedHome,
      weightedInjuriesAway: computedWeightedAway,
      freshWeightedInjuriesHome: freshWeightedHome,
      freshWeightedInjuriesAway: freshWeightedAway,
      freshCoreInjuriesHome: freshCoreHome,
      freshCoreInjuriesAway: freshCoreAway,
      favoriteTeamSide,
      favoriteCoreInjuries: options?.favoriteCoreInjuries ?? (
        favoriteTeamSide === 'home' ? computedCoreHome : favoriteTeamSide === 'away' ? computedCoreAway : 0
      ),
      homeWinOdds: homeWinOdds > 0 ? homeWinOdds : undefined,
      awayWinOdds: awayWinOdds > 0 ? awayWinOdds : undefined,
       stage,
       homeTeam: options?.intelData?.homeTeam,
       awayTeam: options?.intelData?.awayTeam,
        teamStats: teamStatsForModel,
       eloHome: options?.eloHome,
       eloAway: options?.eloAway,
       eloGap: options?.eloGap,
       recent10HomePpg: options?.recent10HomePpg,
       recent10AwayPpg: options?.recent10AwayPpg,
       recent10HomeOppg: options?.recent10HomeOppg,
       recent10AwayOppg: options?.recent10AwayOppg,
       recent20HomePpg: options?.recent20HomePpg,
       recent20AwayPpg: options?.recent20AwayPpg,
       recent20HomeOppg: options?.recent20HomeOppg,
       recent20AwayOppg: options?.recent20AwayOppg,
       recentSampleCount: options?.recentSampleCount,
        playoffSeriesGames: options?.playoffSeriesGames,
        openTotalLineNum: options?.openTotalLineNum,
      });
    if (v10Result) {
      let intelData = options?.intelData ?? null;
      if (!intelData && options?.rowIntel) {
        intelData = parseIntelFromRow(options.rowIntel);
      }
      if (intelData) {
        let adjustments = this.intelService.computeAdjustments(intelData);
        if (adjustments.hasIntel) {
          const v11HasInjury = v10Result.modelRules?.some?.(r => typeof r === 'string' && r.includes('R-INJURY-V10'));
          const isV11Engine = v10Result.predEngineVersion?.startsWith('v11');
          if (isV11Engine && v11HasInjury && adjustments.r80Injury) {
            const r80Spread = adjustments.r80Injury.spread;
            adjustments = {
              ...adjustments,
              totalSpreadAdjust: adjustments.totalSpreadAdjust - r80Spread,
              rules: adjustments.rules.map(r =>
                r.startsWith('R80 伤停影响：')
                  ? `R80 伤停影响（净胜去重）：V11 引擎已融合伤停修正，仅保留大小分压小效应`
                  : r,
              ),
            };
          }
          const adjusted = this.intelService.applyToPrediction(
            {
              homeWinProb: v10Result.homeWinProb,
              awayWinProb: v10Result.awayWinProb,
              predictionDirection: v10Result.predictionDirection,
              handicapPick: v10Result.handicapPick,
              handicapCoverProb: v10Result.handicapCoverProb,
              handicapConfidence: v10Result.handicapConfidence,
              totalPick: v10Result.totalPick,
              overProb: v10Result.overProb,
              underProb: v10Result.underProb,
              ouConfidence: v10Result.ouConfidence,
              predictedHomeScore: v10Result.predictedHomeScore,
              predictedAwayScore: v10Result.predictedAwayScore,
              predictedTotal: v10Result.predictedTotal,
              confidence: v10Result.confidence,
              modelRules: ['V10 锚定模型基线', ...v10Result.modelRules],
              handicapLineNum: handicapVal !== 0 ? handicapVal : null,
              totalLineNum: totalValV10 > 0 ? totalValV10 : null,
              league,
              modelSpread: v10Result.modelSpread,
            },
            adjustments,
          );
          const intelResult = {
            homeWinProb: adjusted.homeWinProb,
            awayWinProb: adjusted.awayWinProb,
            predictionDirection: adjusted.predictionDirection,
            confidence: adjusted.confidence,
            lowConfidence: adjusted.handicapConfidence === '低' && adjusted.ouConfidence === '低',
            handicapRecommendation: adjusted.handicapPick,
            handicapLineNum: handicapVal !== 0 ? handicapVal : null,
            handicapCoverProb: adjusted.handicapCoverProb,
            handicapPickProb: adjusted.handicapPickProb,
            totalDirection: adjusted.totalPick,
            overProb: adjusted.overProb,
            underProb: adjusted.underProb,
            totalPickProb: adjusted.totalPickProb,
            modelRules: [...adjusted.modelRules, '情报驱动融合预测：多源情报统一汇入单一预测出口'],
            predictedHomeScore: adjusted.predictedHomeScore,
            predictedAwayScore: adjusted.predictedAwayScore,
            predictedTotal: adjusted.predictedTotal,
            handicapConfidence: adjusted.handicapConfidence,
            ouConfidence: adjusted.ouConfidence,
              ouDiffVsLine: Math.round(adjustments.totalTotalAdjust * 10) / 10,
             adjustBreakdown: {
               ...v10Result.adjustBreakdown,
               intelSpread: adjustments.totalSpreadAdjust,
               intelTotal: adjustments.totalTotalAdjust,
             },
             predEngineVersion: v10Result.predEngineVersion,
           };
            const hLineAbsV118 = Math.abs(handicapVal || 0);
            const isNbaLeague = league === 'NBA' || league === '美国职业篮球联盟' || league.includes('NBA');
            const hasV117Rule = intelResult.modelRules.some((r: string) => r.includes('V11.7 NBA赛季初稳定化（情报端）'));
            if (isNbaLeague && hasV117Rule && intelResult.confidence > 75) {
              intelResult.confidence = 75;
              intelResult.modelRules = [...intelResult.modelRules, 'V11.7 NBA赛季初稳定化：intel路径最终信心上限75%'];
            }
            const noLineFallback = handicapVal === 0 && totalValV10 === 0 && homeWinOdds <= 0 && awayWinOdds <= 0;
            const sampleCount = options?.recentSampleCount ?? 0;
            const isNbaEarlySeasonV119 = isNbaLeague && sampleCount < 5;
             if (noLineFallback && isNbaEarlySeasonV119 && intelResult.confidence > 55) {
               intelResult.confidence = 55;
               intelResult.modelRules = [...intelResult.modelRules, 'V11.9 NBA赛季初无盘口保护：intel路径信心上限55%'];
             }
             const finalized = this.applyBasketballFinalCalibrations(intelResult);
             return this.ensureBasketballPredictionSelfConsistent(finalized, totalValV10);
        }
      }
      const anchorResult = {
        homeWinProb: v10Result.homeWinProb,
        awayWinProb: v10Result.awayWinProb,
        predictionDirection: v10Result.predictionDirection,
        confidence: v10Result.confidence,
        lowConfidence: v10Result.lowConfidence,
        handicapRecommendation: v10Result.handicapRecommendation,
        handicapCoverProb: v10Result.handicapCoverProb,
        handicapPickProb: v10Result.handicapPickProb,
        handicapLineNum: handicapVal !== 0 ? handicapVal : null,
        totalDirection: v10Result.totalDirection,
        overProb: v10Result.overProb,
        underProb: v10Result.underProb,
        totalPickProb: v10Result.totalPickProb,
        modelRules: ['V10 锚定模型', ...v10Result.modelRules],
        predictedHomeScore: v10Result.predictedHomeScore,
        predictedAwayScore: v10Result.predictedAwayScore,
        predictedTotal: v10Result.predictedTotal,
        handicapConfidence: v10Result.handicapConfidence,
        ouConfidence: v10Result.ouConfidence,
        ouDiffVsLine: v10Result.ouDiffVsLine,
        adjustBreakdown: v10Result.adjustBreakdown,
         predEngineVersion: v10Result.predEngineVersion,
       };
       const finalized = this.applyBasketballFinalCalibrations(anchorResult);
       return this.ensureBasketballPredictionSelfConsistent(finalized, totalValV10);
    }

    const hasValidOdds = homeWinOdds > 0 && awayWinOdds > 0;
    const hasValidSpread = this.isBasketballLineValid(league, 'spread', handicapVal);
    const totalVal = totalLineStr ? Number(totalLineStr) : 0;
    const hasValidTotal = this.isBasketballLineValid(league, 'total', totalVal);
    const hasTeamData = (options?.homePpg ?? 0) > 0 || (options?.awayPpg ?? 0) > 0
      || !!(options?.teamStats?.home && options?.teamStats?.away)
      || !!(options?.rowIntel?.teamStats?.home && options?.rowIntel?.teamStats?.away);

    const isModelReferenceMode = !hasValidOdds && !hasValidSpread && !hasValidTotal;
    const isWeakBaselineMode = isModelReferenceMode && !hasTeamData;

    let homeWinProb: number;
    let awayWinProb: number;
    const baseline = this.getBasketballBaseline(league);
    const modelRules: string[] = [];
    if (hasValidOdds) {
      const invH = 1 / homeWinOdds;
      const invA = 1 / awayWinOdds;
      const totalInv = invH + invA;
      const rawHomeWinProb = Math.round((invH / totalInv) * 100);
      homeWinProb = Math.max(3, Math.min(97, rawHomeWinProb));
      awayWinProb = 100 - homeWinProb;
    } else if (hasValidSpread) {
      const lineAbs = Math.abs(handicapVal);
      // v8.1 用 logistic 公式从让分线推导真实胜率（让分线≈预期净胜分）
      // 原线性公式(0.5+lineAbs/30*0.25)严重低估胜率，导致让分推荐方向全偏
      // 正确关系：expectedMargin = 13 * log(p/(1-p)) → p = 1/(1+exp(-lineAbs/13))
      const winRate = 1 / (1 + Math.exp(-lineAbs / 13));
      const prob = Math.round(winRate * 100);
      if (handicapVal < 0) {
        homeWinProb = prob;
      } else {
        homeWinProb = 100 - prob;
      }
      homeWinProb = Math.max(20, Math.min(80, homeWinProb));
      awayWinProb = 100 - homeWinProb;
    } else if (isModelReferenceMode && hasTeamData) {
      const homeP = options?.homePpg ?? baseline.total / 2;
      const awayP = options?.awayPpg ?? baseline.total / 2;
      const homeAdv = 3;
      const expectedMargin = homeP - awayP + homeAdv;
      const sigma = baseline.handicapStd || 10;
      const z = expectedMargin / sigma;
      const erfApprox = (x: number): number => {
        const t = 1 / (1 + 0.3275911 * Math.abs(x));
        const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
        return x >= 0 ? y : -y;
      };
      const winRate = 0.5 * (1 + erfApprox(z / Math.SQRT2));
      homeWinProb = Math.max(10, Math.min(90, Math.round(winRate * 100)));
      awayWinProb = 100 - homeWinProb;
      modelRules.push('R84 v9.0 模型参考模式：基于攻防效率+主场优势的胜负概率');
    } else if (isWeakBaselineMode) {
      homeWinProb = 50;
      awayWinProb = 50;
      modelRules.push('R87 v9.0 弱基线模式：数据不足，胜负方向观望');
    } else {
      homeWinProb = 50;
      awayWinProb = 50;
    }


    const predictionDirection = isWeakBaselineMode ? '观望'
      : homeWinProb >= awayWinProb ? '主胜' : '客胜';
    const maxProb = Math.max(homeWinProb, awayWinProb);
    let confidence = Math.max(15, Math.min(80, maxProb));
    let lowConfidence = Math.abs(homeWinProb - awayWinProb) < 10;

    const isFiba = baseline.isFiba;
    const isWnba = this.leagueKey(league) === 'WNBA';

    // --- 预期净胜分（logistic近似）---
    const lineAbs = Math.abs(handicapVal);
    const winRate = Math.max(0.05, Math.min(0.95, homeWinProb / 100));
    let expectedHomeMargin = 13 * Math.log(winRate / (1 - winRate));

    // 强队与让分方向：handicap<0 主队让分→强队是主队；handicap>0 主队受让→强队是客队
    const strongTeamIsHome = handicapVal < 0;

    // --- 让分独立预期净胜分模型（v7.2）---
    // 基础：从指数推导的净胜分（市场共识）
    // 独立调整：赛季阶段、伤停、战意/强弱差等 → 转换为分差 → 正态CDF算过线概率
    // 目的：概率真实反映模型独立判断，有分化（40%~70%+），不被压成常数
    // v7.3 小样本联赛（<30场）默认低信心/观望，样本充足再放开
    if (baseline.sampleCount < 30) {
      lowConfidence = true;
      modelRules.push(`R48 v7.3 小样本联赛(${baseline.sampleCount}场)默认低信心`);
    }
    const coreInjuriesStrong = strongTeamIsHome
      ? computedCoreHome
      : computedCoreAway;
    const strongTeamLocked = options?.strongTeamLocked ?? false;

    const leagueKeyName = this.leagueKey(league);
    modelRules.push(`R40 ${leagueKeyName}联赛基准：${baseline.total}分`);
    if (lineAbs >= 15) {
      modelRules.push('R40a 超深盘档位（≥15分）');
    } else if (lineAbs >= 10) {
      modelRules.push('R40b 深盘档位（10-15分）');
    } else if (lineAbs >= 5) {
      modelRules.push('R40c 中盘档位（5-10分）');
    } else if (lineAbs >= 3.5) {
      modelRules.push('R40d 浅盘档位（3.5-5分）');
    } else {
      modelRules.push('R40e 边缘盘档位（<3.5分）');
    }
    if (strongTeamIsHome) {
      modelRules.push('R40f 强队主场加持');
    }

    const kickoffMonth = options?.kickoffMonth ?? 0;
    const isSeasonStart = isWnba && (kickoffMonth === 5 || kickoffMonth === 7);
    const isSeasonEnd = isWnba && kickoffMonth === 9;
    const hasStakes = !strongTeamLocked;

    // 独立预期净胜分（独立于指数线的模型判断，单位：分）
    // 基础：从胜负指数推导的净胜分（市场共识）
    let independentMargin = expectedHomeMargin;
    // 累计调整分（独立信号）
    const marginAdjustments: string[] = [];

    // v7.0 热门方核心缺阵判定：仅当明确指定且>=1时，才认为是热门方自己的球星缺阵
    const favoriteSide = options?.favoriteTeamSide ?? null;
    const favoriteCoreInjuries = options?.favoriteCoreInjuries ?? (
      favoriteSide === 'home' ? computedCoreHome : favoriteSide === 'away' ? computedCoreAway : 0
    );
    const confirmedFavoriteStarOut =
      favoriteSide !== null && favoriteCoreInjuries >= 1;

    // v7.3 FIBA女子深盘过线阈值上调：由|线|≥15调到≥20，且过线强度打折
    const deepLineThreshold = isFiba && baseline.total <= 160 ? 20 : 15;
    const deepLineDiscount = isFiba && baseline.total <= 160 ? 0.7 : 1.0;
    if (deepLineThreshold !== 15) {
      modelRules.push(`R49 v7.3 FIBA女子深盘阈值上调至${deepLineThreshold}分(强度×${deepLineDiscount})`);
    }

    // 情景1：超深盘赛季阶段调整（回测验证）
    if (lineAbs >= deepLineThreshold) {
      modelRules.push('R41 v7.2 超深盘赛季阶段独立调整');
       if (isSeasonEnd && hasStakes) {
         // 赛季末强队过线约80% → 净胜分比指数线多约 0.84*sigma（Φ(0.84)=0.80）
         const extra = 0.84 * baseline.handicapStd * deepLineDiscount;
         independentMargin += strongTeamIsHome ? extra : -extra;
         marginAdjustments.push(`赛季末超深盘+${extra.toFixed(1)}分`);
         modelRules.push('R41a 赛季末超深盘强队过线（+独立优势）');
       } else if (isSeasonStart) {
         // 赛季初强队过线仅约32% → 净胜分比指数线少约 0.47*sigma
         const shortfall = 0.47 * baseline.handicapStd * deepLineDiscount;
         independentMargin += strongTeamIsHome ? -shortfall : shortfall;
        marginAdjustments.push(`赛季初超深盘-${shortfall.toFixed(1)}分`);
        modelRules.push('R41b 赛季初超深盘倾向弱队（-独立优势）');
      } else {
        modelRules.push('R41c 超深盘无赛季阶段信息→按独立预期');
      }
    } else if (lineAbs <= 3.5) {
      // 情景2：边缘盘核心缺阵调整（回测约69%弱队赢）
      modelRules.push('R44 v7.2 边缘盘独立判断');
      if (confirmedFavoriteStarOut) {
        // 热门方核心缺阵 → 弱队侧概率约69% → z=0.50 → 0.50*sigma 分差
        const swing = 0.50 * baseline.handicapStd;
        independentMargin += strongTeamIsHome ? -swing : swing;
        marginAdjustments.push(`热门核心缺阵${favoriteCoreInjuries}人-${swing.toFixed(1)}分`);
        modelRules.push(`R44a 热门核心缺阵(${favoriteCoreInjuries}人)→独立倾向弱队`);
      } else {
        // 无明确核心缺阵 → 基于独立预期正常给方向
        modelRules.push('R44b 边缘盘无明确核心缺阵→按独立预期');
      }
    } else {
      // 浅中盘：独立调整量 = 伤停+战意+节奏（若有）
      modelRules.push('R43 v7.2 浅中盘按独立预期给方向');
      // 强队有战意时 +1分独立优势（轻微）
      if (hasStakes && strongTeamIsHome) {
        independentMargin += 0.5;
        marginAdjustments.push('强队主场+0.5分');
      }
    }

    // 通用伤停调整：热门方核心缺阵（非边缘盘也生效，幅度减半）
    if (confirmedFavoriteStarOut && lineAbs > 3.5) {
      const swing = 0.30 * baseline.handicapStd;
      independentMargin += strongTeamIsHome ? -swing : swing;
      marginAdjustments.push(`核心缺阵非边缘盘-${swing.toFixed(1)}分`);
      modelRules.push('R44c 热门核心缺阵（非边缘盘）→部分调整');
    }

    // v7.3 客队热门降权按联赛差异化：
    // WNBA保留全量降权（客队热门过线率系统性偏低），其他男联赛不应用降权
    const favoriteIsAway = handicapVal > 0;
    if (favoriteIsAway && isWnba) {
      const awayFavPenalty = 1.5;
      independentMargin += awayFavPenalty;
      marginAdjustments.push(`客队热门降权+${awayFavPenalty}分`);
      modelRules.push('R45 v7.3 WNBA客队热门降权（回测过线率仅42.3%）');
      if (lineAbs >= 3.5 && lineAbs <= 6) {
        independentMargin += 0.8;
        marginAdjustments.push('中盘客热额外+0.8分');
        modelRules.push('R45a 中盘(3.5-6)客队热门偏弱');
      }
      if (lineAbs >= 10.5 && lineAbs <= 15) {
        independentMargin += 0.6;
        marginAdjustments.push('深盘客热额外+0.6分');
        modelRules.push('R45b 深盘(10.5-15)客队热门偏弱');
      }
      if (isSeasonEnd && lineAbs >= 8) {
        independentMargin += 1.0;
        marginAdjustments.push('赛季末客热大热门+1.0分');
        modelRules.push('R45c 赛季末/季后赛客队大热门失灵');
      }
    } else if (favoriteIsAway) {
      modelRules.push(`R45 ${this.leagueKey(league)}联赛不应用客队热门降权`);
    }

    // 让分过线概率：正态CDF计算
    // z = (independentMargin + handicapVal) / sigma  → 主队净胜分 vs 让分线
    // 正z → 主队穿让分（让分主胜概率高）
    const hcSigma = baseline.handicapStd || 6;
    const hcZ = (independentMargin + handicapVal) / hcSigma;
    const erfApprox = (x: number) => {
      const t = 1 / (1 + 0.3275911 * Math.abs(x));
      const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
      return x >= 0 ? y : -y;
    };
    const normalCdf = (z: number) => 0.5 * (1 + erfApprox(z / Math.SQRT2));
    let coverProb = normalCdf(hcZ);

    // 轻度收缩（shrinkage=0.85）：保留大部分分化，仅极端值稍微收敛
    const hcShrink = 0.85;
    coverProb = 0.5 + (coverProb - 0.5) * hcShrink;
    coverProb = Math.max(0.10, Math.min(0.90, coverProb));
    modelRules.push(`R62 v7.2 让分正态CDF+轻度收缩（sigma=${hcSigma.toFixed(1)}, shrink=${hcShrink}）`);

    // 信心分级（按概率偏离50%的程度）
    let handicapConfidence: '高' | '中' | '低' = '低';
    const hcDeviation = Math.abs(coverProb - 0.5);
    if (hcDeviation >= 0.15) {
      handicapConfidence = '高';
    } else if (hcDeviation >= 0.08) {
      handicapConfidence = '中';
    } else {
      handicapConfidence = '低';
    }

    // v7.3 边缘主队小热门季末降级：主胜概率50-56%的主队在季末/季后赛反复主场输球
    const homeProb = homeWinProb / 100;
    if (
      isSeasonEnd &&
      strongTeamIsHome &&
      homeProb >= 0.50 &&
      homeProb <= 0.56
    ) {
      if (handicapConfidence !== '低') {
        handicapConfidence = '低';
        modelRules.push('R46 v7.3 边缘主队小热门季末降级低信心');
      }
    }

    // v7.3 ±2.5边缘盘"单个核心缺阵即改向"噪声大，强制低信心
    if (lineAbs <= 2.5 && confirmedFavoriteStarOut && favoriteCoreInjuries === 1) {
      if (handicapConfidence !== '低') {
        handicapConfidence = '低';
        modelRules.push('R47 v7.3 边缘盘单核心缺阵噪声大→低信心');
      }
    }

    // R65 让分信心分级（有指数线必给方向，低概率标低信心，不再观望）
    let handicapRecommendation: string;
    if (coverProb >= 0.5) {
      handicapRecommendation = '让分主胜';
    } else {
      handicapRecommendation = '让分客胜';
    }
    modelRules.push('R65 v7.1 让分有指数线必给方向（信心分级）');

    let handicapCoverProb = Math.max(2, Math.min(98, Math.round(coverProb * 100)));

    // --- 大小分（v6.7 重构：市场指数线为锚 + 有界调整 + 2.5分推荐阈值）---
    let overProb = 50;
    let underProb = 50;
    let totalDirection = '观望';
    let ouConfidence: '高' | '中' | '低' = '低';
    let ouDiffVsLine = 0;
    const totalLineVal = totalLineStr ? Number(totalLineStr) : 0;
    const hasMarketLine = totalLineVal > 0;
    let predictedTotal = baseline.total;
    let adjustment = 0;
    const adjustBreakdown: Record<string, number> = {};

    if (hasMarketLine) {
      predictedTotal = totalLineVal;
      modelRules.push('R70 大小分以市场指数线为锚');

      // v6.7.1: 调整项分解（有符号，缺数据为0，不做机械默认）
      let stageAdjust = 0;
      let paceAdjust = 0;
      let injuryAdjust = 0;

      // 1. 阶段调整（决赛/淘汰赛）——仅明确命中才生效
      const isFinal = stage.includes('决赛') || stage.includes('金牌');
      const isPlayoff = stage.includes('淘汰') || stage.includes('季後') || stage.includes('季后');
      if (isFinal) {
        stageAdjust = isFiba ? -4 : +4;
        adjustBreakdown.stage = stageAdjust;
        modelRules.push(`R71 决赛调整${stageAdjust > 0 ? '+' : ''}${stageAdjust}分`);
      } else if (isPlayoff && isFiba) {
        stageAdjust = -3;
        adjustBreakdown.stage = stageAdjust;
        modelRules.push('R72 FIBA淘汰赛-3分');
      }

      // 1b. WNBA 赛季阶段节奏调整（v7.0 300场回测：6月+4、7月+3、8月-2.5、5/9/10月≈0）
      // 仅 WNBA 联赛且传入了开赛月份时生效；其他联赛保持 0
      let wnbaSeasonAdjust = 0;
      const kickoffMonth = options?.kickoffMonth ?? 0;
       if (isWnba && kickoffMonth >= 1 && kickoffMonth <= 12) {
         if (kickoffMonth === 6) wnbaSeasonAdjust = 4;
         else if (kickoffMonth === 7) wnbaSeasonAdjust = 3;
         else if (kickoffMonth === 8) wnbaSeasonAdjust = -2.5;
         else if (kickoffMonth === 9) wnbaSeasonAdjust = -1.5;
         else wnbaSeasonAdjust = 0; // 5/10月及其他≈0
        if (wnbaSeasonAdjust !== 0) {
          stageAdjust += wnbaSeasonAdjust;
          adjustBreakdown.wnbaSeason = wnbaSeasonAdjust;
          modelRules.push(
            `R77 WNBA赛季阶段调整${wnbaSeasonAdjust > 0 ? '+' : ''}${wnbaSeasonAdjust}分（${kickoffMonth}月）`,
          );
        }
      }

      // 2. 节奏/进攻效率调整（基于真实两队场均得分 vs 联赛均值）
      // v6.7.1: 用真实数据驱动，缺数据则为0（不猜测、不默认）
      const homePpg = options?.homePpg ?? 0;
      const awayPpg = options?.awayPpg ?? 0;
      const leagueAvg = options?.leagueAvgPpg ?? baseline.total;
      if (homePpg > 0 && awayPpg > 0 && leagueAvg > 0) {
        const avgPpg = (homePpg + awayPpg) / 2;
        const paceGap = avgPpg - leagueAvg;
        // 节奏差值的0.25倍作为调整，单端上限±2
        paceAdjust = Math.max(-2, Math.min(2, paceGap * 0.25));
        adjustBreakdown.pace = Math.round(paceAdjust * 10) / 10;
        modelRules.push(
          `R72 节奏调整${paceAdjust >= 0 ? '+' : ''}${Math.round(paceAdjust * 10) / 10}分 ` +
          `(两队场均${Math.round(avgPpg)} vs 联赛${Math.round(leagueAvg)})`,
        );
      } else {
        paceAdjust = 0;
        adjustBreakdown.pace = 0;
        modelRules.push('R72 缺节奏数据→pace调整0');
      }

      // 强弱差对节奏的二次修正：强弱越悬殊，比赛节奏略有下降（领先方压节奏）
      const oddsRatio = Math.max(homeWinOdds, awayWinOdds) / Math.min(homeWinOdds, awayWinOdds);
      if (oddsRatio >= 2.5 || lineAbs >= 12) {
        const blowoutSlowdown = isFiba ? -1.0 : -0.5;
        paceAdjust += blowoutSlowdown;
        adjustBreakdown.blowout = blowoutSlowdown;
        paceAdjust = Math.max(-2, Math.min(2, paceAdjust));
        adjustBreakdown.pace = Math.round(paceAdjust * 10) / 10;
        modelRules.push(`R73 强弱差节奏修正${blowoutSlowdown}分`);
      }

      // 3. 伤停调整（仅当有真实伤停数据时才扣减）
      const totalInjuries = computedCoreHome + computedCoreAway;
      if (totalInjuries > 0) {
        injuryAdjust = -Math.min(2.5, totalInjuries * 1.2);
        adjustBreakdown.injury = Math.round(injuryAdjust * 10) / 10;
        modelRules.push(`R74 伤停压小${injuryAdjust}分（${totalInjuries}人）`);
      }

      // 合计调整（v7.2：放大幅度，让概率有真实分化）
      adjustment = stageAdjust + paceAdjust + injuryAdjust;
      adjustment = Math.round(adjustment * 10) / 10;
      predictedTotal = totalLineVal + adjustment;
      modelRules.push(
        `R75 v7.2 合计调整${adjustment > 0 ? '+' : ''}${adjustment}分 ` +
          `(阶段${stageAdjust >= 0 ? '+' : ''}${stageAdjust}/节奏${paceAdjust >= 0 ? '+' : ''}${Math.round(paceAdjust * 10) / 10}/伤停${injuryAdjust})`,
      );

      // R63 总分钳制[100,220]（合理性边界）
      predictedTotal = Math.max(100, Math.min(220, predictedTotal));
      modelRules.push('R63 总分钳制[100,220]');

      // 与指数线差值
      ouDiffVsLine = Math.round((predictedTotal - totalLineVal) * 10) / 10;
      const diff = predictedTotal - totalLineVal;
      const absDiff = Math.abs(diff);

      // v7.2 大小分概率：正态CDF（独立预期 vs 指数线）
      // 总分标准差约为让分标准差的1.6倍（篮球总分波动≈净胜分的1.6倍）
      const ouSigma = baseline.handicapStd * 1.6 || 10;
      const ouZ = diff / ouSigma;
      const erfApproxOu = (x: number) => {
        const t = 1 / (1 + 0.3275911 * Math.abs(x));
        const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
        return x >= 0 ? y : -y;
      };
      const normalCdfOu = (z: number) => 0.5 * (1 + erfApproxOu(z / Math.SQRT2));
      let rawOverProb = normalCdfOu(ouZ);
      // 轻度收缩（保留分化）
      const ouShrink = 0.85;
      const calibratedOverProb = 0.5 + (rawOverProb - 0.5) * ouShrink;
      const overProbDec = Math.max(0.10, Math.min(0.90, calibratedOverProb));
      overProb = Math.round(overProbDec * 100);
      underProb = 100 - overProb;
      modelRules.push(`R78 v7.2 大小分正态CDF（sigma=${ouSigma.toFixed(1)}, shrink=${ouShrink}）`);

      // 信心分级（按概率偏离50%的程度）
      const ouDeviation = Math.abs(overProbDec - 0.5);
      if (ouDeviation >= 0.15) {
        ouConfidence = '高';
      } else if (ouDeviation >= 0.08) {
        ouConfidence = '中';
      } else {
        ouConfidence = '低';
      }

      // v7.1 大小分有指数线必给方向：不再因差值小而观望，按差值分信心等级
      totalDirection = diff >= 0 ? '大分' : '小分';
      modelRules.push(
        `R76 v7.1 大小分有指数线必给方向（信心分级）`,
      );
    } else {
      // 市场指数线缺失：回退联赛基准（仅作参考），方向自洽
      predictedTotal = baseline.total;
      modelRules.push('R70b 缺市场指数线→回退联赛基准');
      const diff = 0;
      const absDiff = 0;
      ouDiffVsLine = 0;
      ouConfidence = '低';
      overProb = 50;
      underProb = 50;
      totalDirection = '观望';

      // R63 总分钳制[100,220]
      predictedTotal = Math.max(100, Math.min(220, predictedTotal));
    }

    // --- 预期比分（让分方向、大小分方向、胜负方向三者自洽）---
    const totalForScore = hasMarketLine ? totalLineVal : baseline.total;
    const totalScore = (predictedTotal + totalForScore) / 2;
    const homePredicted = totalScore / 2 + expectedHomeMargin / 2;
    const awayPredicted = totalScore / 2 - expectedHomeMargin / 2;
    const predictedHomeScore = Math.max(40, Math.round(homePredicted));
    const predictedAwayScore = Math.max(40, Math.round(awayPredicted));

    if (lowConfidence) {
      modelRules.push('R39 低信心双选');
    }

    // 自洽校准：用整数预期比分回算让分/大小分方向，确保与推荐完全一致
    if (handicapRecommendation && handicapRecommendation !== '观望' && handicapVal !== 0) {
      const actualCovers = predictedHomeScore + handicapVal > predictedAwayScore;
      const shouldBeHome = coverProb >= 0.5;
      if (actualCovers !== shouldBeHome) {
        handicapRecommendation = actualCovers ? '让分主胜' : '让分客胜';
      }
    }
    if (hasMarketLine) {
      const actualTotal = predictedHomeScore + predictedAwayScore;
      const diff = actualTotal - totalLineVal;
      const absDiff = Math.abs(diff);
      // v6.7: 方向与概率以预期总分为准，自洽断言兜底
      // 重新校准概率（保持围绕50%单调）
      const highSideProb = 50 + 25 * (1 - Math.exp(-absDiff / 6));
      const clampedHigh = Math.max(52, Math.min(75, Math.round(highSideProb)));
      if (diff >= 0) {
        overProb = clampedHigh;
        underProb = 100 - clampedHigh;
      } else {
        overProb = 100 - clampedHigh;
        underProb = clampedHigh;
      }
      // v7.1 有指数线必给方向（按整数比分回算后重判定）
      const isDeepLine2 = lineAbs >= 10;
      const finalThreshold2 = isDeepLine2 ? 2.5 : 4;
      totalDirection = diff >= 0 ? '大分' : '小分';
      // 信心分级
      if (absDiff >= finalThreshold2 + 2.5) {
        ouConfidence = '高';
      } else if (absDiff >= finalThreshold2) {
        ouConfidence = '中';
      } else {
        ouConfidence = '低';
      }
      ouDiffVsLine = Math.round(diff * 10) / 10;
    }

    // --- 小样本联赛降信心（累计完赛<30场）---
    const isSmallSampleLeague = baseline.sampleCount > 0 && baseline.sampleCount < 30;
    if (isSmallSampleLeague) {
      modelRules.push('R50 小样本联赛降信心');
      // 客胜方向降为低信心
      if (predictionDirection === '客胜') {
        lowConfidence = true;
        if (confidence > 50) confidence = 50;
      }
      // 让分推荐降为低信心（小样本联赛不再观望，保留方向）
      if (handicapRecommendation && handicapRecommendation !== '观望') {
        handicapConfidence = '低';
        modelRules.push('R50a 小样本让分降为低信心');
      }
      // 大小分信心降一级
      if (ouConfidence === '高') ouConfidence = '中';
      else if (ouConfidence === '中') ouConfidence = '低';
    }

    // 确保至少一条基础规则
    if (modelRules.length === 0) {
      modelRules.push('R01 指数基准模型');
    }

    // ===== 自洽断言：大小分方向与概率符号必须一致 =====
    // 方向为大分/小分时，概率必须对应侧>50；观望时允许50附近
    if (totalDirection === '大分' && overProb < underProb) {
      totalDirection = '小分';
      const tmp = overProb;
      overProb = underProb;
      underProb = tmp;
      this.logger.warn(
        `[自洽修复-大小分] 方向原为大分但 over=${overProb}<under=${underProb}, 已修正为小分 ` +
        `league=${league} totalLineStr=${totalLineStr ?? ''}`,
      );
    } else if (totalDirection === '小分' && underProb < overProb) {
      totalDirection = '大分';
      const tmp = overProb;
      overProb = underProb;
      underProb = tmp;
      this.logger.warn(
        `[自洽修复-大小分] 方向原为小分但 under=${underProb}<over=${overProb}, 已修正为大分 ` +
        `league=${league} totalLineStr=${totalLineStr ?? ''}`,
      );
    } else if (totalDirection === '观望' && Math.abs(overProb - underProb) >= 10) {
      // 观望但概率差≥10%：修正为对应方向（防御性）
      if (overProb > underProb) {
        totalDirection = '大分';
      } else {
        totalDirection = '小分';
      }
      this.logger.warn(
        `[自洽修复-大小分] 观望但概率差=${Math.abs(overProb - underProb)}%≥10%, 已修正方向 ` +
        `league=${league} totalLineStr=${totalLineStr ?? ''}`,
      );
    }

    // ===== 自洽断言：让分方向与 coverProb 符号必须一致 =====
    if (!hasValidSpread) {
      if (isWeakBaselineMode) {
        handicapRecommendation = '观望';
        handicapCoverProb = 50;
        handicapConfidence = '低';
        modelRules.push('R85b v9.0 弱基线模式：球队数据不足，让分方向观望');
      } else if (isModelReferenceMode) {
        const modelMargin = expectedHomeMargin;
        const coverProbRaw = 0.5 + modelMargin / (baseline.handicapStd * 2);
        handicapCoverProb = Math.max(10, Math.min(90, Math.round(coverProbRaw * 100)));
        if (modelMargin > 1.5) {
          handicapRecommendation = '模型参考·让分主胜';
        } else if (modelMargin < -1.5) {
          handicapRecommendation = '让分客胜';
        } else {
          handicapRecommendation = '模型参考·中性';
        }
        handicapConfidence = '低';
        modelRules.push(
          `R85 v9.0 无指数线模型参考让分：预期净胜${modelMargin > 0 ? '+' : ''}${modelMargin.toFixed(1)}分，` +
          `过线概率${handicapCoverProb}%`,
        );
      } else {
        handicapRecommendation = '观望';
      }
    } else if (handicapRecommendation === '让分主胜' && handicapCoverProb < 50) {
      handicapRecommendation = '让分客胜';
      this.logger.warn(
        `[自洽修复-让分] 推荐原为让分主胜但 coverProb=${handicapCoverProb}<50, 已修正 ` +
        `league=${league} handicapStr=${handicapStr}`,
      );
    } else if (handicapRecommendation === '让分客胜' && handicapCoverProb > 50) {
      handicapRecommendation = '让分主胜';
      this.logger.warn(
        `[自洽修复-让分] 推荐原为让分客胜但 coverProb=${handicapCoverProb}>50, 已修正 ` +
        `league=${league} handicapStr=${handicapStr}`,
      );
    }

    if (!hasValidTotal) {
      if (isWeakBaselineMode) {
        totalDirection = '观望';
        overProb = 50;
        underProb = 50;
        ouConfidence = '低';
        modelRules.push('R86b v9.0 弱基线模式：球队数据不足，大小分方向观望');
      } else if (isModelReferenceMode) {
        const modelTotalDiff = predictedTotal - baseline.total;
        const overP = 50 + modelTotalDiff * 2;
        overProb = Math.max(15, Math.min(85, Math.round(overP)));
        underProb = 100 - overProb;
        if (overProb >= 58) {
          totalDirection = '模型参考·大分';
        } else if (underProb >= 58) {
          totalDirection = '模型参考·小分';
        } else {
          totalDirection = '模型参考·中性';
        }
        ouConfidence = '低';
        modelRules.push(
          `R86 v9.0 无指数线模型参考大小分：预期总分${predictedTotal.toFixed(1)}，` +
          `大分概率${overProb}%（基准${baseline.total}）`,
        );
      } else {
        totalDirection = '观望';
      }
    }

    const totalPickProb = totalDirection === '大分' ? overProb : totalDirection === '小分' ? underProb : Math.max(overProb, underProb);
    const handicapPickProb = handicapRecommendation === '让分主胜' ? handicapCoverProb : handicapRecommendation === '让分客胜' ? 100 - handicapCoverProb : Math.max(handicapCoverProb, 100 - handicapCoverProb);

    const fallbackResult = {
      homeWinProb,
      awayWinProb,
      predictionDirection,
      confidence,
      lowConfidence,
      handicapRecommendation,
      handicapCoverProb,
      handicapPickProb,
      totalDirection,
      overProb,
      underProb,
      totalPickProb,
      modelRules,
      predictedHomeScore,
      predictedAwayScore,
      predictedTotal: Math.round(predictedTotal * 10) / 10,
      handicapConfidence,
      ouConfidence,
      ouDiffVsLine,
      adjustBreakdown,
      predEngineVersion: 'v9.0-fallback',
    };

    const fallbackLineVal = handicapVal !== 0 ? handicapVal : null;
    const fallbackWithLine = { ...fallbackResult, handicapLineNum: fallbackLineVal };
    const finalizedFallback = this.applyBasketballFinalCalibrations(fallbackWithLine);
    return finalizedFallback;
  }

  private calcBasketballFromPredictedScore(
    predictedHome: number,
    predictedAway: number,
    handicapStr: string,
    totalLineStr: string,
  ): { handicapCoverProb: number; overProb: number; underProb: number } {
    // 让分方向约定与 generateBasketballPrediction 一致：
    // handicap > 0 表示主队受让；让分主胜 ⇔ predictedHome + handicapVal > predictedAway
    const margin = predictedHome - predictedAway;
    const handicapVal = Number(handicapStr) || 0;
    const marginVsSpread = margin + handicapVal;
    const coverProbRaw = 0.5 + marginVsSpread * 0.025;
    const handicapCoverProb = Math.max(10, Math.min(90, Math.round(coverProbRaw * 100)));

    const totalLineVal = Number(totalLineStr) || 0;
    const predictedTotal = predictedHome + predictedAway;
    let overProb = 50;
    let underProb = 50;
    if (totalLineVal > 0) {
      const diff = predictedTotal - totalLineVal;
      const overP = 50 + diff * 2.5;
      overProb = Math.max(20, Math.min(80, Math.round(overP)));
      underProb = 100 - overProb;
    }

    return { handicapCoverProb, overProb, underProb };
  }

  // --- Validation: football ---

  validateFootballMatch(m: NormalizedFootballMatch): { ok: boolean; reason?: string } {
    // ① Home/away order: both non-empty and not equal
    if (!m.homeTeam || !m.awayTeam) {
      return { ok: false, reason: 'homeTeam or awayTeam is empty' };
    }
    if (m.homeTeam === m.awayTeam) {
      return { ok: false, reason: 'homeTeam equals awayTeam' };
    }

    const h = Number(m.oddsOpenHome);
    const d = Number(m.oddsOpenDraw);
    const a = Number(m.oddsOpenAway);

    // Skip odds-based checks if all odds are missing/zero
    const hasOdds = h > 0 && d > 0 && a > 0;
    if (!hasOdds) return { ok: true };

    // ② WDW odds sum self-consistency: sum must be > 3 (impossible otherwise)
    if (h + d + a <= 3) {
      return { ok: false, reason: `WDW odds sum too low: ${h + d + a}` };
    }

    const handicap = Number(m.handicap) || 0;

    // ③ 不变量：禁止占位文案（情报采集中/示例/待接入/demo）
    const PLACEHOLDER_TEXTS = ['情报采集中', '示例', '待接入', 'demo', 'Demo', 'DEMO'];
    const textFields = [
      (m as { intel?: string }).intel,
      (m as { mediaConsensus?: string }).mediaConsensus,
      (m as { teamNews?: string }).teamNews,
      (m as { expertPicks?: string }).expertPicks,
      (m as { keyPlayers?: string }).keyPlayers,
      (m as { injuries?: string }).injuries,
      (m as { homeInjuries?: string }).homeInjuries,
      (m as { awayInjuries?: string }).awayInjuries,
      (m as { tacticsHome?: string }).tacticsHome,
      (m as { tacticsAway?: string }).tacticsAway,
      (m as { keyPlayersHome?: string }).keyPlayersHome,
      (m as { keyPlayersAway?: string }).keyPlayersAway,
      (m as { upsetWarning?: string }).upsetWarning,
    ];
    for (const field of textFields) {
      if (field && PLACEHOLDER_TEXTS.includes(field.trim())) {
        return { ok: false, reason: `placeholder text rejected: ${field.trim()}` };
      }
    }

    return { ok: true };
  }

  // --- Validation: basketball ---

  validateBasketballMatch(m: NormalizedBasketballMatch): { ok: boolean; reason?: string } {
    // ① Home/away non-empty and not equal
    if (!m.homeTeam || !m.awayTeam) {
      return { ok: false, reason: 'homeTeam or awayTeam is empty' };
    }
    if (m.homeTeam === m.awayTeam) {
      return { ok: false, reason: 'homeTeam equals awayTeam' };
    }

    const h = Number(m.homeWinOdds);
    const a = Number(m.awayWinOdds);
    const hasOdds = h > 0 && a > 0;
    if (!hasOdds) return { ok: true };

    const handicap = Number(m.handicap) || 0;

    // （已删除：用指数推断让分方向是错误的，让分线以官方 hdc.goalLine 为准）

    // ② Total odds self-consistency: over/under should be reasonably close
    const over = Number(m.totalOddsOver);
    const under = Number(m.totalOddsUnder);
    if (over > 0 && under > 0) {
      const smaller = Math.min(over, under);
      const larger = Math.max(over, under);
      if (larger / smaller > 2) {
        return {
          ok: false,
          reason: `total over/under odds gap too large (over=${over}, under=${under})`,
        };
      }
    }

    // ③ 不变量：禁止占位文案（情报采集中/示例/待接入/demo）
    const BB_PLACEHOLDER_TEXTS = ['情报采集中', '示例', '待接入', 'demo', 'Demo', 'DEMO'];
    const bbTextFields = [
      (m as { intel?: string }).intel,
      (m as { intelSummary?: string }).intelSummary,
      (m as { mediaConsensus?: string }).mediaConsensus,
      (m as { teamNews?: string }).teamNews,
      (m as { expertPicks?: string }).expertPicks,
      (m as { riskWarning?: string }).riskWarning,
      (m as { upsetWarning?: string }).upsetWarning,
    ];
    for (const field of bbTextFields) {
      if (field && BB_PLACEHOLDER_TEXTS.includes(field.trim())) {
        return { ok: false, reason: `placeholder text rejected: ${field.trim()}` };
      }
    }

    return { ok: true };
  }

  // --- Upsert: football ---

  async upsertFootballMatches(
    items: NormalizedFootballMatch[],
  ): Promise<{ inserted: number; updated: number; skipped: number; lastError: string | null }> {
    if (items.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0, lastError: null };
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let lastError: string | null = null;
    const isSporttery = (src: NormalizedFootballMatch['source']): boolean =>
      !src || src === 'sporttery';

    const preSnapshot = await this.db.select({ value: count() }).from(matches);
    const preCount = preSnapshot[0]?.value ?? 0;

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
      for (const item of items) {
        try {
        const kickoffDate = new Date(item.kickoffTime);
        if (Number.isNaN(kickoffDate.getTime())) { skipped += 1; continue; }

        const businessDateStr = item.businessDate || getBeijingDateStr(kickoffDate);
        const official = isSporttery(item.source);

        let existing: {
          id: string;
          matchStatus: string;
          confidence: number;
           predictionDirection: string;
           handicapRecommendation: string;
           totalPick: string;
           oddsOpenHome: string | number | null;
           oddsOpenDraw: string | number | null;
           oddsOpenAway: string | number | null;
           handicapOddsHome: string | number | null;
           handicapOddsDraw: string | number | null;
           handicapOddsAway: string | number | null;
           handicap: string;
           source: string;
           sourceMatchId: string | null;
           modelRules: string[] | null;
           isOfficialLocked: boolean;
           homeGoalsAvg: string | number | null;
          awayGoalsAvg: string | number | null;
          homeConcededAvg: string | number | null;
          awayConcededAvg: string | number | null;
          totalOddsOver: string | number | null;
          totalOddsUnder: string | number | null;
           totalGoals: string | number | null;
           overUnder: string | null;
           league: string;
         }[] = [];

        if (item.sourceMatchId && official) {
          const bySourceId = await tx
                 .select({
                   id: matches.id,
                   matchStatus: matches.matchStatus,
                   confidence: matches.confidence,
                   predictionDirection: matches.predictionDirection,
                   handicapRecommendation: matches.handicapRecommendation,
                   totalPick: matches.totalPick,
                   oddsOpenHome: matches.oddsOpenHome,
                   oddsOpenDraw: matches.oddsOpenDraw,
                   oddsOpenAway: matches.oddsOpenAway,
                   handicapOddsHome: matches.handicapOddsHome,
                   handicapOddsDraw: matches.handicapOddsDraw,
                   handicapOddsAway: matches.handicapOddsAway,
                   handicap: matches.handicap,
                   source: matches.source,
                   sourceMatchId: matches.sourceMatchId,
                    modelRules: matches.modelRules,
                    isOfficialLocked: matches.isOfficialLocked,
                    homeGoalsAvg: matches.homeGoalsAvg,
                    awayGoalsAvg: matches.awayGoalsAvg,
                    homeConcededAvg: matches.homeConcededAvg,
                    awayConcededAvg: matches.awayConcededAvg,
                    totalOddsOver: matches.totalOddsOver,
                    totalOddsUnder: matches.totalOddsUnder,
                    totalGoals: matches.totalGoals,
                    overUnder: matches.overUnder,
                  })
                  .from(matches)
                  .where(eq(matches.sourceMatchId, item.sourceMatchId))
            .limit(1);
          if (bySourceId.length > 0) {
             existing = bySourceId as typeof existing;
           } else {
             existing = (await tx
                 .select({
                   id: matches.id,
                   matchStatus: matches.matchStatus,
                   confidence: matches.confidence,
                   predictionDirection: matches.predictionDirection,
                   handicapRecommendation: matches.handicapRecommendation,
                   totalPick: matches.totalPick,
                   oddsOpenHome: matches.oddsOpenHome,
                   oddsOpenDraw: matches.oddsOpenDraw,
                   oddsOpenAway: matches.oddsOpenAway,
                   handicapOddsHome: matches.handicapOddsHome,
                   handicapOddsDraw: matches.handicapOddsDraw,
                   handicapOddsAway: matches.handicapOddsAway,
                  handicap: matches.handicap,
                  source: matches.source,
                  sourceMatchId: matches.sourceMatchId,
                   modelRules: matches.modelRules,
                   isOfficialLocked: matches.isOfficialLocked,
                   homeGoalsAvg: matches.homeGoalsAvg,
                   awayGoalsAvg: matches.awayGoalsAvg,
                   homeConcededAvg: matches.homeConcededAvg,
                   awayConcededAvg: matches.awayConcededAvg,
                   totalOddsOver: matches.totalOddsOver,
                   totalOddsUnder: matches.totalOddsUnder,
                    totalGoals: matches.totalGoals,
                    overUnder: matches.overUnder,
                    league: matches.league,
                  })
                  .from(matches)
                  .where(and(
                    eq(matches.matchNo, item.matchNo),
                    eq(matches.businessDate, sql`${businessDateStr}::date`),
                  ))
                  .limit(1)) as typeof existing;
            }
          } else {
            existing = (await tx
              .select({
                id: matches.id,
                matchStatus: matches.matchStatus,
                confidence: matches.confidence,
                predictionDirection: matches.predictionDirection,
                handicapRecommendation: matches.handicapRecommendation,
                totalPick: matches.totalPick,
                oddsOpenHome: matches.oddsOpenHome,
                oddsOpenDraw: matches.oddsOpenDraw,
                oddsOpenAway: matches.oddsOpenAway,
                handicapOddsHome: matches.handicapOddsHome,
                handicapOddsDraw: matches.handicapOddsDraw,
                handicapOddsAway: matches.handicapOddsAway,
                handicap: matches.handicap,
                source: matches.source,
                sourceMatchId: matches.sourceMatchId,
                modelRules: matches.modelRules,
                isOfficialLocked: matches.isOfficialLocked,
                homeGoalsAvg: matches.homeGoalsAvg,
                awayGoalsAvg: matches.awayGoalsAvg,
                homeConcededAvg: matches.homeConcededAvg,
                awayConcededAvg: matches.awayConcededAvg,
                totalOddsOver: matches.totalOddsOver,
                totalOddsUnder: matches.totalOddsUnder,
                    totalGoals: matches.totalGoals,
                    overUnder: matches.overUnder,
                    league: matches.league,
                  })
                 .from(matches)
                 .where(and(
                   eq(matches.matchNo, item.matchNo),
                   eq(matches.businessDate, sql`${businessDateStr}::date`),
                 ))
                 .limit(1)) as typeof existing;
        }

        if (existing.length > 0) {
          const row = existing[0];
          if (row.matchStatus === 'canceled') { skipped += 1; continue; }
          const updateSet: Record<string, unknown> = {};
          const isOfficialRecord = row.source === 'sporttery';

          // 回填 sourceMatchId（官方源命中时，若库里还没有就补上）
          if (official && item.sourceMatchId && !row.sourceMatchId) {
            updateSet.sourceMatchId = item.sourceMatchId;
          }

          if (official && !isOfficialRecord) {
            // Upgrading from third-party placeholder to official record.
            // Initialize oddsOpen with first capture; oddsLive always reflects latest.
            const openH = this.numStrOrNull(item.oddsOpenHome);
            const openD = this.numStrOrNull(item.oddsOpenDraw);
            const openA = this.numStrOrNull(item.oddsOpenAway);
            if (openH !== null) { updateSet.oddsOpenHome = openH; updateSet.oddsLiveHome = openH; }
            if (openD !== null) { updateSet.oddsOpenDraw = openD; updateSet.oddsLiveDraw = openD; }
            if (openA !== null) { updateSet.oddsOpenAway = openA; updateSet.oddsLiveAway = openA; }
             updateSet.handicap = item.handicap;
             updateSet.overUnder = item.overUnder;
             updateSet.totalGoals = this.numStrOrNull(item.totalGoals) ?? '2.5';
             const hhH = this.numStrOrNull(item.handicapOddsHome);
             const hhD = this.numStrOrNull(item.handicapOddsDraw);
             const hhA = this.numStrOrNull(item.handicapOddsAway);
             if (hhH !== null) updateSet.handicapOddsHome = hhH;
             if (hhD !== null) updateSet.handicapOddsDraw = hhD;
             if (hhA !== null) updateSet.handicapOddsAway = hhA;
             const to = this.numStrOrNull(item.totalOddsOver);
             const tu = this.numStrOrNull(item.totalOddsUnder);
             if (to !== null) updateSet.totalOddsOver = to;
             if (tu !== null) updateSet.totalOddsUnder = tu;
              updateSet.source = 'sporttery';
           } else if (official && isOfficialRecord) {
             const openH = this.numStrOrNull(item.oddsOpenHome);
             const openD = this.numStrOrNull(item.oddsOpenDraw);
             const openA = this.numStrOrNull(item.oddsOpenAway);
             if (openH !== null) updateSet.oddsLiveHome = openH;
             if (openD !== null) updateSet.oddsLiveDraw = openD;
             if (openA !== null) updateSet.oddsLiveAway = openA;
             const hhH = this.numStrOrNull(item.handicapOddsHome);
             const hhD = this.numStrOrNull(item.handicapOddsDraw);
             const hhA = this.numStrOrNull(item.handicapOddsAway);
             if (hhH !== null) updateSet.handicapOddsHome = hhH;
             if (hhD !== null) updateSet.handicapOddsDraw = hhD;
             if (hhA !== null) updateSet.handicapOddsAway = hhA;
             const to = this.numStrOrNull(item.totalOddsOver);
             const tu = this.numStrOrNull(item.totalOddsUnder);
             if (to !== null) updateSet.totalOddsOver = to;
             if (tu !== null) updateSet.totalOddsUnder = tu;
             if (item.handicap) updateSet.handicap = item.handicap;
             if (item.overUnder && item.overUnder !== '2.5') updateSet.overUnder = item.overUnder;
             if (item.totalGoals && item.totalGoals !== '') {
               const tg = this.numStrOrNull(item.totalGoals);
               if (tg !== null) updateSet.totalGoals = tg;
             }
           }

           // Fields any source can update
           updateSet.kickoffTime = kickoffDate;
           updateSet.matchDate = sql`${businessDateStr}::date`;
           updateSet.businessDate = sql`${businessDateStr}::date`;
           updateSet.updatedAt = sql`CURRENT_TIMESTAMP`;
           if (item.league && (official || !row.league)) updateSet.league = item.league;

          // Only update matchStatus if current is 'upcoming' and new status differs
          if (row.matchStatus === 'upcoming' && item.matchStatus !== 'upcoming') {
            updateSet.matchStatus = item.matchStatus;
          }

          // Back-fill prediction if empty — only for official source with valid odds
          // v9.0 fix: 升级为官方源、赔率从无变有、当前仍为观望态、或已是官方源且赔率有变化时重算
          const hasFootballOdds = !!item.oddsOpenHome && item.oddsOpenHome !== ''
             && !!item.oddsOpenDraw && item.oddsOpenDraw !== ''
             && !!item.oddsOpenAway && item.oddsOpenAway !== '';
          const upgradingToOfficial = official && !isOfficialRecord;
          const currentlyWaiting = row.predictionDirection === '' || row.confidence === 0 || row.confidence == null;
          const rowOddsH = row.oddsOpenHome != null ? Number(row.oddsOpenHome) : 0;
          const rowOddsA = row.oddsOpenAway != null ? Number(row.oddsOpenAway) : 0;
          const newOddsH = hasFootballOdds ? Number(item.oddsOpenHome) : 0;
          const newOddsA = hasFootballOdds ? Number(item.oddsOpenAway) : 0;
          const oddsChanged = official && isOfficialRecord && hasFootballOdds && rowOddsH > 0 && Math.abs(newOddsH - rowOddsH) > 0.01;
          const isOfficialLocked = Boolean(row.isOfficialLocked) ||
            (Array.isArray(row.modelRules) && row.modelRules.some((r: string) => r.includes('官方数据锁定')));
          const needRecalcPrediction = !isOfficialLocked && (upgradingToOfficial || currentlyWaiting || oddsChanged);
          if (official && hasFootballOdds && needRecalcPrediction) {
            const oddsH = Number(item.oddsOpenHome);
            const oddsD = Number(item.oddsOpenDraw);
            const oddsA = Number(item.oddsOpenAway);
            const totalGoalsStr = this.numStrOrNull(item.totalGoals) ?? this.numStrOrNull(item.overUnder) ?? undefined;
            const hAvg = Number(row.homeGoalsAvg) || 0;
            const aAvg = Number(row.awayGoalsAvg) || 0;
            const hcAvg = Number(row.homeConcededAvg) || 0;
            const acAvg = Number(row.awayConcededAvg) || 0;
            const strengthInput = (hAvg > 0 && aAvg > 0 && hcAvg > 0 && acAvg > 0)
              ? { homeGoalsAvg: hAvg, awayGoalsAvg: aAvg, homeConcededAvg: hcAvg, awayConcededAvg: acAvg }
              : undefined;
            const prediction = this.generateFootballPrediction(oddsH, oddsD, oddsA, item.handicap, totalGoalsStr, item.league, strengthInput);
            if (prediction && !Number.isNaN(prediction.confidence) && !Number.isNaN(prediction.homeWinProb)) {
              updateSet.homeWinProb = prediction.homeWinProb;
              updateSet.drawProb = prediction.drawProb;
              updateSet.awayWinProb = prediction.awayWinProb;
              updateSet.confidence = prediction.confidence;
              updateSet.lowConfidence = prediction.lowConfidence;
              updateSet.overProb = prediction.overProb;
              updateSet.underProb = prediction.underProb;
              updateSet.totalPickProb = prediction.totalPickProb;
              updateSet.totalGoalsProb = prediction.totalGoalsProb as unknown as string[];
               // P0-1 赛中方向锁定：live/in-play/finished 场保留赛前方向
               const isLiveOrFinishedMatch = row.matchStatus === 'live'
                 || row.matchStatus === 'in-play'
                 || row.matchStatus === 'finished';
              const hasPreDir = this.isNonEmptyStr(row.predictionDirection)
                && row.predictionDirection !== '观望';
              const hasPreHc = this.isNonEmptyStr(row.handicapRecommendation)
                && row.handicapRecommendation !== '观望';
              const hasPreTotal = this.isNonEmptyStr(row.totalPick)
                && row.totalPick !== '观望';
               if (isLiveOrFinishedMatch && hasPreDir) {
                 // 锁定赛前胜平负方向
               } else {
                 updateSet.predictionDirection = prediction.predictionDirection;
               }
               if (isLiveOrFinishedMatch && hasPreHc) {
                 // 锁定赛前让球方向
               } else if (prediction.handicapRecommendation) {
                 updateSet.handicapRecommendation = prediction.handicapRecommendation;
               }
               if (isLiveOrFinishedMatch && hasPreTotal) {
                 // 锁定赛前大小球方向
               } else {
                 updateSet.totalPick = prediction.totalPick;
               }
               // P2-8 模型版本号真实化
               updateSet.predEngineVersion = FOOTBALL_MODEL_VERSION;
            }
          } else if (official && !hasFootballOdds && !isOfficialLocked) {
            // v6.8.4 数据不足：统一调用公共函数写基线默认值+标签+三项观望
            this.applyFootballDataInsufficientGuard(updateSet);
          }

          // 官方锁定比赛：跳过预测重算和finalize，保留已有方向/概率/信心/规则
          if (official && !isOfficialLocked) {
             const rowOddsH = row.oddsOpenHome != null ? String(row.oddsOpenHome) : null;
             const rowOddsD = row.oddsOpenDraw != null ? String(row.oddsOpenDraw) : null;
             const rowOddsA = row.oddsOpenAway != null ? String(row.oddsOpenAway) : null;
             const rowOddsEmpty = rowOddsH === null && rowOddsD === null && rowOddsA === null;
             // 赔率驱动：把库里已有的胜平负/大小球赔率放进updateSet，确保finalize能读到
             // （竞彩官方记录赔率没变化时needRecalc=false，updateSet不含赔率字段，
             //  finalize中赔率驱动逻辑读record.xxx会是undefined导致失效）
             if (rowOddsH !== null && updateSet.oddsOpenHome === undefined) {
               updateSet.oddsOpenHome = rowOddsH;
             }
             if (rowOddsD !== null && updateSet.oddsOpenDraw === undefined) {
               updateSet.oddsOpenDraw = rowOddsD;
             }
             if (rowOddsA !== null && updateSet.oddsOpenAway === undefined) {
               updateSet.oddsOpenAway = rowOddsA;
             }
             const rowTotalOver = row.totalOddsOver != null ? String(row.totalOddsOver) : null;
             const rowTotalUnder = row.totalOddsUnder != null ? String(row.totalOddsUnder) : null;
             if (rowTotalOver !== null && updateSet.totalOddsOver === undefined) {
               updateSet.totalOddsOver = rowTotalOver;
             }
             if (rowTotalUnder !== null && updateSet.totalOddsUnder === undefined) {
               updateSet.totalOddsUnder = rowTotalUnder;
             }
             const rowTotalGoals = row.totalGoals != null ? String(row.totalGoals) : null;
             if (rowTotalGoals && updateSet.totalGoals === undefined) {
               updateSet.totalGoals = rowTotalGoals;
             }
             const dbHcH = row.handicapOddsHome != null ? String(row.handicapOddsHome) : null;
             const dbHcD = row.handicapOddsDraw != null ? String(row.handicapOddsDraw) : null;
             const dbHcA = row.handicapOddsAway != null ? String(row.handicapOddsAway) : null;
            this.finalizeFootballPick(
              updateSet, row.handicapRecommendation ?? null, rowOddsEmpty, undefined,
              { home: dbHcH, draw: dbHcD, away: dbHcA },
            );
          }
          await tx
            .update(matches)
            .set(updateSet)
            .where(eq(matches.id, row.id));
          updated += 1;
        } else {
          if (official) {
             // Insert new official record — generate prediction only when odds are available
             const hasFootballOdds = !!item.oddsOpenHome && item.oddsOpenHome !== ''
               && !!item.oddsOpenDraw && item.oddsOpenDraw !== ''
               && !!item.oddsOpenAway && item.oddsOpenAway !== '';
             let prediction: ReturnType<typeof this.generateFootballPrediction> = null;
             let dataInsufficient = false;
              if (hasFootballOdds) {
               const oddsH = Number(item.oddsOpenHome);
               const oddsD = Number(item.oddsOpenDraw);
               const oddsA = Number(item.oddsOpenAway);
               const totalGoalsStr = this.numStrOrNull(item.totalGoals) ?? this.numStrOrNull(item.overUnder) ?? undefined;
               prediction = this.generateFootballPrediction(oddsH, oddsD, oddsA, item.handicap, totalGoalsStr, item.league);
              } else {
               // v6.8.3 数据不足：无三项真实指数，写入基线默认值 + 数据不足标签
               dataInsufficient = true;
             }

             const handicapRec = prediction?.handicapRecommendation ?? item.handicapRecommendation ?? '';

            const insertObj = {
              matchNo: item.matchNo,
              matchDate: sql`${businessDateStr}::date`,
              businessDate: sql`${businessDateStr}::date`,
              league: item.league,
              homeTeam: item.homeTeam,
              awayTeam: item.awayTeam,
              kickoffTime: kickoffDate,
              matchStatus: item.matchStatus,
              source: 'sporttery',
              sourceMatchId: item.sourceMatchId ?? null,
              liveScoreSource: '',
              oddsOpenHome: this.numStrOrNull(item.oddsOpenHome),
              oddsOpenDraw: this.numStrOrNull(item.oddsOpenDraw),
              oddsOpenAway: this.numStrOrNull(item.oddsOpenAway),
              oddsLiveHome: this.numStrOrNull(item.oddsOpenHome),
              oddsLiveDraw: this.numStrOrNull(item.oddsOpenDraw),
              oddsLiveAway: this.numStrOrNull(item.oddsOpenAway),
              handicap: item.handicap,
              handicapRecommendation: handicapRec,
              overUnder: item.overUnder,
              totalGoals: this.numStrOrNull(item.totalGoals) ?? '2.5',
             totalOddsOver: this.numStrOrNull(item.totalOddsOver),
             totalOddsUnder: this.numStrOrNull(item.totalOddsUnder),
               homeWinProb: prediction?.homeWinProb ?? (dataInsufficient ? 35 : 0),
               drawProb: prediction?.drawProb ?? (dataInsufficient ? 30 : 0),
               awayWinProb: prediction?.awayWinProb ?? (dataInsufficient ? 35 : 0),
               predictionDirection: prediction?.predictionDirection ?? '',
               confidence: prediction?.confidence ?? (dataInsufficient ? 35 : 0),
               lowConfidence: prediction?.lowConfidence ?? dataInsufficient,
               overProb: prediction?.overProb ?? (dataInsufficient ? 50 : 0),
               underProb: prediction?.underProb ?? (dataInsufficient ? 50 : 0),
               totalPick: prediction?.totalPick ?? '',
               totalPickProb: prediction?.totalPickProb ?? 0,
               totalGoalsProb: (prediction?.totalGoalsProb ?? []) as unknown as string[],
               intel: '',
               modelRules: prediction?.modelRules ?? (dataInsufficient ? ['数据不足：基线默认值+低信心（v12.0）'] : []),
               mostLikelyScore: '',
               tacticsHome: '',
               tacticsAway: '',
               keyPlayersHome: '',
               keyPlayersAway: '',
               upsetWarning: '',
               predEngineVersion: FOOTBALL_MODEL_VERSION,
             };
             this.finalizeFootballPick(insertObj);
             await tx.insert(matches).values(insertObj);
             inserted += 1;
           } else {
             // Third-party source — insert with odds if available, run prediction when possible
            const openH = this.numStrOrNull(item.oddsOpenHome);
            const openD = this.numStrOrNull(item.oddsOpenDraw);
            const openA = this.numStrOrNull(item.oddsOpenAway);
            const hasValidOdds = openH !== null && openD !== null && openA !== null
              && Number(openH) > 0 && Number(openD) > 0 && Number(openA) > 0;

            let prediction: ReturnType<typeof this.generateFootballPrediction> = null;
            let dataInsufficient = false;
             if (hasValidOdds) {
               const totalGoalsStr = this.numStrOrNull(item.totalGoals) ?? this.numStrOrNull(item.overUnder) ?? undefined;
               prediction = this.generateFootballPrediction(
                 Number(openH), Number(openD), Number(openA), item.handicap, totalGoalsStr, item.league,
               );
             } else {
               dataInsufficient = true;
             }

             const handicapRec = prediction?.handicapRecommendation ?? item.handicapRecommendation ?? '';

             const insertObj = {
               matchNo: item.matchNo,
               matchDate: sql`${businessDateStr}::date`,
               businessDate: sql`${businessDateStr}::date`,
               league: item.league,
               homeTeam: item.homeTeam,
               awayTeam: item.awayTeam,
               kickoffTime: kickoffDate,
               matchStatus: item.matchStatus || 'upcoming',
               source: item.source ?? 'qiumibao',
               sourceMatchId: item.sourceMatchId ?? null,
               liveScoreSource: '',
               oddsOpenHome: openH,
               oddsOpenDraw: openD,
               oddsOpenA: openA,
               oddsLiveHome: openH,
               oddsLiveDraw: openD,
               oddsLiveAway: openA,
               handicap: item.handicap || '',
               handicapRecommendation: handicapRec,
               handicapOddsHome: this.numStrOrNull(item.handicapOddsHome),
               handicapOddsDraw: this.numStrOrNull(item.handicapOddsDraw),
               handicapOddsAway: this.numStrOrNull(item.handicapOddsAway),
               overUnder: item.overUnder || '',
               totalGoals: this.numStrOrNull(item.totalGoals) ?? '2.5',
               totalOddsOver: this.numStrOrNull(item.totalOddsOver),
               totalOddsUnder: this.numStrOrNull(item.totalOddsUnder),
               homeWinProb: prediction?.homeWinProb ?? (dataInsufficient ? 35 : 0),
               drawProb: prediction?.drawProb ?? (dataInsufficient ? 30 : 0),
               awayWinProb: prediction?.awayWinProb ?? (dataInsufficient ? 35 : 0),
               predictionDirection: prediction?.predictionDirection ?? '',
               confidence: prediction?.confidence ?? (dataInsufficient ? 35 : 0),
               lowConfidence: prediction?.lowConfidence ?? dataInsufficient,
               overProb: prediction?.overProb ?? (dataInsufficient ? 50 : 0),
               underProb: prediction?.underProb ?? (dataInsufficient ? 50 : 0),
               totalPick: prediction?.totalPick ?? '',
               totalPickProb: prediction?.totalPickProb ?? 0,
               totalGoalsProb: (prediction?.totalGoalsProb ?? []) as unknown as string[],
               intel: '',
               modelRules: prediction?.modelRules ?? (dataInsufficient ? ['数据不足：基线默认值+低信心（v12.0）'] : []),
               mostLikelyScore: '',
               tacticsHome: '',
              tacticsAway: '',
              keyPlayersHome: '',
              keyPlayersAway: '',
              upsetWarning: '',
              predEngineVersion: FOOTBALL_MODEL_VERSION,
            };
            this.finalizeFootballPick(insertObj);
            await tx.insert(matches).values(insertObj);
            inserted += 1;
          }
        }
        } catch (err) {
          skipped += 1;
          const msg = this.errorMessage(err);
          lastError = msg;
          this.logger.error(`Football upsert skipped match ${item.matchNo}: ${msg}`);
        }
      }

      const postSnapshot = await tx.select({ value: count() }).from(matches);
      const postCount = postSnapshot[0]?.value ?? 0;
      if (postCount < preCount) {
        throw new Error(
          `[DATA_SAFETY_GATE] 足球比赛数不增反减: pre=${preCount}, post=${postCount}`,
        );
      }
    });

    return { inserted, updated, skipped, lastError };
  }

  // --- Fetch: basketball ---

  async fetchBasketballSchedule(): Promise<NormalizedBasketballMatch[]> {
    this.logger.log('Fetching basketball schedule from sporttery');
    const data = await this.fetchSportteryJson<SportteryBasketballResponse>(
      BASKETBALL_SCHEDULE_URL,
      'basketball',
      SPORTTERY_BASKETBALL_HEADERS,
    );

    const matchInfoList = (data.value?.matchInfoList) ?? data.matchInfoList;
    const hasValue = data.value !== undefined && data.value !== null;
    const topLevel = data.matchInfoList !== undefined;
    this.logger.log(
      `Basketball API raw: success=${data.success}, errorCode=${data.errorCode}, ` +
      `hasValue=${hasValue}, topLevelMatchInfoList=${topLevel}, ` +
      `matchInfoListLen=${matchInfoList?.length ?? 0}, emptyFlag=${data.emptyFlag}`,
    );
    if (!matchInfoList || matchInfoList.length === 0 || data.emptyFlag === true) {
      this.logger.warn('Basketball API returned empty data');
      return [];
    }

    const results: NormalizedBasketballMatch[] = [];

    for (const info of matchInfoList) {
      if (!info.subMatchList) continue;
      const infoBusinessDate = info.businessDate;
      for (const sub of info.subMatchList) {
        if (!sub.homeTeamAllName || !sub.awayTeamAllName) continue;
        const matchDateStr = sub.matchDate || info.matchDate || '';
        const rawMatchNo = String(sub.matchNum).slice(-3).padStart(3, '0');
        const businessDateStr = sub.businessDate || infoBusinessDate || computeBusinessDateFromMatchNo(rawMatchNo, matchDateStr);
        const weekdayPrefix = getWeekdayPrefix(businessDateStr);
        const matchNo = weekdayPrefix + rawMatchNo;
        const kickoffTime = this.buildKickoffTime(matchDateStr, sub.matchTime);

        const leagueName = sub.leagueAllName || sub.leagueAbbName || '';
        const euroLeagueTeams = ['皇家马德里', '巴塞罗那', '巴斯克尼亚', '马拉加',
          '帕纳辛纳科斯', '奥林匹亚科斯', '费内巴切', '伊斯坦布尔埃菲斯',
          '贝西克塔斯', '贝尔格莱德游击', '贝尔格莱德红星',
          '米兰阿玛尼', '米兰', '博洛尼亚', '拜仁慕尼黑', '柏林阿尔巴',
          '巴黎', '阿斯维尔', '特拉维夫马卡比', '迪拜',
          '萨拉基利斯', '摩纳哥', '瓦伦西亚', '格兰卡纳里亚'];
        const homeT = sub.homeTeamAllName || '';
        const awayT = sub.awayTeamAllName || '';
        const bothEuroLeagueTeams = euroLeagueTeams.includes(homeT) && euroLeagueTeams.includes(awayT);
        const isEuroLeague = leagueName.includes('欧洲篮球') || leagueName.includes('欧篮联')
          || leagueName.includes('欧冠篮') || bothEuroLeagueTeams;

        const hdc = (sub as { hdc?: { goalLineValue?: number; h?: number; a?: number; hf?: number; af?: number } }).hdc;
        const hilo = (sub as { hilo?: { goalLineValue?: number; h?: number; l?: number } }).hilo;
        const sfc = (sub as { sfc?: { h?: number; a?: number } }).sfc;

        const hasHandicapLine = hdc?.goalLineValue != null && String(hdc.goalLineValue) !== '';
        const hasTotalLine = hilo?.goalLineValue != null && String(hilo.goalLineValue) !== '';
        const isPendingSale = !hasHandicapLine && !hasTotalLine;

        if (isPendingSale && !sfc?.h && !sfc?.a) continue;

      results.push({
        sourceMatchId: sub.matchId != null ? String(sub.matchId) : undefined,
        matchNo: matchNo,
        matchDate: matchDateStr,
        businessDate: businessDateStr,
        league: sub.leagueAllName || sub.leagueAbbName || '未知联赛',
        homeTeam: sub.homeTeamAllName,
        awayTeam: sub.awayTeamAllName,
        kickoffTime,
        matchStatus: isPendingSale ? 'pending_sale' : this.mapBasketballStatus(sub.matchStatus),
        handicap: hdc?.goalLineValue != null ? String(hdc.goalLineValue) : '',
        handicapHf: hdc?.hf != null ? String(hdc.hf) : '0',
        handicapAf: hdc?.af != null ? String(hdc.af) : '0',
        totalLine: hilo?.goalLineValue != null ? String(hilo.goalLineValue) : '',
        homeWinOdds: sfc?.h ? String(sfc.h) : '',
        awayWinOdds: sfc?.a ? String(sfc.a) : '',
        handicapOddsHome: hdc?.h ? String(hdc.h) : '',
        handicapOddsAway: hdc?.a ? String(hdc.a) : '',
          totalOddsOver: hilo?.h ? String(hilo.h) : '',
          totalOddsUnder: hilo?.l ? String(hilo.l) : '',
          source: 'sporttery',
          isPendingSale,
        });
      }
    }

    this.logger.log(`Fetched ${results.length} basketball matches from sporttery`);
    if (results.length > 0) {
      const sample = results.slice(0, Math.min(3, results.length));
      this.logger.log(
        `Basketball sample: ${sample.map((m: NormalizedBasketballMatch) => `${m.matchNo}/${m.homeTeam}vs${m.awayTeam}/hdc=${m.handicap}/total=${m.totalLine}`).join('; ')}`,
      );
    }
    return results;
  }

  private classifyBasketballLeague(
    league: string,
    homeTeam: string,
    awayTeam: string,
    kickoffDate?: Date,
  ): { league: string; category: 'official' | 'wnba' | 'overseas' } {
    const WNBA_TEAMS: string[] = [
      '拉斯维加斯王牌', '纽约自由人', '康涅狄格太阳', '达拉斯飞马',
      '明尼苏达山猫', '明尼苏达天猫', '芝加哥天空', '菲尼克斯水星',
      '洛杉矶火花', '西雅图风暴', '华盛顿神秘人', '印第安纳狂热',
      '亚特兰大梦想', '金州女武神', '波特兰火焰', '多伦多节奏',
    ];
    const WNBA_FINALS_TEAMS_2026 = ['亚特兰大梦想', '金州女武神'];
    const wnbaNormalized: Set<string> = new Set(
      WNBA_TEAMS.map((name: string) => normalizeTeamName(name)),
    );
    const homeNorm: string = normalizeTeamName(homeTeam);
    const awayNorm: string = normalizeTeamName(awayTeam);
    if (wnbaNormalized.has(homeNorm) || wnbaNormalized.has(awayNorm)) {
      if (league.includes('总决赛')) {
        return { league: 'WNBA总决赛', category: 'wnba' };
      }
      if (league.includes('季后赛')) {
        return { league: 'WNBA季后赛', category: 'wnba' };
      }
      if (kickoffDate) {
        const month: number = kickoffDate.getUTCMonth() + 1;
        const day: number = kickoffDate.getUTCDate();
        const isFinalsPair: boolean =
          WNBA_FINALS_TEAMS_2026.some((t: string) => normalizeTeamName(t) === homeNorm) &&
          WNBA_FINALS_TEAMS_2026.some((t: string) => normalizeTeamName(t) === awayNorm);
        if (isFinalsPair && month >= 10 && month <= 11) {
          return { league: 'WNBA总决赛', category: 'wnba' };
        }
        if (month >= 9 && month <= 10) {
          return { league: 'WNBA季后赛', category: 'wnba' };
        }
      }
      return { league: 'WNBA常规赛', category: 'wnba' };
    }
    return { league, category: 'official' };
  }

  // --- Upsert: basketball ---

  async upsertBasketballMatches(
    items: NormalizedBasketballMatch[],
  ): Promise<{ inserted: number; updated: number; skipped: number; lastError: string | null }> {
    if (items.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0, lastError: null };
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let lastError: string | null = null;
    const isSporttery = (src: NormalizedBasketballMatch['source']): boolean =>
      !src || src === 'sporttery';

    const preSnapshot = await this.db.select({ value: count() }).from(basketballMatches);
    const preCount = preSnapshot[0]?.value ?? 0;

    const bbHistStatsMap = new Map<string, { ppg: number; oppg: number; games: number; recent10Ppg: number; recent10Oppg: number; recent20Ppg: number; recent20Oppg: number; sampleCount: number }>();
    {
      const teamSet = new Set<string>();
      for (const item of items) {
        if (item.homeTeam) teamSet.add(item.homeTeam);
        if (item.awayTeam) teamSet.add(item.awayTeam);
      }
      if (teamSet.size > 0) {
        const teams = Array.from(teamSet).map(name => ({ teamName: name, league: '' }));
        const m = await this.bbComputeHistoricalTeamStats(teams);
        for (const [k, v] of m) bbHistStatsMap.set(k, v);
      }
    }

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
      for (const item of items) {
        try {
        const kickoffDate = new Date(item.kickoffTime);
        if (Number.isNaN(kickoffDate.getTime())) { skipped += 1; continue; }
        const businessDateStr = item.businessDate || getBeijingDateStr(kickoffDate);
        const official = isSporttery(item.source);

        type BballExistingRow = {
          id: string;
          matchStatus: string;
          confidence: number;
          predictionDirection: string;
          handicapRecommendation: string;
          totalDirection: string;
          source: string;
          handicapLineNum: string | number | null;
          totalLineNum: string | number | null;
          oddsMovements: unknown;
          oddsOpenHandicapLine: string;
          oddsOpenTotalLine: string;
          oddsOpenHomeWin: string | number | null;
          oddsOpenAwayWin: string | number | null;
          oddsOpenHandicapHome: string | number | null;
          oddsOpenHandicapAway: string | number | null;
          oddsOpenTotalOver: string | number | null;
          oddsOpenTotalUnder: string | number | null;
          league: string;
          predEngineVersion: string | null;
        };

        let existing: BballExistingRow[] = [];

        if (item.sourceMatchId && official) {
          const bySourceId = await tx
            .select({
              id: basketballMatches.id,
              matchStatus: basketballMatches.matchStatus,
              confidence: basketballMatches.confidence,
              predictionDirection: basketballMatches.predictionDirection,
              handicapRecommendation: basketballMatches.handicapRecommendation,
              totalDirection: basketballMatches.totalDirection,
              source: basketballMatches.source,
              oddsOpenHandicapLine: basketballMatches.oddsOpenHandicapLine,
              oddsOpenTotalLine: basketballMatches.oddsOpenTotalLine,
              oddsOpenHomeWin: basketballMatches.oddsOpenHomeWin,
              oddsOpenAwayWin: basketballMatches.oddsOpenAwayWin,
              oddsOpenHandicapHome: basketballMatches.oddsOpenHandicapHome,
              oddsOpenHandicapAway: basketballMatches.oddsOpenHandicapAway,
              oddsOpenTotalOver: basketballMatches.oddsOpenTotalOver,
              oddsOpenTotalUnder: basketballMatches.oddsOpenTotalUnder,
              league: basketballMatches.league,
              predEngineVersion: basketballMatches.predEngineVersion,
            })
            .from(basketballMatches)
            .where(eq(basketballMatches.sourceMatchId, item.sourceMatchId))
            .limit(1);
          if (bySourceId.length > 0) {
            existing = bySourceId as BballExistingRow[];
          } else {
            existing = (await tx
             .select({
               id: basketballMatches.id,
               matchStatus: basketballMatches.matchStatus,
               confidence: basketballMatches.confidence,
               predictionDirection: basketballMatches.predictionDirection,
               handicapRecommendation: basketballMatches.handicapRecommendation,
               totalDirection: basketballMatches.totalDirection,
               source: basketballMatches.source,
               handicapLineNum: basketballMatches.handicapLineNum,
               totalLineNum: basketballMatches.totalLineNum,
               oddsMovements: basketballMatches.oddsMovements,
               oddsOpenHandicapLine: basketballMatches.oddsOpenHandicapLine,
               oddsOpenTotalLine: basketballMatches.oddsOpenTotalLine,
               oddsOpenHomeWin: basketballMatches.oddsOpenHomeWin,
               oddsOpenAwayWin: basketballMatches.oddsOpenAwayWin,
               oddsOpenHandicapHome: basketballMatches.oddsOpenHandicapHome,
               oddsOpenHandicapAway: basketballMatches.oddsOpenHandicapAway,
               oddsOpenTotalOver: basketballMatches.oddsOpenTotalOver,
               oddsOpenTotalUnder: basketballMatches.oddsOpenTotalUnder,
               league: basketballMatches.league,
               predEngineVersion: basketballMatches.predEngineVersion,
             })
               .from(basketballMatches)
               .where(and(
                 eq(basketballMatches.matchNo, item.matchNo),
                 eq(basketballMatches.businessDate, sql`${businessDateStr}::date`),
               ))
               .limit(1)) as BballExistingRow[];
           }
          } else if (item.sourceMatchId && !official) {
            const bySourceId = (await tx
              .select({
                id: basketballMatches.id,
                matchStatus: basketballMatches.matchStatus,
                confidence: basketballMatches.confidence,
                predictionDirection: basketballMatches.predictionDirection,
                handicapRecommendation: basketballMatches.handicapRecommendation,
                totalDirection: basketballMatches.totalDirection,
                source: basketballMatches.source,
                handicapLineNum: basketballMatches.handicapLineNum,
                totalLineNum: basketballMatches.totalLineNum,
                oddsMovements: basketballMatches.oddsMovements,
                oddsOpenHandicapLine: basketballMatches.oddsOpenHandicapLine,
                oddsOpenTotalLine: basketballMatches.oddsOpenTotalLine,
                oddsOpenHomeWin: basketballMatches.oddsOpenHomeWin,
                oddsOpenAwayWin: basketballMatches.oddsOpenAwayWin,
                oddsOpenHandicapHome: basketballMatches.oddsOpenHandicapHome,
                oddsOpenHandicapAway: basketballMatches.oddsOpenHandicapAway,
                oddsOpenTotalOver: basketballMatches.oddsOpenTotalOver,
                oddsOpenTotalUnder: basketballMatches.oddsOpenTotalUnder,
                league: basketballMatches.league,
                predEngineVersion: basketballMatches.predEngineVersion,
              })
              .from(basketballMatches)
              .where(eq(basketballMatches.sourceMatchId, item.sourceMatchId))
              .limit(1)) as BballExistingRow[];
            if (bySourceId.length > 0) {
              existing = bySourceId;
            } else if (item.matchNo && businessDateStr) {
              existing = (await tx
                .select({
                  id: basketballMatches.id,
                  matchStatus: basketballMatches.matchStatus,
                  confidence: basketballMatches.confidence,
                  predictionDirection: basketballMatches.predictionDirection,
                  handicapRecommendation: basketballMatches.handicapRecommendation,
                  totalDirection: basketballMatches.totalDirection,
                  source: basketballMatches.source,
                  handicapLineNum: basketballMatches.handicapLineNum,
                  totalLineNum: basketballMatches.totalLineNum,
                  oddsMovements: basketballMatches.oddsMovements,
                  oddsOpenHandicapLine: basketballMatches.oddsOpenHandicapLine,
                  oddsOpenTotalLine: basketballMatches.oddsOpenTotalLine,
                  oddsOpenHomeWin: basketballMatches.oddsOpenHomeWin,
                  oddsOpenAwayWin: basketballMatches.oddsOpenAwayWin,
                  oddsOpenHandicapHome: basketballMatches.oddsOpenHandicapHome,
                  oddsOpenHandicapAway: basketballMatches.oddsOpenHandicapAway,
                  oddsOpenTotalOver: basketballMatches.oddsOpenTotalOver,
                  oddsOpenTotalUnder: basketballMatches.oddsOpenTotalUnder,
                  league: basketballMatches.league,
                  predEngineVersion: basketballMatches.predEngineVersion,
                })
                .from(basketballMatches)
                .where(and(
                  eq(basketballMatches.matchNo, item.matchNo),
                  eq(basketballMatches.businessDate, sql`${businessDateStr}::date`),
                ))
                .limit(1)) as BballExistingRow[];
            }
         } else {
           existing = (await tx
             .select({
               id: basketballMatches.id,
               matchStatus: basketballMatches.matchStatus,
               confidence: basketballMatches.confidence,
               predictionDirection: basketballMatches.predictionDirection,
               handicapRecommendation: basketballMatches.handicapRecommendation,
               totalDirection: basketballMatches.totalDirection,
               source: basketballMatches.source,
               handicapLineNum: basketballMatches.handicapLineNum,
               totalLineNum: basketballMatches.totalLineNum,
               oddsMovements: basketballMatches.oddsMovements,
               oddsOpenHandicapLine: basketballMatches.oddsOpenHandicapLine,
               oddsOpenTotalLine: basketballMatches.oddsOpenTotalLine,
               oddsOpenHomeWin: basketballMatches.oddsOpenHomeWin,
               oddsOpenAwayWin: basketballMatches.oddsOpenAwayWin,
               oddsOpenHandicapHome: basketballMatches.oddsOpenHandicapHome,
               oddsOpenHandicapAway: basketballMatches.oddsOpenHandicapAway,
               oddsOpenTotalOver: basketballMatches.oddsOpenTotalOver,
               oddsOpenTotalUnder: basketballMatches.oddsOpenTotalUnder,
               league: basketballMatches.league,
             })
            .from(basketballMatches)
            .where(and(
              eq(basketballMatches.matchNo, item.matchNo),
              eq(basketballMatches.businessDate, sql`${businessDateStr}::date`),
            ))
            .limit(1)) as BballExistingRow[];
        }

        if (existing.length > 0) {
          const row = existing[0];
          if (row.matchStatus === 'canceled') { skipped += 1; continue; }
          const updateSet: Record<string, unknown> = {};
          const isOfficialRecord = row.source === 'sporttery';

          const existingIsPending = row.matchStatus === 'pending_sale';
          const incomingHasLine =
            (!!item.handicap && item.handicap !== '') ||
            (!!item.totalLine && item.totalLine !== '');

          if (existingIsPending && incomingHasLine) {
            updateSet.matchStatus = 'upcoming';
          }

          if (official && !isOfficialRecord) {
            // Upgrading from third-party placeholder to official record.
            // Initialize oddsOpen snapshots with first capture; live odds reflect latest.
            updateSet.handicap = item.handicap;
            updateSet.totalLine = item.totalLine;
            updateSet.homeWinOdds = this.numStrOrNull(item.homeWinOdds);
            updateSet.awayWinOdds = this.numStrOrNull(item.awayWinOdds);
            updateSet.handicapOddsHome = this.numStrOrNull(item.handicapOddsHome);
            updateSet.handicapOddsAway = this.numStrOrNull(item.handicapOddsAway);
            updateSet.totalOddsOver = this.numStrOrNull(item.totalOddsOver);
            updateSet.totalOddsUnder = this.numStrOrNull(item.totalOddsUnder);
            // oddsOpen snapshots (never overwritten after first init)
            updateSet.oddsOpenHandicapLine = item.handicap;
            updateSet.oddsOpenTotalLine = item.totalLine;
            updateSet.oddsOpenHomeWin = this.numStrOrNull(item.homeWinOdds);
            updateSet.oddsOpenAwayWin = this.numStrOrNull(item.awayWinOdds);
            updateSet.oddsOpenHandicapHome = this.numStrOrNull(item.handicapOddsHome);
            updateSet.oddsOpenHandicapAway = this.numStrOrNull(item.handicapOddsAway);
            updateSet.oddsOpenTotalOver = this.numStrOrNull(item.totalOddsOver);
            updateSet.oddsOpenTotalUnder = this.numStrOrNull(item.totalOddsUnder);
            updateSet.source = 'sporttery';
            updateSet.sourceId = null;
            const hNum = this.convertHandicapLine(
              item.handicap,
            );
             if (!Number.isNaN(hNum)) updateSet.handicapLineNum = String(hNum);
             const tNum = Number(item.totalLine);
             if (!Number.isNaN(tNum)) updateSet.totalLineNum = String(tNum);
             // 线值变动追踪（升级为官方记录）
             const upgradeLinePatch = buildLineMovementPatch({
               existingHandicapLineNum: row.handicapLineNum,
               existingTotalLineNum: row.totalLineNum,
               newHandicapLineNum: Number.isNaN(hNum) ? row.handicapLineNum : hNum,
               newTotalLineNum: Number.isNaN(tNum) ? row.totalLineNum : tNum,
               existingOddsMovements: row.oddsMovements as unknown[] | null | undefined,
               existingOddsOpenHandicapLine: row.oddsOpenHandicapLine,
               existingOddsOpenTotalLine: row.oddsOpenTotalLine,
             });
             Object.assign(updateSet, upgradeLinePatch);
           } else if (official && isOfficialRecord) {
            // Already official record: only update live odds & lines, never touch oddsOpen.
            const hOddsH = this.numStrOrNull(item.handicapOddsHome);
            const hOddsA = this.numStrOrNull(item.handicapOddsAway);
            const tOddsO = this.numStrOrNull(item.totalOddsOver);
            const tOddsU = this.numStrOrNull(item.totalOddsUnder);
            const hwOdds = this.numStrOrNull(item.homeWinOdds);
            const awOdds = this.numStrOrNull(item.awayWinOdds);
            if (hwOdds !== null) updateSet.homeWinOdds = hwOdds;
            if (awOdds !== null) updateSet.awayWinOdds = awOdds;
            if (hOddsH !== null) updateSet.handicapOddsHome = hOddsH;
            if (hOddsA !== null) updateSet.handicapOddsAway = hOddsA;
            if (tOddsO !== null) updateSet.totalOddsOver = tOddsO;
            if (tOddsU !== null) updateSet.totalOddsUnder = tOddsU;
            if (this.isNonEmptyStr(item.handicap)) updateSet.handicap = item.handicap;
            if (this.isNonEmptyStr(item.totalLine)) updateSet.totalLine = item.totalLine;
            // 官方口径一致性校验：让分线符号必须与胜负赔率强弱一致
            // 主队让分（handicap<0）→ 主队更强 → homeWinOdds < awayWinOdds
            const hcCheckNum = this.convertHandicapLine(item.handicap);
            const hwCheckNum = Number(item.homeWinOdds) || 0;
            const awCheckNum = Number(item.awayWinOdds) || 0;
            if (hcCheckNum !== 0 && hwCheckNum > 0 && awCheckNum > 0) {
              const homeStrongerByLine = hcCheckNum < 0;
              const homeStrongerByOdds = hwCheckNum < awCheckNum;
              if (homeStrongerByLine !== homeStrongerByOdds) {
                this.logger.warn(
                  `[OFFICIAL_CALIBER_CHECK] ${item.matchNo} 让分线与胜负赔率方向不一致: ` +
                  `handicap=${item.handicap} homeWinOdds=${hwCheckNum} awayWinOdds=${awCheckNum}`,
                );
              }
            }
            // Also backfill oddsOpen if still NULL (legacy records had no open snapshot)
            if (row.oddsOpenHomeWin == null && hwOdds !== null) updateSet.oddsOpenHomeWin = hwOdds;
            if (row.oddsOpenAwayWin == null && awOdds !== null) updateSet.oddsOpenAwayWin = awOdds;
            if (row.oddsOpenHandicapHome == null && hOddsH !== null) updateSet.oddsOpenHandicapHome = hOddsH;
            if (row.oddsOpenHandicapAway == null && hOddsA !== null) updateSet.oddsOpenHandicapAway = hOddsA;
            if (row.oddsOpenTotalOver == null && tOddsO !== null) updateSet.oddsOpenTotalOver = tOddsO;
            if (row.oddsOpenTotalUnder == null && tOddsU !== null) updateSet.oddsOpenTotalUnder = tOddsU;
            if (!row.oddsOpenHandicapLine && item.handicap) updateSet.oddsOpenHandicapLine = item.handicap;
            if (!row.oddsOpenTotalLine && item.totalLine) updateSet.oddsOpenTotalLine = item.totalLine;
             const hNum = this.convertHandicapLine(item.handicap);
              let liveHcpNum: number | null = null;
              let liveTotalNum: number | null = null;
              const oldHcpNum = row.handicapLineNum != null ? Number(row.handicapLineNum) : 0;
              const oldTotalNum = row.totalLineNum != null ? Number(row.totalLineNum) : 0;
              if (!Number.isNaN(hNum)) {
                if (hNum === 0 && Math.abs(oldHcpNum) > 0) {
                  // 新线值为0但旧线值有效→竞彩下架/停售，保留最后有效线值，不覆盖不记录变动
                } else {
                  updateSet.handicapLineNum = String(hNum);
                  liveHcpNum = hNum;
                }
              }
              const tNum = Number(item.totalLine);
              if (!Number.isNaN(tNum)) {
                if (tNum === 0 && oldTotalNum > 0) {
                  // 新大小分线为0但旧线值有效→竞彩下架/停售，保留最后有效线值
                } else {
                  updateSet.totalLineNum = String(tNum);
                  liveTotalNum = tNum;
                }
              }
              // 线值变动追踪（官方记录更新）
              if (liveHcpNum !== null || liveTotalNum !== null) {
               const liveLinePatch = buildLineMovementPatch({
                 existingHandicapLineNum: row.handicapLineNum,
                 existingTotalLineNum: row.totalLineNum,
                 newHandicapLineNum: liveHcpNum ?? row.handicapLineNum,
                 newTotalLineNum: liveTotalNum ?? row.totalLineNum,
                 existingOddsMovements: row.oddsMovements as unknown[] | null | undefined,
                 existingOddsOpenHandicapLine: row.oddsOpenHandicapLine,
                 existingOddsOpenTotalLine: row.oddsOpenTotalLine,
               });
               Object.assign(updateSet, liveLinePatch);
             }
           }

          // Fields any source can update
          updateSet.kickoffTime = kickoffDate;
          updateSet.dataUpdatedAt = sql`CURRENT_TIMESTAMP`;
          updateSet.updatedAt = sql`CURRENT_TIMESTAMP`;
          if (item.sourceMatchId) updateSet.sourceMatchId = item.sourceMatchId;

          if (row.matchStatus === 'upcoming' && item.matchStatus !== 'upcoming') {
            updateSet.matchStatus = item.matchStatus;
          }

           // Back-fill prediction if empty — for official source with valid market lines
           // 竞彩篮球无胜负赔率，有让分或大小分线即可补全预测
           // v9.0 fix: 已是官方记录但当前观望态时也重算
           // pending_sale升级：新补到指数线时立即重算预测
           const hasValidLine = 
             (!!item.handicap && item.handicap !== '') ||
             (!!item.totalLine && item.totalLine !== '');
           const justUpgradedFromPending = existingIsPending && hasValidLine;
          const bbIsDataDriven = row.predEngineVersion?.startsWith('data-driven');
          const bbCurrentlyWaiting = !bbIsDataDriven && (row.predictionDirection === '观望' || row.predictionDirection === '' || row.confidence === 0 || row.confidence === 50 || row.totalDirection === '观望');
          const isLive = row.matchStatus === 'live' || item.matchStatus === 'live';
          if (official && hasValidLine && !isLive && (bbCurrentlyWaiting || justUpgradedFromPending)) {
            const hOdds = Number(item.homeWinOdds) || 0;
            const aOdds = Number(item.awayWinOdds) || 0;
            const histHome = bbHistStatsMap.get(item.homeTeam || '');
            const histAway = bbHistStatsMap.get(item.awayTeam || '');
            const prediction = this.generateBasketballPrediction(
              hOdds,
              aOdds,
              item.handicap ?? '',
              item.totalLine ?? '',
              item.league || 'default',
              '',
               {
                 homePpg: histHome?.ppg,
                 awayPpg: histAway?.ppg,
                 homeOppg: histHome?.oppg,
                 awayOppg: histAway?.oppg,
                 recent10HomePpg: histHome?.recent10Ppg,
                 recent10AwayPpg: histAway?.recent10Ppg,
                 recent10HomeOppg: histHome?.recent10Oppg,
                 recent10AwayOppg: histAway?.recent10Oppg,
                 recent20HomePpg: histHome?.recent20Ppg,
                 recent20AwayPpg: histAway?.recent20Ppg,
                 recent20HomeOppg: histHome?.recent20Oppg,
                 recent20AwayOppg: histAway?.recent20Oppg,
                 recentSampleCount:
                   histHome && histAway
                     ? Math.min(histHome.sampleCount, histAway.sampleCount)
                     : histHome
                     ? histHome.sampleCount
                     : histAway
                     ? histAway.sampleCount
                     : 0,
               },
            );
            if (prediction) {
              updateSet.homeWinProb = prediction.homeWinProb;
              updateSet.awayWinProb = prediction.awayWinProb;
              updateSet.predictionDirection = prediction.predictionDirection;
              updateSet.confidence = prediction.confidence;
              if (prediction.handicapRecommendation) {
                updateSet.handicapRecommendation = prediction.handicapRecommendation;
              }
              updateSet.handicapCoverProb = prediction.handicapCoverProb;
              updateSet.handicapPickProb = prediction.handicapPickProb;
              updateSet.totalDirection = prediction.totalDirection;
              updateSet.overProb = prediction.overProb;
              updateSet.underProb = prediction.underProb;
              updateSet.totalPickProb = prediction.totalPickProb;
              updateSet.modelRules = prediction.modelRules;
              updateSet.predictedHomeScore = prediction.predictedHomeScore;
              updateSet.predictedAwayScore = prediction.predictedAwayScore;
              updateSet.predictedTotal = String(prediction.predictedTotal);
              updateSet.handicapConfidence = prediction.handicapConfidence;
              updateSet.ouConfidence = prediction.ouConfidence;
              updateSet.ouDiffVsLine = String(prediction.ouDiffVsLine);
            }
          }

          const classified = this.classifyBasketballLeague(
            item.league,
            item.homeTeam,
            item.awayTeam,
            kickoffDate,
          );
          if (classified.league !== item.league || !('category' in updateSet)) {
            updateSet.league = classified.league;
            updateSet.category = classified.category;
          }
          const hasPredictionInUpdate = updateSet.predictionDirection !== undefined || updateSet.handicapRecommendation !== undefined;
          if (bbIsDataDriven) {
            delete updateSet.predictionDirection;
            delete updateSet.homeWinProb;
            delete updateSet.awayWinProb;
            delete updateSet.confidence;
            delete updateSet.handicapRecommendation;
            delete updateSet.handicapPick;
            delete updateSet.handicapCoverProb;
            delete updateSet.handicapPickProb;
            delete updateSet.handicapConfidence;
            delete updateSet.totalDirection;
            delete updateSet.totalPick;
            delete updateSet.overProb;
            delete updateSet.underProb;
            delete updateSet.totalPickProb;
            delete updateSet.ouConfidence;
            delete updateSet.ouDiffVsLine;
            delete updateSet.predictedHomeScore;
            delete updateSet.predictedAwayScore;
            delete updateSet.predictedTotal;
            delete updateSet.modelRules;
            delete updateSet.predEngineVersion;
            delete updateSet.predictionAnchor;
            delete updateSet.advancedDataReady;
            delete updateSet.advancedDataNotice;
            delete updateSet.spreadProb1_5;
            delete updateSet.spreadProb6_10;
            delete updateSet.spreadProb11_15;
            delete updateSet.spreadProb16_20;
            delete updateSet.spreadProb21Plus;
            delete updateSet.spreadTopRange;
           } else if (official && hasPredictionInUpdate) {
             this.finalizeBasketballPick(updateSet, row.handicapRecommendation ?? null, row.totalDirection ?? null, row.league ?? 'default');
             this.appendBasketballPredictionHistory(updateSet, 'sporttery_sync_update');
           }
          await tx
            .update(basketballMatches)
            .set(updateSet)
            .where(eq(basketballMatches.id, row.id));
          updated += 1;
        } else {
          if (official) {
            // Insert new official record — generate prediction when any valid market line exists
            // 竞彩篮球只有让分+大小分玩法，无胜负赔率，不能要求胜负赔率齐全才生成
            // pending_sale: 仅有赛程无让分/大小分时先入库占位，状态为pending_sale
            const hasValidLine = 
              (!!item.handicap && item.handicap !== '') ||
              (!!item.totalLine && item.totalLine !== '');
            const finalMatchStatus = item.isPendingSale ? 'pending_sale' : item.matchStatus;
            // 官方口径一致性校验：让分线符号必须与胜负赔率强弱一致
            const hcInsertNum = this.convertHandicapLine(item.handicap);
            const hwInsertNum = Number(item.homeWinOdds) || 0;
            const awInsertNum = Number(item.awayWinOdds) || 0;
            if (hcInsertNum !== 0 && hwInsertNum > 0 && awInsertNum > 0) {
              const homeStrongerByLineInsert = hcInsertNum < 0;
              const homeStrongerByOddsInsert = hwInsertNum < awInsertNum;
              if (homeStrongerByLineInsert !== homeStrongerByOddsInsert) {
                this.logger.warn(
                  `[OFFICIAL_CALIBER_CHECK_INSERT] ${item.matchNo} 让分线与胜负赔率方向不一致: ` +
                  `handicap=${item.handicap} homeWinOdds=${hwInsertNum} awayWinOdds=${awInsertNum}`,
                );
              }
            }
            let prediction: ReturnType<typeof this.generateBasketballPrediction> = null;
            if (hasValidLine) {
              const hOdds = Number(item.homeWinOdds) || 0;
              const aOdds = Number(item.awayWinOdds) || 0;
              prediction = this.generateBasketballPrediction(
                hOdds,
                aOdds,
                item.handicap ?? '',
                item.totalLine ?? '',
                item.league || 'default',
              );
            }

            const hLineNum = this.convertHandicapLine(item.handicap);
            const tLineNum = Number(item.totalLine) || 0;
            const insertObj = {
              sourceMatchId: item.sourceMatchId ?? null,
              matchNo: item.matchNo,
              matchDate: sql`${businessDateStr}::date`,
              businessDate: sql`${businessDateStr}::date`,
              league: item.league,
              homeTeam: item.homeTeam,
              awayTeam: item.awayTeam,
              kickoffTime: kickoffDate,
              matchStatus: finalMatchStatus,
              source: 'sporttery',
              liveScoreSource: '',
              handicap: item.handicap,
              handicapLineNum: !Number.isNaN(hLineNum) ? String(hLineNum) : '0',
              handicapRecommendation: prediction?.handicapRecommendation || '',
              handicapCoverProb: prediction?.handicapCoverProb ?? 50,
              totalLine: item.totalLine,
              totalLineNum: String(tLineNum),
              homeWinOdds: this.numStrOrNull(item.homeWinOdds),
              awayWinOdds: this.numStrOrNull(item.awayWinOdds),
              handicapOddsHome: this.numStrOrNull(item.handicapOddsHome),
              handicapOddsAway: this.numStrOrNull(item.handicapOddsAway),
              totalOddsOver: this.numStrOrNull(item.totalOddsOver),
              totalOddsUnder: this.numStrOrNull(item.totalOddsUnder),
              oddsOpenHandicapLine: item.handicap,
              oddsOpenTotalLine: item.totalLine,
              oddsOpenHomeWin: this.numStrOrNull(item.homeWinOdds),
              oddsOpenAwayWin: this.numStrOrNull(item.awayWinOdds),
              oddsOpenHandicapHome: this.numStrOrNull(item.handicapOddsHome),
              oddsOpenHandicapAway: this.numStrOrNull(item.handicapOddsAway),
              oddsOpenTotalOver: this.numStrOrNull(item.totalOddsOver),
              oddsOpenTotalUnder: this.numStrOrNull(item.totalOddsUnder),
              homeWinProb: prediction?.homeWinProb ?? 0,
              awayWinProb: prediction?.awayWinProb ?? 0,
              predictionDirection: prediction?.predictionDirection ?? '',
              overProb: prediction?.overProb ?? 50,
              underProb: prediction?.underProb ?? 50,
              totalDirection: prediction?.totalDirection ?? '',
              spreadProb15: 0,
              spreadProb610: 0,
              spreadProb1115: 0,
              spreadProb1620: 0,
              spreadProb21Plus: 0,
              confidence: prediction?.confidence ?? 0,
              intel: '',
              riskWarning: '',
              modelRules: prediction?.modelRules ?? [],
              predictedHomeScore: prediction?.predictedHomeScore ?? 0,
              predictedAwayScore: prediction?.predictedAwayScore ?? 0,
              predictedTotal: String(prediction?.predictedTotal ?? 0),
              handicapConfidence: prediction?.handicapConfidence ?? '低',
              ouConfidence: prediction?.ouConfidence ?? '低',
              ouDiffVsLine: String(prediction?.ouDiffVsLine ?? 0),
            };
            const classifiedInsert = this.classifyBasketballLeague(
              item.league,
              item.homeTeam,
              item.awayTeam,
              kickoffDate,
            );
            insertObj.league = classifiedInsert.league;
            (insertObj as Record<string, unknown>).category = classifiedInsert.category;
            this.finalizeBasketballPick(insertObj, undefined, undefined, item.league ?? 'default');
            const [newRow] = await tx.insert(basketballMatches).values(insertObj).returning({ id: basketballMatches.id });
            inserted += 1;
            if (newRow) {
              const hNum = this.convertHandicapLine(item.handicap);
              const hh = Number(item.handicapOddsHome) || 0;
              const ha = Number(item.handicapOddsAway) || 0;
              if (!Number.isNaN(hNum) && hNum !== 0 && (hh > 0 || ha > 0)) {
                await insertBasketballOddsSnapshotIfChanged(
                  tx, newRow.id, 'handicap',
                  {
                    home: hh > 0 ? hh : undefined,
                    away: ha > 0 ? ha : undefined,
                    line: hNum,
                  },
                  'sporttery',
                );
              }
              const tNum = Number(item.totalLine) || 0;
              const to = Number(item.totalOddsOver) || 0;
              const tu = Number(item.totalOddsUnder) || 0;
              if (tNum > 0 && (to > 0 || tu > 0)) {
                await insertBasketballOddsSnapshotIfChanged(
                  tx, newRow.id, 'total',
                  {
                    over: to > 0 ? to : undefined,
                    under: tu > 0 ? tu : undefined,
                    line: tNum,
                  },
                  'sporttery',
                );
              }
            }
          } else {
            // Third-party source — insert with auto-generated prediction (no odds → derive from spread or 50/50 baseline)
            const insertObj = {
              sourceMatchId: item.sourceMatchId ?? null,
              matchNo: item.matchNo,
              matchDate: sql`${businessDateStr}::date`,
              businessDate: sql`${businessDateStr}::date`,
              league: item.league,
              homeTeam: item.homeTeam,
              awayTeam: item.awayTeam,
              kickoffTime: kickoffDate,
              matchStatus: 'upcoming',
              source: item.source ?? 'qiumibao',
              liveScoreSource: '',
              handicap: '',
              handicapLineNum: '0',
              handicapRecommendation: '',
              handicapCoverProb: 50,
              handicapPickProb: 50,
              totalLine: '',
              totalLineNum: '0',
              homeWinOdds: null,
              awayWinOdds: null,
              handicapOddsHome: null,
              handicapOddsAway: null,
              totalOddsOver: null,
              totalOddsUnder: null,
              homeWinProb: 0,
              awayWinProb: 0,
              predictionDirection: '',
              overProb: 50,
              underProb: 50,
              totalDirection: '',
              totalPickProb: 50,
              spreadProb15: 0,
              spreadProb610: 0,
              spreadProb1115: 0,
              spreadProb1620: 0,
              spreadProb21Plus: 0,
              confidence: 0,
              intel: '',
              riskWarning: '',
              modelRules: [],
              predictedHomeScore: 0,
              predictedAwayScore: 0,
              predictedTotal: '0',
              handicapConfidence: '低',
              ouConfidence: '低',
              ouDiffVsLine: '0',
            };
            const classifiedInsert = this.classifyBasketballLeague(
              item.league,
              item.homeTeam,
              item.awayTeam,
              kickoffDate,
            );
            insertObj.league = classifiedInsert.league;
            (insertObj as Record<string, unknown>).category = classifiedInsert.category;
            // Auto-generate prediction for third-party sources
            const hcStr = item.handicap ?? '';
            const hcNum = Number(hcStr) || 0;
            const hwOddsNum = Number(item.homeWinOdds) || 0;
            const awOddsNum = Number(item.awayWinOdds) || 0;
            const tLineVal = Number(item.totalLine) || 0;
            const predLeague = classifiedInsert.league;
            const prediction = this.generateBasketballPrediction(
              hwOddsNum,
              awOddsNum,
              this.isBasketballLineValid(predLeague, 'spread', hcNum) ? hcStr : '',
              this.isBasketballLineValid(predLeague, 'total', tLineVal) ? item.totalLine : undefined,
              predLeague,
              '',
            );
            if (prediction) {
              insertObj.handicap = this.isBasketballLineValid(predLeague, 'spread', hcNum) ? hcStr : '';
              insertObj.handicapLineNum = this.isBasketballLineValid(predLeague, 'spread', hcNum) ? String(hcNum) : '0';
              insertObj.totalLine = this.isBasketballLineValid(predLeague, 'total', tLineVal) ? String(tLineVal) : '';
              insertObj.totalLineNum = this.isBasketballLineValid(predLeague, 'total', tLineVal) ? String(tLineVal) : '0';
              insertObj.homeWinProb = prediction.homeWinProb;
              insertObj.awayWinProb = prediction.awayWinProb;
              insertObj.predictionDirection = prediction.predictionDirection;
              insertObj.confidence = prediction.confidence;
              insertObj.handicapRecommendation = prediction.handicapRecommendation;
              insertObj.handicapCoverProb = prediction.handicapCoverProb;
              insertObj.handicapPickProb = prediction.handicapPickProb;
              insertObj.totalDirection = prediction.totalDirection;
              insertObj.overProb = prediction.overProb;
              insertObj.underProb = prediction.underProb;
              insertObj.totalPickProb = prediction.totalPickProb;
              insertObj.modelRules = prediction.modelRules;
              insertObj.predictedHomeScore = prediction.predictedHomeScore;
              insertObj.predictedAwayScore = prediction.predictedAwayScore;
              insertObj.predictedTotal = String(prediction.predictedTotal);
              insertObj.handicapConfidence = prediction.handicapConfidence;
              insertObj.ouConfidence = prediction.ouConfidence;
              insertObj.ouDiffVsLine = String(prediction.ouDiffVsLine);
              insertObj.spreadProb15 = 0;
              insertObj.spreadProb610 = 0;
              insertObj.spreadProb1115 = 0;
              insertObj.spreadProb1620 = 0;
              insertObj.spreadProb21Plus = 0;
            }
            this.finalizeBasketballPick(insertObj, undefined, undefined, classifiedInsert.league);
            const [newRow] = await tx.insert(basketballMatches).values(insertObj).returning({ id: basketballMatches.id });
            inserted += 1;
            if (newRow) {
              const hcStr2 = item.handicap ?? '';
              const hcNum2 = Number(hcStr2) || 0;
              const hh2 = Number(item.handicapOddsHome) || 0;
              const ha2 = Number(item.handicapOddsAway) || 0;
              const hValid = this.isBasketballLineValid(predLeague, 'spread', hcNum2);
              if (hValid && (hh2 > 0 || ha2 > 0)) {
                await insertBasketballOddsSnapshotIfChanged(
                  tx, newRow.id, 'handicap',
                  {
                    home: hh2 > 0 ? hh2 : undefined,
                    away: ha2 > 0 ? ha2 : undefined,
                    line: hcNum2,
                  },
                  item.source ?? 'qiumibao',
                );
              }
              const tLineVal2 = Number(item.totalLine) || 0;
              const to2 = Number(item.totalOddsOver) || 0;
              const tu2 = Number(item.totalOddsUnder) || 0;
              const tValid2 = this.isBasketballLineValid(predLeague, 'total', tLineVal2);
              if (tValid2 && (to2 > 0 || tu2 > 0)) {
                await insertBasketballOddsSnapshotIfChanged(
                  tx, newRow.id, 'total',
                  {
                    over: to2 > 0 ? to2 : undefined,
                    under: tu2 > 0 ? tu2 : undefined,
                    line: tLineVal2,
                  },
                  item.source ?? 'qiumibao',
                );
              }
            }
          }
        }
        } catch (err) {
          skipped += 1;
          const msg = this.errorMessage(err);
          lastError = msg;
          this.logger.warn(`BB_UPSERT_FAIL ${item.matchNo}: ${msg}`);
          this.logger.error(`Basketball upsert skipped match ${item.matchNo}: ${msg}`);
        }
      }

      const postSnapshot = await tx.select({ value: count() }).from(basketballMatches);
      const postCount = postSnapshot[0]?.value ?? 0;
      if (postCount < preCount) {
        throw new Error(
          `[DATA_SAFETY_GATE] 篮球比赛数不增反减: pre=${preCount}, post=${postCount}`,
        );
      }
    });

    return { inserted, updated, skipped, lastError };
  }

  // --- Helpers ---

  private convertHandicapLine(
    rawLine: string | number | undefined | null,
  ): number {
    const raw = Number(rawLine);
    if (Number.isNaN(raw)) return 0;

    // 官方 hdc.goalLine 本身已是名义主队视角的结算线，与内部口径一致：
    //   负 = 主队让分（主队强），正 = 主队受让（主队弱）
    // 直接原样返回，禁止用指数大小或 hf/af 推断翻转符号
    return raw;
  }

  private numStrOrNull(val: string | number | undefined | null): string | null {
    if (val === undefined || val === null || val === '') return null;
    return String(val);
  }

  private validOddsOrNull(val: string | number | undefined | null): string | null {
    const num = Number(val);
    if (!num || !Number.isFinite(num) || num <= 1 || num > 100) return null;
    return String(num);
  }

  private isNonEmptyStr(v: unknown): boolean {
    return typeof v === 'string' && v.trim().length > 0;
  }

  private leagueKey(leagueName: string): string {
    const name = leagueName || '';
    if (name.includes('WNBA') || name.includes('美国女子篮球') || name.includes('美职女篮')) return 'WNBA';
    if (name.includes('德篮') || name.includes('BBL') || name.includes('德国篮球')) return '德篮联';
    if (name.includes('澳NBL') || (name.includes('NBL') && !name.includes('CBA')) || name.includes('澳大利亚篮球')) return '澳NBL';
    if (name.includes('亚运') && name.includes('女篮')) return '亚运女篮';
    if (name.includes('亚运') && name.includes('男篮')) return '亚运男篮';
    if ((name.includes('女篮') || name.includes('男篮')) && name.includes('世界杯')) return '世界杯';
    if (name.includes('NBA') || name.includes('美职篮') || name.includes('美国男子篮球') || name.includes('美国职业篮球')) return 'NBA';
    if (name.includes('CBA') || name.includes('中职篮') || name.includes('中国男子篮球')) return 'CBA';
    if (name.includes('欧冠篮') || name.includes('欧洲篮球') || name.includes('欧篮联')) return '欧冠篮';
    if (name.includes('西班牙') || name.includes('西篮') || name.includes('西甲篮') || name.includes('ACB')) return '西篮联';
    return 'default';
  }

  private readonly BASKETBALL_LEAGUE_BASELINE: Record<string, {
    total: number;
    handicapStd: number;
    homeAdvantage: number;
    isFiba: boolean;
    sampleCount: number;
  }> = {
    WNBA: { total: 166, handicapStd: 10, homeAdvantage: 2.5, isFiba: false, sampleCount: 500 },
    德篮联: { total: 173, handicapStd: 11.5, homeAdvantage: 3.0, isFiba: false, sampleCount: 200 },
    澳NBL: { total: 188, handicapStd: 11.5, homeAdvantage: 3.0, isFiba: false, sampleCount: 58 },
    亚运女篮: { total: 138, handicapStd: 8, homeAdvantage: 2.5, isFiba: true, sampleCount: 60 },
    亚运男篮: { total: 160, handicapStd: 9, homeAdvantage: 3.0, isFiba: true, sampleCount: 80 },
    世界杯: { total: 160, handicapStd: 9, homeAdvantage: 3.0, isFiba: true, sampleCount: 100 },
    NBA: { total: 232, handicapStd: 12, homeAdvantage: 2.5, isFiba: false, sampleCount: 1000 },
    CBA: { total: 195, handicapStd: 12, homeAdvantage: 3.0, isFiba: false, sampleCount: 400 },
    欧冠篮: { total: 173, handicapStd: 11, homeAdvantage: 2.5, isFiba: false, sampleCount: 200 },
    西篮联: { total: 186, handicapStd: 11.5, homeAdvantage: 2.5, isFiba: false, sampleCount: 35 },
    default: { total: 170, handicapStd: 11.5, homeAdvantage: 2.5, isFiba: false, sampleCount: 0 },
  };

  private getBasketballBaseline(league: string) {
    const key = this.leagueKey(league);
    return this.BASKETBALL_LEAGUE_BASELINE[key] ?? this.BASKETBALL_LEAGUE_BASELINE.default;
  }

  private isProvidedNum(v: unknown): boolean {
    if (typeof v === 'number') return !Number.isNaN(v);
    if (typeof v === 'string' && v.trim().length > 0) {
      const n = Number(v);
      return !Number.isNaN(n);
    }
    return false;
  }

  private strOrKeep(v: string | number | undefined | null): string | null {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string' && v.trim().length === 0) return null;
    return String(v);
  }

  private buildKickoffTime(dateStr: string, timeStr: string): string {
    if (!dateStr || !timeStr) {
      return new Date().toISOString();
    }
    const parts = timeStr.split(':');
    const hh = parts[0] || '00';
    const mm = parts[1] || '00';
    const ss = parts[2] || '00';
    return `${dateStr}T${hh}:${mm}:${ss}+08:00`;
  }

  private async fetchSportteryJson<T>(
    url: string,
    label: string,
    customHeaders?: Record<string, string>,
  ): Promise<T> {
    const headers = customHeaders ?? SPORTTERY_HEADERS;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= SPORTTERY_MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SPORTTERY_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < SPORTTERY_MAX_RETRIES) {
          const backoffMs = 1000 * 2 ** attempt;
          this.logger.warn(
            `Sporttery ${label} fetch attempt ${attempt + 1}/${SPORTTERY_MAX_RETRIES + 1} failed: ${lastError.message}; retrying in ${backoffMs}ms`,
          );
          await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }
    throw new Error(`Sporttery ${label} fetch failed after ${SPORTTERY_MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown'}`);
  }

  private mapFootballStatus(sportteryStatus: string): string {
    if (!sportteryStatus) return 'upcoming';
    const s = sportteryStatus.toLowerCase();
    if (s.includes('sell') || s.includes('upcoming') || s === 'selling') return 'upcoming';
    if (s.includes('live') || s.includes('going') || s.includes('playing')) return 'live';
    if (s.includes('end') || s.includes('finish') || s.includes('result')) return 'finished';
    if (s.includes('cancel') || s.includes('stop')) return 'cancelled';
    return 'upcoming';
  }

  private mapBasketballStatus(sportteryStatus: string): string {
    return this.mapFootballStatus(sportteryStatus);
  }

  /**
   * 全库重算篮球比赛命中字段（hitWdw / hitHandicap / hitOverunder）。
   * 仅对已有比分（home_score / away_score 均非空）的记录重算。
   * 使用 Drizzle helper 写法，不走 raw SQL。
   * 备用方法，按需手动触发，不在启动时自动调用。
   */
  private async recalculateBasketballHits(): Promise<{ updated: number }> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        predictionDirection: basketballMatches.predictionDirection,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalDirection: basketballMatches.totalDirection,
        totalLineNum: basketballMatches.totalLineNum,
        frozenHandicapRec: basketballMatches.frozenHandicapRec,
        frozenTotalDirection: basketballMatches.frozenTotalDirection,
        frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
        frozenHandicapLine: basketballMatches.frozenHandicapLine,
        frozenTotalLine: basketballMatches.frozenTotalLine,
      })
      .from(basketballMatches)
      .where(
        and(
          sql`${basketballMatches.homeScore} IS NOT NULL`,
          sql`${basketballMatches.awayScore} IS NOT NULL`,
        ),
      );

    if (rows.length === 0) return { updated: 0 };

    let updated = 0;
    await this.db.transaction(async (tx) => {
      for (const row of rows) {
        const homeScore: number = row.homeScore as number;
        const awayScore: number = row.awayScore as number;
        const hits = this.computeBasketballHits(
          homeScore,
          awayScore,
          row.predictionDirection ?? row.frozenPredictionDirection as string | null,
          row.handicapLineNum ?? row.frozenHandicapLine,
          row.handicapRecommendation ?? row.frozenHandicapRec as string | null,
          row.totalLineNum ?? row.frozenTotalLine,
          row.totalDirection ?? row.frozenTotalDirection as string | null,
        );
        const patch: Record<string, unknown> = {};
        if (hits.hitWdw !== null) patch.hitWdw = hits.hitWdw;
        if (hits.hitHandicap !== undefined) patch.hitHandicap = hits.hitHandicap;
        if (hits.hitOverunder !== undefined) patch.hitOverunder = hits.hitOverunder;
        if (Object.keys(patch).length === 0) continue;
        patch.updatedAt = sql`CURRENT_TIMESTAMP`;
        const result = await tx
          .update(basketballMatches)
          .set(patch)
          .where(eq(basketballMatches.id, row.id))
          .returning({ id: basketballMatches.id });
        if (result.length > 0) updated += 1;
      }
    });

    return { updated };
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) {
      const pgCode = this.extractPostgresCode(err);
      const pgMsg = this.extractPostgresMessage(err);
      if (pgCode && pgMsg) {
        return `${err.message} [PG ${pgCode}: ${pgMsg}]`;
      }
      return err.message;
    }
    if (typeof err === 'string') return err;
    return JSON.stringify(err);
  }

  private extractPostgresCode(err: unknown): string | undefined {
    let current: unknown = err;
    for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
      const { code, cause } = current as { code?: unknown; cause?: unknown };
      if (typeof code === 'string' && code.length >= 5) return code;
      current = cause;
    }
    return undefined;
  }

  private extractPostgresMessage(err: unknown): string | undefined {
    let current: unknown = err;
    for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
      const { message, cause } = current as { message?: unknown; cause?: unknown };
      if (typeof message === 'string' && message.length > 0 && depth > 0) return message;
      current = cause;
    }
    return undefined;
  }

  private isDeadlockError(err: unknown): boolean {
    const code = this.extractPostgresCode(err);
    return code === '40P01';
  }

  private async runWithDeadlockRetry<T>(
    fn: (tx: PostgresJsDatabase) => Promise<T>,
  ): Promise<T> {
    const backoffMs = [200, 500, 1000, 2000, 4000];
    let lastError: unknown;
    for (let attempt = 0; attempt <= backoffMs.length; attempt += 1) {
      try {
        let result: T | undefined;
        await this.db.transaction(async (tx) => {
          result = await fn(tx);
        });
        return result as T;
      } catch (err: unknown) {
        lastError = err;
        if (!this.isDeadlockError(err)) throw err;
        if (attempt >= backoffMs.length) break;
        const waitMs = backoffMs[attempt] + Math.floor(Math.random() * 500);
        this.logger.warn(
          `Deadlock detected (attempt ${attempt + 1}/${backoffMs.length + 1}), retrying in ${waitMs}ms...`,
        );
        await new Promise<void>((resolve) => { setTimeout(resolve, waitMs); });
      }
    }
    throw lastError;
  }

  private async runPerItemDeadlockRetry<T>(
    items: T[],
    fn: (tx: PostgresJsDatabase, item: T) => Promise<void>,
  ): Promise<void> {
    for (const item of items) {
      await this.runWithDeadlockRetry(async (tx) => {
        await tx.execute(sql`SET LOCAL app.sync_authorized = 'true'`);
        await fn(tx, item);
      });
    }
  }

  async recalcFootballUpcomingPredictions(): Promise<{
    recalculated: number;
    skipped: number;
    errors: number;
  }> {
    this.logger.log('Starting v6.6 recalc for upcoming football matches');
    const rows = await this.db.select()
      .from(matches)
      .where(
        and(
          ne(matches.matchStatus, 'finished'),
          ne(matches.matchStatus, 'cancelled'),
          ne(matches.matchStatus, 'postponed'),
        ),
      );
    const homeTeams = [...new Set(rows.map((r) => r.homeTeam).filter(Boolean))];
    const awayTeams = [...new Set(rows.map((r) => r.awayTeam).filter(Boolean))];
    const allTeamNames = [...new Set([...homeTeams, ...awayTeams])];
    const eloRatingsMap = new Map<string, { rating: number; matchesPlayed: number }>();
    if (allTeamNames.length > 0 && this.eloHistoryService) {
      try {
        const eloResult = await this.eloHistoryService.getTeamRatings(
          'football',
          allTeamNames.map((name) => ({ teamName: name })),
        );
        for (const [teamName, val] of eloResult) {
          eloRatingsMap.set(teamName, val);
        }
      } catch (eloErr) {
        this.logger.warn('Elo 批量查询失败，降级为无 Elo', (eloErr as Error).message);
      }
    }
    let recalculated = 0;
    let skipped = 0;
    let errors = 0;
    for (const row of rows) {
      try {
        const isOfficialLocked = Boolean(row.isOfficialLocked) ||
          (Array.isArray(row.modelRules)
            && row.modelRules.some((r: string) => r.includes('官方数据锁定')));
        if (isOfficialLocked) {
          skipped += 1;
          continue;
        }
        let oddsH = Number(row.oddsOpenHome) || 0;
        let oddsD = Number(row.oddsOpenDraw) || 0;
        let oddsA = Number(row.oddsOpenAway) || 0;
        if (oddsH <= 0 || oddsD <= 0 || oddsA <= 0) {
          oddsH = Number(row.oddsLiveHome) || 0;
          oddsD = Number(row.oddsLiveDraw) || 0;
          oddsA = Number(row.oddsLiveAway) || 0;
        }
        if (oddsH <= 0 || oddsD <= 0 || oddsA <= 0) {
          // v6.8.4 数据不足硬拦截：调用统一公共函数，三项全部观望
          const guardRecord: Record<string, unknown> = {};
          this.applyFootballDataInsufficientGuard(guardRecord);
          await this.db.update(matches)
            .set({
              homeWinProb: guardRecord.homeWinProb as number,
              drawProb: guardRecord.drawProb as number,
              awayWinProb: guardRecord.awayWinProb as number,
              predictionDirection: guardRecord.predictionDirection as string,
              confidence: guardRecord.confidence as number,
              lowConfidence: guardRecord.lowConfidence as boolean,
              handicapRecommendation: guardRecord.handicapRecommendation as string,
              handicapWinProb: guardRecord.handicapWinProb as string,
              handicapDrawProb: guardRecord.handicapDrawProb as string,
              handicapLoseProb: guardRecord.handicapLoseProb as string,
              handicapSecondChoice: guardRecord.handicapSecondChoice as string,
              handicapConfidence: guardRecord.handicapConfidence as string,
              overProb: guardRecord.overProb as number,
              underProb: guardRecord.underProb as number,
              totalPick: guardRecord.totalPick as string,
              totalPickProb: guardRecord.totalPickProb as number,
              ouConfidence: guardRecord.ouConfidence as string,
              mostLikelyScore: '',
              modelRules: guardRecord.modelRules as string[],
              scoreProbs: [] as unknown as string[],
              totalGoalsProb: [] as unknown as string[],
              halfFullProb: [] as unknown as string[],
              predEngineVersion: FOOTBALL_MODEL_VERSION,
              updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(matches.id, row.id));
          recalculated += 1;
        } else {
          const hAvg = Number(row.homeGoalsAvg) || 0;
          const aAvg = Number(row.awayGoalsAvg) || 0;
          const hcAvg = Number(row.homeConcededAvg) || 0;
          const acAvg = Number(row.awayConcededAvg) || 0;
          const strengthInput: Record<string, unknown> = {};
          if (hAvg > 0) strengthInput.homeGoalsAvg = hAvg;
          if (aAvg > 0) strengthInput.awayGoalsAvg = aAvg;
          if (hcAvg > 0) strengthInput.homeConcededAvg = hcAvg;
          if (acAvg > 0) strengthInput.awayConcededAvg = acAvg;
          // Elo 注入
          const homeElo = eloRatingsMap.get(row.homeTeam ?? '');
          const awayElo = eloRatingsMap.get(row.awayTeam ?? '');
          if (homeElo && awayElo) {
            strengthInput.eloHome = homeElo.rating;
            strengthInput.eloAway = awayElo.rating;
            strengthInput.eloGap = homeElo.rating - awayElo.rating;
          }
          // xG 注入
          const advStats = (row as { advancedStats?: Record<string, unknown> }).advancedStats;
          let homeXgVal: number | undefined;
          let awayXgVal: number | undefined;
          let xgQualityVal: 'high' | 'medium' | 'low' | 'none' = 'none';
          if (advStats && typeof advStats === 'object' &&
              typeof advStats.xgHome === 'number' && advStats.xgHome > 0 &&
              typeof advStats.xgAway === 'number' && advStats.xgAway > 0) {
            homeXgVal = advStats.xgHome;
            awayXgVal = advStats.xgAway;
            const storedQuality: unknown = advStats.quality;
            if (storedQuality === 'high' || storedQuality === 'medium' || storedQuality === 'low') {
              xgQualityVal = storedQuality;
            } else if (storedQuality === 'very_low') {
              xgQualityVal = 'low';
            } else {
              xgQualityVal = 'high';
            }
          } else if (hAvg > 0 && aAvg > 0) {
            homeXgVal = hAvg;
            awayXgVal = aAvg;
            xgQualityVal = 'low';
          }
          if (homeXgVal !== undefined && awayXgVal !== undefined) {
            strengthInput.homeXg = homeXgVal;
            strengthInput.awayXg = awayXgVal;
            strengthInput.xgQuality = xgQualityVal;
          }
          if (advStats && typeof advStats === 'object') {
            if (typeof advStats.shotsHome === 'number' && advStats.shotsHome > 0) {
              strengthInput.homeShotsPerGame = advStats.shotsHome;
            }
            if (typeof advStats.shotsAway === 'number' && advStats.shotsAway > 0) {
              strengthInput.awayShotsPerGame = advStats.shotsAway;
            }
          }
          // 近态与交锋（从 row 已有字段取）
          const hForm = (row as { homeForm?: string[] }).homeForm ?? [];
          const aForm = (row as { awayForm?: string[] }).awayForm ?? [];
          if (hForm.length > 0) strengthInput.homeFormWdl = hForm;
          if (aForm.length > 0) strengthInput.awayFormWdl = aForm;
          const finalStrength = Object.keys(strengthInput).length > 0
            ? (strengthInput as Parameters<typeof this.generateFootballPrediction>[6])
            : undefined;
           const prediction = this.generateFootballPrediction(
             oddsH,
             oddsD,
             oddsA,
             row.handicap || '0',
             row.totalGoals ?? undefined,
             row.league ?? undefined,
             finalStrength,
           );
           if (!prediction) {
             skipped += 1;
             continue;
           }
           const recalcSet: Record<string, unknown> = {
             homeWinProb: prediction.homeWinProb,
             drawProb: prediction.drawProb,
             awayWinProb: prediction.awayWinProb,
             predictionDirection: prediction.predictionDirection,
             confidence: prediction.confidence,
             lowConfidence: prediction.lowConfidence,
             handicapRecommendation: prediction.handicapRecommendation,
             handicapWinProb: String(prediction.handicapWinProb),
             handicapDrawProb: String(prediction.handicapDrawProb),
             handicapLoseProb: String(prediction.handicapLoseProb),
             handicapSecondChoice: prediction.handicapSecondChoice,
             overProb: prediction.overProb,
             underProb: prediction.underProb,
             totalPick: prediction.totalPick,
             totalPickProb: prediction.totalPickProb,
             mostLikelyScore: prediction.mostLikelyScore,
             modelRules: prediction.modelRules,
             scoreProbs: prediction.scoreProbs,
             totalGoalsProb: prediction.totalGoalsProb as unknown as string[],
             halfFullProb: prediction.halfFullProb as unknown as string[],
             eloHome: homeElo?.rating ? String(homeElo.rating) : null,
             eloAway: awayElo?.rating ? String(awayElo.rating) : null,
             eloGap: homeElo?.rating && awayElo?.rating ? String(homeElo.rating - awayElo.rating) : null,
             predEngineVersion: FOOTBALL_MODEL_VERSION,
             updatedAt: sql`CURRENT_TIMESTAMP`,
           };
           await this.db.update(matches)
             .set(recalcSet)
             .where(eq(matches.id, row.id));
           recalculated += 1;
         }
       } catch (err) {
         errors += 1;
         this.logger.warn(`football recalc failed for ${row.matchNo}: ${(err as Error).message}`);
      }
    }
    this.logger.log(
      `recalcFootballUpcomingPredictions done: recalculated=${recalculated} skipped=${skipped} errors=${errors}`,
    );
    return { recalculated, skipped, errors };
  }

  async prefetchMissingBasketballInjuries(): Promise<{ updated: number; failed: number; skipped: number }> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        sourceId: basketballMatches.sourceId,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        source: basketballMatches.source,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'upcoming'),
           sql`(
             ${basketballMatches.injuries} IS NULL
             OR jsonb_typeof(${basketballMatches.injuries}) != 'object'
             OR ${basketballMatches.injuries}->>'source' IS NULL
           )`,
           sql`(${basketballMatches.league} LIKE '%NBA%' OR ${basketballMatches.league} LIKE '%美国职业篮球%' OR ${basketballMatches.league} LIKE '%WNBA%' OR ${basketballMatches.league} = '篮球常规赛' OR ${basketballMatches.league} LIKE '篮球季%')`,
          sql`NOT EXISTS (
            SELECT 1 FROM ${injuryReports}
            WHERE ${injuryReports.matchId} = ${basketballMatches.id}
              AND ${injuryReports.sport} = 'basketball'
          )`,
        ),
      );

    if (rows.length === 0) {
      this.logger.log('[injury-prefetch] NBA/WNBA: all matches already have injury data (JSONB or injury_reports), skipping ESPN fetch');
      return { updated: 0, failed: 0, skipped: 0 };
    }

    this.logger.log(`[injury-prefetch] ${rows.length} upcoming NBA/WNBA matches missing injuries (both JSONB and injury_reports), fetching from ESPN`);

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const leagueCode = this.guessEspnBasketballLeagueCode(row.league);
        if (!leagueCode || !row.sourceId) {
          skipped += 1;
          continue;
        }

        const summary = await this.espnSource.fetchBasketballSummary(row.sourceId, leagueCode);
        if (!summary) {
          failed += 1;
          continue;
        }

        const hasInjuries = summary.homeInjuries.length > 0 || summary.awayInjuries.length > 0;
        const injuriesData: Record<string, unknown> = {
          home: summary.homeInjuries.map((i) => ({
            name: i.athleteName,
            status: i.status,
            type: i.type || '',
          })),
          away: summary.awayInjuries.map((i) => ({
            name: i.athleteName,
            status: i.status,
            type: i.type || '',
          })),
          source: 'ESPN',
          fetchedAt: new Date().toISOString(),
        };
        if (!hasInjuries) {
          injuriesData.status = 'clean';
        }

        const result = await this.db
          .update(basketballMatches)
          .set({
            injuries: sql`${JSON.stringify(injuriesData)}::jsonb`,
            intelUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(basketballMatches.id, row.id))
          .returning({ id: basketballMatches.id });

        if (result.length > 0) updated += 1;
        else failed += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(`[injury-prefetch] failed for ${row.homeTeam} vs ${row.awayTeam}: ${this.errorMessage(err)}`);
      }
    }

    const euroRows = await this.db
      .select({
        id: basketballMatches.id,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'upcoming'),
           sql`(
             ${basketballMatches.injuries} IS NULL
             OR jsonb_typeof(${basketballMatches.injuries}) != 'object'
             OR ${basketballMatches.injuries}->>'source' IS NULL
           )`,
           sql`(${basketballMatches.league} LIKE '%欧篮%' OR ${basketballMatches.league} LIKE '%欧洲篮球联赛%' OR ${basketballMatches.league} ILIKE '%euroleague%')`,
          sql`NOT EXISTS (
            SELECT 1 FROM ${injuryReports}
            WHERE ${injuryReports.matchId} = ${basketballMatches.id}
              AND ${injuryReports.sport} = 'basketball'
          )`,
        ),
      );

    if (euroRows.length > 0) {
      this.logger.log(`[injury-prefetch] ${euroRows.length} EuroLeague matches missing injuries, fetching from EuroLeague official`);
      let euroRound = this.euroleagueInjurySource.getCurrentRound();
      if (euroRound === null) {
        euroRound = await this.euroleagueInjurySource.fetchCurrentRound();
      }
      if (euroRound !== null) {
        const fetchOk = await this.euroleagueInjurySource.fetchRoundInjuries(euroRound);
        if (fetchOk) {
          for (const row of euroRows) {
            try {
              const injuries = this.euroleagueInjurySource.buildInjuriesJson(row.homeTeam, row.awayTeam);
              if (!injuries) {
                skipped += 1;
                continue;
              }
              const injuriesData: Record<string, unknown> = {
                home: injuries.home.map((r) => ({
                  name: r.playerName,
                  status: r.status,
                  type: r.injury,
                  date: r.date,
                })),
                away: injuries.away.map((r) => ({
                  name: r.playerName,
                  status: r.status,
                  type: r.injury,
                  date: r.date,
                })),
                source: 'euroleague-official',
                fetchedAt: new Date().toISOString(),
              };
              const result = await this.db
                .update(basketballMatches)
                .set({
                  injuries: sql`${JSON.stringify(injuriesData)}::jsonb`,
                  intelUpdatedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(basketballMatches.id, row.id))
                .returning({ id: basketballMatches.id });
              if (result.length > 0) updated += 1;
              else failed += 1;
            } catch (err) {
              failed += 1;
              this.logger.warn(`[injury-prefetch] euroleague failed for ${row.homeTeam} vs ${row.awayTeam}: ${this.errorMessage(err)}`);
            }
          }
        } else {
          failed += euroRows.length;
        }
      } else {
        skipped += euroRows.length;
      }
    }

    this.logger.log(`[injury-prefetch] done: updated=${updated}, failed=${failed}, skipped=${skipped}`);

    // 双源一致性修复：injury_reports 有数据但 injuries JSONB 为空/缺一方时，从结构化表回写 JSONB
    // 保证 V11 升级判定和前端展示与权威源（injury_reports）一致
    try {
      const syncResult = await this.syncInjuryReportsToJsonb();
      if (syncResult > 0) {
        updated += syncResult;
        this.logger.log(`[injury-prefetch] synced ${syncResult} matches from injury_reports to injuries JSONB`);
      }
    } catch (err) {
      this.logger.warn(`[injury-prefetch] sync injury_reports to JSONB failed: ${this.errorMessage(err)}`);
    }

    return { updated, failed, skipped };
  }

  /**
   * 从 injury_reports 结构化表回写 basketball_matches.injuries JSONB 字段。
   * 保证双源一致：injury_reports 是权威源，JSONB 用于前端展示和 V11 升级判定。
   * 仅处理 upcoming 且 JSONB 为空、或主/客任一方在 JSONB 中缺数据的比赛。
   */
  private async syncInjuryReportsToJsonb(): Promise<number> {
    const matchRows = await this.db
      .select({
        id: basketballMatches.id,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        injuries: basketballMatches.injuries,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'upcoming'),
          sql`EXISTS (
            SELECT 1 FROM ${injuryReports}
            WHERE ${injuryReports.matchId} = ${basketballMatches.id}
              AND ${injuryReports.sport} = 'basketball'
          )`,
          sql`(
            ${basketballMatches.injuries} IS NULL
            OR jsonb_typeof(${basketballMatches.injuries}) = 'string'
            OR jsonb_array_length(COALESCE(${basketballMatches.injuries}->'home', '[]'::jsonb)) = 0
            OR jsonb_array_length(COALESCE(${basketballMatches.injuries}->'away', '[]'::jsonb)) = 0
          )`,
        ),
      );

    if (matchRows.length === 0) return 0;

    const matchIds = matchRows.map((r) => r.id);
    const allInjuries = await this.db
      .select({
        matchId: injuryReports.matchId,
        teamSide: injuryReports.teamSide,
        playerName: injuryReports.playerName,
        position: injuryReports.position,
        status: injuryReports.status,
        injuryType: injuryReports.injuryType,
        impactRating: injuryReports.impactRating,
        source: injuryReports.source,
        shortComment: injuryReports.shortComment,
        injuryDate: injuryReports.injuryDate,
      })
      .from(injuryReports)
      .where(inArray(injuryReports.matchId, matchIds));

    const byMatch = new Map<string, { home: Array<Record<string, unknown>>; away: Array<Record<string, unknown>>; sources: Set<string> }>();
    for (const inj of allInjuries) {
      if (!inj.matchId) continue;
      const agg = byMatch.get(inj.matchId) ?? { home: [], away: [], sources: new Set() };
      const item: Record<string, unknown> = {
        name: inj.playerName,
        status: inj.status || 'Out',
        type: inj.injuryType || '',
      };
      if (inj.position) item.position = inj.position;
      if (inj.impactRating) item.impact = inj.impactRating;
      if (inj.shortComment) item.shortComment = inj.shortComment;
      if (inj.injuryDate) item.date = new Date(inj.injuryDate).toISOString();
      if (inj.source) agg.sources.add(inj.source);
      if (inj.teamSide === 'home') agg.home.push(item);
      else if (inj.teamSide === 'away') agg.away.push(item);
      byMatch.set(inj.matchId, agg);
    }

    let updated = 0;
    for (const row of matchRows) {
      const agg = byMatch.get(row.id);
      if (!agg) continue;
      const existing = row.injuries && typeof row.injuries === 'object'
        ? (row.injuries as Record<string, unknown>)
        : null;
      const existingHome = existing && Array.isArray((existing as Record<string, unknown>).home)
        ? (existing as Record<string, unknown>).home as unknown[]
        : [];
      const existingAway = existing && Array.isArray((existing as Record<string, unknown>).away)
        ? (existing as Record<string, unknown>).away as unknown[]
        : [];
      const home = existingHome.length > 0 ? existingHome : agg.home;
      const away = existingAway.length > 0 ? existingAway : agg.away;
      const sourceStr = agg.sources.size > 0 ? Array.from(agg.sources).join(',') : 'injury_reports';
      const injuriesData: Record<string, unknown> = {
        home,
        away,
        source: sourceStr,
        syncedFromStructured: true,
        fetchedAt: new Date().toISOString(),
      };
      const result = await this.db
        .update(basketballMatches)
        .set({
          injuries: sql`${JSON.stringify(injuriesData)}::jsonb`,
          intelUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(basketballMatches.id, row.id))
        .returning({ id: basketballMatches.id });
      if (result.length > 0) updated += 1;
    }

    return updated;
  }

  async refreshPreGameInjuries(windowMinutes: number): Promise<{ updated: number; failed: number; skipped: number }> {
    const windowMs = windowMinutes * 60 * 1000;
    const windowEnd = new Date(Date.now() + windowMs);
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        sourceId: basketballMatches.sourceId,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        matchNo: basketballMatches.matchNo,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'upcoming'),
          isNotNull(basketballMatches.sourceId),
          gt(basketballMatches.kickoffTime, new Date()),
          lte(basketballMatches.kickoffTime, windowEnd),
          sql`(${basketballMatches.league} LIKE '%NBA%' OR ${basketballMatches.league} LIKE '%美国职业篮球%' OR ${basketballMatches.league} LIKE '%WNBA%' OR ${basketballMatches.league} = '篮球常规赛' OR ${basketballMatches.league} LIKE '篮球季%' OR ${basketballMatches.league} LIKE '%欧篮%' OR ${basketballMatches.league} LIKE '%欧洲篮球联赛%' OR ${basketballMatches.league} ILIKE '%euroleague%')`,
        ),
      );

    if (rows.length === 0) return { updated: 0, failed: 0, skipped: 0 };

    this.logger.log(`[pregame-injury-refresh] ${rows.length} matches within ${windowMinutes}min kickoff, refreshing injuries`);

    let updated = 0;
    let failed = 0;
    let skipped = 0;
    let euroRoundFetched = false;

    for (const row of rows) {
      try {
        if (isEuroLeagueMatch(row.league)) {
          if (!euroRoundFetched) {
            let euroRound = this.euroleagueInjurySource.getCurrentRound();
            if (euroRound === null) {
              euroRound = await this.euroleagueInjurySource.fetchCurrentRound();
            }
            if (euroRound !== null) {
              await this.euroleagueInjurySource.fetchRoundInjuries(euroRound);
            }
            euroRoundFetched = true;
          }
          const injuries = this.euroleagueInjurySource.buildInjuriesJson(row.homeTeam, row.awayTeam);
          if (!injuries) {
            skipped += 1;
            continue;
          }
          const injuriesData: Record<string, unknown> = {
            home: injuries.home.map((r) => ({
              name: r.playerName,
              status: r.status,
              type: r.injury,
              date: r.date,
            })),
            away: injuries.away.map((r) => ({
              name: r.playerName,
              status: r.status,
              type: r.injury,
              date: r.date,
            })),
            source: 'euroleague-official',
            fetchedAt: new Date().toISOString(),
          };
          const result = await this.db
            .update(basketballMatches)
            .set({
              injuries: sql`${JSON.stringify(injuriesData)}::jsonb`,
              intelUpdatedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(basketballMatches.id, row.id))
            .returning({ id: basketballMatches.id });
          if (result.length > 0) updated += 1;
          else failed += 1;
          continue;
        }

        const leagueCode = this.guessEspnBasketballLeagueCode(row.league);
        if (!leagueCode || !row.sourceId) {
          skipped += 1;
          continue;
        }

        const summary = await this.espnSource.fetchBasketballSummary(row.sourceId, leagueCode);
        if (!summary) {
          failed += 1;
          continue;
        }

        const hasInjuries = summary.homeInjuries.length > 0 || summary.awayInjuries.length > 0;
        const injuriesData: Record<string, unknown> = {
          home: summary.homeInjuries.map((i) => ({
            name: i.athleteName,
            status: i.status,
            type: i.type || '',
          })),
          away: summary.awayInjuries.map((i) => ({
            name: i.athleteName,
            status: i.status,
            type: i.type || '',
          })),
          source: 'ESPN',
          fetchedAt: new Date().toISOString(),
        };
        if (!hasInjuries) {
          injuriesData.status = 'clean';
        }

        const result = await this.db
          .update(basketballMatches)
          .set({
            injuries: sql`${JSON.stringify(injuriesData)}::jsonb`,
            intelUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(basketballMatches.id, row.id))
          .returning({ id: basketballMatches.id });

        if (result.length > 0) updated += 1;
        else failed += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(`[pregame-injury-refresh] failed for ${row.matchNo ?? row.id}: ${this.errorMessage(err)}`);
      }
    }

    this.logger.log(`[pregame-injury-refresh] done: updated=${updated}, failed=${failed}, skipped=${skipped}`);
    return { updated, failed, skipped };
  }

  private guessEspnBasketballLeagueCode(league: string): string | null {
    const lower = league.toLowerCase();
    if (lower.includes('wnba')) return 'wnba';
    if (lower.includes('nba') || lower.includes('美国职业篮球') || lower === '篮球常规赛' || lower.startsWith('篮球季')) return 'nba';
    if (lower.includes('nbl') || lower.includes('澳')) return 'nbl';
    if (lower.includes('欧篮') || lower.includes('euroleague')) return 'euroleague';
    return null;
  }

  async updateEuroLeagueInjuries(): Promise<{ updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;

    const euroRows = await this.db
      .select({
        id: basketballMatches.id,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        matchNo: basketballMatches.matchNo,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'upcoming'),
          sql`(${basketballMatches.league} LIKE '%欧篮%' OR ${basketballMatches.league} LIKE '%欧洲篮球联赛%' OR ${basketballMatches.league} ILIKE '%euroleague%')`,
        ),
      );

    if (euroRows.length === 0) return { updated: 0, failed: 0 };

    const round = await this.euroleagueInjurySource.fetchCurrentRound();
    if (round != null) {
      const fetched = await this.euroleagueInjurySource.fetchRoundInjuries(round);
      if (fetched) {
        for (const row of euroRows) {
          try {
            const injJson = this.euroleagueInjurySource.buildInjuriesJson(
              row.homeTeam ?? '',
              row.awayTeam ?? '',
            );
            if (!injJson) {
              failed += 1;
              continue;
            }
            const injuriesData: Record<string, unknown> = {
              home: injJson.home.map((r) => ({
                name: r.playerName,
                status: r.status,
                type: r.injury,
                date: r.date,
              })),
              away: injJson.away.map((r) => ({
                name: r.playerName,
                status: r.status,
                type: r.injury,
                date: r.date,
              })),
              source: 'euroleague-official',
              fetchedAt: new Date().toISOString(),
            };
            const result = await this.db
              .update(basketballMatches)
              .set({
                injuries: sql`${JSON.stringify(injuriesData)}::jsonb`,
                intelUpdatedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(basketballMatches.id, row.id))
              .returning({ id: basketballMatches.id });
            if (result.length > 0) updated += 1;
            else failed += 1;
          } catch (err) {
            failed += 1;
            this.logger.warn(
              `[euroleague-injury-update] failed for ${row.matchNo}: ${this.errorMessage(err)}`,
            );
          }
        }
      } else {
        failed = euroRows.length;
        await this.markEuroLeagueInjuriesUnavailable(euroRows, `fetch_round_failed: ${this.euroleagueInjurySource.getLastError() ?? 'unknown'}`);
      }
    } else {
      this.logger.warn('[euroleague-injury-update] could not detect current round, skipping');
      failed = euroRows.length;
      await this.markEuroLeagueInjuriesUnavailable(euroRows, `current_round_unknown: ${this.euroleagueInjurySource.getLastError() ?? 'unknown'}`);
    }

    this.logger.log(
      `[euroleague-injury-update] done: updated=${updated}, failed=${failed} (round=${round ?? 'unknown'})`,
    );
    return { updated, failed };
  }

  private async markEuroLeagueInjuriesUnavailable(
    rows: Array<{ id: string; homeTeam: string | null; awayTeam: string | null; matchNo: string | null }>,
    reason: string,
  ): Promise<void> {
    const matchIds: string[] = [];
    for (const row of rows) {
      matchIds.push(row.id);
    }
    if (matchIds.length === 0) return;
    const unavailableData: Record<string, unknown> = {
      home: [],
      away: [],
      source: 'euroleague-unavailable',
      reason,
      fetchedAt: new Date().toISOString(),
    };
    try {
      await this.db
        .update(basketballMatches)
        .set({
          injuries: sql`${JSON.stringify(unavailableData)}::jsonb`,
          intelUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(basketballMatches.id, matchIds));
      this.logger.log(
        `[euroleague-injury-update] marked ${matchIds.length} matches as unavailable (${reason.slice(0, 80)})`,
      );
    } catch (err) {
      this.logger.warn(
        `[euroleague-injury-update] mark unavailable failed: ${this.errorMessage(err)}`,
      );
    }
  }

  async recalcBasketballUpcomingPredictions(): Promise<{
    recalculated: number;
    skipped: number;
    errors: number;
    histMapSize: number;
    emptyTeamsCount: number;
    debugInfo: Record<string, { inMap: boolean; games?: number; recent10Ppg?: number; recent20Ppg?: number; ppg?: number; oppg?: number; recent10Oppg?: number }>;
  }> {
    this.logger.log('Starting basketball upcoming prediction recalc');

    try {
      const prefetchResult = await this.prefetchMissingBasketballInjuries();
      if (prefetchResult.updated > 0) {
        this.logger.log(
          `[injury-gate] pre-filled ${prefetchResult.updated} injury records before recalc`,
        );
      }
    } catch (err) {
      this.logger.warn(`[injury-gate] prefetch failed, continuing recalc: ${this.errorMessage(err)}`);
    }

    const rows = await this.db
      .select()
      .from(basketballMatches)
       .where(
         and(
           eq(basketballMatches.matchStatus, 'upcoming'),
           ne(basketballMatches.matchStatus, 'cancelled'),
           ne(basketballMatches.matchStatus, 'postponed'),
           eq(basketballMatches.isPredictionFrozen, false),
         ),
       )
      .orderBy(basketballMatches.kickoffTime)
      .limit(500);

    const bbEloTeams: Array<{ teamName: string }> = [];
    const bbEmptyStatsTeams: Array<{ teamName: string; league: string }> = [];
    for (const r of rows) {
      if (r.homeTeam) bbEloTeams.push({ teamName: r.homeTeam });
      if (r.awayTeam) bbEloTeams.push({ teamName: r.awayTeam });
      const league = r.league || 'default';
      if (r.homeTeam && !this.bbHasTeamStats(r.teamStats, 'home')) {
        bbEmptyStatsTeams.push({ teamName: r.homeTeam, league });
      } else if (r.homeTeam && !this.bbHasTeamOppgStats(r.teamStats, 'home')) {
        bbEmptyStatsTeams.push({ teamName: r.homeTeam, league });
      }
      if (r.awayTeam && !this.bbHasTeamStats(r.teamStats, 'away')) {
        bbEmptyStatsTeams.push({ teamName: r.awayTeam, league });
      } else if (r.awayTeam && !this.bbHasTeamOppgStats(r.teamStats, 'away')) {
        bbEmptyStatsTeams.push({ teamName: r.awayTeam, league });
      }
    }
    const bbEloMap = await this.eloHistoryService.getTeamRatings('basketball', bbEloTeams);
    const bbHistStatsMap = await this.bbComputeHistoricalTeamStats(bbEmptyStatsTeams);
    let recalculated = 0;
    let skipped = 0;
    let errors = 0;
     for (const row of rows) {
       try {
        if (row.isOfficialLocked) {
           skipped += 1;
           continue;
         }

         const lockedUntil = (row as Record<string, unknown>).predictionLockedUntil as Date | null | undefined;
         if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
           skipped += 1;
           continue;
         }

         const hwOdds = Number(row.homeWinOdds) || 0;
        const awOdds = Number(row.awayWinOdds) || 0;
        const hcNum = Number(row.handicapLineNum) || 0;
        const hcStr = hcNum !== 0 ? String(hcNum) : (row.handicap ?? '0');
        const tlNum = Number(row.totalLineNum) || 0;
        const tlStr = tlNum > 0 ? String(tlNum) : undefined;
         if ((hwOdds <= 0 || awOdds <= 0) && hcNum === 0) { skipped += 1; continue; }

         let homePpg: number | undefined;
         let awayPpg: number | undefined;
         let homeOppg: number | undefined;
         let awayOppg: number | undefined;
         if (row.teamStats && typeof row.teamStats === 'object') {
           const ts = row.teamStats as Record<string, unknown>;
           const hs = ts.home as Record<string, unknown> | null;
           const as = ts.away as Record<string, unknown> | null;
           if (hs) {
             const rawVal = hs.pointsPerGame != null && hs.pointsPerGame !== '' ? hs.pointsPerGame : hs.ppg;
             const n = Number(rawVal);
             if (!Number.isNaN(n) && n > 0) homePpg = n;
             const oppgVal = hs.oppg != null && hs.oppg !== '' ? hs.oppg : hs.pointsAllowedPerGame;
             const on = Number(oppgVal);
             if (!Number.isNaN(on) && on > 0) homeOppg = on;
           }
           if (as) {
             const rawVal = as.pointsPerGame != null && as.pointsPerGame !== '' ? as.pointsPerGame : as.ppg;
             const n = Number(rawVal);
             if (!Number.isNaN(n) && n > 0) awayPpg = n;
             const oppgVal = as.oppg != null && as.oppg !== '' ? as.oppg : as.pointsAllowedPerGame;
             const on = Number(oppgVal);
             if (!Number.isNaN(on) && on > 0) awayOppg = on;
           }
         }

         const intelText = row.intelSummary ?? (typeof row.intel === 'string' ? row.intel : '');
         const prediction = this.generateBasketballPrediction(
          hwOdds, awOdds, hcStr, tlStr,
          row.league || 'default',
          '',
          {
            kickoffMonth: new Date(row.kickoffTime).getMonth() + 1,
            homePpg,
            awayPpg,
            homeOppg,
            awayOppg,
            teamStats: row.teamStats as { home?: Record<string, unknown>; away?: Record<string, unknown> } | undefined,
            intelData: parseIntelFromRow({
              homeTeam: row.homeTeam ?? '',
              awayTeam: row.awayTeam ?? '',
              h2hHistory: row.h2hHistory,
              injuries: row.injuries,
              keyPlayers: row.keyPlayers,
              recentForm: row.recentForm,
              teamNews: intelText,
            }),
            eloHome: row.homeTeam ? bbEloMap.get(row.homeTeam)?.rating : undefined,
            eloAway: row.awayTeam ? bbEloMap.get(row.awayTeam)?.rating : undefined,
            eloGap:
              row.homeTeam && row.awayTeam && bbEloMap.get(row.homeTeam) && bbEloMap.get(row.awayTeam)
                ? bbEloMap.get(row.homeTeam)!.rating - bbEloMap.get(row.awayTeam)!.rating
                : undefined,
             playoffSeriesGames: this.buildBbPlayoffSeriesGames(
               row.h2hHistory,
               row.homeTeam ?? '',
               row.awayTeam ?? '',
             ),
            ...this.bbFillHistoricalStats(row, bbHistStatsMap),
           },
         );
        if (!prediction) { skipped += 1; continue; }

        const recalcSet: Record<string, unknown> = {
          homeWinProb: prediction.homeWinProb,
          awayWinProb: prediction.awayWinProb,
          predictionDirection: prediction.predictionDirection,
          confidence: prediction.confidence,
          handicapRecommendation: prediction.handicapRecommendation,
          handicapPick: prediction.handicapRecommendation,
          handicapCoverProb: prediction.handicapCoverProb,
          handicapPickProb: prediction.handicapPickProb,
          totalDirection: prediction.totalDirection,
          totalPick: prediction.totalDirection,
          overProb: prediction.overProb,
          underProb: prediction.underProb,
          totalPickProb: prediction.totalPickProb,
          modelRules: prediction.modelRules,
          predictedHomeScore: prediction.predictedHomeScore,
          predictedAwayScore: prediction.predictedAwayScore,
          predictedTotal: String(prediction.predictedTotal),
          handicapConfidence: prediction.handicapConfidence,
          ouConfidence: prediction.ouConfidence,
          ouDiffVsLine: String(prediction.ouDiffVsLine),
          predEngineVersion: prediction.predEngineVersion,
          eloHome: row.homeTeam && bbEloMap.get(row.homeTeam) ? bbEloMap.get(row.homeTeam)!.rating.toFixed(2) : null,
          eloAway: row.awayTeam && bbEloMap.get(row.awayTeam) ? bbEloMap.get(row.awayTeam)!.rating.toFixed(2) : null,
          eloGap: row.homeTeam && row.awayTeam && bbEloMap.get(row.homeTeam) && bbEloMap.get(row.awayTeam)
            ? (bbEloMap.get(row.homeTeam)!.rating - bbEloMap.get(row.awayTeam)!.rating).toFixed(2)
            : null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        };

        const hcOverride = row.handicapOverride as Record<string, unknown> | null;
        const baseRules = prediction.modelRules.filter((r: string) => !r.startsWith('人工修正'));
        if (hcOverride) {
          recalcSet.handicapRecommendation = String(hcOverride.recommendation ?? prediction.handicapRecommendation);
          recalcSet.handicapPick = String(hcOverride.recommendation ?? prediction.handicapRecommendation);
          recalcSet.handicapPickProb = Number(hcOverride.pickProb ?? prediction.handicapPickProb);
          recalcSet.handicapConfidence = String(hcOverride.confidence ?? prediction.handicapConfidence);
          const reason = hcOverride.reason ? `（${String(hcOverride.reason)}）` : '';
          const overrideRules = [...baseRules];
          overrideRules.push(`人工修正：让分${String(hcOverride.recommendation)} ${Number(hcOverride.pickProb)}%${reason}`);
          recalcSet.modelRules = overrideRules;
        }

        const ouOverride = row.totalOverride as Record<string, unknown> | null;
        if (ouOverride) {
          recalcSet.totalDirection = String(ouOverride.direction ?? prediction.totalDirection);
          recalcSet.totalPick = String(ouOverride.direction ?? prediction.totalDirection);
          recalcSet.totalPickProb = Number(ouOverride.pickProb ?? prediction.totalPickProb);
          recalcSet.ouConfidence = String(ouOverride.confidence ?? prediction.ouConfidence);
          const prob = Number(ouOverride.pickProb ?? 50);
          const dir = String(ouOverride.direction ?? '观望');
          recalcSet.overProb = dir === '大分' ? prob : (100 - prob);
          recalcSet.underProb = dir === '小分' ? prob : (100 - prob);
          const currentRules = (hcOverride ? recalcSet.modelRules : baseRules) as string[];
          const reason = ouOverride.reason ? `（${String(ouOverride.reason)}）` : '';
          currentRules.push(`人工修正：大小分${dir} ${prob}%${reason}`);
          recalcSet.modelRules = currentRules;
        }

        this.appendBasketballPredictionHistory(recalcSet, 'recalc_upcoming');
        await this.db.update(basketballMatches)
          .set(recalcSet)
          .where(eq(basketballMatches.id, row.id));
        recalculated += 1;
      } catch (err) {
        errors += 1;
        this.logger.warn(`basketball recalc failed for ${row.matchNo}: ${this.errorMessage(err)}`);
      }
    }
    this.logger.log(
      `recalcBasketballUpcomingPredictions done: recalculated=${recalculated} skipped=${skipped} errors=${errors} histMap=${bbHistStatsMap.size} emptyTeams=${bbEmptyStatsTeams.length}`,
    );
    const debugTeams = ['鹈鹕', '步行者', '火箭', '独行侠', '爵士', '灰熊'];
    const debugInfo: Record<string, { inMap: boolean; games?: number; recent10Ppg?: number; recent20Ppg?: number; ppg?: number; oppg?: number; recent10Oppg?: number }> = {};
    for (const t of debugTeams) {
      const s = bbHistStatsMap.get(t);
      debugInfo[t] = { inMap: !!s, games: s?.games, ppg: s?.ppg, oppg: s?.oppg, recent10Ppg: s?.recent10Ppg, recent10Oppg: s?.recent10Oppg, recent20Ppg: s?.recent20Ppg };
    }
    return { recalculated, skipped, errors, histMapSize: bbHistStatsMap.size, emptyTeamsCount: bbEmptyStatsTeams.length, debugInfo };
  }

  async recalcFootballPredictionsByDate(
    targetDate: string,
  ): Promise<{
    recalculated: number;
    skipped: number;
    errors: number;
  }> {
    this.logger.log(`Starting v8.0 recalc for football matches on ${targetDate}`);
    const rows = await this.db.select()
      .from(matches)
      .where(eq(matches.matchDate, targetDate));

    const eloTeamList: Array<{ teamName: string }> = [];
    for (const r of rows) {
      if (r.homeTeam) eloTeamList.push({ teamName: r.homeTeam });
      if (r.awayTeam) eloTeamList.push({ teamName: r.awayTeam });
    }
    const eloMap = await this.eloHistoryService.getTeamRatings('football', eloTeamList);

    // 预计算联赛历史主场胜率（基于同联赛已完赛数据）
    const leagueStats = new Map<string, { hw: number; total: number }>();
    try {
      const histResult = await this.db.select({
        league: matches.league,
        matchStatus: matches.matchStatus,
        homeScore: matches.homeScore,
        awayScore: matches.awayScore,
      }).from(matches)
        .where(and(
          eq(matches.matchStatus, 'finished'),
          sql`${matches.matchDate} >= ${targetDate}::date - interval '90 days'`,
          sql`${matches.matchDate} < ${targetDate}::date`,
        ));
      for (const r of histResult) {
        if (r.homeScore === null || r.awayScore === null) continue;
        const lg = r.league || '';
        if (!leagueStats.has(lg)) leagueStats.set(lg, { hw: 0, total: 0 });
        const s = leagueStats.get(lg)!;
        s.total += 1;
        if (r.homeScore > r.awayScore) s.hw += 1;
      }
    } catch (err) {
      this.logger.warn(`League stats calc failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    let recalculated = 0;
    let skipped = 0;
    let errors = 0;
    for (const row of rows) {
      try {
        const isOfficialLocked = Boolean(row.isOfficialLocked) ||
          (Array.isArray(row.modelRules)
            && row.modelRules.some((r: string) => r.includes('官方数据锁定')));
        if (isOfficialLocked) {
          skipped += 1;
          continue;
        }
        let oddsH = Number(row.oddsOpenHome) || 0;
        let oddsD = Number(row.oddsOpenDraw) || 0;
        let oddsA = Number(row.oddsOpenAway) || 0;
        if (oddsH <= 0 || oddsD <= 0 || oddsA <= 0) {
          oddsH = Number(row.oddsLiveHome) || 0;
          oddsD = Number(row.oddsLiveDraw) || 0;
          oddsA = Number(row.oddsLiveAway) || 0;
        }
        if (oddsH <= 0 || oddsD <= 0 || oddsA <= 0) {
          const guardRecord: Record<string, unknown> = {};
          this.applyFootballDataInsufficientGuard(guardRecord);
          await this.db.update(matches)
            .set({
              homeWinProb: guardRecord.homeWinProb as number,
              drawProb: guardRecord.drawProb as number,
              awayWinProb: guardRecord.awayWinProb as number,
              predictionDirection: guardRecord.predictionDirection as string,
              confidence: guardRecord.confidence as number,
              lowConfidence: guardRecord.lowConfidence as boolean,
              handicapRecommendation: guardRecord.handicapRecommendation as string,
              handicapWinProb: guardRecord.handicapWinProb as string,
              handicapDrawProb: guardRecord.handicapDrawProb as string,
              handicapLoseProb: guardRecord.handicapLoseProb as string,
              handicapSecondChoice: guardRecord.handicapSecondChoice as string,
              handicapConfidence: guardRecord.handicapConfidence as string,
              overProb: guardRecord.overProb as number,
              underProb: guardRecord.underProb as number,
              totalPick: guardRecord.totalPick as string,
              totalPickProb: guardRecord.totalPickProb as number,
              ouConfidence: guardRecord.ouConfidence as string,
              mostLikelyScore: '',
              modelRules: guardRecord.modelRules as string[],
              scoreProbs: [] as unknown as string[],
              totalGoalsProb: [] as unknown as string[],
              halfFullProb: [] as unknown as string[],
              predEngineVersion: FOOTBALL_MODEL_VERSION,
              updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(matches.id, row.id));
          recalculated += 1;
        } else {
          // 构造实力修正输入
          const formStrH = Array.isArray(row.homeForm) ? row.homeForm.slice(0, 5).map((s: string) => {
            const first = (s || '').charAt(0);
            if (first === '胜') return 'W';
            if (first === '平') return 'D';
            if (first === '负') return 'L';
            return '';
          }).join('') : '';
          const formStrA = Array.isArray(row.awayForm) ? row.awayForm.slice(0, 5).map((s: string) => {
            const first = (s || '').charAt(0);
            if (first === '胜') return 'W';
            if (first === '平') return 'D';
            if (first === '负') return 'L';
            return '';
          }).join('') : '';
          // H2H 解析（h2h 是 text[]，每项格式如 "2025-01-01 主队 2-1 客队"，粗略统计胜负）
          let h2hHw = 0;
          let h2hAw = 0;
          let h2hDr = 0;
          if (Array.isArray(row.h2h) && row.h2h.length > 0) {
            for (const item of row.h2h) {
              const s = String(item || '');
              const m = s.match(/(\d+)\s*[-:]\s*(\d+)/);
              if (m) {
                const hs = parseInt(m[1], 10);
                const as = parseInt(m[2], 10);
                if (hs > as) h2hHw += 1;
                else if (as > hs) h2hAw += 1;
                else h2hDr += 1;
              }
            }
          }
          // 伤停影响估算：按伤停人数给0-4的影响值
          const homeInjLen = row.homeInjuries ? String(row.homeInjuries).split(/[\n;；,，]+/).filter(s => s.trim()).length : 0;
          const awayInjLen = row.awayInjuries ? String(row.awayInjuries).split(/[\n;；,，]+/).filter(s => s.trim()).length : 0;
          const strengthInput = {
            homeFormWdl: formStrH || undefined,
            awayFormWdl: formStrA || undefined,
            homeGoalsAvg: row.homeGoalsAvg ? Number(row.homeGoalsAvg) : undefined,
            awayGoalsAvg: row.awayGoalsAvg ? Number(row.awayGoalsAvg) : undefined,
            homeConcededAvg: row.homeConcededAvg ? Number(row.homeConcededAvg) : undefined,
            awayConcededAvg: row.awayConcededAvg ? Number(row.awayConcededAvg) : undefined,
            homeHomeRecord: row.homeHomeRecord ?? undefined,
            awayAwayRecord: row.awayAwayRecord ?? undefined,
            h2hHomeWins: h2hHw,
            h2hAwayWins: h2hAw,
            h2hDraws: h2hDr,
            homeInjuryImpact: homeInjLen > 0 ? Math.min(4, homeInjLen * 0.8) : 0,
            awayInjuryImpact: awayInjLen > 0 ? Math.min(4, awayInjLen * 0.8) : 0,
             leagueHomeWinPct: undefined as number | undefined,
             handicapImpliedHomePct: undefined as number | undefined,
             homeShotsPerGame: undefined as number | undefined,
             awayShotsPerGame: undefined as number | undefined,
             eloHome: undefined as number | undefined,
             eloAway: undefined as number | undefined,
             eloGap: undefined as number | undefined,
           };
           // Elo 评分
           const homeEloVal = row.homeTeam ? eloMap.get(row.homeTeam)?.rating : undefined;
           const awayEloVal = row.awayTeam ? eloMap.get(row.awayTeam)?.rating : undefined;
           if (homeEloVal !== undefined && awayEloVal !== undefined) {
             strengthInput.eloHome = homeEloVal;
             strengthInput.eloAway = awayEloVal;
             strengthInput.eloGap = homeEloVal - awayEloVal;
           }
           // 射门数据（从advancedStats取）
           const advStats = row.advancedStats as Record<string, number> | undefined | null;
            if (advStats && typeof advStats === 'object') {
              if (typeof advStats.shotsHome === 'number' && advStats.shotsHome > 0) {
                strengthInput.homeShotsPerGame = advStats.shotsHome;
              }
              if (typeof advStats.shotsAway === 'number' && advStats.shotsAway > 0) {
                strengthInput.awayShotsPerGame = advStats.shotsAway;
              }
            }
            // xG 计算：优先真实xG（high），其次场均进球代理（low）
            let homeXgVal: number | undefined;
            let awayXgVal: number | undefined;
            let xgQualityVal: 'high' | 'medium' | 'low' | 'none' = 'none';
            if (advStats && typeof advStats === 'object' &&
                typeof advStats.xgHome === 'number' && advStats.xgHome > 0 &&
                typeof advStats.xgAway === 'number' && advStats.xgAway > 0) {
              homeXgVal = advStats.xgHome;
              awayXgVal = advStats.xgAway;
              xgQualityVal = 'high';
            } else {
              const hgAvg = row.homeGoalsAvg ? Number(row.homeGoalsAvg) : 0;
              const agAvg = row.awayGoalsAvg ? Number(row.awayGoalsAvg) : 0;
              if (hgAvg > 0 && agAvg > 0) {
                homeXgVal = hgAvg;
                awayXgVal = agAvg;
                xgQualityVal = 'low';
              }
            }
            if (homeXgVal !== undefined && awayXgVal !== undefined) {
              (strengthInput as { homeXg?: number; awayXg?: number; xgQuality?: string }).homeXg = homeXgVal;
              (strengthInput as { homeXg?: number; awayXg?: number; xgQuality?: string }).awayXg = awayXgVal;
              (strengthInput as { homeXg?: number; awayXg?: number; xgQuality?: string }).xgQuality = xgQualityVal;
            }
          // 联赛主场胜率
          const ls = leagueStats.get(row.league || '');
          if (ls && ls.total >= 10) {
            strengthInput.leagueHomeWinPct = Math.round((ls.hw / ls.total) * 100);
          }
          // 让球隐含主胜概率（从让球胜平负赔率推导）
          const hcOddsH = Number(row.handicapOddsHome) || 0;
          const hcOddsD = Number(row.handicapOddsDraw) || 0;
          const hcOddsA = Number(row.handicapOddsAway) || 0;
          if (hcOddsH > 0 && hcOddsD > 0 && hcOddsA > 0) {
            const invHcH = 1 / hcOddsH;
            const invHcD = 1 / hcOddsD;
            const invHcA = 1 / hcOddsA;
            const invHcTotal = invHcH + invHcD + invHcA;
            strengthInput.handicapImpliedHomePct = Math.round((invHcH / invHcTotal) * 100);
          }
           const prediction = this.generateFootballPrediction(
             oddsH,
             oddsD,
             oddsA,
             row.handicap || '0',
             row.totalGoals ?? undefined,
             row.league ?? undefined,
             strengthInput,
           );
           if (!prediction) {
             skipped += 1;
             continue;
           }
           const recalcSet: Record<string, unknown> = {
             homeWinProb: prediction.homeWinProb,
             drawProb: prediction.drawProb,
             awayWinProb: prediction.awayWinProb,
             predictionDirection: prediction.predictionDirection,
             confidence: prediction.confidence,
             lowConfidence: prediction.lowConfidence,
             handicapRecommendation: prediction.handicapRecommendation,
             handicapWinProb: String(prediction.handicapWinProb),
             handicapDrawProb: String(prediction.handicapDrawProb),
             handicapLoseProb: String(prediction.handicapLoseProb),
             handicapSecondChoice: prediction.handicapSecondChoice,
             overProb: prediction.overProb,
             underProb: prediction.underProb,
             totalPick: prediction.totalPick,
             totalPickProb: prediction.totalPickProb,
             mostLikelyScore: prediction.mostLikelyScore,
             modelRules: prediction.modelRules,
             scoreProbs: prediction.scoreProbs,
             totalGoalsProb: prediction.totalGoalsProb as unknown as string[],
             halfFullProb: prediction.halfFullProb as unknown as string[],
             eloHome: strengthInput.eloHome ? String(strengthInput.eloHome) : null,
             eloAway: strengthInput.eloAway ? String(strengthInput.eloAway) : null,
             eloGap: strengthInput.eloGap ? String(strengthInput.eloGap) : null,
             predEngineVersion: FOOTBALL_MODEL_VERSION,
             handicapConfidence: '低',
             ouConfidence: '低',
             updatedAt: sql`CURRENT_TIMESTAMP`,
           };
           const rowOddsEmpty = oddsH <= 0 && oddsD <= 0 && oddsA <= 0;
           this.finalizeFootballPick(recalcSet, null, rowOddsEmpty);
           await this.db.update(matches)
             .set(recalcSet)
             .where(eq(matches.id, row.id));
           recalculated += 1;
         }
       } catch (err) {
         errors += 1;
         const errAny = err as { cause?: { code?: string; message?: string }; message: string; stack?: string };
         const causeCode = errAny.cause?.code ?? 'N/A';
         const causeMsg = errAny.cause?.message ?? 'N/A';
         this.logger.warn(`football recalc-date failed for ${row.matchNo}: ${errAny.message} | cause_code=${causeCode} | cause_msg=${causeMsg}`);
      }
    }
    this.logger.log(
      `recalcFootballPredictionsByDate done: date=${targetDate} recalculated=${recalculated} skipped=${skipped} errors=${errors}`,
    );
    return { recalculated, skipped, errors };
  }

  async recalcV9FootballToV12(
    days: number = 14,
  ): Promise<{
    recalculated: number;
    skipped: number;
    errors: number;
    total: number;
  }> {
    this.logger.log(`Starting v9.1 -> v12 recalc for football matches in last ${days} days`);
    const cutoff = sql`now() - interval '${days} days'`;
    const rows = await this.db.select()
      .from(matches)
      .where(and(
        eq(matches.predEngineVersion, 'football-v9.1-odds'),
        sql`${matches.kickoffTime} >= ${cutoff}`,
      ));
    const total = rows.length;
    this.logger.log(`Found ${total} v9.1 football matches to recalc`);

    const eloTeamList: Array<{ teamName: string }> = [];
    for (const r of rows) {
      if (r.homeTeam) eloTeamList.push({ teamName: r.homeTeam });
      if (r.awayTeam) eloTeamList.push({ teamName: r.awayTeam });
    }
    const eloMap = await this.eloHistoryService.getTeamRatings('football', eloTeamList);

    let recalculated = 0;
    let skipped = 0;
    let errors = 0;
    for (const row of rows) {
      try {
        const isOfficialLocked = Boolean(row.isOfficialLocked) ||
          (Array.isArray(row.modelRules)
            && row.modelRules.some((r: string) => r.includes('官方数据锁定')));
        if (isOfficialLocked) {
          skipped += 1;
          continue;
        }
        let oddsH = Number(row.oddsOpenHome) || 0;
        let oddsD = Number(row.oddsOpenDraw) || 0;
        let oddsA = Number(row.oddsOpenAway) || 0;
        if (oddsH <= 0 || oddsD <= 0 || oddsA <= 0) {
          oddsH = Number(row.oddsLiveHome) || 0;
          oddsD = Number(row.oddsLiveDraw) || 0;
          oddsA = Number(row.oddsLiveAway) || 0;
        }
        if (oddsH <= 0 || oddsD <= 0 || oddsA <= 0) {
          const guardRecord: Record<string, unknown> = {};
          this.applyFootballDataInsufficientGuard(guardRecord);
          const recalcSet: Record<string, unknown> = {
            homeWinProb: guardRecord.homeWinProb as number,
            drawProb: guardRecord.drawProb as number,
            awayWinProb: guardRecord.awayWinProb as number,
            predictionDirection: guardRecord.predictionDirection as string,
            confidence: guardRecord.confidence as number,
            lowConfidence: guardRecord.lowConfidence as boolean,
            handicapRecommendation: guardRecord.handicapRecommendation as string,
            handicapWinProb: guardRecord.handicapWinProb as string,
            handicapDrawProb: guardRecord.handicapDrawProb as string,
            handicapLoseProb: guardRecord.handicapLoseProb as string,
            handicapSecondChoice: guardRecord.handicapSecondChoice as string,
            handicapConfidence: guardRecord.handicapConfidence as string,
            overProb: guardRecord.overProb as number,
            underProb: guardRecord.underProb as number,
            totalPick: guardRecord.totalPick as string,
            totalPickProb: guardRecord.totalPickProb as number,
            ouConfidence: guardRecord.ouConfidence as string,
            mostLikelyScore: '',
            modelRules: guardRecord.modelRules as string[],
            scoreProbs: [] as unknown as string[],
            totalGoalsProb: [] as unknown as string[],
            halfFullProb: [] as unknown as string[],
            predEngineVersion: FOOTBALL_MODEL_VERSION,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          };
          await this.db.update(matches).set(recalcSet).where(eq(matches.id, row.id));
          recalculated += 1;
          continue;
        }

        const formStrH = Array.isArray(row.homeForm) ? row.homeForm.slice(0, 5).map((s: string) => {
          const first = (s || '').charAt(0);
          if (first === '胜') return 'W';
          if (first === '平') return 'D';
          if (first === '负') return 'L';
          return '';
        }).join('') : '';
        const formStrA = Array.isArray(row.awayForm) ? row.awayForm.slice(0, 5).map((s: string) => {
          const first = (s || '').charAt(0);
          if (first === '胜') return 'W';
          if (first === '平') return 'D';
          if (first === '负') return 'L';
          return '';
        }).join('') : '';

        let h2hHw = 0;
        let h2hAw = 0;
        let h2hDr = 0;
        if (Array.isArray(row.h2h) && row.h2h.length > 0) {
          for (const item of row.h2h) {
            const s = String(item || '');
            const m = s.match(/(\d+)\s*[-:]\s*(\d+)/);
            if (m) {
              const hs = parseInt(m[1], 10);
              const as = parseInt(m[2], 10);
              if (hs > as) h2hHw += 1;
              else if (as > hs) h2hAw += 1;
              else h2hDr += 1;
            }
          }
        }

        const homeInjLen = row.homeInjuries ? String(row.homeInjuries).split(/[\n;；,，]+/).filter(s => s.trim()).length : 0;
        const awayInjLen = row.awayInjuries ? String(row.awayInjuries).split(/[\n;；,，]+/).filter(s => s.trim()).length : 0;
        const strengthInput: Record<string, unknown> = {
          homeFormWdl: formStrH || undefined,
          awayFormWdl: formStrA || undefined,
          homeGoalsAvg: row.homeGoalsAvg ? Number(row.homeGoalsAvg) : undefined,
          awayGoalsAvg: row.awayGoalsAvg ? Number(row.awayGoalsAvg) : undefined,
          homeConcededAvg: row.homeConcededAvg ? Number(row.homeConcededAvg) : undefined,
          awayConcededAvg: row.awayConcededAvg ? Number(row.awayConcededAvg) : undefined,
          homeHomeRecord: row.homeHomeRecord ?? undefined,
          awayAwayRecord: row.awayAwayRecord ?? undefined,
          h2hHomeWins: h2hHw,
          h2hAwayWins: h2hAw,
          h2hDraws: h2hDr,
          homeInjuryImpact: homeInjLen > 0 ? Math.min(4, homeInjLen * 0.8) : 0,
          awayInjuryImpact: awayInjLen > 0 ? Math.min(4, awayInjLen * 0.8) : 0,
          leagueHomeWinPct: undefined,
          handicapImpliedHomePct: undefined,
          homeShotsPerGame: undefined,
          awayShotsPerGame: undefined,
          eloHome: undefined,
          eloAway: undefined,
          eloGap: undefined,
        };

        const homeEloVal = row.homeTeam ? eloMap.get(row.homeTeam)?.rating : undefined;
        const awayEloVal = row.awayTeam ? eloMap.get(row.awayTeam)?.rating : undefined;
        if (homeEloVal !== undefined && awayEloVal !== undefined) {
          strengthInput.eloHome = homeEloVal;
          strengthInput.eloAway = awayEloVal;
          strengthInput.eloGap = homeEloVal - awayEloVal;
        }

        const advStats = row.advancedStats as Record<string, number> | undefined | null;
        if (advStats && typeof advStats === 'object') {
          if (typeof advStats.shotsHome === 'number' && advStats.shotsHome > 0) {
            strengthInput.homeShotsPerGame = advStats.shotsHome;
          }
          if (typeof advStats.shotsAway === 'number' && advStats.shotsAway > 0) {
            strengthInput.awayShotsPerGame = advStats.shotsAway;
          }
          if (typeof advStats.xgHome === 'number' && advStats.xgHome > 0 &&
              typeof advStats.xgAway === 'number' && advStats.xgAway > 0) {
            strengthInput.homeXg = advStats.xgHome;
            strengthInput.awayXg = advStats.xgAway;
            strengthInput.xgQuality = 'high';
          } else {
            const hgAvg = row.homeGoalsAvg ? Number(row.homeGoalsAvg) : 0;
            const agAvg = row.awayGoalsAvg ? Number(row.awayGoalsAvg) : 0;
            if (hgAvg > 0 && agAvg > 0) {
              strengthInput.homeXg = hgAvg;
              strengthInput.awayXg = agAvg;
              strengthInput.xgQuality = 'low';
            }
          }
        }

        const hcOddsH = Number(row.handicapOddsHome) || 0;
        const hcOddsD = Number(row.handicapOddsDraw) || 0;
        const hcOddsA = Number(row.handicapOddsAway) || 0;
        if (hcOddsH > 0 && hcOddsD > 0 && hcOddsA > 0) {
          const invHcH = 1 / hcOddsH;
          const invHcD = 1 / hcOddsD;
          const invHcA = 1 / hcOddsA;
          const invHcTotal = invHcH + invHcD + invHcA;
          strengthInput.handicapImpliedHomePct = Math.round((invHcH / invHcTotal) * 100);
        }

        const prediction = this.generateFootballPrediction(
          oddsH,
          oddsD,
          oddsA,
          row.handicap || '0',
          row.totalGoals ?? undefined,
          row.league ?? undefined,
          strengthInput,
        );
        if (!prediction) {
          skipped += 1;
          continue;
        }
        const recalcSet: Record<string, unknown> = {
          homeWinProb: prediction.homeWinProb,
          drawProb: prediction.drawProb,
          awayWinProb: prediction.awayWinProb,
          predictionDirection: prediction.predictionDirection,
          confidence: prediction.confidence,
          lowConfidence: prediction.lowConfidence,
          handicapRecommendation: prediction.handicapRecommendation,
          handicapWinProb: String(prediction.handicapWinProb),
          handicapDrawProb: String(prediction.handicapDrawProb),
          handicapLoseProb: String(prediction.handicapLoseProb),
          handicapSecondChoice: prediction.handicapSecondChoice,
          overProb: prediction.overProb,
          underProb: prediction.underProb,
          totalPick: prediction.totalPick,
          totalPickProb: prediction.totalPickProb,
          mostLikelyScore: prediction.mostLikelyScore,
          modelRules: prediction.modelRules,
          scoreProbs: prediction.scoreProbs,
          totalGoalsProb: prediction.totalGoalsProb as unknown as string[],
          halfFullProb: prediction.halfFullProb as unknown as string[],
          eloHome: strengthInput.eloHome ? String(strengthInput.eloHome) : null,
          eloAway: strengthInput.eloAway ? String(strengthInput.eloAway) : null,
          eloGap: strengthInput.eloGap ? String(strengthInput.eloGap) : null,
          predEngineVersion: FOOTBALL_MODEL_VERSION,
          handicapConfidence: '低',
          ouConfidence: '低',
          updatedAt: sql`CURRENT_TIMESTAMP`,
        };
        const rowOddsEmpty = oddsH <= 0 && oddsD <= 0 && oddsA <= 0;
        this.finalizeFootballPick(recalcSet, null, rowOddsEmpty);
        await this.db.update(matches).set(recalcSet).where(eq(matches.id, row.id));
        recalculated += 1;
      } catch (err) {
        errors += 1;
        const errAny = err as { cause?: { code?: string; message?: string }; message: string };
        this.logger.warn(`v9->v12 recalc failed for ${row.matchNo}: ${errAny.message}`);
      }
    }
    this.logger.log(
      `recalcV9FootballToV12 done: total=${total} recalculated=${recalculated} skipped=${skipped} errors=${errors}`,
    );
    return { total, recalculated, skipped, errors };
  }

  /**
   * v9 闸门一次性数据迁移（v7→v9）：
     * 对所有 match_status='upcoming' 的足球比赛，
     * 取 home_win_prob / draw_prob / away_win_prob 三项最大值，
     * 若 < 45 且 prediction_direction != '观望'，则 update 为 '观望'。
     * 幂等安全，可重复执行。
     */
   async applyV7WdwGateMigration(): Promise<{ updated: number; total: number }> {
      this.logger.log('Starting v7 WDW gate migration for upcoming football matches');
     const rows = await this.db
       .select({
         id: matches.id,
         matchNo: matches.matchNo,
         homeWinProb: matches.homeWinProb,
         drawProb: matches.drawProb,
         awayWinProb: matches.awayWinProb,
         predictionDirection: matches.predictionDirection,
         modelRules: matches.modelRules,
       })
       .from(matches)
       .where(eq(matches.matchStatus, 'upcoming'));

     let updated = 0;
     const total = rows.length;
     for (const row of rows) {
       const isLocked = Array.isArray(row.modelRules)
         && row.modelRules.some((r: string) => r.includes('官方数据锁定'));
       if (isLocked) continue;
       const maxProb = Math.max(
         Number(row.homeWinProb) || 0,
         Number(row.drawProb) || 0,
         Number(row.awayWinProb) || 0,
       );
       if (maxProb < 45 && row.predictionDirection !== '观望') {
        await this.db
          .update(matches)
          .set({
            predictionDirection: '观望',
            lowConfidence: true,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(matches.id, row.id));
        updated += 1;
      }
    }
    this.logger.log(
      `v7 WDW gate migration done: updated=${updated} total=${total}`,
    );
    return { updated, total };
  }

  private async runInjurySync(): Promise<void> {
    try {
      const allInjuries = await this.injurySource.fetchAll();
      this.injuryLastSync = new Date();
      const err = this.injurySource.getLastError();
      if (err && allInjuries.length === 0) {
        this.injurySuccess = false;
        this.logger.error(`Injury sync failed: ${err}`);
      } else {
        this.injurySuccess = true;
        this.injuryTeamCount = this.injurySource.getTeamCount();
        this.injuryPlayerCount = allInjuries.length;
        this.logger.log(
          `Injury sync complete: ${this.injuryTeamCount} teams, ${this.injuryPlayerCount} players`,
        );
      }
      await this.applyInjuriesToMatches();
    } catch (err) {
      this.injuryLastSync = new Date();
      this.injurySuccess = false;
      this.logger.error(`Injury sync failed: ${this.errorMessage(err)}`);
    }
  }

  private async applyInjuriesToMatches(): Promise<void> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const matches = await this.db
      .select({
        id: basketballMatches.id,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        matchStatus: basketballMatches.matchStatus,
      })
      .from(basketballMatches)
      .where(and(
        gte(basketballMatches.kickoffTime, windowStart),
        lte(basketballMatches.kickoffTime, windowEnd),
        ne(basketballMatches.matchStatus, 'finished'),
      ));

    if (matches.length === 0) return;

    let updated = 0;
    for (const m of matches) {
      const homeInjuries = this.injurySource.findTeamInjuries(m.homeTeam);
      const awayInjuries = this.injurySource.findTeamInjuries(m.awayTeam);
      if (homeInjuries.length === 0 && awayInjuries.length === 0) continue;

      const injuryData = {
        home: homeInjuries,
        away: awayInjuries,
        source: homeInjuries.length > 0 ? homeInjuries[0].source : (awayInjuries[0]?.source ?? 'espn-nba'),
        fetchedAt: this.injurySource.getLastFetchAt()?.toISOString() ?? new Date().toISOString(),
      };

      await this.db
        .update(basketballMatches)
        .set({
          injuries: injuryData as Record<string, unknown>,
          injuryUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(basketballMatches.id, m.id));
      updated += 1;
    }

    if (updated > 0) {
      this.logger.log(`Applied injuries to ${updated} basketball matches`);
      const bf = await this.backfillBasketballInjuryReportsInternal();
      this.logger.log(
        `[injury-sync->backfill] ${bf.inserted} new injury reports from ${bf.processed} matches`,
      );
    }
  }

  private async runFdoSync(): Promise<void> {
    if (!this.fdoSource.isEnabled()) return;
    try {
      const todayStr = this.getBeijingTodayStr();
      const dateFrom = todayStr;
      const dateTo = todayStr;

      let totalMatches = 0;
      for (const comp of FDO_DEFAULT_COMPETITIONS.slice(0, 3)) {
        try {
          const fdoMatches = await this.fdoSource.getMatchesForCompetition(comp.code, dateFrom, dateTo);
          totalMatches += fdoMatches.length;
        } catch {
          // individual competition failure is fine, continue with others
        }
      }

      this.fdoLastSync = new Date();
      const err = this.fdoSource.getLastError();
      if (err && totalMatches === 0) {
        this.fdoSuccess = false;
        this.logger.error(`football-data.org sync failed: ${err}`);
      } else {
        this.fdoSuccess = true;
        this.fdoUpdated = totalMatches;
        this.fdoTodayCount += 1;
        this.logger.log(`football-data.org sync complete: ${totalMatches} matches today`);
      }
    } catch (err) {
      this.fdoLastSync = new Date();
      this.fdoSuccess = false;
      this.logger.error(`football-data.org sync failed: ${this.errorMessage(err)}`);
    }
  }

  triggerInjurySync(): void {
    void this.runInjurySync().catch((err: unknown) => {
      this.logger.error(`Manual injury sync failed: ${this.errorMessage(err)}`);
    });
  }

  triggerFdoSync(): void {
    void this.runFdoSync().catch((err: unknown) => {
      this.logger.error(`Manual football-data.org sync failed: ${this.errorMessage(err)}`);
    });
  }

  setFdoApiKey(key: string | undefined): void {
    this.fdoSource.setApiKey(key);
  }

  getInjurySource(): InjurySource {
    return this.injurySource;
  }

  getFdoSource(): FootballDataOrgSource {
    return this.fdoSource;
  }

  async backfillFootballHits(
    startDate?: string,
    endDate?: string,
  ): Promise<{ checked: number; updated: number; errors: number }> {
    this.logger.log(`Starting football hit backfill: ${startDate ?? 'all'} ~ ${endDate ?? 'all'}`);
    const conditions = [
      eq(matches.matchStatus, 'finished'),
      isNotNull(matches.homeScore),
      isNotNull(matches.awayScore),
    ];
    if (startDate) conditions.push(gte(matches.matchDate, startDate));
    if (endDate) conditions.push(lte(matches.matchDate, endDate));
    const rows = await this.db.select({
      id: matches.id,
      matchNo: matches.matchNo,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      predictionDirection: matches.predictionDirection,
      handicap: matches.handicap,
      handicapRecommendation: matches.handicapRecommendation,
      totalGoals: matches.totalGoals,
      totalPick: matches.totalPick,
    })
      .from(matches)
      .where(and(...conditions));
    let checked = 0;
    let updated = 0;
    let errors = 0;
    for (const row of rows) {
      checked += 1;
      try {
        const homeScore = Number(row.homeScore) || 0;
        const awayScore = Number(row.awayScore) || 0;
        const patch: Record<string, unknown> = {};

        if (row.predictionDirection === '主胜') {
          patch.hitWdw = homeScore > awayScore;
        } else if (row.predictionDirection === '客胜') {
          patch.hitWdw = homeScore < awayScore;
        } else if (row.predictionDirection === '平') {
          patch.hitWdw = homeScore === awayScore;
        }

        const hLine = parseFootballHandicapLine(row.handicap);
        if (!Number.isNaN(hLine) && row.handicapRecommendation) {
          const net = homeScore - awayScore;
          const absLine = Math.abs(hLine);
          const favSide = hLine <= 0 ? 'home' : 'away';
          let diff: number;
          if (favSide === 'home') {
            diff = net - absLine;
          } else {
            diff = absLine - net;
          }
          if (Math.abs(diff) < 0.001) {
            patch.hitHandicap = null;
          } else if (row.handicapRecommendation === '让球主胜' || row.handicapRecommendation === '让胜') {
            patch.hitHandicap = diff > 0;
          } else if (row.handicapRecommendation === '让球主负' || row.handicapRecommendation === '让负') {
            patch.hitHandicap = diff < 0;
          }
        }

    const tLine = parseFootballTotalLine(row.totalGoals);
        if (!Number.isNaN(tLine) && row.totalPick) {
          const total = homeScore + awayScore;
          if (total === tLine) {
            patch.hitOverunder = null;
          } else if (row.totalPick === '大球') {
            patch.hitOverunder = total > tLine;
          } else if (row.totalPick === '小球') {
            patch.hitOverunder = total < tLine;
          }
        }

        if (Object.keys(patch).length === 0) continue;
        patch.updatedAt = sql`CURRENT_TIMESTAMP`;
        const result = await this.db.update(matches)
          .set(patch)
          .where(eq(matches.id, row.id))
          .returning({ id: matches.id });
        if (result.length > 0) updated += 1;
      } catch (err) {
        errors += 1;
        this.logger.warn(`football hit backfill failed for ${row.matchNo}: ${(err as Error).message}`);
      }
    }
    this.logger.log(
      `football hit backfill done: checked=${checked} updated=${updated} errors=${errors}`,
    );
    return { checked, updated, errors };
  }

  async backfillBasketballHits(
    startDate?: string,
    endDate?: string,
  ): Promise<{ checked: number; updated: number; errors: number }> {
    this.logger.log(`Starting basketball hit backfill: ${startDate ?? 'all'} ~ ${endDate ?? 'all'}`);
    const conditions = [
      eq(basketballMatches.matchStatus, 'finished'),
      isNotNull(basketballMatches.homeScore),
      isNotNull(basketballMatches.awayScore),
    ];
    if (startDate) conditions.push(gte(basketballMatches.matchDate, startDate));
    if (endDate) conditions.push(lte(basketballMatches.matchDate, endDate));
    const rows = await this.db.select({
      id: basketballMatches.id,
      matchNo: basketballMatches.matchNo,
      homeScore: basketballMatches.homeScore,
      awayScore: basketballMatches.awayScore,
      predictionDirection: basketballMatches.predictionDirection,
      handicapLineNum: basketballMatches.handicapLineNum,
      handicapRecommendation: basketballMatches.handicapRecommendation,
      totalLineNum: basketballMatches.totalLineNum,
      totalDirection: basketballMatches.totalDirection,
      frozenHandicapRec: basketballMatches.frozenHandicapRec,
      frozenTotalDirection: basketballMatches.frozenTotalDirection,
      frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
      frozenHandicapLine: basketballMatches.frozenHandicapLine,
      frozenTotalLine: basketballMatches.frozenTotalLine,
    })
      .from(basketballMatches)
      .where(and(...conditions));
    let checked = 0;
    let updated = 0;
    let errors = 0;
    for (const row of rows) {
      checked += 1;
      try {
        const homeScore = Number(row.homeScore) || 0;
        const awayScore = Number(row.awayScore) || 0;
        const hits = this.computeBasketballHits(
          homeScore,
          awayScore,
          row.predictionDirection ?? row.frozenPredictionDirection as string | null,
          row.handicapLineNum ?? row.frozenHandicapLine,
          row.handicapRecommendation ?? row.frozenHandicapRec as string | null,
          row.totalLineNum ?? row.frozenTotalLine,
          row.totalDirection ?? row.frozenTotalDirection as string | null,
        );
        const patch: Record<string, unknown> = {};
        if (hits.hitWdw !== null) patch.hitWdw = hits.hitWdw;
        if (hits.hitHandicap !== undefined) patch.hitHandicap = hits.hitHandicap;
        if (hits.hitOverunder !== undefined) patch.hitOverunder = hits.hitOverunder;
        if (Object.keys(patch).length === 0) continue;
        patch.updatedAt = sql`CURRENT_TIMESTAMP`;
        const result = await this.db.update(basketballMatches)
          .set(patch)
          .where(eq(basketballMatches.id, row.id))
          .returning({ id: basketballMatches.id });
        if (result.length > 0) updated += 1;
      } catch (err) {
        errors += 1;
        this.logger.warn(`basketball hit backfill failed for ${row.matchNo}: ${(err as Error).message}`);
      }
    }
    this.logger.log(
      `basketball hit backfill done: checked=${checked} updated=${updated} errors=${errors}`,
    );
    return { checked, updated, errors };
  }

  async runPostSyncInjuryBackfill(taskName: string): Promise<void> {
    try {
      this.logger.log(`[post-sync] Running injury backfill after ${taskName}`);
      const bb = await this.backfillBasketballInjuryReportsInternal();
      const fb = await this.backfillFootballInjuryReportsInternal();
      this.logger.log(
        `[post-sync] Injury backfill done: bb inserted=${bb.inserted}, fb inserted=${fb.inserted}`,
      );
    } catch (err) {
      this.logger.warn(`[post-sync] Injury backfill failed: ${this.errorMessage(err)}`);
    }
  }

  async runStartupInjuryBackfill(): Promise<void> {
    try {
      await new Promise<void>((r) => setTimeout(r, 15000));
      this.logger.log('[startup] Running initial injury backfill for upcoming matches');
      const bb = await this.backfillBasketballInjuryReportsInternal();
      const fb = await this.backfillFootballInjuryReportsInternal();
      this.logger.log(
        `[startup] Injury backfill done: bb inserted=${bb.inserted}, fb inserted=${fb.inserted}`,
      );
    } catch (err) {
      this.logger.warn(`[startup] Injury backfill failed: ${this.errorMessage(err)}`);
    }
  }

  private async backfillBasketballInjuryReportsInternal(): Promise<{ processed: number; inserted: number; skipped: number }> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        league: basketballMatches.league,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        injuries: basketballMatches.injuries,
        source: basketballMatches.source,
        kickoffTime: basketballMatches.kickoffTime,
      })
      .from(basketballMatches)
      .where(
        sql`${basketballMatches.injuries} IS NOT NULL AND ${basketballMatches.matchStatus} != 'finished' AND ${basketballMatches.matchStatus} != 'canceled'`,
      );

    let processed = 0;
    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      const obj = row.injuries as unknown as Record<string, unknown> | null;
      if (!obj || typeof obj !== 'object') { skipped += 1; continue; }
      const processSide = async (side: 'home' | 'away', arr: unknown) => {
        if (!Array.isArray(arr)) return;
        const teamName = side === 'home' ? row.homeTeam : row.awayTeam;
        for (const item of arr) {
          if (!item || typeof item !== 'object') continue;
          const p = item as Record<string, unknown>;
          const name = typeof p.athleteName === 'string' ? p.athleteName : typeof p.playerName === 'string' ? p.playerName : typeof p.name === 'string' ? p.name : '';
          if (!name) continue;
          const status = typeof p.status === 'string' ? p.status : 'out';
          const shortComment = typeof p.shortComment === 'string' ? p.shortComment : '';
          const position = typeof p.position === 'string' ? p.position : undefined;
          const impactRaw = typeof p.impact === 'string' ? p.impact : '';
          let impactRating: 'high' | 'medium' | 'low' | 'unknown' = 'unknown';
          const sl = status.toLowerCase();
          const il = impactRaw.toLowerCase();
          if (il.includes('high') || sl.includes('out') || sl.includes('赛季报销') || sl.includes('doubtful')) impactRating = 'high';
          else if (il.includes('medium') || sl.includes('questionable') || sl.includes('出战成疑') || sl.includes('缺阵')) impactRating = 'medium';
          else if (il.includes('low') || sl.includes('probable')) impactRating = 'low';

          const existing = await this.db
            .select({ id: injuryReports.id })
            .from(injuryReports)
            .where(sql`${injuryReports.matchId} = ${row.id} AND ${injuryReports.teamSide} = ${side} AND ${injuryReports.playerName} = ${name} AND ${injuryReports.sport} = 'basketball'`)
            .limit(1);

          if (existing.length > 0) {
            await this.db.update(injuryReports).set({ status, shortComment: shortComment || null, impactRating, position: position || null, updatedAt: new Date() }).where(eq(injuryReports.id, existing[0].id));
            processed += 1;
          } else {
            await this.db.insert(injuryReports).values({ matchId: row.id, sport: 'basketball', teamSide: side, teamName: teamName || '', playerName: name, status, shortComment: shortComment || null, impactRating, position: position || null, source: 'espn_summary', dataSource: 'espn' });
            inserted += 1; processed += 1;
          }
        }
      };
      await processSide('home', (obj as Record<string, unknown>).home);
      await processSide('away', (obj as Record<string, unknown>).away);
    }
    return { processed, inserted, skipped };
  }

  private async backfillFootballInjuryReportsInternal(): Promise<{ processed: number; inserted: number; skipped: number }> {
    const rows = await this.db
      .select({
        id: matches.id,
        league: matches.league,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        injuriesJson: matches.injuriesJson,
        source: matches.source,
        kickoffTime: matches.kickoffTime,
      })
      .from(matches)
      .where(
        sql`${matches.injuriesJson} IS NOT NULL AND ${matches.matchStatus} != 'finished' AND ${matches.matchStatus} != 'canceled'`,
      );

    let processed = 0;
    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      const obj = row.injuriesJson as unknown as Record<string, unknown> | null;
      if (!obj || typeof obj !== 'object') { skipped += 1; continue; }
      const processSide = async (side: 'home' | 'away', arr: unknown) => {
        if (!Array.isArray(arr)) return;
        const teamName = side === 'home' ? row.homeTeam : row.awayTeam;
        for (const item of arr) {
          if (!item || typeof item !== 'object') continue;
          const p = item as Record<string, unknown>;
          const name = typeof p.athleteName === 'string' ? p.athleteName : '';
          if (!name) continue;
          const status = typeof p.status === 'string' ? p.status : 'out';
          const shortComment = typeof p.shortComment === 'string' ? p.shortComment : '';
          const position = typeof p.position === 'string' ? p.position : undefined;
          const injuryType = typeof p.type === 'string' ? p.type : undefined;
          const injuryDate = typeof p.date === 'string' && p.date ? new Date(p.date) : undefined;
          const impactRaw = typeof p.impact === 'string' ? p.impact : '';
          let impactRating: 'high' | 'medium' | 'low' | 'unknown' = 'unknown';
          const sl = status.toLowerCase();
          const il = impactRaw.toLowerCase();
          if (il.includes('high') || sl.includes('out') || sl.includes('赛季报销') || sl.includes('doubtful')) impactRating = 'high';
          else if (il.includes('medium') || sl.includes('questionable') || sl.includes('出战成疑') || sl.includes('缺阵')) impactRating = 'medium';
          else if (il.includes('low') || sl.includes('probable')) impactRating = 'low';

          const existing = await this.db
            .select({ id: injuryReports.id })
            .from(injuryReports)
            .where(sql`${injuryReports.matchId} = ${row.id} AND ${injuryReports.teamSide} = ${side} AND ${injuryReports.playerName} = ${name} AND ${injuryReports.sport} = 'football'`)
            .limit(1);

          if (existing.length > 0) {
            await this.db.update(injuryReports).set({ status, shortComment: shortComment || null, impactRating, position: position || null, injuryType: injuryType || null, injuryDate: injuryDate || null, updatedAt: new Date() }).where(eq(injuryReports.id, existing[0].id));
            processed += 1;
          } else {
            await this.db.insert(injuryReports).values({ matchId: row.id, sport: 'football', teamSide: side, teamName: teamName || '', playerName: name, status, shortComment: shortComment || null, impactRating, position: position || null, injuryType: injuryType || null, injuryDate: injuryDate || null, source: 'espn_summary', dataSource: 'espn' });
            inserted += 1; processed += 1;
          }
        }
      };
      await processSide('home', obj.home);
      await processSide('away', obj.away);
    }
    return { processed, inserted, skipped };
  }

  public bbHasTeamOppgStats(teamStats: unknown, side: 'home' | 'away'): boolean {
    if (!teamStats || typeof teamStats !== 'object') return false;
    const ts = teamStats as Record<string, unknown>;
    const sideData = ts[side] as Record<string, unknown> | null | undefined;
    if (!sideData) return false;
    const rawVal = sideData.oppg != null && sideData.oppg !== ''
      ? sideData.oppg
      : sideData.pointsAllowedPerGame;
    const n = Number(rawVal);
    return !Number.isNaN(n) && n > 0;
  }

  public bbHasTeamStats(teamStats: unknown, side: 'home' | 'away'): boolean {
    if (!teamStats || typeof teamStats !== 'object') return false;
    const ts = teamStats as Record<string, unknown>;
    const sideData = ts[side] as Record<string, unknown> | null | undefined;
    if (!sideData) return false;
    const rawVal = sideData.pointsPerGame != null && sideData.pointsPerGame !== ''
      ? sideData.pointsPerGame
      : sideData.ppg;
    const n = Number(rawVal);
    return !Number.isNaN(n) && n > 0;
  }

  public async bbComputeHistoricalTeamStats(
    teams: Array<{ teamName: string; league: string }>,
  ): Promise<Map<string, { ppg: number; oppg: number; games: number; recent10Ppg: number; recent10Oppg: number; recent20Ppg: number; recent20Oppg: number; sampleCount: number }>> {
    const result = new Map<string, { ppg: number; oppg: number; games: number; recent10Ppg: number; recent10Oppg: number; recent20Ppg: number; recent20Oppg: number; sampleCount: number }>();
    const uniqueTeams = Array.from(new Set(teams.map(t => t.teamName)));
    if (uniqueTeams.length === 0) return result;

    const avg = (arr: Array<{ ppg: number; oppg: number }>, field: 'ppg' | 'oppg'): number => {
      if (arr.length === 0) return 0;
      return arr.reduce((s, g) => s + g[field], 0) / arr.length;
    };

    for (const teamName of uniqueTeams) {
      const normName = normalizeBasketballTeamName(teamName);
      const searchName = normName.length >= 3 ? normName.slice(-3) : normName;

      const rows = await this.db
        .select({
          homeTeam: basketballMatches.homeTeam,
          awayTeam: basketballMatches.awayTeam,
          homeScore: basketballMatches.homeScore,
          awayScore: basketballMatches.awayScore,
          kickoffTime: basketballMatches.kickoffTime,
        })
        .from(basketballMatches)
         .where(and(
           eq(basketballMatches.matchStatus, 'finished'),
           isNotNull(basketballMatches.homeScore),
           isNotNull(basketballMatches.awayScore),
           sql`coalesce(${basketballMatches.homeScore}, 0)::int > 0`,
           not(inArray(basketballMatches.league, ['篮球季前赛', '篮球季前赛吉安赛区', '篮球季前赛宜宾赛区', '篮球中国赛', '篮球云南昆明站day2', '篮球决赛'])),
           or(
             sql`lower(${basketballMatches.homeTeam}) LIKE ${'%' + searchName.toLowerCase() + '%'}`,
             sql`lower(${basketballMatches.awayTeam}) LIKE ${'%' + searchName.toLowerCase() + '%'}`,
           ),
         ))
        .orderBy(sql`${basketballMatches.kickoffTime} DESC`)
        .limit(80);

      const games: Array<{ ppg: number; oppg: number; kickoffTime: Date }> = [];
      for (const row of rows) {
        const hs = Number(row.homeScore) || 0;
        const as = Number(row.awayScore) || 0;
        if (hs <= 0 && as <= 0) continue;
        const hNorm = row.homeTeam ? normalizeBasketballTeamName(row.homeTeam) : '';
        const aNorm = row.awayTeam ? normalizeBasketballTeamName(row.awayTeam) : '';
        const kt = row.kickoffTime instanceof Date ? row.kickoffTime : new Date(String(row.kickoffTime));
        if (hNorm === normName) games.push({ ppg: hs, oppg: as, kickoffTime: kt });
        else if (aNorm === normName) games.push({ ppg: as, oppg: hs, kickoffTime: kt });
      }

      if (games.length > 0) {
        const sorted = games.sort((a, b) => b.kickoffTime.getTime() - a.kickoffTime.getTime());
        const recent20 = sorted.slice(0, 20);
        const recent10 = sorted.slice(0, 10);
        const totalPpg = avg(sorted, 'ppg');
        const totalOppg = avg(sorted, 'oppg');
        if (totalPpg > 0 && totalOppg > 0) {
          result.set(teamName, {
            ppg: Math.round(totalPpg * 10) / 10,
            oppg: Math.round(totalOppg * 10) / 10,
            games: sorted.length,
            recent10Ppg: Math.round(avg(recent10, 'ppg') * 10) / 10,
            recent10Oppg: Math.round(avg(recent10, 'oppg') * 10) / 10,
            recent20Ppg: Math.round(avg(recent20, 'ppg') * 10) / 10,
            recent20Oppg: Math.round(avg(recent20, 'oppg') * 10) / 10,
            sampleCount: sorted.length,
          });
        }
      }
    }
    this.logger.log(`[bb-hist-stats] computed ${result.size}/${uniqueTeams.length} teams: ${Array.from(result.entries()).map(([k,v]) => `${k}(${v.games}g)`).join(', ')}`);

    // 赛季基线兜底：当球队历史样本不足5场时，用2024-25赛季StatMuse基线填充
    // 解决赛季初大小分贴线50/50问题
    const lowSampleTeams: string[] = [];
    for (const team of uniqueTeams) {
      const existing = result.get(team);
      const currentSample = existing?.sampleCount ?? 0;
      if (currentSample < 5) lowSampleTeams.push(team);
    }

    if (lowSampleTeams.length > 0) {
      const baselineRows = await this.db
        .select({
          teamName: teamSeasonStats.teamName,
          ppg: teamSeasonStats.ppg,
          oppg: teamSeasonStats.oppg,
        })
        .from(teamSeasonStats)
        .where(and(
          eq(teamSeasonStats.season, '2024-25'),
          eq(teamSeasonStats.dataSource, 'statmuse_2024-25'),
        ));

      if (baselineRows.length > 0) {
        const seasonBaselineMap = new Map<string, { ppg: number; oppg: number }>();
        for (const br of baselineRows) {
          if (br.teamName && br.ppg != null && br.oppg != null) {
            seasonBaselineMap.set(br.teamName.toLowerCase(), {
              ppg: Number(br.ppg),
              oppg: Number(br.oppg),
            });
          }
        }

        const findBaseline = (teamName: string): { ppg: number; oppg: number } | null => {
          const norm = normalizeBasketballTeamName(teamName).toLowerCase();
          if (!norm) return null;
          if (seasonBaselineMap.has(norm)) return seasonBaselineMap.get(norm)!;
          for (const [key, val] of seasonBaselineMap.entries()) {
            if (key.length >= 2 && (norm.includes(key) || key.includes(norm))) {
              return val;
            }
          }
          return null;
        };

        let baselineApplied = 0;
        for (const team of lowSampleTeams) {
          const existing = result.get(team);
          const currentSample = existing?.sampleCount ?? 0;
          const baseline = findBaseline(team);
          if (!baseline) continue;

          const baselinePpg = baseline.ppg;
          const baselineOppg = baseline.oppg;
          const effectiveSample = 15;

          if (!existing || currentSample === 0) {
            result.set(team, {
              ppg: Math.round(baselinePpg * 10) / 10,
              oppg: Math.round(baselineOppg * 10) / 10,
              games: effectiveSample,
              recent10Ppg: Math.round(baselinePpg * 10) / 10,
              recent10Oppg: Math.round(baselineOppg * 10) / 10,
              recent20Ppg: Math.round(baselinePpg * 10) / 10,
              recent20Oppg: Math.round(baselineOppg * 10) / 10,
              sampleCount: effectiveSample,
            });
          } else {
            const seasonRatio = Math.min(currentSample / 20, 1);
            const baselineRatio = 1 - seasonRatio;
            const fusedPpg = existing.ppg * seasonRatio + baselinePpg * baselineRatio;
            const fusedOppg = existing.oppg * seasonRatio + baselineOppg * baselineRatio;
            const fused10Ppg = (existing.recent10Ppg || baselinePpg) * seasonRatio + baselinePpg * baselineRatio;
            const fused10Oppg = (existing.recent10Oppg || baselineOppg) * seasonRatio + baselineOppg * baselineRatio;
            const fused20Ppg = existing.recent20Ppg * seasonRatio + baselinePpg * baselineRatio;
            const fused20Oppg = existing.recent20Oppg * seasonRatio + baselineOppg * baselineRatio;
            result.set(team, {
              ppg: Math.round(fusedPpg * 10) / 10,
              oppg: Math.round(fusedOppg * 10) / 10,
              games: effectiveSample,
              recent10Ppg: Math.round(fused10Ppg * 10) / 10,
              recent10Oppg: Math.round(fused10Oppg * 10) / 10,
              recent20Ppg: Math.round(fused20Ppg * 10) / 10,
              recent20Oppg: Math.round(fused20Oppg * 10) / 10,
              sampleCount: effectiveSample,
            });
          }
          baselineApplied += 1;
        }
        this.logger.log(`[bb-hist-stats] season baseline applied to ${baselineApplied}/${lowSampleTeams.length} low-sample teams`);
      }
    }

    return result;
  }

  public bbFillHistoricalStats(
    row: { homeTeam: string | null; awayTeam: string | null; teamStats: unknown },
    histMap: Map<string, { ppg: number; oppg: number; games: number; recent10Ppg: number; recent10Oppg: number; recent20Ppg: number; recent20Oppg: number; sampleCount: number }>,
  ): { homePpg?: number; awayPpg?: number; homeOppg?: number; awayOppg?: number; recent10HomePpg?: number; recent10AwayPpg?: number; recent10HomeOppg?: number; recent10AwayOppg?: number; recent20HomePpg?: number; recent20AwayPpg?: number; recent20HomeOppg?: number; recent20AwayOppg?: number; recentSampleCount?: number } {
    const out: { homePpg?: number; awayPpg?: number; homeOppg?: number; awayOppg?: number; recent10HomePpg?: number; recent10AwayPpg?: number; recent10HomeOppg?: number; recent10AwayOppg?: number; recent20HomePpg?: number; recent20AwayPpg?: number; recent20HomeOppg?: number; recent20AwayOppg?: number; recentSampleCount?: number } = {};
    let homeSamp = 0;
    let awaySamp = 0;
    if (row.homeTeam) {
      const stat = histMap.get(row.homeTeam);
      const hasHomeTeamStats = this.bbHasTeamStats(row.teamStats, 'home');
      const hasHomeOppgStats = this.bbHasTeamOppgStats(row.teamStats, 'home');
      if (stat && stat.ppg > 0 && !hasHomeTeamStats) {
        out.homePpg = stat.ppg;
        out.homeOppg = stat.oppg;
      } else if (stat && stat.oppg > 0 && hasHomeTeamStats && !hasHomeOppgStats) {
        out.homeOppg = stat.oppg;
      }
      if (stat && stat.recent20Ppg > 0) {
        out.recent10HomePpg = stat.recent10Ppg;
        out.recent10HomeOppg = stat.recent10Oppg;
        out.recent20HomePpg = stat.recent20Ppg;
        out.recent20HomeOppg = stat.recent20Oppg;
        homeSamp = stat.sampleCount;
      }
      if (!out.homeOppg && hasHomeTeamStats && !hasHomeOppgStats) {
        this.logger.warn(`[DEBUG-OPPG] home ${row.homeTeam}: hasTeamStats=${hasHomeTeamStats}, hasOppgStats=${hasHomeOppgStats}, histExists=${!!stat}, histOppg=${stat?.oppg ?? 'N/A'}, histSample=${stat?.sampleCount ?? 'N/A'}`);
      }
    }
    if (row.awayTeam) {
      const stat = histMap.get(row.awayTeam);
      const hasAwayTeamStats = this.bbHasTeamStats(row.teamStats, 'away');
      const hasAwayOppgStats = this.bbHasTeamOppgStats(row.teamStats, 'away');
      if (stat && stat.ppg > 0 && !hasAwayTeamStats) {
        out.awayPpg = stat.ppg;
        out.awayOppg = stat.oppg;
      } else if (stat && stat.oppg > 0 && hasAwayTeamStats && !hasAwayOppgStats) {
        out.awayOppg = stat.oppg;
      }
      if (stat && stat.recent20Ppg > 0) {
        out.recent10AwayPpg = stat.recent10Ppg;
        out.recent10AwayOppg = stat.recent10Oppg;
        out.recent20AwayPpg = stat.recent20Ppg;
        out.recent20AwayOppg = stat.recent20Oppg;
        awaySamp = stat.sampleCount;
      }
      if (!out.awayOppg && hasAwayTeamStats && !hasAwayOppgStats) {
        this.logger.warn(`[DEBUG-OPPG] away ${row.awayTeam}: hasTeamStats=${hasAwayTeamStats}, hasOppgStats=${hasAwayOppgStats}, histExists=${!!stat}, histOppg=${stat?.oppg ?? 'N/A'}, histSample=${stat?.sampleCount ?? 'N/A'}`);
      }
    }
    if (homeSamp > 0 && awaySamp > 0) {
      out.recentSampleCount = Math.min(homeSamp, awaySamp);
    } else if (homeSamp > 0) {
      out.recentSampleCount = homeSamp;
    } else if (awaySamp > 0) {
      out.recentSampleCount = awaySamp;
    }
    return out;
  }

  /**
   * 计算足球比赛三项命中结果（与现有同步逻辑保持一致）
   */
  private computeFootballHits(
    homeScore: number,
    awayScore: number,
    predictionDirection: string | null,
    handicap: string | null,
    handicapRecommendation: string | null,
    overUnder: string | null,
    totalPick: string | null,
  ): { hitWdw: boolean | null; hitHandicap: boolean | null; hitOverunder: boolean | null } {
    let hitWdw: boolean | null = null;
    let hitHandicap: boolean | null = null;
    let hitOverunder: boolean | null = null;

    // WDW 胜平负
    if (predictionDirection === '主胜') {
      hitWdw = homeScore > awayScore;
    } else if (predictionDirection === '客胜') {
      hitWdw = homeScore < awayScore;
    } else if (predictionDirection === '平') {
      hitWdw = homeScore === awayScore;
    }

    // 让球
    const hLine: number = handicap != null && handicap !== '' ? Number(handicap) : NaN;
    if (!Number.isNaN(hLine) && handicapRecommendation && handicapRecommendation !== '观望') {
      const v: number = (homeScore - awayScore) + hLine;
      if (handicapRecommendation === '让平') {
        hitHandicap = v === 0;
      } else if (v === 0) {
        hitHandicap = false;
      } else if (handicapRecommendation === '让球主胜' || handicapRecommendation === '让胜') {
        hitHandicap = v > 0;
      } else if (handicapRecommendation === '让球主负' || handicapRecommendation === '让负') {
        hitHandicap = v < 0;
      }
    }

    // 大小球
    const tLine: number = overUnder != null && overUnder !== '' ? Number(overUnder) : NaN;
    if (!Number.isNaN(tLine) && totalPick && totalPick !== '观望') {
      const total: number = homeScore + awayScore;
      if (total === tLine) {
        hitOverunder = null; // 走盘
      } else if (totalPick === '大球' || totalPick === '大') {
        hitOverunder = total > tLine;
      } else if (totalPick === '小球' || totalPick === '小') {
        hitOverunder = total < tLine;
      }
    }

    return { hitWdw, hitHandicap, hitOverunder };
  }

  /**
   * 批量命中回打补全：查询所有finished但任一命中字段为空的比赛，
   * 逐条计算三项命中并批量写回。
   */
  async backfillFootballHitResults(): Promise<{ checked: number; updated: number; skipped: number }> {
    const BATCH_SIZE = 100;
    let checked = 0;
    let updated = 0;
    let skipped = 0;

    const rows = await this.db
      .select({
        id: matches.id,
        homeScore: matches.homeScore,
        awayScore: matches.awayScore,
        predictionDirection: matches.predictionDirection,
        handicap: matches.handicap,
        handicapRecommendation: matches.handicapRecommendation,
        overUnder: matches.overUnder,
        totalPick: matches.totalPick,
        hitWdw: matches.hitWdw,
        hitHandicap: matches.hitHandicap,
        hitOverunder: matches.hitOverunder,
      })
      .from(matches)
      .where(
        and(
          eq(matches.matchStatus, 'finished'),
          or(
            isNull(matches.hitWdw),
            isNull(matches.hitHandicap),
            isNull(matches.hitOverunder),
          ),
        ),
      )
      .orderBy(matches.kickoffTime);

    checked = rows.length;

    const toUpdate: Array<{
      id: string;
      hitWdw: boolean | null;
      hitHandicap: boolean | null;
      hitOverunder: boolean | null;
    }> = [];

    for (const row of rows) {
      if (row.homeScore == null || row.awayScore == null) {
        skipped += 1;
        continue;
      }

      const hits = this.computeFootballHits(
        row.homeScore,
        row.awayScore,
        row.predictionDirection || null,
        row.handicap || null,
        row.handicapRecommendation || null,
        row.overUnder || null,
        row.totalPick || null,
      );

      const needsUpdate =
        (row.hitWdw == null && hits.hitWdw !== undefined) ||
        (row.hitHandicap == null && hits.hitHandicap !== undefined) ||
        (row.hitOverunder == null && hits.hitOverunder !== undefined);

      if (needsUpdate) {
        toUpdate.push({
          id: row.id,
          hitWdw: hits.hitWdw,
          hitHandicap: hits.hitHandicap,
          hitOverunder: hits.hitOverunder,
        });
      } else {
        skipped += 1;
      }
    }

    // 批量 UPDATE，每批 100 条
    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = toUpdate.slice(i, i + BATCH_SIZE);
      await this.db.transaction(async (tx) => {
        for (const item of batch) {
          const patch: Record<string, unknown> = {};
          if (item.hitWdw !== undefined) patch.hitWdw = item.hitWdw;
          if (item.hitHandicap !== undefined) patch.hitHandicap = item.hitHandicap;
          if (item.hitOverunder !== undefined) patch.hitOverunder = item.hitOverunder;
          if (Object.keys(patch).length === 0) continue;
          await tx.update(matches).set(patch).where(eq(matches.id, item.id));
        }
      });
      updated += batch.length;
    }

    this.logger.log(
      `[football-backfill] checked=${checked}, updated=${updated}, skipped=${skipped}`,
    );
    return { checked, updated, skipped };
  }

  /**
   * 卡live超期自动处理：查找开赛超过48小时仍为live的比赛，
   * 有合理比分的转finished并补打命中，无比分的转score_pending。
   */
  async autoResolveStaleLiveFootball(): Promise<{
    total: number;
    resolvedToFinished: number;
    resolvedToPending: number;
    stillLive: number;
  }> {
    const rows = await this.db
      .select({
        id: matches.id,
        homeScore: matches.homeScore,
        awayScore: matches.awayScore,
        predictionDirection: matches.predictionDirection,
        handicap: matches.handicap,
        handicapRecommendation: matches.handicapRecommendation,
        overUnder: matches.overUnder,
        totalPick: matches.totalPick,
        kickoffTime: matches.kickoffTime,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        league: matches.league,
      })
      .from(matches)
      .where(
        and(
          eq(matches.matchStatus, 'live'),
          lt(matches.kickoffTime, sql`CURRENT_TIMESTAMP - INTERVAL '12 hours'`),
        ),
      )
      .orderBy(matches.kickoffTime);

    const total = rows.length;
    let resolvedToFinished = 0;
    let resolvedToPending = 0;
    let stillLive = 0;

    for (const row of rows) {
      const homeScore = row.homeScore;
      const awayScore = row.awayScore;
      const hasScore = homeScore != null && awayScore != null;

      if (hasScore) {
        const h = homeScore as number;
        const a = awayScore as number;
        const totalGoals = h + a;
        const scoreValid =
          h >= 0 &&
          a >= 0 &&
          totalGoals <= 20 &&
          (h > 0 || a > 0); // 两队都是0且卡超久的不转finished

        if (scoreValid) {
          const hits = this.computeFootballHits(
            h,
            a,
            row.predictionDirection || null,
            row.handicap || null,
            row.handicapRecommendation || null,
            row.overUnder || null,
            row.totalPick || null,
          );
          await this.db.update(matches).set({
            matchStatus: 'finished',
            hitWdw: hits.hitWdw ?? undefined,
            hitHandicap: hits.hitHandicap ?? undefined,
            hitOverunder: hits.hitOverunder ?? undefined,
            resultPendingReason: 'auto-resolve-stale-live-finished',
            updatedAt: sql`CURRENT_TIMESTAMP`,
          }).where(eq(matches.id, row.id));
          resolvedToFinished += 1;
          continue;
        }
      }

      // 无比分或比分不合理（包括0-0卡超久）→ 转 score_pending
      await this.db.update(matches).set({
        matchStatus: 'score_pending' as const,
        resultPendingReason: 'stale_live_no_valid_score',
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(matches.id, row.id));
      resolvedToPending += 1;
    }

    stillLive = total - resolvedToFinished - resolvedToPending;

    this.logger.log(
      `[football-stale-live] total=${total}, ` +
      `to_finished=${resolvedToFinished}, to_pending=${resolvedToPending}, still_live=${stillLive}`,
    );
    return { total, resolvedToFinished, resolvedToPending, stillLive };
  }

  async resolveFinishedNoScoreBasketball(): Promise<{
    total: number;
    updated: number;
    bySource: Record<string, number>;
  }> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        source: basketballMatches.source,
        kickoffTime: basketballMatches.kickoffTime,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'finished'),
          sql`(${basketballMatches.homeScore} IS NULL OR ${basketballMatches.awayScore} IS NULL)`,
          lt(basketballMatches.kickoffTime, sql`CURRENT_TIMESTAMP - INTERVAL '24 hours'`),
        ),
      )
      .orderBy(basketballMatches.kickoffTime);

    const total = rows.length;
    const bySource: Record<string, number> = {};
    let updated = 0;

    for (const row of rows) {
      const src = row.source ?? 'unknown';
      bySource[src] = (bySource[src] ?? 0) + 1;
      await this.db.update(basketballMatches).set({
        matchStatus: 'score_pending' as const,
        resultPendingReason: 'data_source_no_score_coverage',
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(basketballMatches.id, row.id));
      updated += 1;
    }

    this.logger.log(
      `[bb-finished-no-score] total=${total}, updated=${updated}`,
    );
    return { total, updated, bySource };
  }

  async autoResolveStaleLiveBasketball(): Promise<{
    total: number;
    resolvedToFinished: number;
    resolvedToPending: number;
    stillLive: number;
  }> {
    const rows = await this.db
      .select({
        id: basketballMatches.id,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        predictionDirection: basketballMatches.predictionDirection,
        handicap: basketballMatches.handicap,
        handicapRecommendation: basketballMatches.handicapRecommendation,
        totalDirection: basketballMatches.totalDirection,
        totalPick: basketballMatches.totalDirection,
        kickoffTime: basketballMatches.kickoffTime,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        league: basketballMatches.league,
        handicapLineNum: basketballMatches.handicapLineNum,
        totalLineNum: basketballMatches.totalLineNum,
        isPredictionFrozen: basketballMatches.isPredictionFrozen,
        frozenHandicapRec: basketballMatches.frozenHandicapRec,
        frozenTotalDirection: basketballMatches.frozenTotalDirection,
        frozenPredictionDirection: basketballMatches.frozenPredictionDirection,
        frozenConfidence: basketballMatches.frozenConfidence,
        frozenHandicapLine: basketballMatches.frozenHandicapLine,
        frozenTotalLine: basketballMatches.frozenTotalLine,
      })
      .from(basketballMatches)
      .where(
        and(
          eq(basketballMatches.matchStatus, 'live'),
          lt(basketballMatches.kickoffTime, sql`CURRENT_TIMESTAMP - INTERVAL '12 hours'`),
        ),
      )
      .orderBy(basketballMatches.kickoffTime);

    const total = rows.length;
    let resolvedToFinished = 0;
    let resolvedToPending = 0;
    let stillLive = 0;

    for (const row of rows) {
      const homeScore = row.homeScore;
      const awayScore = row.awayScore;
      const hasScore = homeScore != null && awayScore != null;

      if (hasScore) {
        const h = homeScore as number;
        const a = awayScore as number;
        const totalPts = h + a;
        const scoreValid =
          h >= 0 &&
          a >= 0 &&
          totalPts >= 60 &&
          totalPts <= 300 &&
          Math.abs(h - a) <= 80 &&
          (h > 0 || a > 0);

        if (scoreValid) {
          const hits = this.computeBasketballHits(
            h,
            a,
            row.predictionDirection ?? row.frozenPredictionDirection ?? null,
             row.handicapLineNum ?? row.frozenHandicapLine ?? null,
             row.handicapRecommendation ?? row.frozenHandicapRec ?? null,
             row.totalLineNum ?? row.frozenTotalLine ?? null,
             row.totalDirection ?? row.frozenTotalDirection ?? null,
          );
          const stalePatch: Record<string, unknown> = {
            matchStatus: 'finished',
            hitWdw: hits.hitWdw ?? undefined,
            hitHandicap: hits.hitHandicap ?? undefined,
            hitOverunder: hits.hitOverunder ?? undefined,
            resultPendingReason: 'auto-resolve-stale-live-finished',
            updatedAt: sql`CURRENT_TIMESTAMP`,
          };
          // 开赛冻结：如果还没冻结，stale live 变 finished 也补一个冻结快照
          if (!row.isPredictionFrozen) {
            stalePatch.frozenHandicapRec = row.handicapRecommendation;
            stalePatch.frozenTotalDirection = row.totalDirection;
            stalePatch.frozenPredictionDirection = row.predictionDirection;
            stalePatch.frozenConfidence = null;
            stalePatch.frozenHandicapLine = row.handicapLineNum;
            stalePatch.frozenTotalLine = row.totalLineNum;
            stalePatch.isPredictionFrozen = true;
          }
          await this.db.update(basketballMatches).set(stalePatch)
            .where(eq(basketballMatches.id, row.id));
          resolvedToFinished += 1;
          continue;
        }
      }

      await this.db.update(basketballMatches).set({
        matchStatus: 'score_pending' as const,
        resultPendingReason: 'stale_live_no_valid_score',
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(basketballMatches.id, row.id));
      resolvedToPending += 1;
    }

    stillLive = total - resolvedToFinished - resolvedToPending;

    this.logger.log(
      `[bb-stale-live] total=${total}, ` +
      `to_finished=${resolvedToFinished}, to_pending=${resolvedToPending}, still_live=${stillLive}`,
    );
    return { total, resolvedToFinished, resolvedToPending, stillLive };
  }

  /**
   * 过期 upcoming 巡检：开赛超过 12 小时仍为 upcoming 的比赛，告警但保持 upcoming 状态。
   * 保守处理：不直接改 finished，等待球美宝/ESPN 等权威源确认；仅记录日志供人工排查。
   */
  async autoResolveStaleUpcomingFootball(): Promise<{
    total: number;
    bySource: Record<string, number>;
    byHourBucket: Record<string, number>;
  }> {
    const rows = await this.db
      .select({
        id: matches.id,
        matchNo: matches.matchNo,
        source: matches.source,
        kickoffTime: matches.kickoffTime,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        league: matches.league,
      })
      .from(matches)
      .where(
        and(
          eq(matches.matchStatus, 'upcoming'),
          lt(matches.kickoffTime, sql`CURRENT_TIMESTAMP - INTERVAL '12 hours'`),
          // 只查过去 7 天内的，避免历史数据干扰
          gt(matches.kickoffTime, sql`CURRENT_TIMESTAMP - INTERVAL '7 days'`),
        ),
      )
      .orderBy(matches.kickoffTime);

    const total = rows.length;
    const bySource: Record<string, number> = {};
    const byHourBucket: Record<string, number> = {};

    if (total > 0) {
      const now = Date.now();
      for (const row of rows) {
        const src = row.source ?? 'unknown';
        bySource[src] = (bySource[src] ?? 0) + 1;

        const kickoffMs = row.kickoffTime instanceof Date
          ? row.kickoffTime.getTime()
          : new Date(row.kickoffTime as string).getTime();
        const hoursPast = Math.floor((now - kickoffMs) / (1000 * 60 * 60));
        const bucket = hoursPast >= 48 ? '48h+' : hoursPast >= 24 ? '24-48h' : '12-24h';
        byHourBucket[bucket] = (byHourBucket[bucket] ?? 0) + 1;

        // 超过 24h 的单独打 warn，属于明显异常
        if (hoursPast >= 24) {
          this.logger.warn(
            `[stale-upcoming] match=${row.matchNo} league=${row.league} ` +
            `home=${row.homeTeam} away=${row.awayTeam} ` +
            `kickoff=${row.kickoffTime} source=${src} pastHours=${hoursPast}`,
          );
        }
      }
      this.logger.log(
        `[football-stale-upcoming] total=${total}, ` +
        `by_source=${JSON.stringify(bySource)}, ` +
        `by_bucket=${JSON.stringify(byHourBucket)}`,
      );
    }

    return { total, bySource, byHourBucket };
  }

  /**
   * 北单源只有赛前赔率，没有比分回传，因此 finished 但无比分是预期行为。
   * 对这类比赛统一转 score_pending，避免统计口径失真（不算入「已完赛未回打」）
   */
  async resolveFinishedNoScoreFootball(): Promise<{
    total: number;
    updated: number;
    bySource: Record<string, number>;
  }> {
    const rows = await this.db
      .select({
        id: matches.id,
        source: matches.source,
        kickoffTime: matches.kickoffTime,
      })
      .from(matches)
      .where(
        and(
          eq(matches.matchStatus, 'finished'),
          sql`(${matches.homeScore} IS NULL OR ${matches.awayScore} IS NULL)`,
          // 开赛超过 24h 仍无比分的，判定为数据源无赛果覆盖
          lt(matches.kickoffTime, sql`CURRENT_TIMESTAMP - INTERVAL '24 hours'`),
        ),
      )
      .orderBy(matches.kickoffTime);

    const total = rows.length;
    const bySource: Record<string, number> = {};
    let updated = 0;

    for (const row of rows) {
      const src = row.source ?? 'unknown';
      bySource[src] = (bySource[src] ?? 0) + 1;
      await this.db.update(matches).set({
        matchStatus: 'score_pending' as const,
        resultPendingReason: 'data_source_no_score_coverage',
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(matches.id, row.id));
      updated += 1;
    }

    this.logger.log(
      `[football-finished-no-score] total=${total}, updated=${updated}, ` +
      `by_source=${JSON.stringify(bySource)}`,
    );
    return { total, updated, bySource };
  }

  private buildBbPlayoffSeriesGames(
    h2hHistory: unknown,
    homeTeam: string,
    awayTeam: string,
  ): Array<{ totalScore: number; totalLine: number; gameNumber: number }> {
    if (!Array.isArray(h2hHistory) || !homeTeam || !awayTeam) return [];
    const allTeams = new Set<string>();
    for (const g of h2hHistory) {
      const item = g as Record<string, unknown>;
      const gh = String(item.homeTeam || '');
      const ga = String(item.awayTeam || '');
      if (gh) allTeams.add(gh);
      if (ga) allTeams.add(ga);
    }
    const isPurePair = allTeams.size <= 2;
    const games: Array<{ totalScore: number; totalLine: number; kickoffTime: Date | null }> = [];
    for (const g of h2hHistory) {
      const item = g as Record<string, unknown>;
      const gHome = String(item.homeTeam || '');
      const gAway = String(item.awayTeam || '');
      const isSamePair = isPurePair ||
        (gHome === homeTeam && gAway === awayTeam) ||
        (gHome === awayTeam && gAway === homeTeam);
      if (!isSamePair) continue;
      const hs = Number(item.homeScore);
      const as = Number(item.awayScore);
      if (!hs || !as || hs < 20 || as < 20) continue;
      const totalScore = hs + as;
      const totalLine = Number(item.totalLine) || 0;
      let kickoffTime: Date | null = null;
      const dateVal = item.date ?? item.kickoffTime;
      if (dateVal) {
        const t = new Date(dateVal as string);
        if (!isNaN(t.getTime())) kickoffTime = t;
      }
      games.push({ totalScore, totalLine, kickoffTime });
    }
    if (games.length < 2) return [];
    games.sort((a, b) => {
      if (a.kickoffTime && b.kickoffTime) return a.kickoffTime.getTime() - b.kickoffTime.getTime();
      return 0;
    });
    return games.map((g, idx) => ({ totalScore: g.totalScore, totalLine: g.totalLine, gameNumber: idx + 1 }));
  }
}
