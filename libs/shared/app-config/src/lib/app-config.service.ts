import { DOCUMENT } from '@angular/common';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { TimeoutError, catchError, firstValueFrom, of, timeout } from 'rxjs';

import {
  AppBootstrapConfig,
  AppThemeConfig,
  DEFAULT_APP_BOOTSTRAP_CONFIG,
  mergeBootstrapConfig,
  nuxeoOriginsOf,
  resolveBrandingLogoUrl,
  resolveTheme,
} from './bootstrap-config';
import { APP_BOOTSTRAP_CONFIG_URL, APP_MANIFEST_CONFIG_URL } from './app-config.tokens';
import {
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
   */
  readonly brandingLogo = computed<{ readonly url: string; readonly alt: string } | null>(() => {
    const config = this.bootstrapConfig();
    const logo = config.branding.logo;
    if (!logo) return null;
    const baseUri = this.document.baseURI;
    const configUrl = new URL(this.bootstrapUrl, baseUri).href;
    const url = resolveBrandingLogoUrl(logo.src, configUrl, nuxeoOriginsOf(config, baseUri));
    return url === null ? null : { url, alt: logo.alt };
  });

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
 * Sentinel returned into the success channel by `catchError`, so a failed load
 * takes the same code path as a successful one and cannot throw past the caller.
 */
class ConfigLoadFailure {
  constructor(readonly reason: string) {}
}
