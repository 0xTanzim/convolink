const badge = document.getElementById("statusBadge");

async function checkBridge() {
  try {
    const ws = new WebSocket("ws://127.0.0.1:9224");
    ws.onopen = () => {
      badge.textContent = "🟢 Bridge Online";
      badge.className = "badge online";
      ws.close();
    };
    ws.onerror = () => {
      badge.textContent = "🔴 Bridge Offline (Start CLI/MCP)";
      badge.className = "badge offline";
    };
  } catch {
    badge.textContent = "🔴 Bridge Offline";
    badge.className = "badge offline";
  }
}

checkBridge();
