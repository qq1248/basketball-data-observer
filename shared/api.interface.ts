export type StarRating = 0 | 1 | 2 | 3 | 4 | 5;

export interface RuleBacktestItem {
  rule: string;
  totalTriggered: number;
  adoptedCount: number;
  adoptedRate: number;
  wdwHitRate: number | null;
  handicapHitRate: number | null;
  overunderHitRate: number | null;
  primaryDimension: 'wdw' | 'handicap' | 'overunder' | 'multi' | 'auxiliary' | 'unknown';
  action: 'keep' | 'high_confidence' | 'remove' | 'insufficient_sample' | 'auxiliary_mark';
  category: 'core' | 'auxiliary' | 'legacy';
  ruleGroup: string;
}

export interface RuleBacktestResponse {
  sport: 'basketball' | 'football';
  totalRules: number;
  items: RuleBacktestItem[];
  generatedAt: string;
  comparisonWithLastRound?: {
    lastRoundRemoved: string[];
    restoredAsAuxiliary: string[];
    confirmedRemoved: string[];
  };
}

export interface TotalGoalsProbItem {
  goals: string;
  prob: number;
}

export interface HalfFullProbItem {
  code: string;
  prob: number;
}

export interface AdvancedStats {
  xgHome: number;
  xgAway: number;
  xaHome: number;
  xaAway: number;
  shotsHome: number;
  shotsAway: number;
  shotsOnTargetHome: number;
  shotsOnTargetAway: number;
  cornersHome: number;
  cornersAway: number;
  possessionHome: number;
  possessionAway: number;
  foulsHome: number;
  foulsAway: number;
  passAccuracyHome: number;
  passAccuracyAway: number;
}

export interface MatchEnvironment {
  weather: {
    temp: number;
    condition: string;
    humidity: number;
    wind: number;
  };
  stadium: {
    name: string;
    capacity: number;
    grass: string;
  };
  referee: {
    name: string;
    matches: number;
    avgYellow: number;
    avgRed: number;
    penaltyRate: number;
  };
}

export interface RuleTriggeredItem {
  rule: string;
  impact: string;
  direction: string;
}

export interface MatchItem {
  id: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  predictionDirection: string;
  handicap: string;
  handicapRecommendation: string;
  handicapType?: 'official' | 'estimated';
  confidence: number;
  isModelAnalyzed?: boolean;
  lowConfidence: boolean;
  drawWarning?: boolean;
  intel: string;
  intelSummary?: string;
  modelRules: string[];
  matchDate: string;
  businessDate?: string;
  source?: string;
  sourceMatchId?: string;
  isFavorited?: boolean;
  overUnder: string;
  overProb: number;
  underProb: number;
  totalPick?: string;
  totalPickProb?: number;
  totalGoals: number;
  mostLikelyScore: string;
  scoreProbs: string[];
  totalGoalsProb: TotalGoalsProbItem[];
  halfFullProb: HalfFullProbItem[];
  advancedStats: AdvancedStats;
  environment: MatchEnvironment;
  matchStatus: 'upcoming' | 'finished' | 'cancelled' | 'live' | 'result_pending' | 'pending_verify';
  homeScore?: number;
  awayScore?: number;
  homeHalfScore?: number;
  awayHalfScore?: number;
  livePeriod?: number | null;
  liveClock?: string | null;
  livePeriodEstimated?: boolean;
  lastScoreAt?: string | null;
  liveScoreSource?: string;
  lastDataSyncAt?: string | null;
  lastOddsUpdateAt?: string | null;
  homeForm: string[];
  awayForm: string[];
  h2h: string[];
  oddsOpenHome?: number;
  oddsOpenDraw?: number;
  oddsOpenAway?: number;
  homeWinOdds?: number | null;
  drawOdds?: number | null;
  awayWinOdds?: number | null;
  oddsLiveHome?: number;
  oddsLiveDraw?: number;
  oddsLiveAway?: number;
  handicapOddsHome?: number | null;
  handicapOddsDraw?: number | null;
  handicapOddsAway?: number | null;
  totalOddsOver?: number | null;
  totalOddsUnder?: number | null;
  drawConfidence: '高' | '中' | '低';
  drawFactors: string[];
  handicapWinProb: number;
  handicapDrawProb: number;
  handicapLoseProb: number;
  handicapValueType?: 'percent' | 'odds' | 'none';
  wdwAnalyzed?: boolean;
  handicapAnalyzed?: boolean;
  totalAnalyzed?: boolean;
  kellyH: number;
  kellyD: number;
  kellyA: number;
  handicapSecondChoice: string;
  handicapValueRating: string;
  rulesTriggered: RuleTriggeredItem[];
  hitWdw?: boolean;
  hitHandicap?: boolean;
  hitOverunder?: boolean;
  hitGoals?: boolean;
  hitHalffull?: boolean;
  starRating?: StarRating;
  errorReason?: string;
  homeGoalsAvg: number;
  awayGoalsAvg: number;
  homeConcededAvg: number;
  awayConcededAvg: number;
  homeHomeRecord: string;
  awayAwayRecord: string;
  homeInjuries: string;
  awayInjuries: string;
  tacticsHome: string;
  tacticsAway: string;
  keyPlayersHome: string;
  keyPlayersAway: string;
  upsetWarning: string;
  teamNews: string;
  injuries: string;
  mediaConsensus: string;
  expertPicks: string;
  keyPlayers: string;
  intelUpdatedAt?: string;
  intelAdjustments?: IntelAdjustments | null;
  predEngineVersion?: string;
  isOfficialLocked?: boolean;
}

export interface YesterdayReviewMatchItem {
  id: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  predictionDirection: string;
  actualResult: '主胜' | '平' | '客胜';
  hitWdw: boolean;
  hitHandicap: boolean;
  errorReason?: string;
}

export interface YesterdayReviewResponse {
  date: string;
  totalMatches: number;
  wdwHitRate: number;
  handicapHitRate: number;
  overUnderHitRate: number;
  hitCount: number;
  missCount: number;
  matches: YesterdayReviewMatchItem[];
}

export interface DateStatsItem {
  date: string;
  totalMatches: number;
  finishedCount: number;
  upcomingCount: number;
  wdwHitRate: number;
  handicapHitRate: number;
  overUnderHitRate: number;
  wdwValidTotal: number;
  handicapValidTotal: number;
  overUnderValidTotal: number;
  wdwHit: number;
  handicapHit: number;
  overunderHit: number;
  wdwAccuracy: number;
  handicapAccuracy: number;
  overunderAccuracy: number;
  hasData: boolean;
}

