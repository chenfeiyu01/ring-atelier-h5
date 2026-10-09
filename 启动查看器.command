#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  echo "需要 Node.js 22.12+；安装后重新打开本文件。"
  read -r
  exit 1
fi
if [ ! -d node_modules ]; then npm ci || exit 1; fi
npm run dev
