#!/usr/bin/env bash
# 足球数据不足让球拦截回归测试（v6.8.4）
# 用途：验证 "已存在记录 + 无赔率 + update 场景" 下三项全观望，
#       防止让球字段绕过 finalizeFootballPick 拦截（existingRec 回填分支漏网）。
# 运行：bash server/test-football-insufficient-guard.sh
# 退出码：0=通过，非0=失败
set -euo pipefail

APP_ID="${APP_ID:-app_17e50w9zycw}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8001/app/${APP_ID}}"
SYNC_TOKEN="${SYNC_TOKEN:-f43ff16129793f5bdd3109af35d0d4bd5826dbec342e1a2af31166d5cd5e90b5}"
CSRF="test-csrf-regression"

PASS=0
FAIL=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: $desc (expected=$expected)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected=$expected, actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

# ---------- 用例 1：已存在记录 + 无赔率 + update → 三项全观望 ----------
echo "=== Test 1: 已存在记录(handicap=-2,无赔率) + update(不带推荐字段) → 三项全观望 ==="

TEST_NO="周三reg002"
miaoda db sql "DELETE FROM matches WHERE match_no = '${TEST_NO}' AND source = 'sporttery';" --yes >/dev/null 2>&1 || true
miaoda db sql "INSERT INTO matches (match_no, match_date, business_date, league, home_team, away_team, kickoff_time, source, handicap, home_win_prob, draw_prob, away_win_prob, over_prob, under_prob, prediction_direction, total_pick, low_confidence, handicap_recommendation, handicap_win_prob, handicap_draw_prob, handicap_lose_prob, model_rules, odds_open_home, odds_open_draw, odds_open_away, handicap_odds_home, handicap_odds_draw, handicap_odds_away) VALUES ('${TEST_NO}', '2026-09-24'::date, '2026-09-24'::date, '回归测试联赛', '主队A', '客队B', '2026-09-24 18:00:00+08', 'sporttery', '-2', 35, 30, 35, 50, 50, '观望', '观望', true, '让胜', '49', '30', '21', '{数据不足：硬拦截三项全观望（v6.8.1）}', NULL, NULL, NULL, NULL, NULL, NULL);" --yes >/dev/null

curl -sS -X POST "${BASE_URL}/api/sync/ingest/football" \
  -H "Content-Type: application/json" \
  -H "x-sync-token: ${SYNC_TOKEN}" \
  -H "Cookie: suda-csrf-token=${CSRF}" \
  -H "x-suda-csrf-token: ${CSRF}" \
  -d '{
  "matches": [
    {
      "matchNo": "'"${TEST_NO}"'",
      "matchDate": "2026-09-24",
      "businessDate": "2026-09-24",
      "league": "回归测试联赛",
      "homeTeam": "主队A",
      "awayTeam": "客队B",
      "kickoffTime": "2026-09-24T18:00:00+08:00",
      "matchStatus": "upcoming",
      "oddsOpenHome": "",
      "oddsOpenDraw": "",
      "oddsOpenAway": "",
      "handicap": "-2",
      "handicapOddsHome": "",
      "handicapOddsDraw": "",
      "handicapOddsAway": "",
      "totalGoals": "2.5",
      "totalOddsOver": "",
      "totalOddsUnder": "",
      "source": "sporttery"
    }
  ]
}' > /dev/null

RESULT=$(miaoda db sql "SELECT prediction_direction, handicap_recommendation, total_pick, home_win_prob, draw_prob, away_win_prob, over_prob, under_prob, low_confidence, model_rules, handicap_win_prob FROM matches WHERE match_no = '${TEST_NO}' AND source = 'sporttery';" --json)
PDIR=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['prediction_direction'])")
HREC=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_recommendation'])")
TPICK=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['total_pick'])")
HWP=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_win_prob'])")
MRULES=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d['data'][0]['model_rules']; print(','.join(r) if isinstance(r,list) else str(r))")

assert_eq "predictionDirection"  "观望" "$PDIR"
assert_eq "handicapRecommendation" "观望" "$HREC"
assert_eq "totalPick"             "观望" "$TPICK"
assert_eq "handicapWinProb基线35"  "35"   "$HWP"
if echo "$MRULES" | grep -q "v6.8.4"; then
  echo "  PASS: modelRules 含 v6.8.4 标签"
  PASS=$((PASS + 1))
else
  echo "  FAIL: modelRules 不含 v6.8.4 标签 ($MRULES)"
  FAIL=$((FAIL + 1))
fi

# ---------- 用例 2：正常赔率 + handicap=-2 + 主队深盘 → 让负（防改坏正常逻辑） ----------
echo ""
echo "=== Test 2: 正常赔率(主胜1.45≈65%) + handicap=-2 → 让负（防改坏正常出票） ==="

TEST_NO2="周三reg001"
miaoda db sql "DELETE FROM matches WHERE match_no = '${TEST_NO2}' AND source = 'sporttery';" --yes >/dev/null 2>&1 || true

curl -sS -X POST "${BASE_URL}/api/sync/ingest/football" \
  -H "Content-Type: application/json" \
  -H "x-sync-token: ${SYNC_TOKEN}" \
  -H "Cookie: suda-csrf-token=${CSRF}" \
  -H "x-suda-csrf-token: ${CSRF}" \
  -d '{
  "matches": [
    {
      "matchNo": "'"${TEST_NO2}"'",
      "matchDate": "2026-09-24",
      "businessDate": "2026-09-24",
      "league": "回归测试联赛",
      "homeTeam": "主队强",
      "awayTeam": "客队弱",
      "kickoffTime": "2026-09-24T19:00:00+08:00",
      "matchStatus": "upcoming",
      "oddsOpenHome": "1.45",
      "oddsOpenDraw": "4.20",
      "oddsOpenAway": "7.50",
      "handicap": "-2",
      "handicapOddsHome": "1.80",
      "handicapOddsDraw": "3.60",
      "handicapOddsAway": "3.80",
      "totalGoals": "2.5",
      "totalOddsOver": "1.90",
      "totalOddsUnder": "1.90",
      "source": "sporttery"
    }
  ]
}' > /dev/null

RESULT2=$(miaoda db sql "SELECT prediction_direction, handicap_recommendation, total_pick, home_win_prob, confidence, low_confidence FROM matches WHERE match_no = '${TEST_NO2}' AND source = 'sporttery';" --json)
HREC2=$(echo "$RESULT2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_recommendation'])")
HWP2=$(echo "$RESULT2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['home_win_prob'])")

assert_eq "主队胜率≈60-70%（深盘主胜）"  "true" "$(python3 -c "print('true' if 60 <= $HWP2 <= 75 else 'false')")"
assert_eq "handicapRecommendation=让负（-2盘热门p<0.85→让负）" "让负" "$HREC2"

# 清理测试数据
miaoda db sql "DELETE FROM matches WHERE match_no IN ('${TEST_NO}', '${TEST_NO2}') AND source = 'sporttery';" --yes >/dev/null 2>&1 || true

echo ""
echo "========================================"
echo "  结果：PASS=$PASS  FAIL=$FAIL"
echo "========================================"
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
