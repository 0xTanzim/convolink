export function printHelp(): void {
  console.log(`ConvoLink CLI (convo)
Usage:
  convo doctor [--launch]        Check CDP connection, open tabs, and selector health
  convo list                     List all currently open browser tabs
  convo ask "<prompt>"           Send prompt to active browser session and stream reply
  convo compare "<prompt>"       Query multiple models in parallel and emit comparison matrix
  convo tab new <platform|url>   Spawn fresh tab for a platform (e.g. convo tab new deepseek)
  convo tab close <targetId>     Close a specific browser tab cleanly
  convo back [targetId]          Navigate active tab back in browser history
  convo undo [targetId]          Revert mistake by restoring previous conversation URL
  convo history [targetId]       Show recent session checkpoints and thread URLs
  convo resume <threadId>        Rehydrate and re-open saved thread from persistent SQLite ledger
  convo export <threadId>        Export structured conversation ledger (Markdown or JSON)
  convo search <query>           Full-text search across historical conversation turns and code
  convo setup [--show|--reset]   Choose and verify the browser + profile; saves .convo/config.json
  convo profile [list|select]    View and persist active browser profile in .convo/config.json
  convo ext pair [--rotate]      Display or rotate extension pairing token for browser bridge
  convo ext status [--json]      Show bridge state and connected extension clients
  convo daemon [status|start|stop] Manage background singleton bridge daemon
  convo clean                    Purge stray ghost browser processes and temporary debug profiles
  convo mcp                      Launch Model Context Protocol (MCP) JSON-RPC server on stdio

Options for ask:
  --new, -n                      Reset active tab to fresh chat before submitting prompt
  --open-tab                     Spawn brand new tab in background before submitting
  -p, --platform <id>            Target specific platform (deepseek | chatgpt | gemini | claude)
  -t, --target, --targetId <id>  Target specific browser tab targetId
  --transport <name>             Transport engine: raw-cdp (default) | agent-browser | firefox-bidi | extension-bridge
  --think / --no-think           Enable or disable deep thinking mode
  --search / --no-search         Enable or disable web search mode
  --timeout <ms>                 Response wait timeout in milliseconds (default: 120000)
  -w, --write-files              Extract and save code blocks to local workspace
  -o, --out-dir <path>           Output directory for saved artifacts (default: ./artifacts)
  --no-continue                  Disable automated stream continuation

Options for compare:
  --platforms <p1,p2>            Comma-separated platforms (default: chatgpt,deepseek,gemini)
  --mode <parallel|sequential>   Execution schedule (default: parallel)
  --arbitrate                    Trigger Stage 2 Technical Arbiter consensus synthesis
  --arbiter <platform>           Designate specific arbiter platform (e.g. deepseek)
  -o, --out-dir <path>           Directory to save REPORT.md and namespaced artifacts
  --timeout <ms>                 Timeout per model execution (default: 120000)
`);
}
