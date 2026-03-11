"use client";

import { useEffect, useRef } from "react";
import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import { MonacoBinding } from "y-monaco";
import type { editor } from "monaco-editor";
import type { Text as YText } from "yjs";
import type { Awareness } from "y-protocols/awareness";

export interface EditorSession {
  filePath: string;
  language: string;
  yText: YText;
  awareness: Awareness;
}

interface EditorProps {
  session: EditorSession;
}

export default function Editor({ session }: EditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  const onMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance;
    monacoRef.current = monaco;
  };

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) {
      return;
    }

    const monaco = monacoRef.current;
    const editorInstance = editorRef.current;
    const uri = monaco.Uri.parse(`inmemory://phase1/${session.filePath}`);

    let model = monaco.editor.getModel(uri);
    if (!model) {
      model = monaco.editor.createModel("", session.language, uri);
    }

    monaco.editor.setModelLanguage(model, session.language);
    editorInstance.setModel(model);

    bindingRef.current?.destroy();
    bindingRef.current = new MonacoBinding(
      session.yText,
      model,
      new Set([editorInstance]),
      session.awareness,
    );

    return () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    };
  }, [session]);

  return (
    <div className="editor-shell">
      <MonacoEditor
        theme="vs-dark"
        defaultLanguage={session.language}
        onMount={onMount}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          scrollBeyondLastLine: false,
          wordWrap: "on",
        }}
      />
    </div>
  );
}
