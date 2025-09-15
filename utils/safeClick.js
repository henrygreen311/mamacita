/**
 * Safely clicks a selector with optional logging
 * @param {object} page - Playwright page instance
 * @param {string} selector - Selector string
 * @param {string} name - Optional name for logging
 */
async function safeClick(page, selector, name = "") {
  try {
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.click(selector);
    if (name) console.log(`Clicked ${name}`);
  } catch {
    if (name) console.error(`Failed to click ${name} (${selector})`);
  }
}

module.exports = { safeClick };
