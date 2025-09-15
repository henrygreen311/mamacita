const fs = require('fs');

function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(`Error parsing ${file}:`, e.message);
    return null;
  }
}

function closeEnough(a, b, tol = 0.0001) {
  return Math.abs(parseFloat(a) - parseFloat(b)) < tol;
}

module.exports = { loadJson, closeEnough };
