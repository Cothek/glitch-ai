import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('http://localhost:3000/admin/messages', { waitUntil: 'networkidle', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: 'screenshots/messages-page.png', fullPage: false });

await browser.close();
console.log('Screenshot saved to screenshots/messages-page.png');
