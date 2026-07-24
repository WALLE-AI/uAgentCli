import { readFileSync } from 'node:fs';
import { z } from 'zod';

import type { ToolDef } from '../types.js';
import { loadToolPrompt } from '../prompts/load.js';

const paramsSchema = z.object({
  file_path: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

type ReadParams = z.infer<typeof paramsSchema>;

export const readTool: ToolDef<ReadParams> = {
  id: 'read',
  description: loadToolPrompt('read'),
  parameters: paramsSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  isDestructive: false,
  execute: async (params) => {
    const content = readFileSync(params.file_path, 'utf-8');
    const lines = content.split('\n');
    const start = params.offset ?? 0;
    const end = params.limit !== undefined ? start + params.limit : lines.length;
    const sliced = lines.slice(start, end);
    const numbered = sliced.map((line, i) => `${start + i + 1}\t${line}`).join('\n');
    return { output: numbered };
  },
};
