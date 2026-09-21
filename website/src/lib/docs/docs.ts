export interface DocSection {
	id: string;
	heading: string;
	level: number;
	content: string;
}

export interface DocPage {
	title: string;
	slug: string;
	description: string;
	sourcePath: string;
	groupId: string;
	groupTitle: string;
	groupOrder: number;
	pageOrder: number;
	isDefault?: boolean;
}

export interface DocPageData extends DocPage {
	intro: string;
	sections: DocSection[];
}

export interface DocGroup {
	id: string;
	title: string;
	pages: DocPage[];
}

const docRegistry: DocPage[] = [
	{
		title: 'Welcome',
		slug: 'welcome',
		description:
			'Turn your documents into a searchable workspace where AI agents find evidence, write reports, and verify every claim against your original files.',
		sourcePath: 'get-started/welcome.md',
		groupId: 'get-started',
		groupTitle: 'Get Started',
		groupOrder: 10,
		pageOrder: 10,
		isDefault: true
	},
	{
		title: 'Tour',
		slug: 'tour',
		description:
			'A 10-minute walkthrough from install to your first verified report.',
		sourcePath: 'get-started/tour.md',
		groupId: 'get-started',
		groupTitle: 'Get Started',
		groupOrder: 10,
		pageOrder: 20
	},
	{
		title: 'TUI Guide',
		slug: 'tui',
		description: 'How to navigate the Spinosa dashboard, keyboard shortcuts, and all available screens.',
		sourcePath: 'tui.md',
		groupId: 'get-started',
		groupTitle: 'Get Started',
		groupOrder: 10,
		pageOrder: 30
	},
	{
		title: 'Agents & Pipeline',
		slug: 'agents',
		description: 'How the 7 specialized sub-agents work and how the orchestrator dispatches them.',
		sourcePath: 'concepts/agents.md',
		groupId: 'concepts',
		groupTitle: 'Concepts',
		groupOrder: 20,
		pageOrder: 10
	},
	{
		title: 'Workspace Structure',
		slug: 'workspace',
		description: 'Workspace layout, folders, key files, and how to work with the corpus safely.',
		sourcePath: 'concepts/workspace.md',
		groupId: 'concepts',
		groupTitle: 'Concepts',
		groupOrder: 20,
		pageOrder: 20
	},
	{
		title: 'Reports & Charts',
		slug: 'reports',
		description: 'Report format, verification badges, and how to read Unicode charts.',
		sourcePath: 'concepts/reports.md',
		groupId: 'concepts',
		groupTitle: 'Concepts',
		groupOrder: 20,
		pageOrder: 30
	},
	{
		title: 'CLI Reference',
		slug: 'cli-reference',
		description: 'Complete command reference for every spinosa subcommand and flag.',
		sourcePath: 'reference/cli-reference.md',
		groupId: 'reference',
		groupTitle: 'Reference',
		groupOrder: 30,
		pageOrder: 10
	},
	{
		title: 'MCP for agents',
		slug: 'mcp',
		description:
			'Use Spinosa from Claude, Codex, or Cursor over MCP: choose a workspace, load skills, run gate and verify tools.',
		sourcePath: 'reference/mcp.md',
		groupId: 'reference',
		groupTitle: 'Reference',
		groupOrder: 30,
		pageOrder: 15
	},
	{
		title: 'Glossary',
		slug: 'glossary',
		description: "Plain-English definitions of terms you'll encounter in Spinosa.",
		sourcePath: 'reference/glossary.md',
		groupId: 'reference',
		groupTitle: 'Reference',
		groupOrder: 30,
		pageOrder: 20
	},
	{
		title: 'FAQ',
		slug: 'faq',
		description: 'Common questions about setup, usage, reports, and troubleshooting.',
		sourcePath: 'support/faq.md',
		groupId: 'support',
		groupTitle: 'Support',
		groupOrder: 40,
		pageOrder: 10
	}
];

const collator = new Intl.Collator('en', { numeric: true });

const docsByPageOrder = [...docRegistry].sort((left, right) => {
	if (left.groupOrder !== right.groupOrder) {
		return left.groupOrder - right.groupOrder;
	}

	if (left.pageOrder !== right.pageOrder) {
		return left.pageOrder - right.pageOrder;
	}

	return collator.compare(left.title, right.title);
});

const docBySlug = new Map<string, DocPage>();
const docBySourcePath = new Map<string, DocPage>();
const groupDefinitions = new Map<string, { title: string; order: number }>();
let defaultDocPage: DocPage | null = null;

for (const page of docsByPageOrder) {
	const groupDefinition = groupDefinitions.get(page.groupId);

	if (groupDefinition) {
		if (groupDefinition.title !== page.groupTitle || groupDefinition.order !== page.groupOrder) {
			throw new Error(`Doc group "${page.groupId}" has conflicting manifest metadata`);
		}
	} else {
		groupDefinitions.set(page.groupId, {
			title: page.groupTitle,
			order: page.groupOrder
		});
	}

	if (docBySlug.has(page.slug)) {
		throw new Error(`Duplicate doc slug "${page.slug}" in docs registry`);
	}

	if (docBySourcePath.has(page.sourcePath)) {
		throw new Error(`Duplicate doc sourcePath "${page.sourcePath}" in docs registry`);
	}

	docBySlug.set(page.slug, page);
	docBySourcePath.set(page.sourcePath, page);

	if (page.isDefault) {
		if (defaultDocPage) {
			throw new Error(`Multiple docs are marked as the default page`);
		}

		defaultDocPage = page;
	}
}

if (!defaultDocPage) {
	throw new Error(`No doc is marked as the default page`);
}

export const docs: DocGroup[] = Array.from(
	docsByPageOrder.reduce((groups, page) => {
		const group = groups.get(page.groupId);

		if (group) {
			group.pages.push(page);
			return groups;
		}

		groups.set(page.groupId, {
			id: page.groupId,
			title: page.groupTitle,
			pages: [page]
		});

		return groups;
	}, new Map<string, DocGroup>())
).map(([, group]) => group);

export function getDocBySlug(slug: string) {
	return docBySlug.get(slug);
}

export function getDefaultDoc() {
	return defaultDocPage as DocPage;
}

export function getDocPages() {
	return docsByPageOrder;
}
