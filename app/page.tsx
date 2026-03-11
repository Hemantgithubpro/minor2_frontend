"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import ConnectionBadge from "@/components/ConnectionBadge";
import type { EditorSession } from "@/components/Editor";
import FileTree from "@/components/FileTree";
import { ReconnectingYjsProvider } from "@/lib/websocket/reconnectingYjsProvider";
import { PHASE1_FILES, type Phase1File } from "@/lib/yjs/files";

const Editor = dynamic(() => import("@/components/Editor"), {
  ssr: false,
});

type ConnectionStatus = "connected" | "reconnecting" | "offline";

interface UserProfile {
  name: string;
  color: string;
}

interface FileSession {
  file: Phase1File;
  doc: Y.Doc;
  yText: Y.Text;
  awareness: Awareness;
  provider: ReconnectingYjsProvider;
}

const USER_COLORS = [
  "#38bdf8",
  "#22c55e",
  "#f97316",
  "#e879f9",
  "#f43f5e",
  "#facc15",
  "#2dd4bf",
];

function createRandomUserProfile(): UserProfile {
  const color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
  const suffix = Math.floor(100 + Math.random() * 900);
  return {
    name: `user-${suffix}`,
    color,
  };
}

function teardownSessions(sessions: Map<string, FileSession>): void {
  for (const session of sessions.values()) {
    session.provider.disconnect();
    session.awareness.destroy();
    session.doc.destroy();
  }
  sessions.clear();
}

function createFileSession(
  file: Phase1File,
  wsUrl: string,
  roomId: string,
  user: UserProfile,
): FileSession {
  const doc = new Y.Doc();
  const yText = doc.getText("content");

  if (yText.length === 0) {
    yText.insert(0, file.initialContent);
  }

  const awareness = new Awareness(doc);
  awareness.setLocalStateField("user", {
    name: user.name,
    color: user.color,
  });

  const provider = new ReconnectingYjsProvider({
    wsUrl,
    roomId,
    filePath: file.path,
    doc,
    awareness,
  });

  provider.connect();

  return {
    file,
    doc,
    yText,
    awareness,
    provider,
  };
}

