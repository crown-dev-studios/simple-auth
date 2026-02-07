set shell := ["bash", "-cu"]

# Show available recipes.
default:
  just --list

# Install workspace dependencies.
install:
  pnpm install

# Type-check all workspace packages.
typecheck:
  pnpm typecheck

# Build all workspace packages.
build:
  pnpm build

# Run unit tests configured at repo root.
test:
  pnpm test:unit

# Build Swift package target: GoogleAuthNative (iOS Simulator).
ios-build-google-auth-native:
  xcodebuild -scheme GoogleAuthNative -destination "platform=iOS Simulator,name=iPhone 17 Pro" build | xcsift

# Build Swift package target: SimpleAuthNative (iOS Simulator).
ios-build-simple-auth-native:
  xcodebuild -scheme SimpleAuthNative -destination "platform=iOS Simulator,name=iPhone 17 Pro" build | xcsift

# Install iOS pods for the React Native example app.
ios-example-pods:
  cd examples/GoogleAuthExample/ios && bundle install && bundle exec pod install

# Build the React Native iOS example app (iOS Simulator).
ios-build-example:
  xcodebuild -workspace examples/GoogleAuthExample/ios/GoogleAuthExample.xcworkspace -scheme GoogleAuthExample -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,name=iPhone 17 Pro" CODE_SIGNING_ALLOWED=NO build | xcsift

# Build all iOS targets used by this repo.
ios-build-all: ios-build-google-auth-native ios-build-simple-auth-native ios-build-example
