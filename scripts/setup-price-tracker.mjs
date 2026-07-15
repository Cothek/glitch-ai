#!/usr/bin/env node
/**
 * setup-price-tracker.mjs — Interactive Setup Wizard for Price Tracker
 *
 * Configures email (Gmail SMTP), schedule, alerts, sample products,
 * and optionally installs a Windows Task Scheduler job.
 *
 * Usage:
 *   node scripts/setup-price-tracker.mjs          # Interactive setup
 *   node scripts/setup-price-tracker.mjs --reset   # Overwrite existing config
 */

import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

const CONFIG_PATH = join(ROOT_DIR, 'data', 'price-tracker', 'config.json');
const PRODUCTS_PATH = join(ROOT_DIR, 'data', 'price-tracker', 'products.json');

const RESET = process.argv.includes('--reset');

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET_COLOR = '\x1b[0m';

const rl = createInterface({ input: stdin, output: stdout });

let cancelled = false;

function handleSigint() {
  cancelled = true;
  stdin.setRawMode?.(false);
  stdout.write('\n\n');
  stdout.write(`${YELLOW}Setup cancelled.${RESET_COLOR}\n`);
  rl.close();
  process.exit(0);
}

process.on('SIGINT', handleSigint);

async function ask(prompt, defaultValue = '') {
  if (cancelled) process.exit(0);
  const defaultHint = defaultValue !== '' ? `${DIM} [${defaultValue}]${RESET_COLOR}` : '';
  const answer = await rl.question(`${CYAN}${prompt}${defaultHint}: ${RESET_COLOR}`);
  const trimmed = answer.trim();
  return trimmed === '' ? defaultValue : trimmed;
}

async function askYesNo(prompt, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await ask(`${prompt} (${hint})`, defaultYes ? 'y' : 'n');
  return answer.toLowerCase().startsWith('y');
}

