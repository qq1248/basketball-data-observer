import { Info, ChevronLeft, Shield, BarChart3, Zap, Award, Clock, Hash } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { getVersion } from '@client/src/api/version';
import type { VersionResponse } from '@shared/api.interface';

const AboutPage = () => {
  const navigate = useNavigate();
  const [versionData, setVersionData] = useState<VersionResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    getVersion()
      .then((data: VersionResponse) => {
        setVersionData(data);
      })
      .catch((err: unknown) => {
        logger.error('[about] 加载版本信息失败', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const formatBuildTime = (isoTime: string): string => {
    try {
      const date: Date = new Date(isoTime);
      const year: number = date.getFullYear();
      const month: string = String(date.getMonth() + 1).padStart(2, '0');
      const day: string = String(date.getDate()).padStart(2, '0');
      const hours: string = String(date.getHours()).padStart(2, '0');
      const minutes: string = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch {
      return isoTime;
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Hero 区 */}
      <div className="bg-gradient-to-b from-white to-background px-4 pt-6 pb-8 md:px-6 md:pt-8 md:pb-10">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 -ml-1.5 mb-4 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="eyebrow eyebrow-line mb-3">ABOUT US</div>
        <h1 className="text-4xl font-black tracking-tight text-foreground mb-2">
          关于应用
        </h1>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
           足篮球赛事数据统计与分析参考平台
        </p>
      </div>

      <div className="px-4 md:px-6 space-y-5">
        {/* 品牌卡 */}
        <div className="rounded-3xl bg-gradient-to-br from-nebula-crimson/10 via-white to-white p-6 text-center border border-border">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-nebula-crimson flex items-center justify-center shadow-lg shadow-nebula-crimson/30">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-black tracking-tight text-foreground">观察体育</h2>
          <p className="text-sm text-muted-foreground mt-1">应用版本 v{versionData?.version ?? '—'}</p>
          <p className="text-xs text-muted-foreground/80 mt-0.5">模型引擎：足球v12.0 + 篮球V11.0（Elo + xG + 数据驱动融合）</p>
        </div>

        {/* 特性卡片 */}
        <div className="space-y-3">
          <div className="eyebrow eyebrow-line mb-2">CORE FEATURES</div>
          <FeatureCard
            icon={BarChart3}
            title="大数据驱动"
            desc="基于数万场历史比赛数据，通过机器学习模型综合分析球队实力、主客场、伤病、赛程等多维因素"
          />
          <FeatureCard
            icon={Zap}
            title="56条规则引擎"
             desc="R1-R56 共56条模型规则，覆盖让分保护、洲际杯降档、低信心双选等多种场景"
          />
          <FeatureCard
            icon={Award}
            title="历史回测验证"
              desc="模型经过大量历史比赛回测验证，赛果方向含低信心双选模型准确率约90%"
          />
        </div>

        {/* 版本记录 */}
        <div className="metric-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <Info className="w-4 h-4 text-nebula-crimson" />
            </div>
            <h3 className="text-base font-black tracking-tight text-foreground">版本记录</h3>
          </div>
          {loading ? (
            <div className="text-xs text-muted-foreground">加载中...</div>
          ) : versionData ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">当前版本</span>
                  <span className="text-sm font-black text-foreground">v{versionData.version}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Hash className="w-3 h-3" />
                  <span>Build {versionData.buildNumber}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>构建时间：{formatBuildTime(versionData.buildTime)}</span>
              </div>
              <div className="pt-3 border-t border-border/60">
                <h4 className="text-xs font-bold text-foreground mb-2">更新日志</h4>
                <ul className="space-y-2">
                  {versionData.changelog.map((item: string, index: number) => (
                    <li key={index} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-nebula-crimson mt-1.5 flex-shrink-0" />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">暂无版本信息</div>
          )}
        </div>

        {/* 功能模块 */}
        <div className="metric-card p-5">
          <h3 className="text-base font-black tracking-tight text-foreground mb-3">功能模块</h3>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p className="flex items-start gap-2">
              <span className="inline-block w-1 h-1 rounded-full bg-nebula-crimson mt-1.5 flex-shrink-0" />
              足球赛事分析：今日赛事、比赛详情、情报分析
            </p>
            <p className="flex items-start gap-2">
              <span className="inline-block w-1 h-1 rounded-full bg-nebula-crimson mt-1.5 flex-shrink-0" />
              篮球赛事分析：NBA、WNBA、CBA等赛事
            </p>
            <p className="flex items-start gap-2">
              <span className="inline-block w-1 h-1 rounded-full bg-nebula-crimson mt-1.5 flex-shrink-0" />
              多场数据参考：多场赛事数据搭配对照
            </p>
            <p className="flex items-start gap-2">
              <span className="inline-block w-1 h-1 rounded-full bg-nebula-crimson mt-1.5 flex-shrink-0" />
              数据统计：模型准确率统计、历史回测、模型规则
            </p>
            <p className="flex items-start gap-2">
              <span className="inline-block w-1 h-1 rounded-full bg-nebula-crimson mt-1.5 flex-shrink-0" />
              个人中心：收藏、浏览记录、模型准确率统计
            </p>
          </div>
        </div>

         {/* 免责声明 */}
         <div className="rounded-2xl border border-border bg-card/50 p-6">
          <h3 className="text-base font-semibold mb-3">免责声明</h3>
          <div className="text-xs leading-relaxed text-muted-foreground space-y-2">
             <p>本平台提供的所有赛事数据、统计分析、模型输出及相关内容，仅用于体育研究与数据分析参考，不构成任何决策建议。</p>
            <p>所有数据均来自公开渠道，平台不对数据的准确性、完整性、及时性作出任何保证。使用者应自行判断并承担全部风险。</p>
             <p>请理性观看体育赛事，自觉遵守国家法律法规，理性观赛。</p>
            <p>未成年人请在监护人指导下使用本平台。</p>
          </div>
        </div>

        <div className="text-center text-[10px] text-muted-foreground/50 pt-2">
          © 2026 观察体育 · All Rights Reserved
        </div>
      </div>
    </div>
  );
};

const FeatureCard = ({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
}) => (
  <div className="metric-card p-4 hover:shadow-lg transition-all duration-500 flex gap-3">
    <div className="w-10 h-10 rounded-xl bg-nebula-crimson/10 flex items-center justify-center flex-shrink-0 text-nebula-crimson">
      <Icon className="w-5 h-5" />
    </div>
    <div className="flex-1 min-w-0">
      <h3 className="text-sm font-black tracking-tight text-foreground mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  </div>
);

export default AboutPage;
