import type { Page } from '@playwright/test';
import {
  aiFindingsNote,
  expect,
  expectSurfaceUsable,
  REPORT_DIR,
  test,
  waitForScreenSettled,
} from '../fixtures';

/**
 * WCAG scan of the three **display modes** the application has never been rendered in by any
 * layer: dark theme, Windows High Contrast (`forced-colors: active`), and reduced motion.
 *
 * ## Why these three, and why now
 *
 * None had ever been set in this repository, and each covers a criterion nothing else reaches.
 * Two are one line of Playwright configuration (`forcedColors` and `reducedMotion` appeared in
 * no config or spec). The dark theme is deliberately **not** — it is seeded through the app's
 * own `data-app-theme`, not Playwright's `colorScheme`, for the reason given below.
 *
 *   - **Dark theme** changes every colour pair on the page, so `color-contrast` has to be
 *     re-measured. The light-theme result says nothing about it.
 *   - **Forced colors** (1.4.8 / 1.4.11 in practice) replaces author colours with a user palette.
 *     The repository contains **no** `forced-colors`, `-ms-high-contrast` or `forced-color-adjust`
 *     rule anywhere, so nothing has been adapted for it.
 *   - **Reduced motion** (2.3.3, and a vestibular-safety concern well beyond it) is the one with
 *     a defect already visible in the source — see below.
 *
 * ## The trap this file exists to avoid, in two parts
 *
 * **Dark mode is not `prefers-color-scheme` here.** `AppThemeService` sets a `data-app-theme`
 * attribute on `<html>` from a `localStorage` key, and `styles.scss` keys its palettes off that
 * attribute. Setting Playwright's `colorScheme: 'dark'` would flip the browser's own form-control
 * rendering and change nothing about the application's theme — a scan that looks like it covered
 * dark mode and did not. This file seeds the storage key instead, then asserts the resolved
 * background is actually dark before scanning.
 *
 * **A zero under reduced motion proves nothing on its own.** If the measurement is broken it also
 * reports zero. Every motion measurement below is therefore run twice, once with
 * `reducedMotion: 'reduce'` and once with `'no-preference'`, and the control is what gives the
 * reduced number meaning.
 *
 * ## What the motion measurement actually found — read this before trusting a verdict
 *
 * This application binds no Angular animation trigger in any template, so route changes are
 * instant and there is no transition to measure. The reduced-motion check below is therefore a
 * **tripwire, not a result** — and getting it to say so honestly took two attempts:
 *
 *   - The first run reported "reduced motion is NOT honoured, longest 6665ms". That was wrong.
 *     Identifying each animation showed all of them were `mdc-circular-progress__*` — Material's
 *     indeterminate spinner, a looping CSS animation that runs regardless of any route change.
 *     **Zero finite animations were observed in either run**, so no route transition was ever
 *     captured and the verdict was about furniture.
 *   - The fix was identification, not more sampling. The report now records each animation's
 *     target, effective duration, iteration count and shape (easing, direction, keyframes),
 *     distinguishes looping from finite, and prints
 *     INCONCLUSIVE rather than a verdict when the control saw no finite animation. That is what
 *     stopped the wrong claim, and it is the load-bearing part of this file.
 *
 * When someone does bind an animation trigger, this spec starts returning a real verdict. Two
 * things to get right then, because a previous iteration of this work got both wrong: durations
 * must read `--app-motion-duration-*` or `matchMedia` rather than being hardcoded, and a
 * `prefers-reduced-motion` block in a stylesheet cannot reach Angular animations at all, because
 * they run through the Web Animations API.
 *
 * Separately and genuinely live: the spinners keep looping under `prefers-reduced-motion:
 * reduce`. Whether an indeterminate progress spinner should stop is a judgement call, but it is
 * a real observation about the running application rather than about dead files.
 *
 * Run:  npm run a11y:scan -- modes
 */

const THEME_STORAGE_KEY = 'agentic_ui_color_theme';

