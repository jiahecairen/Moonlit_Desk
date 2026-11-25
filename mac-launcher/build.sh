#!/bin/bash
set -euo pipefail

source_dir="$(cd "$(dirname "$0")" && pwd)"
studio_dir="$(cd "$source_dir/.." && pwd)"
application_dir="${1:-$studio_dir}"
app="$application_dir/Moonlit Desk.app"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
bundle="$stage/Moonlit Desk.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources" "$application_dir"
if [ ! -d "$studio_dir/node_modules" ]; then
  echo "Run npm ci before building the application." >&2
  exit 1
fi
/usr/bin/ditto "$studio_dir/editor" "$bundle/Contents/Resources/editor"
/usr/bin/ditto "$studio_dir/node_modules" "$bundle/Contents/Resources/node_modules"
cp "$studio_dir/THIRD_PARTY_NOTICES.md" "$bundle/Contents/Resources/THIRD_PARTY_NOTICES.md"

swiftc -swift-version 5 -O "$source_dir/Services.swift" "$source_dir/EditorFeature.swift" "$source_dir/ProjectCreator.swift" "$source_dir/LunarPhase.swift" "$source_dir/StatusAppearance.swift" "$source_dir/main.swift" \
  -o "$bundle/Contents/MacOS/MoonlitDesk"
/usr/bin/plutil -create xml1 "$bundle/Contents/Info.plist"
manifest="$bundle/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleIdentifier -string org.moonlitdesk.app "$manifest"
/usr/bin/plutil -insert CFBundleName -string 'Moonlit Desk' "$manifest"
/usr/bin/plutil -insert CFBundleExecutable -string MoonlitDesk "$manifest"
/usr/bin/plutil -insert CFBundlePackageType -string APPL "$manifest"
/usr/bin/plutil -insert CFBundleShortVersionString -string 1.1 "$manifest"
/usr/bin/plutil -insert CFBundleVersion -string 2 "$manifest"
/usr/bin/plutil -insert NSLocationWhenInUseUsageDescription -string "根据当前位置调整菜单栏月相图标的朝向。坐标仅保存在本机，也可以在月相设置中手动填写。" "$manifest"
/usr/bin/plutil -insert NSLocationUsageDescription -string "根据当前位置调整菜单栏月相图标的朝向，坐标仅保存在本机。" "$manifest"
/usr/bin/plutil -insert LSUIElement -bool YES "$manifest"
/usr/bin/plutil -insert MoonlitDeskPath -string "$studio_dir" "$manifest"
/usr/bin/codesign --force --sign - "$bundle"
/usr/bin/ditto "$bundle" "$app"
echo "$app"
