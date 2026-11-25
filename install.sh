#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${HOME}/.gemini/config/plugins/agy-git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${SCRIPT_DIR}" != "${TARGET_DIR}" ]; then
  mkdir -p "${TARGET_DIR}"
  cp -R "${SCRIPT_DIR}/plugin.json" "${TARGET_DIR}/"
  cp -R "${SCRIPT_DIR}/assets" "${TARGET_DIR}/"
  cp -R "${SCRIPT_DIR}/sidecars" "${TARGET_DIR}/"
  [ -f "${SCRIPT_DIR}/README.md" ] && cp "${SCRIPT_DIR}/README.md" "${TARGET_DIR}/"
fi

echo "已安装 agy-git 到 ${TARGET_DIR}"
echo "请重启 Antigravity（需要调试端口启用以挂载右上角标题栏入口）。"
