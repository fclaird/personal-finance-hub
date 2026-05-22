import fs from "node:fs";

export function ensureDirSync(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeFileAtomicSync(filePath: string, data: Buffer | string) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

