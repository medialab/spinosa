/**
 * Per-target static Tesseract builder (local release tooling, never shipped).
 *
 * Used by scripts/build-tools-tarballs.ts to compile one tools target:
 * zlib→libpng→libjpeg-turbo→libtiff→leptonica→tesseract, all static, then
 * fail-closed gates on the produced binary (version + linkage).
 *
 * Two transports, one build definition:
 *   localRunner()         — this Mac (darwin targets), argv arrays, no shell
 *   limaRunner(instance)  — Lima Ubuntu guest (linux targets); commands run
 *                           as ONE remote `bash -c` line composed with sq()
 *                           quoting over a fail-closed alphabet, so behavior
 *                           is identical whether or not limactl shells out.
 */

import { fmtElapsed, timestamp } from "./log.ts"

export const TESSERACT_VERSION = "5.5.3"

export type SourcePin = { file: string; version: string; url: string; sha256: string }

/** Pinned source tarballs (SHA256 verified after download, before extract). */
export const SOURCE_PINS: SourcePin[] = [
  {
    file: "zlib-1.3.1.tar.gz",
    version: "1.3.1",
    url: "https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz",
    sha256: "9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23",
  },
  {
    file: "libpng-1.6.47.tar.gz",
    version: "1.6.47",
    url: "https://download.sourceforge.net/libpng/libpng-1.6.47.tar.gz",
    sha256: "084115c62fe023e3d88cd78764a4d8e89763985ee4b4a085825f7a00d85eafbb",
  },
  {
    file: "libjpeg-turbo-3.1.0.tar.gz",
    version: "3.1.0",
    url: "https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/3.1.0/libjpeg-turbo-3.1.0.tar.gz",
    sha256: "9564c72b1dfd1d6fe6274c5f95a8d989b59854575d4bbee44ade7bc17aa9bc93",
  },
  {
    file: "tiff-4.7.0.tar.gz",
    version: "4.7.0",
    url: "https://download.osgeo.org/libtiff/tiff-4.7.0.tar.gz",
    sha256: "67160e3457365ab96c5b3286a0903aa6e78bdc44c4bc737d2e486bcecb6ba976",
  },
  {
    file: "leptonica-1.87.0.tar.gz",
    version: "1.87.0",
    url: "https://github.com/DanBloomberg/leptonica/releases/download/1.87.0/leptonica-1.87.0.tar.gz",
    sha256: "c73363397f96eb1295602bf44d708a994ad42046c791bf03ea0505d829bdb6a7",
  },
  {
    file: "tesseract-5.5.3.tar.gz",
    version: TESSERACT_VERSION,
    url: "https://github.com/tesseract-ocr/tesseract/archive/refs/tags/5.5.3.tar.gz",
    sha256: "9218e62793116d42a9f6d14cd9348518b27f382096eea3d0f2d1a24616bb5884",
  },
]

export type BuildRunner = {
  /** Run a command (streamed output); throw on nonzero exit. */
  run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<void>
  /** Run and capture stdout; throw on nonzero exit. */
  capture(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<string>
  readFile(p: string): Promise<string>
  writeFile(p: string, content: string): Promise<void>
}

async function spawnChecked(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdout?: "inherit" | "pipe"; stderr?: "inherit" | "pipe"; stdin?: Buffer | undefined },
): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdin: opts.stdin ? opts.stdin : "ignore",
    stdout: opts.stdout ?? "inherit",
    stderr: opts.stderr ?? "inherit",
  })
  const [out, err, exit] = await Promise.all([
    opts.stdout === "pipe" ? new Response(proc.stdout).text() : Promise.resolve(""),
    opts.stderr === "pipe" ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ])
  if (exit !== 0) {
    throw new Error(`command failed (exit ${exit}): ${cmd.join(" ")}${err ? `\n${err.slice(0, 800)}` : ""}`)
  }
  return { stdout: out, stderr: err }
}

