// Client feature flags. One place to switch things on and off for a build.

/**
 * The AI partner ("Play Inside/Outside with AI"). Deferred for now: with false the mode
 * screen only offers Create Lobby and Join Lobby. Nothing is deleted: the AI code, tests
 * and server logic all stay, and flipping this back to true brings the buttons back.
 */
export const ENABLE_AI = false;