/** The same six surfaces `surfaces.a11y.spec.ts` covers, so results are comparable. */
const ROUTES: ReadonlyArray<readonly [label: string, route: string, host: string]> = [
  ['browse', '/#/browse', 'lib-browse'],
  ['search', '/#/search', 'lib-search'],
  ['trash', '/#/trash', 'lib-trash'],
  ['tasks', '/#/tasks', 'lib-tasks-page'],
  ['administration', '/#/administration', 'lib-administration-shell'],
  ['knowledge discovery', '/#/knowledge-discovery', 'lib-knowledge-discovery'],
];

interface ModeResult {
  readonly mode: string;
  readonly route: string;
  readonly findings: number;
  readonly blockers: number;
  readonly rules: readonly string[];
}
const results: ModeResult[] = [];

/** One animation observed mid-flight, identified well enough to tell what produced it. */
interface ObservedAnimation {
  readonly target: string;
  /**
   * What is animating on that target: `transitionProperty` for a CSS transition,
   * `animationName` for a CSS animation, the effect `id` otherwise (empty when unset).
   * `target` + `kind` is not an identity — one element routinely runs several transitions at
   * once, one per property — so without this the verdict could compare a reduced `transform`
   * against a control `opacity`. Flagged in review on PR #225.
   */
  readonly name: string;
  /**
   * Per iteration, as it plays: the declared duration divided by `playbackRate`. The declared
   * duration alone would read an animation sped up to honour the preference as unchanged.
   */
  readonly durationMs: number;
  readonly iterations: string;
  readonly kind: string;
  /**
   * What the motion looks like: easing, direction and the keyframes from `getKeyframes()`.
   * Same target and duration is not the same motion — an implementation can honour the
   * preference by animating opacity instead of a transform, or by moving 0px — so "ran
   * unchanged" also requires this to match.
   */
  readonly shape: string;
}

/** Max concurrent animations and longest declared duration seen while `action` ran. */
interface MotionSample {
  readonly peakConcurrent: number;
  readonly longestMs: number;
  readonly totalObserved: number;
  /** Deduplicated by full identity. The reason the raw counts above are interpretable. */
  readonly animations: readonly ObservedAnimation[];
}
const motion: Array<{ label: string; sample: MotionSample }> = [];

/**
 * State the motion probe parks on the page between its two `page.evaluate()` calls.
 *
 * Declared as a real `Window` augmentation rather than reached by casting `window` to an
 * inline shape in each block. `review:guardrails` flagged the cast version as a broad type
 * escape, and rightly: it restated the shape twice, so the two halves of the probe could drift
 * and the compiler would not notice.
 */
declare global {
  interface Window {
    __motionProbe?: {
      frames: number[];
      seen: ObservedAnimation[];
      raf?: number;
    };
  }
}

/** What was painted behind the page, and whether anything was painted at all. */
interface BackgroundMeasurement {
  /** `null` when no opaque surface was found, so darkness was not measured. */
  readonly luminance: number | null;
  /** Which element supplied the colour, or every colour tried when none was opaque. */
  readonly from: string;
}

/**
 * Relative luminance of the painted page background, so "the dark theme applied" is
 * measurable rather than assumed.
 *
 * **Alpha is the whole difficulty.** This read `document.body` and ignored the alpha channel.
 * A transparent body computes as `rgba(0, 0, 0, 0)`; the digit match took the first three
 * zeros, luminance came out `0`, and the assertion passed as "dark" having measured nothing
 * at all — on a page that may have been rendering the default light palette. Flagged in
 * review on PR #225.
 *
 * So the search is for an **opaque** surface, body first and then the root, and finding none
 * is reported rather than substituted for. If neither is opaque the canvas shows through to
 * the UA default, which is not dark and is not ours to measure either way.
 */
