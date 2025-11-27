#!/usr/bin/env node

const { execSync } = require('child_process');
const os = require('os');

const PORT = 3000;

function killServerProcess() {
  const platform = os.platform();

  try {
    if (platform === 'win32') {
      // Windows: PowerShellを使ってプロセスをkill
      try {
        const command = `powershell -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess) -Force -ErrorAction SilentlyContinue"`;
        execSync(command, { stdio: 'inherit' });
        console.log(`✓ Killed existing server processes on port ${PORT}`);
      } catch (error) {
        // プロセスが見つからない場合は何もしない
        console.log(`ℹ️  No existing server found on port ${PORT}`);
      }
    } else {
      // Unix系OS: lsofとkillを使ってプロセスをkill
      try {
        const pidCommand = `lsof -ti:${PORT}`;
        const pid = execSync(pidCommand, { encoding: 'utf8' }).trim();

        if (pid) {
          execSync(`kill -9 ${pid}`, { stdio: 'inherit' });
          console.log(`✓ Killed existing server process (PID: ${pid}) on port ${PORT}`);
        } else {
          console.log(`ℹ️  No existing server found on port ${PORT}`);
        }
      } catch (error) {
        // プロセスが見つからない場合は何もしない
        console.log(`ℹ️  No existing server found on port ${PORT}`);
      }
    }
  } catch (error) {
    console.log(`ℹ️  Could not kill existing server on port ${PORT}: ${error.message}`);
  }
}

// メイン実行
console.log(`🔄 Checking for existing server on port ${PORT}...`);
killServerProcess();
console.log('🚀 Starting new server...\n');
