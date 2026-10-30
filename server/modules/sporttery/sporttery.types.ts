export interface SyncHealthDto {
  schedulerRunning: boolean;
  source: 'sporttery-live' | 'external' | 'hybrid';
  lastSync: {
    football: { at: string | null; statusCode: number | null; success: boolean; message?: string; inserted?: number; updated?: number; skipped?: number };
    basketball: { at: string | null; statusCode: number | null; success: boolean; message?: string; inserted?: number; updated?: number; skipped?: number };
    score: { at: string | null; statusCode: number | null; success: boolean; message?: string };
  };
   staleCount: number;
   footballCount: number;
   basketballCount: number;
   beidanCount: number;
   footballDataFreshAt: string | null;
   basketballDataFreshAt: string | null;
   syncWriteEnabled: boolean;
  sources: {
    espnFootball: {
      enabled: boolean;
      lastSyncAt: string | null;
      success: boolean;
      leaguesSynced: number;
      pendingMappings: number;
       leagueStats: Record<string, { success: boolean; matchCount: number; rawEventCount: number; error?: string }>;
       rhythm: 'live' | 'upcoming' | 'idle';
       nextSyncAt: string | null;
     };
     espnBasketball: {
       enabled: boolean;
       lastSyncAt: string | null;
       success: boolean;
       leaguesSynced: number;
       pendingMappings: number;
       leagueStats: Record<string, { success: boolean; matchCount: number; rawEventCount: number; error?: string }>;
      rhythm: 'live' | 'upcoming' | 'idle';
      nextSyncAt: string | null;
      scoreUpdate: {
        finishedUpdates: Array<{ matchNo: string; homeScore: number; awayScore: number; league: string }>;
        liveMatches: Array<{ matchNo: string; homeScore: number | null; awayScore: number | null; league: string }>;
        upcomingMatches: number;
        unmappedTeams: string[];
      } | null;
    };
    oddsApi: {
      enabled: boolean;
      lastSyncAt: string | null;
      success: boolean;
      sportsSynced: number;
      remaining: number | null;
      used: number | null;
      statusCode: number | null;
      statusMessage: string;
      quotaThrottled: boolean;
      quotaExhausted: boolean;
      rhythm: 'pre-match' | 'daily' | 'idle';
      nextSyncAt: string | null;
    };
     sportteryExternal: {
       enabled: boolean;
       lastSyncAt: string | null;
       success: boolean;
       directStatus: 'auto' | 'degraded' | 'failed' | 'blocked';
       lastError: string | null;
       setupHint: string;
       todayCount: number;
       scheduleIntervalSeconds: number;
       scheduleIntervalLabel: string;
     };
      beidan: {
        enabled: boolean;
        lastSyncAt: string | null;
        success: boolean;
        todayCount: number;
      };
       qiumibao: {
         enabled: boolean;
         totalMatchCount: number;
         footballMatchCount: number;
         basketballMatchCount: number;
         footballJcAligned: number;
         basketballJcAligned: number;
         football: {
           lastSyncAt: string | null;
           success: boolean;
           todayCount: number;
           rhythm: 'live' | 'upcoming' | 'idle';
           liveUpdated: number;
         };
         basketball: {
           lastSyncAt: string | null;
           success: boolean;
           todayCount: number;
           rhythm: 'live' | 'upcoming' | 'idle';
           liveUpdated: number;
         };
         lastScheduleSyncAt: string | null;
       };
        theSportsDb: {
          enabled: boolean;
          lastSyncAt: string | null;
          success: boolean;
          todayCount: number;
          matchCount: number;
          footballMatchCount: number;
          basketballMatchCount: number;
          fetchedCount: number;
          lastError: string | null;
          nextSyncAt: string | null;
        };
        espnSummary: {
          enabled: boolean;
          lastSyncAt: string | null;
          success: boolean;
          todayCount: number;
          updated: number;
        };
        footballData: {
          enabled: boolean;
          lastSyncAt: string | null;
          success: boolean;
          todayCount: number;
          updated: number;
        };
        injurySource: {
          enabled: boolean;
          lastSyncAt: string | null;
          success: boolean;
          teamCount: number;
          playerCount: number;
          lastError: string | null;
          nextSyncAt: string | null;
        };
        footballDataOrg: {
          enabled: boolean;
          lastSyncAt: string | null;
          success: boolean;
          todayCount: number;
          updated: number;
          lastError: string | null;
          requestCount: number;
          nextSyncAt: string | null;
        };
         theRundown: {
           enabled: boolean;
           lastSyncAt: string | null;
           success: boolean;
           todayCount: number;
           updated: number;
         };
         apiSports: {
           enabled: boolean;
           lastSyncAt: string | null;
           success: boolean;
           todayCount: number;
           footballMatchCount: number;
           basketballMatchCount: number;
           quotaUsed: number;
           dailyLimit: number;
           lastError: string | null;
           nextSyncAt: string | null;
         };
      };
    syncTokenConfigured: boolean;
   espnFootballTodayCount: number;
   espnBasketballTodayCount: number;
   oddsApiTodayCount: number;
   pendingMappingTeams: {
     football: string[];
     basketball: string[];
   };
   adaptive: {
    espnFootballRhythm: 'live' | 'upcoming' | 'idle';
    espnBasketballRhythm: 'live' | 'upcoming' | 'idle';
    oddsApiRhythm: 'pre-match' | 'daily' | 'idle';
     oddsApiQuotaThrottled: boolean;
     oddsApiQuotaExhausted: boolean;
     sportteryDirectStatus: 'auto' | 'degraded' | 'failed' | 'blocked';
      qiumibaoFbRhythm?: 'live' | 'upcoming' | 'idle';
      qiumibaoBbRhythm?: 'live' | 'upcoming' | 'idle';
      liveScoreIntervalLabel: string;
      todayFbLiveCount: number;
    todayFbUpcomingCount: number;
    todayFbFinishedCount: number;
    todayBbLiveCount: number;
    todayBbUpcomingCount: number;
     todayBbFinishedCount: number;
   };
   performance?: {
     footballListP50Ms: number;
     footballListP95Ms: number;
     basketballListP50Ms: number;
     basketballListP95Ms: number;
     timestamp: string;
   };
   deployInfo?: {
     version: string;
     buildTime: string;
   };
}