async function backgroundLuminance(page: Page): Promise<BackgroundMeasurement> {
  return page.evaluate(() => {
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };

    // `[\d.]+` rather than `\d+(\.\d+)?` so a fractional alpha is captured as one number:
    // the old pattern split `0.5` into `0` and `5` and shifted every channel along.
    const parse = (css: string) => {
      const n = css.match(/[\d.]+/g)?.map(Number);
      if (!n || n.length < 3) return null;
      return { r: n[0] ?? 0, g: n[1] ?? 0, b: n[2] ?? 0, alpha: n.length > 3 ? (n[3] ?? 1) : 1 };
    };

    const tried: string[] = [];
    for (const el of [document.body, document.documentElement]) {
      const css = getComputedStyle(el).backgroundColor;
      tried.push(`${el.tagName.toLowerCase()}=${css}`);
      const c = parse(css);
      if (c && c.alpha === 1) {
        return {
          luminance: 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b),
          from: `${el.tagName.toLowerCase()} ${css}`,
        };
      }
    }
    return { luminance: null, from: tried.join(', ') };
  });
}

/**
 * Sample `document.getAnimations()` every frame while a route change runs.
 *
 * `getAnimations()` is the right instrument precisely because Angular's animations go through the
 * Web Animations API — a CSS-only probe would miss them entirely, which is the same blind spot
 * that makes a `prefers-reduced-motion` stylesheet block look like it covers them when it cannot.
 *
 * The navigation is driven by assigning `location.hash` rather than `page.goto`, because the app
 * uses hash routing: `goto` would be a document load and the router's `:enter`/`:leave`
 * transitions would never run.
 */
async function measureRouteChangeMotion(page: Page, toHash: string): Promise<MotionSample> {
  await page.evaluate(() => {
    const probe: NonNullable<Window['__motionProbe']> = { frames: [], seen: [] };
    window.__motionProbe = probe;

    // A structural path from the root, not `tag#id.firstClass`. The short form is shared by
    // every sibling of the same kind — seven `.tree-node` spinners read as one element — so
    // two animations on different elements merged into one `seen` entry, and the verdict
    // paired a reduced animation with a control animation on some other element. Flagged in
    // review on PR #225. `:nth-of-type` makes each segment unique among its siblings, so the
    // path is unique in the document at the moment it is read; the first class stays for
    // readability.
    //
    // Pairing the control and reduced runs relies on the path being the same in both, which
    // holds when both load the same route into the same DOM — what the two motion tests do.
    // Two things could still move it mid-transition, and only one is handled: Angular's own
    // `ng-*` classes (`ng-animating`, `ng-star-inserted`, `ng-tns-…`) come and go during an
    // animation, so they are skipped; a sibling entering or leaving can still shift an
    // `:nth-of-type` index. That usually leaves the animation without a counterpart, which
    // the verdict reports as INCONCLUSIVE rather than as a pass or a failure.
    const describe = (el: Element | null): string => {
      if (!el) return '(no target)';
      const segments: string[] = [];
      let node: Element | null = el;
      while (node && node !== document.documentElement) {
        const current: Element = node;
        const parent = current.parentElement;
        const cls = (current.getAttribute('class') || '')
          .split(/\s+/)
          .filter((c) => c && !c.startsWith('ng-'))[0];
        const sameTag = parent
          ? Array.from(parent.children).filter((c) => c.tagName === current.tagName)
          : [];
        const nth = sameTag.length > 1 ? `:nth-of-type(${sameTag.indexOf(current) + 1})` : '';
        segments.unshift(`${current.tagName.toLowerCase()}${cls ? '.' + cls : ''}${nth}`);
        node = parent;
      }
      return segments.join(' > ');
    };

    const sample = () => {
      const running = document.getAnimations();
      probe.frames.push(running.length);
      for (const a of running) {
        const t = a.effect?.getTiming();
        const d = typeof t?.duration === 'number' ? t.duration : 0;
        // `instanceof KeyframeEffect` rather than casting: `target` lives on KeyframeEffect,
        // not on the AnimationEffect base, so this is a real narrowing and an effect that is
        // some other subtype is reported as "(no target)" instead of reading as undefined.
        const effect = a.effect;
        const target = describe(effect instanceof KeyframeEffect ? effect.target : null);
        const iterations = String(t?.iterations ?? 1);
        // `CSSAnimation`/`CSSTransition` vs a bare `Animation` is exactly the distinction that
        // separates a CSS-driven effect from an Angular/WAAPI one, and it is what tells us
        // whether a CSS media query could ever have reached it.
        const kind = a.constructor?.name ?? 'Animation';
        const name =
          a instanceof CSSTransition
            ? a.transitionProperty
            : a instanceof CSSAnimation
              ? a.animationName
              : a.id;

        // Build the key from the SAME rounded value that gets stored, and include
        // `iterations`.
        //
        // Two bugs in one line before this. The key used the raw `d` while `seen` stores
        // `Math.round(d)`, so any fractional duration — which `getTiming()` readily returns —
        // never matched and the same animation was appended on every frame, inflating the
        // list to hundreds of identical rows. And omitting `iterations` merged a finite
        // animation with a looping one of the same target and duration, which is precisely
        // the distinction the reduced-motion verdict is computed from. Flagged in review on
        // PR #225.
        //
        // A paused animation (`playbackRate` 0) keeps its declared duration rather than
        // dividing by zero; it is still told apart from a running one by `shape`.
        const rate = a.playbackRate;
        const durationMs = Math.round(rate === 0 ? d : d / Math.abs(rate));
        // `computedOffset` is dropped: it is derived from `offset`, so it adds nothing to
        // compare and only lengthens the key.
        const keyframes =
          effect instanceof KeyframeEffect
            ? effect.getKeyframes().map(({ computedOffset: _derived, ...frame }) => frame)
            : [];
        const shape = JSON.stringify({
          easing: t?.easing ?? 'linear',
          direction: t?.direction ?? 'normal',
          reversed: rate < 0,
          paused: rate === 0,
          keyframes,
        });
        const identity = (s: ObservedAnimation) =>
          `${s.target}|${s.name}|${s.durationMs}|${s.iterations}|${s.kind}|${s.shape}`;
        const observed: ObservedAnimation = { target, name, durationMs, iterations, kind, shape };
        const key = identity(observed);
        if (!probe.seen.some((s) => identity(s) === key)) {
          probe.seen.push(observed);
        }
      }
      probe.raf = requestAnimationFrame(sample);
    };
    probe.raf = requestAnimationFrame(sample);
  });

  await page.evaluate((h) => {
    location.hash = h;
  }, toHash);
  // Long enough to contain the longest declared transition (320ms) with headroom.
  await page.waitForTimeout(900);

  return page.evaluate(() => {
    const probe = window.__motionProbe;
    if (probe?.raf) cancelAnimationFrame(probe.raf);
    const frames = probe?.frames ?? [];
    const seen = probe?.seen ?? [];
    return {
      peakConcurrent: frames.reduce((m, n) => Math.max(m, n), 0),
      longestMs: seen.reduce((m, s) => Math.max(m, s.durationMs), 0),
      totalObserved: frames.reduce((n, f) => n + f, 0),
      animations: seen,
    };
  });
}

