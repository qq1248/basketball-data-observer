import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { Badge } from '@client/src/components/ui/badge';
import { searchTeams } from '@client/src/api/teams';
import type { TeamItem } from '@shared/api.interface';

const LEAGUE_OPTIONS = [
  { value: '', label: '全部联赛' },
  { value: '英超', label: '英超' },
  { value: '西甲', label: '西甲' },
  { value: '意甲', label: '意甲' },
  { value: '德甲', label: '德甲' },
  { value: '法甲', label: '法甲' },
  { value: '中超', label: '中超' },
  { value: '欧冠', label: '欧冠' },
];

const FORM_COLORS: Record<string, string> = {
  W: 'bg-nebula-crimson text-white',
  D: 'bg-muted text-foreground',
  L: 'bg-[var(--muted-foreground)]/20 text-[var(--muted-foreground)]',
};

const TeamsPage = () => {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [league, setLeague] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(9);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.ceil(total / pageSize);

  const fetchTeams = async () => {
    setLoading(true);
    try {
      setError(null);
      const res = await searchTeams({ keyword, league, page, pageSize });
      setTeams(res?.items ?? []);
      setTotal(res?.total ?? 0);
    } catch (err) {
      logger.error('加载球队列表失败', err);
      setError('加载球队数据失败，请稍后重试');
      setTeams([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, league]);

  const handleSearch = () => {
    setPage(1);
    fetchTeams();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleCardClick = (teamId: string) => {
    navigate(`/teams/${teamId}`);
  };

  return (
    <div className="min-h-full bg-background pb-24">
      {/* Hero 区 */}
      <div className="bg-gradient-to-b from-white to-background px-4 pt-6 pb-8 md:px-6 md:pt-8 md:pb-10">
        <div className="eyebrow eyebrow-line mb-3">TEAMS DATABASE</div>
        <h1 className="text-4xl font-black tracking-tight text-foreground mb-2">
          球队情报
        </h1>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
          搜索和查看各联赛球队的详细信息、阵容与伤停
        </p>
      </div>

      <div className="px-4 md:px-6 space-y-6">
        {!loading && total < 20 && (
          <div className="bg-gray-50 text-gray-500 text-sm px-4 py-2 rounded-lg flex items-center gap-2">
            <Info className="w-4 h-4 flex-shrink-0" />
            <span>球队档案建设中，当前仅覆盖部分联赛球队</span>
          </div>
        )}

        {/* 搜索区 */}
        <div className="metric-card p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="输入球队名称搜索..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-9"
              />
            </div>
            <div className="w-full md:w-44">
              <Select value={league} onValueChange={setLeague}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择联赛" />
                </SelectTrigger>
                <SelectContent>
                  {LEAGUE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSearch} className="md:w-auto w-full">
              <Search className="w-4 h-4" />
              搜索
            </Button>
          </div>
        </div>

        {/* 球队列表 */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="metric-card p-4"
              >
                <Skeleton className="h-6 w-32 mb-3" />
                <Skeleton className="h-4 w-20 mb-3" />
                <Skeleton className="h-8 w-full mb-3" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="metric-card p-12 text-center">
            <Info className="w-12 h-12 text-destructive mx-auto mb-3" />
            <p className="text-destructive mb-2">加载失败</p>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button onClick={fetchTeams}>重新加载</Button>
          </div>
        ) : (teams?.length ?? 0) === 0 ? (
          <div className="metric-card p-12 text-center">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">暂无球队数据</p>
          </div>
        ) : (
          <>
            <div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
              data-ai-section-type="card-list"
            >
              {(teams ?? []).map((team: TeamItem) => (
                <div
                  key={team.id}
                  onClick={() => handleCardClick(team.id)}
                  className="metric-card p-4 cursor-pointer hover:shadow-lg hover:-translate-y-1 transition-all duration-500 group"
                >
                  {/* 队名 + 排名 */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-lg font-black tracking-tight text-foreground truncate flex-1 mr-2">
                      {team.name}
                    </div>
                    {team.rank && team.rank > 0 ? (
                      <Badge variant="outline" className="flex-shrink-0 border-nebula-crimson/30 text-nebula-crimson">
                        第{team.rank}名
                      </Badge>
                    ) : null}
                  </div>

                  {/* 联赛 */}
                  <div className="text-xs text-muted-foreground mb-3">
                    {team.league}
                  </div>

                  {/* 近期战绩 */}
                  <div className="mb-3">
                    <div className="text-xs text-muted-foreground mb-1.5">
                      近5场战绩
                    </div>
                    <div className="flex gap-1">
                      {(team.recentForm ?? []).length > 0 ? (
                        (team.recentForm ?? []).slice(0, 5).map((f: string, idx: number) => (
                          <span
                            key={idx}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black ${FORM_COLORS[f] || 'bg-muted text-muted-foreground'}`}
                          >
                            {f}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground/60">
                          暂无数据
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 攻防数据 */}
                  <div className="flex items-center justify-between pt-3 border-t border-border/60 text-xs">
                    <div>
                      <span className="text-muted-foreground">场均进球 </span>
                      <span className="text-nebula-crimson font-mono font-black tabular-nums">
                        {team.avgGoalsFor != null ? Number(team.avgGoalsFor).toFixed(2) : '--'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">场均失球 </span>
                      <span className="text-gray-500 font-mono font-black tabular-nums">
                        {team.avgGoalsAgainst != null ? Number(team.avgGoalsAgainst).toFixed(2) : '--'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-muted-foreground px-2">
                  第 {page} / {totalPages} 页，共 {total} 支球队
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TeamsPage;
