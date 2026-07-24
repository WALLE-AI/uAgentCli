import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import type { ToolDef } from '../types.js';
import { loadToolPrompt } from '../prompts/load.js';

const paramsSchema = z.object({
  file_path: z.string().min(1),
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

type EditParams = z.infer<typeof paramsSchema>;

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export const editTool: ToolDef<EditParams> = {
  id: 'edit',
  description: loadToolPrompt('edit'),
  parameters: paramsSchema,
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: true,
  execute: async (params) => {
    const content = readFileSync(params.file_path, 'utf-8');
    const occurrences = countOccurrences(content, params.old_string);

    if (occurrences === 0) {
      throw new Error(`old_string not found in ${params.file_path}`);
    }
    if (occurrences > 1 && !params.replace_all) {
      throw new Error(
        `old_string is not unique in ${params.file_path} (${occurrences} occurrences); pass replace_all to replace all of them`,
      );
    }

    const updated = params.replace_all
      ? content.split(params.old_string).join(params.new_string)
      : content.replace(params.old_string, params.new_string);

    writeFileSync(params.file_path, updated, 'utf-8');
    return { output: `Replaced ${params.replace_all ? occurrences : 1} occurrence(s) in ${params.file_path}` };
  },
};
