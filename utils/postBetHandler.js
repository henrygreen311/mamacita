// utils/postBetHandler.js
const fs = require('fs');
const path = require('path');

/**
 * Handles post-bet interactions: Place Bet, Confirm, Kick Off, Skip to Result, and win popups
 * Also listens for settled events API and saves only selbet-matched results
 * @param {object} page - Playwright page instance
 */
async function handlePostBet(page) {
  const fixtureFile = path.join(__dirname, '../fixture.json');
  const selbetFile = path.join(__dirname, '../selbet.txt');
  const resultFile = path.join(__dirname, '../result.json');
  const metricsFile = path.join(__dirname, '../metrics.csv'); // CSV for won/lost

  let placeBetClicked = false;
  let betWon = false; // Track if won

  // Step 0: Click bet-count-wrapper first
  try {
    const countWrapper = await page.waitForSelector('div.bet-count-wrapper', { timeout: 5000 });
    if (countWrapper) await countWrapper.click();
  } catch {}

  // Step 1: #bet-btn <p> selector
  try {
    const betBtnText = await page.waitForSelector('#bet-btn p.main-text:has-text("Place Bet")', { timeout: 10000 });
    if (betBtnText && await betBtnText.isVisible()) {
      await betBtnText.click();
      placeBetClicked = true;
    }
  } catch {}

  // Step 2: nav-bottom-container fallback
  if (!placeBetClicked) {
    try {
      const bottomContainer = await page.waitForSelector('div.nav-bottom-container', { timeout: 10000 });
      if (bottomContainer) {
        const rightBtn = await bottomContainer.$('div.btn.right');
        if (rightBtn && await rightBtn.isVisible()) await rightBtn.click();
      }
    } catch {}
  }

  // Step 3: original fallback
  if (!placeBetClicked) {
    try {
      const bottomContainer2 = await page.waitForSelector('div.nav-bottom-container', { timeout: 10000 });
      if (bottomContainer2) {
        const rightBtn2 = await bottomContainer2.$('div.btn.right');
        if (rightBtn2) await rightBtn2.click();
      }
    } catch {}
  }

  // --- Confirm / Kick Off / Skip ---
  try {
    const confirmContainer = await page.waitForSelector('#confirm-pop__bottom', { timeout: 10000 });
    const confirmBtn = await confirmContainer.$('#confirm-btn');
    if (confirmBtn) await confirmBtn.click();

    const kickOffBtn = await page.waitForSelector('span[data-op="iv-openbet-kick-off-button"]', { timeout: 10000 });
    if (kickOffBtn) await kickOffBtn.click();

    const skipButton = page.locator('span[data-op="iv-quick-games-skip-to-result"]');
    await skipButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    if (await skipButton.evaluate(node => !!node.isConnected)) await skipButton.click();
  } catch {}

  // --- Handle popups (determine Won/Lost) ---
  try {
    const winPopup = await page.$('div.main__bg');
    const newWinPopup = await page.$('#winngin-pop');

    if (winPopup || newWinPopup) {
      betWon = true;
      // Remove popups
      await page.evaluate(() => {
        const popup1 = document.querySelector('div.main__bg');
        if (popup1) popup1.remove();
        const parent = document.querySelector('div.main');
        if (parent) parent.style.display = 'none';

        const popup2 = document.querySelector('#winngin-pop');
        if (popup2) popup2.remove();
      });
    }
  } catch {}

  // --- Append metrics ---
  try {
    const wonStr = betWon ? 'yes' : 'no';
    const lostStr = betWon ? 'no' : 'yes';

    const header = !fs.existsSync(metricsFile) ? 'Won,Lost\n' : '';
    const row = `${wonStr},${lostStr}\n`;

    fs.appendFileSync(metricsFile, header + row);
  } catch {}

  // --- Load selbet.txt ---
  let selBets = [];
  try {
    if (fs.existsSync(selbetFile)) selBets = JSON.parse(fs.readFileSync(selbetFile, 'utf-8'));
  } catch {}

  // --- Attach API listener for settled events ---
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/ng/instantwin/api/v2/iwqk/round/list_settle_events')) return;

    try {
      const data = await response.json();
      if (!Array.isArray(data)) return;

      // Load existing results if any
      let existingResults = [];
      try {
        if (fs.existsSync(resultFile)) existingResults = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
      } catch {}

      const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }); // WAT

      data.forEach(event => {
        const matchingBet = selBets.find(bet => bet.teams === `${event.homeTeamName} vs ${event.awayTeamName}`);
        if (matchingBet) {
          existingResults.push({
            Team: `${event.homeTeamName} vs ${event.awayTeamName}`,
            scores: `${event.homeTeamScore || 0} - ${event.awayTeamScore || 0}`,
            probability: matchingBet.prob || '',
            eventId: event.eventId || '',
            timestamp
          });
        }
      });

      if (existingResults.length > 0) fs.writeFileSync(resultFile, JSON.stringify(existingResults, null, 2));

    } catch {}
  });

  // --- Click country tabs to trigger APIs ---
  try {
    const countryItems = await page.$$('div.country-subheader li.sport-type-item.m-snap-nav-item');
    for (const item of countryItems) {
      const text = (await item.textContent()).trim();
      if (text !== 'My Events') {
        await item.click();
        await page.waitForTimeout(1500);
      }
    }
  } catch {}
}

module.exports = { handlePostBet };
