const { safeClick } = require("../utils/safeClick");
const { loadTeamMapping } = require("../utils/teamMapping");

/**
 * Runs the X1_X2 bet selection mechanism
 * @param {object} page - Playwright page instance
 * @param {object} bet - Bet object from selbet.txt
 * @param {string} [teamFile='team.txt'] - Optional path to team mapping file
 */
async function runX1X2(page, bet, teamFile = 'team.txt') {
  if (!bet) {
    console.log("[X1_X2] No bet provided, skipping...");
    return;
  }

  const mapping = loadTeamMapping(teamFile);
  const leagueName = mapping[bet.G] || "Unknown";
  console.log(`[X1_X2] Bet found: ${bet.teams}, League: ${leagueName}, G=${bet.G}`);

  const leagueIndexes = {
    England: 1,
    Spain: 2,
    Germany: 3,
    Champions: 4,
    Italy: 5,
    "African cup": 6,
    Euros: 7,
    "Club world cup": 8
  };
  const leagueIndex = leagueIndexes[leagueName] || 1;

  // --- Market navigation ---
  await safeClick(page, 'li[data-op="iv-market-tabs"]:has-text("Double Chance")', "Double Chance tab");

  // --- Find team row ---
  const teamColumn = await page.$('div.m-table-cell.table-team-column');
  if (!teamColumn) {
    console.error("[X1_X2] Team column not found.");
    return;
  }

  const leagueDivs = await teamColumn.$$('div.m-table');
  const leagueDiv = leagueDivs[leagueIndex - 1];
  if (!leagueDiv) {
    console.error(`[X1_X2] League div not found for ${leagueName}`);
    return;
  }

  const eventTeams = await leagueDiv.$$('.event-list.spacer-team');
  let matchIndex = -1;
  const [homeExpected, awayExpected] = bet.teams.split(" vs ").map(s => s.trim());

  for (let i = 0; i < eventTeams.length; i++) {
    const spans = await eventTeams[i].$$('div[data-op="iv-team-name"] span');
    const home = spans[0] ? (await spans[0].innerText()).trim() : "";
    const away = spans[1] ? (await spans[1].innerText()).trim() : "";

    if (home === homeExpected && away === awayExpected) {
      matchIndex = i;
      console.log(`[X1_X2] Match found at row ${i + 1}: ${home} vs ${away}`);
      break;
    }
  }

  if (matchIndex === -1) {
    console.error(`[X1_X2] Match ${bet.teams} not found in league ${leagueName}`);
    return;
  }

  // --- Find market outcome ---
  const marketColumn = await page.$('div.m-table-cell.table-market-outcome-column');
  if (!marketColumn) {
    console.error("[X1_X2] Market column not found.");
    return;
  }

  const marketLeagueDivs = await marketColumn.$$('div.m-table');
  const marketLeagueDiv = marketLeagueDivs[leagueIndex - 1];
  if (!marketLeagueDiv) {
    console.error(`[X1_X2] Market league div not found for ${leagueName}`);
    return;
  }

  const eventMarkets = await marketLeagueDiv.$$('.event-list.spacer-market');
  const marketRow = eventMarkets[matchIndex];
  if (!marketRow) {
    console.error(`[X1_X2] Market row not found at index ${matchIndex + 1}.`);
    return;
  }

  const outcomes = await marketRow.$$('div.iw-outcome');

  if (bet.pick === "X1") {
    if (outcomes.length > 0 && await outcomes[0].$('span')) {
      await outcomes[0].click();
      console.log(`[X1_X2] Clicked X1 outcome for ${bet.teams}`);
    } else {
      console.error("[X1_X2] Not enough outcomes found for X1 or missing span.");
    }
  } else if (bet.pick === "X2") {
    if (outcomes.length > 2 && await outcomes[2].$('span')) {
      await outcomes[2].click();
      console.log(`[X1_X2] Clicked X2 outcome for ${bet.teams}`);
    } else {
      console.error("[X1_X2] Not enough outcomes found for X2 or missing span.");
    }
  } else {
    // Default: second outcome
    if (outcomes.length > 1 && await outcomes[1].$('span')) {
      await outcomes[1].click();
      console.log(`[X1_X2] Clicked default outcome for ${bet.teams}`);
    } else {
      console.error("[X1_X2] Not enough outcomes found for default outcome or missing span.");
    }
  }
}

module.exports = { runX1X2 };