export function localRunner(): BuildRunner {
  return {
    run: async (cmd, opts) => {
      await spawnChecked(cmd, { cwd: opts?.cwd, env: opts?.env, stdout: "inherit", stderr: "inherit" })
    },
    capture: async (cmd, opts) => {
      const { stdout } = await spawnChecked(cmd, { cwd: opts?.cwd, env: opts?.env, stdout: "pipe", stderr: "pipe" })
      return stdout
    },
    readFile: async (p) => (await import("node:fs/promises")).readFile(p, "utf-8"),
    writeFile: async (p, content) => {
      await (await import("node:fs/promises")).writeFile(p, content)
    },
  }
}

/** Single-quote a string for remote `bash -c`; fail closed on odd input. */
export function sq(s: string): string {
  if (!/^[A-Za-z0-9_\/.,:;=+@%\- ]+$/.test(s)) throw new Error(`unquotable build string: ${JSON.stringify(s)}`)
  return `'${s}'`
}

export function limaRunner(instance: string): BuildRunner {
  const line = (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): string => {
    for (const k of Object.keys(opts?.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`invalid env key: ${JSON.stringify(k)}`)
    }
    const assignments = Object.entries(opts?.env ?? {}).map(([k, v]) => `${k}=${sq(v)}`)
    return [...(opts?.cwd ? [`cd ${sq(opts.cwd)}`] : []), [...assignments, ...cmd.map(sq)].join(" ")].join(" && ")
  }
  return {
    run: async (cmd, opts) => {
      await spawnChecked(["limactl", "shell", instance, "--", "bash", "-c", line(cmd, opts)], {
        stdout: "inherit",
        stderr: "inherit",
      })
    },
    capture: async (cmd, opts) => {
      const { stdout } = await spawnChecked(["limactl", "shell", instance, "--", "bash", "-c", line(cmd, opts)], {
        stdout: "pipe",
        stderr: "pipe",
      })
      return stdout
    },
    readFile: async (p) => {
      const { stdout } = await spawnChecked(["limactl", "shell", instance, "--", "bash", "-c", `cat ${sq(p)}`], {
        stdout: "pipe",
        stderr: "pipe",
      })
      return stdout
    },
    writeFile: async (p, content) => {
      await spawnChecked(["limactl", "shell", instance, "--", "bash", "-c", `cat > ${sq(p)}`], {
        stdout: "inherit",
        stderr: "inherit",
        stdin: Buffer.from(content),
      })
    },
  }
}

export type ToolsOs = "darwin" | "linux"

async function cmakeConfigure(
  r: BuildRunner,
  opts: { src: string; build: string; prefix: string; toolchain?: string; args: string[] },
): Promise<void> {
  await r.run(
    [
      "cmake", "-S", opts.src, "-B", opts.build,
      "-DCMAKE_BUILD_TYPE=Release",
      `-DCMAKE_INSTALL_PREFIX=${opts.prefix}`,
      `-DCMAKE_PREFIX_PATH=${opts.prefix}`,
      ...(opts.toolchain ? [`-DCMAKE_TOOLCHAIN_FILE=${opts.toolchain}`] : []),
      ...opts.args,
    ],
  )
}

async function cmakeBuildInstall(r: BuildRunner, build: string, jobs: number): Promise<void> {
  await r.run(["cmake", "--build", build, "-j", String(jobs)])
  await r.run(["cmake", "--install", build])
}

