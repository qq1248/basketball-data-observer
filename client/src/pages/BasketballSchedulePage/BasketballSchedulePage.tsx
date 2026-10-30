import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Inbox, AlertCircle, Clock, ChevronLeft } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { getBasketballMatches } from '@client/src/api/basketball';
import type { BasketballMatchItem } from '@shared/api.interface';
import ScheduleCard from './ScheduleCard';
import { Skeleton } from '@client/src/components/ui/skeleton';
import dayjs from 'dayjs';

const WEEKDAY_MAP = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function getBeijingDateStr(offsetDays = 0): string {
  const now = new Date();
  const beijingMs = now.getTime() + 8 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000;
  return new Date(beijingMs).toISOString().slice(0, 10);
}

interface DateItem {
  dateStr: string; // YYYY-MM-DD
  dayNum: number; // 日期数字
  weekday: string; // 周几
  isToday: boolean;
}

function buildNext7Days(todayStr: string): DateItem[] {
  const today = dayjs(todayStr);
  const items: DateItem[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = today.add(i, 'day');
    const dateStr = d.format('YYYY-MM-DD');
    items.push({
      dateStr,
      dayNum: d.date(),
      weekday: WEEKDAY_MAP[d.day()],
      isToday: i === 0,
    });
  }
  return items;
}

const BasketballSchedulePage = () => {
  const navigate = useNavigate();
  const todayStr = useMemo(() => getBeijingDateStr(0), []);
  const dateList = useMemo(() => buildNext7Days(todayStr), [todayStr]);

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [matches, setMatches] = useState<BasketballMatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeBtnRef = useRef<HTMLButtonElement>(null);

  // 滚动到选中日期
  useEffect(() => {
    if (activeBtnRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const btn = activeBtnRef.current;
      const offset = btn.offsetLeft - container.clientWidth / 2 + btn.clientWidth / 2;
      container.scrollTo({ left: offset, behavior: 'smooth' });
    }
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getBasketballMatches({
      date: selectedDate,
      dateMode: 'kickoff',
      status: 'upcoming',
      pageSize: 100,
    })
      .then((res) => {
        if (!cancelled) {
          setMatches(res.items ?? []);
        }
      })
      .catch((err) => {
        logger.error('加载赛程失败', err);
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  // 是否有竞彩场次
  const hasSporttery = matches.some(
    (m: BasketballMatchItem) => m.source === 'sporttery' || m.source === 'fox',
  );
  const totalCount = matches.length;
  const isFutureDate = dayjs(selectedDate).isAfter(todayStr, 'day');

  // 空态判断逻辑：
  // - 未来日期且无任何比赛 → 竞彩未开售
  // - 有比赛但 source=sporttery 为空 → 正常展示（国际赛事）
  // - 当天无比赛 → 当日暂无赛事
  const showPendingSale = totalCount === 0 && isFutureDate;
  const showEmpty = totalCount === 0 && !isFutureDate;

  return (
    <div className="min-h-full bg-[var(--background)] pb-36 md:pb-8">
      {/* 顶部返回 & 标题 */}
      <div className="bg-[var(--background)] px-4 pt-6 pb-4">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-4"
        >
          <ChevronLeft className="w-4 h-4" />
          返回
        </button>
        <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent-primary)] mb-2">
          SCHEDULE · 赛程
        </div>
        <h1 className="text-[var(--foreground)] font-black text-2xl">篮球赛程</h1>
      </div>

      {/* 日期选择条 */}
      <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-xl border-b border-[var(--border)]">
        <div
          ref={scrollRef}
          className="flex items-center gap-2 py-3 px-4 overflow-x-auto scrollbar-hide"
          style={{ scrollbarWidth: 'none' }}
        >
          {dateList.map((d) => {
            const isActive = d.dateStr === selectedDate;
            return (
              <button
                key={d.dateStr}
                ref={isActive ? activeBtnRef : undefined}
                onClick={() => setSelectedDate(d.dateStr)}
                className={`flex flex-col items-center justify-center min-w-[3.5rem] h-14 rounded-xl transition-all flex-shrink-0 ${
                  isActive
                    ? 'bg-[var(--accent-primary)] text-white shadow-lg shadow-[var(--accent-primary)]/30'
                    : 'bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--secondary)]'
                }`}
              >
                <span className="text-[10px] font-medium">
                  {d.isToday ? '今天' : d.weekday}
                </span>
                <span className="font-bold text-lg tabular-nums">{d.dayNum}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 内容区 */}
      <div className="px-4 py-3">
        {/* 日期标题 */}
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays className="w-4 h-4 text-[var(--accent-primary)]" />
          <span className="text-sm font-bold text-[var(--foreground)]">
            {dayjs(selectedDate).format('MM月DD日')} {WEEKDAY_MAP[dayjs(selectedDate).day()]}
          </span>
          <span className="text-xs text-[var(--muted-foreground)] ml-auto tabular-nums">
            共 {totalCount} 场赛事
          </span>
        </div>

        {loading && <ScheduleSkeleton />}

        {error && (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 flex flex-col items-center gap-3">
             <AlertCircle className="w-10 h-10 text-[var(--destructive)]/60" />
            <p className="text-sm text-[var(--muted-foreground)]">加载失败，请稍后重试</p>
          </div>
        )}

        {!loading && !error && showEmpty && (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-12 flex flex-col items-center gap-3">
             <Inbox className="w-16 h-16 text-[var(--accent-primary)]/30 mx-auto mb-4" />
            <p className="text-[var(--muted-foreground)] text-sm font-medium">当日暂无赛事</p>
            <p className="text-[var(--muted-foreground)]/60 text-xs">换个日期看看吧</p>
          </div>
        )}

        {!loading && !error && showPendingSale && (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-12 flex flex-col items-center gap-3">
             <Clock className="w-16 h-16 text-[var(--accent-primary)]/30 mx-auto mb-4" />
            <p className="text-[var(--muted-foreground)] text-sm font-medium">竞彩未开售，敬请期待</p>
            <p className="text-[var(--muted-foreground)]/60 text-xs">数据将在赛前陆续更新</p>
          </div>
        )}

        {!loading && !error && totalCount > 0 && (
          <div className="flex flex-col gap-2">
            {matches.map((m: BasketballMatchItem) => (
              <ScheduleCard key={m.id} match={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const ScheduleSkeleton = () => (
  <div className="flex flex-col gap-2">
    {[0, 1, 2, 3, 4].map((i) => (
      <Skeleton key={i} className="h-44 rounded-xl bg-[var(--card)]" />
    ))}
  </div>
);

export default BasketballSchedulePage;
