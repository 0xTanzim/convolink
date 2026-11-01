document.addEventListener("DOMContentLoaded", async () => {
  const profileInput = document.getElementById("profileInput") as HTMLInputElement;
  const tokenInput = document.getElementById("tokenInput") as HTMLInputElement;
  const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
  const browserBadge = document.getElementById("browserBadge") as HTMLElement;
  const statusDot = document.getElementById("statusDot") as HTMLElement;
  const statusText = document.getElementById("statusText") as HTMLElement;

  const data = await chrome.storage.local.get(["profileLabel", "bridgeToken", "connectionStatus", "lastError"]);
  if (data.profileLabel) {
    profileInput.value = data.profileLabel as string;
  }
  if (data.bridgeToken) {
    tokenInput.value = data.bridgeToken as string;
  }

  const status = (data.connectionStatus as string) || "disconnected";
  statusDot.className = `dot ${status}`;
  if (status === "connected") {
    statusText.textContent = "Bridge Connected";
  } else if (status === "unauthorized") {
    statusText.textContent = "Invalid Token (Check convo ext pair)";
  } else {
    statusText.textContent = "Bridge Offline (Start convo)";
  }

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
    await chrome.storage.local.set({ profileLabel: profileVal, bridgeToken: tokenVal });
    saveBtn.textContent = "Saved! Reconnecting...";
    // Trigger alarm to reconnect immediately
    chrome.alarms.create("convolink-reconnect", { delayInMinutes: 0.01 });
    setTimeout(() => {
      saveBtn.textContent = "Save Settings & Connect";
    }, 1500);
  });
});
