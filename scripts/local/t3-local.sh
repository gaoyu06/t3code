#!/bin/zsh
# 本地 fork 版 T3 Code 的同步、构建与安装。
#   t3-local.sh build           合并官方 main、装依赖、测试、构建、签名（自用分支 personal，桌面和手机共用）
#   t3-local.sh install         退出 T3、备份并替换 /Applications 里的应用、重新打开
set -euo pipefail

REPO="$HOME/dev/t3code"
BRANCH="personal"
OUT="$REPO/release-local"
APP_NAME="T3 Code (Beta)"
INSTALLED="/Applications/$APP_NAME.app"
IDENTITY="Apple Development: gaoyuism@proton.me (Q52J6SV4M2)"
ENTITLEMENTS="$REPO/scripts/local/entitlements.mac.plist"
LOG="$OUT/t3-local.log"

cd "$REPO" || exit 1
mkdir -p "$OUT"
. "$HOME/.config/vite-plus/env" 2>/dev/null || true

stable_tag() {
  git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
}

build() {
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "工作区有未提交改动，先处理" >&2; exit 1; }
  git checkout -q "$BRANCH"
  git fetch -q upstream --tags
  git merge -q --no-edit upstream/main
  local new_base
  new_base=$(stable_tag)
  local version=${new_base#v}

  vp i
  (cd apps/server && vp test run src/provider/codexProxyUsage.test.ts src/provider/ProviderRegistry.test.ts)
  vp run --filter t3 typecheck

  rm -rf "$OUT/mac-arm64"
  node scripts/build-desktop-artifact.ts --platform mac --target dir --arch arm64 \
    --build-version "$version" --output-dir "$OUT"
  local app="$OUT/mac-arm64/$APP_NAME.app"
  [[ -d "$app" ]] || app=$(find "$OUT" -maxdepth 3 -name '*.app' -type d | head -1)
  codesign --force --deep --options runtime --timestamp=none \
    --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$app"
  codesign --verify --deep --strict "$app"
  git push -q origin "$BRANCH"
  echo "构建完成：$app（合并官方 main，版本号沿用 $new_base）"
}

install_app() {
  local app="$OUT/mac-arm64/$APP_NAME.app"
  [[ -d "$app" ]] || { echo "没有构建产物：$app" >&2; exit 1; }
  {
    echo "== install $(date)"
    osascript -e "quit app \"$APP_NAME\"" || true
    for _ in {1..60}; do pgrep -f "$INSTALLED/Contents/MacOS/" >/dev/null || break; sleep 1; done
    local backup="$OUT/backup-$(date +%Y%m%d-%H%M%S).zip"
    [[ -d "$INSTALLED" ]] && ditto -c -k --keepParent "$INSTALLED" "$backup" && echo "旧版已备份：$backup"
    rm -rf "$INSTALLED"
    ditto "$app" "$INSTALLED"
    open -a "$INSTALLED"
    echo "已安装并启动"
  } >>"$LOG" 2>&1
}

case "${1:-}" in
  build) build ;;
  install) install_app ;;
  *) echo "用法：$0 build | install" >&2; exit 2 ;;
esac
