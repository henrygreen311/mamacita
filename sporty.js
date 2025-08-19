// sporty-session-firefox.js
const { firefox } = require('playwright');
const fs = require('fs');

const SESSION_FILE = 'session.json';
const BASE_URL = 'https://www.sportybet.com/ng/m/';
const MOBILE = '9120183273';
const PASSWORD = 'Edmond99';

const headless = process.env.HEADLESS !== "false";

// --- Popup remover ---
async function dismissPopup(page) {
  try {
    await page.evaluate(() => {
      document.querySelectorAll('div.layout.mask, div.es-dialog-wrap, div.dialog-wrapper, div.dialog-mask')
        .forEach(el => el.remove());
    });
    console.log("Popup/overlay cleared.");
  } catch {}
}

(async () => {
  const browser = await firefox.launch({ headless });
  let context;

  // Step 1: Try existing session
  if (fs.existsSync(SESSION_FILE)) {
    console.log("Session file found, trying to reuse it...");
    context = await browser.newContext({ storageState: SESSION_FILE });
    const page = await context.newPage();

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const loginBtn = await page.$('div[data-op="nav-login"]');
    if (loginBtn) {
      console.log("Session expired. Proceeding with manual login...");
      await context.close();
    } else {
      console.log("Valid session. Logged in successfully.");
      await browser.close();
      return; //stop here, don't run main.js
    }
  }

  // Step 2: Manual login if no valid session
  context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await dismissPopup(page);
  await page.click('div[data-op="nav-login"]');
  await page.waitForSelector('input[placeholder="Mobile Number"]');

  await page.fill('input[placeholder="Mobile Number"]', MOBILE);
  await page.fill('input[placeholder="Password"]', PASSWORD);
  await page.click('button.login-btn');

  try {
    await page.waitForSelector('div[data-op="nav-login"]', { state: 'detached', timeout: 15000 });
    console.log("Login successful. Saving new session...");

    await context.storageState({ path: SESSION_FILE });
    console.log("Session saved to", SESSION_FILE);

    await browser.close();
    return; //stop here, don't run main.js
  } catch (err) {
    console.log("Login failed or timeout reached:", err.message);
    await browser.close();
  }
})();
