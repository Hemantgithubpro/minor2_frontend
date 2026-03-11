export interface Phase1File {
  path: string;
  language: string;
  initialContent: string;
}

export const PHASE1_FILES: Phase1File[] = [
  {
    path: "README.md",
    language: "markdown",
    initialContent:
      "# Phase 1 Demo\n\nOpen this app on two laptops in the same room to verify real-time sync.\n",
  },
  {
    path: "src/main.js",
    language: "javascript",
    initialContent:
      "export function greet(name) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet('Phase 1'));\n",
  },
  {
    path: "src/utils/math.ts",
    language: "typescript",
    initialContent:
      "export const add = (a: number, b: number): number => a + b;\n",
  },
];
