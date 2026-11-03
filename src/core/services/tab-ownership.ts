/**
 * Owned-tab policy shared by the extension runtime: a tab ConvoLink created may
 * be closed by ConvoLink; a tab the user opened may not, unless forced.
 */
export class TabOwnership {
  private readonly owned: Set<number>;

  public constructor(ids: Iterable<number> = []) {
    this.owned = new Set([...ids].filter((id) => Number.isInteger(id) && id > 0));
  }

  public static from(raw: unknown): TabOwnership {
    return new TabOwnership(Array.isArray(raw) ? raw.map((value) => Number(value)) : []);
  }

  public add(tabId: number): void {
    if (Number.isInteger(tabId)) this.owned.add(tabId);
  }

  public remove(tabId: number): void {
    this.owned.delete(tabId);
  }

  public has(tabId: number): boolean {
    return this.owned.has(tabId);
  }

  public canClose(tabId: number, force = false): boolean {
    return force || this.owned.has(tabId);
  }

  public ids(): number[] {
    return [...this.owned];
  }
}
