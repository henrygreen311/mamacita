// sporty-check.js
const { firefox } = require('playwright');
const fs = require('fs');
const { exec } = require('child_process');

const SESSION_FILE = 'session.json';
const CHECK_URL = 'https://www.sportybet.com/ng/m/instant-virtuals/quickgame';
const resultFile = 'result.json';
const fixtureFile = '/home/runner/work/mamacita/mamacita/fixture.json';

// --- Fixture helpers ---
let fixtureCache = null;

function loadFixture() {
  if (fixtureCache) return fixtureCache;
  if (!fs.existsSync(fixtureFile)) {
    console.warn(`fixture.json not found at ${fixtureFile}`);
    return null;
  }
  try {
    fixtureCache = JSON.parse(fs.readFileSync(fixtureFile, 'utf-8'));
  } catch (e) {
    console.warn('Could not parse fixture.json:', e.message);
    fixtureCache = null;
  }
  return fixtureCache;
}

function getOver15Probability(homeCode, awayCode) {
  const fx = loadFixture();
  if (!fx) return null;

  const events = fx.wrapEventList && Array.isArray(fx.wrapEventList.value)
    ? fx.wrapEventList.value
    : [];

  const match = events.find(ev => ev.F === homeCode && ev.B === awayCode);
  if (!match) return null;

  for (const market of match.I || []) {
    for (const out of market.R || []) {
      if (out && typeof out.c === 'string' &&
        out.c.trim().toLowerCase() === 'over 1.5' && out.e) {
        return String(out.b);
      }
    }
  }
  return null;
}

