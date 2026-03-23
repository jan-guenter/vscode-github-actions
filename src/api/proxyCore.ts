import type {GitHubProxyOptions} from "@actions/languageserver/initializationOptions";
import fetch from "cross-fetch";
import * as http from "http";
import * as https from "https";
import * as tunnel from "tunnel";

export type ProxySource = "env" | "none" | "vscode";

export interface ProxySettings {
  proxy?: string;
  proxyAuthorization?: string;
  strictSSL?: boolean;
}

export interface ProxyFetchInit {
  agent?: unknown;
  headers?: unknown;
  [key: string]: unknown;
}

export type ProxyFetch = (url: string, init?: ProxyFetchInit) => Promise<unknown>;

interface TunnelProxyOptions {
  host: string;
  port: number;
  proxyAuth?: string;
  headers?: Record<string, string>;
  rejectUnauthorized?: boolean;
}

interface TunnelAgentOptions {
  proxy: TunnelProxyOptions;
  rejectUnauthorized?: boolean;
}

export interface ProxyFetchDependencies {
  fetch: ProxyFetch;
  createDirectHttpAgent: () => unknown;
  createDirectHttpsAgent: (strictSSL: boolean) => unknown;
  createHttpOverHttpAgent: (options: TunnelAgentOptions) => unknown;
  createHttpOverHttpsAgent: (options: TunnelAgentOptions) => unknown;
  createHttpsOverHttpAgent: (options: TunnelAgentOptions) => unknown;
  createHttpsOverHttpsAgent: (options: TunnelAgentOptions) => unknown;
}

type ProcessEnvLike = Record<string, string | undefined>;

export function resolveGitHubProxyOptions(
  settings: ProxySettings,
  env: ProcessEnvLike = getProcessEnv()
): {options: GitHubProxyOptions; source: ProxySource} {
  const proxyUrl = normalizeProxyUrl(settings.proxy);
  const proxyAuthorization = normalizeProxyAuthorization(settings.proxyAuthorization);
  const strictSSL = settings.strictSSL ?? true;

  if (proxyUrl) {
    return {
      source: "vscode",
      options: {
        proxyUrl,
        proxyAuthorization,
        strictSSL
      }
    };
  }

  return {
    source: hasConfiguredEnvProxy(env) ? "env" : "none",
    options: {
      strictSSL,
      noProxy: normalizeNoProxy(env.NO_PROXY ?? env.no_proxy)
    }
  };
}

export function resolveProxyUrlForRequest(
  url: string,
  proxyOptions: GitHubProxyOptions,
  env: ProcessEnvLike = getProcessEnv()
): string | undefined {
  if (proxyOptions.proxyUrl) {
    return proxyOptions.proxyUrl;
  }

  if (shouldBypassProxy(url, proxyOptions.noProxy ?? normalizeNoProxy(env.NO_PROXY ?? env.no_proxy))) {
    return undefined;
  }

  const requestUrl = new URL(url);
  const envProxy =
    requestUrl.protocol === "https:"
      ? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy
      : env.HTTP_PROXY ?? env.http_proxy;

  return normalizeProxyUrl(envProxy);
}

export function createProxyAwareFetch(
  proxyOptions: GitHubProxyOptions,
  env: ProcessEnvLike = getProcessEnv(),
  dependencies: ProxyFetchDependencies = loadProxyFetchDependencies()
): ProxyFetch {
  const directHttpAgent = dependencies.createDirectHttpAgent();
  const directHttpsAgent = dependencies.createDirectHttpsAgent(proxyOptions.strictSSL);
  const proxyAgents = new Map<string, unknown>();

  return async (url, init) => {
    const proxyUrl = resolveProxyUrlForRequest(url, proxyOptions, env);
    const nextInit: ProxyFetchInit = {
      ...(init ?? {}),
      agent: proxyUrl
        ? getProxyAgent(url, proxyUrl, proxyOptions, proxyAgents, dependencies)
        : getDirectAgent(url, directHttpAgent, directHttpsAgent)
    };

    return await dependencies.fetch(url, nextInit);
  };
}

