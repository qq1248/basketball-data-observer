#!/usr/bin/env bash
# v6.8.7 HTTP e2e regression: POST /api/sync/ingest/football
# 3 cases:
#   1) 周三002: 显式传三项观望 + 低信心让球赔率 + 无大小赔率 → 三项全观望
#   2) 周三003: 高信心让球赔率(1.45/4.2/5.5) 不传推荐 → 让胜出票
#   3) 周三004: provided分支 + 大小球赔率(1.55/2.40) 不传totalPick → 大球

set -u

APP_ID="${APP_ID:-app_17e50w9zycw}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8001/app/${APP_ID}}"
SYNC_TOKEN="${SYNC_TOKEN:-f43ff16129793f5bdd3109af35d0d4bd5826dbec342e1a2af31166d5cd5e90b5}"
CSRF="test-csrf-v687"

PASS=0
FAIL=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL $desc  expected=$expected  actual=$actual"
    FAIL=$((FAIL+1))
  fi
}

assert_ge() {
  local desc="$1" expected_min="$2" actual="$3"
  if [ "$(python3 -c "print(float('$actual') >= float('$expected_min'))")" = "True" ]; then
    echo "  PASS $desc (actual=$actual)"
    PASS=$((PASS+1))
  else
    echo "  FAIL $desc  expected>=$expected_min  actual=$actual"
    FAIL=$((FAIL+1))
  fi
}

ingest() {
  curl -sS -X POST "${BASE_URL}/api/sync/ingest/football" \
    -H "Content-Type: application/json" \
    -H "x-sync-token: ${SYNC_TOKEN}" \
    -H "Cookie: suda-csrf-token=${CSRF}" \
    -H "x-suda-csrf-token: ${CSRF}" \
    -d "$1" > /dev/null
}

read_match() {
  local no="$1"
  miaoda db sql "SELECT prediction_direction, handicap_recommendation, total_pick, over_prob, under_prob, home_win_prob, draw_prob, away_win_prob, handicap_win_prob, handicap_draw_prob, handicap_lose_prob, low_confidence FROM matches WHERE match_no = '${no}' AND source = 'sporttery' LIMIT 1;" --json
}

# ---- Case 1: 周三002 三项观望 ----
echo "=== Case 1: 周三002 显式观望 + 低信心让球赔率 + 无大小赔率 ==="
TEST_NO="周三002"
miaoda db sql "DELETE FROM matches WHERE match_no = '${TEST_NO}' AND source = 'sporttery';" --yes >/dev/null 2>&1
miaoda db sql "INSERT INTO matches (match_no, match_date, business_date, league, home_team, away_team, kickoff_time, source, handicap, total_goals, odds_open_home, odds_open_draw, odds_open_away, handicap_odds_home, handicap_odds_draw, handicap_odds_away, total_odds_over, total_odds_under, prediction_direction, handicap_recommendation, total_pick, over_prob, under_prob, home_win_prob, draw_prob, away_win_prob, low_confidence, model_rules) VALUES ('${TEST_NO}', '2026-09-24'::date, '2026-09-24'::date, '亚运男足', '日本亚足', '泰国亚运男足', '2026-09-24 18:30:00+08', 'sporttery', '-2', '2.5', '2.10', '3.20', '3.30', '1.80', '4.15', '3.00', NULL, NULL, '主胜', '让胜', '大球', 58, 42, 45, 30, 25, false, '{预置}');" --yes >/dev/null

ingest '{"matches":[{"matchNo":"周三002","matchDate":"2026-09-24","businessDate":"2026-09-24","league":"亚运男足","homeTeam":"日本亚足","awayTeam":"泰国亚运男足","kickoffTime":"2026-09-24T18:30:00+08:00","matchStatus":"upcoming","oddsOpenHome":"2.10","oddsOpenDraw":"3.20","oddsOpenAway":"3.30","handicap":"-2","handicapOddsHome":"1.80","handicapOddsDraw":"4.15","handicapOddsAway":"3.00","totalGoals":"2.5","totalOddsOver":"","totalOddsUnder":"","predictionDirection":"观望","handicapRecommendation":"观望","totalPick":"观望","confidence":35,"lowConfidence":true}]}'

