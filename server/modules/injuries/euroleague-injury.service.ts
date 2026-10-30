import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { injuryReports } from '@server/database/schema';
import { eq, and } from 'drizzle-orm';
import * as https from 'node:https';
import * as http from 'node:http';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const EUROLEAGUE_TEAMS = [
  'Barcelona',
  'Real Madrid',
  'Olympiacos',
  'Panathinaikos',
  'Fenerbahce',
  'Anadolu Efes',
  'Crvena Zvezda',
  'Partizan',
  'Baskonia',
  'Valencia',
  'Maccabi Tel Aviv',
  'Hapoel Tel Aviv',
  'Zalgiris Kaunas',
  'Bayern Munich',
  'Olimpia Milano',
  'Virtus Bologna',
  'Besiktas',
  'Paris Basketball',
  'Lyon-Villeurbanne',
  'Dubai',
];

const STATUS_KEYWORDS: Array<{ keyword: RegExp; status: InjuryStatus }> = [
  { keyword: /\bOut\b/i, status: 'Out' },
  { keyword: /\bQuestionable\b/i, status: 'Questionable' },
  { keyword: /\bDoubtful\b/i, status: 'Doubtful' },
  { keyword: /\bProbable\b/i, status: 'Probable' },
];

type InjuryStatus = 'Out' | 'Questionable' | 'Doubtful' | 'Probable';

export interface InjuryEntry {
  teamName: string;
  playerName: string;
  status: InjuryStatus;
  source: string;
  round?: string;
}

interface FetchResult {
  html: string;
  statusCode: number;
}

@Injectable()
export class EuroLeagueInjuryService {
  private readonly logger = new Logger(EuroLeagueInjuryService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /**
   * Fetch and parse the official EuroLeague injury report for a given round.
   * Returns an empty array if the page is unavailable (429 / network error).
   */
  async fetchInjuryReport(round: number, season?: string): Promise<InjuryEntry[]> {
    const seasonStr = season ?? this.defaultSeason();
    const url = `https://www.euroleaguebasketball.net/en/euroleague/news/injury-report-round-${round}-el${seasonStr}/`;

    let html: string | null = null;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(3000);
      }
      try {
        const result: FetchResult = await this.fetchHtml(url);
        if (result.statusCode === 429) {
          this.logger.warn(
            `EuroLeague injury report rate limited (429), attempt ${attempt + 1}/${maxRetries + 1}, round=${round}`,
          );
          continue;
        }
        if (result.statusCode >= 200 && result.statusCode < 300) {
          html = result.html;
          break;
        }
        if (result.statusCode === 404) {
          this.logger.warn(`EuroLeague injury report not found (404), round=${round}, url=${url}`);
          return [];
        }
        this.logger.warn(
          `EuroLeague injury report unexpected status ${result.statusCode}, round=${round}`,
        );
      } catch (error) {
        this.logger.warn(
          `EuroLeague injury report fetch error, attempt ${attempt + 1}/${maxRetries + 1}: ${this.errorMessage(error)}`,
        );
      }
    }

    if (!html) {
      this.logger.error(`EuroLeague injury report fetch failed after retries, round=${round}`);
      return [];
    }

