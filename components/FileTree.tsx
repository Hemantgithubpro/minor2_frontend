"use client";

import type { Phase1File } from "@/lib/yjs/files";

interface FileTreeProps {
  files: Phase1File[];
  selectedPath: string;
  onSelect: (path: string) => void;
}

export default function FileTree({
  files,
  selectedPath,
  onSelect,
}: FileTreeProps) {
  return (
    <aside className="file-tree">
      <h2 className="panel-title">Workspace</h2>
      <ul>
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className={
                selectedPath === file.path ? "file-item active" : "file-item"
              }
              onClick={() => onSelect(file.path)}
            >
              {file.path}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
