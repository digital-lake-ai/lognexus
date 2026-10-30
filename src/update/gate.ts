import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchNpmPackagePolicy, type NpmPackagePolicy } from "../git/safe.js";

/** Environment switch that silences the startup update check entirely. */
export const UPDATE_CHECK_DISABLED_ENV = "LOGNEXUS_NO_UPDATE_CHECK";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_PACKAGE_NAME = "@digital-lake/lognexus";

export interface UpdatePolicy {
  minCriticalVersion: string;
  termsVersion: string;
  requiresTermsAcceptance: boolean;
}

export interface TermsConsent {
  acceptedVersion: string | null;
  acceptedAt: string | null;
}

export interface UpdateGateResult {
  checked: boolean;
  currentVersion: string;
  remoteVersion: string | null;
  updateNotice: string | null;
  blocked: boolean;
  blockReason: string | null;
  /** True when the gate was satisfied but the user should still upgrade. */
  recommendedCommand: string;
}

interface UpdateCacheEntry {
  checkedAt: string;
  remoteVersion: string | null;
  policy: UpdatePolicy | null;
}

export const UPGRADE_COMMAND = `npm install -g ${DEFAULT_PACKAGE_NAME}@latest`;

function lognexusDir(targetDir: string): string {
  return join(targetDir, ".lognexus");
}

export function getUpdateCachePath(targetDir: string = process.cwd()): string {
  return join(lognexusDir(targetDir), "update-check.json");
}

export function getTermsConsentPath(targetDir: string = process.cwd()): string {
  return join(lognexusDir(targetDir), "terms-consent.json");
}

/**
 * The startup check must never fire inside automated runs: a blocking gate in a
 * test harness or a CI container would abort for reasons unrelated to the work.
 */
export function isUpdateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env[UPDATE_CHECK_DISABLED_ENV] === "1") return true;
  if (env.NODE_ENV === "test") return true;
  if (env.VITEST !== undefined && env.VITEST !== "") return true;
  if (env.CI === "true" || env.CI === "1") return true;
  return false;
}

/**
 * Compares two dotted versions numerically. A pre-release suffix (`-rc.1`) is
 * stripped, so a locally built `1.3.0-rc.1` still compares as `1.3.0`.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .split("-")[0]
      .split(".")
      .map((part) => {
        const parsed = Number.parseInt(part, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
      });

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

export function readLocalPolicy(targetDir: string = process.cwd()): UpdatePolicy | null {
  try {
    const pkgPath = join(targetDir, "package.json");
    if (!existsSync(pkgPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { lognexusPolicy?: unknown };
    return normalizePolicy(pkg.lognexusPolicy);
  } catch {
    return null;
  }
}

function normalizePolicy(value: unknown): UpdatePolicy | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const minCriticalVersion =
    typeof record.minCriticalVersion === "string" ? record.minCriticalVersion : "0.0.0";
  const termsVersion = typeof record.termsVersion === "string" ? record.termsVersion : "";
  const requiresTermsAcceptance = record.requiresTermsAcceptance === true;

  return { minCriticalVersion, termsVersion, requiresTermsAcceptance };
}

function readCache(targetDir: string): UpdateCacheEntry | null {
  try {
    const cachePath = getUpdateCachePath(targetDir);
    if (!existsSync(cachePath)) return null;
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as Partial<UpdateCacheEntry>;
    if (typeof parsed.checkedAt !== "string") return null;
    return {
      checkedAt: parsed.checkedAt,
      remoteVersion: typeof parsed.remoteVersion === "string" ? parsed.remoteVersion : null,
      policy: normalizePolicy(parsed.policy),
    };
  } catch {
    return null;
  }
}

function isCacheFresh(entry: UpdateCacheEntry, now: number): boolean {
  const checkedAt = Date.parse(entry.checkedAt);
  if (Number.isNaN(checkedAt)) return false;
  return now - checkedAt < CACHE_TTL_MS;
}

function writeCache(targetDir: string, entry: UpdateCacheEntry): void {
  try {
    mkdirSync(lognexusDir(targetDir), { recursive: true });
    writeFileSync(getUpdateCachePath(targetDir), JSON.stringify(entry, null, 2), "utf8");
  } catch {
    // The cache is an optimisation; a read-only checkout must not break the CLI.
  }
}

export function readTermsConsent(targetDir: string = process.cwd()): TermsConsent {
  try {
    const consentPath = getTermsConsentPath(targetDir);
    if (!existsSync(consentPath)) return { acceptedVersion: null, acceptedAt: null };
    const parsed = JSON.parse(readFileSync(consentPath, "utf8")) as Partial<TermsConsent>;
    return {
      acceptedVersion: typeof parsed.acceptedVersion === "string" ? parsed.acceptedVersion : null,
      acceptedAt: typeof parsed.acceptedAt === "string" ? parsed.acceptedAt : null,
    };
  } catch {
    return { acceptedVersion: null, acceptedAt: null };
  }
}

export function acceptTerms(termsVersion: string, targetDir: string = process.cwd()): TermsConsent {
  const consent: TermsConsent = {
    acceptedVersion: termsVersion,
    acceptedAt: new Date().toISOString(),
  };
  mkdirSync(lognexusDir(targetDir), { recursive: true });
  writeFileSync(getTermsConsentPath(targetDir), JSON.stringify(consent, null, 2), "utf8");
  return consent;
}

function resolveRemote(
  targetDir: string,
  packageName: string,
  now: number,
): { remoteVersion: string | null; policy: UpdatePolicy | null; checked: boolean } {
  const cached = readCache(targetDir);
  if (cached !== null && isCacheFresh(cached, now)) {
    return { remoteVersion: cached.remoteVersion, policy: cached.policy, checked: true };
  }

  const remote: NpmPackagePolicy | null = fetchNpmPackagePolicy(packageName, targetDir);
  if (remote === null) {
    return { remoteVersion: null, policy: null, checked: false };
  }

  const policy = normalizePolicy(remote.lognexusPolicy);
  writeCache(targetDir, {
    checkedAt: new Date(now).toISOString(),
    remoteVersion: remote.version,
    policy,
  });

  return { remoteVersion: remote.version, policy, checked: true };
}

/**
 * Startup update & critical/legal-terms gate.
 *
 * Three outcomes are possible: nothing to do, a non-blocking upgrade notice, or a
 * hard block that must be resolved before the CLI runs again. The gate fails open —
 * an unreachable registry never blocks a developer.
 */
