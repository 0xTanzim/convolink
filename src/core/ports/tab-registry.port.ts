export interface ManagedTabRecord {
  readonly targetId: string;
  readonly platform: string;
  readonly url: string;
  readonly threadId: string | null;
  readonly createdAt: string;
}

export interface TabRef {
  readonly targetId: string;
  readonly url: string;
  readonly threadId: string | null;
}

export interface TabRegistryPort {
  recordManagedTab(record: ManagedTabRecord): void;
  forgetManagedTab(targetId: string): void;
  isManagedTab(targetId: string): boolean;
  isManagedTabRef(tab: TabRef): boolean;
}
