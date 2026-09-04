#!/usr/bin/env bash
# ============================================================
# pack-site.sh — 把工作区打包成 GitHub Pages 发布目录
# 用法：bash tools/pack-site.sh [输出目录]   （默认 _site）
# 顺序：先 build 两个站点，再 pack。index.html 是生成物，本脚本只搬运。
#
# 发布白名单思路 = 全仓库 - 下面这些排除项。
# 以后新增站点子目录（如 /portfolio/）不用改这里；新增「不该公开」的
# 源码/文档目录时，往 EXCLUDES 里加一行即可。
# ============================================================
set -euo pipefail

OUT="${1:-_site}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rm -rf "$SRC/$OUT"
mkdir -p "$SRC/$OUT"

EXCLUDES=(
  ".git/"    # 版本库
  ".github/" # workflow 源码
  "_site/"   # 自身
  "tools/"   # 构建器 / 编辑台 / 发布脚本（根站与 career 站均有）
  "*.md"     # 编辑指南等内部文档
  ".gitignore"
  ".DS_Store"
  "node_modules/"
)

RSYNC_ARGS=(-a)
for e in "${EXCLUDES[@]}"; do RSYNC_ARGS+=(--exclude "$e"); done

rsync "${RSYNC_ARGS[@]}" "$SRC/" "$SRC/$OUT/"

# 关闭 Jekyll 处理，按原样发布静态文件
: >"$SRC/$OUT/.nojekyll"

echo "packed -> $SRC/$OUT"
find "$SRC/$OUT" -type f | sed "s|$SRC/||" | sort