export default function Home() {
  const defaultRoomId = process.env.NEXT_PUBLIC_DEFAULT_ROOM ?? "phase1-room";
  const wsUrl =
    process.env.NEXT_PUBLIC_WS_URL ??
    (typeof window !== "undefined"
      ? `ws://${window.location.hostname}:1234`
      : "ws://127.0.0.1:1234");
  const [userProfile] = useState<UserProfile>(() => createRandomUserProfile());
  const [roomId, setRoomId] = useState(defaultRoomId);
  const [roomInput, setRoomInput] = useState(defaultRoomId);
  const [selectedPath, setSelectedPath] = useState(PHASE1_FILES[0].path);
  const [collaborators, setCollaborators] = useState<
    Array<{ id: number; name: string; color: string }>
  >([]);
  const [status, setStatus] = useState<ConnectionStatus>("offline");
  const [sessions, setSessions] = useState<Map<string, FileSession>>(() => {
    const firstFile = PHASE1_FILES[0];
    const firstSession = createFileSession(
      firstFile,
      wsUrl,
      defaultRoomId,
      userProfile,
    );
    return new Map([[firstFile.path, firstSession]]);
  });
  const sessionsRef = useRef<Map<string, FileSession>>(sessions);

  const currentSession = sessions.get(selectedPath) ?? null;

  const handleSelect = (path: string) => {
    setSelectedPath(path);

    setSessions((previous) => {
      if (previous.has(path)) {
        return previous;
      }

      const file = PHASE1_FILES.find((entry) => entry.path === path);
      if (!file) {
        return previous;
      }

      const next = new Map(previous);
      next.set(path, createFileSession(file, wsUrl, roomId, userProfile));
      return next;
    });
  };

  const handleJoinRoom = () => {
    const nextRoom = roomInput.trim();
    if (!nextRoom || nextRoom === roomId) {
      console.info("[phase1-client] Join Room skipped", {
        roomInput: nextRoom,
        currentRoom: roomId,
      });
      return;
    }

    console.info("[phase1-client] Join Room requested", {
      room: nextRoom,
      wsUrl,
      selectedPath,
    });

    setCollaborators([]);
    setRoomId(nextRoom);

    setSessions((previous) => {
      teardownSessions(previous);

      const selectedFile =
        PHASE1_FILES.find((entry) => entry.path === selectedPath) ??
        PHASE1_FILES[0];
      const freshSession = createFileSession(
        selectedFile,
        wsUrl,
        nextRoom,
        userProfile,
      );

      return new Map([[selectedFile.path, freshSession]]);
    });
  };

  const editorSession: EditorSession | null = useMemo(() => {
    if (!currentSession) {
      return null;
    }

    return {
      filePath: currentSession.file.path,
      language: currentSession.file.language,
      yText: currentSession.yText,
      awareness: currentSession.awareness,
    };
  }, [currentSession]);

  useEffect(() => {
    if (!currentSession) {
      return;
    }

    return currentSession.provider.onStatusChange(setStatus);
  }, [currentSession]);

  useEffect(() => {
    if (!currentSession) {
      return;
    }

    return currentSession.provider.onConnectionEvent((event) => {
      if (event.type === "connected") {
        console.info("[phase1-client] WebSocket connected", event);
      }

      if (event.type === "connecting") {
        console.info("[phase1-client] WebSocket connecting", event);
      }

      if (event.type === "error") {
        console.error("[phase1-client] WebSocket error", event);
      }

      if (event.type === "closed") {
        console.warn("[phase1-client] WebSocket closed", event);
      }
    });
  }, [currentSession]);

  useEffect(() => {
    if (!currentSession) {
      return;
    }

    const awareness = currentSession.awareness;

    const updateCollaborators = () => {
      const next = Array.from(awareness.getStates().entries())
        .map(([id, state]) => {
          const user = state.user as
            | { name?: string; color?: string }
            | undefined;
          return {
            id,
            name: user?.name ?? `user-${id}`,
            color: user?.color ?? "#7ad7ff",
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      setCollaborators((previous) => {
        if (previous.length === next.length) {
          const unchanged = previous.every((item, index) => {
            const candidate = next[index];
            return (
              item.id === candidate.id &&
              item.name === candidate.name &&
              item.color === candidate.color
            );
          });

          if (unchanged) {
            return previous;
          }
        }

        return next;
      });
    };

    awareness.on("change", updateCollaborators);
    Promise.resolve().then(updateCollaborators);

    return () => {
      awareness.off("change", updateCollaborators);
    };
  }, [currentSession]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    const stableSessions = sessionsRef.current;

    return () => {
      teardownSessions(stableSessions);
    };
  }, []);

  return (
    <main className="workspace-shell">
      <header className="top-bar">
        <div>
          <h1>Phase 1 Collaborative Editor</h1>
          <p className="subtitle">Room: {roomId}</p>
        </div>

        <div className="top-bar-controls">
          <label className="room-input-wrap" htmlFor="room-id-input">
            <span>Room</span>
            <input
              id="room-id-input"
              className="room-input"
              value={roomInput}
              onChange={(event) => setRoomInput(event.target.value)}
              placeholder="phase1-room"
            />
          </label>
          <button
            type="button"
            className="join-room-btn"
            onClick={handleJoinRoom}
          >
            Join Room
          </button>
          <span
            className="user-chip"
            style={{ borderColor: userProfile.color }}
          >
            You: {userProfile.name}
          </span>
          <ConnectionBadge status={status} />
        </div>
      </header>

      <section className="workspace-grid">
        <FileTree
          files={PHASE1_FILES}
          selectedPath={selectedPath}
          onSelect={handleSelect}
        />

        <div className="editor-panel">
          <div className="editor-header">
            <span>{selectedPath}</span>
            <div className="collab-list" aria-label="collaborators">
              {collaborators.map((collaborator) => (
                <span
                  key={collaborator.id}
                  className="collab-chip"
                  style={{ borderColor: collaborator.color }}
                  title={collaborator.name}
                >
                  {collaborator.name}
                </span>
              ))}
            </div>
          </div>
          {editorSession ? (
            <Editor session={editorSession} />
          ) : (
            <div className="editor-placeholder">Preparing session...</div>
          )}
        </div>
      </section>
    </main>
  );
}
