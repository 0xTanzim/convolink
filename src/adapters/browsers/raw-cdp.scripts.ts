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
