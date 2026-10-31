export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export interface PendingMessage {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}
