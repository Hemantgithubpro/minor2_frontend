"use client";

import { useEffect, useRef, useState } from "react";
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

interface FileSession {
  file: Phase1File;
  doc: Y.Doc;
  yText: Y.Text;
  awareness: Awareness;
  provider: ReconnectingYjsProvider;
}

const ROOM_ID = "phase1-room";

function createFileSession(file: Phase1File, wsUrl: string): FileSession {
  const doc = new Y.Doc();
  const yText = doc.getText("content");

  if (yText.length === 0) {
    yText.insert(0, file.initialContent);
  }

  const awareness = new Awareness(doc);
  awareness.setLocalStateField("user", {
    name: `user-${Math.floor(Math.random() * 1000)}`,
  });

  const provider = new ReconnectingYjsProvider({
    wsUrl,
    roomId: ROOM_ID,
    filePath: file.path,
    doc,
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
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://127.0.0.1:1234";
  const [selectedPath, setSelectedPath] = useState(PHASE1_FILES[0].path);
  const [status, setStatus] = useState<ConnectionStatus>("offline");
  const [sessions, setSessions] = useState<Map<string, FileSession>>(() => {
    const firstFile = PHASE1_FILES[0];
    const firstSession = createFileSession(firstFile, wsUrl);
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
      next.set(path, createFileSession(file, wsUrl));
      return next;
    });
  };

  const editorSession: EditorSession | null = currentSession
    ? {
        filePath: currentSession.file.path,
        language: currentSession.file.language,
        yText: currentSession.yText,
        awareness: currentSession.awareness,
      }
    : null;

  useEffect(() => {
    if (!currentSession) {
      return;
    }

    return currentSession.provider.onStatusChange(setStatus);
  }, [currentSession]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    const stableSessions = sessionsRef.current;

    return () => {
      for (const session of stableSessions.values()) {
        session.provider.disconnect();
        session.awareness.destroy();
        session.doc.destroy();
      }
      stableSessions.clear();
    };
  }, []);

  return (
    <main className="workspace-shell">
      <header className="top-bar">
        <div>
          <h1>Phase 1 Collaborative Editor</h1>
          <p className="subtitle">Room: {ROOM_ID}</p>
        </div>
        <ConnectionBadge status={status} />
      </header>

      <section className="workspace-grid">
        <FileTree
          files={PHASE1_FILES}
          selectedPath={selectedPath}
          onSelect={handleSelect}
        />

        <div className="editor-panel">
          <div className="editor-header">{selectedPath}</div>
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