export interface DateStatsResponse {
  items: DateStatsItem[];
}

export interface VersionResponse {
  version: string;
  buildNumber: number;
  buildTime: string;
  changelog: string[];
  forceUpdate: boolean;
}

export interface MatchListResponse {
  items: MatchItem[];
  date: string;
  beidanEnabled: boolean;
  total: number;
  highConfCount: number;
  page: number;
  pageSize: number;
}

export interface LiveScoreItem {
  id: string;
  matchNo: string;
  matchStatus: string;
  homeScore: number | null;
  awayScore: number | null;
  matchTime: string | null;
  kickoffTime: string;
}

export interface LiveScoreResponse {
  items: LiveScoreItem[];
  lastSyncAt: string;
  liveCount: number;
  upcomingCount: number;
  finishedCount: number;
}

export interface MatchDetailResponse {
  match: MatchItem;
  injuryReports?: InjuryReport[];
  injurySummary?: { homeHigh: number; homeMedium: number; awayHigh: number; awayMedium: number };
}

export interface BasketballTeamStat {
  winRate?: number | null;
  pointsPerGame?: number | null;
  reboundsPerGame?: number | null;
  assistsPerGame?: number | null;
  fieldGoalPct?: number | null;
  threePointPct?: number | null;
  homeRecord?: string | null;
  awayRecord?: string | null;
}

export interface BasketballRadarData {
  offense: number;
  defense: number;
  rebounds: number;
  threePoint: number;
  pace: number;
  depth?: number;
  inside?: number;
  form?: number;
}

export interface BasketballRecentGame {
  date: string;
  opponent: string;
  isHome: boolean;
  teamScore: number;
  opponentScore: number;
  result: 'W' | 'L';
  handicapResult?: 'W' | 'L' | 'P';
  totalResult?: 'O' | 'U';
  totalLine?: number;
  note?: string;
}

export interface BasketballInjury {
  name: string;
  position: string;
  injuryType: string;
  status: 'out' | 'doubtful' | 'questionable' | 'probable';
}

export interface BasketballKeyPlayer {
  name: string;
  position: string;
  ppg: number;
  rpg: number;
  apg: number;
  fgPct?: number;
  bpg?: number;
  note?: string;
}

export interface BasketballH2HGame {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  handicapLine?: number;
  totalLine?: number;
  handicapResult?: 'HW' | 'HL' | 'P';
  totalResult?: 'O' | 'U';
  note?: string;
}

export interface BasketballTeamProfile {
  winRate?: number | null;
  pointsPerGame?: number | null;
  reboundsPerGame?: number | null;
  assistsPerGame?: number | null;
  fieldGoalPct?: number | null;
  threePointPct?: number | null;
  homeRecord?: string | null;
  awayRecord?: string | null;
}

export interface BasketballSpreadProb {
  range1_5: number;
  range6_10: number;
  range11_15: number;
  range16_20: number;
  range21Plus: number;
  topRange: string;
}

export interface BasketballMatchItem {
  id: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  matchDate: string;
  businessDate: string;
  venue: string;
  source?: string;
  sourceMatchId?: string;
  homeWinProb: number;
  awayWinProb: number;
  predictionDirection: string;
  handicap: string;
  handicapCoverProb: number;
  handicapRecommendation: string;
  handicapPick: string;
  handicapPickProb: number;
  totalLine: string;
  overProb: number;
  underProb: number;
  totalDirection: string;
  totalPick: string;
  totalPickProb: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedTotal?: number;
  confidence: number;
  isModelAnalyzed?: boolean;
  wdwAnalyzed?: boolean;
  handicapAnalyzed?: boolean;
  totalAnalyzed?: boolean;
  ouConfidence?: '高' | '中' | '低';
  handicapConfidence?: '高' | '中' | '低';
  intel: string;
  riskWarning: string;
  matchStatus: 'upcoming' | 'live' | 'finished' | 'result_pending' | 'finished_pending' | 'pending_sale';
  homeScore?: number | null;
  awayScore?: number | null;
  livePeriod?: number | null;
  liveClock?: string | null;
  livePeriodEstimated?: boolean;
  lastScoreAt?: string | null;
  liveScoreSource?: string;
  hitWdw?: boolean | null;
  hitHandicap?: boolean | null;
  hitOverunder?: boolean | null;
  isNeutral: boolean;
  category: 'official' | 'overseas' | 'wnba';
  handicapOddsHome?: number | null;
  handicapOddsAway?: number | null;
  totalOddsOver?: number | null;
  totalOddsUnder?: number | null;
  homeWinOdds?: number | null;
  awayWinOdds?: number | null;
  spreadProb1_5: number;
  spreadProb6_10: number;
  spreadProb11_15: number;
  spreadProb16_20: number;
  spreadProb21Plus: number;
  spreadTopRange: string;
  lastDataSyncAt?: string | null;
  lastOddsUpdateAt?: string | null;
  dataUpdatedAt: string;
  homeStats?: BasketballTeamStat | null;
  awayStats?: BasketballTeamStat | null;
  homeRadar?: BasketballRadarData | null;
  awayRadar?: BasketballRadarData | null;
  homeRecentForm?: string | null;
  awayRecentForm?: string | null;
  recentFormDetail?: {
    home: Array<{
      date: string;
      opponent: string;
      isHome: boolean;
      scoreFor: number;
      scoreAgainst: number;
      pointDiff: number;
      result: 'win' | 'loss';
    }>;
    away: Array<{
      date: string;
      opponent: string;
      isHome: boolean;
      scoreFor: number;
      scoreAgainst: number;
      pointDiff: number;
      result: 'win' | 'loss';
    }>;
    computedAt?: string;
  } | null;
  homeInjuries?: string[] | null;
  awayInjuries?: string[] | null;
  h2hHistory?: BasketballH2HGame[] | null;
  homeTeamProfile?: BasketballTeamProfile | null;
  awayTeamProfile?: BasketballTeamProfile | null;
  predHtHome: number;
  predHtAway: number;
  intelSummary: string;
  upsetWarning: string;
  modelRules: string[];
  homeKeyPlayers?: BasketballKeyPlayer[] | null;
  awayKeyPlayers?: BasketballKeyPlayer[] | null;
  isFavorited?: boolean;
  handicapLineNum: number;
  totalLineNum: number;
  teamNews: string;
  injuries: string;
  mediaConsensus: string;
  expertPicks: string;
  keyPlayers: string;
  intelUpdatedAt?: string;
  predEngineVersion?: string;
  predictionAnchor?: 'spread_anchored' | 'no_line_fallback' | 'legacy';
  subModels?: BasketballSubModelRef[];
  injuryAdjustApplied?: number;
  injuryAdjustPct?: number;
  injuryUpdatedAt?: string;
  intelAdjustments?: IntelAdjustments | null;
  isOfficialLocked?: boolean;
   advancedDataReady?: boolean;
   advancedDataNotice?: string;
   wdwIsWait?: boolean;
   handicapIsWait?: boolean;
   totalIsWait?: boolean;
   handicapPendingLine?: boolean;
   totalPendingLine?: boolean;
    starRating?: StarRating;
   divergenceStatus?: 'consistent' | 'divergent' | 'unknown';
   divergenceDetail?: DivergenceDetail | null;
   oddsMovements?: Array<{ time: string; type: string; oldValue: string; newValue: string }> | null;
 }

