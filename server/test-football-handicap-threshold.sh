#!/usr/bin/env bash
# 足球让球拦截回归测试（v6.8.5）
# 用途：验证
#   1. 数据不足 + update 场景三项全观望
#   2. 让球赔率出票 56% 信心门槛（低于=观望，≥56%=出票）
#   3. update 路径下旧推荐被门槛改写为观望
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
if echo "$MRULES" | grep -q "v6.8"; then
  echo "  PASS: modelRules 含数据不足标签"
  PASS=$((PASS + 1))
else
  echo "  FAIL: modelRules 不含数据不足标签 ($MRULES)"
  FAIL=$((FAIL + 1))
fi

# ---------- 用例 2：让球赔率最高49%（低信心边缘盘）→ 观望 ----------
echo ""
echo "=== Test 2: 让球赔率1.80/4.15/3.00 (去水最高49%<56%) → 观望（防边缘盘argmax强推） ==="

TEST_NO2="周三reg003"
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
      "matchDate": "2026-09-25",
      "businessDate": "2026-09-25",
      "league": "回归测试联赛",
      "homeTeam": "主队2",
      "awayTeam": "客队2",
      "kickoffTime": "2026-09-25T20:00:00+08:00",
      "matchStatus": "upcoming",
      "oddsOpenHome": "2.00",
      "oddsOpenDraw": "3.20",
      "oddsOpenAway": "3.50",
      "handicap": "-2",
      "handicapOddsHome": "1.80",
      "handicapOddsDraw": "4.15",
      "handicapOddsAway": "3.00",
      "totalGoals": "2.5",
      "totalOddsOver": "1.90",
      "totalOddsUnder": "1.90",
      "source": "sporttery"
    }
  ]
}' > /dev/null

RESULT2=$(miaoda db sql "SELECT handicap_recommendation, handicap_win_prob, handicap_draw_prob, handicap_lose_prob FROM matches WHERE match_no = '${TEST_NO2}' AND source = 'sporttery';" --json)
HREC2=$(echo "$RESULT2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_recommendation'])")
HW2=$(echo "$RESULT2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_win_prob'])")
HD2=$(echo "$RESULT2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_draw_prob'])")
HL2=$(echo "$RESULT2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_lose_prob'])")

assert_eq "handicapRecommendation=观望（最高49%<56%门槛）" "观望" "$HREC2"
assert_eq "handicapWinProb=49" "49" "$HW2"
assert_eq "handicapDrawProb=21" "21" "$HD2"
assert_eq "handicapLoseProb=30" "30" "$HL2"

# ---------- 用例 3：让球赔率最高54%（边缘盘）→ 观望 ----------
echo ""
echo "=== Test 3: 让球赔率4.35/3.38/1.66 (去水最高54%<56%) → 观望（边缘盘拦截） ==="

TEST_NO3="周三reg004"
miaoda db sql "DELETE FROM matches WHERE match_no = '${TEST_NO3}' AND source = 'sporttery';" --yes >/dev/null 2>&1 || true

curl -sS -X POST "${BASE_URL}/api/sync/ingest/football" \
  -H "Content-Type: application/json" \
  -H "x-sync-token: ${SYNC_TOKEN}" \
  -H "Cookie: suda-csrf-token=${CSRF}" \
  -H "x-suda-csrf-token: ${CSRF}" \
  -d '{
  "matches": [
    {
      "matchNo": "'"${TEST_NO3}"'",
      "matchDate": "2026-09-25",
      "businessDate": "2026-09-25",
      "league": "回归测试联赛",
      "homeTeam": "主队3",
      "awayTeam": "客队3",
      "kickoffTime": "2026-09-25T21:00:00+08:00",
      "matchStatus": "upcoming",
      "oddsOpenHome": "2.20",
      "oddsOpenDraw": "3.10",
      "oddsOpenAway": "3.20",
      "handicap": "-1",
      "handicapOddsHome": "4.35",
      "handicapOddsDraw": "3.38",
      "handicapOddsAway": "1.66",
      "totalGoals": "2.5",
      "totalOddsOver": "1.95",
      "totalOddsUnder": "1.85",
      "source": "sporttery"
    }
  ]
}' > /dev/null

