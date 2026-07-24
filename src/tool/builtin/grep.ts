import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import type { ToolDef } from '../types.js';
import { loadToolPrompt } from '../prompts/load.js';
import { globToRegExp, walkFiles } from './walk.js';

const paramsSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  glob: z.string().optional(),
  caseInsensitive: z.boolean().optional(),
});

type GrepParams = z.infer<typeof paramsSchema>;

const MAX_MATCHES = 500;

export const grepTool: ToolDef<GrepParams> = {
  id: 'grep',
  description: loadToolPrompt('grep'),
  parameters: paramsSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  isDestructive: false,
  execute: async (params) => {
    const root = params.path ?? process.cwd();
    const regex = new RegExp(params.pattern, params.caseInsensitive ? 'i' : undefined);
    const globRegex = params.glob ? globToRegExp(params.glob) : undefined;

    const matches: string[] = [];
    for (const relPath of walkFiles(root)) {
      if (globRegex && !globRegex.test(relPath)) {
        continue;
      }
      const full = path.join(root, relPath);
      let content: string;
      try {
        content = readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (regex.test(lines[i])) {
          matches.push(`${relPath}:${i + 1}:${lines[i]}`);
          if (matches.length >= MAX_MATCHES) {
            return { output: matches.join('\n'), metadata: { truncatedAtMatchLimit: true } };
          }
        }
      }
    }

    return { output: matches.length > 0 ? matches.join('\n') : '(no matches)' };
  },
};
