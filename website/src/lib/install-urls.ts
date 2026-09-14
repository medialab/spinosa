/** User-facing install commands. Stable = production; beta = prereleases (dev alias). */

const STABLE_URL = 'https://github.com/medialab/spinosa/releases/download/stable/install.sh';
const DEV_URL = 'https://github.com/medialab/spinosa/releases/download/beta/install.sh';

function bootstrapCmd(url: string): string {
	// Download first, then execute — ensures the full script is fetched
	// before any installation runs and lets curl enforce deadlines
	// (matches README cold-start instructions).
	return `curl -fsSL --connect-timeout 30 --max-time 600 --retry 3 --retry-delay 2 ${url} -o /tmp/spinosa-install.sh && bash /tmp/spinosa-install.sh`;
}

export const STABLE_INSTALL_CMD = bootstrapCmd(STABLE_URL);

export function stableInstallCmd(): string {
	return STABLE_INSTALL_CMD;
}

export const DEV_INSTALL_CMD = bootstrapCmd(DEV_URL);

export function devInstallCmd(): string {
	return DEV_INSTALL_CMD;
}
