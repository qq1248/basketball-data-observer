import React, { useEffect, useState, useCallback } from 'react';
import {
  Search,
  Activity,
  ChevronLeft,
  ChevronRight,
  Calendar,
  User,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Input } from '@client/src/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent } from '@client/src/components/ui/card';
import { ErrorState } from '@client/src/components/ui/error-state';
import { injuriesApi } from '@client/src/api';
import type { InjuryItem, InjuryListResponse } from '@shared/api.interface';

const STATUS_LABELS: Record<string, string> = {
  out: '缺阵',
  doubtful: '存疑',
  questionable: '出战成疑',
  available: '可出战',
  probable: '大概率出战',
};

const IMPACT_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  critical: '严重',
};

const IMPACT_VARIANT: Record<string, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-green-100 text-green-700 border-green-200',
  critical: 'bg-red-200 text-red-800 border-red-300',
};

const InjuriesPage: React.FC = () => {
  const [data, setData] = useState<InjuryListResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [teamName, setTeamName] = useState<string>('');
  const [impactLevel, setImpactLevel] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const pageSize = 20;

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await injuriesApi.getInjuryList({
        teamName: teamName.trim() || undefined,
        impactLevel: impactLevel || undefined,
        status: status || undefined,
        page,
        pageSize,
      });
      setData(result);
    } catch (err) {
      logger.error('加载伤停列表失败', err);
      setError('加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [teamName, impactLevel, status, page]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const handleTeamNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTeamName(e.target.value);
    setPage(1);
  };

  const handleImpactLevelChange = (value: string) => {
    setImpactLevel(value === 'all' ? '' : value);
    setPage(1);
  };

  const handleStatusChange = (value: string) => {
    setStatus(value === 'all' ? '' : value);
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  const impactBadgeClass = (level: string): string => {
    return IMPACT_VARIANT[level] ?? IMPACT_VARIANT.medium;
  };

  const statusLabel = (s: string): string => {
    return STATUS_LABELS[s] ?? s;
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Hero */}
      <section className="bg-gradient-to-b from-[#1A0000] to-[#050505] text-white py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-8 md:px-24">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-nebula-crimson" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              INJURY INTELLIGENCE CENTER
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-4">
            伤停情报中心
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl leading-relaxed mb-8">
            全球各联赛球队伤停名单实时更新，影响程度与出战状态一目了然，数据仅供参考
          </p>
          <div className="flex items-end gap-8">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                总伤停人数
              </div>
              <div className="text-5xl md:text-6xl font-black text-nebula-crimson tracking-tight">
                {loading ? '—' : data?.total ?? 0}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="bg-white border-b border-[#F3F4F6] sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-8 md:px-24 py-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索球队名称..."
                value={teamName}
                onChange={handleTeamNameChange}
                className="pl-9"
              />
            </div>
            <div className="flex gap-3">
              <Select
                value={impactLevel || 'all'}
                onValueChange={handleImpactLevelChange}
              >
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="影响程度" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部程度</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="low">低</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status || 'all'} onValueChange={handleStatusChange}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="出战状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="out">缺阵</SelectItem>
                  <SelectItem value="doubtful">存疑</SelectItem>
                  <SelectItem value="questionable">出战成疑</SelectItem>
                  <SelectItem value="available">可出战</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </section>

      {/* List */}
      <section className="max-w-7xl mx-auto px-8 md:px-24 py-12">
        {loading && (
          <div className="py-20 text-center text-muted-foreground">加载中...</div>
        )}
        {error && (
          <ErrorState
            size="md"
            message={error}
            onRetry={fetchList}
          />
        )}
        {!loading && !error && data && data.items.length === 0 && (
          <div className="py-20 text-center">
            <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground">暂无伤停记录</p>
          </div>
        )}
        {!loading && !error && data && data.items.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {data.items.map((item: InjuryItem) => (
                <Card
                  key={item.id}
                  className="border-[#F3F4F6] hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 overflow-hidden group"
                >
                  <div className="h-1 bg-gradient-to-r from-[#8B0000] to-[#A52A2A] w-0 group-hover:w-full transition-all duration-500" />
                  <CardContent className="pt-4 pb-5">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <User className="w-4 h-4 text-nebula-crimson shrink-0" />
                        <h3 className="font-bold text-base truncate">{item.playerName}</h3>
                      </div>
                      <Badge
                        variant="outline"
                        className={impactBadgeClass(item.impactLevel)}
                      >
                        {IMPACT_LABELS[item.impactLevel] ?? item.impactLevel}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mb-3">
                      {item.teamName}
                      {item.position ? ` · ${item.position}` : ''}
                    </div>
                    {item.injuryType && (
                      <div className="text-sm text-[#111827] mb-2">
                        <span className="text-muted-foreground">伤停类型：</span>
                        {item.injuryType}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <Badge variant="secondary" className="font-normal">
                        {statusLabel(item.status)}
                      </Badge>
                      {item.expectedReturn && (
                        <div className="flex items-center gap-1 text-muted-foreground text-xs">
                          <Calendar className="w-3 h-3" />
                          预计复出 {item.expectedReturn}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[#F3F4F6] bg-white text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:border-nebula-crimson hover:text-nebula-crimson transition-colors"
                  aria-label="上一页"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="px-4 text-sm text-muted-foreground">
                  第 <span className="text-[#111827] font-semibold">{page}</span> /{' '}
                  {totalPages} 页 · 共 {data.total} 条
                </div>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[#F3F4F6] bg-white text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:border-nebula-crimson hover:text-nebula-crimson transition-colors"
                  aria-label="下一页"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Disclaimer */}
      <section className="border-t border-[#F3F4F6] bg-white">
        <div className="max-w-7xl mx-auto px-8 md:px-24 py-6 text-center text-xs text-muted-foreground">
          数据仅供参考，不构成任何投注建议
        </div>
      </section>
    </div>
  );
};

export default InjuriesPage;
