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
  const events = fx.wrapEventList && Array.isArray(fx.wrapEventList.value) ? fx.wrapEventList.value : [];
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

// --- Dismiss popup helper ---
async function dismissPopup(page) {
  const overlaySelector = 'div.dialog-wrapper, div.dialog-mask';
  const tryItSelector = 'text="Try it"';
  try {
    await page.waitForSelector(overlaySelector, { timeout: 5000 });
    //console.log("Popup detected. Removing overlay...");
    if (await page.$(tryItSelector)) {
      await page.click(tryItSelector);
      //console.log('Clicked "Try it" button.');
    }
    await page.evaluate(() => {
      document.querySelectorAll('div.dialog-wrapper, div.dialog-mask')
        .forEach(el => el.remove());
    });
    //console.log("Popup removed.");
    await page.waitForTimeout(5000);
  } catch {
    //console.log("No popup detected.");
  }
}

// --- Safe click helper (skip after retries) ---
async function safeClick(page, selector, label) {
  let attempts = 0;
  while (attempts < 3) {
    try {
      await page.waitForSelector(selector, { timeout: 15000 });

      // Always clear popups before clicking
      await dismissPopup(page);

      // Use force: true only on the last attempt
      await page.click(selector, { timeout: 5000, force: attempts === 2 });
      console.log(`Clicked ${label}.`);
      return true; // success
    } catch (err) {
      attempts++;
      console.warn(`Failed to click ${label}, attempt ${attempts}: ${err.message}`);

      if (err.message.includes('intercepts pointer events')) {
        console.log(`${label} blocked by popup, dismissing again...`);
        await dismissPopup(page);
      } else {
        console.log(`Retrying ${label} after page reload...`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);
      }
    }
  }

  console.error(`Skipping ${label} after ${attempts} failed attempts.`);
  return false;
}

// --- Main flow ---
async function runFlow(page) {
  try {
    await dismissPopup(page);

    // Market navigation
    if (!(await safeClick(page, 'li[data-op="iv-market-tabs"]:has-text("O/U")', "O/U tab"))) return;
    if (!(await safeClick(page, 'span:has-text("Near")', "Near"))) return;
    if (!(await safeClick(page, 'div.specifier-select-item:has-text("1.5")', "1.5"))) return;

    // Events
    let events = [];
    try {
      await page.waitForSelector('div.event-list.spacer-market', { timeout: 10000 });
      events = await page.$$('div.event-list.spacer-market');
    } catch {
      console.log("No events found, skipping flow.");
      return;
    }

    const maxIndex = Math.min(events.length, 10);
    if (maxIndex === 0) {
      console.log("No events available, skipping.");
      return;
    }

    const chosenEvent = events[Math.floor(Math.random() * maxIndex)];
    const outcome = await chosenEvent.$('div[data-op="iv-outcome"]');
    if (!outcome) {
      console.log("No outcome found, skipping bet.");
      return;
    }
    await outcome.click();
    //console.log("Clicked over 1.5 outcome.");

    // Place Bet
    const bottomContainer = await page.waitForSelector('div.nav-bottom-container', { timeout: 10000 }).catch(() => null);
    if (bottomContainer) {
      const rightBtn = await bottomContainer.$('div.btn.right');
      if (rightBtn) {
        await rightBtn.click();
        //console.log("Clicked the 'Place Bet' button.");
      }
    }

    // Confirm
    const confirmContainer = await page.waitForSelector('#confirm-pop__bottom', { timeout: 10000 }).catch(() => null);
    if (confirmContainer) {
      const confirmBtn = await confirmContainer.$('#confirm-btn');
      if (confirmBtn) {
        await confirmBtn.click();
        console.log("Clicked the 'Confirm' button.");
      }
    }

    // Kick Off
    const kickOffBtn = await page.waitForSelector('span[data-op="iv-openbet-kick-off-button"]', { timeout: 10000 }).catch(() => null);
    if (kickOffBtn) {
      await kickOffBtn.click();
      //console.log("Clicked the 'Kick Off' button.");
    }

    // Skip to Result
    try {
      const skipButton = page.locator('span[data-op="iv-quick-games-skip-to-result"]');
      await skipButton.waitFor({ state: 'visible', timeout: 15000 });
      if (await skipButton.evaluate(node => !!node.isConnected)) {
        await skipButton.click();
        //console.log('Clicked Skip to Result button.');
      }
    } catch {
      console.log('Skip to Result button not found, continuing...');
    }

    // Handle popups
    try {
      const winPopup = await page.$('div.main__bg');
      if (winPopup) {
        await page.evaluate(() => {
          const popup = document.querySelector('div.main__bg');
          if (popup) popup.remove();
          const parent = document.querySelector('div.main');
          if (parent) parent.style.display = 'none';
        });
        console.log('Blocked "YOU WON" popup.');
      }
      const newWinPopup = await page.$('#winngin-pop');
      if (newWinPopup) {
        await page.evaluate(() => {
          const popup = document.querySelector('#winngin-pop');
          if (popup) popup.remove();
        });
        //console.log('Blocked "winngin-pop" popup.');
      }
    } catch (err) {
      console.log('Error checking or blocking popups:', err.message);
    }

    // Cycle country tabs
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
    console.error("Error during interactions:", err.message);
  }
}

