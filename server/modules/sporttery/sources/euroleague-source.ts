import { Logger } from '@nestjs/common';
import { teamNameMatches } from './team-name-map';

export interface EuroLeagueInjuryRecord {
  playerName: string;
  teamName: string;
  status: 'Out' | 'Questionable' | 'Available';
  injury: string;
  date: string | null;
  source: 'euroleague-official';
}

const EUROLEAGUE_INJURY_URL_TEMPLATES = [
  'https://www.euroleaguebasketball.net/en/euroleague/news/injury-report-round-{round}-fantasy/',
  'https://www.euroleaguebasketball.net/euroleague/news/injury-report-round-{round}-fantasy/',
  'https://www.euroleague.net/competition/euroleague/features?gamecode={round}&season=E2025&list=all',
];
const EUROLEAGUE_NEWS_INDEX_URLS = [
  'https://www.euroleaguebasketball.net/en/euroleague/news/',
  'https://www.euroleaguebasketball.net/euroleague/news/',
];
const REQUEST_TIMEOUT_MS = 15000;
const CURRENT_ROUND_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

function pickRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchWithRetry(
  url: string,
  retries: number = MAX_RETRIES,
): Promise<{ ok: boolean; status: number; html: string; error?: string }> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': pickRandomUserAgent(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
        redirect: 'follow',
      });
      clearTimeout(timeoutId);
      if (response.status === 429) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok) {
        return { ok: false, status: response.status, html: '', error: `HTTP ${response.status}` };
      }
      const html = await response.text();
      return { ok: true, status: response.status, html };
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt === retries - 1) {
        return {
          ok: false,
          status: 0,
          html: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return { ok: false, status: 429, html: '', error: 'HTTP 429 after retries' };
}

const EUROLEAGUE_TEAM_MAP: Record<string, string[]> = {
  'Anadolu Efes': ['埃菲斯', '伊斯坦布尔埃菲斯', 'Efes', 'Anadolu Efes'],
  'Besiktas': ['贝西克塔斯', 'Beşiktaş', 'Besiktas'],
  'Bayern Munich': ['拜仁', '拜仁慕尼黑', 'Bayern', 'Bayern Munich'],
  'Dubai': ['迪拜', 'Dubai Basketball', 'Dubai'],
  'Panathinaikos': ['帕纳辛纳科斯', '帕纳辛奈科斯', 'Panathinaikos', 'PAO'],
  'Baskonia': ['巴斯克尼亚', 'Baskonia', 'Cazoo Baskonia'],
  'Olimpia Milano': ['米兰', '米兰阿玛尼', 'Armani Milan', 'Olimpia Milano', 'Milano'],
  'Barcelona': ['巴塞罗那', '巴萨', 'Barcelona', 'Barça'],
  'Partizan': ['游击队', '贝尔格莱德游击', 'Partizan', 'Partizan Belgrade'],
  'Crvena Zvezda': ['红星', '贝尔格莱德红星', 'Crvena Zvezda', 'Red Star', 'Zvezda'],
  'Real Madrid': ['皇马', '皇家马德里', 'Real Madrid'],
  'Fenerbahce': ['费内巴切', 'Fenerbahçe', 'Fenerbahce'],
  'Olympiacos': ['奥林匹亚科斯', 'Olympiacos', 'Olympiakos'],
  'Monaco': ['摩纳哥', 'Monaco', 'AS Monaco'],
  'Maccabi': ['马卡比', '特拉维夫马卡比', 'Maccabi Tel Aviv', 'Maccabi'],
  'Valencia': ['瓦伦西亚', '巴伦西亚', 'Valencia Basket', 'Valencia'],
  'Virtus Bologna': ['博洛尼亚', '博洛尼亚维图斯', 'Virtus Bologna'],
  'Zalgiris': ['扎尔吉里斯', '萨拉基利斯', 'Žalgiris', 'Zalgiris'],
  'ASVEL': ['阿斯维尔', '里昂', 'ASVEL', 'LDLC ASVEL'],
  'Paris': ['巴黎', '巴黎篮球', 'Paris Basketball', 'Paris'],
  'ALBA Berlin': ['柏林', '阿尔巴柏林', 'ALBA Berlin', 'ALBA'],
};

export function isEuroLeagueMatch(league: string | null | undefined): boolean {
  if (!league) return false;
  const lower = league.toLowerCase();
  return lower.includes('欧篮') || lower.includes('euroleague') || lower.includes('欧洲篮球联赛');
}

export function normalizeEuroLeagueTeamName(rawName: string): string {
  const name = rawName.trim();
  for (const [canonical, aliases] of Object.entries(EUROLEAGUE_TEAM_MAP)) {
    if (name.toLowerCase() === canonical.toLowerCase()) return canonical;
    for (const alias of aliases) {
      if (name.toLowerCase() === alias.toLowerCase()) return canonical;
    }
  }
  return name;
}

export function matchEuroLeagueTeamToDb(euroleagueTeam: string, dbTeams: string[]): string | null {
  const canonical = normalizeEuroLeagueTeamName(euroleagueTeam);
  const aliases = EUROLEAGUE_TEAM_MAP[canonical] ?? [canonical];
  for (const dbTeam of dbTeams) {
    for (const alias of aliases) {
      if (teamNameMatches(dbTeam, alias)) return dbTeam;
    }
  }
  return null;
}

interface ParseResult {
  round: number;
  teams: Map<string, EuroLeagueInjuryRecord[]>;
  matchups: Array<{ home: string; away: string }>;
}

export function parseEuroLeagueInjuryHtml(html: string, round: number): ParseResult {
  const teams = new Map<string, EuroLeagueInjuryRecord[]>();
  const matchups: Array<{ home: string; away: string }> = [];
  const lines = html.split(/\r?\n/);
  let currentTeam: string | null = null;
  let currentSection: 'Out' | 'Questionable' | 'Available' | null = null;

  const isTeamHeader = (line: string): string | null => {
    const h3Match = line.match(/<h3[^>]*>\s*([^<]+?)\s*<\/h3>/i);
    if (h3Match) return h3Match[1].trim();
    const strongMatch = line.match(/<strong[^>]*>\s*([^<]+?)\s*<\/strong>/i);
    if (strongMatch && /^[A-Z]/.test(strongMatch[1].trim()) && strongMatch[1].trim().length < 40) {
      return strongMatch[1].trim();
    }
    return null;
  };

  const extractPlayersFromLi = (line: string): string | null => {
    const liMatch = line.match(/<li[^>]*>(.+?)<\/li>/i);
    if (!liMatch) return null;
    const text = liMatch[1].replace(/<[^>]+>/g, '').trim();
    return text.length > 0 ? text : null;
  };

  const parsePlayerEntry = (text: string, status: 'Out' | 'Questionable' | 'Available'): EuroLeagueInjuryRecord | null => {
    if (!text || text.length < 2) return null;
    const clean = text.replace(/\s+/g, ' ').trim();
    const parts = clean.split(/[–\-:（(]/, 2);
    const playerName = parts[0].trim().replace(/^\d+\.\s*/, '');
    const injury = parts[1]?.trim().replace(/[)）]/g, '') || '';
    if (!playerName || playerName.length < 2) return null;
    return {
      playerName,
      teamName: currentTeam ?? '',
      status,
      injury,
      date: null,
      source: 'euroleague-official',
    };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const vsMatch = line.match(/([A-Z][A-Za-zñç.\- ]+?)\s+(?:vs\.?|vs)\s+([A-Z][A-Za-zñç.\- ]+)/i);
    if (vsMatch && vsMatch[1].length > 3 && vsMatch[2].length > 3) {
      matchups.push({ home: vsMatch[1].trim(), away: vsMatch[2].trim() });
    }

    const teamHeader = isTeamHeader(line);
    if (teamHeader && teamHeader.length > 3 && teamHeader.length < 40 && !/^(Out|Questionable|Available|Injury|Status|Player|Ruled|Doubtful|Return)$/i.test(teamHeader)) {
      currentTeam = normalizeEuroLeagueTeamName(teamHeader);
      currentSection = null;
      if (!teams.has(currentTeam)) teams.set(currentTeam, []);
      continue;
    }

    if (/^(ruled out|out|will not play|not available|out indefinitely)/i.test(line)) {
      currentSection = 'Out';
      continue;
    }
    if (/^(questionable|doubtful|probable|game-time decision|gtd)/i.test(line)) {
      currentSection = 'Questionable';
      continue;
    }
    if (/^(available|return|cleared|active|in lineup)/i.test(line)) {
      currentSection = 'Available';
      continue;
    }

    if (currentTeam && currentSection && currentSection !== 'Available') {
      const playerText = extractPlayersFromLi(line);
      if (playerText) {
        const record = parsePlayerEntry(playerText, currentSection);
        if (record && record.playerName) {
          record.teamName = currentTeam;
          teams.get(currentTeam)!.push(record);
        }
      }
    }
  }

  return { round, teams, matchups };
}

export class EuroLeagueInjurySource {
  private readonly logger = new Logger(EuroLeagueInjurySource.name);
  private lastFetchAt: Date | null = null;
  private lastError: string | null = null;
  private readonly teamInjuries = new Map<string, EuroLeagueInjuryRecord[]>();
  private currentRound: number | null = null;
  private cachedCurrentRound: number | null = null;
  private currentRoundCachedAt: number = 0;

  isEnabled(): boolean {
    return true;
  }

  getCurrentRound(): number | null {
    return this.currentRound;
  }

  getLastFetchAt(): Date | null {
    return this.lastFetchAt;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getInjuriesByTeam(teamName: string): EuroLeagueInjuryRecord[] {
    const canonical = normalizeEuroLeagueTeamName(teamName);
    return this.teamInjuries.get(canonical) ?? [];
  }

  getAllTeams(): string[] {
    return Array.from(this.teamInjuries.keys());
  }

  async fetchRoundInjuries(round: number): Promise<boolean> {
    const urls = EUROLEAGUE_INJURY_URL_TEMPLATES.map((t) =>
      t.replace('{round}', String(round)),
    );
    const errors: string[] = [];
    for (const url of urls) {
      const result = await fetchWithRetry(url, MAX_RETRIES);
      if (result.ok && result.html.length > 1000) {
        const parsed = parseEuroLeagueInjuryHtml(result.html, round);
        if (parsed.teams.size > 0) {
          this.teamInjuries.clear();
          for (const [team, records] of parsed.teams) {
            this.teamInjuries.set(team, records);
          }
          this.currentRound = round;
          this.lastFetchAt = new Date();
          this.lastError = null;
          this.logger.log(
            `EuroLeague R${round} injury report fetched (${url}): ${parsed.teams.size} teams, ${Array.from(parsed.teams.values()).reduce((s, r) => s + r.length, 0)} players`,
          );
          return true;
        }
        errors.push(`${url}: parsed 0 teams`);
      } else {
        errors.push(`${url}: ${result.error ?? `HTTP ${result.status}`}`);
      }
    }
    this.lastError = `All ${urls.length} URLs failed: ${errors.join('; ')}`;
    this.logger.warn(`EuroLeague R${round} injury fetch failed: ${this.lastError}`);
    return false;
  }

  async fetchCurrentRound(): Promise<number | null> {
    const now = Date.now();
    if (this.cachedCurrentRound !== null && now - this.currentRoundCachedAt < CURRENT_ROUND_CACHE_TTL_MS) {
      return this.cachedCurrentRound;
    }
    const roundPattern = /\/injury-report-round-(\d+)-fantasy\//g;
    const allRounds: number[] = [];
    const errors: string[] = [];
    for (const url of EUROLEAGUE_NEWS_INDEX_URLS) {
      const result = await fetchWithRetry(url, MAX_RETRIES);
      if (result.ok) {
        let match: RegExpExecArray | null;
        while ((match = roundPattern.exec(result.html)) !== null) {
          const roundNum = parseInt(match[1], 10);
          if (!Number.isNaN(roundNum) && !allRounds.includes(roundNum)) {
            allRounds.push(roundNum);
          }
        }
        if (allRounds.length > 0) break;
      } else {
        errors.push(`${url}: ${result.error ?? `HTTP ${result.status}`}`);
      }
    }
    if (allRounds.length === 0) {
      this.lastError = `No injury report rounds found: ${errors.join('; ')}`;
      return null;
    }
    const highest = Math.max(...allRounds);
    this.cachedCurrentRound = highest;
    this.currentRoundCachedAt = now;
    this.lastError = null;
    this.logger.log(`EuroLeague current round detected: R${highest} (found ${allRounds.length} rounds)`);
    return highest;
  }

  buildInjuriesJson(
    homeTeamDb: string,
    awayTeamDb: string,
  ): { home: EuroLeagueInjuryRecord[]; away: EuroLeagueInjuryRecord[]; source: string } | null {
    const allDbTeams = [homeTeamDb, awayTeamDb];
    let matchedHome: string | null = null;
    let matchedAway: string | null = null;
    for (const [euTeam] of this.teamInjuries) {
      const matched = matchEuroLeagueTeamToDb(euTeam, allDbTeams);
      if (matched === homeTeamDb) matchedHome = euTeam;
      if (matched === awayTeamDb) matchedAway = euTeam;
    }
    if (!matchedHome && !matchedAway) return null;
    return {
      home: matchedHome ? this.teamInjuries.get(matchedHome)! : [],
      away: matchedAway ? this.teamInjuries.get(matchedAway)! : [],
      source: 'euroleague-official',
    };
  }
}
