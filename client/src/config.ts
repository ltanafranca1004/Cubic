// Client feature flags. One place to switch things on and off for a build.

/**
 * Solo mode: the PLAY SOLO choice on the mode screen (the AI partner takes the other side). With false the mode screen
 * only offers Create Lobby and Join Lobby (nothing else changes: the AI code, tests and
 * server logic all stay).
 */
export const ENABLE_AI = true;