function darwinCrossToolchain(): string {
  // x86_64-on-arm64 only. Modern CMake re-derives CMAKE_SYSTEM_PROCESSOR
  // from the build host and ignores -D overrides on Apple, which poisons
  // SIMD selection (tesseract links NEON objects into x86_64). A toolchain
  // file is authoritative — but it flips CMake into cross-compiling mode,
  // where try_run() hard-errors. Route test binaries through Rosetta so
  // configure-time probes actually execute (fail closed without Rosetta).
  // Native arm64 builds use no toolchain file at all.
  // NOTE: in cross mode CMake ignores the CFLAGS/LDFLAGS environment (host
  // contamination guard), so arch flags must ride CMAKE_*_FLAGS_INIT here —
  // env-only -arch silently builds arm64 objects into an x86_64 link.
  return [
    "set(CMAKE_SYSTEM_NAME Darwin)",
    "set(CMAKE_SYSTEM_PROCESSOR x86_64)",
    "set(CMAKE_OSX_ARCHITECTURES x86_64)",
    "set(CMAKE_OSX_DEPLOYMENT_TARGET 13.0)",
    "set(CMAKE_C_COMPILER clang)",
    "set(CMAKE_CXX_COMPILER clang++)",
    'set(CMAKE_C_FLAGS_INIT "-arch x86_64 -mmacosx-version-min=13.0 -O2")',
    'set(CMAKE_CXX_FLAGS_INIT "-arch x86_64 -mmacosx-version-min=13.0 -O2")',
    'set(CMAKE_EXE_LINKER_FLAGS_INIT "-arch x86_64 -mmacosx-version-min=13.0")',
    'set(CMAKE_SHARED_LINKER_FLAGS_INIT "-arch x86_64 -mmacosx-version-min=13.0")',
    // No CMAKE_STATIC_LINKER_FLAGS_INIT: Apple's ar chokes on -arch, and
    // static archives inherit the arch from their member objects anyway.
    "find_program(ARCH_CMD arch REQUIRED)",
    "set(CMAKE_CROSSCOMPILING_EMULATOR ${ARCH_CMD};-x86_64)",
    "",
  ].join("\n")
}

