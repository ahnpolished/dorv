import "dotenv/config";
import { defineConfig } from "wxt";

// Stable extension ID: ndkhkamgdenpllbpjmaljcdajlfclhli
// Register this ID in Google Cloud Console → OAuth 2.0 Client ID
const DEV_EXTENSION_KEY = [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7kdMoKsT+FeczcFoJQTw",
  "746RX+9ba8j78Dt/nJ+teODh2MvzdWTI0MUgHx+jnBF6CTpHU6fJyb9Gc3PZyDqW",
  "rU30/lszLEIy9pRTcBsFzgLQusM+XPRLHQVN9oRfsFvpmR+/TnZzTEUauWV+TCkO",
  "NJAylak1XSmP0dDMaWh3sWYBuEQv3Gqpp854MtKLxvSHjJs9Phmrm2RTp18/OryG",
  "2ldp6aky5fQJlUn1zL+EYy9OzETK9yt0k/6nRqtq666IrYM9W6efy/6NawcnrGuk",
  "rxoD0St9JgX6MoLALn70KmOBNr3FiNg7mX9bnvMzjqRVcmkU5H+oLQBIbYemwymz",
  "LwIDAQAB",
  "-----END PUBLIC KEY-----"
].join("\n");

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    define: {
      __DORV_BUILD_ID__: JSON.stringify(
        `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`
      )
    }
  }),
  manifest: {
    name: "dorv",
    description: "Sync GitHub PR review comments with Google Docs.",
    permissions: ["storage", "identity", "identity.email"],
    host_permissions: [
      "https://github.com/*",
      "https://docs.google.com/*",
      "https://api.github.com/*",
      "https://www.googleapis.com/*"
    ],
    oauth2: {
      client_id: process.env.GOOGLE_CLIENT_ID ?? "GOOGLE_CLIENT_ID",
      scopes: ["https://www.googleapis.com/auth/drive.file", "profile", "email"]
    },
    action: {
      default_icon: {
        "16": "icon-16.png",
        "48": "icon-48.png",
        "128": "icon-128.png"
      }
    },
    key: process.env.DORV_EXTENSION_KEY ?? DEV_EXTENSION_KEY
  },
  webExt: {
    openDevtools: true,
    // Expose a stable remote debugging port so the Chrome DevTools
    // MCP can attach (connect-chrome script opens a real Chrome).
    chromiumPort: 9222,
    chromiumArgs: ["--remote-debugging-port=9222"]
  }
});
