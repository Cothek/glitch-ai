#!/usr/bin/env node
/**
 * price-tracker.mjs — Automated Price Checking & Alerting System
 *
 * Standalone script for Windows Task Scheduler. Checks product prices
 * via URL scraping and Bing search fallback, sends email alerts on
 * price drops, historical lows, and significant changes.
 *
 * Usage:
 *   node scripts/price-tracker.mjs              # Normal run
 *   node scripts/price-tracker.mjs --dry-run    # Log only, no email/save
 *   node scripts/price-tracker.mjs --force      # Check all, ignore 6hr cooldown
 *   node scripts/price-tracker.mjs --product <id>  # Check single product
 *   node scripts/price-tracker.mjs --status     # Print current prices, no checks
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { createTransport } from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

// ---- Paths ----
const PRODUCTS_PATH = join(ROOT_DIR, 'data', 'price-tracker', 'products.json');
const CONFIG_PATH = join(ROOT_DIR, 'data', 'price-tracker', 'config.json');

// ---- Constants ----
const FETCH_TIMEOUT_MS = 10000;
const COOLDOWN_HOURS = 6;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---- CLI Flags ----
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');
const isStatus = args.includes('--status');
const productIdFlag = args.find(a => a.startsWith('--product='));
const targetProductId = productIdFlag ? productIdFlag.split('=')[1] : null;
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.log(`
  Price Tracker — Automated Price Checking & Alerting

  Options:
    --dry-run           Log actions only, don't send email or save file
    --force             Check all products even if checked within last ${COOLDOWN_HOURS} hours
    --product=<id>      Check only a specific product by ID
    --status            Print current product list and prices, don't check anything
    --help, -h          Show this help

  Examples:
    node scripts/price-tracker.mjs
    node scripts/price-tracker.mjs --dry-run
    node scripts/price-tracker.mjs --force
    node scripts/price-tracker.mjs --product=rtx-4090
    node scripts/price-tracker.mjs --status
  `);
  process.exit(0);
}

// ---- Helpers ----
function log(msg, level = 'INFO') {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'OK' ? '\x1b[32m' : '\x1b[36m';
  process.stderr.write(`${prefix}[${timestamp}] [${level}] ${msg}\x1b[0m\n`);
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Price Extraction ----
const CURRENCY_SYMBOLS = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  'CA$': 'CAD',
  'AU$': 'AUD',
  'CHF': 'CHF'
};

function parsePrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/[,\s]/g, '').trim();

  // Match patterns like $299.99, USD 299.99, 299.99 USD, €299,99
  const patterns = [
    /([$€£¥₹]|CA\$|AU\$|CHF)\s*(\d+(?:[.,]\d{1,2})?)/,
    /(\d+(?:[.,]\d{1,2})?)\s*(USD|EUR|GBP|JPY|INR|CAD|AUD|CHF)/i,
    /(\d+(?:[.,]\d{1,2})?)/  // bare number as last resort
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      let amount, currency;
      if (match[1] && CURRENCY_SYMBOLS[match[1]]) {
        currency = CURRENCY_SYMBOLS[match[1]];
        amount = parseFloat(match[2].replace(',', '.'));
      } else if (match[2] && ['USD', 'EUR', 'GBP', 'JPY', 'INR', 'CAD', 'AUD', 'CHF'].includes(match[2].toUpperCase())) {
        currency = match[2].toUpperCase();
        amount = parseFloat(match[1].replace(',', '.'));
      } else if (match[1]) {
        currency = 'USD'; // default
        amount = parseFloat(match[1].replace(',', '.'));
      } else {
        continue;
      }
      if (!isNaN(amount) && amount > 0) {
        return { amount, currency };
      }
    }
  }
  return null;
}

function extractPriceFromHtml($, url) {
  // 1. JSON-LD structured data
  const jsonLdScripts = $('script[type="application/ld+json"]');
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse($(script).html() || '{}');
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product' || item['@type'] === 'Offer') {
          const offers = item.offers || (item['@type'] === 'Offer' ? item : null);
          if (offers) {
            const offerList = Array.isArray(offers) ? offers : [offers];
            for (const offer of offerList) {
              if (offer.price) {
                const parsed = parsePrice(offer.price.toString());
                if (parsed) return { ...parsed, source: 'json-ld', url };
              }
              if (offer.priceSpecification?.price) {
                const parsed = parsePrice(offer.priceSpecification.price.toString());
                if (parsed) return { ...parsed, source: 'json-ld', url };
              }
            }
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  // 2. Open Graph / meta tags
  const metaSelectors = [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[name="price"]',
    'meta[itemprop="price"]',
    'meta[property="product:price"]'
  ];
  for (const selector of metaSelectors) {
    const el = $(selector).first();
    const content = el.attr('content') || el.attr('value');
    if (content) {
      const parsed = parsePrice(content);
      if (parsed) return { ...parsed, source: 'meta-tag', url };
    }
  }

  // 3. Common CSS selectors for price elements
  const priceSelectors = [
    '[class*="price"]:not([class*="old"]):not([class*="was"]):not([class*="strike"])',
    '[class*="offer"]',
    '[class*="sale"]',
    '[class*="amount"]',
    '[data-price]',
    '[itemprop="price"]',
    '.product-price',
    '.current-price',
    '.price-current',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-price .a-offscreen'
  ];
  for (const selector of priceSelectors) {
    const elements = $(selector);
    for (const el of elements) {
      const text = $(el).text().trim();
      if (text) {
        const parsed = parsePrice(text);
        if (parsed && parsed.amount > 0) {
          return { ...parsed, source: 'css-selector', url };
        }
      }
    }
  }

  // 4. Regex search in body text (last resort)
  const bodyText = $('body').text();
  const priceMatches = bodyText.match(/[$€£¥₹]\s*\d+(?:[.,]\d{2})?/g);
  if (priceMatches) {
    for (const match of priceMatches) {
      const parsed = parsePrice(match);
      if (parsed && parsed.amount > 0 && parsed.amount < 100000) { // sanity check
        return { ...parsed, source: 'regex-body', url };
      }
    }
  }

  return null;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...options.headers
      }
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function checkProductUrls(product) {
  if (!product.urls || product.urls.length === 0) {
    return null;
  }

  for (const url of product.urls) {
    try {
      log(`Fetching URL: ${url}`);
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        log(`HTTP ${response.status} for ${url}`, 'WARN');
        continue;
      }
      const html = await response.text();
      const $ = cheerio.load(html);
      const price = extractPriceFromHtml($, url);
      if (price) {
        log(`Found price via URL: ${price.amount} ${price.currency} (${price.source})`);
        return price;
      }
      log(`No price found in HTML for ${url}`, 'WARN');
    } catch (err) {
      log(`Error fetching ${url}: ${err.message}`, 'WARN');
    }
    await sleep(500); // be polite
  }
  return null;
}

async function searchBingForPrice(product) {
  const searchTerms = product.searchTerms || [product.name];
  const query = encodeURIComponent(`${searchTerms[0]} price`);
  const url = `https://www.bing.com/search?q=${query}&cc=US&setlang=en-US`;

  try {
    log(`Searching Bing: ${url}`);
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      log(`Bing search HTTP ${response.status}`, 'WARN');
      return null;
    }
    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract text from search result snippets
    const snippets = [];
    $('.b_caption, .b_snippet, .b_algoSlug, .b_vlist2col').each((_, el) => {
      const text = $(el).text().trim();
      if (text) snippets.push(text);
    });

    // Also check main result containers
    $('.b_algo').each((_, el) => {
      const text = $(el).text().trim();
      if (text) snippets.push(text);
    });

    // Find prices in snippets
    const prices = [];
    for (const snippet of snippets) {
      const matches = snippet.match(/[$€£¥₹]\s*\d+(?:[.,]\d{2})?/g);
      if (matches) {
        for (const match of matches) {
          const parsed = parsePrice(match);
          if (parsed && parsed.amount > 0 && parsed.amount < 100000) {
            prices.push({ ...parsed, source: 'bing-snippet', url: 'bing.com' });
          }
        }
      }
    }

    if (prices.length > 0) {
      // Return the lowest price found
      prices.sort((a, b) => a.amount - b.amount);
      log(`Found ${prices.length} prices via Bing, using lowest: ${prices[0].amount} ${prices[0].currency}`);
      return prices[0];
    }

    log('No prices found in Bing snippets', 'WARN');
    return null;
  } catch (err) {
    log(`Bing search error: ${err.message}`, 'WARN');
    return null;
  }
}

async function checkProduct(product) {
  log(`Checking product: ${product.name} (${product.id})`);

  // Try URL-based checking first
  let price = await checkProductUrls(product);

  // Fallback to Bing search
  if (!price) {
    log('URL check failed or no URLs, falling back to Bing search');
    price = await searchBingForPrice(product);
  }

  if (!price) {
    log(`No price found for ${product.name}`, 'WARN');
    return { success: false, error: 'No price found' };
  }

  // Record in history
  const historyEntry = {
    price: price.amount,
    date: new Date().toISOString(),
    source: price.source,
    url: price.url
  };

  const updatedProduct = {
    ...product,
    currentPrice: price.amount,
    currentSource: price.source,
    currency: price.currency,
    lastChecked: new Date().toISOString(),
    history: [...(product.history || []), historyEntry]
  };

  return { success: true, product: updatedProduct, price: price.amount };
}

// ---- Alert Detection ----
function detectAlerts(product, config) {
  const alerts = [];
  const currentPrice = product.currentPrice;
  const targetPrice = product.targetPrice;
  const maxPrice = product.maxPrice;
  const history = product.history || [];

  if (currentPrice === null || currentPrice === undefined) {
    return alerts;
  }

  // 1. Below target price
  if (config.alerts.alertOnBelowTarget && currentPrice < targetPrice) {
    alerts.push({
      type: 'below_target',
      message: `Price $${currentPrice.toFixed(2)} is below target $${targetPrice.toFixed(2)}`,
      severity: 'high'
    });
  }

  // 2. Historical low
  if (config.alerts.alertOnHistoricalLow && history.length > 1) {
    const historicalPrices = history.map(h => h.price).filter(p => p != null);
    if (historicalPrices.length > 0) {
      const minHistorical = Math.min(...historicalPrices);
      if (currentPrice <= minHistorical) {
        alerts.push({
          type: 'historical_low',
          message: `New historical low: $${currentPrice.toFixed(2)} (was $${minHistorical.toFixed(2)})`,
          severity: 'high'
        });
      }
    }
  }

  // 3. Large drop since last check
  if (history.length >= 2) {
    const lastPrice = history[history.length - 2]?.price;
    if (lastPrice && lastPrice > 0) {
      const dropPercent = ((lastPrice - currentPrice) / lastPrice) * 100;
      if (dropPercent >= config.alerts.alertOnDropPercent) {
        alerts.push({
          type: 'large_drop',
          message: `Price dropped ${dropPercent.toFixed(1)}% since last check ($${lastPrice.toFixed(2)} → $${currentPrice.toFixed(2)})`,
          severity: 'medium'
        });
      }
    }
  }

  // 4. Pattern break - stable then sudden drop
  if (history.length >= 6) {
    const recent5 = history.slice(-6, -1).map(h => h.price).filter(p => p != null);
    if (recent5.length === 5) {
      const avg = recent5.reduce((a, b) => a + b, 0) / 5;
      const maxDev = Math.max(...recent5.map(p => Math.abs((p - avg) / avg) * 100));
      if (maxDev <= 5) { // stable within 5%
        const lastPrice = recent5[recent5.length - 1];
        const dropFromStable = ((lastPrice - currentPrice) / lastPrice) * 100;
        if (dropFromStable > 10) {
          alerts.push({
            type: 'pattern_break',
            message: `Pattern break: stable at ~$${avg.toFixed(2)} (±${maxDev.toFixed(1)}%), now $${currentPrice.toFixed(2)} (${dropFromStable.toFixed(1)}% drop)`,
            severity: 'medium'
          });
        }
      }
    }
  }

  return alerts;
}

// ---- Email ----
async function sendAlertEmail(alerts, products, config) {
  const emailConfig = config.email;
  if (!emailConfig.smtp?.pass) {
    log('SMTP password not configured, skipping email', 'WARN');
    return false;
  }

  const transporter = createTransport({
    host: emailConfig.smtp.host || 'smtp.gmail.com',
    port: emailConfig.smtp.port || 587,
    secure: false, // STARTTLS
    auth: {
      user: emailConfig.smtp.user,
      pass: emailConfig.smtp.pass
    }
  });

  const productAlerts = alerts.map(a => {
    const product = products.find(p => p.id === a.productId);
    return { ...a, product };
  });

  const subject = `💰 Price Alert: ${productAlerts.length} product(s) — $${productAlerts.map(a => a.product.currentPrice.toFixed(2)).join(', $')}`;

  // Build HTML email
  const rows = productAlerts.map(a => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee;"><strong>${a.product.name}</strong></td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; color: #e53e3e; font-weight: bold;">$${a.product.currentPrice.toFixed(2)} ${a.product.currency}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">$${a.product.targetPrice.toFixed(2)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">${a.product.currentSource}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">${a.message}</td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;"><a href="${a.product.urls?.[0] || '#'}" style="color: #3182ce;">View</a></td>
    </tr>
  `).join('');

  const historyRows = productAlerts.flatMap(a => {
    const product = a.product;
    const recentHistory = (product.history || []).slice(-10).reverse();
    return recentHistory.map(h => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #f0f0f0;">${product.name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #f0f0f0;">$${h.price.toFixed(2)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #f0f0f0;">${new Date(h.date).toLocaleString()}</td>
        <td style="padding: 8px; border-bottom: 1px solid #f0f0f0;">${h.source}</td>
      </tr>
    `);
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #1a202c; font-size: 24px; margin-bottom: 8px; }
        .meta { color: #718096; font-size: 14px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        th { background: #edf2f7; text-align: left; padding: 12px; border-bottom: 2px solid #e2e8f0; font-weight: 600; }
        a { color: #3182ce; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 12px; }
      </style>
    </head>
    <body>
      <h1>💰 Price Alert Triggered</h1>
      <p class="meta">${new Date().toLocaleString()} — ${productAlerts.length} alert(s)</p>

      <h2>Alert Summary</h2>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Current Price</th>
            <th>Target</th>
            <th>Source</th>
            <th>Alert</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <h2>Recent Price History</h2>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Price</th>
            <th>Date</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          ${historyRows || '<tr><td colspan="4" style="padding: 12px; color: #718096;">No history available</td></tr>'}
        </tbody>
      </table>

      <div class="footer">
        This alert was generated by the automated Price Tracker system.
        <br>Configure alerts at: <code>data/price-tracker/config.json</code>
      </div>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: emailConfig.from,
      to: emailConfig.to,
      subject,
      html
    });
    log(`Alert email sent to ${emailConfig.to}`, 'OK');
    return true;
  } catch (err) {
    log(`Failed to send email: ${err.message}`, 'ERROR');
    return false;
  } finally {
    transporter.close();
  }
}

// ---- Main ----
async function main() {
  log('Price Tracker starting...');

  // Load config and products
  const config = await readJson(CONFIG_PATH, {
    email: { from: '', to: '', smtp: { host: 'smtp.gmail.com', port: 587, user: '', pass: '' } },
    alerts: { alertOnBelowTarget: true, alertOnHistoricalLow: true, alertOnDropPercent: 15, minDropPercent: 5, quietHoursEnabled: false }
  });

  const productsData = await readJson(PRODUCTS_PATH, { products: [], lastRun: null, stats: { totalChecks: 0, alertsSent: 0, lastAlertDate: null } });

  let products = productsData.products || [];

  // Filter by product ID if specified
  if (targetProductId) {
    products = products.filter(p => p.id === targetProductId);
    if (products.length === 0) {
      log(`Product not found: ${targetProductId}`, 'ERROR');
      process.exit(1);
    }
  }

  // Status mode - just print and exit
  if (isStatus) {
    console.log('\n── Price Tracker Status ──');
    console.log(`Total products: ${productsData.products?.length || 0}`);
    console.log(`Last run: ${productsData.lastRun || 'never'}`);
    console.log(`Total checks: ${productsData.stats?.totalChecks || 0}`);
    console.log(`Alerts sent: ${productsData.stats?.alertsSent || 0}`);
    console.log('');
    for (const p of products) {
      const status = p.alertsEnabled ? '✅' : '⏸️';
      const price = p.currentPrice != null ? `$${p.currentPrice.toFixed(2)} ${p.currency}` : '—';
      const lastChecked = p.lastChecked ? new Date(p.lastChecked).toLocaleString() : 'never';
      console.log(`  ${status} ${p.name} (${p.id})`);
      console.log(`      Current: ${price} | Target: $${p.targetPrice.toFixed(2)} | Max: $${p.maxPrice.toFixed(2)}`);
      console.log(`      Last checked: ${lastChecked} | Source: ${p.currentSource || '—'}`);
      console.log('');
    }
    process.exit(0);
  }

  // Filter enabled products
  const enabledProducts = products.filter(p => p.alertsEnabled !== false);
  if (enabledProducts.length === 0) {
    log('No products with alerts enabled', 'WARN');
    process.exit(0);
  }

  log(`Checking ${enabledProducts.length} product(s)...`);

  // Check each product
  const allAlerts = [];
  const updatedProducts = [...productsData.products]; // keep all products, update checked ones
  let checksThisRun = 0;

  for (const product of enabledProducts) {
    // Check cooldown unless forced
    if (!isForce && product.lastChecked) {
      const hoursSinceCheck = (Date.now() - new Date(product.lastChecked).getTime()) / (1000 * 60 * 60);
      if (hoursSinceCheck < COOLDOWN_HOURS) {
        log(`Skipping ${product.name} — checked ${hoursSinceCheck.toFixed(1)}h ago (use --force to override)`);
        continue;
      }
    }

    const result = await checkProduct(product);
    checksThisRun++;

    if (result.success) {
      // Update product in the full list
      const idx = updatedProducts.findIndex(p => p.id === product.id);
      if (idx >= 0) {
        updatedProducts[idx] = result.product;
      }

      // Detect alerts
      const alerts = detectAlerts(result.product, config);
      if (alerts.length > 0) {
        for (const alert of alerts) {
          allAlerts.push({ ...alert, productId: product.id });
        }
        log(`⚠️  ALERT for ${product.name}: ${alerts.map(a => a.type).join(', ')}`, 'WARN');
      } else {
        log(`No alerts for ${product.name} (current: $${result.price.toFixed(2)})`, 'OK');
      }
    } else {
      log(`Failed to check ${product.name}: ${result.error}`, 'ERROR');
    }

    // Small delay between products
    await sleep(1000);
  }

  // Update stats
  const newStats = {
    totalChecks: (productsData.stats?.totalChecks || 0) + checksThisRun,
    alertsSent: productsData.stats?.alertsSent || 0,
    lastAlertDate: productsData.stats?.lastAlertDate || null
  };

  const updatedData = {
    products: updatedProducts,
    lastRun: new Date().toISOString(),
    stats: newStats
  };

  // Send alerts if any
  if (allAlerts.length > 0) {
    log(`${allAlerts.length} alert(s) triggered`);
    if (!isDryRun) {
      const sent = await sendAlertEmail(allAlerts, updatedProducts, config);
      if (sent) {
        updatedData.stats.alertsSent += allAlerts.length;
        updatedData.stats.lastAlertDate = new Date().toISOString();
      }
    } else {
      log('DRY-RUN: Would send alert email', 'WARN');
    }
  } else {
    log('No alerts triggered this run', 'OK');
  }

  // Save updated data
  if (!isDryRun) {
    await writeJson(PRODUCTS_PATH, updatedData);
    log(`Saved updated products to ${PRODUCTS_PATH}`, 'OK');
  } else {
    log('DRY-RUN: Would save updated products', 'WARN');
  }

  log('Price Tracker completed', 'OK');
  process.exit(0);
}

main().catch(err => {
  log(`Fatal error: ${err.message}`, 'ERROR');
  console.error(err);
  process.exit(1);
});