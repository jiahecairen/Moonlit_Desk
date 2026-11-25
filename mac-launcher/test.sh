#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
swiftc "$source_dir/LunarPhase.swift" "$source_dir/tests/LunarPhaseTests.swift" -o "$work/lunar-tests"
"$work/lunar-tests"
swiftc "$source_dir/MoonLocation.swift" "$source_dir/tests/MoonLocationTests.swift" -o "$work/location-tests"
"$work/location-tests" "$source_dir/StatusAppearance.swift"
