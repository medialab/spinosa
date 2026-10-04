import { redirect } from '@sveltejs/kit';
import { STABLE_INSTALL_REDIRECT } from '$lib/github-releases';

export const prerender = true;

export const load = () => redirect(302, STABLE_INSTALL_REDIRECT);
