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
    console.log("No popup detected.");  
  }  
}  
  
// --- Safe click helper ---  
async function safeClick(page, selector, label) {  
  try {  
    await page.waitForSelector(selector, { timeout: 10000 });  
    await page.click(selector, { timeout: 10000 });  
    //console.log(`Clicked ${label}.`);  
  } catch (err) {  
    if (err.message.includes('intercepts pointer events')) {  
      //console.log(`${label} blocked by popup, dismissing...`);  
      await dismissPopup(page);  
      await page.click(selector);  
      //console.log(`Clicked ${label} after dismissing popup.`);  
    } else {  
      throw err;  
    }  
  }  
}  
  
// --- Failure counters for recovery ---  
let ouTabFailures = 0;  
let kickOffFailures = 0;  
  
// --- Main flow (interactions) ---  
async function runFlow(page) {  
  try {  
    await dismissPopup(page);  
  
    // --- Step 1: Try O/U and Near ---  
    const ouTab = await page.locator('li[data-op="iv-market-tabs"]').filter({
  hasText: 'O/U'
}).first();

if (await ouTab.count() > 0) {
  await safeClick(page, 'li[data-op="iv-market-tabs"]:has-text("O/U")', "O/U tab");
  ouTabFailures = 0;
} else {
  ouTabFailures++;
  console.log("O/U tab not found, retrying...");
}  
  
    if (ouTabFailures >= 2) {  
      const nextRoundBtn = await page.$('span[data-op="iv-next-round-button"]');  
      if (nextRoundBtn) {  
        await nextRoundBtn.click();  
        console.log("Clicked Next Round (recovery)");  
        ouTabFailures = 0;  
      } else {  
        const openBetsBtn = await page.$('span[data-cms-key="open_bets"]');  
        if (openBetsBtn) {  
          await openBetsBtn.click();  
          console.log("Clicked Open Bets (recovery)");  
          ouTabFailures = 0;  
        } else {  
          console.log("Neither Next Round nor Open Bets found, refreshing page...");  
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });  
          await page.waitForTimeout(5000);  
          ouTabFailures = 0;  
        }  
      }  
    }  
  
    if (nearBtn) {  
      await safeClick(page, 'span:has-text("Near")', "Near");  
    } else if (!ouTab) {  
      console.log("Neither O/U nor Near found requesting restart...");  
      throw new Error("RestartTrigger");  
    }  
  
    // --- Step 2: Always try 0.5 after Near ---  
    await safeClick(page, 'div.specifier-select-item:has-text("0.5")', "0.5");  
  
    // --- Step 3: Continue normal flow ---  
    await page.waitForSelector('div.event-list.spacer-market', { timeout: 10000 });  
    const events = await page.$$('div.event-list.spacer-market');  
    const maxIndex = Math.min(events.length, 10);  
    const randomIndex = Math.floor(Math.random() * maxIndex);  
    const chosenEvent = events[randomIndex];  
  
    //console.log(`Selected event index: ${randomIndex + 1}`);  
    const outcome = await chosenEvent.$('div[data-op="iv-outcome"]');  
    if (!outcome) throw new Error("No iv-outcome found inside chosen event");  
    await outcome.click();  
    //console.log("Clicked over 1.5");  
  
    // Place bet  
    const placeBetBtn = await page.waitForSelector('div[data-op="IV_betslip_placeBet_cta"]', { timeout: 30000 });
await placeBetBtn.click();
console.log("Clicked the 'Place Bet' button.");
  
    const confirmContainer = await page.waitForSelector('#confirm-pop__bottom', { timeout: 10000 });  
    const confirmBtn = await confirmContainer.$('#confirm-btn');  
    if (confirmBtn) {  
      await confirmBtn.click();  
      console.log("Clicked the 'Confirm' button.");  
    }  
  
    // --- Kick Off recovery logic ---  
    try {  
      const kickOffBtn = await page.waitForSelector('span[data-op="iv-openbet-kick-off-button"]', { timeout: 20000 });  
      if (kickOffBtn) {  
        await kickOffBtn.click();  
        kickOffFailures = 0;  
        //console.log("Clicked the 'Kick Off' button.");  
      }  
    } catch {  
      kickOffFailures++;  
      console.warn(`Kick Off button failed, attempt ${kickOffFailures}`);  
      if (kickOffFailures >= 2) {  
        const openBetsBtn = await page.$('span[data-cms-key="open_bets"]');  
        if (openBetsBtn) {  
          await openBetsBtn.click();  
          console.log("Clicked Open Bets (kick-off recovery)");  
          kickOffFailures = 0;  
          try {  
            const kickOffBtnRetry = await page.waitForSelector('span[data-op="iv-openbet-kick-off-button"]', { timeout: 20000 });  
            if (kickOffBtnRetry) await kickOffBtnRetry.click();  
          } catch {  
            console.warn("Kick Off still not found after Open Bets, refreshing page");  
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });  
            await page.waitForTimeout(5000);  
          }  
        } else {  
          console.warn("Open Bets not found, refreshing page...");  
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });  
          await page.waitForTimeout(5000);  
        }  
      }  
    }  
  
    // Skip to result  
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
      console.log('Error checking or blocking popups:', err);  
    }  
  
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
    if (err.message === "RestartTrigger") {  
      throw err; // bubble up for restart handling in main loop  
    }  
    console.error("Error during interactions:", err);  
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
