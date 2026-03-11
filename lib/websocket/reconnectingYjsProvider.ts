"use client";

import * as Y from "yjs";

type ConnectionStatus = "connected" | "reconnecting" | "offline";

interface ProviderOptions {
  wsUrl: string;
  roomId: string;
  filePath: string;
  doc: Y.Doc;
}

const UPDATE_MESSAGE = 1;

function encodeUpdate(update: Uint8Array): Uint8Array {
  const out = new Uint8Array(update.length + 1);
  out[0] = UPDATE_MESSAGE;
  out.set(update, 1);
  return out;
}

function decodeUpdate(data: ArrayBuffer): Uint8Array | null {
  const bytes = new Uint8Array(data);
  if (bytes.length < 1 || bytes[0] !== UPDATE_MESSAGE) {
    return null;
  }
  return bytes.subarray(1);
}

export class ReconnectingYjsProvider {
  private readonly wsUrl: string;
  private readonly roomId: string;
  private readonly filePath: string;
  private readonly doc: Y.Doc;
  private socket: WebSocket | null = null;
  private isDisposed = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private pendingUpdates: Uint8Array[] = [];
  private status: ConnectionStatus = "offline";
  private statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(options: ProviderOptions) {
    this.wsUrl = options.wsUrl;
    this.roomId = options.roomId;
    this.filePath = options.filePath;
    this.doc = options.doc;
    this.doc.on("update", this.handleLocalUpdate);
  }

  connect(): void {
    if (this.isDisposed) {
      return;
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "offline");

    const url = new URL(this.wsUrl);
    url.searchParams.set("room", this.roomId);
    url.searchParams.set("file", this.filePath);

    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.flushPendingUpdates();
    };

    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) {
        return;
      }

      const update = decodeUpdate(event.data);
      if (!update) {
        return;
      }

      Y.applyUpdate(this.doc, update, this);
    };

    socket.onerror = () => {
      socket.close();
    };

    socket.onclose = () => {
      this.socket = null;

      if (this.isDisposed) {
        this.setStatus("offline");
        return;
      }

      this.setStatus("reconnecting");
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    this.isDisposed = true;

    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close();
    }

    this.doc.off("update", this.handleLocalUpdate);
    this.statusListeners.clear();
    this.setStatus("offline");
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) {
      return;
    }

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encodeUpdate(update));
      return;
    }

    this.pendingUpdates.push(update);
  };

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isDisposed) {
      return;
    }

    this.reconnectAttempt += 1;
    const delay = Math.min(
      1000 * 2 ** Math.min(this.reconnectAttempt, 5),
      12000,
    );

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private flushPendingUpdates(): void {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      this.pendingUpdates.length === 0
    ) {
      return;
    }

    for (const update of this.pendingUpdates) {
      this.socket.send(encodeUpdate(update));
    }

    this.pendingUpdates = [];
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) {
      return;
    }

    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}
