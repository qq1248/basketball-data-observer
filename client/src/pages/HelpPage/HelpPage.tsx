import { HelpCircle, ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

interface FAQItem {
  q: string;
  a: string;
}

const faqs: FAQItem[] = [
  {
    q: '预测数据是如何生成的？',
    a: '所有预测基于大数据统计模型，综合球队实力、历史交锋、伤病情况、主客场因素、赛程强度等多维数据，通过机器学习算法计算得出概率。模型规则包括R1-R56共56条规则，会根据比赛场景自动触发。',
  },
  {
    q: '信心度是什么意思？',
    a: '信心度代表模型对预测结果的确定程度，范围0-100%。60%以上为高信心，50%-60%为中等信心，50%以下为低信心。低信心比赛建议谨慎参考或选择双选保护。',
  },
  {
     q: '让分参考怎么看？',
     a: '让分参考基于赛果方向概率和让分指数计算得出。单方向表示参考唯一方向，双选表示参考两个方向以提高准确率。',
  },
  {
    q: '每日更新时间是什么时候？',
    a: '通常在比赛开赛前3-6小时更新当日数据。早场比赛（如亚冠、日职）会在当日下午更新，晚场比赛（如五大联赛）会在当日晚上更新。具体时间取决于数据采集进度。',
  },
  {
    q: '为什么有些比赛标注「低信心」？',
    a: '当最高概率与次高概率差距小于5%时，模型会自动标注为低信心。这类比赛结果不确定性较大，建议谨慎参考或选择观望，也可以结合双选保护策略提高准确率。',
  },
];

const HelpPage = () => {
  const navigate = useNavigate();
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const toggleItem = (idx: number) => {
    setOpenIdx(openIdx === idx ? null : idx);
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
        <div className="eyebrow eyebrow-line mb-3">HELP CENTER</div>
        <h1 className="text-4xl font-black tracking-tight text-foreground mb-2">
          使用帮助
        </h1>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
          常见问题解答，快速了解预测模型与使用方法
        </p>
      </div>

      <div className="px-4 md:px-6">
        <div className="space-y-3">
          {faqs.map((item, idx) => (
            <div
              key={idx}
              className="metric-card overflow-hidden"
            >
              <button
                onClick={() => toggleItem(idx)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3 pr-2 flex-1">
                  <span className="w-6 h-6 flex-shrink-0 rounded-lg bg-nebula-crimson/10 flex items-center justify-center text-[11px] font-black text-nebula-crimson">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-medium text-foreground flex-1">
                    {item.q}
                  </span>
                </div>
                {openIdx === idx ? (
                  <ChevronUp className="w-4 h-4 text-nebula-crimson flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
              </button>
              {openIdx === idx && (
                <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed animate-in fade-in duration-200 border-t border-border/50 pt-3">
                  <div className="pl-9">
                    {item.a}
                  </div>
                </div>
              )}
            </div>
          ))}
         </div>
       </div>

      </div>
   );
 };
 
 export default HelpPage;
