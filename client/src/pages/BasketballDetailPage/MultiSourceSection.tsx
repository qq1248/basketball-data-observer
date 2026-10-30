import { Activity } from 'lucide-react';

interface MultiSourceSectionProps {
  matchId: string;
}

export default function MultiSourceSection({ matchId }: MultiSourceSectionProps) {
  return (
    <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:bg-card md:shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-[var(--foreground)] md:text-foreground flex items-center gap-2">
          <span className="w-1 h-4 rounded-full bg-blue-400 md:bg-nebula-crimson" />
          多源数据对照
        </div>
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] md:text-muted-foreground">
          DATA SOURCES
        </span>
      </div>
      <div className="py-12 text-center">
        <Activity className="w-10 h-10 text-[var(--muted-foreground)]/30 md:text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-[var(--muted-foreground)] md:text-muted-foreground">多源指数对照模块升级中</p>
      </div>
    </div>
  );
}
