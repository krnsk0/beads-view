import { spawn } from 'node:child_process';

/**
 * Copy text to the system clipboard: pbcopy on macOS, OSC 52 escape sequence
 * (terminal-side clipboard write) everywhere else.
 */
export function copyToClipboard(text: string): Promise<void> {
  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      const proc = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pbcopy exited ${code}`));
      });
      proc.stdin.end(text);
    });
  }
  process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
  return Promise.resolve();
}
