import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import type { ToolDef } from '../types.js';
import { loadToolPrompt } from '../prompts/load.js';

const paramsSchema = z.object({
  file_path: z.string().min(1),
  content: z.string(),
});

type WriteParams = z.infer<typeof paramsSchema>;

export const writeTool: ToolDef<WriteParams> = {
  id: 'write',
  description: loadToolPrompt('write'),
  parameters: paramsSchema,
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: true,
  execute: async (params) => {
    mkdirSync(path.dirname(params.file_path), { recursive: true });
    writeFileSync(params.file_path, params.content, 'utf-8');
    return { output: `Wrote ${Buffer.byteLength(params.content, 'utf-8')} bytes to ${params.file_path}` };
  },
};
