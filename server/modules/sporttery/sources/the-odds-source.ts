/**
 * The Odds API adapter (new API: api.theoddsapi.com).
 *
 * Fetches bookmaker odds from the-oddsapi.com and returns normalized
 * odds data with median values across all available bookmakers.
 *
 * API v2 format:
 * - Base URL: https://api.theoddsapi.com
 * - Auth: x-api-key header (or ?x-api-key= query param)
 * - Response: { success, source, data: [{ event_id, sport, league,
 *     home_team, away_team, start_time, books: [{ book, market,
 *     updated_at, outcomes: [{ name, price, point? }] }] }] }
 * - Rate limit headers: x-ratelimit-limit / x-ratelimit-remaining / x-ratelimit-used
 * - Free tier: only h2h market returned; spreads/totals excluded
 *   (x-plan-excluded-markets header)
 */

// --- Normalized data type ---

export interface OddsResponse {
  data: OddsData[];
  remaining: number | null;
  used: number | null;
  statusCode: number;
  errorMessage?: string;
  excludedMarkets?: string[];
}

export interface OddsData {
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  h2h: {
    home: number | null;
    away: number | null;
    draw?: number | null;
  };
  spreads: {
    home: number | null;
    away: number | null;
    point: number | null;
  };
  totals: {
    over: number | null;
    under: number | null;
    point: number | null;
  };
  bookmakerCount: number;
}

// --- Internal raw response shapes ---

interface TheOddsOutcome {
  name: string;
  price?: number;
  point?: number;
}

interface TheOddsBook {
  book?: string;
  market?: string;
  updated_at?: string;
  outcomes?: TheOddsOutcome[];
}

interface TheOddsGame {
  event_id?: string;
  sport?: string;
  league?: string;
  home_team?: string;
  away_team?: string;
  start_time?: string;
  books?: TheOddsBook[];
}

interface TheOddsApiResponse {
  success?: boolean;
  source?: string;
  data?: TheOddsGame[];
}

// --- Helpers ---

/**
 * Compute the median of an array of numbers.
 * Ignores null/undefined values. Returns null if no valid numbers.
 */