export interface IntelAdjustments {
  r80Injury?: {
    spread: number;
    total: number;
    homeCoreMissing: number;
    awayCoreMissing: number;
    detail: string;
    injuryRules?: string[];
    ruleVersion?: string;
  } | null;
  r44H2h?: { spread: number; detail: string } | null;
  r81Form?: {
    spread: number;
    total: number;
    homeFormScore: number;
    awayFormScore: number;
    detail: string;
  } | null;
  totalSpreadAdjust?: number;
  totalTotalAdjust?: number;
  applied?: boolean;
}

export interface DivergenceDetail {
  handicap: 'consistent' | 'divergent' | 'unknown';
  total: 'consistent' | 'divergent' | 'unknown';
  wdw: 'consistent' | 'divergent' | 'unknown';
  sourceCount: number;
}

export interface BasketballListResponse {
  items: BasketballMatchItem[];
  date: string;
  total: number;
  highConfCount: number;
  page: number;
  pageSize: number;
}

export interface BasketballSubModelRef {
  key: 'spread_anchor' | 'elo' | 'kalman' | 'pace_rating' | 'model_reference';
  label: string;
  role: 'anchor' | 'reference' | 'fallback';
  homeWinProb: number;
  awayWinProb: number;
  predictionDirection: string;
  note?: string;
}

export interface InjuryReport {
  id: string;
  matchId?: string;
  sport: string;
  teamSide: 'home' | 'away';
  teamName: string;
  playerName: string;
  position: string;
  injuryType: string;
  status: string;
  impactRating: 'high' | 'medium' | 'low';
  expectedReturn: string;
  source: string;
  dataSource: string;
  shortComment: string;
  longComment: string;
  injuryDate?: string;
}

export interface BasketballDetailResponse {
  match: BasketballMatchItem;
  injuryReports: InjuryReport[];
  injurySummary?: {
    homeHigh: number;
    homeMedium: number;
    awayHigh: number;
    awayMedium: number;
  };
}

export interface BasketballDataSourceStatusItem {
  league: string;
  coverage: 'espn_auto' | 'backup_manual' | 'nbl_official_auto';
  source: string;
  hasLiveScore: boolean;
}

export interface BasketballDataSourceStatusResponse {
  items: BasketballDataSourceStatusItem[];
}

export interface BasketballDateStatsItem {
  date: string;
  totalMatches: number;
  finishedCount: number;
  upcomingCount: number;
  wdwHitRate: number;
  handicapHitRate: number;
  overUnderHitRate: number;
  wdwTotal: number;
  wdwHit: number;
  wdwAccuracy: number;
  handicapTotal: number;
  handicapHit: number;
  handicapAccuracy: number;
  overunderTotal: number;
  overunderHit: number;
  overunderAccuracy: number;
  hasData: boolean;
}

export interface BasketballDateStatsResponse {
  items: BasketballDateStatsItem[];
}

export interface BasketballStatsOverview {
  totalWdw: number;
  totalHandicap: number;
  totalOverUnder: number;
  wdwHitRate: number;
  handicapHitRate: number;
  overUnderHitRate: number;
  totalMatches: number;
  finishedMatches: number;
}

export interface BasketballStatsByLeague {
  league: string;
  total: number;
  wdwHitRate: number;
  handicapHitRate: number;
  overUnderHitRate: number;
}

export interface BasketballStatsByRange {
  range: string;
  total: number;
  hitRate: number;
}

export interface BasketballStatsByConfidence {
  level: string;
  total: number;
  hitRate: number;
}

export interface BasketballRecentHitItem {
  id: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  predictionDirection: string;
  handicapPick: string;
  totalPick: string;
  hitWdw: boolean;
  hitHandicap: boolean;
  hitOverunder: boolean;
  matchDate: string;
}

export interface BasketballStatsResponse {
  overview: BasketballStatsOverview;
  byLeague: BasketballStatsByLeague[];
  bySpreadRange: BasketballStatsByRange[];
  byConfidence: BasketballStatsByConfidence[];
  recentHits: BasketballRecentHitItem[];
}

export interface BasketballParlayPick {
  matchId: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  pickType: 'wdw' | 'handicap' | 'total';
  pickDirection: string;
  odds: number;
  singleProb: number;
  totalLineNum?: number;
  handicapLineNum?: number;
}

export interface BasketballParlayCombo {
  type: string;
  playType: 'handicap' | 'total';
  name: string;
  salesDay: string;
  league: string;
  picks: BasketballParlayPick[];
  totalOdds: number;
  hitProbability: number;
  expectedReturn: number;
  description: string;
  note?: string;
  confidenceBreakdown?: { high: number; mid: number; low: number };
  similarHistoricalHitRate?: number | null;
  riskNote?: string;
}

export interface BasketballParlayMatch {
  id: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  confidence: number;
  handicap: string;
  handicapLineNum: number;
  handicapRecommendation: string;
  handicapOddsHome: number | null;
  handicapOddsAway: number | null;
  totalLineNum: number;
  totalOddsOver: number | null;
  totalOddsUnder: number | null;
  homeWinOdds: number | null;
  awayWinOdds: number | null;
  predictionDirection?: string;
  matchStatus: string;
}