export interface SyncTriggerResult {
  football: { inserted: number; updated: number; skipped: number; skipReasons?: { matchNo: string; reason: string }[] };
  basketball: { inserted: number; updated: number; skipped: number; skipReasons?: { matchNo: string; reason: string }[] };
}

export interface SyncConfigSource {
  name: string;
  enabled: boolean;
  type: string;
  intervalMs?: number;
  intervalLabel?: string;
  intervals?: {
    live: number;
    upcoming: number;
    idle: number;
  };
  monthlyQuota?: number;
  dailyQuota?: number;
  thresholdRatio?: number;
  note?: string;
  actualMatchesCount?: number;
  dataNote?: string;
  lastUpdated?: string | null;
}

export interface SyncConfig {
  sources: SyncConfigSource[];
}

export interface DataSourceStatus {
  enabled: boolean;
  lastSyncAt: string | null;
  success: boolean;
}

export interface DataSourceSettingsResponse {
  apiSports: {
    enabled: boolean;
    maskedKey: string;
    configuredSource: 'env' | 'db' | 'default';
    dbKeySet: boolean;
    dailyQuota: number;
    quotaUsed: number;
    lastSyncAt: string | null;
    success: boolean;
  };
  theRundown: {
    enabled: boolean;
    maskedKey: string;
    configuredSource: 'env' | 'db' | 'default';
    dbKeySet: boolean;
    lastSyncAt: string | null;
    success: boolean;
    oddsApiQuotaExhausted: boolean;
  };
  espn: {
    footballEnabled: boolean;
    basketballEnabled: boolean;
  };
  oddsApi: {
    enabled: boolean;
    remaining: number | null;
    used: number | null;
    quotaExhausted: boolean;
  };
  qiumibao: {
    enabled: boolean;
    footballCount: number;
    basketballCount: number;
  };
  beidan: {
    enabled: boolean;
    todayCount: number;
  };
  injurySource: {
    enabled: boolean;
    lastSyncAt: string | null;
    success: boolean;
    teamCount: number;
    playerCount: number;
    lastError: string | null;
  };
  footballDataOrg: {
    enabled: boolean;
    configuredSource: 'env' | 'db' | 'none';
    dbKeySet: boolean;
    maskedKey: string;
    lastSyncAt: string | null;
    success: boolean;
    todayCount: number;
    updated: number;
    requestCount: number;
    lastError: string | null;
  };
}

export interface OddsApiTriggerResult {
  enabled: boolean;
  sportsSynced: number;
  wnbaGames: number;
  nbaGames: number;
  nbaUpdated: number;
  eplGames: number;
  success: boolean;
  lastSyncAt: string | null;
  remaining: number | null;
  statusCode: number | null;
  statusMessage: string;
  excludedMarkets?: string[];
}

export interface SyncRefreshLiveResult {
  triggered: boolean;
  football: { success: boolean; leaguesSynced: number; rhythm: 'live' | 'upcoming' | 'idle' };
  basketball: { success: boolean; leaguesSynced: number; rhythm: 'live' | 'upcoming' | 'idle' };
}

export interface SyncRefreshOddsResult {
  triggered: boolean;
  sportsSynced: number;
  remaining: number | null;
  success: boolean;
  statusCode: number | null;
  statusMessage: string;
}

export interface ExternalFootballMatch {
  matchNo: string | number;
  matchDate: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  kickoffTime?: string;
  matchStatus?: string;
  oddsOpenHome?: string | number;
  oddsOpenDraw?: string | number;
  oddsOpenAway?: string | number;
  handicap?: string;
  handicapRecommendation?: string;
  overUnder?: string;
  totalGoals?: string | number;
  source?: 'sporttery' | 'sporttery-pending' | 'qiumibao' | 'espn' | 'thesportsdb';
}

