# GoogleAuthExample

React Native example app for `@crown-dev-studios/google-auth`.

## Build + compile

From the repository root:

```sh
pnpm install
pnpm -C examples/GoogleAuthExample exec tsc --noEmit
```

From this directory (`examples/GoogleAuthExample`):

```sh
pnpm install
pnpm exec tsc --noEmit
```

## Run

Start Metro:

```sh
pnpm start
```

Run Android:

```sh
pnpm android
```

Run iOS:

```sh
bundle install
bundle exec pod install
pnpm ios
```
