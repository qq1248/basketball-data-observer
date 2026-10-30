import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Heart,
  HeartOff,
  Shield,
  Target,
  Users,
  Calendar,
  MapPin,
  Users2,
  Swords,
  AlertTriangle,
  FileText,
  History,
  Home,
  Plane,
  Swords as SwordsIcon,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { getTeamDetail, getTeamProfile } from '@client/src/api/teams';
import { getTeamInjuries } from '@client/src/api/injuries';
import { playersApi } from '@client/src/api';
import { useSyncStore } from '@client/src/hooks/useSyncStore';
import { toast } from 'sonner';
import type { TeamItem, InjuryItem, PlayerItem, TeamProfileResponse, TeamFormRecord, H2HRecord } from '@shared/api.interface';

const FORM_COLORS: Record<string, string> = {
  W: 'bg-nebula-crimson text-white',
  D: 'bg-muted text-foreground',
  L: 'bg-[var(--muted-foreground)]/20 text-[var(--muted-foreground)]',
};

const IMPACT_STYLES: Record<string, { label: string; className: string }> = {
  low: { label: '低', className: 'bg-nebula-crimson/10 text-nebula-crimson border border-nebula-crimson/30' },
  medium: { label: '中', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  high: { label: '高', className: 'bg-orange-50 text-orange-700 border border-orange-200' },
  critical: { label: '严重', className: 'bg-red-50 text-red-700 border border-red-200' },
};

const TeamDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [team, setTeam] = useState<TeamItem | null>(null);
  const [injuries, setInjuries] = useState<InjuryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const syncStore = useSyncStore();
  const followed = team?.name ? syncStore.isFollowingTeam(team.name) : false;
  const [players, setPlayers] = useState<PlayerItem[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const [searchParams] = useSearchParams();
  const opponent = searchParams.get('opponent');

  useEffect(() => {
    if (!id) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [teamRes, injRes] = await Promise.all([
          getTeamDetail(id),
          getTeamInjuries(id).catch(() => ({ items: [] })),
        ]);
        setTeam(teamRes.team);
        setInjuries(injRes.items);

        if (teamRes.team?.name) {
          setPlayersLoading(true);
          try {
            const playerData = await playersApi.getPlayersByTeam(teamRes.team.name);
            setPlayers(playerData);
          } catch {
            setPlayers([]);
          } finally {
            setPlayersLoading(false);
          }

          // 加载球队档案（近期战绩/主客场/H2H）
          setProfileLoading(true);
          setProfileError(false);
          try {
            const profileRes = await getTeamProfile(teamRes.team.name, 'football', opponent || undefined);
            setProfile(profileRes);
          } catch {
            setProfileError(true);
          } finally {
            setProfileLoading(false);
          }
        }

      } catch (error) {
        logger.error('加载球队详情失败', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, opponent]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleFollow = () => {
    if (!team?.name) return;
    if (followed) {
      syncStore.unfollowTeam(team.name);
      toast.success('已取消关注');
    } else {
      syncStore.followTeam(team.name);
      toast.success('关注成功');
    }
  };

  if (loading) {
    return (
      <div className="min-h-full bg-background pb-24">
        <div className="bg-gradient-to-b from-white to-background px-4 pt-6 pb-8 md:px-6">
          <div className="flex items-center gap-3 mb-4">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-6 w-40" />
          </div>
        </div>
        <div className="px-4 md:px-6 space-y-4">
          <Skeleton className="h-32 w-full rounded-3xl" />
          <Skeleton className="h-40 w-full rounded-3xl" />
          <Skeleton className="h-48 w-full rounded-3xl" />
        </div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="px-4 md:px-6 py-5">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />
          返回
        </Button>
        <div className="text-center py-16">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">球队不存在或已被删除</p>
        </div>
      </div>
    );
  }

  const gf = Number(team.avgGoalsFor) || 0;
  const ga = Number(team.avgGoalsAgainst) || 0;
  const totalAvg = gf + ga;
  const gfPercent = totalAvg > 0 ? (gf / totalAvg) * 100 : 50;

  return (
    <div className="min-h-full bg-background pb-24">
      {/* Hero 区 */}
      <div className="bg-gradient-to-b from-white to-background px-4 pt-6 pb-6 md:px-6 md:pt-8 md:pb-8">
        <div className="flex items-center gap-3 mb-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="h-8 w-8"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="eyebrow eyebrow-line mb-1.5">TEAM PROFILE</div>
            <h1 className="text-2xl font-black tracking-tight text-foreground truncate">
              {team.name}
            </h1>
            <p className="text-sm text-muted-foreground">{team.league}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleFollow}
            disabled={false}
            className="flex-shrink-0"
          >
            {followed ? (
              <>
                <Heart className="w-4 h-4 text-nebula-crimson fill-nebula-crimson" />
                已关注
              </>
            ) : (
              <>
                <HeartOff className="w-4 h-4" />
                关注
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="px-4 md:px-6 space-y-4">
        {/* 基本信息卡 */}
        <div className="metric-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-nebula-crimson" />
            </div>
            <h2 className="text-base font-black tracking-tight text-foreground">基本信息</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                成立时间
              </div>
              <div className="text-foreground font-medium">
                {team.foundedYear || '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                主场
              </div>
              <div className="text-foreground font-medium truncate">
                {team.stadium || '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Users2 className="w-3 h-3" />
                容量
              </div>
              <div className="text-foreground font-medium">
                {team.capacity?.toLocaleString() || '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">联赛排名</div>
              <div className="text-nebula-crimson font-mono font-black text-lg tabular-nums">
                {team.rank ? `第 ${team.rank} 名` : '暂无排名'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border/60">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">主场战绩</div>
              <div className="text-sm font-mono font-bold text-nebula-crimson tabular-nums">
                {team.homeRecord || '-'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">客场战绩</div>
              <div className="text-sm font-mono font-bold text-gray-500 tabular-nums">
                {team.awayRecord || '-'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
                <Swords className="w-3 h-3" />
                战术体系
              </div>
              <div className="text-sm font-mono font-semibold text-foreground">
                {team.tacticSystem || '-'}
              </div>
            </div>
          </div>
        </div>

        {/* 攻防数据 */}
        <div className="metric-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <Target className="w-4 h-4 text-nebula-crimson" />
            </div>
            <h2 className="text-base font-black tracking-tight text-foreground">攻防数据</h2>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-nebula-crimson font-black flex items-center gap-1">
                <Target className="w-3.5 h-3.5" />
                场均进球 {gf.toFixed(2)}
              </span>
              <span className="text-gray-500 font-medium flex items-center gap-1">
                场均失球 {ga.toFixed(2)}
                <Shield className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden bg-muted">
              <div
                className="bg-gradient-to-r from-red-900 to-nebula-crimson transition-all duration-[1.5s] ease-out"
                style={{ width: `${gfPercent}%` }}
              />
              <div
                className="bg-gray-300 transition-all duration-[1.5s] ease-out"
                style={{ width: `${100 - gfPercent}%` }}
              />
            </div>
          </div>

          {/* 近5场战绩 */}
          <div className="mt-4 pt-4 border-t border-border/60">
            <div className="text-xs text-muted-foreground mb-2">近5场战绩</div>
            <div className="flex gap-2">
              {team.recentForm?.slice(0, 5).map((f, idx) => (
                <span
                  key={idx}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black ${FORM_COLORS[f] || 'bg-muted text-muted-foreground'}`}
                >
                  {f}
                </span>
              ))}
              {(!team.recentForm || team.recentForm.length === 0) && (
                <span className="text-sm text-muted-foreground/60">暂无数据</span>
              )}
            </div>
          </div>
        </div>

        {/* 核心球员 */}
        <div className="metric-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-nebula-crimson" />
            </div>
            <h2 className="text-base font-black tracking-tight text-foreground">核心球员</h2>
          </div>
          {team.corePlayers && team.corePlayers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {team.corePlayers.map((player, idx) => (
                <Badge key={idx} variant="secondary" className="px-3 py-1 bg-nebula-crimson/10 text-nebula-crimson border-nebula-crimson/20">
                  {player}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无核心球员数据</p>
          )}
        </div>

        {/* 伤停情况 */}
        <div className="metric-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <h2 className="text-base font-black tracking-tight text-foreground">伤停名单</h2>
            {injuries.length > 0 && (
              <Badge variant="destructive" className="ml-auto">
                {injuries.length}人
              </Badge>
            )}
          </div>
          {injuries.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无伤停情况</p>
          ) : (
            <div className="space-y-2">
              {injuries.map((inj) => {
                const impact = IMPACT_STYLES[inj.impactLevel] || IMPACT_STYLES.medium;
                return (
                  <div
                    key={inj.id}
                    className="flex items-center justify-between py-2 px-3 rounded-xl bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">
                        {inj.playerName}
                        <span className="text-xs text-muted-foreground ml-2">
                          {inj.position}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {inj.injuryType}
                      </div>
                    </div>
                    <Badge className={impact.className} variant="outline">
                      {impact.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 球队阵容 */}
        <div className="metric-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-nebula-crimson" />
            </div>
            <h2 className="text-base font-black tracking-tight text-foreground">球队阵容</h2>
            {players.length > 0 && (
              <Badge variant="secondary" className="ml-auto">
                {players.length}人
              </Badge>
            )}
          </div>

          {playersLoading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-5 w-16 bg-muted/60 rounded" />
              <div className="h-8 bg-muted/40 rounded" />
              <div className="h-8 bg-muted/40 rounded" />
              <div className="h-5 w-16 bg-muted/60 rounded mt-3" />
              <div className="h-8 bg-muted/40 rounded" />
            </div>
          ) : players.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无阵容数据</p>
          ) : (
            <div className="space-y-4">
              {(['前锋', '中场', '后卫', '门将'] as const).map((positionGroup) => {
                const groupPlayers = players.filter((p) => {
                  const pos = p.position || '';
                  if (positionGroup === '前锋') return ['FW', '前锋', '前锋'].some((k) => pos.includes(k));
                  if (positionGroup === '中场') return ['MF', '中场'].some((k) => pos.includes(k));
                  if (positionGroup === '后卫') return ['DF', '后卫'].some((k) => pos.includes(k));
                  if (positionGroup === '门将') return ['GK', '门将'].some((k) => pos.includes(k));
                  return false;
                }).sort((a, b) => b.rating - a.rating);

                if (groupPlayers.length === 0) return null;

                return (
                  <div key={positionGroup}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-black text-foreground">{positionGroup}</span>
                      <div className="flex-1 h-px bg-border/60" />
                      <span className="text-xs text-muted-foreground">{groupPlayers.length}人</span>
                    </div>
                    <div className="space-y-1">
                      {groupPlayers.map((player, idx) => {
                        const injuryBadge = (() => {
                          const s = player.injuryStatus?.toLowerCase() || '';
                          if (s === 'out' || s === '伤停' || s.includes('out')) {
                            return { label: '伤停', className: 'bg-red-50 text-red-700 border border-red-200' };
                          }
                          if (s === 'doubt' || s === '存疑' || s.includes('doubt')) {
                            return { label: '存疑', className: 'bg-amber-50 text-amber-700 border border-amber-200' };
                          }
                          return null;
                        })();
                        const ratingColor = player.rating >= 8
                          ? 'text-nebula-crimson'
                          : player.rating >= 7
                          ? 'text-foreground'
                          : 'text-muted-foreground';
                        return (
                          <div
                            key={player.id}
                            className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-muted/40 transition-colors"
                          >
                            <span className="w-6 text-center text-xs font-mono text-muted-foreground flex-shrink-0">
                              {idx + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground truncate">{player.name}</span>
                                {injuryBadge && (
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0 ${injuryBadge.className}`}>
                                    {injuryBadge.label}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground/70">{player.position}</div>
                            </div>
                            <span className={`text-sm font-mono font-black ${ratingColor} flex-shrink-0 tabular-nums`}>
                              {player.rating.toFixed(1)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 球队简介 */}
        <div className="metric-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-nebula-crimson" />
            </div>
            <h2 className="text-base font-black tracking-tight text-foreground">球队简介</h2>
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed">
            {team.description || '暂无球队简介'}
          </p>
        </div>

        {/* 近期战绩 */}
        <div className="metric-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <History className="w-4 h-4 text-nebula-crimson" />
            </div>
            <h2 className="text-base font-black tracking-tight text-foreground">近期战绩</h2>
            <span className="text-xs text-muted-foreground ml-auto">
              近 {profile?.recentCount || 0} 场
            </span>
          </div>
          {profileLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="w-28 h-24 rounded-xl bg-muted/50 animate-pulse flex-shrink-0" />
              ))}
            </div>
          ) : profileError ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              加载失败，请稍后重试
            </div>
          ) : !profile?.recentMatches || profile.recentMatches.length === 0 ? (
            <div className="text-center py-6">
              <History className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">暂无历史数据</p>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {profile.recentMatches.map((match: TeamFormRecord, idx: number) => {
                const resultMap: Record<string, { label: string; className: string }> = {
                  win: { label: 'W', className: 'bg-green-500 text-white' },
                  draw: { label: 'D', className: 'bg-[var(--muted-foreground)]/30 text-[var(--muted-foreground)]' },
                  loss: { label: 'L', className: 'bg-[var(--destructive)] text-white' },
                };
                const result = resultMap[match.result] || resultMap.draw;
                const dateStr = match.date ? match.date.slice(5).replace('-', '/') : '';
                return (
                  <div
                    key={idx}
                    className="flex-shrink-0 w-28 rounded-xl bg-muted/30 p-3 border border-border/50"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-muted-foreground">{dateStr}</span>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${result.className}`}>
                        {result.label}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-foreground truncate mb-1">
                      {match.opponent}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono font-black text-foreground tabular-nums">
                        {match.scoreFor}-{match.scoreAgainst}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${match.isHome ? 'bg-nebula-crimson/10 text-nebula-crimson' : 'bg-gray-200/60 text-gray-600'}`}>
                        {match.isHome ? '主' : '客'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 主客场表现 */}
        <div className="metric-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <SwordsIcon className="w-4 h-4 text-nebula-crimson" />
            </div>
            <h2 className="text-base font-black tracking-tight text-foreground">主客场表现</h2>
          </div>
          {profileLoading ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="h-28 rounded-xl bg-muted/50 animate-pulse" />
              <div className="h-28 rounded-xl bg-muted/50 animate-pulse" />
            </div>
          ) : profileError ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              加载失败，请稍后重试
            </div>
          ) : !profile?.homeAwayStats ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              暂无主客场数据
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {/* 主场 */}
              <div className="relative rounded-2xl bg-muted/30 p-4 border border-border/50">
                {!profile.homeAwayStats.sampleSufficient && (
                  <span className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded bg-gray-200/80 text-gray-500 font-medium">
                    样本不足
                  </span>
                )}
                <div className="flex items-center gap-1.5 mb-2">
                  <Home className="w-3.5 h-3.5 text-nebula-crimson" />
                  <span className="text-xs text-muted-foreground">主场胜率</span>
                </div>
                <div className="text-3xl font-black font-mono text-nebula-crimson tracking-tight tabular-nums">
                  {Math.round(profile.homeAwayStats.homeWinRate * 100) / 100}%
                </div>
                <div className="text-xs text-muted-foreground mt-1 mb-2">
                  共 {profile.homeAwayStats.homeTotal} 场
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-nebula-crimson transition-all duration-700"
                    style={{ width: `${Math.min(100, profile.homeAwayStats.homeWinRate)}%` }}
                  />
                </div>
              </div>
              {/* 客场 */}
              <div className="relative rounded-2xl bg-muted/30 p-4 border border-border/50">
                {!profile.homeAwayStats.sampleSufficient && (
                  <span className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded bg-gray-200/80 text-gray-500 font-medium">
                    样本不足
                  </span>
                )}
                <div className="flex items-center gap-1.5 mb-2">
                  <Plane className="w-3.5 h-3.5 text-seq-3" />
                  <span className="text-xs text-muted-foreground">客场胜率</span>
                </div>
                <div className="text-3xl font-black font-mono text-seq-3 tracking-tight tabular-nums">
                  {Math.round(profile.homeAwayStats.awayWinRate * 100) / 100}%
                </div>
                <div className="text-xs text-muted-foreground mt-1 mb-2">
                  共 {profile.homeAwayStats.awayTotal} 场
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-seq-3 transition-all duration-700"
                    style={{ width: `${Math.min(100, profile.homeAwayStats.awayWinRate)}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 历史交锋 H2H */}
        {opponent && (
          <div className="metric-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
                <Swords className="w-4 h-4 text-nebula-crimson" />
              </div>
              <h2 className="text-base font-black tracking-tight text-foreground">历史交锋</h2>
              <span className="text-xs text-muted-foreground ml-auto">
                共 {profile?.h2hCount || 0} 场
              </span>
            </div>
            {profileLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded-xl bg-muted/50 animate-pulse" />
                ))}
              </div>
            ) : profileError ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                加载失败，请稍后重试
              </div>
            ) : !profile?.h2h || profile.h2h.length === 0 ? (
              <div className="text-center py-6">
                <Swords className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">暂无交锋记录</p>
              </div>
            ) : (
              <div className="space-y-2">
                {profile.h2h.map((record: H2HRecord, idx: number) => {
                  const dateStr = record.date ? record.date.slice(0, 10) : '';
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-muted/30 border border-border/50"
                    >
                      <span className="text-[10px] text-muted-foreground w-16 flex-shrink-0">
                        {dateStr}
                      </span>
                      <div className="flex-1 min-w-0 text-center text-sm font-medium text-foreground truncate">
                        {record.homeTeam} <span className="text-muted-foreground mx-1">vs</span> {record.awayTeam}
                      </div>
                      <span className="text-sm font-mono font-black text-nebula-crimson tabular-nums flex-shrink-0 w-14 text-center">
                        {record.homeScore ?? '-'} : {record.awayScore ?? '-'}
                      </span>
                      <span className="text-[10px] text-muted-foreground w-16 text-right truncate flex-shrink-0">
                        {record.league}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamDetailPage;
