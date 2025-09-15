const { safeClick } = require('../utils/safeClick');
const { loadTeamMapping } = require('../utils/teamMapping');

module.exports = async function over15(page, bet) {
  console.log(`Running Over 1.5 mechanism for ${bet.teams}`);

  const mapping = loadTeamMapping();
  const leagueName = mapping[bet.G] || 'Unknown';
  const leagueIndexes = {
    England: 1, Spain: 2, Germany: 3,
    Champions: 4, Italy: 5, 'African cup': 6,
    Euros: 7, 'Club world cup': 8
  };
  const leagueIndex = leagueIndexes[leagueName] || 1;

  await safeClick(page, 'li[data-op="iv-market-tabs"]:has-text("O/U")', 'O/U tab');
  await safeClick(page, 'span:has-text("Near")', 'Near');
  await safeClick(page, 'div.specifier-select-item:has-text("1.5")', '1.5');

  const teamColumn = await page.$('div.m-table-cell.table-team-column');
  const leagueDivs = await teamColumn.$$('div.m-table');
  const leagueDiv = leagueDivs[leagueIndex - 1];
  const eventTeams = await leagueDiv.$$('.event-list.spacer-team');

  const [homeExpected, awayExpected] = bet.teams.split(' vs ').map(s => s.trim());
  let matchIndex = -1;

  for (let i = 0; i < eventTeams.length; i++) {
    const spans = await eventTeams[i].$$('div[data-op="iv-team-name"] span');
    const home = spans[0] ? (await spans[0].innerText()).trim() : "";
    const away = spans[1] ? (await spans[1].innerText()).trim() : "";

    if (home === homeExpected && away === awayExpected) {
      matchIndex = i;
      //console.log(`Match found at row ${i + 1}: ${home} vs ${away}`);
      break;
    }
  }

  if (matchIndex === -1) return console.error(`Match ${bet.teams} not found in league ${leagueName}`);

  const marketColumn = await page.$('div.m-table-cell.table-market-outcome-column');
  const marketLeagueDivs = await marketColumn.$$('div.m-table');
  const marketLeagueDiv = marketLeagueDivs[leagueIndex - 1];
  const eventMarkets = await marketLeagueDiv.$$('.event-list.spacer-market');
  const marketRow = eventMarkets[matchIndex];

  if (!marketRow) return console.error(`Market row not found for ${bet.teams}`);

  const outcomes = await marketRow.$$('div.iw-outcome');
  if (outcomes.length > 1) {
    const span = await outcomes[1].$('span');
    if (span) {
      await outcomes[1].click();
      console.log(`Clicked Over 1.5 outcome for ${bet.teams}`);
    }
  }
};