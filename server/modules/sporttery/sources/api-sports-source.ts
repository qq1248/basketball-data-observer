/**
 * API-FOOTBALL / API-BASKETBALL (api-sports.io) adapter.
 *
 * 4th-layer fallback data source. Fetches fixtures / games by date from
 * api-sports.io and returns normalized objects. Failures return empty
 * arrays silently; daily quota is enforced in-class.
 */

// --- Normalized data types ---

export interface ApiSportsFootballFixture {
  id: number;
  date: string;
  status: string; // 'NS' | '1H' | 'HT' | '2H' | 'FT' | 'AET' | 'PEN' | 'BT' | 'SUSP' | 'INT' | 'PST' | 'CANC' | 'ABD' | 'AWD' | 'WO' | 'LIVE'
  leagueId: number;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface ApiSportsBasketballGame {
  id: number;
  date: string;
  status: string;
  leagueId: number;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
}

// --- Raw response shapes (partial, only what we consume) ---

interface ApiSportsFixtureResponse {
  fixture?: {
    id?: number;
    date?: string;
    status?: {
      short?: string;
    };
  };
  league?: {
    id?: number;
    name?: string;
  };
  teams?: {
    home?: { name?: string };
    away?: { name?: string };
  };
  score?: {
    fulltime?: {
      home?: number | null;
      away?: number | null;
    };
  };
}

interface ApiSportsGameResponse {
  game?: {
    id?: number;
    date?: {
      start?: string;
    };
    status?: {
      short?: string;
    };
  };
  league?: {
    id?: number;
    name?: string;
  };
  teams?: {
    home?: { name?: string };
    away?: { name?: string };
  };
  scores?: {
    home?: { total?: number | null };
    away?: { total?: number | null };
  };
}

interface ApiSportsEnvelope<T> {
  errors?: Record<string, unknown>;
  response?: T[];
}

const FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';
const BASKETBALL_BASE_URL = 'https://v1.basketball.api-sports.io';

const REQUEST_TIMEOUT_MS = 10000;
const DAILY_LIMIT = 500; // free tier daily quota
const LEAGUE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // same league at most once per day

export class ApiSportsSource {
  private apiKey: string;
  private dailyRequestCount = 0;
  private lastResetDate = ''; // YYYY-MM-DD (Asia/Shanghai)
  private readonly leagueLastFetch = new Map<string, number>(); // key = sport:leagueId, value = timestamp ms
  private lastErrorMsg: string | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.lastErrorMsg = null;
  }

  isEnabled(): boolean {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0;
  }

  getDailyLimit(): number {
    return DAILY_LIMIT;
  }

  getQuotaUsed(): number {
    this.ensureReset();
    return this.dailyRequestCount;
  }

  getLastError(): string | null {
    return this.lastErrorMsg;
  }

  private getBeijingTodayStr(): string {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(new Date());
  }

  private ensureReset(): void {
    const today = this.getBeijingTodayStr();
    if (today !== this.lastResetDate) {
      this.lastResetDate = today;
      this.dailyRequestCount = 0;
      // prune old league entries (older than 24h)
      const cutoff = Date.now() - LEAGUE_COOLDOWN_MS;
      for (const [key, ts] of this.leagueLastFetch.entries()) {
        if (ts < cutoff) {
          this.leagueLastFetch.delete(key);
        }
      }
    }
  }

  private canMakeRequest(): boolean {
    if (!this.isEnabled()) return false;
    this.ensureReset();
    return this.dailyRequestCount < DAILY_LIMIT;
  }

  private incrementRequest(): void {
    this.ensureReset();
    this.dailyRequestCount += 1;
  }

  private isLeagueCooledDown(sport: 'football' | 'basketball', leagueId: number): boolean {
    const key = `${sport}:${leagueId}`;
    const last = this.leagueLastFetch.get(key);
    if (!last) return true;
    return Date.now() - last >= LEAGUE_COOLDOWN_MS;
  }

  private markLeagueFetched(sport: 'football' | 'basketball', leagueId: number): void {
    const key = `${sport}:${leagueId}`;
    this.leagueLastFetch.set(key, Date.now());
  }

