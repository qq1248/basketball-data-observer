#!/usr/bin/env bash
# 足球数据不足 + 让球门槛 + 大小球非空 回归测试（v6.8.6）
# 运行：bash server/test-football-totalpick-null.sh
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

assert_ne_null() {
  local desc="$1" actual="$2"
  if [[ "$actual" != "" && "$actual" != "null" && "$actual" != "None" ]]; then
    echo "  PASS: $desc (actual=$actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

# ---------- 用例 1：已存在记录 totalGoals=2.5、全空赔率 + update → 三项全观望且非空 ----------
echo "=== Test 1: 已存在记录(totalGoals=2.5,全空赔率) + update → 三项全观望且totalPick非空 ==="

TEST_NO="周三reg006"
miaoda db sql "DELETE FROM matches WHERE match_no = '${TEST_NO}' AND source = 'sporttery';" --yes >/dev/null 2>&1 || true
# 预置：totalPick=NULL 模拟线上漏网场景
miaoda db sql "INSERT INTO matches (match_no, match_date, business_date, league, home_team, away_team, kickoff_time, source, handicap, total_goals, home_win_prob, draw_prob, away_win_prob, over_prob, under_prob, prediction_direction, low_confidence, handicap_recommendation, handicap_win_prob, handicap_draw_prob, handicap_lose_prob, total_pick, model_rules) VALUES ('${TEST_NO}', '2026-09-24'::date, '2026-09-24'::date, '亚运男足测试', '日本亚足', '泰国亚运男足', '2026-09-24 18:30:00+08', 'sporttery', '-2', '2.5', 35, 30, 35, 50, 50, '观望', true, '观望', 35, 30, 35, NULL, '{数据不足：硬拦截三项全观望（v6.8.4）}');" --yes >/dev/null

echo "  预置：totalPick = NULL（模拟线上漏网场景）"

# 推送 update（不带推荐字段，只有 totalGoals=2.5 与全空赔率）
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
      "league": "亚运男足测试",
      "homeTeam": "日本亚足",
      "awayTeam": "泰国亚运男足",
      "kickoffTime": "2026-09-24T18:30:00+08:00",
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

RESULT=$(miaoda db sql "SELECT prediction_direction, handicap_recommendation, total_pick, over_prob, under_prob, home_win_prob, draw_prob, away_win_prob FROM matches WHERE match_no = '${TEST_NO}' AND source = 'sporttery';" --json)
PDIR=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['data'][0]['prediction_direction']; print('' if v is None else v)")
HREC=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['data'][0]['handicap_recommendation']; print('' if v is None else v)")
TPICK=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['data'][0]['total_pick']; print('' if v is None else v)")
OP=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['over_prob'])")
UP=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['under_prob'])")

assert_eq "predictionDirection=观望" "观望" "$PDIR"
assert_eq "handicapRecommendation=观望" "观望" "$HREC"
assert_eq "totalPick=观望（核心修复：null→观望）" "观望" "$TPICK"
assert_eq "overProb=50" "50" "$OP"
assert_eq "underProb=50" "50" "$UP"

# ---------- 用例 2：让球赔率1.80/4.15/3.00 (最高49%) → 观望（保留v6.8.5回归） ----------
echo ""
echo "=== Test 2: 让球赔率1.80/4.15/3.00 (49%<56%) → 观望（v6.8.5回归保留） ==="

TEST_NO2="周三reg007"
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

