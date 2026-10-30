import { DOCUMENT } from '@angular/common';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { TimeoutError, catchError, firstValueFrom, of, timeout } from 'rxjs';

import {
  AppBootstrapConfig,
  AppThemeConfig,
  DEFAULT_APP_BOOTSTRAP_CONFIG,
  describeBrandingLogoRefusal,
  describeSsoEndpointPathForm,
  mergeBootstrapConfig,
  nuxeoOriginsOf,
  resolveBrandingLogoUrl,
  resolveTheme,
} from './bootstrap-config';
import { APP_BOOTSTRAP_CONFIG_URL, APP_MANIFEST_CONFIG_URL } from './app-config.tokens';
import {
  AppConfigFragment,
  AppConfigFragmentInfo,
  AppConfigLayer,
  AppConfigResponse,
  AppConfigServerDiagnostic,
  readConfigResponse,
} from './config-response';
import { AppPreset, PRESET_STORAGE_KEY, readPresales, requestedPreset } from './presales-presets';
import {
  AppRuntimeManifest,
  DEFAULT_APP_RUNTIME_MANIFEST,
  mergeRuntimeManifest,
} from './runtime-manifest';

/**
 * How long each half may take before the application starts on the packaged defaults instead.
 * `load()` runs as an `APP_INITIALIZER` and `HttpClient` has no timeout of its own, so a server that
 * accepts the request and never answers would otherwise hold the first render forever.
 */
export const CONFIG_LOAD_TIMEOUT_MS = 10_000;

/** Where a loaded half of the configuration came from, so the shell can show it rather than guess. */
export type AppConfigSource = 'packaged-default' | 'configuration-service';

export interface AppConfigDiagnostics {
  readonly bootstrapSource: AppConfigSource;
  readonly manifestSource: AppConfigSource;
  /** The fragments applied, in order, with the package component that contributed each. */
  readonly bootstrapFragments: readonly AppConfigFragmentInfo[];
  readonly manifestFragments: readonly AppConfigFragmentInfo[];
  /** What the server reported about contributions it rejected, replaced or removed. */
  readonly serverDiagnostics: readonly AppConfigServerDiagnostic[];
  /** Human-readable reasons a load fell back or a preset was refused, in the order they happened. */
  readonly messages: readonly string[];
}

/** The presales preset in force, for the badge that says so. */
export interface AppActivePreset {
  readonly name: string;
  readonly label: string;
}

