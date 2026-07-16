#!/usr/bin/env bash
# Chạy Boss OS (Core) trên http://127.0.0.1:7788, nối tới Store local (:8899)
# Đăng nhập: admin / (mật khẩu Sếp đã đặt)
set -e
cd "$(dirname "$0")"

export BOSS_STORE_URL="${BOSS_STORE_URL:-http://127.0.0.1:8899}"
export BOSS_HOST=127.0.0.1

echo "▶ Boss OS:  http://127.0.0.1:7788   (Store: $BOSS_STORE_URL)"
exec .venv/bin/python -m uvicorn main:app --app-dir server --host 127.0.0.1 --port 7788