  /**
   * Fetch football fixtures for a given date (YYYY-MM-DD).
   * Returns empty array on any failure or when quota is exhausted.
   */
  async getFixturesByDate(date: string): Promise<ApiSportsFootballFixture[]> {
    if (!this.canMakeRequest()) return [];

    try {
      const url = `${FOOTBALL_BASE_URL}/fixtures?date=${encodeURIComponent(date)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-apisports-key': this.apiKey,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this.incrementRequest();

      if (!response.ok) {
        this.lastErrorMsg = `HTTP ${response.status}: ${response.statusText}`;
        return [];
      }

      const data = (await response.json()) as ApiSportsEnvelope<ApiSportsFixtureResponse>;
      if (!data || !Array.isArray(data.response)) {
        this.lastErrorMsg = 'Invalid response format';
        return [];
      }
      if (data.errors && Object.keys(data.errors).length > 0) {
        const errMsg = typeof data.errors === 'object'
          ? Object.entries(data.errors).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')
          : String(data.errors);
        this.lastErrorMsg = `API error: ${errMsg}`;
        return [];
      }
      this.lastErrorMsg = null;

      const results: ApiSportsFootballFixture[] = [];
      for (const item of data.response) {
        const fixtureId = item.fixture?.id;
        const fixtureDate = item.fixture?.date;
        const statusShort = item.fixture?.status?.short;
        const leagueId = item.league?.id;
        const leagueName = item.league?.name;
        const homeName = item.teams?.home?.name;
        const awayName = item.teams?.away?.name;

        if (
          fixtureId === undefined ||
          !fixtureDate ||
          !statusShort ||
          leagueId === undefined ||
          !leagueName ||
          !homeName ||
          !awayName
        ) {
          continue;
        }

        const homeScoreRaw = item.score?.fulltime?.home;
        const awayScoreRaw = item.score?.fulltime?.away;
        const homeScore =
          homeScoreRaw === undefined || homeScoreRaw === null ? null : Number(homeScoreRaw);
        const awayScore =
          awayScoreRaw === undefined || awayScoreRaw === null ? null : Number(awayScoreRaw);

        results.push({
          id: fixtureId,
          date: fixtureDate,
          status: statusShort,
          leagueId,
          leagueName,
          homeTeam: homeName,
          awayTeam: awayName,
          homeScore: Number.isFinite(homeScore) ? homeScore : null,
          awayScore: Number.isFinite(awayScore) ? awayScore : null,
        });
      }

      return results;
    } catch (err) {
      this.lastErrorMsg = err instanceof Error ? err.message : String(err);
      return [];
    }
  }

  /**
   * Fetch basketball games for a given date (YYYY-MM-DD).
   * Returns empty array on any failure or when quota is exhausted.
   */
  async getGamesByDate(date: string): Promise<ApiSportsBasketballGame[]> {
    if (!this.canMakeRequest()) return [];

    try {
      const url = `${BASKETBALL_BASE_URL}/games?date=${encodeURIComponent(date)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-apisports-key': this.apiKey,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this.incrementRequest();

      if (!response.ok) {
        this.lastErrorMsg = `HTTP ${response.status}: ${response.statusText}`;
        return [];
      }

      const data = (await response.json()) as ApiSportsEnvelope<ApiSportsGameResponse>;
      if (!data || !Array.isArray(data.response)) {
        this.lastErrorMsg = 'Invalid response format';
        return [];
      }
      if (data.errors && Object.keys(data.errors).length > 0) {
        const errMsg = typeof data.errors === 'object'
          ? Object.entries(data.errors).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')
          : String(data.errors);
        this.lastErrorMsg = `API error: ${errMsg}`;
        return [];
      }
      this.lastErrorMsg = null;

      const results: ApiSportsBasketballGame[] = [];
      for (const item of data.response) {
        const gameId = item.game?.id;
        const gameDate = item.game?.date?.start;
        const statusShort = item.game?.status?.short;
        const leagueId = item.league?.id;
        const leagueName = item.league?.name;
        const homeName = item.teams?.home?.name;
        const awayName = item.teams?.away?.name;

        if (
          gameId === undefined ||
          !gameDate ||
          !statusShort ||
          leagueId === undefined ||
          !leagueName ||
          !homeName ||
          !awayName
        ) {
          continue;
        }

        const homeScoreRaw = item.scores?.home?.total;
        const awayScoreRaw = item.scores?.away?.total;
        const homeScore =
          homeScoreRaw === undefined || homeScoreRaw === null ? null : Number(homeScoreRaw);
        const awayScore =
          awayScoreRaw === undefined || awayScoreRaw === null ? null : Number(awayScoreRaw);

        results.push({
          id: gameId,
          date: gameDate,
          status: statusShort,
          leagueId,
          leagueName,
          homeTeam: homeName,
          awayTeam: awayName,
          homeScore: Number.isFinite(homeScore) ? homeScore : null,
          awayScore: Number.isFinite(awayScore) ? awayScore : null,
        });
      }

      return results;
    } catch (err) {
      this.lastErrorMsg = err instanceof Error ? err.message : String(err);
      return [];
    }
  }
}
