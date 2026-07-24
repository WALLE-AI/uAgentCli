import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadToolPrompt(name: string): string {
  const file = path.join(__dirname, `${name}.txt`);
  return readFileSync(file, 'utf-8').trimEnd();
}
