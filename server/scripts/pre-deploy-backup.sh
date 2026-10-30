#!/usr/bin/env bash
set -euo pipefail

# 发布前数据库备份脚本
# 用途：每次发布前导出所有业务表的完整备份，确保数据可回滚
# 使用：bash server/scripts/pre-deploy-backup.sh
# 输出：/tmp/db-backups/<timestamp>/ 目录下各表 JSON 文件

TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/db-backups/${TS}"
mkdir -p "${BACKUP_DIR}"

echo "=== 发布前数据库备份 ==="
echo "时间戳: ${TS}"
echo "备份目录: ${BACKUP_DIR}"
echo ""

TABLES=(
  "matches"
  "basketball_matches"
  "members"
  "favorites"
  "prediction_records"
  "invitations"
)

TOTAL_ROWS=0

for TABLE in "${TABLES[@]}"; do
  OUTFILE="${BACKUP_DIR}/${TABLE}.json"
  echo -n "导出 ${TABLE} ... "
  RESULT=$(miaoda db data export "${TABLE}" --format json -f "${OUTFILE}" --force 2>&1)
  if echo "${RESULT}" | grep -q "Exported"; then
    ROWS=$(echo "${RESULT}" | grep -oP '(\d+) rows' | grep -oP '\d+' || echo 0)
    TOTAL_ROWS=$((TOTAL_ROWS + ROWS))
    SIZE=$(ls -lh "${OUTFILE}" | awk '{print $5}')
    echo "OK (${ROWS} 行, ${SIZE})"
  else
    echo "FAIL"
    echo "  错误: ${RESULT}"
    exit 1
  fi
done

echo ""
echo "=== 备份完成 ==="
echo "总行数: ${TOTAL_ROWS}"
echo "备份目录: ${BACKUP_DIR}"
du -sh "${BACKUP_DIR}" | awk '{print "总大小: " $1}'

echo ""
echo "备份路径: ${BACKUP_DIR}"
echo "可以安全执行 miaoda deploy --wait"