// --- Bootstrap ---
(async () => {
  if (!fs.existsSync(SESSION_FILE)) {
    console.log("No session file found. Running sporty.js to create one...");
    exec('node sporty.js', (err, stdout) => {
      if (err) console.error("Error running sporty.js:", err);
      else console.log(stdout);
    });
    return;
  }

  const browser = await firefox.launch({ headless: true });
  let context = await browser.newContext({ storageState: SESSION_FILE });
  let page = await context.newPage();

  // Attach API listeners before navigation
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/event/list_all_with_popular_markets')) {
      try {
        const data = await response.json();
        fs.writeFileSync(fixtureFile, JSON.stringify(data, null, 2));
        fixtureCache = null;
      } catch (err) {
        console.error('Error saving fixture response:', err);
      }
    }
    if (url.includes('/round/list_settle_events')) {
      try {
        const data = await response.json();
        if (Array.isArray(data)) {
          let savedResults = [];
          if (fs.existsSync(resultFile)) {
            try { savedResults = JSON.parse(fs.readFileSync(resultFile, 'utf-8')); } catch {}
          }
          let updated = false;
          for (const event of data) {
            const homeScore = parseInt(event.homeTeamScore, 10) || 0;
            const awayScore = parseInt(event.awayTeamScore, 10) || 0;
            if (homeScore + awayScore >= 2) {
              const probability = getOver15Probability(event.homeTeamName, event.awayTeamName);
              const resultObj = {
                homeTeamName: event.homeTeamName,
                awayTeamName: event.awayTeamName,
                homeTeamScore: String(event.homeTeamScore),
                awayTeamScore: String(event.awayTeamScore),
                ...(probability ? { probability } : {})
              };
              const exists = savedResults.some(r =>
                r.homeTeamName === resultObj.homeTeamName &&
                r.awayTeamName === resultObj.awayTeamName &&
                r.homeTeamScore === resultObj.homeTeamScore &&
                r.awayTeamScore === resultObj.awayTeamScore
              );
              if (!exists) {
                savedResults.push(resultObj);
                updated = true;
              }
            }
          }
          if (updated) fs.writeFileSync(resultFile, JSON.stringify(savedResults, null, 2));
        }
      } catch (err) {
        console.error('Error parsing result API response:', err);
      }
    }
  });

  await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  if (await page.$('div[data-op="nav-login"]')) {
    console.log("Not logged in. Running sporty.js to refresh session...");
    await browser.close();
    exec('node sporty.js', (err, stdout) => {
      if (err) console.error("Error running sporty.js:", err);
      else console.log(stdout);
    });
    return;
  }

  console.log("Session valid. Already logged in.");

  // Ensure fixture.json exists
  let retries = 0;
  while (!fs.existsSync(fixtureFile) && retries < 3) {
    console.log("Waiting for fixture.json (forcing refresh)...");
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    retries++;
  }
  if (!fs.existsSync(fixtureFile)) throw new Error("Failed to capture fixture.json after retries.");

  // Loop forever
  while (true) {
    try {
      await runFlow(page);
    } catch (err) {
      console.error("runFlow failed:", err.message);
    }

    try {
      console.log("Refreshing page and restarting...");
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
    } catch (err) {
      console.error("Reload failed, recovering:", err.message);
      try {
        await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (gotoErr) {
        console.error("Hard fail, restarting browser context:", gotoErr.message);
        context = await browser.newContext({ storageState: SESSION_FILE });
        page = await context.newPage();
        await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
    }
  }
})();