// ───────────────────────────── dark theme ─────────────────────────────

test.describe('accessibility: dark theme', () => {
  test.beforeEach(async ({ signedIn: page }) => {
    // Seeded before any navigation so `AppThemeService` reads it during app init, rather than
    // being flipped afterwards and re-scanning a page mid-transition.
    await page.addInitScript(({ key }) => localStorage.setItem(key, 'dark'), {
      key: THEME_STORAGE_KEY,
    });
  });

  for (const [label, route, host] of ROUTES) {
    test(`scans ${label} in dark theme`, async ({ signedIn: page, a11y }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      await waitForScreenSettled(page, host, route === '/#/browse');
      // Not a bare host check: a failed load renders the same host with an error panel, and a
      // dark-themed error panel would be scanned and counted as the route. See
      // `expectSurfaceUsable`.
      await expectSurfaceUsable(page, host, `${label} (dark theme)`);

      // Two assertions, because either alone is satisfiable while dark mode is not actually on:
      // the attribute can be set by something that failed to load a palette, and a dark
      // background can occur in the default theme. Together they mean the palette applied.
      await expect(
        page.locator('html'),
        'the dark palette must be selected, or this scan is a light-theme scan with a dark label',
      ).toHaveAttribute('data-app-theme', 'dark');
      const bg = await backgroundLuminance(page);
      expect(
        bg.luminance,
        `nothing opaque was painted behind the page (${bg.from}), so "dark" was not measured. ` +
          'A transparent background computes as rgba(0, 0, 0, 0), whose luminance is 0 — this ' +
          'assertion used to pass on exactly that, having measured no palette at all.',
      ).not.toBeNull();
      // `?? 1` cannot mask a failure: the assertion above has already failed if it is null,
      // and 1 is white, so this line would fail too rather than wave it through.
      const lum = bg.luminance ?? 1;
      expect(lum, `${bg.from} luminance ${lum.toFixed(3)} is not dark`).toBeLessThan(0.2);

      const { findings } = await a11y.scanPage({
        level: 'AA',
        failOnBlockers: false,
        noFocusIndicatorScreenshots: true,
        // Off deliberately. Dark theme changes colour, not focus order or trap behaviour, and
        // `surfaces.a11y.spec.ts` already walks these routes. NOTE: this also disables the
        // reflow scanner, which rides the same flag in a11y-scout's upstream `scan-page.ts`;
        // reflow is covered
        // separately by `a11y/diagnostics/reflow-probe.mjs`.
        keyboard: false,
        extraWaitMs: 400,
      });
      results.push({
        mode: 'dark',
        route: label,
        findings: findings.length,
        blockers: findings.filter((f) => f.severity === 'blocker').length,
        rules: [...new Set(findings.map((f) => f.ruleId))].sort(),
      });
    });
  }
});

