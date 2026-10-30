import { useState } from 'react';
import {
  BarChart3,
  Target,
  Dumbbell,
  BookOpen,
  Trophy,
  LineChart,
  Activity,
  ChevronRight,
  Layers,
  Award,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface DataCardProps {
  icon: React.ElementType;
  title: string;
  desc: string;
  onClick: () => void;
}

const DataCard = ({ icon: Icon, title, desc, onClick }: DataCardProps) => (
  <button
    onClick={onClick}
    className="metric-card p-4 text-left hover:shadow-lg hover:-translate-y-1 transition-all duration-500 group"
    data-ai-section-type="card-menu"
  >
    <div className="w-10 h-10 rounded-xl bg-nebula-crimson/10 flex items-center justify-center mb-3 group-hover:bg-nebula-crimson group-hover:text-white transition-all duration-500 text-nebula-crimson">
      <Icon className="w-5 h-5" />
    </div>
    <h3 className="text-sm font-black tracking-tight text-foreground mb-1">{title}</h3>
    <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
  </button>
);

const STATS_TABS = [
  { key: 'football', label: '足球' },
  { key: 'basketball', label: '篮球' },
] as const;

const StatsPage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'football' | 'basketball'>('football');

  const footballCards: DataCardProps[] = [
    {
      icon: BarChart3,
       title: '足球模型准确率统计',
       desc: '赛果方向/让分/进球数 多维度',
      onClick: () => navigate('/stats/football?tab=overview'),
    },
    {
      icon: Trophy,
      title: '联赛分类统计',
      desc: '各联赛模型准确率对比排行',
      onClick: () => navigate('/stats/football?tab=league'),
    },
    {
      icon: Activity,
      title: '每日走势',
       desc: '按日模型准确率趋势变化',
      onClick: () => navigate('/stats/football?tab=trend'),
    },
    {
      icon: BookOpen,
      title: '模型规则分析',
       desc: 'R1-R56 规则模型准确率排行',
      onClick: () => navigate('/rules'),
    },
  ];

  const basketballCards: DataCardProps[] = [
    {
      icon: Dumbbell,
       title: '篮球模型准确率统计',
       desc: '赛果/让分/总分 多维度',
      onClick: () => navigate('/basketball/stats?tab=overview'),
    },
    {
      icon: Trophy,
      title: '联赛分类统计',
      desc: '各联赛准确率对比排行',
      onClick: () => navigate('/basketball/stats?tab=league'),
    },
    {
      icon: Layers,
      title: '让分深度分析',
       desc: '不同让分区间模型准确率分布',
      onClick: () => navigate('/basketball/stats?tab=overview'),
    },
    {
      icon: Award,
       title: '近期验证比赛',
       desc: '最近比赛验证结果一览',
      onClick: () => navigate('/basketball/stats?tab=recent'),
    },
  ];

  const footballExtraCards: DataCardProps[] = [
    {
      icon: BookOpen,
      title: '模型规则说明',
      desc: 'R1-R56 规则完整解读',
      onClick: () => navigate('/rules'),
    },
  ];

  const basketballExtraCards: DataCardProps[] = [
    {
      icon: LineChart,
      title: '历史回测',
      desc: '27场回测结果验证',
      onClick: () => navigate('/basketball/backtest'),
    },
    {
      icon: BookOpen,
      title: '模型规则说明',
      desc: 'R1-R56 规则完整解读',
      onClick: () => navigate('/rules'),
    },
  ];

  const currentMainCards = activeTab === 'football' ? footballCards : basketballCards;
  const currentExtraCards = activeTab === 'football' ? footballExtraCards : basketballExtraCards;

  return (
    <div className="min-h-full bg-background pb-24">
      {/* Hero 区 */}
      <div className="bg-gradient-to-b from-white to-background px-4 pt-6 pb-8 md:px-6 md:pt-8 md:pb-10">
        <div className="eyebrow eyebrow-line mb-3">DATA CENTER</div>
        <h1 className="text-4xl font-black tracking-tight text-foreground mb-2">
          数据统计
        </h1>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
           模型准确率统计、回测验证、模型规则全览，深度洞察模型表现
        </p>
      </div>

      <div className="px-4 md:px-6 space-y-8">
        {/* 足篮切换分段控件 */}
        <div className="inline-flex items-stretch rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          <button
            onClick={() => setActiveTab('football')}
            className={`px-6 h-10 text-sm font-medium transition-all duration-300 ${
              activeTab === 'football'
                ? 'bg-nebula-crimson text-white'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            足球数据
          </button>
          <button
            onClick={() => navigate('/basketball/stats', { replace: true })}
            className={`px-6 h-10 text-sm font-medium transition-all duration-300 ${
              activeTab === 'basketball'
                ? 'bg-nebula-crimson text-white'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            篮球数据
          </button>
        </div>

        <Section
          title={activeTab === 'football' ? '足球数据' : '篮球数据'}
          cards={currentMainCards}
        />
        <Section title="分析工具" cards={currentExtraCards} />
      </div>
    </div>
  );
};

const Section = ({ title, cards }: { title: string; cards: DataCardProps[] }) => (
  <div>
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <div className="w-1 h-5 bg-nebula-crimson rounded-full" />
        <h2 className="text-lg font-black tracking-tight text-foreground">{title}</h2>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground" />
    </div>
    <div className="grid grid-cols-2 gap-3" data-ai-section-type="card-menu">
      {cards.map((card, idx) => (
        <DataCard key={idx} {...card} />
      ))}
    </div>
  </div>
);

export default StatsPage;