export interface BasketballParlayResponse {
  date: string;
  combos: BasketballParlayCombo[];
  availableMatches: BasketballParlayMatch[];
}

export interface MemberInfo {
  level: 'free' | 'monthly' | 'yearly' | 'vip';
  role: 'user' | 'admin';
  expireAt?: string;
  daysLeft: number;
  isActive: boolean;
  welcomeGift?: boolean;
}

export interface CardInfo {
  id: string;
  code: string;
  cardType: 'monthly' | 'yearly' | 'vip';
  days: number;
  status: 'unused' | 'used';
  usedBy?: string;
  usedAt?: string;
  amount?: number;
  createdAt: string;
}

export interface ActivateCardRequest {
  code: string;
}

export interface ActivateCardResponse {
  success: boolean;
  level: string;
  expireAt: string;
  daysLeft: number;
  message: string;
}

export interface CardListResponse {
  items: CardInfo[];
  total: number;
}

export interface CreateCardsRequest {
  cardType: 'monthly' | 'yearly' | 'vip';
  days: number;
  count: number;
  amount?: number;
  prefix?: string;
}

export interface CreateCardsResponse {
  items: CardInfo[];
  count: number;
}

export interface MemberUserInfo {
  userId: string;
  userName?: string;
  level: string;
  expireAt?: string;
  daysLeft: number;
  createdAt: string;
}

export interface MemberSettings {
  wechatQrUrl: string;
  alipayQrUrl: string;
  customerWechat: string;
  monthlyPrice: number;
  yearlyPrice: number;
  vipPrice: number;
}

export interface UpdateMemberSettingsRequest {
  wechatQrUrl?: string;
  alipayQrUrl?: string;
  customerWechat?: string;
  monthlyPrice?: number;
  yearlyPrice?: number;
  vipPrice?: number;
}

export interface CreateMatchRequest {
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  predictionDirection: string;
  handicap: string;
  handicapRecommendation: string;
  handicapType?: 'official' | 'estimated';
  confidence: number;
  lowConfidence: boolean;
  drawWarning?: boolean;
  intel: string;
  modelRules: string[];
  matchDate: string;
  overUnder?: string;
  overProb?: number;
  underProb?: number;
  totalGoals?: number;
  totalPick?: string;
  totalPickProb?: number;
  mostLikelyScore?: string;
  scoreProbs?: string[];
  matchStatus?: 'upcoming' | 'finished' | 'cancelled';
  homeScore?: number | null;
  awayScore?: number | null;
  homeForm?: string[];
  awayForm?: string[];
  h2h?: string[];
  oddsOpenHome?: number | null;
  oddsOpenDraw?: number | null;
  oddsOpenAway?: number | null;
  oddsLiveHome?: number | null;
  oddsLiveDraw?: number | null;
  oddsLiveAway?: number | null;
  drawConfidence?: '高' | '中' | '低';
  drawFactors?: string[];
  handicapWinProb?: number;
  handicapDrawProb?: number;
  handicapLoseProb?: number;
  kellyH?: number;
  kellyD?: number;
  kellyA?: number;
  handicapSecondChoice?: string;
  handicapValueRating?: string;
  rulesTriggered?: RuleTriggeredItem[];
  hitWdw?: boolean | null;
  hitHandicap?: boolean | null;
  hitOverunder?: boolean | null;
  hitGoals?: boolean | null;
  hitHalffull?: boolean | null;
  errorReason?: string;
  homeInjuries?: string;
  awayInjuries?: string;
  tacticsHome?: string;
  tacticsAway?: string;
  keyPlayersHome?: string;
  keyPlayersAway?: string;
  upsetWarning?: string;
  teamNews?: string;
  injuries?: string;
  mediaConsensus?: string;
  expertPicks?: string;
  keyPlayers?: string;
  verifiedTwoSources?: boolean;
}

export interface UpdateMatchRequest extends Partial<CreateMatchRequest> {}

export type SportType = 'football' | 'basketball';

export interface FavoriteItem {
  id: string;
  matchId: string;
  sportType: SportType;
  createdAt: string;
  match: MatchItem;
}

export interface BasketballFavoriteItem {
  id: string;
  matchId: string;
  sportType: SportType;
  createdAt: string;
  match: BasketballMatchItem;
}

export interface FavoriteListResponse {
  items: FavoriteItem[] | BasketballFavoriteItem[];
  sportType: SportType;
}

export interface PredictionRecordItem {
  id: string;
  matchId: string;
  actionType: string;
  viewedAt: string;
  createdAt: string;
  match: MatchItem;
}

export interface PredictionRecordListResponse {
  items: PredictionRecordItem[];
}

export interface TeamItem {
  id: string;
  name: string;
  league: string;
  foundedYear?: number;
  stadium: string;
  capacity: number;
  rank: number;
  homeRecord: string;
  awayRecord: string;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  tacticSystem: string;
  corePlayers: string[];
  recentForm: string[];
  description: string;
  logoUrl: string;
}

export interface TeamSearchResponse {
  items: TeamItem[];
  total: number;
}

export interface InjuryItem {
  id: string;
  teamId?: string;
  teamName: string;
  playerName: string;
  position: string;
  injuryType: string;
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
  expectedReturn?: string;
  status: string;
}

