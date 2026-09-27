#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const [relationCsv, audioDir, datasetDir, speakerName] = process.argv.slice(2);

if (!relationCsv || !audioDir || !datasetDir || !speakerName) {
  console.error("使い方: node prepare-sbv2-dataset.js 対応表.csv 音声フォルダ データセットフォルダ 話者名");
  process.exit(1);
}

if (!fs.existsSync(relationCsv) || !fs.existsSync(audioDir)) {
  console.error("対応表または音声フォルダが見つかりません。");
  process.exit(1);
}

if (fs.existsSync(datasetDir)) {
  console.error(`出力先が既に存在します: ${datasetDir}`);
  process.exit(1);
}

const rows = fs.readFileSync(relationCsv, "utf8").trim().split(/\r?\n/);
if (rows.shift() !== "filename,text") {
  console.error("対応表の先頭行は filename,text である必要があります。");
  process.exit(1);
}

const records = rows.filter(Boolean).map((line, index) => {
  const match = line.match(/^([0-9]{4}\.wav),"([^"]+)"$/);
  if (!match || match[2].includes("|")) {
    throw new Error(`${index + 2}行目の形式または本文が不正です。`);
  }
  return { filename: match[1], text: match[2] };
});

if (records.length === 0 || new Set(records.map(({ filename }) => filename)).size !== records.length) {
  throw new Error("対応表に有効なレコードがないか、ファイル名が重複しています。");
}

for (const { filename } of records) {
  if (!fs.existsSync(path.join(audioDir, filename))) {
    throw new Error(`対応する音声が見つかりません: ${filename}`);
  }
}

const rawDir = path.join(datasetDir, "raw");
fs.mkdirSync(rawDir, { recursive: true });
for (const { filename } of records) {
  fs.copyFileSync(path.join(audioDir, filename), path.join(rawDir, filename), fs.constants.COPYFILE_EXCL);
}

const esd = records
  .map(({ filename, text }) => `${filename}|${speakerName}|JP|${text}`)
  .join("\n") + "\n";
fs.writeFileSync(path.join(datasetDir, "esd.list"), esd, { encoding: "utf8", flag: "wx" });

console.log(`準備完了: ${records.length}件`);
console.log(`データセット: ${datasetDir}`);
