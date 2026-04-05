/**
 * Auto-compaction configuration types and loader.
 *
 * Configuration is stored at ~/.config/nanoclaw/compaction-config.json
 * (outside project root for security - not accessible from containers)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export interface TokenThresholdPolicy {
  type: 'token_threshold';
  enabled?: boolean;
  threshold_percent: number;
  description?: string;
}

export interface TurnCountPolicy {
  type: 'turn_count';
  enabled?: boolean;
  turns: number;
  description?: string;
}

export interface SessionDurationPolicy {
  type: 'session_duration';
  enabled?: boolean;
  interval_minutes: number;
  description?: string;
}

export interface CombinedPolicy {
  type: 'combined';
  enabled?: boolean;
  conditions: {
    token_threshold_percent?: number;
    turn_count?: number;
    session_duration_minutes?: number;
  };
  logic?: 'and' | 'or';
  description?: string;
}

export type CompactionPolicy =
  | TokenThresholdPolicy
  | TurnCountPolicy
  | SessionDurationPolicy
  | CombinedPolicy;

export interface CompactionConfig {
  enabled: boolean;
  policies: CompactionPolicy[];
  cooldown_minutes: number;
  preserve_recent_turns: number;
  compact_command: string;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  policies: [
    {
      type: 'token_threshold',
      threshold_percent: 80,
      description: 'Default: compress at 80% context usage',
    },
  ],
  cooldown_minutes: 5,
  preserve_recent_turns: 5,
  compact_command: '/compact',
};

/**
 * Get the path to the compaction config file.
 */
export function getCompactionConfigPath(): string {
  return path.join(
    os.homedir(),
    '.config',
    'nanoclaw',
    'compaction-config.json',
  );
}

/**
 * Load compaction configuration from file.
 * Creates default config if file doesn't exist.
 */
export function loadCompactionConfig(): CompactionConfig {
  const configPath = getCompactionConfigPath();

  if (!fs.existsSync(configPath)) {
    // Create default config
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(
      configPath,
      JSON.stringify(DEFAULT_COMPACTION_CONFIG, null, 2),
    );
    return DEFAULT_COMPACTION_CONFIG;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as Partial<CompactionConfig>;
    return { ...DEFAULT_COMPACTION_CONFIG, ...config };
  } catch (err) {
    console.error(
      `[compaction-config] Error loading config: ${err}, using default`,
    );
    return DEFAULT_COMPACTION_CONFIG;
  }
}

/**
 * Validate a compaction policy.
 */
export function validatePolicy(policy: CompactionPolicy): boolean {
  switch (policy.type) {
    case 'token_threshold':
      return (
        typeof policy.threshold_percent === 'number' &&
        policy.threshold_percent > 0 &&
        policy.threshold_percent <= 100
      );
    case 'turn_count':
      return typeof policy.turns === 'number' && policy.turns > 0;
    case 'session_duration':
      return (
        typeof policy.interval_minutes === 'number' &&
        policy.interval_minutes > 0
      );
    case 'combined': {
      const conditions = policy.conditions || {};
      const hasConditions = Object.keys(conditions).length > 0;
      const hasLogic = policy.logic === 'and' || policy.logic === 'or';
      return hasConditions && hasLogic;
    }
    default:
      return false;
  }
}

/**
 * Validate the entire compaction config.
 */
export function validateConfig(config: CompactionConfig): boolean {
  if (typeof config.enabled !== 'boolean') return false;
  if (!Array.isArray(config.policies)) return false;
  if (typeof config.cooldown_minutes !== 'number') return false;
  if (typeof config.preserve_recent_turns !== 'number') return false;
  if (typeof config.compact_command !== 'string') return false;

  return config.policies.every(validatePolicy);
}
