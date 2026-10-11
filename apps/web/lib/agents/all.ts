/**
 * Every agent module, imported for its registration side effect: each one
 * assigns itself into AGENT_RUNNERS (lib/agents/run.ts) at module load.
 * Anything that calls runAgent() imports THIS file, so a kind cannot be
 * registered on one path and missing on another. One line per agent.
 */
export {};
import "./bidWatcher";
