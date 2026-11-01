import mermaid from "mermaid";

function getTheme(): "dark" | "default" {
  const isDark =
    document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  return isDark ? "dark" : "default";
}

let renderIdCounter = 0;

async function renderAllMermaidDiagrams() {
  const currentTheme = getTheme();

  mermaid.initialize({
    startOnLoad: false,
    theme: currentTheme,
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    themeVariables:
      currentTheme === "dark"
        ? {
            darkMode: true,
            background: "#08090e",
            primaryColor: "rgba(244, 63, 94, 0.18)",
            primaryTextColor: "#f8fafc",
            primaryBorderColor: "#f43f5e",
            lineColor: "#38bdf8",
            secondaryColor: "rgba(139, 92, 246, 0.18)",
            secondaryBorderColor: "#8b5cf6",
            secondaryTextColor: "#f8fafc",
            tertiaryColor: "#0f111a",
            tertiaryBorderColor: "rgba(255, 255, 255, 0.15)",
            tertiaryTextColor: "#94a3b8",
            clusterBkg: "rgba(15, 17, 26, 0.75)",
            clusterBorder: "rgba(244, 63, 94, 0.4)",
          }
        : {
            darkMode: false,
            background: "#ffffff",
            primaryColor: "rgba(225, 29, 72, 0.08)",
            primaryTextColor: "#0f172a",
            primaryBorderColor: "#e11d48",
            lineColor: "#0284c7",
            secondaryColor: "rgba(124, 58, 237, 0.08)",
            secondaryBorderColor: "#7c3aed",
            secondaryTextColor: "#0f172a",
            tertiaryColor: "#f1f5f9",
            tertiaryBorderColor: "#cbd5e1",
            tertiaryTextColor: "#334155",
            clusterBkg: "#f8fafc",
            clusterBorder: "#e2e8f0",
          },
  });

  const codeBlocks = document.querySelectorAll<HTMLElement>('pre[data-language="mermaid"]');

  for (let i = 0; i < codeBlocks.length; i++) {
    const pre = codeBlocks[i];
    if (!pre) continue;

    const frame =
      (pre.closest(".expressive-code, figure.frame") as HTMLElement) || pre;

    // Extract raw mermaid code
    let rawCode = frame.getAttribute("data-mermaid-raw");
    if (!rawCode) {
      const lines = Array.from(pre.querySelectorAll(".ec-line")).map(
        (l) => l.textContent || ""
      );
      rawCode = lines.length > 0 ? lines.join("\n") : pre.textContent || "";
      rawCode = rawCode.trim();
      frame.setAttribute("data-mermaid-raw", rawCode);
    }

    if (!rawCode) continue;

    // Find or create diagram container
    const parent = frame.parentElement;
    if (!parent) continue;

    let container = parent.querySelector(
      `:scope > .convo-mermaid-diagram[data-for-id="${i}"]`
    ) as HTMLElement;
    if (!container) {
      container = document.createElement("div");
      container.className = "convo-mermaid-diagram";
      container.setAttribute("data-for-id", String(i));
      frame.insertAdjacentElement("beforebegin", container);
    }

    // Hide original code block
    frame.style.display = "none";

    // Render diagram
    try {
      const renderId = `convo-mermaid-${++renderIdCounter}-${Date.now()}`;
      const { svg } = await mermaid.render(renderId, rawCode);
      container.innerHTML = svg;
    } catch (err) {
      console.warn("[ConvoLink Mermaid] Render failed for diagram", i, err);
      // Fallback: restore code frame if render fails
      frame.style.display = "";
      container.remove();
    }
  }
}

// Global runner with debounce
let timeout: ReturnType<typeof setTimeout> | null = null;
function scheduleRender() {
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(renderAllMermaidDiagrams, 50);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRender);
  } else {
    scheduleRender();
  }

  document.addEventListener("astro:page-load", scheduleRender);

  const themeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === "data-theme") {
        scheduleRender();
      }
    }
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}
