const fs = require("fs");
const path = require("path");

/**
 * Loads the team-to-league mapping from a team file
 * @param {string} [teamFile='./team.txt'] - Path to team.txt (default: same folder as main script)
 * @returns {object} mapping { gid: leagueName }
 */
function loadTeamMapping(teamFile = path.join(__dirname, '../team.txt')) {
  if (!fs.existsSync(teamFile)) {
    console.error(`team.txt not found at path: ${teamFile}`);
    return {};
  }

  const lines = fs.readFileSync(teamFile, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const mapping = {};
  for (let i = 0; i < lines.length; i += 2) {
    const league = lines[i];
    const gid = lines[i + 1];
    mapping[gid] = league;
  }
  return mapping;
}

module.exports = { loadTeamMapping };