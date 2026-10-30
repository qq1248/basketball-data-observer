/**
 * NBL (Australia) official source adapter.
 *
 * Fetches live scores and match status from the official NBL schedule BFF
 * (schedule.nbl.com.au), which wraps the Rosetta live data service.
 *
 * Used as the primary live-score source for Australian NBL matches,
 * with qiumibao as a fallback when the official source is unavailable.
 */

import { Logger } from '@nestjs/common';

const NBL_SCHEDULE_BASE = 'https://schedule.nbl.com.au/api/calendar';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface NblLiveMatch {
  id: string;
  slug: string;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamCode: string;
  awayTeamCode: string;
  homeScore: number | null;
  awayScore: number | null;
  phase: 'upcoming' | 'live' | 'complete';
  statusRaw: string;
  displayClock: string;
  matchStatusString: string;
  currentPeriod: number | null;
  clock: string | null;
  startsAtMs: number;
}

interface NblScheduleLiveResponse {
  league: string;
  matches: Array<Record<string, unknown>>;
  updated_at: string;
}

interface NblMatchDetailResponse {
  match?: {
    id: string;
    home_score?: number;
    away_score?: number;
    match_status?: string;
    status?: string;
    display_clock?: string;
    match_status_string?: string;
    current_period?: number;
    clock?: string;
    clock_running?: boolean;
    start_time?: string;
    home_team?: { name?: string; team_code?: string };
    away_team?: { name?: string; team_code?: string };
    match_slug?: string;
  };
}

const logger = new Logger('NblOfficialSource');

export class NblOfficialSource {
  async fetchLiveMatches(): Promise<{
    matches: NblLiveMatch[];
    updatedAt: string;
  }> {
    const liveUrl = `${NBL_SCHEDULE_BASE}/schedule-live?league=NBL`;
    const liveResponse = await fetch(liveUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!liveResponse.ok) {
      throw new Error(
        `NBL official schedule-live failed: ${liveResponse.status} ${liveResponse.statusText}`,
      );
    }

    const liveData = (await liveResponse.json()) as NblScheduleLiveResponse;
    const liveIds: string[] = [];
    for (const raw of liveData.matches) {
      const id = String((raw as Record<string, unknown>).id ?? '');
      if (id) liveIds.push(id);
    }

    if (liveIds.length === 0) {
      return { matches: [], updatedAt: liveData.updated_at ?? new Date().toISOString() };
    }

    const matches: NblLiveMatch[] = [];
    for (const id of liveIds) {
      try {
        const detail = await this.fetchMatchDetail(id);
        if (detail) {
          matches.push(detail);
        } else {
          logger.warn(`match detail returned null for id=${id}`);
        }
      } catch (detailErr) {
        logger.warn(`match detail fetch error for id=${id}: ${detailErr instanceof Error ? detailErr.message : String(detailErr)}`);
        continue;
      }
    }

    return {
      matches,
      updatedAt: liveData.updated_at ?? new Date().toISOString(),
    };
  }

