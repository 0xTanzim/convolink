import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://0xtanzim.github.io",
  base: "/convolink",
  integrations: [
    starlight({
      title: "ConvoLink",
      description: "Autonomous AI conversation runtime linking web models (ChatGPT, Claude, DeepSeek, Gemini) to local development workflows.",
      logo: {
        src: "./src/assets/logo.svg",
        alt: "ConvoLink Logo",
      },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/0xTanzim/convolink" }
      ],
      customCss: [
        "./src/styles/elysia-theme.css",
      ],
      sidebar: [
        {
          label: "Start Here",
          items: [
            { label: "Overview", slug: "index" },
            { label: "60-Second Quickstart", slug: "getting-started/quickstart" },
            { label: "Zero Ghost Browser Setup", slug: "getting-started/browser-connection" },
          ],
        },
        {
          label: "Companion Extension",
          items: [
            { label: "Chrome & Firefox MV3", slug: "extension/overview" },
            { label: "Cryptographic Pairing", slug: "extension/pairing" },
          ],
        },
        {
          label: "Core CLI Commands",
          items: [
            { label: "Command Reference", slug: "commands/overview" },
            { label: "Multi-Model Arbitration", slug: "commands/compare-arbitrate" },
            { label: "Ledger FTS5 Search", slug: "commands/search" },
            { label: "File Extraction (-w)", slug: "commands/artifact-extraction" },
          ],
        },
        {
          label: "Agent & IDE Integrations",
          items: [
            { label: "Model Context Protocol (MCP)", slug: "integrations/mcp" },
            { label: "Cursor & Claude Desktop", slug: "integrations/cursor-claude" },
          ],
        },
        {
          label: "Architecture & Security",
          items: [
            { label: "Three Architectural Pillars", slug: "architecture/three-pillars" },
            { label: "Operational Safety & Mutex", slug: "architecture/safety-mutex" },
            { label: "Stream Settling Detection", slug: "architecture/stream-settling" },
          ],
        },
      ],
    }),
  ],
});
