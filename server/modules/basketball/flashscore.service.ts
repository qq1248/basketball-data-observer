import { Inject, Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and } from 'drizzle-orm';
import { basketballMatches } from '@server/database/schema';
import { firstValueFrom } from 'rxjs';

export interface FlashscoreMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  kickoffTime: Date;
  round?: string;
}

interface LeagueUrlMap {
  [key: string]: { url: string; leagueName: string };
}

const LEAGUE_URLS: LeagueUrlMap = {
  'euroleague': {
    url: 'https://www.flashscore.com/basketball/europe/euroleague/results/',
    leagueName: '欧篮联',
  },
  'spain-acb': {
    url: 'https://www.flashscore.com/basketball/spain/acb/results/',
    leagueName: '西篮联',
  },
  'germany-bbl': {
    url: 'https://www.flashscore.com/basketball/germany/bbl/results/',
    leagueName: '德篮联',
  },
  'australia-nbl': {
    url: 'https://www.flashscore.com/basketball/australia/nbl/results/',
    leagueName: '澳NBL',
  },
};

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 15000;

const TEAM_ALIAS_MAP: Record<string, string[]> = {
  '法兰克福': ['Frankfurt', 'Skyliners Frankfurt', 'Fraport Skyliners'],
  '汉堡': ['Hamburg', 'Hamburg Towers', 'Veolia Towers Hamburg'],
  '汉堡塔楼': ['Hamburg', 'Hamburg Towers'],
  '巴斯克尼亚': ['Baskonia', 'Cazoo Baskonia', 'Saski Baskonia'],
  '约文图特': ['Joventut', 'Joventut Badalona', 'ASISA Joventut'],
  '帕纳辛纳科斯': ['Panathinaikos', 'Panathinaikos Athens', 'PAO'],
  '帕纳辛奈科斯': ['Panathinaikos'],
  '费内巴切': ['Fenerbahce', 'Fenerbahçe', 'Fenerbahce Beko'],
  '凯恩斯': ['Cairns', 'Cairns Taipans'],
  '凯恩斯毒蛇': ['Cairns', 'Cairns Taipans'],
  '布里斯班': ['Brisbane', 'Brisbane Bullets'],
  '布里斯班子弹': ['Brisbane', 'Brisbane Bullets'],
  '迪拜': ['Dubai', 'Dubai Basketball', 'Shabab Al Ahli'],
  '红星': ['Crvena Zvezda', 'Zvezda', 'Crvena Zvezda Meridianbet'],
  '贝尔格莱德红星': ['Crvena Zvezda', 'Zvezda', 'Crvena Zvezda Meridianbet'],
  '巴塞罗那': ['Barcelona', 'Barca', 'Barça'],
  '皇马': ['Real Madrid'],
  '皇家马德里': ['Real Madrid'],
  '奥林匹亚科斯': ['Olympiacos', 'Olympiacos Piraeus'],
  '艾菲斯': ['Anadolu Efes', 'Efes'],
  '阿纳多卢艾菲斯': ['Anadolu Efes'],
  '游击队': ['Partizan', 'Partizan Mozzart Bet'],
  '贝尔格莱德游击队': ['Partizan'],
  '瓦伦西亚': ['Valencia', 'Valencia Basket'],
  '马卡比': ['Maccabi Tel Aviv', 'Maccabi'],
  '特拉维夫马卡比': ['Maccabi Tel Aviv'],
  '扎尔吉里斯': ['Zalgiris', 'Zalgiris Kaunas'],
  '拜仁': ['Bayern', 'Bayern Munich', 'FC Bayern Munich'],
  '拜仁慕尼黑': ['Bayern Munich'],
  '米兰': ['Olimpia Milano', 'Armani Milano', 'EA7 Milano'],
  '米兰奥林匹亚': ['Olimpia Milano'],
  '博洛尼亚': ['Virtus Bologna', 'Virtus Segafredo Bologna'],
  '贝西克塔斯': ['Besiktas', 'Beşiktaş'],
  '巴黎': ['Paris', 'Paris Basketball'],
  '里昂': ['Lyon', 'Lyon-Villeurbanne', 'LDLC ASVEL'],
  '特拉维夫工人': ['Hapoel Tel Aviv', 'Hapoel'],
  '霍隆工人': ['Hapoel Tel Aviv'],
  '柏林': ['Alba Berlin', 'Berlin'],
  '路德维希堡': ['Ludwigsburg', 'MHP Riesen Ludwigsburg'],
  '悉尼': ['Sydney', 'Sydney Kings'],
  '悉尼国王': ['Sydney Kings'],
  '珀斯': ['Perth', 'Perth Wildcats'],
  '珀斯野猫': ['Perth Wildcats'],
  '墨尔本': ['Melbourne', 'Melbourne United', 'South East Melbourne'],
  '墨尔本联': ['Melbourne United'],
  '塔斯马尼亚': ['Tasmania', 'Tasmania JackJumpers'],
  '新西兰': ['New Zealand', 'New Zealand Breakers'],
  '新西兰破坏者': ['New Zealand Breakers'],
  '伊拉瓦拉': ['Illawarra', 'Illawarra Hawks'],
  '伍伦贡老鹰': ['Illawarra Hawks'],
  '特内里费': ['Tenerife', 'Lenovo Tenerife', 'CB Tenerife'],
  '安道尔': ['Andorra', 'MoraBanc Andorra'],
  '格拉纳达': ['Granada', 'Coviran Granada'],
  '萨拉戈萨': ['Zaragoza', 'Casademont Zaragoza'],
  '穆尔西亚': ['Murcia', 'UCAM Murcia'],
  '毕尔巴鄂': ['Bilbao', 'Surne Bilbao Basket'],
  '巴伦西亚': ['Valencia'],
  '马拉加': ['Malaga', 'Unicaja Malaga'],
  '大加那利': ['Gran Canaria', 'Dreamland Gran Canaria'],
};