function median(values: Array<number | null | undefined>): number | null {
  const valid: number[] = values.filter(
    (v: number | null | undefined): v is number =>
      typeof v === 'number' && Number.isFinite(v),
  );
  if (valid.length === 0) return null;
  const sorted: number[] = [...valid].sort((a: number, b: number) => a - b);
  const mid: number = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Convert American odds to decimal.
 * American: +150 means risk 100 to win 150 (decimal 2.5)
 *           -110 means risk 110 to win 100 (decimal 1.909)
 */
function americanToDecimal(price: number): number {
  if (price > 0) {
    return price / 100 + 1;
  }
  return 100 / Math.abs(price) + 1;
}

/**
 * Find an outcome by name within a book's market.
 */
function findOutcome(
  outcomes: TheOddsOutcome[] | undefined,
  name: string,
): TheOddsOutcome | undefined {
  return outcomes?.find((o: TheOddsOutcome) => o.name === name);
}

// --- The Odds Source ---

export class TheOddsSource {
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://api.theoddsapi.com';

  constructor(apiKey: string | undefined) {
    this.apiKey = apiKey;
  }

  /**
   * Whether the source is enabled (API key configured).
   */
  isEnabled(): boolean {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0;
  }

  /**
   * Validate API key via /me/ endpoint.
   */
  async validateKey(): Promise<{
    valid: boolean;
    tier?: string;
    remaining?: number;
    dailyLimit?: number;
    requestsToday?: number;
    statusCode: number;
    errorMessage?: string;
  }> {
    if (!this.isEnabled()) {
      return { valid: false, statusCode: 0, errorMessage: 'no key' };
    }
    const url = `${this.baseUrl}/me/`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey!,
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        return {
          valid: false,
          statusCode: response.status,
          errorMessage: `${response.status} ${response.statusText}`,
        };
      }
      const body = (await response.json()) as {
        success?: boolean;
        data?: {
          tier?: string;
          remaining?: number;
          daily_limit?: number;
          requests_today?: number;
        };
      };
      return {
        valid: body.success === true,
        tier: body.data?.tier,
        remaining: body.data?.remaining,
        dailyLimit: body.data?.daily_limit,
        requestsToday: body.data?.requests_today,
        statusCode: response.status,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, statusCode: 0, errorMessage: message };
    }
  }

  /**
   * Fetch available sports list.
   */
  async fetchSports(): Promise<{
    sports: Array<{ key: string; sport: string; league: string }>;
    remaining: number | null;
    statusCode: number;
    errorMessage?: string;
  }> {
    if (!this.isEnabled()) {
      return { sports: [], remaining: null, statusCode: 0 };
    }
    const url = `${this.baseUrl}/sports/`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey!,
          Accept: 'application/json',
        },
      });
      const remainingRaw = response.headers.get('x-ratelimit-remaining');
      const remaining = remainingRaw ? Number(remainingRaw) : null;

      if (!response.ok) {
        return {
          sports: [],
          remaining,
          statusCode: response.status,
          errorMessage: `${response.status} ${response.statusText}`,
        };
      }
      const body = (await response.json()) as TheOddsApiResponse;
      const sports = (body.data ?? []).map((g: TheOddsGame) => ({
        key: g.event_id ?? '',
        sport: g.sport ?? '',
        league: g.league ?? '',
      }));
      return { sports, remaining, statusCode: response.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { sports: [], remaining: null, statusCode: 0, errorMessage: message };
    }
  }

  /**
   * Fetch basketball odds.
   * @param sportKey - e.g. 'basketball_nba'
   */
  async fetchBasketballOdds(sportKey: string): Promise<OddsResponse> {
    if (!this.isEnabled())
      return { data: [], remaining: null, used: null, statusCode: 0 };
    return this.fetchOdds(sportKey, 'us');
  }

  /**
   * Fetch football (soccer) odds.
   * @param sportKey - e.g. 'soccer_epl'
   */
  async fetchFootballOdds(sportKey: string): Promise<OddsResponse> {
    if (!this.isEnabled())
      return { data: [], remaining: null, used: null, statusCode: 0 };
    return this.fetchOdds(sportKey, 'eu');
  }

  // --- Internal ---

  private async fetchOdds(
    sportKey: string,
    regions: string,
  ): Promise<OddsResponse> {
    const markets = 'h2h,spreads,totals';
    const url =
      `${this.baseUrl}/odds/` +
      `?sport_key=${encodeURIComponent(sportKey)}` +
      `&markets=${markets}` +
      `&regions=${encodeURIComponent(regions)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey!,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      const message: string =
        err instanceof Error ? err.message : String(err);
      return {
        data: [],
        remaining: null,
        used: null,
        statusCode: 0,
        errorMessage: message,
      };
    }

    // Read quota headers
    const remainingRaw = response.headers.get('x-ratelimit-remaining');
    const usedRaw = response.headers.get('x-ratelimit-used');
    const excludedRaw = response.headers.get('x-plan-excluded-markets');
    const remaining: number | null = remainingRaw !== null && remainingRaw !== ''
      ? Number(remainingRaw)
      : null;
    const used: number | null = usedRaw !== null && usedRaw !== ''
      ? Number(usedRaw)
      : null;
    const excludedMarkets: string[] = excludedRaw
      ? excludedRaw.split(',').map((s) => s.trim())
      : [];

    if (!response.ok) {
      const statusCode: number = response.status;
      return {
        data: [],
        remaining,
        used,
        statusCode,
        excludedMarkets,
        errorMessage: `${statusCode} ${response.statusText}`,
      };
    }

    const body = (await response.json()) as TheOddsApiResponse;
    const games: TheOddsGame[] = body.data ?? [];

    const results: OddsData[] = [];

    for (const game of games) {
      const books: TheOddsBook[] = game.books ?? [];

      // Group books by book key for counting unique bookmakers
      const uniqueBookmakers = new Set<string>();

      // Collect values across all bookmakers
      const h2hHomePrices: number[] = [];
      const h2hAwayPrices: number[] = [];
      const h2hDrawPrices: number[] = [];

      const spreadHomePrices: number[] = [];
      const spreadAwayPrices: number[] = [];
      const spreadHomePoints: number[] = [];
      const spreadAwayPoints: number[] = [];

      const totalOverPrices: number[] = [];
      const totalUnderPrices: number[] = [];
      const totalPoints: number[] = [];

      for (const book of books) {
        if (book.book) uniqueBookmakers.add(book.book);
        const outcomes = book.outcomes ?? [];
        const market = book.market;

        if (market === 'h2h') {
          // Outcomes are team names or "Draw"
          const homeOutcome = findOutcome(outcomes, game.home_team ?? '');
          const awayOutcome = findOutcome(outcomes, game.away_team ?? '');
          const drawOutcome = findOutcome(outcomes, 'Draw');

          if (typeof homeOutcome?.price === 'number')
            h2hHomePrices.push(americanToDecimal(homeOutcome.price));
          if (typeof awayOutcome?.price === 'number')
            h2hAwayPrices.push(americanToDecimal(awayOutcome.price));
          if (typeof drawOutcome?.price === 'number')
            h2hDrawPrices.push(americanToDecimal(drawOutcome.price));
        } else if (market === 'spreads') {
          const homeOutcome = findOutcome(outcomes, game.home_team ?? '');
          const awayOutcome = findOutcome(outcomes, game.away_team ?? '');

          if (typeof homeOutcome?.price === 'number')
            spreadHomePrices.push(americanToDecimal(homeOutcome.price));
          if (typeof awayOutcome?.price === 'number')
            spreadAwayPrices.push(americanToDecimal(awayOutcome.price));
          if (typeof homeOutcome?.point === 'number')
            spreadHomePoints.push(homeOutcome.point);
          if (typeof awayOutcome?.point === 'number')
            spreadAwayPoints.push(awayOutcome.point);
        } else if (market === 'totals') {
          const overOutcome = findOutcome(outcomes, 'Over');
          const underOutcome = findOutcome(outcomes, 'Under');

          if (typeof overOutcome?.price === 'number')
            totalOverPrices.push(americanToDecimal(overOutcome.price));
          if (typeof underOutcome?.price === 'number')
            totalUnderPrices.push(americanToDecimal(underOutcome.price));
          if (typeof overOutcome?.point === 'number')
            totalPoints.push(overOutcome.point);
          if (typeof underOutcome?.point === 'number')
            totalPoints.push(underOutcome.point);
        }
      }

      const h2hHome: number | null = median(h2hHomePrices);
      const h2hAway: number | null = median(h2hAwayPrices);
      const h2hDraw: number | null =
        h2hDrawPrices.length > 0 ? median(h2hDrawPrices) : null;

      const spreadHomeOdds: number | null = median(spreadHomePrices);
      const spreadAwayOdds: number | null = median(spreadAwayPrices);
      const spreadPoint: number | null =
        spreadHomePoints.length > 0
          ? median(spreadHomePoints)
          : median(spreadAwayPoints);

      const totalOverOdds: number | null = median(totalOverPrices);
      const totalUnderOdds: number | null = median(totalUnderPrices);
      const totalPoint: number | null = median(totalPoints);

      results.push({
        sportKey: sportKey,
        homeTeam: game.home_team ?? '',
        awayTeam: game.away_team ?? '',
        commenceTime: game.start_time ?? '',
        h2h: {
          home: h2hHome,
          away: h2hAway,
          draw: h2hDraw,
        },
        spreads: {
          home: spreadHomeOdds,
          away: spreadAwayOdds,
          point: spreadPoint,
        },
        totals: {
          over: totalOverOdds,
          under: totalUnderOdds,
          point: totalPoint,
        },
        bookmakerCount: uniqueBookmakers.size,
      });
    }

    return {
      data: results,
      remaining,
      used,
      statusCode: response.status,
      excludedMarkets,
    };
  }
}