// ─────────────────────── forced colors (high contrast) ───────────────────────

test.describe('accessibility: forced colors', () => {
  test.use({ forcedColors: 'active' });

  for (const [label, route, host] of ROUTES) {
    test(`scans ${label} in forced-colors mode`, async ({ signedIn: page, a11y }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      await waitForScreenSettled(page, host, route === '/#/browse');
      await expectSurfaceUsable(page, host, `${label} (forced colors)`);

      // Prove the emulation reached the page. Without this the whole describe could silently
      // run in normal colours and report a clean high-contrast pass.
      const active = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
      expect(active, 'forced-colors emulation did not reach the page').toBe(true);

      const { findings } = await a11y.scanPage({
        level: 'AA',
        failOnBlockers: false,
        noFocusIndicatorScreenshots: true,
        keyboard: false,
        extraWaitMs: 400,
      });
      results.push({
        mode: 'forced-colors',
        route: label,
        findings: findings.length,
        blockers: findings.filter((f) => f.severity === 'blocker').length,
        rules: [...new Set(findings.map((f) => f.ruleId))].sort(),
      });
    });
  }
});

// ───────────────────────────── reduced motion ─────────────────────────────

/**
 * The experiment, not a scan: does the application actually stop animating when asked to?
 *
 * Two runs of one measurement. The control establishes that the probe can see this application's
 * animations at all; the reduced run is only interpretable against it.
 */
test.describe('accessibility: motion', () => {
  test.describe('control — no motion preference', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('route change animates normally', async ({ signedIn: page }) => {
      await page.goto('/#/browse', { waitUntil: 'networkidle' });
      // Same standard as every other scan here: a failed load renders lib-browse with an
      // error panel inside it, and an error panel animates exactly as little as a working
      // page does — so a bare host check would let the control "observe no animations" for
      // the wrong reason and make the reduced-motion result uninterpretable in silence.
      //
      // Settled first, in both runs, so the sample is the route change and not the tail of
      // the load: a tree still loading contributes spinners to one run and not the other.
      await waitForScreenSettled(page, 'lib-browse', true);
      await expectSurfaceUsable(page, 'lib-browse', 'browse (motion control)');
      const sample = await measureRouteChangeMotion(page, '#/search');
      motion.push({ label: 'no-preference', sample });

      // If this is zero the probe is broken and the reduced-motion number below means nothing.
      expect(
        sample.peakConcurrent,
        'the control observed no animations at all — the probe cannot see this app, so the ' +
          'reduced-motion result is not interpretable',
      ).toBeGreaterThan(0);
    });
  });

  test.describe('with prefers-reduced-motion: reduce', () => {
    test.use({ reducedMotion: 'reduce' });

    test('route change respects the preference', async ({ signedIn: page }) => {
      await page.goto('/#/browse', { waitUntil: 'networkidle' });
      await waitForScreenSettled(page, 'lib-browse', true);
      await expectSurfaceUsable(page, 'lib-browse', 'browse (reduced motion)');

      const honoured = await page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches,
      );
      expect(honoured, 'reduced-motion emulation did not reach the page').toBe(true);

      const sample = await measureRouteChangeMotion(page, '#/search');
      motion.push({ label: 'reduce', sample });
    });
  });
});

