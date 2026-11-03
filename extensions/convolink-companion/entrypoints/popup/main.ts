const api = ((globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome) as typeof chrome;

document.addEventListener("DOMContentLoaded", async () => {
  const profileInput = document.getElementById("profileInput") as HTMLInputElement;
  const tokenInput = document.getElementById("tokenInput") as HTMLInputElement;
  const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
  const browserBadge = document.getElementById("browserBadge") as HTMLElement;
  const statusDot = document.getElementById("statusDot") as HTMLElement;
  const statusText = document.getElementById("statusText") as HTMLElement;

  const data = await api.storage.local.get(["profileLabel", "bridgeToken", "connectionStatus", "lastError"]);
  if (data.profileLabel) {
    profileInput.value = data.profileLabel as string;
  }
  if (data.bridgeToken) {
    tokenInput.value = data.bridgeToken as string;
  }

  async function refreshStatus() {
    const latest = await api.storage.local.get(["connectionStatus", "lastError"]);
    const state = (latest.connectionStatus as string) || "disconnected";
    statusDot.className = `dot ${state}`;
    if (state === "connected") {
      statusText.textContent = "Bridge Connected";
    } else if (state === "unauthorized") {
      statusText.textContent = `Invalid token (${String(latest.lastError || "run convo ext pair")})`;
    } else {
      statusText.textContent = "Bridge Offline (start ConvoLink first)";
    }
    return state;
  }

  await refreshStatus();

  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("brave") || (navigator as any).brave) {
    browserBadge.textContent = "Brave";
  } else if (ua.includes("edg/")) {
    browserBadge.textContent = "Edge";
  } else if (ua.includes("firefox")) {
    browserBadge.textContent = "Firefox";
  } else {
    browserBadge.textContent = "Chrome";
  }

  saveBtn.addEventListener("click", async () => {
    const profileVal = profileInput.value.trim() || "Personal";
    const tokenVal = tokenInput.value.trim();
    await api.storage.local.set({ profileLabel: profileVal, bridgeToken: tokenVal });
    saveBtn.textContent = "Saved! Reconnecting...";
    statusText.textContent = "Connecting...";
    await api.runtime.sendMessage({ type: "RECONNECT" }).catch(() => undefined);
    setTimeout(() => {
      saveBtn.textContent = "Save Settings & Connect";
      void refreshStatus();
    }, 1200);
  });
});
