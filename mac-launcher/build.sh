#!/bin/bash
set -euo pipefail

source_dir="$(cd "$(dirname "$0")" && pwd)"
studio_dir="$(cd "$source_dir/.." && pwd)"
application_dir="${1:-$studio_dir}"
app="$application_dir/Moonlit Desk.app"
node "$studio_dir/editor/generate-i18n.js"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
bundle="$stage/Moonlit Desk.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources" "$application_dir"
if [ ! -d "$studio_dir/node_modules" ]; then
  echo "Run npm ci before building the application." >&2
  exit 1
fi
/usr/bin/ditto "$studio_dir/editor" "$bundle/Contents/Resources/editor"
cp "$source_dir/Resources/AppIconMoon-HD.png" "$bundle/Contents/Resources/editor/app-icon.png"
/usr/bin/ditto "$studio_dir/node_modules" "$bundle/Contents/Resources/node_modules"
cp "$source_dir/Resources/zone.tab" "$bundle/Contents/Resources/zone.tab"
cp "$studio_dir/THIRD_PARTY_NOTICES.md" "$bundle/Contents/Resources/THIRD_PARTY_NOTICES.md"

swift "$source_dir/make-icon.swift" "$stage/MoonlitDesk.iconset" "$source_dir/Resources/AppIconMoon-HD.png"
/usr/bin/iconutil -c icns "$stage/MoonlitDesk.iconset" -o "$bundle/Contents/Resources/MoonlitDesk.icns"

swiftc -swift-version 5 -O "$source_dir/Services.swift" "$source_dir/EditorFeature.swift" "$source_dir/ProjectCreator.swift" "$source_dir/LunarPhase.swift" "$source_dir/MoonLocation.swift" "$source_dir/MoonIcon.swift" "$source_dir/StatusAppearance.swift" "$source_dir/Localization.swift" "$source_dir/SettingsWindow.swift" "$source_dir/main.swift" \
  -o "$bundle/Contents/MacOS/MoonlitDesk"
/usr/bin/plutil -create xml1 "$bundle/Contents/Info.plist"
manifest="$bundle/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleIdentifier -string org.moonlitdesk.app "$manifest"
/usr/bin/plutil -insert CFBundleName -string 'Moonlit Desk' "$manifest"
/usr/bin/plutil -insert CFBundleExecutable -string MoonlitDesk "$manifest"
/usr/bin/plutil -insert CFBundleIconFile -string MoonlitDesk.icns "$manifest"
/usr/bin/plutil -insert CFBundlePackageType -string APPL "$manifest"
/usr/bin/plutil -insert CFBundleShortVersionString -string 1.2.0 "$manifest"
/usr/bin/plutil -insert CFBundleVersion -string 5 "$manifest"
/usr/bin/plutil -insert CFBundleURLTypes -json '[{"CFBundleURLName":"org.moonlitdesk.settings","CFBundleURLSchemes":["moonlitdesk"]}]' "$manifest"
/usr/bin/plutil -insert LSUIElement -bool YES "$manifest"
/usr/bin/plutil -insert MoonlitDeskPath -string "$studio_dir" "$manifest"
/usr/bin/codesign --force --sign - "$bundle"
/usr/bin/ditto "$bundle" "$app"
echo "$app"
