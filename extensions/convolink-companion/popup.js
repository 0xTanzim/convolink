// extensions/convolink-companion/entrypoints/popup/main.ts
document.addEventListener("DOMContentLoaded", async () => {
  const profileInput = document.getElementById("profileInput");
  const tokenInput = document.getElementById("tokenInput");
  const saveBtn = document.getElementById("saveBtn");
  const browserBadge = document.getElementById("browserBadge");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const data = await chrome.storage.local.get(["profileLabel", "bridgeToken", "connectionStatus", "lastError"]);
  if (data.profileLabel) {
    profileInput.value = data.profileLabel;
  }
  if (data.bridgeToken) {
    tokenInput.value = data.bridgeToken;
  }
  const status = data.connectionStatus || "disconnected";
  statusDot.className = `dot ${status}`;
  if (status === "connected") {
    statusText.textContent = "Bridge Connected";
  } else if (status === "unauthorized") {
    statusText.textContent = "Invalid Token (Check convo ext pair)";
  } else {
    statusText.textContent = "Bridge Offline (Start convo)";
  }
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("brave") || navigator.brave) {
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
    chrome.alarms.create("convolink-reconnect", { delayInMinutes: 0.01 });
    setTimeout(() => {
      saveBtn.textContent = "Save Settings & Connect";
    }, 1500);
  });
});
