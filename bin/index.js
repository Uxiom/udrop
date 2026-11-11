#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.js';
import { getLocalIpAddresses, getLocalHostInfo } from '../src/network.js';
import { registerOutboundFile, getDownloadDirectory } from '../src/transfer.js';
import { startWindowsHotspot, stopWindowsHotspot, checkHotspotSupport } from '../src/hotspot.js';
import {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  installAutoStart,
  uninstallAutoStart
} from '../src/daemon.js';

const _currentFile = typeof __filename !== 'undefined' ? __filename : (typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : process.argv[1]);
const _currentDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(_currentFile);
const pkgPath = path.resolve(_currentDir, '../package.json');
const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) : { version: '0.1.0' };

const program = new Command();

function getRequestedPort(opts) {
  const pIdx = process.argv.findIndex(a => a === '-p' || a === '--port');
  if (pIdx !== -1 && process.argv[pIdx + 1] && !isNaN(parseInt(process.argv[pIdx + 1], 10))) {
    return parseInt(process.argv[pIdx + 1], 10);
  }
  return parseInt(opts?.port, 10) || 4040;
}

program
  .name('udrop')
  .description(chalk.bold('uDrop') + ' — Zero-router, cross-platform P2P file transfer (by Uxiom)')
  .version(pkg.version, '-v, --version', 'Output current version');

// -------------------------------------------------------------
// Subcommand: udrop service <start|stop|status|install|uninstall>
// -------------------------------------------------------------
const service = program.command('service').description('Manage uDrop silent background service');

service
  .command('start')
  .description('Start uDrop headlessly in the background (no open terminal required)')
  .option('-p, --port <number>', 'Port to listen on', '4040')
  .action(async (opts) => {
    const port = getRequestedPort(opts);
    console.log(chalk.yellow('Starting uDrop silent background daemon...'));
    try {
      const res = await startDaemon({ port });
      if (res.alreadyRunning) {
        console.log(chalk.green(`uDrop daemon is already running (PID: ${res.pid})`));
      } else {
        console.log(chalk.bold.green(`uDrop daemon started in background (PID: ${res.pid})`));
      }
      console.log(`   Connect URL:     ${chalk.bold.cyan(res.connectUrl)}`);
      console.log(`   Saves files to:  ${chalk.dim(getDownloadDirectory())}`);
      console.log(chalk.gray(`\nRun ${chalk.cyan('udrop qr')} to display pairing code, or ${chalk.cyan('udrop service stop')} to exit.`));
    } catch (err) {
      console.error(chalk.red.bold('Failed to start background daemon: ') + err.message);
      process.exit(1);
    }
  });

service
  .command('stop')
  .description('Stop the running background daemon')
  .action(async () => {
    const res = await stopDaemon();
    if (!res.running && !res.success) {
      console.log(chalk.gray('uDrop background daemon is not running.'));
    } else {
      console.log(chalk.bold.green(`Stopped background daemon (PID: ${res.stoppedPid})`));
    }
  });

service
  .command('status')
  .description('Check status of the background daemon')
  .action(async () => {
    const status = await getDaemonStatus();
    if (!status) {
      console.log(chalk.gray('uDrop background daemon is currently ') + chalk.red.bold('OFFLINE'));
      console.log(chalk.dim(`Start it with: ${chalk.cyan('udrop service start')}`));
    } else {
      console.log(chalk.bold.green('[ACTIVE] uDrop background daemon is running'));
      console.log(`   PID:         ${chalk.white(status.pid)}`);
      console.log(`   Port:        ${chalk.white(status.port)}`);
      console.log(`   Connect URL: ${chalk.bold.cyan(status.connectUrl)}`);
      console.log(`   Host:        ${chalk.white(status.hostInfo?.hostname || 'Local PC')}`);
      console.log(`   Folder:      ${chalk.dim(getDownloadDirectory())}`);
    }
  });

service
  .command('install')
  .description('Enable automatic background startup when user logs into Windows')
  .option('-p, --port <number>', 'Port to listen on', '4040')
  .action(async (opts) => {
    const port = getRequestedPort(opts);
    console.log(chalk.yellow('Registering uDrop for automatic Windows logon startup...'));
    try {
      await installAutoStart({ port });
      console.log(chalk.bold.green('Successfully registered auto-start on Windows login.'));
      console.log(chalk.dim('uDrop will now boot silently in the background whenever you log into this PC.'));
      console.log(chalk.gray(`To start it immediately without logging out: ${chalk.cyan('udrop service start')}`));
    } catch (err) {
      console.error(chalk.red.bold('Failed to install startup service: ') + err.message);
      process.exit(1);
    }
  });