RESULT3=$(miaoda db sql "SELECT handicap_recommendation, handicap_win_prob, handicap_draw_prob, handicap_lose_prob FROM matches WHERE match_no = '${TEST_NO3}' AND source = 'sporttery';" --json)
HREC3=$(echo "$RESULT3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_recommendation'])")
HW3=$(echo "$RESULT3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_win_prob'])")
HD3=$(echo "$RESULT3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_draw_prob'])")
HL3=$(echo "$RESULT3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_lose_prob'])")

assert_eq "handicapRecommendation=观望（最高54%<56%门槛）" "观望" "$HREC3"
assert_eq "handicapLoseProb=54" "54" "$HL3"

# ---------- 用例 4：让球赔率最高62%（高信心）→ 正常出票 ----------
echo ""
echo "=== Test 4: 让球赔率1.45/4.20/5.50 (去水最高62%≥56%) → 让胜（高信心正常出票，防改坏） ==="

TEST_NO4="周三reg005"
miaoda db sql "DELETE FROM matches WHERE match_no = '${TEST_NO4}' AND source = 'sporttery';" --yes >/dev/null 2>&1 || true

curl -sS -X POST "${BASE_URL}/api/sync/ingest/football" \
  -H "Content-Type: application/json" \
  -H "x-sync-token: ${SYNC_TOKEN}" \
  -H "Cookie: suda-csrf-token=${CSRF}" \
  -H "x-suda-csrf-token: ${CSRF}" \
  -d '{
  "matches": [
    {
      "matchNo": "'"${TEST_NO4}"'",
      "matchDate": "2026-09-25",
      "businessDate": "2026-09-25",
      "league": "回归测试联赛",
      "homeTeam": "主队4",
      "awayTeam": "客队4",
      "kickoffTime": "2026-09-25T22:00:00+08:00",
      "matchStatus": "upcoming",
      "oddsOpenHome": "1.40",
      "oddsOpenDraw": "4.50",
      "oddsOpenAway": "8.00",
      "handicap": "-2",
      "handicapOddsHome": "1.45",
      "handicapOddsDraw": "4.20",
      "handicapOddsAway": "5.50",
      "totalGoals": "2.5",
      "totalOddsOver": "1.90",
      "totalOddsUnder": "1.90",
      "source": "sporttery"
    }
  ]
}' > /dev/null

