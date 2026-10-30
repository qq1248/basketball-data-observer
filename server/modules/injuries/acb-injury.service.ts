import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { injuryReports } from '@server/database/schema';
import { eq, and } from 'drizzle-orm';
import * as https from 'node:https';
import * as http from 'node:http';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const REFERER = 'https://www.acb.com/';

export type AcbSyncStatus = 'ok' | 'source_unavailable' | 'parse_empty' | 'not_found';

export interface AcbFetchDiagnostic {
  status: AcbSyncStatus;
  errorNote: string;
  lastStatusCode: number | null;
  urlsTried: number;
}

type InjuryStatus = 'Out' | 'Questionable' | 'Doubtful' | 'Probable';

export interface InjuryEntry {
  teamName: string;
  playerName: string;
  status: InjuryStatus;
  source: string;
  round?: string;
}

// Spanish status keywords → normalized status
const STATUS_KEYWORDS: Array<{ keyword: RegExp; status: InjuryStatus }> = [
  { keyword: /\bBaja\b/i, status: 'Out' },
  { keyword: /\bDuda\b/i, status: 'Questionable' },
  { keyword: /\bDisponible\b/i, status: 'Probable' },
];

// Known ACB teams (for matching headings) — reasonable subset of top-flight teams
const ACB_TEAMS = [
  'Real Madrid',
  'Barcelona',
  'Valencia Basket',
  'Baskonia',
  'Unicaja',
  'Joventut',
  'Gran Canaria',
  'Lenovo Tenerife',
  'UCAM Murcia',
  'Casademont Zaragoza',
  'Bàsquet Girona',
  'Covirán Granada',
  'Río Breogán',
  'Monbus Obradoiro',
  'Dreamland Gran Canaria',
  'MoraBanc Andorra',
  'Zunder Palencia',
  'Surne Bilbao Basket',
  'Bilbao Basket',
  'Estudiantes',
  'CB Breogán',
  'Girona',
  'Andorra',
  'Palencia',
  'Zaragoza',
  'Murcia',
  'Tenerife',
  'Granada',
  'Obradoiro',
];

interface FetchResult {
  html: string;
  statusCode: number;
}

