#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLE_APP_DIR="$ROOT_DIR/examples/GoogleAuthExample"

echo "=== Building Swift Package schemes with strict concurrency ==="

cd "$ROOT_DIR"

for scheme in GoogleAuthNative SimpleAuthNative; do
  echo "Building $scheme..."
  xcodebuild \
    -scheme "$scheme" \
    -destination "generic/platform=iOS Simulator" \
    SWIFT_STRICT_CONCURRENCY=complete \
    build
done

echo "=== Building React Native example app with strict concurrency ==="

cd "$EXAMPLE_APP_DIR"

echo "Installing npm dependencies..."
npm install

echo "Installing local native module..."
npm install "file:$ROOT_DIR/packages/google-auth"

echo "Installing pods..."
(cd ios && pod install)

echo "Building iOS (simulator, strict concurrency)..."
xcodebuild \
  -workspace ios/GoogleAuthExample.xcworkspace \
  -scheme GoogleAuthExample \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "generic/platform=iOS Simulator" \
  CODE_SIGNING_ALLOWED=NO \
  SWIFT_STRICT_CONCURRENCY=complete \
  build

echo "=== All builds succeeded with strict concurrency ==="
