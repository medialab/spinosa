export const SITE_ORIGIN = 'https://spinosa.medialab.sciencespo.fr';

export function siteUrl(path: string) {
	return new URL(path, `${SITE_ORIGIN}/`).toString();
}