/**
 * Loads the two halves of the Layer 0/1 configuration and exposes them as signals.
 *
 * Both come from the server's configuration service: `bootstrap.json` and `manifest.json`, each an
 * ordered list of fragments contributed by Marketplace packages. Both are anonymous, so they are
 * fetched once, together, before sign-in, and nothing about them changes with the session.
 *
 * Uses an `HttpClient` of its own, built on `HttpBackend`, which the repository otherwise reserves
 * for `NuxeoApiBase`. That is deliberate and confined to this service: these two requests skip
 * every interceptor. An interceptor that reads configuration — the host application's auth
 * interceptor resolves the Nuxeo API origin and the sign-in services — would otherwise resolve it
 * while it is still loading, and Angular keeps a token's first value for the life of the
 * application, so every package-contributed value it read would be replaced by its default. Both
 * halves are anonymous, so skipping the interceptor also keeps the signed-in user's
 * `Authorization` header off them.
 *
 * The load is **tolerant by contract**. An unreachable service, an error status, a malformed
 * response or no answer within {@link CONFIG_LOAD_TIMEOUT_MS} falls back to the packaged defaults
 * and records why. The application must start on a server where nothing is configured.
 */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly bootstrapUrl = inject(APP_BOOTSTRAP_CONFIG_URL);
  private readonly manifestUrl = inject(APP_MANIFEST_CONFIG_URL);
  private readonly document = inject(DOCUMENT);

  private readonly bootstrapConfig = signal<AppBootstrapConfig>(DEFAULT_APP_BOOTSTRAP_CONFIG);
  private readonly runtimeManifest = signal<AppRuntimeManifest>(DEFAULT_APP_RUNTIME_MANIFEST);
  private readonly presetState = signal<AppActivePreset | null>(null);
  /**
   * The resolved logo URL a brand surface reported it could not show. Keyed by URL rather than a
   * bare flag, so a configuration that later names a different logo gets a fresh attempt.
   */
  private readonly failedLogoUrl = signal<string | null>(null);
  private loading: Promise<void> | null = null;
  private readonly diagnosticsState = signal<AppConfigDiagnostics>({
    bootstrapSource: 'packaged-default',
    manifestSource: 'packaged-default',
    bootstrapFragments: [],
    manifestFragments: [],
    serverDiagnostics: [],
    messages: [],
  });

  readonly bootstrap = this.bootstrapConfig.asReadonly();
  readonly manifest = this.runtimeManifest.asReadonly();
  readonly diagnostics = this.diagnosticsState.asReadonly();
  /** The presales preset in force, or `null`. Only ever set where a package enables switching. */
  readonly activePreset = this.presetState.asReadonly();

  /** Themes available to the theme picker — packaged ones merged with configured ones. */
  readonly themes = computed<readonly AppThemeConfig[]>(() => this.bootstrapConfig().themes);

  /**
   * The configured logo with its `src` resolved to the URL an `<img>` loads, or `null` to keep the
   * Satori marks. Resolved here because only this service knows where `bootstrap.json` came from.
   *
   * It also goes back to `null` once a brand surface reports that the browser could not show the
   * logo — see {@link reportBrandingLogoUnavailable}. Both brand surfaces read this one signal, so
   * the image, the packaged mark and the brand link's accessible name always agree.
   */
  readonly brandingLogo = computed<{ readonly url: string; readonly alt: string } | null>(() => {
    const config = this.bootstrapConfig();
    const logo = config.branding.logo;
    if (!logo) return null;
    const baseUri = this.document.baseURI;
    // Guarded for the same reason as the diagnostic pass: a malformed `APP_BOOTSTRAP_CONFIG_URL`
    // override would otherwise throw out of this computed, from whichever template read it.
    const configUrl = parseUrlOrNull(this.bootstrapUrl, baseUri)?.href;
    if (configUrl === undefined) return null;
    const url = resolveBrandingLogoUrl(logo.src, configUrl, nuxeoOriginsOf(config, baseUri));
    if (url === null || url === this.failedLogoUrl()) return null;
    return { url, alt: logo.alt };
  });

  /**
   * A configured logo the browser could not show, so the brand surfaces fall back to the packaged
   * Satori marks instead of holding an image nobody can see.
   *
   * Every check before this one runs before the image is ever requested: `isAcceptedLogoSrc` on
   * the string as written, and `resolveBrandingLogoUrl` on where the resolved URL points. Neither
   * can know whether the bytes exist, decode, or are allowed cross-origin, which is why the
   * outcome has to come back from the element that loaded it (NXSAT-721).
   *
   * This message **does** say the Satori marks are in use, where {@link noteRefusedLogos}
   * deliberately does not, and the difference is not an inconsistency. By the time a logo is
   * loaded the merge has already settled which contribution won, so suppressing that one URL
   * leaves nothing for `brandingLogo` to return and the packaged marks are what renders. A
   * configuration-time refusal happens *during* the merge, where an earlier layer's valid logo
   * survives, so the same claim there would often be false (review of PR 512).
   */
  reportBrandingLogoUnavailable(url: string, reason: string): void {
    if (!url || this.failedLogoUrl() === url) return;
    this.failedLogoUrl.set(url);
    this.note(`branding.logo not shown, using the Satori marks instead — ${reason}: ${url}`);
  }

  /**
   * Fetch both halves, choose the preset, and apply everything in order. Never rejects, so it is
   * safe as an `APP_INITIALIZER`.
   *
   * Runs once: a later call returns the first call's promise. That is what lets another
   * initializer wait for the configuration instead of racing it, since Angular runs
   * `APP_INITIALIZER` functions concurrently.
   */
  load(): Promise<void> {
    this.loading ??= this.fetchAndApply();
    return this.loading;
  }

  private async fetchAndApply(): Promise<void> {
    const [bootstrap, manifest] = await Promise.all([
      this.fetch(this.bootstrapUrl, 'bootstrap'),
      this.fetch(this.manifestUrl, 'manifest'),
    ]);
    const bootstrapFragments = bootstrap?.fragments ?? [];
    const preset = this.choosePreset(bootstrapFragments.map((fragment) => fragment.content));

    let bootstrapConfig = bootstrapFragments.reduce(
      (merged, fragment) => mergeBootstrapConfig(merged, fragment.content),
      DEFAULT_APP_BOOTSTRAP_CONFIG,
    );
    let runtimeManifest = (manifest?.fragments ?? []).reduce(
      (merged, fragment) => mergeRuntimeManifest(merged, fragment.content),
      DEFAULT_APP_RUNTIME_MANIFEST,
    );
    if (preset) {
      bootstrapConfig = mergeBootstrapConfig(bootstrapConfig, preset.bootstrap);
      runtimeManifest = mergeRuntimeManifest(runtimeManifest, preset.manifest);
    }

    this.bootstrapConfig.set(bootstrapConfig);
    this.runtimeManifest.set(runtimeManifest);
    this.presetState.set(preset ? { name: preset.name, label: preset.label } : null);
    this.diagnosticsState.update((current) => ({
      ...current,
      bootstrapSource: bootstrap ? 'configuration-service' : 'packaged-default',
      manifestSource: manifest ? 'configuration-service' : 'packaged-default',
      bootstrapFragments: bootstrapFragments.map(info),
      manifestFragments: (manifest?.fragments ?? []).map(info),
      serverDiagnostics: [...(bootstrap?.diagnostics ?? []), ...(manifest?.diagnostics ?? [])],
    }));
    for (const { level, code, message, component } of this.diagnosticsState().serverDiagnostics) {
      console.warn(
        `[agentic-ui-config] server ${level} ${code}${component ? ` (${component})` : ''}: ${message}`,
      );
    }
    this.noteRefusedLogos(bootstrapFragments, preset, bootstrapConfig);
    this.noteRefusedSsoEndpoints(bootstrapFragments, preset);
  }

  /**
   * Report every contributed `sso.endpoints[].path` the checks refuse, naming the value, where it
   * came from and the reason.
   *
   * The same argument as {@link noteRefusedLogos}: a refused entry is dropped during the merge, so
   * by the time the configuration is assembled the bad value is gone and the sign-in button has
   * simply not appeared. Before NXSAT-731 one of these values rendered a button that left the
   * application; now it renders nothing, and an administrator who is not told why would have no
   * way to tell a refused path from one they never contributed.
   *
   * It says a value was refused and deliberately **not** which buttons end up on screen: a
   * refusal here leaves whatever `sso.endpoints` an earlier layer set, so naming an outcome from
   * one contribution's point of view would often be wrong.
   */
  private noteRefusedSsoEndpoints(
    fragments: readonly AppConfigFragment[],
    preset: AppPreset | null,
  ): void {
    for (const { label, content } of contributedSources(fragments, preset)) {
      for (const { index, path } of configuredSsoPaths(content)) {
        const reason = describeSsoEndpointPathForm(path);
        if (reason) {
          this.note(`sso.endpoints[${index}].path "${path}" from ${label} was refused — ${reason}`);
        }
      }
    }
  }

  /**
   * Report every contributed `branding.logo.src` the checks refuse, naming the value, where it came
   * from and the reason.
   *
   * Read from the contributions rather than from the merged configuration, because a refused `src`
   * is dropped during the merge: by the time the configuration is assembled the bad value is gone.
   * That is the right behaviour and it was also the whole problem — the refusal was invisible, so a
   * typo looked identical to no logo at all (NXSAT-724).
   *
   * It says a value was refused, and deliberately **not** which mark ends up on screen. A refusal
   * leaves whatever an earlier layer set, so an earlier valid logo still wins and a later valid one
   * replaces a refused earlier one; claiming the Satori marks are in use would be wrong in both
   * cases (review of PR 512).
   *
   * Runs once per load, not inside the `brandingLogo` computed, which would re-log on every
   * recomputation.
   */
  private noteRefusedLogos(
    fragments: readonly AppConfigFragment[],
    preset: AppPreset | null,
    config: AppBootstrapConfig,
  ): void {
    const baseUri = this.document.baseURI;
    // `load()` never rejects, by contract — it is an `APP_INITIALIZER`, and the application has to
    // start on the packaged defaults whatever the configuration says. A malformed
    // `APP_BOOTSTRAP_CONFIG_URL` override makes this parse throw, and reporting must not be what
    // turns a tolerated load failure into a failed startup (review of PR 512).
    const configUrl = parseUrlOrNull(this.bootstrapUrl, baseUri)?.href;
    if (configUrl === undefined) {
      this.note(
        `branding.logo values are not checked: the configuration URL "${this.bootstrapUrl}" is not a valid URL`,
      );
      return;
    }
    const nuxeoOrigins = nuxeoOriginsOf(config, baseUri);

    for (const { label, content } of contributedSources(fragments, preset)) {
      // `null` is "declares none"; `''` is "declares a blank value", which `readLogo` refuses and
      // which used to be passed over here as if nothing had been written.
      const src = configuredLogoSrc(content);
      if (src === null) continue;

      const reason = describeBrandingLogoRefusal(src, configUrl, nuxeoOrigins);
      if (reason) {
        this.note(`branding.logo "${src}" from ${label} was refused — ${reason}`);
      }
    }
  }

  /** The active theme definition for a stored or configured theme id. */
  resolveTheme(id: string | null): AppThemeConfig {
    return resolveTheme(this.bootstrapConfig(), id);
  }

  /** A manifest feature toggle, or `fallback` when no package has set it. */
  featureToggle(id: string, fallback: boolean): boolean {
    const configured = this.runtimeManifest().featureToggles[id];
    return typeof configured === 'boolean' ? configured : fallback;
  }

  private async fetch(url: string, layer: AppConfigLayer): Promise<AppConfigResponse | null> {
    const raw = await firstValueFrom(
      this.http.get<unknown>(url, { responseType: 'json' }).pipe(
        timeout(CONFIG_LOAD_TIMEOUT_MS),
        catchError((error: unknown) => of(new ConfigLoadFailure(describe(error)))),
      ),
    );
    if (raw instanceof ConfigLoadFailure) {
      this.note(`${layer} configuration not loaded from ${url}: ${raw.reason}`);
      return null;
    }
    const response = readConfigResponse(raw, layer);
    if ('invalid' in response) {
      this.note(`${layer} configuration from ${url} ignored: ${response.invalid}`);
      return null;
    }
    return response;
  }

  /**
   * The preset to apply, if switching is enabled and one is chosen. The URL wins over the stored
   * choice and replaces it; an unknown name is reported and forgotten.
   */
  private choosePreset(bootstrapFragments: readonly unknown[]): AppPreset | null {
    const presales = readPresales(bootstrapFragments);
    const view = this.document.defaultView;
    const requested = view ? requestedPreset(view.location) : undefined;
    if (!presales.presetSwitching) {
      const ignored = requested || this.stored();
      if (ignored) this.note(`preset "${ignored}" ignored: preset switching is not enabled`);
      return null;
    }
    if (requested !== undefined) this.store(requested);
    const name = requested ?? this.stored();
    if (!name) return null;
    const preset = presales.presets[name];
    if (!preset) {
      this.note(`preset "${name}" is not defined by any package`);
      this.store('');
      return null;
    }
    return preset;
  }

  private stored(): string | null {
    try {
      return this.document.defaultView?.localStorage.getItem(PRESET_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private store(name: string): void {
    try {
      const storage = this.document.defaultView?.localStorage;
      if (name) storage?.setItem(PRESET_STORAGE_KEY, name);
      else storage?.removeItem(PRESET_STORAGE_KEY);
    } catch {
      // Storage refused (private mode, quota): the preset still applies to this load.
    }
  }

  /** Recorded and logged: the product app has no page showing diagnostics, so the console is where support finds them. */
  private note(message: string): void {
    console.warn(`[agentic-ui-config] ${message}`);
    this.diagnosticsState.update((current) => ({
      ...current,
      messages: [...current.messages, message],
    }));
  }
}

function info({ name, component, bundle, source }: AppConfigFragmentInfo): AppConfigFragmentInfo {
  return { name, component, bundle, source };
}

function describe(error: unknown): string {
  if (error instanceof TimeoutError) return `no response within ${CONFIG_LOAD_TIMEOUT_MS / 1000} s`;
  const status = (error as { status?: unknown } | null)?.status;
  const message = (error as { message?: unknown } | null)?.message;
  // A 2xx failure is a body that did not parse: its status says nothing, its message says why.
  const ok = typeof status === 'number' && status >= 200 && status < 300;
  if (typeof status === 'number' && status !== 0 && !ok) return `HTTP ${status}`;
  return typeof message === 'string' ? message : 'request failed';
}

/**
 * The `branding.logo.src` a contribution declares, trimmed, or `null` when it declares none.
 *
 * Reads the raw contribution rather than the parsed configuration, so a value the merge is about
 * to discard is still visible to report on.
 *
 * `null` and `''` are kept apart on purpose: returning `''` for both an absent `src` and one
 * written as `""` made the blank — which `readLogo` refuses — indistinguishable from a
 * contribution that sets no logo, and so silent (review of PR 512).
 */
function configuredLogoSrc(content: unknown): string | null {
  if (!isPlainRecord(content)) return null;
  const branding = content['branding'];
  if (!isPlainRecord(branding)) return null;
  const logo = branding['logo'];
  if (!isPlainRecord(logo)) return null;
  const src = logo['src'];
  return typeof src === 'string' ? src.trim() : null;
}

/**
 * Every contribution whose values are live, each labelled by where it came from.
 *
 * The active preset is merged over the fragments, so a value it names is live and a refusal of it
 * is just as silent as a fragment's. Unselected presets contribute nothing and stay quiet.
 */
function contributedSources(
  fragments: readonly AppConfigFragment[],
  preset: AppPreset | null,
): readonly { readonly label: string; readonly content: unknown }[] {
  return [
    ...fragments.map((fragment) => ({ label: fragment.component, content: fragment.content })),
    ...(preset?.bootstrap ? [{ label: `preset "${preset.name}"`, content: preset.bootstrap }] : []),
  ];
}

/**
 * Every `sso.endpoints[].path` a contribution writes, with the index it was written at.
 *
 * Read from the raw contribution, like {@link configuredLogoSrc}, so a value the merge is about to
 * discard is still there to report on. Entries whose `path` is not a string are left out: the
 * merge drops those for being the wrong type, which is a different complaint from a path that is
 * a string and points somewhere it may not.
 */
function configuredSsoPaths(content: unknown): readonly { index: number; path: string }[] {
  if (!isPlainRecord(content)) return [];
  const sso = content['sso'];
  if (!isPlainRecord(sso)) return [];
  const endpoints = sso['endpoints'];
  if (!Array.isArray(endpoints)) return [];
  return endpoints.flatMap((entry, index) => {
    if (!isPlainRecord(entry)) return [];
    const path = entry['path'];
    return typeof path === 'string' ? [{ index, path }] : [];
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `new URL` without the throw, for the places that must not reject. */
function parseUrlOrNull(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

/**
 * Sentinel returned into the success channel by `catchError`, so a failed load
 * takes the same code path as a successful one and cannot throw past the caller.
 */
class ConfigLoadFailure {
  constructor(readonly reason: string) {}
}
