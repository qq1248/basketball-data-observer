import { Activity } from 'lucide-react';

interface OddsTrendTabProps {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
}

export default function OddsTrendTab({ matchId, homeTeam, awayTeam }: OddsTrendTabProps) {
  return (
    <div className="py-16 text-center">
      <Activity className="w-10 h-10 text-[var(--muted-foreground)]/30 md:text-muted-foreground/30 mx-auto mb-3" />
      <p className="text-sm text-[var(--muted-foreground)] md:text-muted-foreground">指数走势模块升级中</p>
    </div>
  );
}
