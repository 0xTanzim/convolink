document.addEventListener("DOMContentLoaded", async () => {
  const profileInput = document.getElementById("profileInput") as HTMLInputElement;
  const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
  const browserBadge = document.getElementById("browserBadge") as HTMLElement;

  const data = await chrome.storage.local.get(["profileLabel"]);
  if (data.profileLabel) {
    profileInput.value = data.profileLabel as string;
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
    const val = profileInput.value.trim() || "Personal";
    await chrome.storage.local.set({ profileLabel: val });
    saveBtn.textContent = "Saved!";
    setTimeout(() => {
      saveBtn.textContent = "Save Profile Label";
    }, 1200);
  });
});
