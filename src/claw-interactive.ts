/**
 * Interactive CLI for NanoClaw sessions
 *
 * This script is spawned by the Python claw CLI when --interactive mode is used.
 * It handles:
 *   - Reading user input from stdin (REPL)
 *   - Writing messages to IPC input directory
 *   - Waiting for container responses before showing next prompt
 *   - Handling compaction status messages (shows user prompts during auto-compaction)
 *   - Graceful shutdown on :exit or Ctrl+C
 *
 * Usage:
 *   node dist/claw-interactive.js --group <folder> --ipc-dir <path>
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Args {
  group: string;
  ipcDir: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = { group: '', ipcDir: '' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--group' && i + 1 < args.length) {
      result.group = args[++i];
    } else if (args[i] === '--ipc-dir' && i + 1 < args.length) {
      result.ipcDir = args[++i];
    }
  }

  if (!result.group || !result.ipcDir) {
    console.error('Usage: claw-interactive --group <folder> --ipc-dir <path>');
    process.exit(1);
  }

  return result;
}

/**
 * Send a message to the container via IPC.
 */
function sendMessage(ipcDir: string, text: string): void {
  const inputDir = path.join(ipcDir, 'input');
  fs.mkdirSync(inputDir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
  const filepath = path.join(inputDir, filename);
  const tempPath = `${filepath}.tmp`;

  fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text }));
  fs.renameSync(tempPath, filepath);
}

/**
 * Signal the container to exit by writing the _close sentinel.
 */
function closeSession(ipcDir: string): void {
  const inputDir = path.join(ipcDir, 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(path.join(inputDir, '_close'), '');
}

/**
 * Response data from container or Python monitor.
 */
interface ResponseData {
  status: string;
  result?: string;
  type?: string; // 'compacting' | 'compact_done' | undefined (normal response)
  message?: string;
}

/**
 * Wait for a response from the container.
 * Python script writes responses to the 'responses' directory.
 * Returns response data or null on timeout.
 */
function waitForResponse(
  ipcDir: string,
  timeoutMs: number = 120000,
): Promise<ResponseData | null> {
  return new Promise((resolve) => {
    const responsesDir = path.join(ipcDir, 'responses');
    fs.mkdirSync(responsesDir, { recursive: true });

    const startTime = Date.now();
    const pollInterval = 200;

    const poll = () => {
      // Check for response files
      try {
        const files = fs
          .readdirSync(responsesDir)
          .filter((f) => f.endsWith('.json'));
        if (files.length > 0) {
          // Read and parse the first response
          for (const f of files) {
            try {
              const filepath = path.join(responsesDir, f);
              const content = fs.readFileSync(filepath, 'utf-8');
              fs.unlinkSync(filepath);
              const data = JSON.parse(content) as ResponseData;
              resolve(data);
              return;
            } catch {
              // Try next file if parse fails
            }
          }
        }
      } catch {}

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        resolve(null);
        return;
      }

      setTimeout(poll, pollInterval);
    };

    poll();
  });
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Ensure directories exist
  const responsesDir = path.join(args.ipcDir, 'responses');
  fs.mkdirSync(responsesDir, { recursive: true });
  fs.mkdirSync(path.join(args.ipcDir, 'input'), { recursive: true });

  // Clean up any stale response files
  try {
    for (const f of fs
      .readdirSync(responsesDir)
      .filter((f) => f.endsWith('.json'))) {
      try {
        fs.unlinkSync(path.join(responsesDir, f));
      } catch {}
    }
  } catch {}

  console.log('');
  console.log(
    '┌─────────────────────────────────────────────────────────────┐',
  );
  console.log(`│ Interactive session: ${args.group.padEnd(36)} │`);
  console.log(
    '├─────────────────────────────────────────────────────────────┤',
  );
  console.log(
    '│ Commands:                                                   │',
  );
  console.log(
    '│   :exit or :quit  - End session                             │',
  );
  console.log(
    '│   /<command>      - Send command to agent (e.g. /compact)   │',
  );
  console.log(
    '└─────────────────────────────────────────────────────────────┘',
  );
  console.log('');

  // Track session state
  let sessionClosed = false;

  // Handle Ctrl+C gracefully
  const handleShutdown = (): void => {
    if (sessionClosed) return;
    sessionClosed = true;
    console.log('\n\n[Closing session...]');
    closeSession(args.ipcDir);
    setTimeout(() => process.exit(0), 500);
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  // Wait for initial response from container before showing first prompt
  process.stdout.write('[Waiting for initial response...]');
  const initialResponse = await waitForResponse(args.ipcDir, 60000);
  if (!initialResponse) {
    process.stdout.write('\r[Timeout waiting for initial response]   \n');
  }

  // Now start the REPL loop
  process.stdout.write('\nYou: ');

  // Read from stdin line by line
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line: string) => {
    if (sessionClosed) return;

    const trimmed = line.trim();

    // Handle exit commands
    if (trimmed === ':exit' || trimmed === ':quit') {
      console.log('\n[Closing session...]');
      sessionClosed = true;
      closeSession(args.ipcDir);
      rl.close();
      setTimeout(() => process.exit(0), 500);
      return;
    }

    // Send message to container via IPC
    if (trimmed) {
      sendMessage(args.ipcDir, trimmed);
      process.stdout.write('[Waiting for response...]');

      // Handle response loop (may receive compaction status messages)
      while (!sessionClosed) {
        const response = await waitForResponse(args.ipcDir, 120000);

        if (!response) {
          process.stdout.write('\r[Timeout waiting for response]   \n');
          break;
        }

        // Check if this is a compaction status message
        if (response.type === 'compacting') {
          // Clear the "[Waiting for response...]" line and show compaction message
          process.stdout.write('\r' + ' '.repeat(35) + '\r');
          console.log(
            `\n${response.message || '[Auto-compacting session, please wait...]'}`,
          );
          continue; // Continue waiting for compact_done
        }

        if (response.type === 'compact_done') {
          console.log(
            response.message || '[Compaction complete. You may continue.]',
          );
          continue; // Continue waiting for normal response
        }

        // Normal response - exit the loop
        break;
      }

      if (!sessionClosed) {
        process.stdout.write('\nYou: ');
      }
    } else {
      // Empty input, just re-prompt
      if (!sessionClosed) {
        process.stdout.write('\nYou: ');
      }
    }
  });

  rl.on('close', () => {
    if (!sessionClosed) {
      closeSession(args.ipcDir);
    }
  });
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