service
  .command('uninstall')
  .description('Disable automatic Windows startup')
  .action(async () => {
    await uninstallAutoStart();
    console.log(chalk.bold.green('Removed uDrop from Windows startup.'));
  });

// -------------------------------------------------------------
// Subcommand: udrop qr (Instant pairing display)
// -------------------------------------------------------------
program
  .command('qr')
  .description('Display optical pairing QR code for the running daemon')
  .action(async () => {
    let connectUrl = '';
    let targetPort = 4040;
    const status = await getDaemonStatus();
    if (!status) {
      console.log(chalk.yellow('Daemon is not currently running.'));
      console.log(`Starting it now...`);
      const started = await startDaemon();
      connectUrl = started.connectUrl;
      targetPort = started.port;
    } else {
      connectUrl = status.connectUrl;
      targetPort = status.port;
    }

    console.log(chalk.bold.cyan(`\nConnect URL:    ${connectUrl}`));
    console.log(chalk.gray(`   Card View:      ${chalk.yellow(`http://localhost:${targetPort}/qr`)}\n`));
    qrcode.generate(connectUrl, { small: true });

    // Trigger liquid glass overlay on open laptop screen
    try {
      await fetch(`http://localhost:${targetPort}/api/qr/popup`, { method: 'POST' });
    } catch (e) {}
  });

// -------------------------------------------------------------
// Subcommand: udrop status (Alias)
// -------------------------------------------------------------
program
  .command('status')
  .description('Check daemon health and connection info')
  .action(async () => {
    const status = await getDaemonStatus();
    if (!status) {
      console.log(chalk.gray('uDrop daemon is ') + chalk.red.bold('OFFLINE'));
    } else {
      console.log(chalk.bold.green('[ACTIVE] uDrop daemon is running'));
      console.log(`   URL: ${chalk.bold.cyan(status.connectUrl)} (PID: ${status.pid})`);
    }
  });

// -------------------------------------------------------------
// Subcommand: udrop island (Launch Floating Dynamic Island HUD)
// -------------------------------------------------------------
program
  .command('island')
  .description('Launch the Liquid Glass Dynamic Island floating overlay HUD')
  .action(async () => {
    const status = await getDaemonStatus();
    const port = status ? status.port : 4040;
    const url = `http://localhost:${port}/island`;
    console.log(chalk.bold.green('Launching Dynamic Island HUD...'));
    console.log(`   URL: ${chalk.cyan(url)}`);
    if (process.platform === 'win32') {
      exec(`start ${url}`);
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  });

// -------------------------------------------------------------
// Subcommand: udrop open (Open downloads folder in File Explorer)
// -------------------------------------------------------------
program
  .command('open')
  .description('Open the received files folder in Windows File Explorer')
  .action(() => {
    const dir = getDownloadDirectory();
    console.log(chalk.bold.green('Opening uDrop downloads folder...'));
    console.log(`   Path: ${chalk.dim(dir)}`);
    if (process.platform === 'win32') {
      exec(`explorer.exe "${dir}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${dir}"`);
    } else {
      exec(`xdg-open "${dir}"`);
    }
  });

// -------------------------------------------------------------
// Default Action: Interactive Foreground Server or --daemon
// -------------------------------------------------------------
program
  .argument('[files...]', 'Files to share from this PC to connected mobile devices')
  .option('-p, --port <number>', 'Port to listen on', '4040')
  .option('--hotspot', 'Start a router-less Windows Wi-Fi Hotspot', false)
  .option('--no-qr', 'Do not render QR code in terminal', false)
  .option('--daemon', 'Launch in background daemon mode and exit immediately', false)
  .option('--daemon-child', 'Internal flag for headless background runner', false)
  .action(async (files, options) => {
    const port = getRequestedPort(options);

    // Headless background runner
    if (options.daemonChild) {
      try {
        await startServer({
          port,
          onShutdown: () => setTimeout(() => process.exit(0), 150)
        });
        // Keep alive
        process.stdin.resume();
      } catch (err) {
        process.exit(1);
      }
      return;
    }

    // Launch daemon and exit
    if (options.daemon) {
      console.log(chalk.yellow('Starting uDrop in background daemon mode...'));
      const res = await startDaemon({ port });
      console.log(chalk.bold.green(`uDrop is running in background (PID: ${res.pid})`));
      console.log(`   Connect URL: ${chalk.bold.cyan(res.connectUrl)}`);
      return;
    }

    // Standard interactive CLI mode
    console.log();
    console.log(chalk.bold.cyan(' █   █  ████  ████   ███  ████  '));
    console.log(chalk.bold.cyan(' █   █  █   █ █   █ █   █ █   █ '));
    console.log(chalk.bold.cyan(' █   █  █   █ ████  █   █ ████  '));
    console.log(chalk.bold.cyan(' █   █  █   █ █   █ █   █ █     '));
    console.log(chalk.bold.cyan('  ███   ████  █   █  ███  █     '));
    console.log();
    console.log(chalk.bold.white('[ uDrop ]') + chalk.gray(' — Instant Cross-Platform P2P File Transfer (by Uxiom)'));
    console.log(chalk.gray('  Zero-router | Encrypted LAN | Resumable 4K streaming | Zero app install on phone'));
    console.log(chalk.gray('  ─'.repeat(72)));

    // Register outbound files passed via CLI
    if (files && files.length > 0) {
      console.log(chalk.bold('Sharing Outbound Files:'));
      for (const f of files) {
        try {
          const registered = registerOutboundFile(f);
          console.log(`   [OK] ${chalk.white(registered.name)} ${chalk.dim(`(${(registered.size / (1024 * 1024)).toFixed(1)} MB)`)}`);
        } catch (err) {
          console.log(`   [FAIL] ${chalk.yellow(f)}: ${err.message}`);
        }
      }
      console.log();
    }

    let connectUrl = '';

    // Router-less Wi-Fi Hotspot mode
    if (options.hotspot) {
      console.log(chalk.yellow('Checking Wi-Fi Hotspot compatibility...'));
      const support = await checkHotspotSupport();
      if (!support.supported) {
        console.log(chalk.yellow(`[WARN] Wi-Fi Hosted Network not supported by current adapter (${support.reason || 'Driver unsupported'}). Falling back to LAN mode.`));
      } else {
        try {
          const hotspot = await startWindowsHotspot();
          console.log(chalk.green('Direct Wi-Fi Hotspot Active:'));
          console.log(`   SSID:     ${chalk.bold.white(hotspot.ssid)}`);
          console.log(`   Password: ${chalk.bold.white(hotspot.key)}`);
          console.log();
          if (options.qr) {
            console.log(chalk.dim('Point phone camera to join Wi-Fi network:'));
            qrcode.generate(hotspot.wifiQrString, { small: true });
          }
          connectUrl = `http://${hotspot.gatewayIp}:${port}`;
        } catch (err) {
          console.log(chalk.red(`[WARN] Could not start hosted network (${err.message}). Falling back to LAN mode.`));
        }
      }
    }

    if (!connectUrl) {
      const hostInfo = getLocalHostInfo(port);
      connectUrl = hostInfo.mdnsUrl;
    }

    // Start HTTP Server
    try {
      await startServer({
        port,
        onShutdown: () => setTimeout(() => process.exit(0), 150)
      });
    } catch (err) {
      console.error(chalk.red.bold('Failed to start uDrop server: ') + err.message);
      process.exit(1);
    }

    console.log(chalk.bold.green('uDrop Engine Running'));
    console.log(`   Connect URL:     ${chalk.bold.cyan(connectUrl)}`);
    console.log(`   Local Dashboard: ${chalk.cyan(`http://localhost:${port}`)}`);
    console.log(`   Card View:       ${chalk.yellow(`http://localhost:${port}/qr`)}`);
    console.log(`   Saves files to:  ${chalk.dim(getDownloadDirectory())}`);
    console.log();

    if (options.qr) {
      console.log(chalk.dim('Scan with iPhone / Android camera to open uDrop in browser:'));
      qrcode.generate(connectUrl, { small: true });
    }

    console.log(chalk.gray('  ─'.repeat(72)));
    console.log(chalk.gray(`  Tip: Run ${chalk.cyan('udrop service install')} to run silently in the background on startup.`));
    console.log(chalk.gray('  Ready for incoming transfers. Press Ctrl+C to stop.'));
    console.log();

    // Clean exit
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\nStopping uDrop...'));
      if (options.hotspot) {
        await stopWindowsHotspot();
      }
      process.exit(0);
    });
  });

program.parse(process.argv);
