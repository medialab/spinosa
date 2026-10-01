const BASE = 'https://spinosa.medialab.sciencespo.fr';

const pages = [
	{ path: '', priority: '1.0', changefreq: 'weekly' },
	{ path: '/docs/welcome', priority: '0.9', changefreq: 'monthly' },
	{ path: '/docs/tour', priority: '0.8', changefreq: 'monthly' },
	{ path: '/docs/tui', priority: '0.8', changefreq: 'monthly' },
	{ path: '/docs/agents', priority: '0.7', changefreq: 'monthly' },
	{ path: '/docs/workspace', priority: '0.7', changefreq: 'monthly' },
	{ path: '/docs/reports', priority: '0.7', changefreq: 'monthly' },
	{ path: '/docs/cli-reference', priority: '0.6', changefreq: 'monthly' },
	{ path: '/docs/mcp', priority: '0.6', changefreq: 'monthly' },
	{ path: '/docs/glossary', priority: '0.6', changefreq: 'monthly' },
	{ path: '/docs/faq', priority: '0.6', changefreq: 'monthly' },
	{ path: '/casestudies', priority: '0.5', changefreq: 'monthly' },
];

export const prerender = true;

export const GET = () => {
	const urls = pages
		.map(
			(p) => `  <url>
    <loc>${BASE}${p.path}</loc>
    <priority>${p.priority}</priority>
    <changefreq>${p.changefreq}</changefreq>
  </url>`
		)
		.join('\n');

	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`,
		{
			headers: {
				'Content-Type': 'application/xml'
			}
		}
	);
};