@Injectable()
export class AcbInjuryService {
  private readonly logger = new Logger(AcbInjuryService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /**
   * Fetch and parse the official ACB "Novedades y parte médico" report for a
   * given jornada (round). The URL pattern includes season and a numeric id
   * suffix that varies; we try common patterns and return empty on failure.
   */
  async fetchInjuryReport(
    jornada: number,
    season?: string,
    articleId?: number,
  ): Promise<{ entries: InjuryEntry[]; diagnostic: AcbFetchDiagnostic }> {
    const seasonStr = season ?? this.defaultSeason();
    const urls: string[] = this.buildCandidateUrls(jornada, seasonStr, articleId);

    let html: string | null = null;
    let finalUrl = '';
    let lastStatusCode: number | null = null;
    let lastError: string | null = null;
    let blockedByWaf = false;
    let rateLimited = false;
    let networkError = false;
    let timeoutError = false;

    for (const url of urls) {
      try {
        const result: FetchResult = await this.fetchHtml(url);
        lastStatusCode = result.statusCode;

        if (result.statusCode === 200 && result.html.length > 5000) {
          html = result.html;
          finalUrl = url;
          break;
        }
        if (result.statusCode === 403 || result.statusCode === 401) {
          blockedByWaf = true;
          this.logger.warn(
            `ACB injury report blocked (${result.statusCode}) — likely WAF/access denied: ${url}`,
          );
          continue;
        }
        if (result.statusCode === 429) {
          rateLimited = true;
          this.logger.warn(`ACB injury report rate limited (429): ${url}`);
          continue;
        }
        if (result.statusCode === 404) {
          this.logger.verbose(`ACB injury report URL 404: ${url}`);
          continue;
        }
        if (result.statusCode >= 500) {
          this.logger.warn(
            `ACB injury report server error ${result.statusCode}: ${url}`,
          );
          continue;
        }
        // 200 but too short — likely JS-rendered shell or empty page
        if (result.statusCode === 200 && result.html.length <= 5000) {
          this.logger.warn(
            `ACB injury report returned 200 but body only ${result.html.length} bytes — page may be JS-rendered or structure changed: ${url}`,
          );
          continue;
        }
        this.logger.debug(
          `ACB injury report URL status ${result.statusCode}: ${url}`,
        );
      } catch (error) {
        const msg = this.errorMessage(error);
        lastError = msg;
        if (msg.toLowerCase().includes('timeout')) {
          timeoutError = true;
          this.logger.warn(`ACB injury report request timeout: ${url}`);
        } else if (
          msg.toLowerCase().includes('econnrefused') ||
          msg.toLowerCase().includes('enotfound') ||
          msg.toLowerCase().includes('network')
        ) {
          networkError = true;
          this.logger.warn(`ACB injury report network error: ${url} — ${msg}`);
        } else {
          this.logger.warn(
            `ACB injury report fetch error: ${url} — ${msg}`,
          );
        }
      }
    }

    const diagnostic: AcbFetchDiagnostic = {
      status: 'not_found',
      errorNote: '',
      lastStatusCode,
      urlsTried: urls.length,
    };

    if (!html) {
      let reason = 'unknown';
      if (blockedByWaf) {
        reason = 'WAF/access denied (403)';
        diagnostic.status = 'source_unavailable';
      } else if (rateLimited) {
        reason = 'rate limited (429)';
        diagnostic.status = 'source_unavailable';
      } else if (networkError) {
        reason = 'network error';
        diagnostic.status = 'source_unavailable';
      } else if (timeoutError) {
        reason = 'request timeout';
        diagnostic.status = 'source_unavailable';
      } else if (lastStatusCode && lastStatusCode >= 500) {
        reason = `server error (${lastStatusCode})`;
        diagnostic.status = 'source_unavailable';
      } else {
        diagnostic.status = 'not_found';
        reason = 'no matching URL found';
      }
      diagnostic.errorNote = reason;
      this.logger.warn(
        `ACB injury report unavailable for jornada=${jornada}, season=${seasonStr} — ${reason} (tried ${urls.length} URLs, last status=${lastStatusCode ?? 'n/a'})`,
      );
      return { entries: [], diagnostic };
    }

    const entries: InjuryEntry[] = this.parseInjuryHtml(html, String(jornada));

    if (entries.length === 0) {
      diagnostic.status = 'parse_empty';
      diagnostic.errorNote = 'HTML parsed but 0 injury entries extracted — selector/format may be outdated';
      this.logger.warn(
        `ACB injury report parse empty: 0 players from ${finalUrl} (${html.length} bytes) — page structure likely changed`,
      );
      return { entries, diagnostic };
    }

    diagnostic.status = 'ok';
    this.logger.log(
      `ACB injury report parsed: ${entries.length} players from ${new Set(entries.map((e: InjuryEntry) => e.teamName)).size} teams, jornada=${jornada} (${finalUrl})`,
    );
    return { entries, diagnostic };
  }

  /**
   * Write fetched injury entries to the injury_reports table.
   * Existing entries for the same jornada + source are replaced.
   */
  async syncToDb(
    jornada: number,
    season?: string,
    articleId?: number,
  ): Promise<{ inserted: number; teams: string[]; diagnostic: AcbFetchDiagnostic }> {
    const { entries, diagnostic } = await this.fetchInjuryReport(jornada, season, articleId);
    if (entries.length === 0) {
      return { inserted: 0, teams: [], diagnostic };
    }

    const jornadaLabel = String(jornada);
    const sourceKey = 'acb-official';

    try {
      await this.db.transaction(async (tx) => {
        await tx
          .delete(injuryReports)
          .where(
            and(
              eq(injuryReports.sport, 'basketball'),
              eq(injuryReports.source, sourceKey),
              eq(injuryReports.dataSource, `jornada-${jornadaLabel}`),
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
          dataSource: `jornada-${jornadaLabel}`,
          shortComment: `ACB Jornada ${jornadaLabel} parte médico oficial`,
        }));

        for (let i = 0; i < rows.length; i += 50) {
          await tx.insert(injuryReports).values(rows.slice(i, i + 50));
        }
      });

      const teams = Array.from(new Set(entries.map((e: InjuryEntry) => e.teamName))).sort();
      return { inserted: entries.length, teams, diagnostic };
    } catch (error) {
      this.logger.error(
        `Failed to sync ACB injury report to DB, jornada=${jornada}: ${this.errorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * Auto-detect the latest jornada and sync. Falls back from jornada 34 downwards.
   */
  async fetchAndSync(
    targetJornada?: number,
    season?: string,
  ): Promise<{ count: number; jornada: number; teams: string[]; status: AcbSyncStatus; errorNote: string }> {
    if (targetJornada != null) {
      const result = await this.syncToDb(targetJornada, season);
      return {
        count: result.inserted,
        jornada: targetJornada,
        teams: result.teams,
        status: result.diagnostic.status,
        errorNote: result.diagnostic.errorNote,
      };
    }

    const seasonStr = season ?? this.defaultSeason();
    let lastDiagnostic: AcbFetchDiagnostic | null = null;
    for (let jornada = 34; jornada >= 1; jornada -= 1) {
      const { entries, diagnostic } = await this.fetchInjuryReport(jornada, seasonStr);
      lastDiagnostic = diagnostic;
      if (entries.length > 0) {
        const result = await this.syncToDb(jornada, seasonStr);
        return {
          count: result.inserted,
          jornada,
          teams: result.teams,
          status: result.diagnostic.status,
          errorNote: result.diagnostic.errorNote,
        };
      }
      // If source is fundamentally unavailable (WAF/network/429), don't keep trying 34 URLs
      if (diagnostic.status === 'source_unavailable') {
        this.logger.warn(
          `ACB source unavailable at jornada=${jornada}, aborting downward scan — ${diagnostic.errorNote}`,
        );
        break;
      }
    }
    return {
      count: 0,
      jornada: 0,
      teams: [],
      status: lastDiagnostic?.status ?? 'not_found',
      errorNote: lastDiagnostic?.errorNote ?? 'no jornada matched',
    };
  }

  // ── HTML parsing ──────────────────────────────────────────────────────

  private parseInjuryHtml(html: string, jornadaLabel: string): InjuryEntry[] {
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
        source: 'acb-official',
        round: jornadaLabel,
      });
    }

    // Deduplicate by team + player
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
    const withNewlines = html.replace(
      /<\/?(?:div|p|li|tr|h[1-6]|br|ul|ol|table|tbody|thead|section|article|header|footer|strong|span)[^>]*>/gi,
      '\n',
    );
    return withNewlines.replace(/<[^>]+>/g, ' ');
  }

  private matchTeamName(line: string): string | null {
    const lower = line.toLowerCase();
    for (const team of ACB_TEAMS) {
      if (lower.includes(team.toLowerCase())) {
        if (line.length < 100 || lower.indexOf(team.toLowerCase()) < 30) {
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
    // Map back to Spanish keyword for regex
    const spanishKeyword = this.spanishKeywordForStatus(status);
    if (!spanishKeyword) return null;

    // Pattern 1: "Nombre Apellido (Baja)" or "Nombre Apellido - Baja"
    const beforePattern = new RegExp(
      `^\\s*([A-Z][\\w'\\-\\u00C0-\\u024F]+(?:\\s+(?:de|la|el|del|los|las|y|i|san|saint|mc|mac|van|der|den|von|di|da|do|du)[\\s-]+)?[A-Z][\\w'\\-\\u00C0-\\u024F]+(?:\\s+[A-Z][\\w'\\-\\u00C0-\\u024F]+){0,2})\\s*[-–,:;)(]\\s*${spanishKeyword}`,
      'i',
    );
    const m1 = line.match(beforePattern);
    if (m1 && m1[1]) return this.cleanName(m1[1]);

    // Pattern 2: "Baja: Nombre Apellido"
    const afterPattern = new RegExp(
      `${spanishKeyword}[^A-Za-zÁÉÍÓÚÑáéíóúñ]+([A-Z][\\w'\\-\\u00C0-\\u024F]+(?:\\s+(?:de|la|el|del|los|las|y|i|san|saint|mc|mac|van|der|den|von|di|da|do|du)[\\s-]+)?[A-Z][\\w'\\-\\u00C0-\\u024F]+(?:\\s+[A-Z][\\w'\\-\\u00C0-\\u024F]+){0,2})`,
      'i',
    );
    const m2 = line.match(afterPattern);
    if (m2 && m2[1]) return this.cleanName(m2[1]);

    // Pattern 3: line starts with a proper-name-like phrase, Spanish names with accents
    const loosePattern = /^\s*([A-Z][\w'\-–]*[áéíóúñÁÉÍÓÚÑ\w'\-]+(?:\s+(?:de|la|el|del|los|las|y|i|san|saint|mc|mac|van|der|den|von|di|da|do|du)[\s-]+)?[A-Z][\w'\-–]*[áéíóúñÁÉÍÓÚÑ\w'\-]+(?:\s+[A-Z][\w'\-–]*[áéíóúñÁÉÍÓÚÑ\w'\-]+){0,2})/u;
    const m3 = line.match(loosePattern);
    if (m3 && m3[1] && line.length < 150 && line.length > 10) {
      const name = this.cleanName(m3[1]);
      if (!this.isTeamName(name) && name.split(/\s+/).length >= 2) {
        return name;
      }
    }

    return null;
  }

  private spanishKeywordForStatus(status: InjuryStatus): string | null {
    switch (status) {
      case 'Out':
        return 'Baja';
      case 'Questionable':
        return 'Duda';
      case 'Probable':
        return 'Disponible';
      default:
        return null;
    }
  }

  private cleanName(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim();
  }

  private isTeamName(name: string): boolean {
    const lower = name.toLowerCase();
    return ACB_TEAMS.some((t: string) => t.toLowerCase() === lower);
  }

  private impactForStatus(status: InjuryStatus): 'high' | 'medium' | 'low' {
    switch (status) {
      case 'Out':
        return 'high';
      case 'Questionable':
      case 'Doubtful':
        return 'medium';
      case 'Probable':
        return 'low';
      default:
        return 'medium';
    }
  }

  // ── URL helpers ───────────────────────────────────────────────────────

  private buildCandidateUrls(jornada: number, season: string, articleId?: number): string[] {
    const urls: string[] = [];
    // If an explicit article id is provided, try it first
    if (articleId) {
      urls.push(
        `https://www.acb.com/es/liga/noticias/novedades-y-parte-medico-de-la-jornada-${jornada}-de-la-liga-endesa-${season}-${articleId}`,
      );
    }
    // Common id patterns (article id suffixes tend to be in this range)
    const candidateIds = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 100, 200, 500, 1000];
    for (const id of candidateIds) {
      if (id === articleId) continue;
      urls.push(
        `https://www.acb.com/es/liga/noticias/novedades-y-parte-medico-de-la-jornada-${jornada}-de-la-liga-endesa-${season}-${id}`,
      );
    }
    // URL without the numeric id suffix
    urls.push(
      `https://www.acb.com/es/liga/noticias/novedades-y-parte-medico-de-la-jornada-${jornada}-de-la-liga-endesa-${season}`,
    );
    // Alternative slug with dashes vs spaces in "Liga Endesa"
    urls.push(
      `https://www.acb.com/es/liga/noticias/novedades-y-parte-medico-jornada-${jornada}-liga-endesa-${season}`,
    );
    return urls;
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
            Referer: REFERER,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'max-age=0',
            Connection: 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
          },
          timeout: 15000,
        },
        (res) => {
          const statusCode = res.statusCode ?? 500;

          if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, url).toString();
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

  private defaultSeason(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    // ACB season starts around September
    if (month >= 9) {
      return `${year}-${(year + 1) % 100}`;
    }
    return `${year - 1}-${year % 100}`;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
