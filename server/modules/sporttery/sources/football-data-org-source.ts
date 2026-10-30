export interface FdoCompetition {
  id: number;
  name: string;
  code: string;
  type: string;
  emblem?: string;
  currentSeason?: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday: number;
  };
}

export interface FdoTeam {
  id: number;
  name: string;
  shortName?: string;
  tla?: string;
  crest?: string;
}

export interface FdoMatch {
  id: number;
  competition: { id: number; name: string; code: string };
  season: { id: number; startDate: string; endDate: string; currentMatchday?: number };
  utcDate: string;
  status: string;
  matchday: number | null;
  stage: string;
  group: string | null;
  homeTeam: { id: number; name: string; shortName?: string; tla?: string; crest?: string };
  awayTeam: { id: number; name: string; shortName?: string; tla?: string; crest?: string };
  score: {
    winner: string | null;
    duration: string;
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
  };
  odds?: { msg?: string };
  lastUpdated: string;
}

interface FdoMatchesResponse {
  count: number;
  filters: Record<string, unknown>;
  matches: FdoMatch[];
}

interface FdoCompetitionsResponse {
  count: number;
  competitions: FdoCompetition[];
}

interface FdoErrorResponse {
  errorCode?: number;
  message?: string;
}

const BASE_URL = 'https://api.football-data.org/v4';
const REQUEST_TIMEOUT_MS = 15000;

const DEFAULT_COMPETITIONS = [
  { code: 'PL', name: '英超' },
  { code: 'BL1', name: '德甲' },
  { code: 'SA', name: '意甲' },
  { code: 'PD', name: '西甲' },
  { code: 'FL1', name: '法甲' },
  { code: 'EC', name: '欧洲杯' },
  { code: 'CL', name: '欧冠' },
  { code: 'ELC', name: '英冠' },
];

export class FootballDataOrgSource {
  private apiKey: string | undefined;
  private lastErrorMsg: string | null = null;
  private requestCount = 0;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  setApiKey(apiKey: string | undefined): void {
    this.apiKey = apiKey;
    this.lastErrorMsg = null;
    this.requestCount = 0;
  }

  isEnabled(): boolean {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0;
  }

  getLastError(): string | null {
    return this.lastErrorMsg;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  async listCompetitions(): Promise<FdoCompetition[]> {
    const data = await this.request<FdoCompetitionsResponse>('/competitions');
    return data.competitions ?? [];
  }

  async getMatchesForCompetition(competitionCode: string, dateFrom?: string, dateTo?: string): Promise<FdoMatch[]> {
    let path = `/competitions/${encodeURIComponent(competitionCode)}/matches`;
    const params: string[] = [];
    if (dateFrom) params.push(`dateFrom=${encodeURIComponent(dateFrom)}`);
    if (dateTo) params.push(`dateTo=${encodeURIComponent(dateTo)}`);
    if (params.length > 0) path += `?${params.join('&')}`;
    const data = await this.request<FdoMatchesResponse>(path);
    return data.matches ?? [];
  }

  async getMatchesForTeam(teamId: number, limit = 10): Promise<FdoMatch[]> {
    const path = `/teams/${teamId}/matches?limit=${limit}`;
    const data = await this.request<FdoMatchesResponse>(path);
    return data.matches ?? [];
  }

  private async request<T>(path: string): Promise<T> {
    if (!this.isEnabled()) {
      throw new Error('football-data.org API key not configured');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method: 'GET',
        headers: {
          'X-Auth-Token': this.apiKey!,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      this.requestCount += 1;

      const data = (await response.json()) as T | FdoErrorResponse;

      if (!response.ok) {
        const errData = data as FdoErrorResponse;
        const msg = errData.message ?? `HTTP ${response.status}: ${response.statusText}`;
        this.lastErrorMsg = msg;
        throw new Error(msg);
      }

      this.lastErrorMsg = null;
      return data as T;
    } catch (err) {
      if (!this.lastErrorMsg) {
        this.lastErrorMsg = err instanceof Error ? err.message : String(err);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const FDO_DEFAULT_COMPETITIONS = DEFAULT_COMPETITIONS;
