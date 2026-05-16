# @dorv/extension

WXT + React Chrome extension for dorv.

```bash
pnpm --filter @dorv/extension dev
pnpm --filter @dorv/extension build
pnpm --filter @dorv/extension zip
```

`GOOGLE_CLIENT_ID` is read at build time for the extension OAuth manifest entry. Use a placeholder locally until the Chrome OAuth client is provisioned.
