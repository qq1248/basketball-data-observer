import React from 'react';
import { ShieldAlert, Info } from 'lucide-react';

const DisclaimerPage: React.FC = () => {
  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto py-16">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-nebula-crimson/10 mb-4">
          <ShieldAlert className="w-8 h-8 text-nebula-crimson" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">DISCLAIMER</span>
        <h1 className="text-4xl font-black tracking-tight mt-2 mb-3">免责声明</h1>
        <p className="text-muted-foreground">请仔细阅读以下声明</p>
      </div>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
        <div className="p-6 bg-nebula-crimson/5 border border-nebula-crimson/10 rounded-xl">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-nebula-crimson flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-nebula-crimson mb-2">核心声明</h3>
              <p>本应用所提供的所有数据、模型预测、情报分析均仅供学习与参考之用，不构成任何投注、博彩或投资建议。</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="font-bold text-foreground mb-2">数据准确性</h3>
            <p>本应用数据来源于公开渠道，虽尽力保证数据准确性，但不对数据的完整性、准确性和及时性做任何保证。赛事数据以官方发布为准。</p>
          </div>

          <div>
            <h3 className="font-bold text-foreground mb-2">模型预测</h3>
            <p>所有预测分析基于历史数据与算法模型，存在不确定性，实际比赛结果可能与预测存在较大偏差，请勿将其作为决策依据。</p>
          </div>

          <div>
            <h3 className="font-bold text-foreground mb-2">使用限制</h3>
            <p>本应用仅用于数据参考与研究交流，严禁用于任何非法博彩活动。使用者应遵守所在地区法律法规，自行承担相关责任。</p>
          </div>

          <div>
            <h3 className="font-bold text-foreground mb-2">理性观赛</h3>
            <p>体育赛事的魅力在于竞技本身，建议理性看待比赛结果，享受运动带来的乐趣。</p>
          </div>
        </div>

        <div className="pt-6 border-t border-border text-center text-xs text-muted-foreground">
          <p>如您继续使用本应用，即视为您已阅读并同意以上声明。</p>
        </div>
      </div>
    </div>
  );
};

export default DisclaimerPage;
