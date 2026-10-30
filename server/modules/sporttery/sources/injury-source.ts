import { teamNameMatches } from './team-name-map';

export interface InjuryRecord {
  playerName: string;
  teamName: string;
  status: string;
  shortComment: string;
  longComment: string;
  date: string | null;
  source: 'espn-nba' | 'espn-wnba' | 'wnba-official';
}

interface EspnInjuryEntry {
  id?: string;
  longComment?: string;
  shortComment?: string;
  status?: string;
  date?: string;
  athlete?: {
    displayName?: string;
    firstName?: string;
    lastName?: string;
  };
}

interface EspnInjuryTeam {
  id?: string;
  displayName?: string;
  injuries?: EspnInjuryEntry[];
}

interface EspnInjuryResponse {
  status?: string;
  timestamp?: string;
  injuries?: EspnInjuryTeam[];
}

const ESPN_NBA_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries?limit=100';
const ESPN_WNBA_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/injuries?limit=100';
const WNBA_CDN_URL = 'https://cdn.wnba.com/static/json/staticData/injuryReport.json';
const REQUEST_TIMEOUT_MS = 10000;

export class InjurySource {
  private lastErrorMsg: string | null = null;
  private lastFetchAt: Date | null = null;
  private readonly teamInjuries = new Map<string, InjuryRecord[]>();

  isEnabled(): boolean {
    return true;
  }

  getLastError(): string | null {
    return this.lastErrorMsg;
  }

  getLastFetchAt(): Date | null {
    return this.lastFetchAt;
  }

  getTeamInjuries(teamName: string): InjuryRecord[] {
    const normalized = teamName.trim().toLowerCase();
    for (const [key, list] of this.teamInjuries.entries()) {
      if (key.toLowerCase() === normalized) return list;
    }
    return [];
  }

  findTeamInjuries(teamName: string): InjuryRecord[] {
    const direct = this.getTeamInjuries(teamName);
    if (direct.length > 0) return direct;
    for (const [key, list] of this.teamInjuries.entries()) {
      if (teamNameMatches(key, teamName)) {
        return list;
      }
    }
    return [];
  }

  getAllInjuriesCount(): number {
    let total = 0;
    for (const list of this.teamInjuries.values()) {
      total += list.length;
    }
    return total;
  }

  getTeamCount(): number {
    return this.teamInjuries.size;
  }

  async fetchAll(): Promise<InjuryRecord[]> {
    this.teamInjuries.clear();
    const allRecords: InjuryRecord[] = [];
    const errors: string[] = [];

    try {
      const nbaRecords = await this.fetchEspn(ESPN_NBA_URL, 'espn-nba');
      allRecords.push(...nbaRecords);
    } catch (err) {
      errors.push(`NBA: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const wnbaRecords = await this.fetchEspn(ESPN_WNBA_URL, 'espn-wnba');
      allRecords.push(...wnbaRecords);
    } catch (err) {
      errors.push(`WNBA: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const cdnRecords = await this.fetchWnbaCdn();
      allRecords.push(...cdnRecords);
    } catch {
    }

    for (const rec of allRecords) {
      const key = rec.teamName.trim().toLowerCase();
      const existing = this.teamInjuries.get(key) ?? [];
      const isDup = existing.some((r: InjuryRecord) =>
        r.playerName.toLowerCase() === rec.playerName.toLowerCase() && r.source === rec.source
      );
      if (!isDup) {
        existing.push(rec);
        this.teamInjuries.set(key, existing);
      }
    }

    this.lastFetchAt = new Date();
    if (errors.length > 0 && allRecords.length === 0) {
      this.lastErrorMsg = errors.join('; ');
    } else {
      this.lastErrorMsg = errors.length > 0 ? `Partial: ${errors.join('; ')}` : null;
    }

    return allRecords;
  }

  private async fetchEspn(url: string, source: 'espn-nba' | 'espn-wnba'): Promise<InjuryRecord[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as EspnInjuryResponse;
      if (data.status && data.status !== 'success') {
        throw new Error(`API status: ${data.status}`);
      }

      const records: InjuryRecord[] = [];
      const teams = data.injuries ?? [];
      for (const team of teams) {
        const teamName = team.displayName ?? '';
        if (!teamName) continue;
        const teamInjuries = team.injuries ?? [];
        for (const inj of teamInjuries) {
          const playerName = inj.athlete?.displayName
            ?? [inj.athlete?.firstName, inj.athlete?.lastName].filter(Boolean).join(' ').trim();
          if (!playerName) continue;
          records.push({
            playerName,
            teamName,
            status: inj.status ?? 'Unknown',
            shortComment: inj.shortComment ?? '',
            longComment: inj.longComment ?? '',
            date: inj.date ?? null,
            source,
          });
        }
      }
      return records;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchWnbaCdn(): Promise<InjuryRecord[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(WNBA_CDN_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const records: InjuryRecord[] = [];

      const league = (data?.league ?? data?.injuryReport) as Record<string, unknown> | undefined;
      const teamsList = (league?.team ?? league?.teams ?? []) as Array<Record<string, unknown>>;
      for (const team of teamsList) {
        const teamName = (team.teamName ?? team.displayName ?? team.name ?? '') as string;
        if (!teamName) continue;
        const players = (team.players ?? team.injuries ?? []) as Array<Record<string, unknown>>;
        for (const p of players) {
          const playerName = (p.playerName ?? p.displayName ?? p.name ?? '') as string;
          if (!playerName) continue;
          records.push({
            playerName,
            teamName,
            status: (p.status ?? p.injuryStatus ?? 'Unknown') as string,
            shortComment: (p.comment ?? p.description ?? p.notes ?? '') as string,
            longComment: '',
            date: (p.date ?? p.updated ?? null) as string | null,
            source: 'wnba-official',
          });
        }
      }
      return records;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
