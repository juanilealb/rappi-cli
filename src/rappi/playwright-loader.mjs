export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    const detail = error && error.message ? error.message : String(error);
    throw new Error(
      `Playwright is required for browser commands. Install dependencies with 'npm install'. Original error: ${detail}`
    );
  }
}
