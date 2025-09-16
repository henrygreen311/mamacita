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
      
  while (true) {        
    try {        
      await page.waitForSelector(overlaySelector, { timeout: 5000 });        
      
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
}        
      
// --- Attach fixture listener (reset each cycle) ---        
function attachFixtureListener(page) {        
  page.removeAllListeners('response');        
  page.on('response', async (response) => {        
    const url = response.url();        
    if (url.includes('/api/ng/instantwin/api/v2/iwqk/event/list_all_with_popular_markets')) {        
      try {        
        const data = await response.json();        
        fs.writeFileSync(fixtureFile, JSON.stringify(data, null, 2));        
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
      
  await handlePostBet(page);        
}        
      
// --- Main orchestration ---        
(async () => {        
  const shouldExit = await checkLossStreak();        
  if (shouldExit) {        
    console.log("Exiting early due to 3 consecutive losses in Metrics.");        
    process.exit(0);        
  }        
      
  const browser = await firefox.launch({ headless: false });        
  const context = await browser.newContext({ storageState: SESSION_FILE });        
  const page = await context.newPage();        
      
  attachFixtureListener(page);        
  await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });        
      
  // --- Loop for 5 min ---        
  const runDuration = 55 * 60 * 1000; // 50 min in ms        
  const endTime = Date.now() + runDuration;        
  let isFirstRun = true;        
      
  async function main() {        
    while (Date.now() < endTime) {        
      await runBetCycle(page, isFirstRun);        
      isFirstRun = false;        
      
      //  Hard cutoff after each cycle        
      if (Date.now() >= endTime) break;        
      
      console.log("Page got refresh for next bet");        
      await page.goto(CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });        
      attachFixtureListener(page);        
    }        
      
    console.log("5 min elapsed. Closing browser.");        
    await browser.close();        
    process.exit(0);        
  }        
      
  // Global hard timeout guard        
  setTimeout(async () => {        
    console.log("5 min hard timeout reached. Closing browser.");        
    await browser.close();        
    process.exit(0);        
  }, runDuration);        
      
  // run it        
  main().catch(err => {        
    console.error("Fatal error in main loop:", err);        
    process.exit(1);        
  });        
})();
