const { loadJson } = require('./jsonLoader');

function selectBets(fixtureFile, statsFile) {
  const fixtures = loadJson(fixtureFile);
  const stats = loadJson(statsFile);

  if (!fixtures || !stats) return [];

  const matches = fixtures.wrapEventList?.value || [];
  let candidates = [];

  for (let category of Object.keys(stats)) {
    for (let rule of stats[category]) {
      const [homeTeam, awayTeam] = rule.teams.split(' vs ');

      for (let match of matches) {
        if (match.F === homeTeam && match.B === awayTeam) {
          for (let market of match.I || []) {
            for (let outcome of market.R || []) {
              const c = outcome.c?.trim().toLowerCase();

              // Over 1.5 categories
              if ((category === 'over_1.5' || category === 'over_1.5 after 0-0') &&
                  c === 'over 1.5' && parseFloat(outcome.b) === parseFloat(rule.probability)) {
                candidates.push({
                  category,
                  teams: rule.teams,
                  odd: outcome.a,
                  prob: rule.probability, // always use stats probability
                  conf: rule.confidence,
                  G: match.G
                });
              }

              // X1/X2 category
              if (category === 'x1_x2') {
                if (rule.pick === 'X1' && c === 'home or draw' && parseFloat(outcome.b) === parseFloat(rule.probability)) {
                  candidates.push({
                    category,
                    teams: rule.teams,
                    odd: outcome.a,
                    prob: rule.probability,
                    conf: rule.confidence,
                    pick: rule.pick,
                    G: match.G
                  });
                }
                if (rule.pick === 'X2' && c === 'draw or away' && parseFloat(outcome.b) === parseFloat(rule.probability)) {
                  candidates.push({
                    category,
                    teams: rule.teams,
                    odd: outcome.a,
                    prob: rule.probability,
                    conf: rule.confidence,
                    pick: rule.pick,
                    G: match.G
                  });
                }
              }

              // Both teams score category
              if (category === 'both_teams_score' && c === 'yes' && parseFloat(outcome.b) === parseFloat(rule.probability)) {
                candidates.push({
                  category,
                  teams: rule.teams,
                  odd: outcome.a,
                  prob: rule.probability,
                  conf: rule.confidence,
                  G: match.G
                });
              }
            }
          }
        }
      }
    }
  }

  // Sort by confidence descending
  candidates.sort((a, b) => parseInt(b.conf) - parseInt(a.conf));

  // Apply original "length / odd" logic
  let validBets = [];
  if (candidates.length === 0) {
    //console.log('No bets found.');
  } else if (candidates.length === 1) {
    if (parseFloat(candidates[0].odd) >= 1.29) {
      validBets = candidates;
    } else {
      console.log(`Single bet found but odd <1.29 (${candidates[0].odd})`);
    }
  } else if (candidates.length >= 2) {
  const topTwo = candidates.slice(0, 2);

  // Calculate combined odds (assuming multiplication for combo bets)
  const combinedOdd = parseFloat(topTwo[0].odd) * parseFloat(topTwo[1].odd);

  if (combinedOdd >= 1.50) {
    validBets = topTwo;
  } else {
    console.log(`Two bets found but combined odd <1.50 (${combinedOdd})`);
  }
}

return validBets;
}

module.exports = { selectBets };
