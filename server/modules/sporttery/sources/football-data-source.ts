/**
 * Football-data.co.uk CSV data source.
 * URL pattern: https://www.football-data.co.uk/mmz4281/{seasonCode}/{div}.csv
 * Free, no registration / API key required.
 */

export interface FootballDataMatch {
  div: string;
  date: string;
  time: string | null;
  homeTeam: string;
  awayTeam: string;
  fthg: number | null;
  ftag: number | null;
  ftr: string | null;
  avgH: number | null; avgD: number | null; avgA: number | null;
  ahHandicap: number | null;
  b365AhH: number | null; b365AhA: number | null;
  avgAhH: number | null; avgAhA: number | null;
  maxAhH: number | null; maxAhA: number | null;
  avgOver25: number | null; avgUnder25: number | null;
  b365H: number | null; b365D: number | null; b365A: number | null;
  psH: number | null; psD: number | null; psA: number | null;
  avgCH: number | null; avgCD: number | null; avgCA: number | null;
  maxCH: number | null; maxCD: number | null; maxCA: number | null;
}

// ESPN-style league code -> football-data division code

export const FOOTBALL_DATA_DIVISIONS: Record<string, { name: string; div: string }> = {
  'eng.1': { name: '英超', div: 'E0' },
  'eng.2': { name: '英冠', div: 'E1' },
  'esp.1': { name: '西甲', div: 'SP1' },
  'ger.1': { name: '德甲', div: 'D1' },
  'ita.1': { name: '意甲', div: 'I1' },
  'fra.1': { name: '法甲', div: 'F1' },
  'ned.1': { name: '荷甲', div: 'N1' },
  'por.1': { name: '葡超', div: 'P1' },
  'bel.1': { name: '比甲', div: 'B1' },
  'tur.1': { name: '土超', div: 'T1' },
};

const USER_AGENT: string =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BASE_URL: string = 'https://www.football-data.co.uk/mmz4281';

// CSV column name -> FootballDataMatch field mapping
const COLUMN_MAP: Record<keyof FootballDataMatch, string> = {
  div: 'Div',
  date: 'Date',
  time: 'Time',
  homeTeam: 'HomeTeam',
  awayTeam: 'AwayTeam',
  fthg: 'FTHG',
  ftag: 'FTAG',
  ftr: 'FTR',
  b365H: 'B365H',
  b365D: 'B365D',
  b365A: 'B365A',
  psH: 'PSH',
  psD: 'PSD',
  psA: 'PSA',
  avgH: 'AvgH',
  avgD: 'AvgD',
  avgA: 'AvgA',
  ahHandicap: 'AHh',
  b365AhH: 'B365AHH',
  b365AhA: 'B365AHA',
  avgAhH: 'AvgAHH',
  avgAhA: 'AvgAHA',
  maxAhH: 'MaxAHH',
  maxAhA: 'MaxAHA',
  avgOver25: 'Avg>2.5',
  avgUnder25: 'Avg<2.5',
  avgCH: 'AvgCH',
  avgCD: 'AvgCD',
  avgCA: 'AvgCA',
  maxCH: 'MaxCH',
  maxCD: 'MaxCD',
  maxCA: 'MaxCA',
};

function parseNum(val: string): number | null {
  if (val === undefined || val === null || val === '') return null;
  const num: number = Number(val);
  return Number.isNaN(num) ? null : num;
}

