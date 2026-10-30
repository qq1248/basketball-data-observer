import { Logger } from '@nestjs/common';

const logger = new Logger('TheSportsDbSource');

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json/3';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

interface TSDBSoccerEvent {
  idEvent: string;
  strEvent: string;
  strLeague: string;
  strHomeTeam: string;
  strAwayTeam: string;
  dateEvent: string;
  strTime: string;
  strTimestamp: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strStatus: string;
  strPostponed: string | null;
  idHomeTeam: string;
  idAwayTeam: string;
  strHomeTeamBadge?: string;
  strAwayTeamBadge?: string;
}

interface TSDBSoccerResponse {
  events?: TSDBSoccerEvent[] | null;
}

export interface TSDBFootballMatch {
  sourceId: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  matchStatus: 'upcoming' | 'live' | 'finished' | 'cancelled' | 'postponed';
  homeScore: number | null;
  awayScore: number | null;
  postponed: boolean;
  homeTeamId: string;
  awayTeamId: string;
}

export class TheSportsDbSource {
  private readonly apiKey = '3';

  isEnabled(): boolean {
    return true;
  }

  async fetchFootballByDate(dateStr: string): Promise<TSDBFootballMatch[]> {
    const url = `${BASE_URL}/eventsday.php?d=${dateStr}&s=Soccer`;
    logger.debug(`Fetching TSDB football for date=${dateStr}`);

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as TSDBSoccerResponse;
      if (!data.events || data.events.length === 0) {
        logger.log(`TSDB returned 0 events for date=${dateStr}`);
        return [];
      }

      const matches: TSDBFootballMatch[] = data.events.map((ev: TSDBSoccerEvent) => ({
        sourceId: ev.idEvent,
        league: ev.strLeague || '',
        homeTeam: ev.strHomeTeam || '',
        awayTeam: ev.strAwayTeam || '',
        kickoffTime: ev.strTimestamp
          ? new Date(ev.strTimestamp).toISOString()
          : this.buildIsoFromDate(ev.dateEvent, ev.strTime),
        matchStatus: this.mapStatus(ev.strStatus, ev.strPostponed),
        homeScore: ev.intHomeScore !== null && ev.intHomeScore !== ''
          ? Number(ev.intHomeScore)
          : null,
        awayScore: ev.intAwayScore !== null && ev.intAwayScore !== ''
          ? Number(ev.intAwayScore)
          : null,
        postponed: ev.strPostponed === 'yes' || ev.strPostponed === 'true',
        homeTeamId: ev.idHomeTeam || '',
        awayTeamId: ev.idAwayTeam || '',
      }));

      logger.log(`TSDB fetched ${matches.length} events for date=${dateStr}`);
      return matches;
    } catch (err) {
      logger.error(`Failed to fetch TSDB football for date=${dateStr}: ${this.errorMessage(err)}`);
      throw err;
    }
  }

  async fetchBasketballByDate(dateStr: string): Promise<TSDBFootballMatch[]> {
    const url = `${BASE_URL}/eventsday.php?d=${dateStr}&s=Basketball`;
    logger.debug(`Fetching TSDB basketball for date=${dateStr}`);

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as TSDBSoccerResponse;
      if (!data.events || data.events.length === 0) {
        logger.log(`TSDB returned 0 basketball events for date=${dateStr}`);
        return [];
      }

      const matches: TSDBFootballMatch[] = data.events.map((ev: TSDBSoccerEvent) => ({
        sourceId: ev.idEvent,
        league: ev.strLeague || '',
        homeTeam: ev.strHomeTeam || '',
        awayTeam: ev.strAwayTeam || '',
        kickoffTime: ev.strTimestamp
          ? new Date(ev.strTimestamp).toISOString()
          : this.buildIsoFromDate(ev.dateEvent, ev.strTime),
        matchStatus: this.mapStatus(ev.strStatus, ev.strPostponed),
        homeScore: ev.intHomeScore !== null && ev.intHomeScore !== ''
          ? Number(ev.intHomeScore)
          : null,
        awayScore: ev.intAwayScore !== null && ev.intAwayScore !== ''
          ? Number(ev.intAwayScore)
          : null,
        postponed: ev.strPostponed === 'yes' || ev.strPostponed === 'true',
        homeTeamId: ev.idHomeTeam || '',
        awayTeamId: ev.idAwayTeam || '',
      }));

      logger.log(`TSDB fetched ${matches.length} basketball events for date=${dateStr}`);
      return matches;
    } catch (err) {
      logger.error(`Failed to fetch TSDB basketball for date=${dateStr}: ${this.errorMessage(err)}`);
      throw err;
    }
  }

  private buildIsoFromDate(dateStr: string, timeStr: string): string {
    if (!dateStr) return new Date().toISOString();
    const time = timeStr || '00:00:00';
    return new Date(`${dateStr}T${time}Z`).toISOString();
  }

  private mapStatus(strStatus: string, postponed: string | null): TSDBFootballMatch['matchStatus'] {
    if (postponed === 'yes' || postponed === 'true') return 'postponed';
    if (!strStatus) return 'upcoming';
    const s = strStatus.toLowerCase().trim();
    if (s === 'finished' || s === 'ft' || s.includes('final')) return 'finished';
    if (s === 'cancelled' || s === 'canceled') return 'cancelled';
    if (s.includes('live') || s.includes('in play') || s === 'in progress') return 'live';
    if (s === 'postponed') return 'postponed';
    return 'upcoming';
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return String(err);
  }
}
