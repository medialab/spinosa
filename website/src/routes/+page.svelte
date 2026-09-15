<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import BgCanvas from '$lib/BgCanvas.svelte';
	import github from '$lib/assets/github.png';
	import { devInstallCmd, stableInstallCmd } from '$lib/install-urls';
	import { fade } from 'svelte/transition';

	const origin = $derived($page.url.origin);

	let beta = $state(false);
	const CMD = $derived(beta ? devInstallCmd() : stableInstallCmd());

	const words = [
		'understands',
		'illuminates',
		'synthesizes',
		'articulates',
		'assimilates',
		'understands'
	];
	let wordIndex = $state(0);
	let showToast = $state(false);
	let entered = $state(false);
	let bashHovered = $state(false);

	onMount(() => {
		const interval = setInterval(() => {
			const next = wordIndex + 1;
			if (next >= words.length - 1) {
				wordIndex = 0;
			} else {
				wordIndex = next;
			}
		}, 2200);

		entered = true;

		return () => {
			clearInterval(interval);
		};
	});

	function handleCopy() {
		navigator.clipboard.writeText(CMD);
		showToast = true;
		setTimeout(() => (showToast = false), 2500);
	}
</script>

<svelte:head>
	<title>Spinosa — Chat with your research documents, locally</title>
	<meta
		name="description"
		content="Spinosa turns your research documents into a workspace you can chat with. Ask questions in plain language, get verified answers with source citations."
	/>
	<meta
		name="keywords"
		content="research, LLM, AI agents, document analysis, local AI, knowledge management, evidence verification"
	/>

	<meta property="og:title" content="Spinosa — Chat with your research documents" />
	<meta property="og:site_name" content="Spinosa" />
	<meta
		property="og:description"
		content="Spinosa turns your research documents into a workspace you can chat with. Ask questions in plain language, get verified answers with source citations."
	/>
	<meta property="og:type" content="website" />
	<meta property="og:url" content="{origin}{base}/" />
	<meta property="og:locale" content="en_US" />
	<meta property="og:image" content="{origin}{base}/og-image.jpg" />
	<meta property="og:image:width" content="3848" />
	<meta property="og:image:height" content="2402" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Spinosa — Chat with your research documents" />
	<meta
		name="twitter:description"
		content="Spinosa turns your documents into a searchable local workspace. Ask questions, get verified answers with source citations."
	/>
	<meta name="twitter:image" content="{origin}{base}/og-image.jpg" />

	<link rel="canonical" href="{origin}{base}/" />

	<script type="application/ld+json">
		{JSON.stringify({
			"@context": "https://schema.org",
			"@type": "SoftwareApplication",
			"name": "Spinosa",
			"applicationCategory": "DataScience",
			"operatingSystem": "macOS, Linux",
			"description": "Spinosa turns research documents into a local workspace you can chat with. AI agents search your files, draft answers, and verify every claim against the original text.",
			"url": `${origin}${base}/`,
			"author": {
				"@type": "Organization",
				"name": "medialab",
				"url": "https://medialab.sciencespo.fr/"
			}
		})}
	</script>
</svelte:head>