R=$(read_match "$TEST_NO" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data'][0]
print(d['prediction_direction'])
print(d['handicap_recommendation'])
print(d['total_pick'])
print(d['low_confidence'])
")
IFS=$'\n' read -r -d '' -a L <<< "$R" || true

assert_eq "周三002 prediction_direction=观望" "观望" "${L[0]}"
assert_eq "周三002 handicap_recommendation=观望" "观望" "${L[1]}"
assert_eq "周三002 total_pick=观望" "观望" "${L[2]}"
assert_eq "周三002 low_confidence=true" "True" "${L[3]}"

# ---- Case 2: 周三003 高信心让球出票 ----
echo ""
echo "=== Case 2: 周三003 高信心让球赔率(1.45/4.2/5.5) 不传推荐 → 让胜出票 ==="
TEST_NO2="周三003"
miaoda db sql "DELETE FROM matches WHERE match_no = '${TEST_NO2}' AND source = 'sporttery';" --yes >/dev/null 2>&1
miaoda db sql "INSERT INTO matches (match_no, match_date, business_date, league, home_team, away_team, kickoff_time, source, handicap, total_goals, odds_open_home, odds_open_draw, odds_open_away, handicap_odds_home, handicap_odds_draw, handicap_odds_away, total_odds_over, total_odds_under, prediction_direction, handicap_recommendation, total_pick, over_prob, under_prob, home_win_prob, draw_prob, away_win_prob, low_confidence, model_rules) VALUES ('${TEST_NO2}', '2026-09-24'::date, '2026-09-24'::date, '测试', '主队A', '客队B', '2026-09-24 20:00:00+08', 'sporttery', '-1', '2.5', '1.45', '4.20', '5.50', NULL, NULL, NULL, '1.80', '2.00', '观望', '观望', '观望', 50, 50, 35, 30, 35, true, '{预置}');" --yes >/dev/null

# 只传赔率，不传推荐方向 → 服务端从赔率推导
ingest '{"matches":[{"matchNo":"周三003","matchDate":"2026-09-24","businessDate":"2026-09-24","league":"测试","homeTeam":"主队A","awayTeam":"客队B","kickoffTime":"2026-09-24T20:00:00+08:00","matchStatus":"upcoming","oddsOpenHome":"1.45","oddsOpenDraw":"4.20","oddsOpenAway":"5.50","handicap":"-1","handicapOddsHome":"1.45","handicapOddsDraw":"4.20","handicapOddsAway":"5.50","totalGoals":"2.5","totalOddsOver":"1.80","totalOddsUnder":"2.00"}]}'

R=$(read_match "$TEST_NO2" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data'][0]
print(d['prediction_direction'])
print(d['handicap_recommendation'])
print(d['total_pick'])
print(d['handicap_win_prob'])
print(d['low_confidence'])
")
IFS=$'\n' read -r -d '' -a L <<< "$R" || true

assert_eq "周三003 prediction_direction=主胜" "主胜" "${L[0]}"
assert_eq "周三003 handicap_recommendation=让胜" "让胜" "${L[1]}"
assert_eq "周三003 total_pick非空非null非观望" "大球" "${L[2]}"
assert_ge "周三003 让胜去水概率>=56%" "56" "${L[3]}"

# ---- Case 3: 周三004 provided分支+大小球赔率推导 ----
echo ""
echo "=== Case 3: 周三004 provided分支+大小球赔率(1.55/2.40) 不传totalPick → 大球 ==="
TEST_NO3="周三004"
miaoda db sql "DELETE FROM matches WHERE match_no = '${TEST_NO3}' AND source = 'sporttery';" --yes >/dev/null 2>&1
miaoda db sql "INSERT INTO matches (match_no, match_date, business_date, league, home_team, away_team, kickoff_time, source, handicap, total_goals, odds_open_home, odds_open_draw, odds_open_away, handicap_odds_home, handicap_odds_draw, handicap_odds_away, total_odds_over, total_odds_under, prediction_direction, handicap_recommendation, total_pick, over_prob, under_prob, home_win_prob, draw_prob, away_win_prob, low_confidence, model_rules) VALUES ('${TEST_NO3}', '2026-09-24'::date, '2026-09-24'::date, '测试大小球', '甲队', '乙队', '2026-09-24 21:00:00+08', 'sporttery', '-1', '2.5', '1.80', '3.40', '4.20', '1.95', '3.50', '3.30', NULL, NULL, '主胜', '让胜', '观望', 50, 50, 55, 25, 20, false, '{预置}');" --yes >/dev/null

ingest '{"matches":[{"matchNo":"周三004","matchDate":"2026-09-24","businessDate":"2026-09-24","league":"测试大小球","homeTeam":"甲队","awayTeam":"乙队","kickoffTime":"2026-09-24T21:00:00+08:00","matchStatus":"upcoming","oddsOpenHome":"1.80","oddsOpenDraw":"3.40","oddsOpenAway":"4.20","handicap":"-1","handicapOddsHome":"1.95","handicapOddsDraw":"3.50","handicapOddsAway":"3.30","totalGoals":"2.5","totalOddsOver":"1.55","totalOddsUnder":"2.40","homeWinProb":55,"drawProb":25,"awayWinProb":20,"predictionDirection":"主胜","handicapRecommendation":"让胜","confidence":55,"lowConfidence":false}]}'

R=$(read_match "$TEST_NO3" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data'][0]
print(d['total_pick'])
print(d['over_prob'])
print(d['under_prob'])
print(d['prediction_direction'])
print(d['handicap_recommendation'])
")
IFS=$'\n' read -r -d '' -a L <<< "$R" || true

assert_eq "周三004 total_pick=大球" "大球" "${L[0]}"
assert_ge "周三004 over_prob > 50" "50" "${L[1]}"
assert_eq "周三004 prediction_direction=主胜" "主胜" "${L[3]}"
assert_eq "周三004 handicap_recommendation=让胜" "让胜" "${L[4]}"

# ---- 清理 ----
miaoda db sql "DELETE FROM matches WHERE match_no IN ('周三002','周三003','周三004') AND source = 'sporttery';" --yes >/dev/null 2>&1

echo ""
echo "=== Summary: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
