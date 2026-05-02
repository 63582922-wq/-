#!/usr/bin/env bash
# 局域网内手机可访问：监听 0.0.0.0（勿用 127.0.0.1）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT"

if command -v lsof >/dev/null 2>&1; then
  old="$(lsof -nP -iTCP:8000 -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$old" ]]; then
    echo "端口 8000 已被占用（多半是之前只监听本机的 uvicorn）。请先关掉再启动本脚本："
    echo ""
    echo "$old"
    echo ""
    echo "在运行 uvicorn 的终端按 Ctrl+C，或执行： kill <上表中的 PID>"
    exit 1
  fi
fi

echo "启动后端（监听 0.0.0.0:8000）…"
echo "手机请用同一 Wi-Fi，浏览器打开： http://<下面任一局域网 IP>:8000"
echo ""
(inet_lines="$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" { print $2 }')" && [[ -n "$inet_lines" ]] && echo "$inet_lines" || echo "（未能自动列出 IP，请在 Mac「设置 → 网络」查看）")
echo ""
echo "须先打包前端： cd web/frontend && npm run build"
echo ""
echo "重要：拉代码或改 .env / web/backend 后，务必关掉旧 uvicorn 再运行本脚本，否则手机仍会命中旧接口（秒回、无 reply_source）。"
echo "自检：浏览器打开 http://<IP>:8000/api/status 应看到 build_mark=reply-source-v8"
echo ""

exec python3 -m uvicorn web.backend.main:app --host 0.0.0.0 --port 8000