export function checkUpdateGate(
  options: {
    targetDir?: string;
    currentVersion: string;
    packageName?: string;
    now?: number;
    env?: NodeJS.ProcessEnv;
  } = { currentVersion: "0.0.0" },
): UpdateGateResult {
  const targetDir = options.targetDir ?? process.cwd();
  const packageName = options.packageName ?? DEFAULT_PACKAGE_NAME;
  const now = options.now ?? Date.now();
  const env = options.env ?? process.env;

  const base: UpdateGateResult = {
    checked: false,
    currentVersion: options.currentVersion,
    remoteVersion: null,
    updateNotice: null,
    blocked: false,
    blockReason: null,
    recommendedCommand: UPGRADE_COMMAND,
  };

  if (isUpdateCheckDisabled(env)) return base;

  const { remoteVersion, policy, checked } = resolveRemote(targetDir, packageName, now);
  /**
   * Only the published registry policy may hard-block. The local manifest describes
   * the version under development, so honouring it would lock out every run between
   * a policy bump and the release that satisfies it.
   */
  const effectivePolicy = policy;

  const result: UpdateGateResult = { ...base, checked, remoteVersion };

  if (remoteVersion !== null && compareVersions(remoteVersion, options.currentVersion) > 0) {
    result.updateNotice = `LogNexus ${remoteVersion} is available (current ${options.currentVersion}). Upgrade with: ${UPGRADE_COMMAND}`;
  }

  const minCritical = effectivePolicy?.minCriticalVersion;
  if (
    minCritical !== undefined &&
    minCritical !== "" &&
    compareVersions(minCritical, options.currentVersion) > 0
  ) {
    result.blocked = true;
    result.blockReason = `LogNexus ${options.currentVersion} is below the minimum critical version ${minCritical}. Run: ${UPGRADE_COMMAND}`;
    return result;
  }

  if (effectivePolicy?.requiresTermsAcceptance === true) {
    const consent = readTermsConsent(targetDir);
    if (consent.acceptedVersion !== effectivePolicy.termsVersion) {
      result.blocked = true;
      result.blockReason = `Legal terms '${effectivePolicy.termsVersion}' must be accepted. Run: lognexus terms --accept`;
      return result;
    }
  }

  return result;
}

/** Renders the notice for the CLI; an empty string means there is nothing to print. */
export function formatUpdateGateResult(result: UpdateGateResult): string {
  if (result.blocked) {
    return `[BLOCKED] ${result.blockReason}`;
  }
  if (result.updateNotice !== null) {
    return `[UPDATE] ${result.updateNotice}`;
  }
  return "";
}
