import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Swords, History, Home, Plane, Trophy } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Button } from '@client/src/components/ui/button';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { Badge } from '@client/src/components/ui/badge';
import { getTeamProfile } from '@client/src/api/teams';
import type { TeamProfileResponse, TeamFormRecord, H2HRecord } from '@shared/api.interface';

const RESULT_COLORS: Record<string, string> = {
  win: 'bg-green-500 text-white',
  draw: 'bg-gray-400 text-white',
  loss: 'bg-red-500 text-white',
};

const RESULT_LABEL: Record<string, string> = {
  win: '胜',
  draw: '平',
  loss: '负',
};

const TeamByNamePage = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sport = (searchParams.get('sport') as 'football' | 'basketball') || 'football';
  const opponent = searchParams.get('opponent') || undefined;

  const [profile, setProfile] = useState<TeamProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!name) return;
    const teamName = decodeURIComponent(name);
    const fetchData = async () => {
      setLoading(true);
      setError(false);
      try {
        const data = await getTeamProfile(teamName, sport, opponent);
        setProfile(data);
      } catch (err) {
        logger.error('加载球队档案失败', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [name, sport, opponent]);

  const teamName = name ? decodeURIComponent(name) : '';
  const sportLabel = sport === 'basketball' ? '篮球' : '足球';

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-7xl mx-auto px-4 md:px-24 py-8">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 text-muted-foreground hover:text-foreground h-10"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回
        </Button>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Badge variant="outline" className="text-nebula-crimson border-nebula-crimson/30 bg-nebula-crimson/5">
              {sportLabel}
            </Badge>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-foreground">
              {teamName}
            </h1>
          </div>
          <p className="text-muted-foreground text-sm">
            球队档案 · 数据基于历史真实赛果计算
          </p>
        </div>

        {loading && (
          <div className="space-y-8">
            <div className="space-y-3">
              <Skeleton className="h-6 w-32" />
              <div className="flex gap-3 overflow-x-auto pb-2">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-24 w-28 rounded-lg flex-shrink-0" />
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Skeleton className="h-6 w-32" />
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-32 rounded-lg" />
                <Skeleton className="h-32 rounded-lg" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="text-center py-16 text-muted-foreground">
            加载失败，请稍后重试
          </div>
        )}

        {!loading && !error && profile && (
          <div className="space-y-8">
            {/* 近期战绩 */}
            <div className="bg-white rounded-xl border border-border/60 p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-nebula-crimson" />
                  <h2 className="text-lg font-black tracking-tight text-foreground">
                    近期战绩
                  </h2>
                  <Badge variant="secondary" className="text-xs">
                    近 {profile.recentCount} 场
                  </Badge>
                </div>
              </div>
              {profile.recentMatches.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  暂无历史战绩数据
                </div>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2">
                  {profile.recentMatches.map((match: TeamFormRecord, idx: number) => (
                    <div
                      key={idx}
                      className="flex-shrink-0 w-28 rounded-lg border border-border/60 p-3 bg-gray-50/50"
                    >
                      <div className="text-xs text-muted-foreground mb-2">
                        {match.date.slice(5)}
                        <span className="ml-1 text-[10px]">
                          {match.isHome ? '主' : '客'}
                        </span>
                      </div>
                      <div
                        className={`inline-block w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${RESULT_COLORS[match.result]}`}
                      >
                        {RESULT_LABEL[match.result]}
                      </div>
                      <div className="mt-2 text-xs text-foreground truncate" title={match.opponent}>
                        vs {match.opponent}
                      </div>
                      <div className="text-sm font-bold text-foreground mt-1">
                        {match.scoreFor} - {match.scoreAgainst}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 主客场表现 */}
            <div className="bg-white rounded-xl border border-border/60 p-6">
              <div className="flex items-center gap-2 mb-5">
                <Trophy className="w-5 h-5 text-nebula-crimson" />
                <h2 className="text-lg font-black tracking-tight text-foreground">
                  主客场表现
                </h2>
              </div>
              {!profile.homeAwayStats ||
              (profile.homeAwayStats.homeTotal === 0 && profile.homeAwayStats.awayTotal === 0) ? (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  暂无主客场数据
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border/60 p-4 bg-gradient-to-br from-nebula-crimson/5 to-transparent relative">
                    {!profile.homeAwayStats.sampleSufficient && (
                      <Badge variant="secondary" className="absolute top-3 right-3 text-[10px] h-5">
                        样本不足
                      </Badge>
                    )}
                    <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
                      <Home className="w-4 h-4" />
                      主场胜率
                    </div>
                    <div className="text-3xl font-black text-foreground mb-1">
                      {Math.round(profile.homeAwayStats.homeWinRate)}%
                    </div>
                    <div className="text-xs text-muted-foreground mb-3">
                      共 {profile.homeAwayStats.homeTotal} 场
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-red-900 to-nebula-crimson rounded-full"
                        style={{ width: `${Math.min(100, profile.homeAwayStats.homeWinRate)}%` }}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 p-4 bg-gradient-to-br from-gray-50 to-transparent relative">
                    {!profile.homeAwayStats.sampleSufficient && (
                      <Badge variant="secondary" className="absolute top-3 right-3 text-[10px] h-5">
                        样本不足
                      </Badge>
                    )}
                    <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
                      <Plane className="w-4 h-4" />
                      客场胜率
                    </div>
                    <div className="text-3xl font-black text-foreground mb-1">
                      {Math.round(profile.homeAwayStats.awayWinRate)}%
                    </div>
                    <div className="text-xs text-muted-foreground mb-3">
                      共 {profile.homeAwayStats.awayTotal} 场
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-gray-500 to-gray-400 rounded-full"
                        style={{ width: `${Math.min(100, profile.homeAwayStats.awayWinRate)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 历史交锋 H2H */}
            {opponent && (
              <div className="bg-white rounded-xl border border-border/60 p-6">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Swords className="w-5 h-5 text-nebula-crimson" />
                    <h2 className="text-lg font-black tracking-tight text-foreground">
                      历史交锋
                    </h2>
                    <Badge variant="secondary" className="text-xs">
                      共 {profile.h2hCount} 场
                    </Badge>
                  </div>
                </div>
                {profile.h2h.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">
                    暂无交锋记录
                  </div>
                ) : (
                  <div className="space-y-2">
                    {profile.h2h.map((item: H2HRecord, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between py-3 border-b border-border/40 last:border-0"
                      >
                        <div className="text-xs text-muted-foreground w-16 flex-shrink-0">
                          {item.date.slice(5)}
                        </div>
                        <div className="flex-1 text-right text-sm font-medium text-foreground truncate px-2">
                          {item.homeTeam}
                        </div>
                        <div className="px-3 py-1 rounded bg-gray-100 text-sm font-bold text-foreground flex-shrink-0">
                          {item.homeScore ?? '-'} : {item.awayScore ?? '-'}
                        </div>
                        <div className="flex-1 text-sm font-medium text-foreground truncate px-2">
                          {item.awayTeam}
                        </div>
                        <div className="text-xs text-muted-foreground w-20 text-right flex-shrink-0 truncate">
                          {item.league}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="text-center text-xs text-muted-foreground pt-4 pb-8">
              数据更新于 {new Date(profile.updatedAt).toLocaleString('zh-CN')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamByNamePage;
