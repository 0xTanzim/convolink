import { defineConfig } from "wxt";

export default defineConfig({
  manifest: ({ browser }) => ({
    name: "ConvoLink Companion",
    description: "Zero-flag intelligence & context bridge for ConvoLink and local AI agents.",
    version: "1.0.0",
    permissions: ["tabs", "storage", "alarms"],
    host_permissions: [
      "https://chatgpt.com/*",
      "https://chat.deepseek.com/*",
      "https://gemini.google.com/*",
      "https://claude.ai/*",
    ],
    browser_specific_settings:
      browser === "firefox"
        ? {
            gecko: {
              id: "companion@convolink.local",
              strict_min_version: "109.0",
            },
          }
        : undefined,
  }),
});
