/**
 * TheRundown API adapter.
 *
 * Fetches bookmaker odds from the-rundown.com and returns normalized
 * odds data using the first available bookmaker line.
 *
 * Default dormant: if the API key is empty, no requests are made and
 * all methods return empty results.
 */

// --- Normalized data type ---

export interface TheRundownOddsData {
  eventId: string;
  sportId: number;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  moneyline: {
    home: number | null;
    away: number | null;
    draw?: number | null;
  };
  spread: {
    home: number | null;
    away: number | null;
    point: number | null;
  };
  total: {
    over: number | null;
    under: number | null;
    point: number | null;
  };
  bookmaker: string;
}

// --- Internal raw response shapes (partial) ---

interface TheRundownTeam {
  name?: string;
  is_home?: boolean;
}

interface TheRundownMoneyline {
  home?: number;
  away?: number;
  draw?: number;
}

interface TheRundownSpread {
  home?: number;
  away?: number;
  point?: number;
}

interface TheRundownTotal {
  over?: number;
  under?: number;
  total?: number;
}

interface TheRundownLine {
  moneyline?: TheRundownMoneyline;
  spread?: TheRundownSpread;
  total?: TheRundownTotal;
}

interface TheRundownEvent {
  event_id?: string;
  sport_id?: number;
  teams_normalized?: TheRundownTeam[];
  event_date?: string;
  lines?: Record<string, TheRundownLine>;
}

// --- Helpers ---

function toNumberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// --- The Rundown Source ---

export class TheRundownSource {
  private apiKey: string | undefined;
  private lastErrorMsg: string | null = null;

  constructor(apiKey: string | undefined) {
    this.apiKey = apiKey;
  }

  setApiKey(apiKey: string | undefined): void {
    this.apiKey = apiKey;
    this.lastErrorMsg = null;
  }

  /**
   * Whether the source is enabled (API key configured).
   */
  isEnabled(): boolean {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0;
  }

  getLastError(): string | null {
    return this.lastErrorMsg;
  }

  /**
   * Fetch events and odds for a given sport.
   * Returns empty array if not enabled or on any error.
   */
  async fetchEvents(sportId: number): Promise<TheRundownOddsData[]> {
    if (!this.isEnabled()) return [];

    const url: string =
      `https://api.the-rundown.com/v2/events` +
      `?sport_id=${encodeURIComponent(String(sportId))}` +
      `&market_ids=1,2,3` +
      `&main_line=true`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-TheRundown-Key': this.apiKey!,
        },
      });
    } catch (err) {
      this.lastErrorMsg = err instanceof Error ? err.message : String(err);
      return [];
    }

    if (!response.ok) {
      this.lastErrorMsg = `HTTP ${response.status}: ${response.statusText}`;
      return [];
    }

    let events: TheRundownEvent[];
    try {
      const raw = await response.json();
      events = Array.isArray(raw) ? raw : raw?.events ?? [];
      if (!Array.isArray(events)) {
        this.lastErrorMsg = 'Invalid response format';
        return [];
      }
    } catch (err) {
      this.lastErrorMsg = err instanceof Error ? err.message : String(err);
      return [];
    }
    this.lastErrorMsg = null;

    const results: TheRundownOddsData[] = [];

    for (const event of events) {
      const eventId: string = event.event_id ?? '';
      const sportIdVal: number = event.sport_id ?? sportId;
      const teams: TheRundownTeam[] = event.teams_normalized ?? [];
      const homeTeam: string = teams[0]?.name ?? '';
      const awayTeam: string = teams[1]?.name ?? '';
      const commenceTime: string = event.event_date ?? '';

      if (!eventId || !homeTeam || !awayTeam) continue;

      const lines: Record<string, TheRundownLine> = event.lines ?? {};
      const bookmakerNames: string[] = Object.keys(lines);
      if (bookmakerNames.length === 0) continue;

      // Use the first available bookmaker
      const bookmaker: string = bookmakerNames[0];
      const line: TheRundownLine = lines[bookmaker];

      const ml: TheRundownMoneyline = line.moneyline ?? {};
      const sp: TheRundownSpread = line.spread ?? {};
      const tt: TheRundownTotal = line.total ?? {};

      const moneyline = {
        home: toNumberOrNull(ml.home),
        away: toNumberOrNull(ml.away),
        draw: toNumberOrNull(ml.draw),
      };

      const spread = {
        home: toNumberOrNull(sp.home),
        away: toNumberOrNull(sp.away),
        point: toNumberOrNull(sp.point),
      };

      const total = {
        over: toNumberOrNull(tt.over),
        under: toNumberOrNull(tt.under),
        point: toNumberOrNull(tt.total),
      };

      results.push({
        eventId,
        sportId: sportIdVal,
        homeTeam,
        awayTeam,
        commenceTime,
        moneyline,
        spread,
        total,
        bookmaker,
      });
    }

    return results;
  }
}
