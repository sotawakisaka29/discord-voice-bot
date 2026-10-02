import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(projectDir, "..", "relation.csv");

function parseCsvLine(line) {
  const match = line.match(/^([^,]+),"((?:[^"]|"")*)"$/);
  if (!match) throw new Error(`relation.csv の形式を解釈できません: ${line}`);
  return { filename: match[1].trim(), text: match[2].replaceAll('""', '"') };
}

const lines = (await readFile(sourcePath, "utf8"))
  .replace(/^\uFEFF/, "")
  .split(/\r?\n/)
  .filter(Boolean);

if (lines.shift() !== "filename,text") {
  throw new Error("relation.csv のヘッダーは filename,text である必要があります");
}

const prompts = lines.map(parseCsvLine);
if (prompts.length !== 100) {
  throw new Error(`100件を想定していますが、${prompts.length}件ありました`);
}

const names = new Set();
for (const prompt of prompts) {
  if (!/^\d{4}\.wav$/.test(prompt.filename)) {
    throw new Error(`WAVファイル名が不正です: ${prompt.filename}`);
  }
  if (names.has(prompt.filename)) throw new Error(`ファイル名が重複しています: ${prompt.filename}`);
  if (!prompt.text.trim()) throw new Error(`文章が空です: ${prompt.filename}`);
  names.add(prompt.filename);
}

await writeFile(
  path.join(projectDir, "public", "prompts.json"),
  `${JSON.stringify(prompts, null, 2)}\n`,
);

await writeFile(
  path.join(projectDir, "src", "allowed-files.js"),
  `// relation.csv から自動生成。直接編集しないでください。\nexport const ALLOWED_FILES = new Set(${JSON.stringify([...names])});\n`,
);

console.log(`relation.csv から ${prompts.length} 件を同期しました`);
