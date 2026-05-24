import "dotenv/config";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "dorv",
    description: "Sync GitHub PR review comments with Google Docs.",
    permissions: ["storage", "identity", "alarms", "sidePanel"],
    host_permissions: [
      "https://github.com/*",
      "https://docs.google.com/*",
      "https://api.github.com/*",
      "https://www.googleapis.com/*"
    ],
    oauth2: {
      client_id: process.env.GOOGLE_CLIENT_ID ?? "GOOGLE_CLIENT_ID",
      scopes: [
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive.file"
      ]
    },
    side_panel: {
      default_path: "sidepanel.html"
    },
    action: {
      default_icon: {
        "16": "icon-16.png",
        "48": "icon-48.png",
        "128": "icon-128.png"
      }
    },
    commands: {
      "open-sidepanel": {
        suggested_key: { default: "Alt+Shift+D" },
        description: "Open the dorv side panel"
      }
    }
  }
});