export async function buildToolTarget(opts: {
  target: string
  os: ToolsOs
  /** clang arch for darwin (arm64|x86_64); informational on linux. */
  arch: string
  sourcesDir: string
  prefix: string
  buildRoot: string
  jobs: number
  runner: BuildRunner
  /** SDK path for darwin (xcrun); unused on linux. */
  sdkPath?: string
}): Promise<string> {
  const { target, os, arch, sourcesDir, prefix, buildRoot, jobs, runner } = opts
  const targetStarted = Date.now()
  const elapsed = () => fmtElapsed(Date.now() - targetStarted)
  const log = (m: string) => console.log(`[${timestamp()}] [tools:${target} +${elapsed()}] ${m}`)
  const fail = (m: string): never => {
    throw new Error(`[tools:${target}] FATAL ${m}`)
  }
  const join = (...parts: string[]) => parts.join("/")

  let toolchain: string | undefined
  let cflags: Record<string, string>
  if (os === "darwin") {
    if (!opts.sdkPath) fail("xcrun SDK not found (install Xcode command line tools on the build Mac)")
    const sdk = opts.sdkPath
    const base = `-arch ${arch} -mmacosx-version-min=13.0 -O2`
    cflags = { CC: "clang", CXX: "clang++", CFLAGS: base, CXXFLAGS: base, LDFLAGS: base }
    const hostArch = process.arch === "arm64" ? "arm64" : "x86_64"
    if (arch !== hostArch) {
      if (arch !== "x86_64") fail(`cannot cross-compile ${target} from a ${hostArch} host — build it on matching hardware`)
      toolchain = join(buildRoot, "darwin-x64-toolchain.cmake")
      await runner.writeFile(toolchain, darwinCrossToolchain())
    }
  } else {
    cflags = { CC: "gcc", CXX: "g++", CFLAGS: "-O2 -static", CXXFLAGS: "-O2 -static", LDFLAGS: "-static" }
  }
  const run = (cmd: string[], env?: Record<string, string>) =>
    runner.run(cmd, env ? { env: { ...cflags, ...env } } : { env: cflags })

  // Linux links fully static (no user-side deps, no LD_LIBRARY_PATH). The flag
  // rides ONLY the final tesseract configure: intermediate libs build
  // throwaway host tools (libtiff's mkg3states generator, turbo tests, zlib
  // examples) that must link dynamically against system libs — a global
  // -static would kill those links (ld refuses explicit .so paths). The
  // static ARCHIVES are identical either way; only executable links care.
  // (Darwin intentionally links base-system libs instead; its arch flags
  // ride the toolchain file. The LDFLAGS env above only reaches extract.)
  const linuxStaticExeLink = os === "linux" ? ["-DCMAKE_EXE_LINKER_FLAGS=-static"] : []

  // Sources are SHA256-verified by the orchestrator before we ever extract.
  const extract = async (file: string, dest: string) => {
    await run(["rm", "-rf", dest])
    await run(["mkdir", "-p", dest])
    await run(["tar", "-xzf", join(sourcesDir, file), "-C", dest, "--strip-components=1"])
  }

  const zlibInc = os === "darwin" ? `${opts.sdkPath}/usr/include` : join(prefix, "include")
  const zlibLib =
    os === "darwin" ? `${opts.sdkPath}/usr/lib/libz.tbd` : join(prefix, "lib", "libz.a")

  if (os === "linux") {
    log("zlib (static)")
    const src = join(buildRoot, "zlib")
    const zlibBuild = join(buildRoot, "build-zlib")
    await extract("zlib-1.3.1.tar.gz", src)
    await cmakeConfigure(runner, {
      src,
      build: zlibBuild,
      prefix,
      toolchain,
      args: ["-DBUILD_SHARED_LIBS=OFF"],
    })
    // zlib ignores BUILD_SHARED_LIBS (always adds a shared target): build
    // ONLY `zlibstatic` and hand-install lib + headers, so prefix exposes no
    // libz.so and no zlib config for downstream find_package calls to latch
    // onto (ZLIB::ZLIB must resolve static or the final -static tesseract
    // link dies). zlib.h comes from source, zconf.h is generated into the
    // build dir.
    await runner.run(["cmake", "--build", zlibBuild, "--target", "zlibstatic", "-j", String(jobs)])
    await run(["mkdir", "-p", join(prefix, "include"), join(prefix, "lib")])
    await run(["cp", join(src, "zlib.h"), join(prefix, "include", "zlib.h")])
    await run(["cp", join(zlibBuild, "zconf.h"), join(prefix, "include", "zconf.h")])
    await run(["cp", join(zlibBuild, "libz.a"), join(prefix, "lib", "libz.a")])
  }

  log("libpng (static)")
  const pngSrc = join(buildRoot, "libpng")
  await extract("libpng-1.6.47.tar.gz", pngSrc)
  await cmakeConfigure(runner, {
    src: pngSrc,
    build: join(buildRoot, "build-libpng"),
    prefix,
    toolchain,
    args: ["-DPNG_SHARED=OFF", "-DPNG_TESTS=OFF", `-DZLIB_INCLUDE_DIR=${zlibInc}`, `-DZLIB_LIBRARY=${zlibLib}`, ...(os === "darwin" ? [`-DZLIB_ROOT=${opts.sdkPath}/usr`] : [])],
  })
  await cmakeBuildInstall(runner, join(buildRoot, "build-libpng"), jobs)

  log("libjpeg-turbo (static)")
  const jpegSrc = join(buildRoot, "libjpeg-turbo")
  await extract("libjpeg-turbo-3.1.0.tar.gz", jpegSrc)
  await cmakeConfigure(runner, {
    src: jpegSrc,
    build: join(buildRoot, "build-libjpeg-turbo"),
    prefix,
    toolchain,
    args: ["-DENABLE_SHARED=OFF", "-DENABLE_STATIC=ON", "-DWITH_SIMD=OFF"],
  })
  await cmakeBuildInstall(runner, join(buildRoot, "build-libjpeg-turbo"), jobs)

  log("libtiff (static)")
  const tiffSrc = join(buildRoot, "libtiff")
  await extract("tiff-4.7.0.tar.gz", tiffSrc)
  await cmakeConfigure(runner, {
    src: tiffSrc,
    build: join(buildRoot, "build-libtiff"),
    prefix,
    toolchain,
    args: [
      "-DBUILD_SHARED_LIBS=OFF", "-Dtiff-tools=OFF", "-Dtiff-tests=OFF", "-Dtiff-contrib=OFF", "-Dtiff-docs=OFF",
      "-Dlibdeflate=OFF", "-Dlzma=OFF", "-Dzstd=OFF", "-Dwebp=OFF", "-Djbig=OFF", "-Dlerc=OFF",
      `-DJPEG_INCLUDE_DIR=${join(prefix, "include")}`, `-DJPEG_LIBRARY=${join(prefix, "lib", "libjpeg.a")}`,
      `-DZLIB_INCLUDE_DIR=${zlibInc}`, `-DZLIB_LIBRARY=${zlibLib}`,
      ...(os === "darwin" ? [`-DZLIB_ROOT=${opts.sdkPath}/usr`] : []),
    ],
  })
  await cmakeBuildInstall(runner, join(buildRoot, "build-libtiff"), jobs)
  // libtiff 4.7.0 exports a dangling `$<LINK_ONLY:CMath::CMath>` interface
  // link (its FindCMath target is build-scoped, never exported). libm lives
  // in libSystem on macOS (link nothing) and is base-toolchain libm on
  // static Linux (link m): patch our installed copy.
  {
    const f = join(prefix, "lib", "cmake", "tiff", "TiffTargets.cmake")
    const text = await runner.readFile(f).catch(() => fail(`missing ${f}`))
    const patched =
      os === "darwin"
        ? text.replaceAll("\\$<LINK_ONLY:CMath::CMath>", "").replaceAll("$<LINK_ONLY:CMath::CMath>", "")
        : text.replaceAll("\\$<LINK_ONLY:CMath::CMath>", "$<LINK_ONLY:m>").replaceAll("$<LINK_ONLY:CMath::CMath>", "$<LINK_ONLY:m>")
    if (patched.includes("CMath")) fail("CMath export patch failed")
    await runner.writeFile(f, patched)
  }

  log("leptonica (static)")
  const leptSrc = join(buildRoot, "leptonica")
  await extract("leptonica-1.87.0.tar.gz", leptSrc)
  await cmakeConfigure(runner, {
    src: leptSrc,
    build: join(buildRoot, "build-leptonica"),
    prefix,
    toolchain,
    args: [
      "-DBUILD_SHARED_LIBS=OFF", "-DBUILD_PROG=OFF", "-DSW_BUILD=OFF",
      "-DENABLE_GIF=OFF", "-DENABLE_WEBP=OFF", "-DENABLE_OPENJPEG=OFF",
      `-DJPEG_INCLUDE_DIR=${join(prefix, "include")}`, `-DJPEG_LIBRARY=${join(prefix, "lib", "libjpeg.a")}`,
      `-DPNG_PNG_INCLUDE_DIR=${join(prefix, "include")}`, `-DPNG_LIBRARY=${join(prefix, "lib", "libpng.a")}`,
      `-DTIFF_INCLUDE_DIR=${join(prefix, "include")}`, `-DTIFF_LIBRARY=${join(prefix, "lib", "libtiff.a")}`,
      `-DZLIB_INCLUDE_DIR=${zlibInc}`, `-DZLIB_LIBRARY=${zlibLib}`,
      ...(os === "darwin" ? [`-DZLIB_ROOT=${opts.sdkPath}/usr`] : []),
    ],
  })
  await cmakeBuildInstall(runner, join(buildRoot, "build-leptonica"), jobs)
  // Leptonica exports dangling `$<LINK_ONLY:...ZLIB::ZLIB/JPEG::JPEG>`
  // interface links (created by its own configure, never exported, no
  // find_dependency in its config). The absolute static-lib entries in the
  // same interface already carry these deps: strip the dangling refs.
  {
    const f = join(prefix, "lib", "cmake", "leptonica", "LeptonicaTargets.cmake")
    const text = await runner.readFile(f).catch(() => fail(`missing ${f}`))
    const patched = text
      .replaceAll("\\$<LINK_ONLY:\\$<LINK_ONLY:ZLIB::ZLIB>>", "")
      .replaceAll("$<LINK_ONLY:$<LINK_ONLY:ZLIB::ZLIB>>", "")
      .replaceAll("\\$<LINK_ONLY:\\$<LINK_ONLY:JPEG::JPEG>>", "")
      .replaceAll("$<LINK_ONLY:$<LINK_ONLY:JPEG::JPEG>>", "")
    if (/[A-Za-z0-9_]+::[A-Za-z0-9_]+/.test(patched)) fail("leptonica export patch failed")
    // GNU ld links static archives strictly left-to-right in ONE pass (macOS
    // ld64 resolves order-insensitively, which is why darwin linked fine):
    // an archive must come AFTER its consumers. Leptonica's own build order
    // lists libjpeg.a before libtiff.a, but libtiff (turbo dual-8/12 mode)
    // needs jpeg12_* from libjpeg — the final tesseract link dies with
    // undefined refs. Stable-rank the tokens so providers follow consumers
    // (libtiff → libjpeg → libpng → libz); everything else keeps its place.
    // Backslash-agnostic (file mixes `\$<...>` and `$<...>` spellings).
    const rankArchive = (token: string): number => {
      if (token.includes("libtiff.a")) return 0
      if (token.includes("libjpeg.a")) return 1
      if (token.includes("libpng.a")) return 2
      if (token.includes("libz.a")) return 3
      return 9
    }
    const ordered = patched.replace(/INTERFACE_LINK_LIBRARIES "([^"]*)"/g, (m, list) => {
      const tokens = (list as string).split(";")
      const ranked = tokens
        .map((t, i) => ({ t, i, r: rankArchive(t) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map((x) => x.t)
      return `INTERFACE_LINK_LIBRARIES "${ranked.join(";")}"`
    })
    if (ordered.indexOf("libtiff.a") === -1 || ordered.indexOf("libjpeg.a") === -1) {
      fail("leptonica link-order patch failed (archives missing)")
    }
    if (ordered.indexOf("libtiff.a") > ordered.indexOf("libjpeg.a")) {
      fail("leptonica link-order patch failed (libtiff must precede libjpeg)")
    }
    await runner.writeFile(f, ordered)
  }

  log(`tesseract ${TESSERACT_VERSION}`)
  const tessSrc = join(buildRoot, "tesseract")
  await extract("tesseract-5.5.3.tar.gz", tessSrc)
  await cmakeConfigure(runner, {
    src: tessSrc,
    build: join(buildRoot, "build-tesseract"),
    prefix,
    toolchain,
    args: [
      "-DBUILD_TRAINING_TOOLS=OFF", "-DBUILD_TESTS=OFF", "-DOPENMP_BUILD=OFF",
      "-DDISABLE_CURL=ON", "-DDISABLE_ARCHIVE=ON", "-DBUILD_SHARED_LIBS=OFF",
      ...linuxStaticExeLink,
    ],
  })
  await cmakeBuildInstall(runner, join(buildRoot, "build-tesseract"), jobs)

  const bin = join(prefix, "bin", "tesseract")
  log(`gating ${bin}`)
  const versionOut = await runner.capture([bin, "--version"], { env: cflags })
  if (!versionOut.includes(`tesseract ${TESSERACT_VERSION}`)) {
    fail(`version gate failed: ${versionOut.split("\n")[0]}`)
  }
  log(`version ok: ${versionOut.split("\n")[0]}`)
  if (os === "darwin") {
    const linked = await runner.capture(["otool", "-L", bin])
    if (/homebrew|\/opt\/|\/usr\/local\//i.test(linked)) fail(`linkage gate failed: ${linked.slice(0, 300)}`)
    log("linkage ok (system libs only)")
  } else {
    const info = await runner.capture(["file", bin])
    if (!info.includes("statically linked")) fail(`linkage gate failed: ${info.slice(0, 200)}`)
    log("linkage ok (fully static)")
  }
  log(`done → ${bin}`)
  return bin
}
