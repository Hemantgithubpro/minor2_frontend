"use client";

import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  type Awareness,
} from "y-protocols/awareness";
import * as Y from "yjs";

type ConnectionStatus = "connected" | "reconnecting" | "offline";

interface ProviderOptions {
  wsUrl: string;
  roomId: string;
  filePath: string;
  doc: Y.Doc;
  awareness: Awareness;
}

const UPDATE_MESSAGE = 1;
const AWARENESS_MESSAGE = 2;

function encodeMessage(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 1);
  out[0] = type;
  out.set(payload, 1);
  return out;
}

function decodeMessage(
  data: ArrayBuffer,
): { type: number; payload: Uint8Array } | null {
  const bytes = new Uint8Array(data);
  if (bytes.length < 1) {
    return null;
  }

  return {
    type: bytes[0],
    payload: bytes.subarray(1),
  };
}

export class ReconnectingYjsProvider {
  private readonly wsUrl: string;
  private readonly roomId: string;
  private readonly filePath: string;
  private readonly doc: Y.Doc;
  private readonly awareness: Awareness;
  private socket: WebSocket | null = null;
  private isDisposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private pendingUpdates: Uint8Array[] = [];
  private status: ConnectionStatus = "offline";
  private statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(options: ProviderOptions) {
    this.wsUrl = options.wsUrl;
    this.roomId = options.roomId;
    this.filePath = options.filePath;
    this.doc = options.doc;
    this.awareness = options.awareness;
    this.doc.on("update", this.handleLocalUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
  }

  connect(): void {
    if (typeof window === "undefined") {
      return;
    }

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
      this.sendFullAwarenessState();
    };

    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) {
        return;
      }

      const decoded = decodeMessage(event.data);
      if (!decoded) {
        return;
      }

      if (decoded.type === UPDATE_MESSAGE) {
        Y.applyUpdate(this.doc, decoded.payload, this);
      }

      if (decoded.type === AWARENESS_MESSAGE) {
        applyAwarenessUpdate(this.awareness, decoded.payload, this);
      }
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
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close();
    }

    this.doc.off("update", this.handleLocalUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
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
      this.socket.send(encodeMessage(UPDATE_MESSAGE, update));
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

    this.reconnectTimer = globalThis.setTimeout(() => {
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
      this.socket.send(encodeMessage(UPDATE_MESSAGE, update));
    }

    this.pendingUpdates = [];
  }

  private handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this) {
      return;
    }

    const changedClients = [
      ...changes.added,
      ...changes.updated,
      ...changes.removed,
    ];

    if (changedClients.length === 0) {
      return;
    }

    const payload = encodeAwarenessUpdate(this.awareness, changedClients);

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(encodeMessage(AWARENESS_MESSAGE, payload));
    }
  };

  private sendFullAwarenessState(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const clientIds = Array.from(this.awareness.getStates().keys());
    if (clientIds.length === 0) {
      return;
    }

    const payload = encodeAwarenessUpdate(this.awareness, clientIds);
    this.socket.send(encodeMessage(AWARENESS_MESSAGE, payload));
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
