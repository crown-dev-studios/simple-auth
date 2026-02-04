// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "simple-auth",
    platforms: [
        .iOS(.v18),
        .macOS(.v10_15),
    ],
    products: [
        .library(
            name: "GoogleAuthNative",
            targets: ["GoogleAuthNative"]
        ),
        .library(
            name: "SimpleAuthNative",
            targets: ["SimpleAuthNative"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/google/GoogleSignIn-iOS", from: "7.0.0"),
    ],
    targets: [
        .target(
            name: "GoogleAuthNative",
            dependencies: [
                .product(name: "GoogleSignIn", package: "GoogleSignIn-iOS"),
            ],
            path: "packages/google-auth-native-ios/Sources/GoogleAuthNative"
        ),
        .target(
            name: "SimpleAuthNative",
            dependencies: [
                "GoogleAuthNative",
            ],
            path: "packages/simple-auth-native-ios/Sources/SimpleAuthNative"
        ),
    ]
)