export interface InjuryListResponse {
  items: InjuryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MatchInjuriesResponse {
  home: InjuryItem[];
  away: InjuryItem[];
  dataSources?: string[];
}

export interface OddsRecordItem {
  id: string;
  matchId: string;
  bookmaker: string;
  oddsType: string;
  homeValue?: number;
  drawValue?: number;
  awayValue?: number;
  handicapValue: string;
  overValue?: number;
  underValue?: number;
  totalLine: number;
  snapshotTime: string;
  isInitial: boolean;
}

export interface MatchOddsResponse {
  records: OddsRecordItem[];
  openOdds?: OddsRecordItem;
  liveOdds?: OddsRecordItem;
  changes: {
    homeChange: number;
    drawChange: number;
    awayChange: number;
    hasMajorMove: boolean;
  };
}

export interface OddsTrendPoint {
  time: string;
  oddsType: '1x2' | 'handicap' | 'total';
  source: string;
  home?: number;
  draw?: number;
  away?: number;
  line?: number;
  over?: number;
  under?: number;
}

export interface OddsTrendResponse {
  items: OddsTrendPoint[];
  hasData: boolean;
  pointCount: number;
  types: string[];
}

export interface MatchSourceOdds {
  source: string;
  updatedAt: string;
  homeWinOdds?: number;
  drawOdds?: number;
  awayWinOdds?: number;
  handicap?: string;
  handicapOddsHome?: number;
  handicapOddsAway?: number;
  overUnder?: string;
  totalOddsOver?: number;
  totalOddsUnder?: number;
}

export interface MatchMultiSourceResponse {
  matchId: string;
  sources: MatchSourceOdds[];
  hasComparison: boolean;
  divergenceStatus?: 'consistent' | 'divergent' | 'unknown';
  divergenceDetail?: DivergenceDetail | null;
}

export interface OddsAlertItem {
  id: string;
  matchId: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  oddsType: '1x2' | 'handicap' | 'total';
  changePercent: number;
  changeAmount: number;
  changeDirection: 'up' | 'down';
  changedField: string;
  initialValue: number;
  currentValue: number;
  detectedAt: string;
  intel?: string;
  predictionDirection?: string;
  predictionType?: 'wdw' | 'handicap' | 'overunder';
  directionAlign?: 'consistent' | 'opposite' | 'unknown';
}

export interface OddsAlertsResponse {
  items: OddsAlertItem[];
  total: number;
  monitoredCount: number;
  matchCount: number;
}

export interface BasketballOddsAlertItem {
  id: string;
  matchId: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  alertType: 'h2h' | 'handicap' | 'total';
  team: string;
  initialValue: number;
  currentValue: number;
  changeAmount: number;
  changeDirection: 'up' | 'down';
  changePercent: number;
  detectedAt: string;
  predictionDirection?: string;
  predictionType?: 'wdw' | 'handicap' | 'overunder';
  directionAlign?: 'consistent' | 'opposite' | 'unknown';
}

export interface BasketballOddsAlertsResponse {
  items: BasketballOddsAlertItem[];
  total: number;
  monitoredCount: number;
  matchCount: number;
}

export interface ModelRuleDetail {
  id: string;
  ruleCode: string;
  ruleName: string;
  category: string;
  triggerCondition: string;
  impactFormula: string;
  hitRate: number;
  sampleSize: number;
  description: string;
  params: string[];
  sortOrder: number;
}

export interface MatchStatsResponse {
  totalMatches: number;
  finishedMatches: number;
  winDrawWinHitRate: number;
  handicapHitRate: number;
  overUnderHitRate: number;
  byLeague: { league: string; count: number; hitRate: number }[];
  byDate: { date: string; count: number; hitRate: number }[];
  byRule: { ruleCode: string; ruleName: string; count: number; hitRate: number }[];
  byConfidence: { level: string; count: number; hitRate: number }[];
  byHandicap: { type: string; count: number; hitRate: number }[];
}

export interface TeamFormRecord {
  date: string;
  opponent: string;
  isHome: boolean;
  result: 'win' | 'draw' | 'loss';
  scoreFor: number;
  scoreAgainst: number;
  league: string;
}

export interface TeamHomeAwayStats {
  homeWinRate: number;
  homeTotal: number;
  awayWinRate: number;
  awayTotal: number;
  sampleSufficient: boolean;
}

export interface H2HRecord {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  league: string;
  matchStatus: string;
}

export interface TeamProfileResponse {
  teamName: string;
  sport: 'football' | 'basketball';
  recentMatches: TeamFormRecord[];
  recentCount: number;
  homeAwayStats: TeamHomeAwayStats;
  h2h: H2HRecord[];
  h2hCount: number;
  hasData: boolean;
  updatedAt: string;
}

export interface BasketballBacktestResponse {
  hasData: boolean;
  totalSamples: number;
  dateRange: { start: string; end: string; days: number };
  byLeague: Array<{ league: string; samples: number; wdw: number; handicap: number; overUnder: number }>;
  byConfidence: Array<{ level: string; hitRate: number; samples: number }>;
  byDepth: Array<{ depth: string; hitRate: number; samples: number }>;
  byInjury: Array<{ label: string; overRate: number; avgPoints: number; samples: number }>;
  byMonth: Array<{ month: string; handicapHit: number; overRate: number; samples: number }>;
  detailList: Array<{
    id: string;
    matchNo: string;
    league: string;
    homeTeam: string;
    awayTeam: string;
    kickoffTime: string;
    predictionDirection: string;
    hitWdw: boolean | null;
    hitHandicap: boolean | null;
    hitOverunder: boolean | null;
    confidence: number;
  }>;
}

export interface FootballBacktestResponse {
  hasData: boolean;
  totalSamples: number;
  dateRange: { start: string; end: string; days: number };
  byLeague: Array<{ league: string; samples: number; wdw: number; handicap: number; overUnder: number }>;
  byConfidence: Array<{ level: string; hitRate: number; samples: number }>;
  byHandicap: Array<{ range: string; hitRate: number; samples: number }>;
  byMonth: Array<{ month: string; wdwHit: number; overRate: number; samples: number }>;
  detailList: Array<{
    id: string;
    matchNo: string;
    league: string;
    homeTeam: string;
    awayTeam: string;
    kickoffTime: string;
    predictionDirection: string;
    hitWdw: boolean | null;
    hitHandicap: boolean | null;
    hitOverunder: boolean | null;
    confidence: number;
  }>;
}

export interface ModelRulesResponse {
  rules: ModelRuleDetail[];
  hitRate: {
    winDrawWin: number;
    overUnder: number;
    version: string;
    sampleSize: number;
  };
  disclaimer: string;
  categories: string[];
}

export interface ParlayMatchItem {
  matchId: string;
  matchNo: string;
  homeTeam: string;
  awayTeam: string;
  playType: string;
  betOption: string;
  probability: number;
  referenceIndex: number;
  handicapLine?: string;
  handicapLineNum?: number;
  totalLineNum?: number;
  hit?: boolean | null;
}

export interface ParlayItem {
  id: string;
  date: string;
  name: string;
  matches: ParlayMatchItem[];
  totalReferenceIndex: number;
  comboType: string;
  hitRate: number;
  riskLevel: 'steady' | 'balanced' | 'aggressive' | 'longshot';
  reason: string;
  status: string;
  hit?: boolean | null;
  note?: string;
  playCategory?: '让分' | '大小分' | '胜平负';
  toleranceInfo?: {
    totalBets: number;
    structure: string;
    minIndex: number;
    maxIndex: number;
    hitCondition: string;
  };
  probabilityNote?: string;
  confidenceBreakdown?: { high: number; mid: number; low: number };
  similarHistoricalHitRate?: number | null;
  riskNote?: string;
}

export interface ParlayListResponse {
  items: ParlayItem[];
  date: string;
}

export interface FollowedTeamItem {
  id: string;
  teamName: string;
  teamLogo?: string;
  createdAt: string;
}

export interface FollowedTeamListResponse {
  items: FollowedTeamItem[];
}

export interface PaymentOrderItem {
  id: string;
  orderNo: string;
  plan: string;
  amount: number;
  payMethod: string;
  status: string;
  payUrl?: string;
  paidAt?: string;
  createdAt: string;
}

export interface CreatePaymentRequest {
  plan: 'monthly' | 'yearly' | 'vip';
  payMethod: 'wechat' | 'alipay';
}

export interface CreatePaymentResponse {
  success: boolean;
  orderId: string;
  orderNo: string;
  payUrl?: string;
  qrCode?: string;
  amount: number;
  message?: string;
}

export interface PaymentSettingsResponse {
  enabled: boolean;
  provider: string;
}

export interface PlayerItem {
  id: string;
  name: string;
  team: string;
  position: string;
  nationality?: string;
  age?: number;
  rating: number;
  goals: number;
  assists: number;
  appearances: number;
  injuryStatus: string;
  recentRatings: number[];
}

export interface LeaderboardItem {
  userId: string;
  userName: string;
  hitRate: number;
  totalPicks: number;
  followers: number;
  rank: number;
}

export interface LeaderboardResponse {
  weekly: LeaderboardItem[];
  monthly: LeaderboardItem[];
}

export interface CreateBasketballMatchRequest {
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  matchDate: string;
  businessDate?: string;
  venue?: string;
  homeWinProb: number;
  awayWinProb: number;
  predictionDirection?: string;
  handicap?: string;
  handicapCoverProb?: number;
  handicapRecommendation?: string;
  handicapPick?: string;
  handicapPickProb?: number;
  totalLine?: string;
  overProb?: number;
  underProb?: number;
  totalDirection?: string;
  totalPick?: string;
  totalPickProb?: number;
  predictedHomeScore?: number;
  predictedAwayScore?: number;
  confidence?: number;
  intel?: string;
  riskWarning?: string;
  matchStatus?: 'upcoming' | 'live' | 'finished';
  homeScore?: number | null;
  awayScore?: number | null;
  hitWdw?: boolean | null;
  hitHandicap?: boolean | null;
  hitOverunder?: boolean | null;
  isNeutral?: boolean;
  category?: 'official' | 'overseas' | 'wnba';
  handicapOddsHome?: number | null;
  handicapOddsAway?: number | null;
  totalOddsOver?: number | null;
  totalOddsUnder?: number | null;
  homeWinOdds?: number | null;
  awayWinOdds?: number | null;
  spreadProb1_5?: number;
  spreadProb6_10?: number;
  spreadProb11_15?: number;
  spreadProb16_20?: number;
  spreadProb21Plus?: number;
  spreadTopRange?: string;
  modelRules?: string[];
  handicapLineNum?: number;
  totalLineNum?: number;
  predHtHome?: number;
  predHtAway?: number;
  intelSummary?: string;
  upsetWarning?: string;
  homeHalfScore?: number | null;
  awayHalfScore?: number | null;
  predictedTotal?: number;
  ouConfidence?: string;
  ouDiffVsLine?: number;
  rulesTriggered?: RuleTriggeredItem[];
  handicapConfidence?: string;
  teamNews?: string;
  injuries?: string;
  mediaConsensus?: string;
  expertPicks?: string;
  keyPlayers?: string;
  verifiedTwoSources?: boolean;
}

export interface BatchUpsertResponse {
  inserted: number;
  updated: number;
  total: number;
}

export interface DataCheckByDateItem {
  date: string;
  total: number;
  predictedCount: number;
  intelCount: number;
  emptyFieldsCount: number;
}

export interface BasketballRecalcHandicapResponse {
  recalculatedCount: number;
  fixedPickCount: number;
  fixedRecommendationCount: number;
  hitCount: number;
  missCount: number;
  pushCount: number;
}

export interface DataIntegrityIssue {
  type: 'duplicate_source_match_id' | 'duplicate_home_away_kickoff' | 'cross_date_match_no' | 'canceled_matches' | 'pending_verify' | 'missing_source_match_id';
  count: number;
  samples: string[];
}

export interface DataCheckResponse {
  total: number;
  predictedCount: number;
  intelCount: number;
  emptyFieldsCount: number;
  byDate: DataCheckByDateItem[];
  finishedCount: number;
  upcomingCount: number;
  canceledCount: number;
  integrity: DataIntegrityIssue[];
}

export interface SyncHealthResponse {
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
      leagueStats: Record<string, { success: boolean; matchCount: number; error?: string }>;
      rhythm: 'live' | 'upcoming' | 'idle';
      nextSyncAt: string | null;
    };
    espnBasketball: {
      enabled: boolean;
      lastSyncAt: string | null;
      success: boolean;
      leaguesSynced: number;
      pendingMappings: number;
      leagueStats: Record<string, { success: boolean; matchCount: number; error?: string }>;
      rhythm: 'live' | 'upcoming' | 'idle';
      nextSyncAt: string | null;
    };
    oddsApi: {
      enabled: boolean;
      lastSyncAt: string | null;
      success: boolean;
      sportsSynced: number;
      remaining: number | null;
      used: number | null;
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
  };
  syncTokenConfigured: boolean;
  espnFootballTodayCount: number;
  espnBasketballTodayCount: number;
  oddsApiTodayCount: number;
  pendingMappingTeams: {
    football: string[];
    basketball: string[];
  };
  adaptive: SyncAdaptiveStatus;
}

