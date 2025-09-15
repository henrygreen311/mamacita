const { safeClick } = require("../utils/safeClick");
const { loadTeamMapping } = require("../utils/teamMapping");

/**
 * Runs the Both Teams Score (BTS) mechanism
 * @param {object} page - Playwright page instance
 * @param {object} bet - Bet object from selbet.txt
 * @param {string} [teamFile='team.txt'] - Optional path to team mapping file
 */
async function runBTS(page, bet, teamFile = 'team.txt') {
  if (!bet) {
    console.log("[BTS] No bet provided, skipping...");
    return;
  }

  const mapping = loadTeamMapping(teamFile);
  const leagueName = mapping[bet.G] || "Unknown";
  console.log(`[BTS] Bet found: ${bet.teams}, League: ${leagueName}, G=${bet.G}`);

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
  await safeClick(page, 'li[data-op="iv-market-tabs"]:has-text("GG/NG")', "GG/NG tab");

  // --- Find team row ---
  const teamColumn = await page.$('div.m-table-cell.table-team-column');
  if (!teamColumn) {
    console.error("[BTS] Team column not found.");
    return;
  }

  const leagueDivs = await teamColumn.$$('div.m-table');
  const leagueDiv = leagueDivs[leagueIndex - 1];
  if (!leagueDiv) {
    console.error(`[BTS] League div not found for ${leagueName}`);
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
      console.log(`[BTS] Match found at row ${i + 1}: ${home} vs ${away}`);
      break;
    }
  }

  if (matchIndex === -1) {
    console.error(`[BTS] Match ${bet.teams} not found in league ${leagueName}`);
    return;
  }

  // --- Find market outcome ---
  const marketColumn = await page.$('div.m-table-cell.table-market-outcome-column');
  if (!marketColumn) {
    console.error("[BTS] Market column not found.");
    return;
  }

  const marketLeagueDivs = await marketColumn.$$('div.m-table');
  const marketLeagueDiv = marketLeagueDivs[leagueIndex - 1];
  if (!marketLeagueDiv) {
    console.error(`[BTS] Market league div not found for ${leagueName}`);
    return;
  }

  const eventMarkets = await marketLeagueDiv.$$('.event-list.spacer-market');
  const marketRow = eventMarkets[matchIndex];
  if (!marketRow) {
    console.error(`[BTS] Market row not found at index ${matchIndex + 1}.`);
    return;
  }

  const outcomes = await marketRow.$$('div.iw-outcome');
  if (outcomes.length > 0) {
    const span = await outcomes[0].$('span');
    if (span) {
      await outcomes[0].click();
      console.log(`[BTS] Clicked outcome for ${bet.teams}`);
    } else {
      console.error("[BTS] Outcome[0] has no span inside, not clicking.");
    }
  } else {
    console.error("[BTS] Not enough outcomes found.");
  }
}

module.exports = { runBTS };