RESULT4=$(miaoda db sql "SELECT handicap_recommendation, handicap_win_prob, handicap_draw_prob, handicap_lose_prob FROM matches WHERE match_no = '${TEST_NO4}' AND source = 'sporttery';" --json)
HREC4=$(echo "$RESULT4" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_recommendation'])")
HW4=$(echo "$RESULT4" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_win_prob'])")

assert_eq "handicapRecommendation=让胜（最高62%≥56%门槛）" "让胜" "$HREC4"
assert_eq "handicapWinProb=62" "62" "$HW4"

# ---------- 用例 5：update 路径下旧推荐（让胜）被门槛改写为观望 ----------
echo ""
echo "=== Test 5: update 路径下旧推荐'让胜'被门槛改写为'观望'（防旧数据残留） ==="

# 复用 Test 2 的记录，先手动改成"让胜"模拟旧数据
miaoda db sql "UPDATE matches SET handicap_recommendation='让胜', handicap_win_prob=49, handicap_draw_prob=21, handicap_lose_prob=30 WHERE match_no='${TEST_NO2}' AND source='sporttery';" --yes >/dev/null
echo "  预置：旧数据 handicapRecommendation='让胜'"

# 再次推送（update 路径，odds 未变但 handicapOdds 仍写入 updateSet）
curl -sS -X POST "${BASE_URL}/api/sync/ingest/football" \
  -H "Content-Type: application/json" \
  -H "x-sync-token: ${SYNC_TOKEN}" \
  -H "Cookie: suda-csrf-token=${CSRF}" \
  -H "x-suda-csrf-token: ${CSRF}" \
  -d '{
  "matches": [
    {
      "matchNo": "'"${TEST_NO2}"'",
      "matchDate": "2026-09-25",
      "businessDate": "2026-09-25",
      "league": "回归测试联赛",
      "homeTeam": "主队2",
      "awayTeam": "客队2",
      "kickoffTime": "2026-09-25T20:00:00+08:00",
      "matchStatus": "upcoming",
      "oddsOpenHome": "2.00",
      "oddsOpenDraw": "3.20",
      "oddsOpenAway": "3.50",
      "handicap": "-2",
      "handicapOddsHome": "1.80",
      "handicapOddsDraw": "4.15",
      "handicapOddsAway": "3.00",
      "totalGoals": "2.5",
      "totalOddsOver": "1.90",
      "totalOddsUnder": "1.90",
      "source": "sporttery"
    }
  ]
}' > /dev/null

RESULT5=$(miaoda db sql "SELECT handicap_recommendation, handicap_win_prob, handicap_draw_prob, handicap_lose_prob FROM matches WHERE match_no = '${TEST_NO2}' AND source = 'sporttery';" --json)
HREC5=$(echo "$RESULT5" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_recommendation'])")

assert_eq "update后handicapRecommendation=观望（旧让胜被门槛改写）" "观望" "$HREC5"

# ---------- 用例 6：篮球不受影响（篮球让分逻辑保持原样） ----------
echo ""
echo "=== Test 6: 篮球让分逻辑保持原样（严禁足球改动污染篮球） ==="

BTEST="篮reg001"
miaoda db sql "DELETE FROM basketball_matches WHERE match_no = '${BTEST}' AND source = 'sporttery';" --yes >/dev/null 2>&1 || true

curl -sS -X POST "${BASE_URL}/api/sync/ingest/basketball" \
  -H "Content-Type: application/json" \
  -H "x-sync-token: ${SYNC_TOKEN}" \
  -H "Cookie: suda-csrf-token=${CSRF}" \
  -H "x-suda-csrf-token: ${CSRF}" \
  -d '{
  "matches": [
    {
      "matchNo": "'"${BTEST}"'",
      "matchDate": "2026-09-25",
      "businessDate": "2026-09-25",
      "league": "NBA测试",
      "homeTeam": "湖人",
      "awayTeam": "勇士",
      "kickoffTime": "2026-09-25T10:00:00+08:00",
      "matchStatus": "upcoming",
      "handicap": "-3.5",
      "handicapOddsHome": "1.85",
      "handicapOddsAway": "1.85",
      "totalScore": "215.5",
      "totalOddsOver": "1.90",
      "totalOddsUnder": "1.90",
      "source": "sporttery"
    }
  ]
}' > /dev/null

BRESULT=$(miaoda db sql "SELECT handicap_recommendation, total_direction, home_win_prob, away_win_prob FROM basketball_matches WHERE match_no = '${BTEST}' AND source = 'sporttery';" --json)
BHREC=$(echo "$BRESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_recommendation'])")
BTOT=$(echo "$BRESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['total_direction'])")

assert_eq "篮球handicapRecommendation非空（逻辑未被破坏）" "true" "$(python3 -c "print('true' if '$BHREC' != '' else 'false')")"
assert_eq "篮球totalDirection非空"                                       "true" "$(python3 -c "print('true' if '$BTOT' != '' else 'false')")"

# 清理测试数据
miaoda db sql "DELETE FROM matches WHERE match_no IN ('${TEST_NO}', '${TEST_NO2}', '${TEST_NO3}', '${TEST_NO4}') AND source = 'sporttery';" --yes >/dev/null 2>&1 || true
miaoda db sql "DELETE FROM basketball_matches WHERE match_no = '${BTEST}' AND source = 'sporttery';" --yes >/dev/null 2>&1 || true

echo ""
echo "========================================"
echo "  结果：PASS=$PASS  FAIL=$FAIL"
echo "========================================"
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
