import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { matches, injuryReports, teamAlias } from '@server/database/schema';
import { eq, sql, and } from 'drizzle-orm';
import * as https from 'node:https';
import * as http from 'node:http';

const SINA_LOTTERY_HOME = 'https://lottery.sina.com.cn/';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface SinaInjuryPlayer {
  playerName: string;
  position: string;
  isKeyPlayer: boolean;
  injuryType: 'injury' | 'suspension';
}

interface SinaMatchInjury {
  homeTeam: string;
  awayTeam: string;
  homePlayers: SinaInjuryPlayer[];
  awayPlayers: SinaInjuryPlayer[];
}

interface BackfillResult {
  articleUrl: string;
  articleTitle: string;
  articleDate: string;
  totalMatchesInArticle: number;
  matchedMatches: number;
  unmatchedTeams: string[];
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

@Injectable()
export class SinaInjuryService {
  private readonly logger = new Logger(SinaInjuryService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private async fetch(url: string): Promise<string> {
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
            'Accept-Language': 'zh-CN,zh;q=0.9',
          },
          timeout: 15000,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, url).toString();
            this.fetch(redirectUrl).then(resolve).catch(reject);
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            resolve(buf.toString('utf-8'));
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

  async findLatestInjuryArticle(): Promise<{ url: string; title: string; date: string } | null> {
    try {
      const html = await this.fetch(SINA_LOTTERY_HOME);
      const pattern =
        /href="(https?:\/\/sports\.sina\.com\.cn\/l\/(\d{4}-\d{2}-\d{2})\/doc-[a-z0-9]+\.shtml)"[^>]*>([^<]*伤停[^<]*)</g;
      const candidates: { url: string; date: string; title: string }[] = [];
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(html)) !== null) {
        const title = m[3].trim();
        if (title.includes('足彩')) {
          candidates.push({ url: m[1], date: m[2], title });
        }
      }
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => b.date.localeCompare(a.date));
      return candidates[0];
    } catch (err) {
      this.logger.warn(`Failed to find latest Sina injury article: ${this.errMsg(err)}`);
      return null;
    }
  }

  async parseInjuryArticle(articleUrl: string): Promise<{
    title: string;
    date: string;
    matches: SinaMatchInjury[];
  }> {
    const html = await this.fetch(articleUrl);

    let title = '';
    const titleMatch = html.match(/<title>([^<]*)</);
    if (titleMatch) title = titleMatch[1].trim();

    let date = '';
    const dateMatch = html.match(/article:published_time" content="([^"]+)/);
    if (dateMatch) date = dateMatch[1].slice(0, 10);

    const bodyMatch = html.match(/id="artibody"[^>]*>([\s\S]*?)<div[^>]*id="article-bottom"/);
    const body = bodyMatch ? bodyMatch[1] : html;

    const tableMatch = body.match(
      /<table[^>]*>[\s\S]*?<tr[^>]*bgcolor="#[Dd]1[eE][aA][fF]2"[^>]*>[\s\S]*?<strong>主队<[\s\S]*?<\/table>/i,
    );
    const tableHtml = tableMatch ? tableMatch[0] : body;

    const rowPattern = /<tr[^>]*bgcolor="#[Ff]fffff"[^>]*>([\s\S]*?)<\/tr>/gi;
    const altRowPattern = /<tr[^>]*bgcolor="#[Dd]1[eE][aA][fF]2"[^>]*>([\s\S]*?)<\/tr>/gi;
    const allRows: string[] = [];
    let rm: RegExpExecArray | null;
    while ((rm = rowPattern.exec(tableHtml)) !== null) allRows.push(rm[1]);
    while ((rm = altRowPattern.exec(tableHtml)) !== null) allRows.push(rm[1]);

    const matches: SinaMatchInjury[] = [];
    for (const row of allRows) {
      const cells = this.extractTdTexts(row);
      if (cells.length < 4) continue;

      const homeTeam = cells[0].trim();
      const homeInjuryText = cells[1].trim();
      const awayTeam = cells[2].trim();
      const awayInjuryText = cells[3].trim();

      if (!homeTeam || !awayTeam) continue;
      if (homeTeam === '主队' || awayTeam === '客队') continue;

      const homePlayers = this.parseInjuryCell(homeInjuryText);
      const awayPlayers = this.parseInjuryCell(awayInjuryText);

      matches.push({ homeTeam, awayTeam, homePlayers, awayPlayers });
    }

    return { title, date, matches };
  }

  private extractTdTexts(rowHtml: string): string[] {
    const texts: string[] = [];
    const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m: RegExpExecArray | null;
    while ((m = tdPattern.exec(rowHtml)) !== null) {
      const raw = m[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/&nbsp;/g, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/[\t\r]+/g, '')
        .trim();
      texts.push(raw);
    }
    return texts;
  }

  private parseInjuryCell(text: string): SinaInjuryPlayer[] {
    const players: SinaInjuryPlayer[] = [];
    if (!text || text === '无' || text === '暂无' || /^伤病[：:]\s*无\s*停赛[：:]\s*无/.test(text)) {
      return players;
    }

    const injuryMatch = text.match(/伤病[：:]([\s\S]*?)(?:停赛[：:]|$)/);
    const suspensionMatch = text.match(/停赛[：:]([\s\S]*)$/);

    if (injuryMatch) {
      const names = this.splitPlayerNames(injuryMatch[1]);
      for (const n of names) players.push({ ...n, injuryType: 'injury' });
    }
    if (suspensionMatch) {
      const names = this.splitPlayerNames(suspensionMatch[1]);
      for (const n of names) players.push({ ...n, injuryType: 'suspension' });
    }

    return players;
  }

  private splitPlayerNames(text: string): Omit<SinaInjuryPlayer, 'injuryType'>[] {
    const cleaned = text
      .replace(/[\t\r]+/g, '')
      .replace(/\n+/g, '、')
      .replace(/ +/g, ' ')
      .trim();
    if (!cleaned || cleaned === '无') return [];

    const parts = cleaned.split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean);
    const result: Omit<SinaInjuryPlayer, 'injuryType'>[] = [];

    for (const part of parts) {
      const bracketMatch = part.match(/^(.+?)[（(]([^)）]*)[)）]\s*$/);
      if (bracketMatch) {
        const playerName = bracketMatch[1].trim();
        const desc = bracketMatch[2].trim();
        const isKey = desc.includes('主力');
        const position = desc.replace(/主力/g, '').replace(/[、,，]/g, '').trim();
        if (playerName && playerName !== '无') {
          result.push({ playerName, position, isKeyPlayer: isKey });
        }
      } else {
        const playerName = part.trim();
        if (playerName && playerName !== '无') {
          result.push({ playerName, position: '', isKeyPlayer: false });
        }
      }
    }

    return result;
  }

  private async buildTeamAliasMap(): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ canonicalName: teamAlias.canonicalName, aliasName: teamAlias.aliasName })
      .from(teamAlias)
      .where(eq(teamAlias.sport, 'football'));

    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.aliasName.normalize(), row.canonicalName);
      map.set(row.canonicalName.normalize(), row.canonicalName);
    }
    return map;
  }

  private async getCanonicalTeamNames(): Promise<string[]> {
    const rows = await this.db
      .select({ name: matches.homeTeam })
      .from(matches)
      .where(sql`${matches.source} = 'sporttery' AND ${matches.matchStatus} != 'finished' AND ${matches.matchStatus} != 'canceled'`)
      .union(
        this.db
          .select({ name: matches.awayTeam })
          .from(matches)
          .where(sql`${matches.source} = 'sporttery' AND ${matches.matchStatus} != 'finished' AND ${matches.matchStatus} != 'canceled'`),
      );
    return [...new Set(rows.map((r) => r.name).filter(Boolean))];
  }

  private findTeamMatch(
    sinaTeam: string,
    aliasMap: Map<string, string>,
    canonicalSet: Set<string>,
  ): string | null {
    const normalized = sinaTeam.normalize().trim();
    if (canonicalSet.has(normalized)) return normalized;
    const canonical = aliasMap.get(normalized);
    if (canonical && canonicalSet.has(canonical)) return canonical;

    for (const [alias, canon] of aliasMap.entries()) {
      if (canonicalSet.has(canon)) {
        if (normalized.includes(alias) || alias.includes(normalized)) {
          if (Math.abs(alias.length - normalized.length) <= 3) return canon;
        }
      }
    }
    return null;
  }

  async backfillSinaInjuries(articleUrl?: string): Promise<BackfillResult> {
    const result: BackfillResult = {
      articleUrl: '',
      articleTitle: '',
      articleDate: '',
      totalMatchesInArticle: 0,
      matchedMatches: 0,
      unmatchedTeams: [],
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    let url = articleUrl;
    if (!url) {
      const latest = await this.findLatestInjuryArticle();
      if (!latest) {
        result.errors.push('未找到最新的足彩伤停文章');
        return result;
      }
      url = latest.url;
    }
    result.articleUrl = url;

    let parsed: { title: string; date: string; matches: SinaMatchInjury[] };
    try {
      parsed = await this.parseInjuryArticle(url);
    } catch (err) {
      result.errors.push(`解析文章失败: ${this.errMsg(err)}`);
      return result;
    }

    result.articleTitle = parsed.title;
    result.articleDate = parsed.date;
    result.totalMatchesInArticle = parsed.matches.length;

    const aliasMap = await this.buildTeamAliasMap();
    const canonicalNames = await this.getCanonicalTeamNames();
    const canonicalSet = new Set(canonicalNames);

    const upcomingMatches = await this.db
      .select({
        id: matches.id,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        kickoffTime: matches.kickoffTime,
      })
      .from(matches)
      .where(
        sql`${matches.source} = 'sporttery' AND ${matches.matchStatus} IN ('upcoming', 'live', 'score_pending')`,
      );

    const matchMap = new Map<string, typeof upcomingMatches[number]>();
    for (const m of upcomingMatches) {
      matchMap.set(`${m.homeTeam}__vs__${m.awayTeam}`, m);
    }

    const unmatchedSet = new Set<string>();

    for (const sinaMatch of parsed.matches) {
      const homeCanon = this.findTeamMatch(sinaMatch.homeTeam, aliasMap, canonicalSet);
      const awayCanon = this.findTeamMatch(sinaMatch.awayTeam, aliasMap, canonicalSet);

      if (!homeCanon || !awayCanon) {
        if (!homeCanon) unmatchedSet.add(sinaMatch.homeTeam);
        if (!awayCanon) unmatchedSet.add(sinaMatch.awayTeam);
        continue;
      }

      const dbMatch =
        matchMap.get(`${homeCanon}__vs__${awayCanon}`) ||
        matchMap.get(`${awayCanon}__vs__${homeCanon}`);

      if (!dbMatch) {
        unmatchedSet.add(`${homeCanon} vs ${awayCanon}`);
        continue;
      }

      result.matchedMatches += 1;

      const determineSide = (sinaSide: 'home' | 'away', canonName: string): 'home' | 'away' => {
        return dbMatch.homeTeam === canonName ? 'home' : 'away';
      };

      const homeSide = determineSide('home', homeCanon);
      const awaySide = determineSide('away', awayCanon);

      for (const p of sinaMatch.homePlayers) {
        const r = await this.insertOrUpdatePlayer(dbMatch.id, homeSide, p, homeCanon);
        if (r === 'inserted') result.inserted += 1;
        else if (r === 'updated') result.updated += 1;
        else result.skipped += 1;
      }
      for (const p of sinaMatch.awayPlayers) {
        const r = await this.insertOrUpdatePlayer(dbMatch.id, awaySide, p, awayCanon);
        if (r === 'inserted') result.inserted += 1;
        else if (r === 'updated') result.updated += 1;
        else result.skipped += 1;
      }
    }

    result.unmatchedTeams = [...unmatchedSet].sort();
    return result;
  }

  private async insertOrUpdatePlayer(
    matchId: string,
    teamSide: 'home' | 'away',
    player: SinaInjuryPlayer,
    teamName: string,
  ): Promise<'inserted' | 'updated' | 'skipped'> {
    const impactRating = player.isKeyPlayer ? 'high' : 'medium';
    const injuryTypeStr = player.injuryType === 'suspension' ? '停赛' : '伤病';
    const status = 'out';

    const existing = await this.db
      .select({
        id: injuryReports.id,
        impactRating: injuryReports.impactRating,
        injuryType: injuryReports.injuryType,
        position: injuryReports.position,
        status: injuryReports.status,
      })
      .from(injuryReports)
      .where(
        sql`${injuryReports.matchId} = ${matchId}
          AND ${injuryReports.teamSide} = ${teamSide}
          AND ${injuryReports.playerName} = ${player.playerName}
          AND ${injuryReports.sport} = 'football'`,
      )
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];
      if (
        row.impactRating === impactRating &&
        row.injuryType === injuryTypeStr &&
        row.position === (player.position || null) &&
        row.status === status
      ) {
        return 'skipped';
      }
      await this.db
        .update(injuryReports)
        .set({
          impactRating,
          injuryType: injuryTypeStr,
          position: player.position || null,
          status,
          dataSource: 'sina',
          source: 'sina_injury',
          updatedAt: new Date(),
        })
        .where(eq(injuryReports.id, row.id));
      return 'updated';
    }

    await this.db.insert(injuryReports).values({
      matchId,
      sport: 'football',
      teamSide,
      teamName,
      playerName: player.playerName,
      position: player.position || null,
      injuryType: injuryTypeStr,
      status,
      impactRating,
      dataSource: 'sina',
      source: 'sina_injury',
    });
    return 'inserted';
  }

  private errMsg(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