// ───────────────────────────── report ─────────────────────────────

test.describe('accessibility: display modes report', () => {
  test('emits the consolidated report', async ({ a11y }) => {
    const { state, reportPaths } = await a11y.generateReport({
      outDir: REPORT_DIR,
      reportName: 'nuxeo-satori-display-modes',
      failOnBlockers: false,
    });

    const byMode = new Map<string, ModeResult[]>();
    for (const r of results) byMode.set(r.mode, [...(byMode.get(r.mode) ?? []), r]);

    const lines: string[] = [
      '',
      `  ai findings : ${aiFindingsNote(state)}`,
      '',
      '  findings by display mode',
      '',
    ];
    for (const [mode, rows] of byMode) {
      const total = rows.reduce((n, r) => n + r.findings, 0);
      const blockers = rows.reduce((n, r) => n + r.blockers, 0);
      lines.push(
        `  ${mode}  —  ${total} findings, ${blockers} blockers across ${rows.length} routes`,
      );
      for (const r of rows) {
        lines.push(
          `    ${r.route.padEnd(22)} ${String(r.findings).padStart(3)}  ${r.rules.join(', ') || '—'}`,
        );
      }
      lines.push('');
    }

    lines.push('  motion — animations observed during one route change');
    // Looping animations are ambient furniture — indeterminate spinners, skeleton shimmer — and
    // they run whether or not a route changed. Counting them as evidence of a route transition
    // is how a probe ends up reporting a confident verdict about something it never measured.
    //
    // **Only an infinite count is looping.** This also excluded anything with `iterations > 1`,
    // but a route transition may legitimately run two or three times and is still finite and
    // still caused by the navigation. Discarding those dropped them from both the control and
    // the reduced sample, so the verdict below read INCONCLUSIVE — "no transitions to compare"
    // — in the one case it most needs to catch, reduced motion being ignored by an animation
    // that repeats. Flagged in review on PR #225.
    const isAmbient = (a: ObservedAnimation) => a.iterations === 'Infinity';
    const describeAnimation = (a: ObservedAnimation) =>
      `${a.kind.padEnd(13)} ${a.target}${a.name ? ` (${a.name})` : ''}`;
    for (const m of motion) {
      const transitions = m.sample.animations.filter((a) => !isAmbient(a));
      const ambient = m.sample.animations.filter(isAmbient);
      lines.push(
        `    ${m.label}  —  peak concurrent ${m.sample.peakConcurrent}, ` +
          `${transitions.length} finite, ${ambient.length} looping`,
      );
      for (const a of m.sample.animations) {
        lines.push(
          `      ${isAmbient(a) ? 'loop  ' : 'finite'} ${String(a.durationMs).padStart(5)}ms  ` +
            describeAnimation(a),
        );
      }
    }
    const control = motion.find((m) => m.label === 'no-preference')?.sample;
    const reduced = motion.find((m) => m.label === 'reduce')?.sample;
    if (control && reduced) {
      const controlT = control.animations.filter((a) => !isAmbient(a));
      const reducedT = reduced.animations.filter((a) => !isAmbient(a));
      lines.push('');
      if (controlT.length === 0) {
        lines.push(
          '    INCONCLUSIVE: the control observed no finite animation during the route change,',
          '    so this probe did not capture a route transition at all and the reduced-motion',
          '    number below says nothing. Only looping/ambient animations were seen.',
        );
      } else if (reducedT.length === 0) {
        lines.push(
          `    VERDICT: reduced motion IS honoured — ${controlT.length} finite animation(s) with`,
          '    no preference, none under prefers-reduced-motion: reduce.',
        );
      } else {
        // A finite animation surviving under `reduce` is not, by itself, evidence the
        // preference was ignored: an implementation may shorten or simplify an animation
        // rather than remove it. This branch used to say NOT honoured on the mere presence of
        // one. Flagged in review on PR #225.
        //
        // So each reduced animation is paired with the control animation of the same target,
        // kind and name (property or animation name — see `ObservedAnimation.name`). Only an
        // animation that ran UNCHANGED — same effective duration, iterations, easing, direction
        // and keyframes — proves the preference was ignored. Matching on duration and
        // iterations alone would call a fade that replaced a slide "unchanged". Flagged in
        // review on PR #225. Shortened ones are reported as such, and anything without a counterpart
        // cannot be judged either way.
        const counterpart = (a: ObservedAnimation) =>
          controlT.find((c) => c.target === a.target && c.kind === a.kind && c.name === a.name);
        const unchanged = reducedT.filter((a) => {
          const c = counterpart(a);
          return (
            c !== undefined &&
            a.durationMs >= c.durationMs &&
            a.iterations === c.iterations &&
            a.shape === c.shape
          );
        });
        const shortened = reducedT.filter((a) => {
          const c = counterpart(a);
          return c !== undefined && a.durationMs < c.durationMs;
        });
        // Everything else: no counterpart at all, or a counterpart that differs in some way
        // other than being shorter (a changed iteration count, easing or keyframes, say). A
        // changed shape may be a reduction or may not — a different easing is not less motion —
        // so it is not counted as one. Neither can be judged,
        // and letting them fall through to the "reduced" branch would drop them from the
        // report while claiming every animation had been accounted for.
        const unpaired = reducedT.filter((a) => !unchanged.includes(a) && !shortened.includes(a));

        if (unchanged.length > 0) {
          lines.push(
            `    VERDICT: reduced motion is NOT honoured — ${unchanged.length} animation(s) ran`,
            '    unchanged under the preference — same target, kind and name, and the same',
            '    effective duration, iterations, easing, direction and keyframes as the control:',
            ...unchanged.map((a) => `      ${a.durationMs}ms  ${describeAnimation(a)}`),
          );
        } else if (unpaired.length > 0) {
          lines.push(
            `    INCONCLUSIVE: ${unpaired.length} finite animation(s) ran under the preference with no`,
            '    comparable animation in the control (none on the same target, kind and name, or one',
            '    that differs other than by being shorter — in iterations, easing, direction or',
            '    keyframes), so they cannot be judged either way.',
            ...unpaired.map((a) => `      ${a.durationMs}ms  ${describeAnimation(a)}`),
          );
        } else {
          lines.push(
            `    REDUCED, NOT REMOVED — all ${shortened.length} finite animation(s) under the preference`,
            '    are shorter versions of control animations. That is a legitimate reduction; whether',
            '    it is enough is a judgement about the motion, not something this probe measures:',
            ...shortened.map((a) => {
              const c = counterpart(a);
              return `      ${c?.durationMs ?? '?'}ms -> ${a.durationMs}ms  ${describeAnimation(a)}`;
            }),
          );
        }
      }
    }
    lines.push(
      '',
      `  total findings : ${state.findings.length}`,
      `  report         : ${reportPaths.html}`,
      '',
    );

    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    // Assert the deliverable: both colour modes covered every route, and both motion runs
    // recorded. A mode that silently skipped would otherwise read as a clean mode.
    expect(
      results.filter((r) => r.mode === 'dark').length,
      'dark theme must cover every route',
    ).toBe(ROUTES.length);
    expect(
      results.filter((r) => r.mode === 'forced-colors').length,
      'forced-colors must cover every route',
    ).toBe(ROUTES.length);
    expect(motion.length, 'both motion runs must have recorded').toBe(2);
  });
});