export interface SyncAdaptiveStatus {
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
}

export interface SyncRefreshResponse {
  triggered: boolean;
  football?: { success: boolean; leaguesSynced: number; rhythm: 'live' | 'upcoming' | 'idle' };
  basketball?: { success: boolean; leaguesSynced: number; rhythm: 'live' | 'upcoming' | 'idle' };
  sportsSynced?: number;
  remaining?: number | null;
  success?: boolean;
}

export interface UserStatsResponse {
  viewed: number;
  favorites: number;
  followedTeams: number;
  hitRate: string;
}

export interface SyncTriggerResponse {
  triggered: boolean;
  football: { inserted: number; updated: number; skipped: number; skipReasons?: { matchNo: string; reason: string }[] };
  basketball: { inserted: number; updated: number; skipped: number; skipReasons?: { matchNo: string; reason: string }[] };
  beidan?: { inserted: number; updated: number; skipped: number; skipReasons?: { matchNo: string; reason: string }[] };
  message?: string;
}

// === Admin 用户管理 ===

export interface AdminUserItem {
  id: string;
  email: string;
  role: 'admin' | 'user';
  status: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  favoritesCount: number;
  followedTeamsCount: number;
}

export interface AdminUserListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: 'admin' | 'user';
  sort?: string;
}