export interface ExternalBasketballMatch {
  matchNo: string | number;
  matchDate: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  kickoffTime?: string;
  matchStatus?: string;
  handicap?: string;
  totalLine?: string;
  homeWinOdds?: string | number;
  awayWinOdds?: string | number;
  handicapOddsHome?: string | number;
  handicapOddsAway?: string | number;
  totalOddsOver?: string | number;
  totalOddsUnder?: string | number;
  source?: 'sporttery' | 'sporttery-pending' | 'qiumibao' | 'espn' | 'thesportsdb';
}

export interface SportteryExternalPayload {
  football?: ExternalFootballMatch[];
  basketball?: ExternalBasketballMatch[];
}

export interface BeidanMatch {
  matchNo?: string | number;
  matchDate?: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  kickoffTime?: string;
  matchStatus?: string;
  spHome?: string | number;
  spDraw?: string | number;
  spAway?: string | number;
  handicap?: string;
  handicapSpHome?: string | number;
  handicapSpDraw?: string | number;
  handicapSpAway?: string | number;
  totalGoals?: string | number;
  totalOverSp?: string | number;
  totalUnderSp?: string | number;
  halfFull?: string;
  score?: string;
  scoreHome?: number;
  scoreAway?: number;
  oddsSource?: string;
  homeWinProb?: number;
  drawProb?: number;
  awayWinProb?: number;
  predictionDirection?: string;
  confidence?: number;
  intel?: string;
}

export interface BeidanSyncPayload {
  matches: BeidanMatch[];
}

export interface IngestFootballItem {
  matchNo: string | number;
  matchDate: string;
  sourceMatchId?: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  kickoffTime?: string;
  matchStatus?: string;
  oddsOpenHome?: string | number;
  oddsOpenDraw?: string | number;
  oddsOpenAway?: string | number;
  handicap?: string;
  handicapOddsHome?: string | number;
  handicapOddsDraw?: string | number;
  handicapOddsAway?: string | number;
  totalGoals?: string | number;
  totalOddsOver?: string | number;
  totalOddsUnder?: string | number;
  homeWinProb?: number;
  drawProb?: number;
  awayWinProb?: number;
  predictionDirection?: string;
  handicapRecommendation?: string;
  handicapWinProb?: number;
  handicapDrawProb?: number;
  handicapLoseProb?: number;
  handicapSecondChoice?: string;
  overUnder?: string;
  overProb?: number;
  underProb?: number;
  totalPick?: string;
  totalPickProb?: number;
  confidence?: number;
  lowConfidence?: boolean;
  intel?: string;
  modelRules?: string[];
}

export interface IngestFootballPayload {
  matches: IngestFootballItem[];
}

export interface IngestBasketballItem {
  matchNo: string | number;
  matchDate: string;
  sourceMatchId?: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  kickoffTime?: string;
  matchStatus?: string;
  handicap?: string;
  handicapHf?: string | number; // 竞彩官方 hdc.hf，主队让分标志：0=无，1=主队是让分方（需要取反）
  handicapAf?: string | number; // 竞彩官方 hdc.af，客队让分标志：0=无，-1=客队是让分方（需要取反）
  handicapOddsHome?: string | number;
  handicapOddsAway?: string | number;
  totalLine?: string;
  totalOddsOver?: string | number;
  totalOddsUnder?: string | number;
  homeWinOdds?: string | number;
  awayWinOdds?: string | number;
  homeWinProb?: number;
  awayWinProb?: number;
  predictionDirection?: string;
  handicapRecommendation?: string;
  totalRecommendation?: string;
  confidence?: number;
  lowConfidence?: boolean;
  intel?: string;
  modelRules?: string[];
}

export interface IngestBasketballPayload {
  matches: IngestBasketballItem[];
}

export interface IngestBeidanItem {
  matchNo: string | number;
  matchDate: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  kickoffTime?: string;
  matchStatus?: string;
  spHome?: string | number;
  spDraw?: string | number;
  spAway?: string | number;
  handicap?: string;
  handicapOddsHome?: string | number;
  handicapOddsDraw?: string | number;
  handicapOddsAway?: string | number;
  totalGoals?: string | number;
  totalOddsOver?: string | number;
  totalOddsUnder?: string | number;
  homeWinProb?: number;
  drawProb?: number;
  awayWinProb?: number;
  predictionDirection?: string;
  handicapRecommendation?: string;
  confidence?: number;
  lowConfidence?: boolean;
  intel?: string;
  modelRules?: string[];
}

export interface IngestBeidanPayload {
  matches: IngestBeidanItem[];
}

export interface IngestResult {
  inserted: number;
  updated: number;
  skipped: number;
  skipReasons: { matchNo: string; reason: string }[];
}

export interface BeidanSyncResult {
  inserted: number;
  updated: number;
  skipped: number;
  skipReasons: { matchNo: string; reason: string }[];
}
