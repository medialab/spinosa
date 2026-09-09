<script lang="ts">
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import { getDefaultDoc, getDocPages } from '$lib/docs/docs';
	import { devInstallCmd, stableInstallCmd } from '$lib/install-urls';
	import gitIcon from '$lib/assets/github.png';
	import docFooterImg from '$lib/assets/docs_footer.png';
	import { fade } from 'svelte/transition';

	let { children } = $props();
	let beta = $state(false);

	const docTitle = $derived($page.data?.doc?.title ?? '');
	const docDesc = $derived($page.data?.doc?.description ?? '');
	const pageTitle = $derived(docTitle ? `${docTitle} — Spinosa Docs` : 'Spinosa Docs');
	const siteOrigin = $derived($page.url.origin);

	afterNavigate(() => {
		window.scrollTo(0, 0);
	});

	const CMD = $derived(beta ? devInstallCmd() : stableInstallCmd());

	let showCopied = $state(false);
	const docPages = getDocPages();
	const defaultDoc = getDefaultDoc();
	const defaultSlug = defaultDoc?.slug;

	function normalizePath(pathname: string) {
		const p = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
		return p.length > 1 ? p.replace(/\/$/, '') : p;
	}

	function getDocHref(slug: string) {
		return slug === defaultSlug ? base + '/docs' : base + `/docs/${slug}`;
	}

	function isActiveDoc(pathname: string, slug: string) {
		const normalizedPath = normalizePath(pathname);
		const docPath = `/docs/${slug}`;

		if (slug === defaultSlug) {
			return normalizedPath === '/docs' || normalizedPath === docPath;
		}

		return normalizedPath === docPath;
	}

	function handleCopyCmd() {
		navigator.clipboard.writeText(CMD);
		showCopied = true;
		setTimeout(() => (showCopied = false), 2000);
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={docDesc} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={docDesc} />
	<meta property="og:type" content="article" />
	<meta property="og:url" content={siteOrigin + base + $page.url.pathname} />
	<meta property="og:image" content={siteOrigin + base + '/og-image.jpg'} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={docDesc} />
	<link rel="canonical" href={siteOrigin + base + $page.url.pathname} />
</svelte:head>

<header
	class="bg-white absolute top-0 left-0 right-0 z-20 w-full h-10 border-b border-neutral-200 grid grid-cols-2 md:grid-cols-3 px-4 md:px-8 items-center"
>
	<a href={base + '/'} class="hover:underline underline-offset-2"><p>spinosa</p></a>
	<div class="relative hidden md:flex items-center justify-self-center gap-3">
		<button
			onclick={handleCopyCmd}
			class="flex cursor-pointer items-center rounded-md px-2 py-0.5 text-white transition-colors duration-200 {beta
				? 'bg-red-500 hover:bg-red-600'
				: 'bg-black hover:bg-neutral-800'}"
			aria-label="Copy install command"
		>
			{#key CMD}<p in:fade={{ duration: 150 }} class="text-[0.65rem] leading-normal text-nowrap">{CMD}</p>{/key}
		</button>
		{#if showCopied}
			<div
				class="absolute top-full mt-1 left-1/2 -translate-x-1/2 text-nowrap rounded bg-basalt px-2 py-1 text-[0.6rem] text-white"
			>
				Copied to clipboard
			</div>
		{/if}
		<label
			class="flex items-center gap-1.5 text-[0.6rem] tracking-wide cursor-pointer select-none group"
		>
			<span class={!beta ? 'text-black' : 'text-neutral-400 group-hover:text-neutral-600'}>stable</span>
			<button
				type="button"
				role="switch"
				aria-checked={beta}
				aria-label="Toggle beta channel"
				onclick={() => (beta = !beta)}
				class="relative inline-flex h-[14px] w-[26px] shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 hover:border-black/20 {beta
					? 'border-red-300 bg-red-50 hover:bg-red-100'
					: 'border-neutral-200 bg-white hover:bg-neutral-50'}"
			>
				<span
					class="pointer-events-none block h-[10px] w-[10px] rounded-full transition-transform duration-200 {beta
						? 'bg-red-500'
						: 'bg-black'}"
					style="transform: translateX({beta ? '12px' : '2px'})"
				></span>
			</button>
			<span class={beta ? 'text-red-500' : 'text-neutral-400 group-hover:text-neutral-600'}>beta</span>
		</label>
	</div>
	<a
		href="https://github.com/medialab/spinosa"
		target="_blank"
		rel="noreferrer"
		class="justify-self-end w-4 h-4"
	>
		<img src={gitIcon} alt="GitHub" class="h-full w-full" />
	</a>
</header>

<section class="grid grid-cols-1 md:grid-cols-[1fr_2fr_1fr] mt-10 h-full min-h-dvh relative">
	<!-- Left sidebar -->
	<div class="hidden md:block px-8 py-8 min-w-0">
		<div class="sticky top-10 flex flex-col gap-1">
			{#each docPages as docPage (docPage.slug)}
				{@const active = isActiveDoc($page.url.pathname, docPage.slug)}
				<a
					href={getDocHref(docPage.slug)}
					class="group flex gap-1 rounded-sm px-2 py-1 text-sm transition-all duration-125 ease-in-out hover:text-black"
					class:bg-neutral-100={active}
					class:text-black={active}
					class:text-neutral-300={!active}
				>
					<span
						class="opacity-0 transition-opacity duration-125 group-hover:opacity-100"
						class:opacity-100={active}
					>
						→
					</span>
					{docPage.title}
				</a>
			{/each}
		</div>
	</div>

	<!-- Center column -->
	<div class="pt-8 border-x border-neutral-200 flex flex-col min-h-dvh relative min-w-0">
		{@render children()}
		<div class="mt-auto w-full">
			<img src={docFooterImg} alt="" class="w-full" />
		</div>
	</div>

	<!-- Right sidebar -->
	<div class="hidden md:block px-8 py-8 min-w-0">
		<div class="sticky top-10">
			{#if $page.data?.doc?.sections?.length}
				{#each $page.data.doc.sections as section (section.id)}
					<a
						href="#{section.id}"
						class="flex gap-1 py-1.5 text-sm text-neutral-300 hover:text-black! hover:pl-4 hover:underline underline-offset-2 decoration-neutral-300 transition-all duration-125 ease-in-out"
						style="padding-left: {section.level > 2 ? '1rem' : '0'}"
					>
						<p>{section.heading}</p>
					</a>
				{/each}
			{:else}
				<p class="text-neutral-300 text-sm">Select a page</p>
			{/if}
		</div>
	</div>

	<div class="fixed left-6 bottom-6 w-5 aspect-square">
		<img src={gitIcon} alt="" />
	</div>
</section>
