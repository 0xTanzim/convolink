export function getDownloadFileExpr(url: string): string {
  return `(async () => {
    const res = await fetch(${JSON.stringify(url)}, { credentials: "include" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  })()`;
}

export const getFocusExpr = (sel: string): string =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.focus(); })()`;

export const getClickExpr = (sel: string): string =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); })()`;

export const getKeyPressExpr = (sel: string, key: string): string =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) { el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true })); } })()`;

export const getChangeExpr = (sel: string): string =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el && 'files' in el) el.dispatchEvent(new Event('change', { bubbles: true })); })()`;