// --- NEW: Wait for fixture file at least once ---
async function waitForFixture(timeoutMs = 20000) {
  const start = Date.now();
  while (!fs.existsSync(fixtureFile)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for fixture.json at ${fixtureFile}`);
    }
    console.log("Waiting for fixture.json...");
    await new Promise(res => setTimeout(res, 1000));
  }
  console.log("fixture.json found. Proceeding...");
}

// --- Dismiss popup helper ---
async function dismissPopup(page) {
  const overlaySelector = 'div.dialog-wrapper, div.dialog-mask';
  const tryItSelector = 'text="Try it"';

  try {
    await page.waitForSelector(overlaySelector, { timeout: 5000 });

    if (await page.$(tryItSelector)) {
      await page.click(tryItSelector);
    }

    await page.evaluate(() => {
      document.querySelectorAll('div.dialog-wrapper, div.dialog-mask')
        .forEach(el => el.remove());
    });

    await page.waitForTimeout(5000);

  } catch {
    console.log("No popup detected.");
  }
}

// --- Safe click helper ---
async function safeClick(page, selector, label) {
  try {
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.click(selector, { timeout: 10000 });
  } catch (err) {
    if (err.message.includes('intercepts pointer events')) {
      await dismissPopup(page);
      await page.click(selector);
    } else {
      throw err;
    }
  }
}

// --- Optional click helper ---
async function clickIfExists(page, selector, label, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { timeout });
    await page.click(selector);
    console.log(`Clicked ${label}`);
    return true;
  } catch {
    console.log(`${label} not found, skipping...`);
    return false;
  }
}

// --- Failure counters for recovery ---
let ouTabFailures = 0;
let kickOffFailures = 0;

// --- Refactored main flow ---
async function runFlow(page) {
  try {
    await dismissPopup(page);
    await page.waitForTimeout(2000);

    // Step 1: Try O/U and Near
    const ouTabClicked = await clickIfExists(page, 'li[data-op="iv-market-tabs"]:has-text("O/U")', "O/U tab", 10000);
    const nearClicked = await clickIfExists(page, 'span:has-text("Near")', "Near", 5000);

    if (!ouTabClicked && !nearClicked) {
      console.log("Neither O/U nor Near found â forcing restart...");
      throw new Error("RestartTrigger");
    }

    // Step 2: Always try 0.5 after Near
    await clickIfExists(page, 'div.specifier-select-item:has-text("0.5")', "0.5", 5000);

    // Step 3: Select a random event
    await page.waitForSelector('div.event-list.spacer-market', { timeout: 10000 });
    const events = await page.$$('div.event-list.spacer-market');
    if (!events.length) {
      console.log("No events found, skipping this round.");
      return;
    }

    const maxIndex = Math.min(events.length, 10);
    const randomIndex = Math.floor(Math.random() * maxIndex);
    const chosenEvent = events[randomIndex];

    const outcome = await chosenEvent.$('div[data-op="iv-outcome"]');
    if (outcome) await outcome.click();

    // Place bet
    const bottomContainer = await page.$('div.nav-bottom-container');
    if (bottomContainer) {
      const rightBtn = await bottomContainer.$('div.btn.right');
      if (rightBtn) await rightBtn.click();
      else console.log("'Place Bet' button not found, skipping...");
    } else {
      console.log("'nav-bottom-container' not visible, skipping Place Bet.");
    }

    // Confirm bet
    await clickIfExists(page, '#confirm-btn', "Confirm button", 10000);

    // Kick Off recovery
    const kickOffClicked = await clickIfExists(page, 'span[data-op="iv-openbet-kick-off-button"]', "Kick Off", 20000);
    if (!kickOffClicked && kickOffFailures++ >= 2) {
      await clickIfExists(page, 'span[data-cms-key="open_bets"]', "Open Bets (kick-off recovery)");
      kickOffFailures = 0;
    }

    // Skip to Result
    await clickIfExists(page, 'span[data-op="iv-quick-games-skip-to-result"]', "Skip to Result", 15000);

    // Block win popups
    try {
      await page.evaluate(() => {
        document.querySelectorAll('div.main__bg, #winngin-pop').forEach(el => el.remove());
        const parent = document.querySelector('div.main');
        if (parent) parent.style.display = 'none';
      });
      console.log('Removed popups if any.');
    } catch {}

    // Country tabs
    const countryItems = await page.$$('div.country-subheader li.sport-type-item.m-snap-nav-item');
    for (const item of countryItems) {
      const text = (await item.textContent()).trim();
      if (text !== 'My Events') {
        await item.click();
        await page.waitForTimeout(1500);
      }
    }

    console.log(`All done. Results saved in ${resultFile}, fixture in ${fixtureFile}`);

  } catch (err) {
    if (err.message === "RestartTrigger") throw err;
    console.error("Error during interactions:", err.message);
  }
}

// --- Bootstrap ---
(async () => {
  if (!fs.existsSync(SESSION_FILE)) {
    console.log("No session file found. Running sporty.js to create one...");
    exec('node sporty.js', (err, stdout) => {
      if (err) console.error("Error running sporty.js:", err);
    });
    return;
  }

  const browser = await firefox.launch({ headless: false });
  let context = await browser.newContext({ storageState: SESSION_FILE });
  let page = await context.newPage();

  // --- Attach API listeners before first navigation ---
  page.on('response', async (response) => {
    const url = response.url();

    if (url.includes('/api/ng/instantwin/api/v2/iwqk/event/list_all_with_popular_markets')) {
      try {
        const data = await response.json();
        fs.writeFileSync(fixtureFile, JSON.stringify(data, null, 2));
        fixtureCache = null;
        console.log(`Fixture data saved to ${fixtureFile}`);
      } catch (err) {
        console.error('Error saving fixture response:', err);
      }
    }

    if (url.includes('/api/ng/instantwin/api/v2/iwqk/round/list_settle_events')) {
      try {
        const data = await response.json();
        if (Array.isArray(data)) {
          for (const event of data) {
            const probability = getOver15Probability(event.homeTeamName, event.awayTeamName);
            const resultObj = {
              Team: `${event.homeTeamName} vs ${event.awayTeamName}`,
              scores: `${event.homeTeamScore} - ${event.awayTeamScore}`,
              ...(probability ? { probability } : {}),
              timestamp: new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })
            };
            fs.appendFileSync(resultFile, JSON.stringify(resultObj) + "\n");
          }
          console.log(`Appended ${data.length} compact results to ${resultFile}`);
        }
      } catch (err) {
        console.error('Error parsing result API response:', err);
      }
    }
  });

  // --- Navigation & login check ---
  await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const loginBtn = await page.$('div[data-op="nav-login"]');
  if (loginBtn) {
    console.log("Not logged in. Running sporty.js to refresh session...");
    await browser.close();
    exec('node sporty.js', (err, stdout) => {
      if (err) console.error("Error running sporty.js:", err);
    });
    return;
  }

  console.log("Session valid. Already logged in.");

  // --- Wait until fixture.json appears ---
  let retries = 0;
  while (!fs.existsSync(fixtureFile) && retries < 3) {
    console.log("Waiting for fixture.json (forcing refresh)...");
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    retries++;
  }

  if (!fs.existsSync(fixtureFile)) {
    throw new Error("Failed to capture fixture.json after retries.");
  }

  // --- Auto-shutdown timer (5h25m) ---
  const MAX_RUNTIME_MS = (5 * 60 * 60 * 1000) + (25 * 60 * 1000);
  setTimeout(async () => {
    console.log("Max runtime reached (5h25m). Exiting gracefully...");
    try { await browser.close(); } catch {}
    process.exit(0);
  }, MAX_RUNTIME_MS);

  // --- Main loop with recovery ---
  while (true) {
    try {
      await runFlow(page);
    } catch (err) {
      if (err.message === "RestartTrigger") {
        console.log(" O/U and Near missing forcing restart...");
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(5000);
          continue;
        } catch (reloadErr) {
          console.error(" Reload failed during restart:", reloadErr.message);
        }
      } else {
        console.error(" runFlow failed:", err.message);
      }
    }

    try {
      console.log(" Refreshing page and restarting...");
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
    } catch (err) {
      console.error(" Reload failed, recovering:", err.message);
      try {
        await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (gotoErr) {
        console.error(" Hard fail, restarting browser context:", gotoErr.message);
        context = await browser.newContext({ storageState: SESSION_FILE });
        page = await context.newPage();
        await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
    }
  }
})();