RESULT2=$(miaoda db sql "SELECT handicap_recommendation, handicap_win_prob FROM matches WHERE match_no = '${TEST_NO2}' AND source = 'sporttery';" --json)
HREC2=$(echo "$RESULT2" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['data'][0]['handicap_recommendation']; print('' if v is None else v)")
HW2=$(echo "$RESULT2" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_win_prob'])")

assert_eq "handicapRecommendation=观望（49%<56%）" "观望" "$HREC2"
assert_eq "handicapWinProb=49" "49" "$HW2"

# ---------- 用例 3：让球赔率4.35/3.38/1.66 (最高54%) → 观望（保留v6.8.5回归） ----------
echo ""
echo "=== Test 3: 让球赔率4.35/3.38/1.66 (54%<56%) → 观望（v6.8.5回归保留） ==="

TEST_NO3="周三reg008"
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

RESULT3=$(miaoda db sql "SELECT handicap_recommendation, handicap_lose_prob FROM matches WHERE match_no = '${TEST_NO3}' AND source = 'sporttery';" --json)
HREC3=$(echo "$RESULT3" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['data'][0]['handicap_recommendation']; print('' if v is None else v)")
HL3=$(echo "$RESULT3" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_lose_prob'])")

assert_eq "handicapRecommendation=观望（54%<56%）" "观望" "$HREC3"
assert_eq "handicapLoseProb=54" "54" "$HL3"

# ---------- 用例 4：让球赔率1.45/4.20/5.50 (最高62%≥56%) → 让胜（高信心正常出票，防改坏） ----------
echo ""
echo "=== Test 4: 让球赔率1.45/4.20/5.50 (62%≥56%) → 让胜（高信心正常出票，防改坏） ==="

TEST_NO4="周三reg009"
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

RESULT4=$(miaoda db sql "SELECT handicap_recommendation, handicap_win_prob, total_pick FROM matches WHERE match_no = '${TEST_NO4}' AND source = 'sporttery';" --json)
HREC4=$(echo "$RESULT4" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['data'][0]['handicap_recommendation']; print('' if v is None else v)")
HW4=$(echo "$RESULT4" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['handicap_win_prob'])")
TP4=$(echo "$RESULT4" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['data'][0]['total_pick']; print('' if v is None else v)")

assert_eq "handicapRecommendation=让胜（62%≥56%）" "让胜" "$HREC4"
assert_eq "handicapWinProb=62" "62" "$HW4"
assert_ne_null "totalPick非空" "$TP4"

# ---------- 用例 5：有大小赔率正常出大/小球（防改坏大小球逻辑） ----------
echo ""
echo "=== Test 5: 有大小赔率时正常出大/小球（防改坏大小球逻辑） ==="

TEST_NO5="周三reg010"
miaoda db sql "DELETE FROM matches WHERE match_no = '${TEST_NO5}' AND source = 'sporttery';" --yes >/dev/null 2>&1 || true

curl -sS -X POST "${BASE_URL}/api/sync/ingest/football" \
  -H "Content-Type: application/json" \
  -H "x-sync-token: ${SYNC_TOKEN}" \
  -H "Cookie: suda-csrf-token=${CSRF}" \
  -H "x-suda-csrf-token: ${CSRF}" \
  -d '{
  "matches": [
    {
      "matchNo": "'"${TEST_NO5}"'",
      "matchDate": "2026-09-25",
      "businessDate": "2026-09-25",
      "league": "回归测试联赛",
      "homeTeam": "主队5",
      "awayTeam": "客队5",
      "kickoffTime": "2026-09-25T23:00:00+08:00",
      "matchStatus": "upcoming",
      "oddsOpenHome": "1.80",
      "oddsOpenDraw": "3.40",
      "oddsOpenAway": "4.20",
      "handicap": "-1",
      "handicapOddsHome": "2.00",
      "handicapOddsDraw": "3.30",
      "handicapOddsAway": "2.90",
      "totalGoals": "2.5",
      "totalOddsOver": "1.55",
      "totalOddsUnder": "2.40",
      "source": "sporttery"
    }
  ]
}' > /dev/null

RESULT5=$(miaoda db sql "SELECT total_pick, over_prob, under_prob FROM matches WHERE match_no = '${TEST_NO5}' AND source = 'sporttery';" --json)
TP5=$(echo "$RESULT5" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['data'][0]['total_pick']; print('' if v is None else v)")
OP5=$(echo "$RESULT5" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['over_prob'])")

assert_eq "totalPick=大球（赔率1.55看大占优）" "大球" "$TP5"
assert_eq "overProb≥50（去水后大球占优）" "true" "$(python3 -c "print('true' if $OP5 >= 50 else 'false')")"

# ---------- 用例 6：篮球不受影响（安全确认） ----------
echo ""
echo "=== Test 6: 篮球大小分/让分逻辑保持原样（严禁改动篮球） ==="

BTEST="篮reg002"
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

BRESULT=$(miaoda db sql "SELECT handicap_recommendation, total_direction FROM basketball_matches WHERE match_no = '${BTEST}' AND source = 'sporttery';" --json)
BHREC=$(echo "$BRESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['data'][0]['handicap_recommendation']; print('' if v is None else v)")
BTOT=$(echo "$BRESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d['data'][0]['total_direction']; print('' if v is None else v)")

assert_ne_null "篮球handicapRecommendation非空" "$BHREC"
assert_ne_null "篮球totalDirection非空" "$BTOT"

# 清理
miaoda db sql "DELETE FROM matches WHERE match_no IN ('${TEST_NO}', '${TEST_NO2}', '${TEST_NO3}', '${TEST_NO4}', '${TEST_NO5}') AND source = 'sporttery';" --yes >/dev/null 2>&1 || true
miaoda db sql "DELETE FROM basketball_matches WHERE match_no = '${BTEST}' AND source = 'sporttery';" --yes >/dev/null 2>&1 || true

echo ""
echo "========================================"
echo "  结果：PASS=$PASS  FAIL=$FAIL"
echo "========================================"
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
