import { useSearchParams } from 'react-router-dom';
import { Activity } from 'lucide-react';

const OddsAlertsPage = () => {
  const [searchParams] = useSearchParams();
  const sport = searchParams.get('sport') === 'basketball' ? 'basketball' : 'football';
  const pageTitle = sport === 'basketball' ? '篮球指数异动' : '指数异动';

  return (
    <div className="min-h-full bg-background pb-20">
      {/* Hero Section */}
      <div className="bg-hero-dark text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-24 pt-12 pb-10">
          <div className="eyebrow eyebrow-line text-white/70 mb-4">
            ODDS ALERTS · 指数异动
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white mb-3">
            {pageTitle}
          </h1>
          <p className="text-sm md:text-base text-white/60">
            实时监控指数变化，捕捉市场数据异动信号
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-24 py-20">
        <div className="metric-card p-16 text-center">
          <Activity className="w-16 h-16 text-muted-foreground/30 mx-auto mb-6" />
          <h2 className="text-2xl font-black tracking-tight text-foreground mb-3">
            功能调整中
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            指数异动监控功能正在进行数据架构升级，暂时无法使用。
            感谢您的理解与支持，升级完成后将带来更全面的数据参考体验。
          </p>
        </div>
      </div>
    </div>
  );
};

export default OddsAlertsPage;