export interface AdminUserListResponse {
  items: AdminUserItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminStatsResponse {
  totalUsers: number;
  newToday: number;
  activeToday: number;
  onlineNow: number;
}

export interface AdminUserRoleUpdateRequest {
  role: 'admin' | 'user';
}

export interface AdminResetPasswordResponse {
  success: boolean;
  newPassword: string;
}

export interface AdminSuccessResponse {
  success: boolean;
}

export interface SupportTicket {
  id: string;
  title: string;
  category: '功能问题' | '数据问题' | '建议反馈' | '其他';
  status: 'open' | 'processing' | 'closed';
  priority: 'normal' | 'urgent';
  email?: string;
  lastMessageAt?: string;
  unreadByAdmin: number;
  unreadByUser: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessage {
  id: string;
  ticketId: string;
  sender: 'user' | 'admin';
  body: string;
  createdAt: string;
}

export interface SupportTicketWithMessages extends SupportTicket {
  messages: SupportMessage[];
}

export interface SupportTicketListItem extends SupportTicket {
  latestMessagePreview?: string;
}

export interface SupportTicketListResponse {
  items: SupportTicketListItem[];
  total: number;
}

export interface CreateSupportTicketRequest {
  title: string;
  category: '功能问题' | '数据问题' | '建议反馈' | '其他';
  email?: string;
  body: string;
}

export interface CreateSupportMessageRequest {
  body: string;
}

export interface UpdateSupportTicketStatusRequest {
  status: 'open' | 'processing' | 'closed';
}

export interface UpdateSupportTicketPriorityRequest {
  priority: 'normal' | 'urgent';
}

export interface SupportStatsResponse {
  open: number;
  processing: number;
  closed: number;
  todayNew: number;
  total: number;
}

export interface AdminSupportTicketListParams {
  status?: 'all' | 'open' | 'processing' | 'closed';
  page?: number;
  pageSize?: number;
}

export interface AdminAuditLogItem {
  id: string;
  actionType: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: string | null;
  result: 'success' | 'failed';
  errorMessage?: string | null;
  operatorId?: string | null;
  operatorEmail?: string | null;
  ipAddress?: string | null;
  createdAt: string;
}

export interface AdminAuditLogListParams {
  page?: number;
  pageSize?: number;
  actionType?: string;
  operatorId?: string;
}

export interface AdminAuditLogListResponse {
  items: AdminAuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminSyncConfigSource {
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

export interface AdminSyncConfigResponse {
  sources: AdminSyncConfigSource[];
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

export interface AdminBasketballMatchListItem {
  id: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  matchStatus: string;
  homeScore: number | null;
  awayScore: number | null;
  handicap: string;
  totalLine: string;
  confidence: number;
  predictionDirection: string;
  source: string;
  businessDate: string | null;
}

export interface AdminBasketballMatchListResponse {
  items: AdminBasketballMatchListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminBasketballMatchDetail {
  id: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  matchDate: string;
  businessDate: string | null;
  venue: string;
  source: string;
  sourceMatchId: string | null;
  homeWinProb: number;
  awayWinProb: number;
  predictionDirection: string;
  handicap: string;
  handicapCoverProb: number;
  handicapRecommendation: string;
  handicapPick: string | null;
  handicapPickProb: number;
  totalLine: string;
  overProb: number;
  underProb: number;
  totalDirection: string;
  totalPick: string | null;
  totalPickProb: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  confidence: number;
  intel: string;
  riskWarning: string;
  matchStatus: string;
  homeScore: number | null;
  awayScore: number | null;
  hitWdw: boolean | null;
  hitHandicap: boolean | null;
  hitOverunder: boolean | null;
  isNeutral: boolean;
  category: string;
  modelRules: string[];
  handicapLineNum: number | null;
  totalLineNum: number | null;
  predHtHome: number;
  predHtAway: number;
  intelSummary: string | null;
  upsetWarning: string | null;
  homeHalfScore: number | null;
  awayHalfScore: number | null;
  ouConfidence: string | null;
  handicapConfidence: string | null;
  teamNews: string | null;
  injuries: string | null;
  mediaConsensus: string | null;
  expertPicks: string | null;
  predEngineVersion: string | null;
  predictionAnchor: string | null;
  advancedDataReady: boolean | null;
  advancedDataNotice: string | null;
}

export interface CreateBasketballMatchAdminRequest {
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  matchDate: string;
  businessDate?: string;
  venue?: string;
  source?: string;
  homeWinProb?: number;
  awayWinProb?: number;
  predictionDirection?: string;
  handicap?: string;
  handicapCoverProb?: number;
  handicapRecommendation?: string;
  handicapPick?: string;
  handicapPickProb?: number;
  totalLine?: string;
  overProb?: number;
  underProb?: number;
  totalDirection?: string;
  totalPick?: string;
  totalPickProb?: number;
  predictedHomeScore?: number;
  predictedAwayScore?: number;
  confidence?: number;
  intel?: string;
  riskWarning?: string;
  matchStatus?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  isNeutral?: boolean;
  category?: string;
  modelRules?: string[];
  handicapLineNum?: number | null;
  totalLineNum?: number | null;
}

export interface UpdateBasketballMatchAdminRequest {
  matchNo?: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  kickoffTime?: string;
  matchDate?: string;
  businessDate?: string | null;
  venue?: string;
  homeWinProb?: number;
  awayWinProb?: number;
  predictionDirection?: string;
  handicap?: string;
  handicapCoverProb?: number;
  handicapRecommendation?: string;
  handicapPick?: string | null;
  handicapPickProb?: number;
  totalLine?: string;
  overProb?: number;
  underProb?: number;
  totalDirection?: string;
  totalPick?: string | null;
  totalPickProb?: number;
  predictedHomeScore?: number;
  predictedAwayScore?: number;
  confidence?: number;
  intel?: string;
  riskWarning?: string;
  matchStatus?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  hitWdw?: boolean | null;
  hitHandicap?: boolean | null;
  hitOverunder?: boolean | null;
  isNeutral?: boolean;
  category?: string;
  modelRules?: string[];
  handicapLineNum?: number | null;
  totalLineNum?: number | null;
  predHtHome?: number;
  predHtAway?: number;
  intelSummary?: string | null;
  upsetWarning?: string | null;
  homeHalfScore?: number | null;
  awayHalfScore?: number | null;
  ouConfidence?: string | null;
  handicapConfidence?: string | null;
  teamNews?: string | null;
  injuries?: string | null;
  mediaConsensus?: string | null;
  expertPicks?: string | null;
}

export interface UpdateBasketballScoreRequest {
  homeScore?: number | null;
  awayScore?: number | null;
  matchStatus?: string;
}

export interface PredictionAccuracyResponse {
  hasData: boolean;
  sampleSize: number;
  totalFinished: number;
  directionalCount: number;
  directionRate: number;
  days: number;
  updatedAt: string;
  wdw: {
    hitRate: number;
    total: number;
    hits: number;
  };
  handicap: {
    hitRate: number;
    total: number;
    hits: number;
  };
  overUnder: {
    hitRate: number;
    total: number;
    hits: number;
  };
  dailyTrend: Array<{
    date: string;
    wdwRate: number;
    wdwTotal: number;
    handicapRate: number;
    handicapTotal: number;
    overUnderRate: number;
    overUnderTotal: number;
  }>;
}

export interface AutoCheckIssue {
  category: string;
  subCategory: string;
  severity: 'low' | 'medium' | 'high';
  matchId: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  detail: string;
  autoFixable: boolean;
  fixStatus: 'pending' | 'fixed' | 'failed';
  fixDetail: string;
}

export interface AutoCheckSummary {
  integrity: {
    total: number;
    predicted: number;
    emptyFields: number;
    duplicateMatchNos: number;
  };
  statusFlow: {
    finished: number;
    pendingHit: number;
    stuckLive: number;
    stuckLiveAutoFixed: number;
    stuckLivePending: number;
    wrongFinished: number;
    staleUpcoming: number;
  };
  periodDisplay: {
    reliable: number;
    estimated: number;
    misleading: number;
    otMislabeled: number;
  };
  dataCorrectness: {
    lineValid: number;
    directionConsistent: number;
    scoreAnomalies: number;
  };
  hitBackfill: {
    finishedWithHit: number;
    finishedMissingHit: number;
    hitMismatch: number;
  };
  modelBaseline: {
    v11Count: number;
    baselineByLeague: Record<string, number>;
    emptyFeatures: number;
    injuryAdjustApplied: number;
  };
}

export interface AutoCheckReport {
  id: string;
  checkType: string;
  triggerSource: string;
  triggerTask: string | null;
  status: string;
  totalMatches: number;
  upcomingCount: number;
  liveCount: number;
  finishedCount: number;
  totalIssues: number;
  autoFixed: number;
  needsManual: number;
  durationMs: number;
  errorMessage: string | null;
  summary: AutoCheckSummary;
  issues: AutoCheckIssue[];
  createdAt: string;
}

export interface AutoCheckReportListResponse {
  items: AutoCheckReport[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BasketballFinalCard {
  matchNo: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  league: string;
  officialLines: {
    handicapLine: number | null;
    totalLine: number | null;
    isLocked: boolean;
  };
  injuries: {
    home: Array<{ name: string; position?: string; status?: string }>;
    away: Array<{ name: string; position?: string; status?: string }>;
    source: string;
  };
  efficiencyBaseline: {
    homePpg: number | null;
    homeOppg: number | null;
    awayPpg: number | null;
    awayOppg: number | null;
    recentFormHome: string[] | null;
    recentFormAway: string[] | null;
  };
  predictions: {
    wdwDirection: string | null;
    wdwHomeProb: number | null;
    wdwAwayProb: number | null;
    handicapDirection: string | null;
    handicapLine: number | null;
    handicapProb: number | null;
    totalDirection: string | null;
    totalLine: number | null;
    overProb: number | null;
    underProb: number | null;
    predictedTotal: number | null;
    diffVsLine: number | null;
    confidence: string | null;
    engineVersion: string | null;
  };
}

export interface DailyReviewByLeagueItem {
  league: string;
  total: number;
  hdcHit: number;
  hdcRate: number;
  ouHit: number;
  ouRate: number;
}

export interface DailyReviewMatchItem {
  id: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  homeScore: number | null;
  awayScore: number | null;
  predictionDirection: string;
  handicapRecommendation: string;
  handicapLine: number;
  totalDirection: string;
  totalLine: number;
  hitWdw: boolean | null;
  hitHandicap: boolean | null;
  hitOverunder: boolean | null;
  confidence: number;
}

export interface DailyReviewAnomalyMatch {
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  handicapDir: string;
  handicapLine: number;
  actualSpread: number;
  hit: boolean;
  totalDir: string;
  totalLine: number;
  actualTotal: number;
  totalHit: boolean;
  deviationNote: string;
}

export interface DailyReviewResponse {
  id: string;
  reviewDate: string;
  sport: string;
  source: string;
  totalMatches: number;
  wdwHit: number | null;
  wdwTotal: number | null;
  wdwRate: number | null;
  handicapHit: number | null;
  handicapTotal: number | null;
  handicapRate: number | null;
  overunderHit: number | null;
  overunderTotal: number | null;
  overunderRate: number | null;
  byLeague: DailyReviewByLeagueItem[];
  anomalyMatches: DailyReviewAnomalyMatch[];
  matches: DailyReviewMatchItem[];
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}