<div class="relative w-full bg-white">
	<BgCanvas opacity={bashHovered ? 0.2 : 1} fixed={true} />

	<section class="relative min-h-screen w-full overflow-hidden">
		<div
			class="absolute inset-0 z-10 flex flex-col items-start justify-start px-6 pb-6 pt-6 text-left md:hidden"
			class:animate-fade-in={entered}
			style={entered ? '' : 'opacity: 0'}
		>
			<a
				href="https://github.com/medialab/spinosa"
				target="_blank"
				rel="noreferrer"
				class="mb-4 ml-[1px] block h-5 w-5"
			>
				<img src={github} alt="GitHub" class="h-full w-full" />
			</a>
			<div class="inline-block bg-white px-1 py-0.5">
				<h1 class="text-[2.25rem] font-normal leading-[1] tracking-[-0.02em] text-basalt/85">
					An LLM framework that
					<span
						class="inline-block align-bottom overflow-hidden"
						style="height:2.25rem;vertical-align:bottom"
						>{#key wordIndex}<span
								class="block h-[2.25rem] leading-[2.25rem] italic animate-crossfade"
								>{words[wordIndex]}</span
							>{/key}</span
					>
					<br />your research
				</h1>
			</div>
			<div class="mt-1 inline-block bg-white px-1 py-0.5">
				<h2 class="text-[0.875rem] font-normal leading-[1.4] text-basalt/50">
					The local data layer for your LLM CLI
				</h2>
			</div>
			<div class="mt-2 inline-block bg-white px-1 py-0.5">
				<a
					href={base + '/docs/welcome'}
					class="text-[0.8rem] text-sun-cured-terracotta hover:opacity-70 transition-opacity"
				>
					Read the docs →
				</a>
			</div>
		</div>

		<a
			href="https://github.com/medialab/spinosa"
			target="_blank"
			rel="noreferrer"
			class="absolute right-10 top-10 z-20 hidden h-6 w-6 md:block"
			class:animate-fade-in={entered}
			style={entered ? '' : 'opacity: 0'}
		>
			<img src={github} alt="GitHub" class="h-full w-full" />
		</a>

		<div
			class="absolute left-10 top-10 z-20 hidden flex-col gap-4 md:flex"
			class:animate-fade-in={entered}
			style={entered ? '' : 'opacity: 0'}
		>
			<h1
				class="max-w-[45ch] text-[3rem] font-normal leading-[1] tracking-[-0.02em] text-basalt/85"
			>
				An LLM framework<br />that
				<span
					class="inline-block align-bottom overflow-hidden"
					style="height:3rem;vertical-align:bottom"
					>{#key wordIndex}<span class="block h-[3rem] leading-[3rem] italic animate-crossfade"
							>{words[wordIndex]}</span
						>{/key}</span
				>
				<br />your research
			</h1>
			<h2 class="max-w-[45ch] text-[1rem] font-normal leading-[1.3] text-basalt/50">
				The local data layer for your LLM CLI
			</h2>
			<a
				href={base + '/docs/welcome'}
				class="max-w-[45ch] text-[0.85rem] text-sun-cured-terracotta hover:opacity-70 transition-opacity"
			>
				Read the docs →
			</a>
		</div>

		<section class="relative z-10 hidden min-h-screen items-end justify-start px-10 pb-10 md:flex">
			<div
				class="flex flex-col gap-3"
				class:animate-fade-in={entered}
				style="animation-delay: 0.2s; {entered ? '' : 'opacity: 0'}"
			>
				<label
					class="flex items-center gap-2 text-[0.7rem] tracking-wide cursor-pointer select-none w-fit group"
				>
					<span class={!beta ? 'text-basalt' : 'text-basalt/40 group-hover:text-basalt/70'}>stable</span>
					<button
						type="button"
						role="switch"
						aria-checked={beta}
						aria-label="Toggle beta channel"
						onclick={() => (beta = !beta)}
						class="relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basalt/20 hover:border-basalt/20 {beta
							? 'border-sun-cured-terracotta/30 bg-sun-cured-terracotta/10 hover:bg-sun-cured-terracotta/20'
							: 'border-warm-limestone bg-washed-clay hover:bg-warm-limestone'}"
					>
						<span
							class="pointer-events-none block h-[12px] w-[12px] rounded-full transition-transform duration-200 {beta
								? 'bg-sun-cured-terracotta'
								: 'bg-basalt'}"
							style="transform: translateX({beta ? '14px' : '2px'})"
						></span>
					</button>
					<span class={beta ? 'text-sun-cured-terracotta' : 'text-basalt/40 group-hover:text-basalt/70'}>beta</span>
				</label>
				<div
					class="relative flex flex-wrap items-center justify-start gap-[5px]"
					onmouseenter={() => (bashHovered = true)}
					onmouseleave={() => (bashHovered = false)}
				>
					<div
						class="flex items-center max-w-full overflow-x-auto rounded-[6px] border px-4 py-[13px] cursor-pointer transition-[background-color] duration-200 ease-out {beta
							? 'border-red-200 bg-red-50 hover:bg-red-100'
							: 'border-warm-limestone bg-washed-clay/98 hover:bg-warm-limestone'}"
						onclick={handleCopy}
						role="button"
						tabindex="0"
						onkeydown={(e) => e.key === 'Enter' && handleCopy()}
					>
						{#key CMD}
							<code
								in:fade={{ duration: 150 }}
								class="block whitespace-nowrap text-[0.8rem] leading-6 underline-offset-2 hover:underline {beta
									? 'text-red-700 decoration-red-300'
									: 'text-basalt decoration-basalt/30'}"
							>
								{CMD}
							</code>
						{/key}
					</div>
					<button
						onclick={handleCopy}
						class="relative flex shrink-0 cursor-pointer items-center justify-center rounded-[6px] border px-[15px] py-[13px] transition-[background-color] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 {beta
							? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 focus-visible:bg-red-100 focus-visible:ring-red-200'
							: 'border-warm-limestone bg-washed-clay/98 text-basalt hover:bg-warm-limestone focus-visible:bg-warm-limestone focus-visible:ring-basalt/20'}"
						aria-label={showToast ? 'Copied' : 'Copy command'}
					>
						{#if showToast}
							<div
								class="absolute left-full ml-2 top-0 whitespace-nowrap rounded-[6px] bg-basalt px-3 py-2 text-[0.75rem] text-white shadow-lg animate-toast-in"
							>
								text copied, paste in your terminal!
							</div>
						{/if}
						{#if showToast}
							<svg
								class="h-6 w-6"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<polyline points="20 6 9 17 4 12" />
							</svg>
						{:else}
							<svg
								class="h-6 w-6"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
							</svg>
						{/if}
					</button>
				</div>
			</div>
		</section>
	</section>
</div>

<style>
	.animate-fade-in {
		animation: fade-in 0.6s ease-out both;
	}

	.animate-toast-in {
		animation: toast-in 0.2s ease-out both;
	}

	.animate-crossfade {
		animation: crossfade-in 0.35s ease-out both;
	}

	@keyframes crossfade-in {
		from {
			opacity: 0;
			translate: 0 0.5em;
		}
		to {
			opacity: 1;
			translate: 0 0;
		}
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			translate: 0 0.5rem;
		}
		to {
			opacity: 1;
			translate: 0 0;
		}
	}
</style>