async function askPassword(prompt) {
  if (cancelled) process.exit(0);
  stdout.write(`${CYAN}${prompt}${RESET_COLOR}`);

  return new Promise((resolve) => {
    let password = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (char) => {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        handleSigint();
        resolve('');
      } else if (char === '\u007f' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        password += char;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

function printBanner() {
  console.log('');
  console.log(`${BOLD}${CYAN}`);
  console.log('  +======================================+');
  console.log('  |     Price Tracker - Setup Wizard     |');
  console.log('  +======================================+');
  console.log(`${RESET_COLOR}`);
  console.log('');
}

function printSection(title) {
  console.log('');
  console.log(`${DIM}-- ${title} ${'--'.repeat(Math.max(0, 38 - title.length))}${RESET_COLOR}`);
  console.log('');
}

function success(msg) {
  console.log(`${GREEN}${msg}${RESET_COLOR}`);
}

function warn(msg) {
  console.log(`${YELLOW}${msg}${RESET_COLOR}`);
}

function error(msg) {
  console.log(`${RED}${msg}${RESET_COLOR}`);
}

function info(msg) {
  console.log(`${DIM}${msg}${RESET_COLOR}`);
}

async function readJson(path, fallback = null) {
  try {
    await access(path);
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(path, data) {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

async function testSmtp(config) {
  const { createTransport } = await import('nodemailer');
  const transporter = createTransport({
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: false,
    auth: {
      user: config.email.smtp.user,
      pass: config.email.smtp.pass
    }
  });

  try {
    stdout.write(`${DIM}  Testing SMTP connection...${RESET_COLOR}`);
    await transporter.sendMail({
      from: config.email.from,
      to: config.email.to,
      subject: 'Price Tracker - SMTP Test',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1a202c;">Price Tracker - SMTP Test</h2>
          <p>If you received this, your email configuration is working correctly.</p>
          <p style="color: #718096; font-size: 14px;">Sent at: ${new Date().toLocaleString()}</p>
          <p style="color: #718096; font-size: 14px;">Schedule: ${config.schedule.time} (${config.schedule.timezone})</p>
        </div>
      `
    });
    stdout.write(` ${GREEN}Email sent! Check your inbox.${RESET_COLOR}\n`);
    return true;
  } catch (err) {
    stdout.write(` ${RED}Failed: ${err.message}${RESET_COLOR}\n`);
    return false;
  } finally {
    transporter.close();
  }
}

async function setupEmail(existing) {
  printSection('Email Configuration');

  info('Gmail setup: Google Account > Security > 2-Step Verification > App Passwords');
  info('Generate a 16-character app password for "Mail".');
  console.log('');

  const from = await ask('From address', existing.email?.from || 'cothek@gmail.com');
  const to = await ask('To address', existing.email?.to || from);
  const password = await askPassword('Gmail App Password: ');

  if (!password) {
    warn('No password entered. Email alerts will be disabled.');
    return {
      ...existing,
      email: { from, to, smtp: { host: 'smtp.gmail.com', port: 587, user: from, pass: '' } }
    };
  }

  const config = {
    ...existing,
    email: {
      from,
      to,
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        user: from,
        pass: password
      }
    }
  };

  console.log('');
  const emailOk = await testSmtp(config);
  if (!emailOk) {
    const retry = await askYesNo('Retry with different credentials?', false);
    if (retry) {
      return setupEmail(existing);
    }
    warn('Continuing without verified email. You can re-run setup later.');
  }

  return config;
}

async function setupSchedule(existing) {
  printSection('Schedule Configuration');

  const time = await ask('Daily check time (HH:MM)', existing.schedule?.time || '08:00');
  const timezone = await ask('Timezone', existing.schedule?.timezone || 'America/New_York');

  return {
    ...existing,
    schedule: { time, timezone }
  };
}

async function setupAlerts(existing) {
  printSection('Alert Preferences');

  const alertOnBelowTarget = await askYesNo('Alert when price below target?', true);
  const alertOnHistoricalLow = await askYesNo('Alert on historical low?', true);
  const alertOnDropPercent = parseInt(await ask('Drop % to trigger alert', String(existing.alerts?.alertOnDropPercent || 15)), 10);

  return {
    ...existing,
    alerts: {
      alertOnBelowTarget,
      alertOnHistoricalLow,
      alertOnDropPercent,
      minDropPercent: existing.alerts?.minDropPercent || 5,
      quietHoursEnabled: existing.alerts?.quietHoursEnabled || false,
      quietHoursStart: existing.alerts?.quietHoursStart || '22:00',
      quietHoursEnd: existing.alerts?.quietHoursEnd || '08:00'
    }
  };
}

async function setupSampleProduct() {
  printSection('Optional: Sample Product');

  const addSample = await askYesNo('Add sample test product?', true);
  if (!addSample) return;

  const name = await ask('Product name', 'NVIDIA RTX 4090');
  const url = await ask('URL (optional)', 'https://www.bestbuy.com/site/nvidia-geforce-rtx-4090-24gb-gddr6x-pci-express-graphics-card-titanium-and-black/6521424.p');
  const targetPrice = parseFloat(await ask('Target price', '1599.99'));

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const product = {
    id,
    name,
    targetPrice,
    maxPrice: 0,
    urls: url ? [url] : [],
    searchTerms: [name],
    alertsEnabled: true,
    currentPrice: null,
    currentSource: null,
    currency: 'USD',
    lastChecked: null,
    history: []
  };

  const existing = await readJson(PRODUCTS_PATH, { products: [], lastRun: null, stats: { totalChecks: 0, alertsSent: 0, lastAlertDate: null } });
  existing.products.push(product);
  await writeJson(PRODUCTS_PATH, existing);

  success(`  Added: ${product.name} (target: $${product.targetPrice.toFixed(2)})`);
}

async function setupTaskScheduler(config) {
  printSection('Optional: Task Scheduler');

  const install = await askYesNo('Install daily Task Scheduler?', true);
  if (!install) return;

  const ps1Path = join(ROOT_DIR, 'scripts', 'install-price-tracker.ps1');

  try {
    await access(ps1Path);
  } catch {
    warn(`  Install script not found: ${ps1Path}`);
    warn('  Skipping Task Scheduler setup. Create the script or run manually.');
    return;
  }

  console.log('');
  info(`  Running: powershell -File "${ps1Path}" -Time "${config.schedule.time}"`);
  console.log('');

  const result = await new Promise((resolve) => {
    const proc = spawn('powershell', ['-NoProfile', '-File', ps1Path, '-Time', config.schedule.time], {
      stdio: 'inherit',
      cwd: ROOT_DIR
    });
    proc.on('close', (code) => resolve(code));
  });

  if (result === 0) {
    success('  Task Scheduler job installed.');
  } else {
    error(`  Task Scheduler setup failed (exit code ${result}).`);
    warn('  You can install manually by running the script above.');
  }
}

function printSummary(config) {
  console.log('');
  console.log(`${GREEN}+======================================+${RESET_COLOR}`);
  console.log(`${GREEN}|         Setup Complete!              |${RESET_COLOR}`);
  console.log(`${GREEN}+======================================+${RESET_COLOR}`);
  console.log('');
  console.log(`  ${DIM}Config saved to:${RESET_COLOR}  ${CONFIG_PATH}`);
  console.log(`  ${DIM}Products file:${RESET_COLOR}    ${PRODUCTS_PATH}`);
  console.log('');
  console.log(`  ${DIM}Test run:${RESET_COLOR}         node scripts/price-tracker.mjs --dry-run`);
  console.log(`  ${DIM}Manual check:${RESET_COLOR}     node scripts/price-tracker.mjs --force`);
  console.log(`  ${DIM}Daily schedule:${RESET_COLOR}   ${config.schedule.time} (${config.schedule.timezone})`);
  console.log('');

  if (!config.email.smtp.pass) {
    warn('  Note: No SMTP password configured. Email alerts are disabled.');
    warn('  Re-run setup to configure email: node scripts/setup-price-tracker.mjs');
    console.log('');
  }
}

async function main() {
  printBanner();

  const existingConfig = RESET ? {} : (await readJson(CONFIG_PATH)) || {};

  if (!RESET && Object.keys(existingConfig).length > 0) {
    info('Existing config found. Press Enter to keep current values.');
    console.log('');
  }

  if (RESET) {
    warn('--reset flag: starting fresh, existing config will be overwritten.');
    console.log('');
  }

  let config = {
    ...existingConfig,
    email: existingConfig.email || { from: '', to: '', smtp: { host: 'smtp.gmail.com', port: 587, user: '', pass: '' } },
    schedule: existingConfig.schedule || { time: '08:00', timezone: 'America/New_York' },
    alerts: existingConfig.alerts || { alertOnBelowTarget: true, alertOnHistoricalLow: true, alertOnDropPercent: 15, minDropPercent: 5, quietHoursEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '08:00' }
  };

  config = await setupEmail(config);
  config = await setupSchedule(config);
  config = await setupAlerts(config);

  await writeJson(CONFIG_PATH, config);
  success(`\n  Config saved to ${CONFIG_PATH}`);

  await setupSampleProduct();
  await setupTaskScheduler(config);

  printSummary(config);

  rl.close();
}

main().catch((err) => {
  error(`Setup failed: ${err.message}`);
  console.error(err);
  rl.close();
  process.exit(1);
});