  async fetchMatchDetail(matchId: string): Promise<NblLiveMatch | null> {
    const url = `${NBL_SCHEDULE_BASE}/match?match=${encodeURIComponent(matchId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(
        `NBL official match detail failed: ${response.status} ${response.statusText} (id=${matchId})`,
      );
    }

    const data = (await response.json()) as NblMatchDetailResponse;
    if (!data.match) return null;
    return this.normalizeDetailMatch(data.match);
  }

  async fetchSeasonSchedule(year: number): Promise<NblLiveMatch[]> {
    const url = `${NBL_SCHEDULE_BASE}/schedule?league=NBL&limit=300&offset=0&year=${year}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `NBL official schedule failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as NblScheduleLiveResponse;
    const matches: NblLiveMatch[] = [];
    for (const raw of data.matches) {
      const match = this.normalizeLiveMatch(raw as Record<string, unknown>);
      if (match) matches.push(match);
    }
    return matches;
  }

  private normalizeLiveMatch(raw: Record<string, unknown>): NblLiveMatch | null {
    const id = String(raw.id ?? '');
    if (!id) return null;

    const homeTeam = raw.home_team as Record<string, unknown> | undefined;
    const awayTeam = raw.away_team as Record<string, unknown> | undefined;
    const home = raw.home as Record<string, unknown> | undefined;
    const away = raw.away as Record<string, unknown> | undefined;

    const homeTeamName =
      (homeTeam?.name as string) ?? (home?.name as string) ?? '';
    const awayTeamName =
      (awayTeam?.name as string) ?? (away?.name as string) ?? '';
    const homeTeamCode =
      (homeTeam?.team_code as string) ?? (home?.team_code as string) ?? '';
    const awayTeamCode =
      (awayTeam?.team_code as string) ?? (away?.team_code as string) ?? '';

    const phaseRaw = String(raw.phase ?? raw.phase_type ?? 'upcoming');
    let phase: NblLiveMatch['phase'] = 'upcoming';
    if (phaseRaw === 'live' || phaseRaw === 'in_progress') phase = 'live';
    else if (phaseRaw === 'complete' || phaseRaw === 'completed' || phaseRaw === 'CONFIRMED') phase = 'complete';

    const homeScore =
      raw.home_score != null && raw.home_score !== ''
        ? Number(raw.home_score)
        : null;
    const awayScore =
      raw.away_score != null && raw.away_score !== ''
        ? Number(raw.away_score)
        : null;

    const displayClock = String(raw.display_clock ?? raw.match_status_string ?? '');
    const matchStatusString = String(raw.match_status_string ?? '');
    const statusRaw = String(raw.status_raw ?? raw.status ?? '');

    let currentPeriod: number | null = null;
    if (typeof raw.current_period === 'number') {
      currentPeriod = raw.current_period;
    } else if (displayClock) {
      const qMatch = displayClock.match(/Q(\d+)/);
      if (qMatch) currentPeriod = parseInt(qMatch[1], 10);
    }

    const clock =
      typeof raw.clock === 'string'
        ? raw.clock
        : this.extractClockFromDisplay(displayClock);

    const startsAtMs =
      typeof raw.starts_at_ms === 'number'
        ? raw.starts_at_ms
        : raw.start_time
          ? new Date(String(raw.start_time)).getTime()
          : 0;

    return {
      id,
      slug: String(raw.match_slug ?? raw.slug ?? id),
      homeTeamName,
      awayTeamName,
      homeTeamCode,
      awayTeamCode,
      homeScore: Number.isFinite(homeScore as number) ? (homeScore as number) : null,
      awayScore: Number.isFinite(awayScore as number) ? (awayScore as number) : null,
      phase,
      statusRaw,
      displayClock,
      matchStatusString,
      currentPeriod,
      clock,
      startsAtMs,
    };
  }

  private normalizeDetailMatch(match: NonNullable<NblMatchDetailResponse['match']>): NblLiveMatch | null {
    if (!match.id) return null;

    const matchStatus = match.match_status ?? '';
    const status = match.status ?? '';
    let phase: NblLiveMatch['phase'] = 'upcoming';
    if (matchStatus === 'live' || matchStatus === 'in_progress' || status === 'IN_PROGRESS') {
      phase = 'live';
    } else if (matchStatus === 'complete' || matchStatus === 'completed' || status === 'CONFIRMED') {
      phase = 'complete';
    }

    const startTime = match.start_time ?? '';
    const startsAtMs = startTime ? new Date(startTime).getTime() : 0;

    const displayClock = match.display_clock ?? match.match_status_string ?? '';
    const clockStr = match.clock ?? '';
    let currentPeriod: number | null = null;
    if (typeof match.current_period === 'number') {
      currentPeriod = match.current_period;
    } else if (displayClock) {
      const qMatch = displayClock.match(/Q(\d+)/);
      if (qMatch) currentPeriod = parseInt(qMatch[1], 10);
    }

    const clockParts = clockStr.split(':');
    let clockMmSs: string | null = null;
    if (clockParts.length >= 2) {
      clockMmSs = `${clockParts[clockParts.length - 2]}:${clockParts[clockParts.length - 1]}`;
    }

    return {
      id: match.id,
      slug: match.match_slug ?? match.id,
      homeTeamName: match.home_team?.name ?? '',
      awayTeamName: match.away_team?.name ?? '',
      homeTeamCode: match.home_team?.team_code ?? '',
      awayTeamCode: match.away_team?.team_code ?? '',
      homeScore: match.home_score ?? null,
      awayScore: match.away_score ?? null,
      phase,
      statusRaw: status,
      displayClock: clockMmSs ?? match.match_status_string ?? '',
      matchStatusString: match.match_status_string ?? '',
      currentPeriod,
      clock: clockMmSs,
      startsAtMs,
    };
  }

  private extractClockFromDisplay(display: string): string | null {
    if (!display) return null;
    const m = display.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const min = m[1].padStart(2, '0');
    return `00:${min}:${m[2]}`;
  }
}
