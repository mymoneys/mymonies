#!/usr/bin/env sh
# Builds the WDK worklet bundle and links its native addons into
# react-native-bare-kit, alongside the ones QVAC's Expo plugin links.
#
# Why: bare-kit does not link worklet addons automatically. QVAC's prebuild
# links QVAC's; nothing links WDK's (HRPC transport skips it by default), so
# the wallet worklet aborted on start with "Cannot load addon
# 'linked:libbare-module-lexer.1.7.0.so'". `cp -n` adds only libraries that
# aren't already there, so the two sets never collide.
#
# Run after `npm install` (postinstall does) and after every `expo prebuild`.
set -e
npx wdk-worklet-bundler generate --link-addons --platforms android
DEST=node_modules/react-native-bare-kit/android/src/main/addons/arm64-v8a
mkdir -p "$DEST"
cp -n android-addons/arm64-v8a/*.so "$DEST"/
# Addons loaded lazily (not visible to the graph walk above).
npx bare-link --preset android --out android-addons/lazy scripts/wdk/lazy-addons.js
cp -n android-addons/lazy/arm64-v8a/*.so "$DEST"/
echo "Linked WDK addons into $DEST"
