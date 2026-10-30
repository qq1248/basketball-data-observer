// ---- plugin:sports_event_ai_analysis_1 ----
// ============================================================
// 插件 sports_event_ai_analysis_1 (体育赛事智能问答与分析报告生成) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export type SportsEventAiAnalysisOneInput = {
  /** 赛事上下文数据，包含对阵双方、盘口、赔率、预测方向、信心度、伤停情况、近期战绩等完整信息 */
  match_context: string;
  /** 用户关于该赛事的具体问题或分析需求 */
  user_question?: string;
};

/**
 * const input: SportsEventAiAnalysisOneInput = { match_context, user_question };
 * capabilityClient.load('sports_event_ai_analysis_1').callStream<SportsEventAiAnalysisOneOutput>('textGenerate', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 SportsEventAiAnalysisOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","response":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export type SportsEventAiAnalysisOneOutput = {
  content: string;
  response?: string;
};
// ---- end:sports_event_ai_analysis_1 ----