export function loadProxyFetchDependencies(): ProxyFetchDependencies {
  return {
    fetch: fetch as unknown as ProxyFetch,
    createDirectHttpAgent: () => new http.Agent(),
    createDirectHttpsAgent: strictSSL => new https.Agent({rejectUnauthorized: strictSSL}),
    createHttpOverHttpAgent: options => tunnel.httpOverHttp(options),
    createHttpOverHttpsAgent: options => tunnel.httpOverHttps(options),
    createHttpsOverHttpAgent: options => tunnel.httpsOverHttp(options),
    createHttpsOverHttpsAgent: options => tunnel.httpsOverHttps(options)
  };
}

function getDirectAgent(url: string, httpAgent: unknown, httpsAgent: unknown): unknown {
  return new URL(url).protocol === "https:" ? httpsAgent : httpAgent;
}

function getProxyAgent(
  url: string,
  proxyUrl: string,
  proxyOptions: GitHubProxyOptions,
  proxyAgents: Map<string, unknown>,
  dependencies: ProxyFetchDependencies
): unknown {
  const requestProtocol = new URL(url).protocol;
  const proxyProtocol = new URL(proxyUrl).protocol;
  const cacheKey = `${requestProtocol}:${proxyProtocol}:${proxyUrl}:${proxyOptions.strictSSL}:${proxyOptions.proxyAuthorization ?? ""}`;
  const existing = proxyAgents.get(cacheKey);
  if (existing) {
    return existing;
  }

  const agent = createProxyAgent(requestProtocol, proxyUrl, proxyOptions, dependencies);
  proxyAgents.set(cacheKey, agent);
  return agent;
}

function createProxyAgent(
  requestProtocol: string,
  proxyUrl: string,
  proxyOptions: GitHubProxyOptions,
  dependencies: ProxyFetchDependencies
): unknown {
  const proxy = new URL(proxyUrl);
  const tunnelOptions = createTunnelAgentOptions(proxy, requestProtocol, proxyOptions);

  if (requestProtocol === "https:") {
    return proxy.protocol === "https:"
      ? dependencies.createHttpsOverHttpsAgent(tunnelOptions)
      : dependencies.createHttpsOverHttpAgent(tunnelOptions);
  }

  return proxy.protocol === "https:"
    ? dependencies.createHttpOverHttpsAgent(tunnelOptions)
    : dependencies.createHttpOverHttpAgent(tunnelOptions);
}

function createTunnelAgentOptions(
  proxy: URL,
  requestProtocol: string,
  proxyOptions: GitHubProxyOptions
): TunnelAgentOptions {
  const proxyConfig: TunnelProxyOptions = {
    host: proxy.hostname,
    port: Number(proxy.port || defaultPortForProtocol(proxy.protocol))
  };

  if (proxy.username || proxy.password) {
    proxyConfig.proxyAuth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  }

  if (proxyOptions.proxyAuthorization) {
    proxyConfig.headers = {
      "Proxy-Authorization": proxyOptions.proxyAuthorization
    };
  }

  if (proxy.protocol === "https:" && !proxyOptions.strictSSL) {
    proxyConfig.rejectUnauthorized = false;
  }

  return {
    proxy: proxyConfig,
    ...(requestProtocol === "https:" && !proxyOptions.strictSSL ? {rejectUnauthorized: false} : {})
  };
}

function hasConfiguredEnvProxy(env: ProcessEnvLike): boolean {
  return Boolean(normalizeProxyUrl(env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy));
}

function shouldBypassProxy(url: string, noProxy: string | undefined): boolean {
  if (!noProxy) {
    return false;
  }

  const {hostname, port, protocol} = new URL(url);
  const defaultPort = protocol === "https:" ? "443" : "80";
  const actualPort = port || defaultPort;
  const filters = noProxy
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  if (filters.includes("*")) {
    return true;
  }

  const host = `.${hostname.toLowerCase()}`;
  return filters.some(filter => {
    const [name, configuredPort] = filter.replace(/^\*+/, "").split(":", 2);
    if (!name) {
      return false;
    }

    const domain = name.startsWith(".") ? name : `.${name}`;
    return host.endsWith(domain) && (!configuredPort || configuredPort === actualPort);
  });
}

function normalizeProxyUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeProxyAuthorization(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeNoProxy(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function defaultPortForProtocol(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

function getProcessEnv(): ProcessEnvLike {
  return typeof process !== "undefined" ? process.env : {};
}
