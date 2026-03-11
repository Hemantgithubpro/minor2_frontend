/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { ReconnectingYjsProvider } from "../lib/websocket/reconnectingYjsProvider";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly CONNECTING = MockWebSocket.CONNECTING;
  readonly OPEN = MockWebSocket.OPEN;
  readonly CLOSING = MockWebSocket.CLOSING;
  readonly CLOSED = MockWebSocket.CLOSED;
  readonly url: string;

  readyState = MockWebSocket.CONNECTING;
  binaryType = "arraybuffer";
  onopen: ((ev: Event) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  sent: Uint8Array[] = [];

  constructor(url: string | URL) {
    this.url = String(url);
    MockWebSocket.instances.push(this);
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  emitClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  emitMessage(data: Uint8Array): void {
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    );
    this.onmessage?.({ data: buffer } as MessageEvent);
  }
}

function messageType(message: Uint8Array): number {
  return message[0];
}

describe("ReconnectingYjsProvider", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    (globalThis as { WebSocket: unknown }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    (globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  it("queues offline doc updates and flushes them once connected", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", { name: "tester", color: "#38bdf8" });

    const provider = new ReconnectingYjsProvider({
      wsUrl: "ws://localhost:1234",
      roomId: "room-a",
      filePath: "src/main.js",
      doc,
      awareness,
    });

    provider.connect();

    const socket = MockWebSocket.instances[0];
    doc.getText("content").insert(0, "offline-edit");
    expect(socket.sent).toHaveLength(0);

    socket.emitOpen();

    const sentTypes = socket.sent.map(messageType);
    expect(sentTypes).toContain(1);
    expect(sentTypes).toContain(2);

    provider.disconnect();
    awareness.destroy();
    doc.destroy();
  });

  it("enters reconnecting state and retries with backoff", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", { name: "tester", color: "#22c55e" });

    const provider = new ReconnectingYjsProvider({
      wsUrl: "ws://localhost:1234",
      roomId: "room-b",
      filePath: "README.md",
      doc,
      awareness,
    });

    const statuses: string[] = [];
    provider.onStatusChange((status) => statuses.push(status));

    provider.connect();
    MockWebSocket.instances[0].emitOpen();
    expect(provider.getStatus()).toBe("connected");

    MockWebSocket.instances[0].emitClose();
    expect(provider.getStatus()).toBe("reconnecting");

    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(2);

    MockWebSocket.instances[1].emitOpen();
    expect(provider.getStatus()).toBe("connected");
    expect(statuses).toContain("reconnecting");

    provider.disconnect();
    awareness.destroy();
    doc.destroy();
  });

  it("applies incoming awareness updates from remote peers", () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", { name: "local", color: "#f97316" });

    const provider = new ReconnectingYjsProvider({
      wsUrl: "ws://localhost:1234",
      roomId: "room-c",
      filePath: "src/utils/math.ts",
      doc,
      awareness,
    });

    provider.connect();
    const socket = MockWebSocket.instances[0];
    socket.emitOpen();

    const remoteDoc = new Y.Doc();
    const remoteAwareness = new Awareness(remoteDoc);
    remoteAwareness.setLocalStateField("user", {
      name: "remote-user",
      color: "#e879f9",
    });

    const remoteClientId = remoteDoc.clientID;
    const awarenessPayload = encodeAwarenessUpdate(remoteAwareness, [
      remoteClientId,
    ]);
    const packet = new Uint8Array(awarenessPayload.length + 1);
    packet[0] = 2;
    packet.set(awarenessPayload, 1);

    socket.emitMessage(packet);

    const receivedState = awareness.getStates().get(remoteClientId) as
      | { user?: { name?: string } }
      | undefined;

    expect(receivedState?.user?.name).toBe("remote-user");

    provider.disconnect();
    remoteAwareness.destroy();
    remoteDoc.destroy();
    awareness.destroy();
    doc.destroy();
  });
});