function parseDateDDMMYYYY(val: string): string {
  // dd/mm/yyyy -> yyyy-mm-dd
  const parts: string[] = val.split('/');
  if (parts.length !== 3) return val;
  const [dd, mm, yyyy]: string[] = parts;
  // Handle 2-digit year (e.g. 26 -> 2026)
  const fullYear: string = yyyy.length === 2 ? `20${yyyy}` : yyyy;
  return `${fullYear}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// Minimal CSV line parser respecting double-quoted fields.
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current: string = '';
  let inQuotes: boolean = false;

  for (let i: number = 0; i < line.length; i += 1) {
    const char: string = line[i];
    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ("")
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export class FootballDataSource {
  private readonly seasonCode: string;

  constructor(seasonCode: string = '2627') {
    this.seasonCode = seasonCode;
  }

  isEnabled(): boolean {
    return true;
  }

  private buildUrl(div: string): string {
    return `${BASE_URL}/${this.seasonCode}/${div}.csv`;
  }

  /** Fetch and parse matches for a single division; empty array on error. */
  async fetchDivision(div: string): Promise<FootballDataMatch[]> {
    try {
      const url: string = this.buildUrl(div);
      const response: Response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/csv,text/plain,*/*',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        return [];
      }

      const text: string = await response.text();
      return this.parseCsv(text);
    } catch {
      return [];
    }
  }

  /** Fetch all configured divisions concurrently; individual failures are silent. */
  async fetchAllDivisions(): Promise<FootballDataMatch[]> {
    const divisions: Array<{ name: string; div: string }> =
      Object.values(FOOTBALL_DATA_DIVISIONS);

    const results: FootballDataMatch[][] = await Promise.all(
      divisions.map(async (d: { name: string; div: string }) => {
        try {
          return await this.fetchDivision(d.div);
        } catch {
          return [];
        }
      }),
    );

    return results.flat();
  }

  private parseCsv(csvText: string): FootballDataMatch[] {
    const lines: string[] = csvText.split(/\r?\n/);
    if (lines.length === 0) return [];

    const headerLine: string = lines[0];
    const headers: string[] = parseCsvLine(headerLine);

    // Build index map: column name -> row index
    const colIndex: Record<string, number> = {};
    for (let i: number = 0; i < headers.length; i += 1) {
      const h: string = headers[i].trim();
      if (h) colIndex[h] = i;
    }

    const getVal = (row: string[], colName: string): string => {
      const idx: number | undefined = colIndex[colName];
      if (idx === undefined || idx >= row.length) return '';
      return row[idx]?.trim() ?? '';
    };

    const matches: FootballDataMatch[] = [];

    for (let i: number = 1; i < lines.length; i += 1) {
      const line: string = lines[i].trim();
      if (!line) continue;

      const row: string[] = parseCsvLine(line);

      const divVal: string = getVal(row, COLUMN_MAP.div);
      const homeVal: string = getVal(row, COLUMN_MAP.homeTeam);
      const awayVal: string = getVal(row, COLUMN_MAP.awayTeam);
      const dateVal: string = getVal(row, COLUMN_MAP.date);

      // Skip rows with no core data
      if (!divVal || !homeVal || !awayVal || !dateVal) continue;

      const match: FootballDataMatch = {
        div: divVal,
        date: parseDateDDMMYYYY(dateVal),
        time: getVal(row, COLUMN_MAP.time) || null,
        homeTeam: homeVal,
        awayTeam: awayVal,
        fthg: parseNum(getVal(row, COLUMN_MAP.fthg)),
        ftag: parseNum(getVal(row, COLUMN_MAP.ftag)),
        ftr: getVal(row, COLUMN_MAP.ftr) || null,
        // 1X2
        b365H: parseNum(getVal(row, COLUMN_MAP.b365H)),
        b365D: parseNum(getVal(row, COLUMN_MAP.b365D)),
        b365A: parseNum(getVal(row, COLUMN_MAP.b365A)),
        psH: parseNum(getVal(row, COLUMN_MAP.psH)),
        psD: parseNum(getVal(row, COLUMN_MAP.psD)),
        psA: parseNum(getVal(row, COLUMN_MAP.psA)),
        avgH: parseNum(getVal(row, COLUMN_MAP.avgH)),
        avgD: parseNum(getVal(row, COLUMN_MAP.avgD)),
        avgA: parseNum(getVal(row, COLUMN_MAP.avgA)),
        // Asian handicap
        ahHandicap: parseNum(getVal(row, COLUMN_MAP.ahHandicap)),
        b365AhH: parseNum(getVal(row, COLUMN_MAP.b365AhH)),
        b365AhA: parseNum(getVal(row, COLUMN_MAP.b365AhA)),
        avgAhH: parseNum(getVal(row, COLUMN_MAP.avgAhH)),
        avgAhA: parseNum(getVal(row, COLUMN_MAP.avgAhA)),
        maxAhH: parseNum(getVal(row, COLUMN_MAP.maxAhH)),
        maxAhA: parseNum(getVal(row, COLUMN_MAP.maxAhA)),
        // Over/Under 2.5
        avgOver25: parseNum(getVal(row, COLUMN_MAP.avgOver25)),
        avgUnder25: parseNum(getVal(row, COLUMN_MAP.avgUnder25)),
        // Closing odds
        avgCH: parseNum(getVal(row, COLUMN_MAP.avgCH)),
        avgCD: parseNum(getVal(row, COLUMN_MAP.avgCD)),
        avgCA: parseNum(getVal(row, COLUMN_MAP.avgCA)),
        maxCH: parseNum(getVal(row, COLUMN_MAP.maxCH)),
        maxCD: parseNum(getVal(row, COLUMN_MAP.maxCD)),
        maxCA: parseNum(getVal(row, COLUMN_MAP.maxCA)),
      };

      matches.push(match);
    }

    return matches;
  }
}