@Injectable()
export class BasketballFlashscoreService {
  private readonly logger = new Logger(BasketballFlashscoreService.name);
  private readonly cache = new Map<string, { data: FlashscoreMatch[]; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly httpService: HttpService,
  ) {}

  private getCached(leagueKey: string): FlashscoreMatch[] | null {
    const entry = this.cache.get(leagueKey);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.data;
    }
    return null;
  }

  private setCache(leagueKey: string, data: FlashscoreMatch[]): void {
    this.cache.set(leagueKey, { data, expiresAt: Date.now() + this.CACHE_TTL_MS });
  }

  /**
   * Fetch and parse match results from flashscore.com for a given league.
   * Only matches with both home and away scores present are returned.
   */
  async fetchLeagueResults(leagueKey: string): Promise<FlashscoreMatch[]> {
    const leagueConfig = LEAGUE_URLS[leagueKey];
    if (!leagueConfig) {
      throw new BadRequestException(`Unsupported league key: ${leagueKey}`);
    }

    const cached = this.getCached(leagueKey);
    if (cached) return cached;

    this.logger.log(`Fetching flashscore results for league: ${leagueKey}`);

    const response = await firstValueFrom(
      this.httpService.get(leagueConfig.url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: REQUEST_TIMEOUT_MS,
        responseType: 'text',
      }),
    );

    const html: string = response.data;
    const matches = this.parseFlashscoreHtml(html);

    this.logger.log(
      `Parsed ${matches.length} finished matches from flashscore for ${leagueKey}`,
    );

    this.setCache(leagueKey, matches);
    return matches;
  }

  /**
   * Parse flashscore results page HTML and extract structured match data.
   * Uses the AA÷{id}¬... encoding format found in the page.
   */
  private parseFlashscoreHtml(html: string): FlashscoreMatch[] {
    const matches: FlashscoreMatch[] = [];
    const regex = /AA÷([a-zA-Z0-9]+)¬(.+?)(?=¬~AA÷|$)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
      const id = match[1];
      const block = match[2];
      const parsed = this.parseMatchBlock(id, block);
      if (parsed !== null) {
        matches.push(parsed);
      }
    }

    return matches;
  }

  /**
   * Parse a single match block (key÷value pairs separated by ¬).
   * Returns null if the match has no valid scores.
   */
  private parseMatchBlock(id: string, block: string): FlashscoreMatch | null {
    const fields: Record<string, string> = {};
    const parts = block.split('¬');

    for (const part of parts) {
      const idx = part.indexOf('÷');
      if (idx === -1) continue;
      const key = part.slice(0, idx);
      const value = part.slice(idx + 1);
      fields[key] = value;
    }

    const homeScoreStr = fields['AG'] ?? '';
    const awayScoreStr = fields['AH'] ?? '';

    // Only consider matches with both scores as valid finished matches
    if (!homeScoreStr || !awayScoreStr) {
      return null;
    }

    const homeScore = Number(homeScoreStr);
    const awayScore = Number(awayScoreStr);

    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
      return null;
    }

    const kickoffStr = fields['AD'] ?? '';
    if (!kickoffStr) {
      return null;
    }

    const kickoffTs = Number(kickoffStr);
    if (Number.isNaN(kickoffTs) || kickoffTs <= 0) {
      return null;
    }

    const homeTeam = fields['AE'] ?? '';
    const awayTeam = fields['AF'] ?? '';

    if (!homeTeam || !awayTeam) {
      return null;
    }

    const result: FlashscoreMatch = {
      id,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      kickoffTime: new Date(kickoffTs * 1000),
    };

    if (fields['ER']) {
      result.round = fields['ER'];
    }

    return result;
  }

  /**
   * Backfill historical match data from flashscore into basketball_matches.
   * Uses match_no ('FS-{id}') + source ('flashscore') for upsert identity,
   * deriving business_date from kickoff_time.
   */
  async backfillHistoricalMatches(
    leagueKey: string,
    limit?: number,
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    const leagueConfig = LEAGUE_URLS[leagueKey];
    if (!leagueConfig) {
      throw new BadRequestException(`Unsupported league key: ${leagueKey}`);
    }

    const matches = await this.fetchLeagueResults(leagueKey);
    const targetMatches = limit !== undefined ? matches.slice(0, limit) : matches;

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const m of targetMatches) {
      const matchNo = `FS-${m.id}`;
      const matchDate = this.formatMatchDate(m.kickoffTime);
      const businessDate = this.toBusinessDate(m.kickoffTime);

      const existing = await this.db
        .select({ id: basketballMatches.id })
        .from(basketballMatches)
        .where(
          and(
            eq(basketballMatches.matchNo, matchNo),
            eq(basketballMatches.source, 'flashscore'),
          ),
        );

      if (existing.length > 0) {
        // Update score/status fields only
        await this.db
          .update(basketballMatches)
          .set({
            homeScore: m.homeScore,
            awayScore: m.awayScore,
            matchStatus: 'finished',
            kickoffTime: m.kickoffTime,
            matchDate,
            businessDate,
          })
          .where(eq(basketballMatches.id, existing[0].id));
        updated += 1;
      } else {
        // Check for conflict by match_no + business_date unique constraint
        const conflictRow = await this.db
          .select({ id: basketballMatches.id })
          .from(basketballMatches)
          .where(
            and(
              eq(basketballMatches.matchNo, matchNo),
              eq(basketballMatches.businessDate, businessDate),
            ),
          );

        if (conflictRow.length > 0) {
          skipped += 1;
          continue;
        }

        await this.db.insert(basketballMatches).values({
          matchNo,
          source: 'flashscore',
          sourceId: m.id,
          sourceLeagueCode: leagueKey,
          league: leagueConfig.leagueName,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          kickoffTime: m.kickoffTime,
          matchDate,
          businessDate,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          matchStatus: 'finished',
          // NOT NULL fields with no default — fill with placeholder values
          // since these are historical baseline samples, not prediction records
          predictionDirection: '观望',
          handicapRecommendation: '观望',
          totalDirection: '观望',
          intel: '',
          riskWarning: '',
          liveScoreSource: 'flashscore',
        });
        inserted += 1;
      }
    }

    this.logger.log(
      `Backfill complete for ${leagueKey}: inserted=${inserted}, ` +
        `updated=${updated}, skipped=${skipped}`,
    );

    return { inserted, updated, skipped };
  }

  /**
   * Find a match score from flashscore results by team names and time range.
   * Uses case-insensitive substring matching for both teams.
   */
   async findMatchScore(
     homeTeam: string,
     awayTeam: string,
     kickoffFrom: Date,
     kickoffTo: Date,
     leagueKey?: string,
   ): Promise<{ homeScore: number; awayScore: number } | null> {
     const leaguesToSearch: string[] = leagueKey
       ? [leagueKey]
       : Object.keys(LEAGUE_URLS);
 
     const homeAliases = this.expandTeamAliases(homeTeam);
     const awayAliases = this.expandTeamAliases(awayTeam);
 
     for (const lk of leaguesToSearch) {
       try {
         const matches = await this.fetchLeagueResults(lk);
 
         for (const m of matches) {
           if (m.kickoffTime < kickoffFrom || m.kickoffTime > kickoffTo) {
             continue;
           }
 
           const mHomeLower = m.homeTeam.toLowerCase();
           const mAwayLower = m.awayTeam.toLowerCase();
 
           const homeMatches = this.teamNameFuzzyMatch(homeAliases, mHomeLower);
           const awayMatches = this.teamNameFuzzyMatch(awayAliases, mAwayLower);
 
           if (homeMatches && awayMatches) {
             return {
               homeScore: m.homeScore,
               awayScore: m.awayScore,
             };
           }
         }
       } catch (err) {
         this.logger.warn(
           `Failed to fetch flashscore results for ${lk}: ${(err as Error).message}`,
         );
         continue;
       }
     }
 
     return null;
   }

  private expandTeamAliases(teamName: string): string[] {
    const lower = teamName.trim();
    const aliases = new Set<string>([lower.toLowerCase()]);
    
    const mapped = TEAM_ALIAS_MAP[lower];
    if (mapped) {
      for (const a of mapped) aliases.add(a.toLowerCase());
    }
    
    for (const [zh, enList] of Object.entries(TEAM_ALIAS_MAP)) {
      if (lower.includes(zh)) {
        for (const a of enList) aliases.add(a.toLowerCase());
      }
      for (const en of enList) {
        if (lower.toLowerCase().includes(en.toLowerCase())) {
          aliases.add(zh.toLowerCase());
          for (const a of enList) aliases.add(a.toLowerCase());
        }
      }
    }
    
    return Array.from(aliases);
  }

  private teamNameFuzzyMatch(inputAliases: string[], targetLower: string): boolean {
    for (const alias of inputAliases) {
      if (!alias) continue;
      if (targetLower.includes(alias) || alias.includes(targetLower)) {
        return true;
      }
      const targetWords = targetLower.split(/[\s-]/).filter(w => w.length > 3);
      const aliasWords = alias.split(/[\s-]/).filter(w => w.length > 3);
      if (targetWords.length > 0 && aliasWords.length > 0) {
        let matchCount = 0;
        for (const tw of targetWords) {
          for (const aw of aliasWords) {
            if (tw === aw || tw.includes(aw) || aw.includes(tw)) {
              matchCount += 1;
              break;
            }
          }
        }
        if (matchCount >= 1 && matchCount >= Math.min(targetWords.length, aliasWords.length) * 0.4) {
          return true;
        }
      }
    }
    return false;
  }

  private formatMatchDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private toBusinessDate(date: Date): string {
    // Business date follows Asia/Shanghai convention:
    // Morning games before noon belong to previous business day
    const d = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    if (d.getUTCHours() < 12) {
      d.setUTCDate(d.getUTCDate() - 1);
    }
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
