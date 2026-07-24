import { describe, expect, it } from 'vitest';
import {
  externalDirectoryGlob,
  isDangerousPath,
  isEnvFileRead,
  isPathInBoundary,
} from '../../src/permission/boundary.js';

describe('isPathInBoundary', () => {
  const ctx = { cwd: '/home/user/project', additionalDirs: ['/home/user/shared'] };

  it('allows paths inside cwd', () => {
    expect(isPathInBoundary('/home/user/project/src/index.ts', ctx)).toBe(true);
    expect(isPathInBoundary('/home/user/project', ctx)).toBe(true);
  });

  it('allows paths inside additionalDirs', () => {
    expect(isPathInBoundary('/home/user/shared/lib.ts', ctx)).toBe(true);
  });

  it('rejects paths outside cwd and additionalDirs (external_directory territory)', () => {
    expect(isPathInBoundary('/etc/passwd', ctx)).toBe(false);
    expect(isPathInBoundary('/home/user/other-project/file.ts', ctx)).toBe(false);
  });

  it('does not treat a sibling directory with a matching prefix as in-boundary', () => {
    // "/home/user/project-evil" starts with "/home/user/project" as a string
    // prefix but is NOT inside it as a directory.
    expect(isPathInBoundary('/home/user/project-evil/file.ts', ctx)).toBe(false);
  });
});

describe('externalDirectoryGlob', () => {
  it('produces a parent-directory glob for the always-approve pattern', () => {
    expect(externalDirectoryGlob('/tmp/scratch/file.txt')).toBe('/tmp/scratch/*');
  });
});

describe('isDangerousPath (DANGEROUS_FILES -> safetyCheck)', () => {
  const dangerous = [
    '/home/user/project/.git/config',
    '/home/user/project/.uagent/settings.json',
    '/home/user/.ssh/id_rsa',
    '/home/user/.bashrc',
    '/home/user/.zshrc',
    '/home/user/project/.mcp.json',
  ];

  it.each(dangerous)('flags dangerous path: %s', (target) => {
    expect(isDangerousPath(target)).toBe(true);
  });

  it('does not flag ordinary project files', () => {
    expect(isDangerousPath('/home/user/project/src/index.ts')).toBe(false);
  });
});

describe('isEnvFileRead', () => {
  it('flags .env and .env.local reads', () => {
    expect(isEnvFileRead('/home/user/project/.env')).toBe(true);
    expect(isEnvFileRead('/home/user/project/.env.local')).toBe(true);
  });

  it('does not flag .env.example (safe template)', () => {
    expect(isEnvFileRead('/home/user/project/.env.example')).toBe(false);
  });

  it('does not flag unrelated files', () => {
    expect(isEnvFileRead('/home/user/project/environment.ts')).toBe(false);
  });
});
