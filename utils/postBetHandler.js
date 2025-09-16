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

  /**
   * Utility: normalize strings for tolerant matching (strip diacritics, non-word chars, lowercase)
   */
  const normalize = (s) => {
    if (!s && s !== 0) return '';
    try {
      return String(s)
        .normalize('NFKD') // decompose accents
        .replace(/[\u0300-\u036f]/g, '') // remove accents
        .replace(/[^a-zA-Z0-9\s]/g, ' ') // replace non-alphanum with space
        .replace(/\s+/g, ' ') // collapse spaces
        .trim()
        .toLowerCase();
    } catch (err) {
      return String(s).toLowerCase();
    }
  };

  /**
   * Check if selBet teams string matches the event home/away tolerant to separators and ordering.
   */
  const teamsMatch = (selTeamsRaw, homeRaw, awayRaw) => {
    const sel = normalize(selTeamsRaw);
    const home = normalize(homeRaw);
    const away = normalize(awayRaw);

    if (!home || !away) return false;

    // direct canonical form comparisons
    const formsToCheck = [
      `${home} vs ${away}`,
      `${home} - ${away}`,
      `${home} v ${away}`,
      `${away} vs ${home}`,
      `${away} - ${home}`,
      `${away} v ${home}`,
    ].map(normalize);

    if (formsToCheck.includes(sel)) return true;

    // if sel contains both team names (any order)
    const containsBoth = sel.includes(home) && sel.includes(away);
    if (containsBoth) return true;

    // fallback: if sel == either single team (rare), don't match
    return false;
  };

  // --- Load selbet.txt into memory (tolerant parse) ---
  let selBets = [];
  try {
    if (fs.existsSync(selbetFile)) {
      const raw = fs.readFileSync(selbetFile, 'utf-8').trim();
      if (raw) {
        // selbet.txt might contain JSON array or newline-delimited JSON -> try parse robustly
        try {
          selBets = JSON.parse(raw);
        } catch (e) {
          // try to parse as NDJSON or line-delimited JSON
          const lines = raw.split(/\r?\n/).filter(Boolean);
          if (lines.length === 1) {
            try { selBets = JSON.parse(lines[0]); } catch { selBets = []; }
          } else {
            selBets = lines.map(l => {
              try { return JSON.parse(l); } catch { return null; }
            }).filter(Boolean);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error loading selbet file:', err);
    selBets = [];
  }

  // --- Attach API listener for settled events (robust extraction & matching) ---
  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (!url.includes('/api/ng/instantwin/api/v2/iwqk/round/list_settle_events')) return;

      let data;
      try {
        data = await response.json();
      } catch (err) {
        // response may not be JSON or already consumed
        console.error('Failed parsing response JSON for settled events:', err);
        return;
      }

      // Helper: recursively find candidate event arrays in response object
      const extractEventArrays = (obj, depth = 0) => {
        if (!obj || depth > 6) return [];
        if (Array.isArray(obj)) {
          // heuristics: an event element likely contains homeTeamName or similar
          const first = obj[0] || {};
          const keys = Object.keys(first).map(k => k.toLowerCase());
          if (Array.isArray(obj) && (keys.includes('hometeamname') || keys.includes('home_team_name') || keys.includes('eventid') || keys.includes('home'))) {
            return [obj];
          }
          // possibly array of something else - still return as fallback
          return [obj];
        } else if (typeof obj === 'object') {
          let found = [];
          for (const k of Object.keys(obj)) {
            found = found.concat(extractEventArrays(obj[k], depth + 1));
          }
          return found;
        }
        return [];
      };

      const candidateArrays = extractEventArrays(data);
      if (!candidateArrays.length) return;

      // pick the most promising candidate array: with elements having hometeamname or eventId
      let events = null;
      for (const arr of candidateArrays) {
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const firstKeys = Object.keys(arr[0] || {}).map(k => k.toLowerCase());
        if (firstKeys.includes('hometeamname') || firstKeys.includes('home_team_name') || firstKeys.includes('eventid') || firstKeys.includes('home')) {
          events = arr;
          break;
        }
      }
      if (!events) events = candidateArrays[0]; // fallback

      if (!Array.isArray(events) || events.length === 0) return;

      // Load existing results from disk (if any)
      let existingResults = [];
      try {
        if (fs.existsSync(resultFile)) {
          const raw = fs.readFileSync(resultFile, 'utf-8').trim();
          existingResults = raw ? JSON.parse(raw) : [];
        }
      } catch (err) {
        console.error('Failed loading existing results.json, will start fresh:', err);
        existingResults = [];
      }

      // Use a Set to avoid duplicates by eventId or Team+timestamp combo
      const existingEventIds = new Set(existingResults.map(r => String(r.eventId || '').trim()).filter(Boolean));
      const existingTeamScoreKeys = new Set(existingResults.map(r => `${r.Team}|${r.scores}`).filter(Boolean));

      const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }); // WAT
      let newAdded = false;

      for (const event of events) {
        // normalize field names possibilities
        const homeTeamName = event.homeTeamName || event.home_team_name || event.home || event.homeTeam || '';
        const awayTeamName = event.awayTeamName || event.away_team_name || event.away || event.awayTeam || '';
        const homeScore = (event.homeTeamScore !== undefined) ? event.homeTeamScore : (event.homeScore !== undefined ? event.homeScore : (event.home_score || 0));
        const awayScore = (event.awayTeamScore !== undefined) ? event.awayTeamScore : (event.awayScore !== undefined ? event.awayScore : (event.away_score || 0));
        const eventId = event.eventId || event.event_id || event.id || '';

        if (!homeTeamName || !awayTeamName) continue; // skip incomplete event objects

        // Try to find a matching selBet
        const matchingBet = selBets.find(bet => {
          // eventId match has highest priority
          if (bet.eventId && eventId && String(bet.eventId) === String(eventId)) return true;

          // try matching by teams string
          if (bet.teams && teamsMatch(bet.teams, homeTeamName, awayTeamName)) return true;

          // maybe selbet stored as an object with home/away fields
          if (bet.home && bet.away) {
            if (teamsMatch(`${bet.home} vs ${bet.away}`, homeTeamName, awayTeamName)) return true;
            if (teamsMatch(`${bet.away} vs ${bet.home}`, homeTeamName, awayTeamName)) return true;
          }

          // fallback: check if sel bet string contains both team name tokens
          if (bet.teams) {
            const s = normalize(bet.teams);
            const h = normalize(homeTeamName);
            const a = normalize(awayTeamName);
            if (s.includes(h) && s.includes(a)) return true;
          }

          return false;
        });

        if (matchingBet) {
          // avoid duplicates
          if (eventId && existingEventIds.has(String(eventId))) continue;

          const teamKey = `${homeTeamName} vs ${awayTeamName}`;
          const scoreStr = `${homeScore || 0} - ${awayScore || 0}`;
          if (existingTeamScoreKeys.has(`${teamKey}|${scoreStr}`)) continue;

          existingResults.push({
            Team: teamKey,
            scores: scoreStr,
            probability: matchingBet.prob || matchingBet.probability || matchingBet.p || '',
            eventId: eventId || '',
            timestamp
          });

          if (eventId) existingEventIds.add(String(eventId));
          existingTeamScoreKeys.add(`${teamKey}|${scoreStr}`);
          newAdded = true;
        }
      } // end events loop

      if (newAdded) {
        try {
          fs.writeFileSync(resultFile, JSON.stringify(existingResults, null, 2));
        } catch (err) {
          console.error('Failed writing result.json:', err);
        }
      }
    } catch (err) {
      console.error('Unhandled error in response handler:', err);
    }
  }); // end page.on(response)

  // ---- Interaction sequence: place bet -> confirm -> kick off -> skip ----
  let placeBetClicked = false;

  // Step 0: Click bet-count-wrapper if present
  try {
    const countWrapper = await page.waitForSelector('div.bet-count-wrapper', { timeout: 5000 }).catch(() => null);
    if (countWrapper) {
      try { await countWrapper.click({ timeout: 3000 }); } catch {}
    }
  } catch (err) {
    // ignore
  }

  // Step 1: #bet-btn <p> selector
  try {
    const betBtnText = await page.waitForSelector('#bet-btn p.main-text:has-text("Place Bet")', { timeout: 10000 }).catch(() => null);
    if (betBtnText && await betBtnText.isVisible()) {
      await betBtnText.click().catch(() => {});
      placeBetClicked = true;
    }
  } catch (err) {}

  // Step 2: nav-bottom-container fallback (first)
  if (!placeBetClicked) {
    try {
      const bottomContainer = await page.waitForSelector('div.nav-bottom-container', { timeout: 10000 }).catch(() => null);
      if (bottomContainer) {
        const rightBtn = await bottomContainer.$('div.btn.right');
        if (rightBtn && await rightBtn.isVisible()) {
          await rightBtn.click().catch(() => {});
          placeBetClicked = true;
        }
      }
    } catch (err) {}
  }

  // Step 3: original fallback (redundant but kept for compatibility)
  if (!placeBetClicked) {
    try {
      const bottomContainer2 = await page.waitForSelector('div.nav-bottom-container', { timeout: 10000 }).catch(() => null);
      if (bottomContainer2) {
        const rightBtn2 = await bottomContainer2.$('div.btn.right');
        if (rightBtn2) {
          await rightBtn2.click().catch(() => {});
          placeBetClicked = true;
        }
      }
    } catch (err) {}
  }

  // --- Confirm / Kick Off / Skip ---
  try {
    const confirmContainer = await page.waitForSelector('#confirm-pop__bottom', { timeout: 10000 }).catch(() => null);
    if (confirmContainer) {
      const confirmBtn = await confirmContainer.$('#confirm-btn');
      if (confirmBtn) await confirmBtn.click().catch(() => {});
    }

    const kickOffBtn = await page.waitForSelector('span[data-op="iv-openbet-kick-off-button"]', { timeout: 10000 }).catch(() => null);
    if (kickOffBtn) {
      await kickOffBtn.click().catch(() => {});
    }

    const skipButton = page.locator('span[data-op="iv-quick-games-skip-to-result"]');
    try {
      await skipButton.waitFor({ state: 'visible', timeout: 15000 });
      // ensure DOM node still attached and clickable
      const isConnected = await skipButton.evaluate(node => !!node.isConnected).catch(() => false);
      if (isConnected) await skipButton.click().catch(() => {});
    } catch (err) {
      // skip not visible - continue
    }
  } catch (err) {
    console.error('Error during confirm/kickoff/skip sequence:', err);
  }

  // --- Handle popups (determine Won/Lost) ---
  let betWon = false;
  try {
    // Wait for a win popup OR timeout. If win popup appears within timeout, mark won.
    // Use combined selector to detect commonly used win popups.
    const WIN_SELECTOR = 'div.main__bg, #winngin-pop';

    // Wait up to 10s for a win popup to appear. If none appears, assume not won.
    const el = await page.waitForSelector(WIN_SELECTOR, { timeout: 10000 }).catch(() => null);
    if (el) {
      betWon = true;
      // Remove popups from DOM to keep UI tidy
      try {
        await page.evaluate(() => {
          const popup1 = document.querySelector('div.main__bg');
          if (popup1) popup1.remove();
          const parent = document.querySelector('div.main');
          if (parent) parent.style.display = 'none';

          const popup2 = document.querySelector('#winngin-pop');
          if (popup2) popup2.remove();
        });
      } catch (err) {
        // ignore DOM manipulation errors
      }
    } else {
      betWon = false;
    }
  } catch (err) {
    console.error('Popup detection error:', err);
    betWon = false;
  }

  // --- Append metrics (atomic and deterministic) ---
  try {
    const wonStr = betWon ? 'yes' : 'no';
    const lostStr = betWon ? 'no' : 'yes';
    const headerNeeded = !fs.existsSync(metricsFile);

    // Ensure header is written only once
    if (headerNeeded) {
      fs.appendFileSync(metricsFile, 'Won,Lost\n');
    }
    const row = `${wonStr},${lostStr}\n`;
    fs.appendFileSync(metricsFile, row);
  } catch (err) {
    console.error('Failed to append metrics:', err);
  }

  // --- Click country tabs to trigger APIs (unchanged logic) ---
  try {
    const countryItems = await page.$$('div.country-subheader li.sport-type-item.m-snap-nav-item');
    for (const item of countryItems) {
      try {
        const text = (await item.textContent()).trim();
        if (text !== 'My Events') {
          await item.click().catch(() => {});
          await page.waitForTimeout(1500);
        }
      } catch (err) {
        // continue with next
      }
    }
  } catch (err) {
    // ignore
  }
}

module.exports = { handlePostBet };