    const entries: InjuryEntry[] = this.parseInjuryHtml(html, String(round));
    this.logger.log(
      `EuroLeague injury report parsed: ${entries.length} players from ${new Set(entries.map((e: InjuryEntry) => e.teamName)).size} teams, round=${round}`,
    );
    return entries;
  }

  /**
   * Write fetched injury entries to the injury_reports table.
   * Existing entries for the same round + source are replaced.
   */
  async syncToDb(
    round: number,
    season?: string,
  ): Promise<{ inserted: number; teams: string[] }> {
    const entries: InjuryEntry[] = await this.fetchInjuryReport(round, season);
    if (entries.length === 0) {
      return { inserted: 0, teams: [] };
    }

    const roundLabel = String(round);
    const sourceKey = 'euroleague-official';

    try {
      await this.db.transaction(async (tx) => {
        await tx
          .delete(injuryReports)
          .where(
            and(
              eq(injuryReports.sport, 'basketball'),
              eq(injuryReports.source, sourceKey),
              eq(injuryReports.dataSource, `round-${roundLabel}`),
            ),
          );

        const rows = entries.map((entry: InjuryEntry) => ({
          sport: 'basketball' as const,
          teamSide: 'unknown' as const,
          teamName: entry.teamName,
          playerName: entry.playerName,
          status: entry.status.toLowerCase(),
          impactRating: this.impactForStatus(entry.status),
          source: sourceKey,
          dataSource: `round-${roundLabel}`,
          shortComment: `EuroLeague Round ${roundLabel} official injury report`,
        }));

        // batch insert in chunks of 50
        for (let i = 0; i < rows.length; i += 50) {
          await tx.insert(injuryReports).values(rows.slice(i, i + 50));
        }
      });

      const teams = Array.from(new Set(entries.map((e: InjuryEntry) => e.teamName))).sort();
      return { inserted: entries.length, teams };
    } catch (error) {
      this.logger.error(
        `Failed to sync EuroLeague injury report to DB, round=${round}: ${this.errorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * Auto-detect the latest round and sync. Falls back from round 30 downwards.
   */
  async fetchAndSync(
    targetRound?: number,
    season?: string,
  ): Promise<{ count: number; round: number; teams: string[] }> {
    if (targetRound != null) {
      const result = await this.syncToDb(targetRound, season);
      return { count: result.inserted, round: targetRound, teams: result.teams };
    }

    const seasonStr = season ?? this.defaultSeason();
    for (let round = 30; round >= 1; round -= 1) {
      const entries: InjuryEntry[] = await this.fetchInjuryReport(round, seasonStr);
      if (entries.length > 0) {
        const result = await this.syncToDb(round, seasonStr);
        return { count: result.inserted, round, teams: result.teams };
      }
    }
    return { count: 0, round: 0, teams: [] };
  }

  // ── HTML parsing ──────────────────────────────────────────────────────

  private parseInjuryHtml(html: string, roundLabel: string): InjuryEntry[] {
    const clean: string = this.stripScriptsAndStyles(html);
    const text: string = this.stripHtmlTags(clean);
    const lines: string[] = text
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);

    const entries: InjuryEntry[] = [];
    let currentTeam: string | null = null;

    for (const line of lines) {
      const matchedTeam: string | null = this.matchTeamName(line);
      if (matchedTeam) {
        currentTeam = matchedTeam;
        continue;
      }

      if (!currentTeam) continue;

      const status: InjuryStatus | null = this.detectStatus(line);
      if (!status) continue;

      const playerName: string | null = this.extractPlayerName(line, status);
      if (!playerName) continue;

      entries.push({
        teamName: currentTeam,
        playerName,
        status,
        source: 'euroleague-official',
        round: roundLabel,
      });
    }

    // Deduplicate by team + player (keep first occurrence)
    const seen = new Set<string>();
    return entries.filter((e: InjuryEntry) => {
      const key = `${e.teamName}::${e.playerName.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private stripScriptsAndStyles(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  }

  private stripHtmlTags(html: string): string {
    // Replace block-level tags with newlines, strip the rest
    const withNewlines = html.replace(
      /<\/?(?:div|p|li|tr|h[1-6]|br|ul|ol|table|tbody|thead|section|article|header|footer)[^>]*>/gi,
      '\n',
    );
    return withNewlines.replace(/<[^>]+>/g, ' ');
  }

  private matchTeamName(line: string): string | null {
    const lower = line.toLowerCase();
    for (const team of EUROLEAGUE_TEAMS) {
      if (lower.includes(team.toLowerCase())) {
        // Require the line to look like a team heading (short enough, or contains the team near start)
        if (line.length < 80 || lower.indexOf(team.toLowerCase()) < 30) {
          return team;
        }
      }
    }
    return null;
  }

  private detectStatus(line: string): InjuryStatus | null {
    for (const { keyword, status } of STATUS_KEYWORDS) {
      if (keyword.test(line)) {
        return status;
      }
    }
    return null;
  }

  private extractPlayerName(line: string, status: InjuryStatus): string | null {
    // Common patterns: "Player Name - Out", "Player Name (Out)", "Out: Player Name"
    const statusEscaped = status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Pattern 1: "Name - Status" or "Name, Status" or "Name (Status)"
    const beforePattern = new RegExp(
      `^\\s*([A-Z][\\w'\\-\\u00C0-\\u024F]+(?:\\s+[A-Z][\\w'\\-\\u00C0-\\u024F]+){1,3})\\s*[-–,:;(]\\s*${statusEscaped}`,
      'i',
    );
    const m1 = line.match(beforePattern);
    if (m1 && m1[1]) return this.cleanName(m1[1]);

    // Pattern 2: "Status: Name"
    const afterPattern = new RegExp(
      `${statusEscaped}[^A-Za-z]+([A-Z][\\w'\\-\\u00C0-\\u024F]+(?:\\s+[A-Z][\\w'\\-\\u00C0-\\u024F]+){1,3})`,
      'i',
    );
    const m2 = line.match(afterPattern);
    if (m2 && m2[1]) return this.cleanName(m2[1]);

    // Pattern 3: line starts with a capitalized name (2-3 words) and contains status later
    const loosePattern = /^\s*([A-Z][\w'\-\u00C0-\u024F]+(?:\s+[A-Z][\w'\-\u00C0-\u024F]+){1,2})/;
    const m3 = line.match(loosePattern);
    if (m3 && m3[1] && line.length < 120) {
      const name = this.cleanName(m3[1]);
      // Avoid matching team names as players
      if (!this.isTeamName(name)) return name;
    }

    return null;
  }

  private cleanName(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim();
  }

  private isTeamName(name: string): boolean {
    const lower = name.toLowerCase();
    return EUROLEAGUE_TEAMS.some((t: string) => t.toLowerCase() === lower);
  }

  private impactForStatus(status: InjuryStatus): 'high' | 'medium' | 'low' {
    switch (status) {
      case 'Out':
        return 'high';
      case 'Questionable':
        return 'medium';
      case 'Doubtful':
        return 'medium';
      case 'Probable':
        return 'low';
      default:
        return 'medium';
    }
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────

  private fetchHtml(url: string): Promise<FetchResult> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          method: 'GET',
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 15000,
        },
        (res) => {
          const statusCode = res.statusCode ?? 500;

          // Follow redirects up to 3 levels
          if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, url).toString();
            // consume the response body to free memory
            res.resume();
            this.fetchHtml(redirectUrl).then(resolve).catch(reject);
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            resolve({ html: buf.toString('utf-8'), statusCode });
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private defaultSeason(): string {
    const now = new Date();
    const year = now.getFullYear();
    // EuroLeague season spans fall to spring; use 2-digit season code like "2425"
    const month = now.getMonth() + 1;
    if (month >= 9) {
      return `${year % 100}${(year + 1) % 100}`;
    }
    return `${(year - 1) % 100}${year % 100}`;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
