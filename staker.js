const { firefox } = require('playwright');
const fs = require('fs');
const { selectBets } = require('./utils/betSelector');
const { loadTeamMapping } = require('./utils/teamMapping');
const { safeClick } = require('./utils/safeClick');
const { handlePostBet } = require('./utils/postBetHandler');

// Mechanisms
const over15 = require('./mechanisms/over15');
const x1x2 = require('./mechanisms/x1x2');
const bts = require('./mechanisms/bts');

// --- Metrics check before anything runs ---
const { checkLossStreak } = require('./utils/Metrics');

// File paths
const SESSION_FILE = 'session.json';
const CHECK_URL = 'https://www.sportybet.com/ng/m/instant-virtuals/quickgame';
const fixtureFile = 'fixture.json';
const statsFile = 'stats.json';
const selBetFile = 'selbet.txt';

// --- Initial popup dismissal (first run only) ---
async function dismissInitialPopup(page) {
  const overlaySelector = 'div.dialog-wrapper, div.dialog-mask';
  const tryItSelector = 'text="Try it"';

  //console.log("Waiting for initial popup to appear...");
  while (true) {
    try {
      await page.waitForSelector(overlaySelector, { timeout: 5000 });
      //console.log("Popup detected. Removing overlay...");

      if (await page.$(tryItSelector)) {
        await page.click(tryItSelector);
        console.log('Clicked "Try it" button.');
      }

      await page.evaluate(() => {
        document.querySelectorAll('div.dialog-wrapper, div.dialog-mask').forEach(el => el.remove());
      });

      console.log("Popup removed.");
      break;
    } catch {
      await page.waitForTimeout(2000); // retry loop
    }
  }
}

// --- Force dismiss ANY popup (subsequent runs) ---
async function forceDismissPopup(page) {
  try {
    //console.log("Waiting 10s to allow random popup to show...");
    await page.waitForTimeout(10000);

    const popupSelector = 'div.dialog-wrapper, div.dialog-mask';
    const found = await page.$$(popupSelector);
    if (found.length > 0) {
      await page.evaluate(() => {
        document.querySelectorAll('div.dialog-wrapper, div.dialog-mask').forEach(el => el.remove());
      });
      console.log("Random popup removed.");
    } else {
      console.log("No random popup found after 10s.");
    }
  } catch (err) {
    console.error("Error while force dismissing popup:", err);
  }
}

// --- Wait for fixture.json ---
async function waitForFixture() {
  while (!fs.existsSync(fixtureFile)) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.log('Fixture.json detected.');
}

// --- Attach fixture listener (reset each cycle) ---
function attachFixtureListener(page) {
  page.removeAllListeners('response'); // clear old listeners
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/ng/instantwin/api/v2/iwqk/event/list_all_with_popular_markets')) {
      try {
        const data = await response.json();
        fs.writeFileSync(fixtureFile, JSON.stringify(data, null, 2));
        //console.log(`Fixture data saved to ${fixtureFile}`);
      } catch (err) {
        console.error('Error saving fixture response:', err);
      }
    }
  });
}

// --- Run one betting cycle ---
async function runBetCycle(page, isFirstRun = false) {
  if (isFirstRun) {
    await dismissInitialPopup(page);
  } else {
    await forceDismissPopup(page);
  }

  // --- Main loop: wait for fixture & select bets ---
  while (true) {
    await waitForFixture();

    const bets = selectBets(fixtureFile, statsFile);

    if (bets.length > 0) {
      fs.writeFileSync(selBetFile, JSON.stringify(bets, null, 2));
      console.log('Yoo! i found bets');
      break;
    }

    const nextBtn = await page.$('span[data-op="iv-next-round-button"]');
    if (nextBtn) {
      await nextBtn.click();
      console.log('SHIT! nothing found here, Tapped next round.');
      await page.waitForTimeout(10000);
    } else {
      console.log('Next Round button not found. Waiting 7s...');
      await page.waitForTimeout(7000);
    }
  }

  // --- Run mechanisms after bet selection ---
  const betsToProcess = JSON.parse(fs.readFileSync(selBetFile, 'utf-8'));

  for (const bet of betsToProcess) {
    console.log(`Processing bet: ${bet.teams} [${bet.category}]`);
    switch (bet.category.toLowerCase()) {
      case 'over_1.5':
        await over15(page, bet);
        break;
      case 'x1_x2':
        await x1x2(page, bet);
        break;
      case 'both_teams_score':
        await bts(page, bet);
        break;
      default:
        console.warn(`Unsupported category: ${bet.category}`);
    }
  }

  // Step 2: post-bet actions
  await handlePostBet(page);
}

// --- Main orchestration ---
(async () => {
  // Run Metrics check first
  const shouldExit = await checkLossStreak();
  if (shouldExit) {
    console.log("Exiting early due to 3 consecutive losses in Metrics.");
    process.exit(0);
  }

  const browser = await firefox.launch({ headless: false });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();

  // Initial fixture listener
  attachFixtureListener(page);

  await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // --- Loop for 5h30m ---
  const runDuration = 55 * 60 * 1000; // 5h 30m in ms
  const endTime = Date.now() + runDuration;
  let isFirstRun = true;

  while (Date.now() < endTime) {
    //console.log(`Starting betting cycle. Time left: ${(endTime - Date.now()) / 60000} min`);

    await runBetCycle(page, isFirstRun);
    isFirstRun = false;

    // Refresh page before next cycle
    console.log("Page got refresh for next bet😎");
    await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Reset fixture listener each cycle to avoid stale data
    attachFixtureListener(page);
  }

  console.log("5h 30m elapsed. Closing browser.");
  await browser.close();
  process.exit(0);
})();
