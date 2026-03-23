import * as vscode from "vscode";
import {resetGitHubAPIAccessCache} from "../api/canReachGitHubAPI";
import {resetGitHubContext} from "../git/repository";
import {deactivateLanguageServer, initLanguageServer} from "../workflow/languageServer";

const settingsKey = "github-actions";
const DEFAULT_GITHUB_API = "https://api.github.com";
const DEFAULT_GITHUB_BASE = "https://github.com";

export function initConfiguration(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async e => {
      const affectsProxy =
        e.affectsConfiguration("http.proxy") ||
        e.affectsConfiguration("http.proxyAuthorization") ||
        e.affectsConfiguration("http.proxyStrictSSL");

      if (e.affectsConfiguration(getSettingsKey("workflows.pinned"))) {
        pinnedWorkflowsChangeHandlers.forEach(h => h());
      } else if (
        affectsProxy ||
        e.affectsConfiguration(getSettingsKey("use-enterprise")) ||
        (useEnterprise() &&
          (e.affectsConfiguration("github-enterprise.uri") || e.affectsConfiguration(getSettingsKey("remote-name"))))
      ) {
        if (affectsProxy) {
          resetGitHubAPIAccessCache();
        }
        await updateLanguageServerApiUrl(context);
        resetGitHubContext();
        await vscode.commands.executeCommand("github-actions.explorer.refresh");
      }
    })
  );
}

function getConfiguration() {
  return vscode.workspace.getConfiguration();
}

function getSettingsKey(settingsPath: string): string {
  return `${settingsKey}.${settingsPath}`;
}

const pinnedWorkflowsChangeHandlers: (() => void)[] = [];
export function onPinnedWorkflowsChange(handler: () => void) {
  pinnedWorkflowsChangeHandlers.push(handler);
}

export function getPinnedWorkflows(): string[] {
  return getConfiguration().get<string[]>(getSettingsKey("workflows.pinned.workflows"), []);
}

export async function pinWorkflow(workflow: string) {
  const pinedWorkflows = Array.from(new Set(getPinnedWorkflows()).add(workflow));
  await getConfiguration().update(getSettingsKey("workflows.pinned.workflows"), pinedWorkflows);
}

export async function unpinWorkflow(workflow: string) {
  const x = new Set(getPinnedWorkflows());
  x.delete(workflow);
  const pinnedWorkflows = Array.from(x);
  await getConfiguration().update(getSettingsKey("workflows.pinned.workflows"), pinnedWorkflows);
}

export function isPinnedWorkflowsRefreshEnabled(): boolean {
  return getConfiguration().get<boolean>(getSettingsKey("workflows.pinned.refresh.enabled"), false);
}

export function pinnedWorkflowsRefreshInterval(): number {
  return getConfiguration().get<number>(getSettingsKey("workflows.pinned.refresh.interval"), 60);
}

export function getRemoteName(): string {
  return getConfiguration().get<string>(getSettingsKey("remote-name"), "origin");
}

export function useEnterprise(): boolean {
  return getConfiguration().get<boolean>(getSettingsKey("use-enterprise"), false);
}

export function getGitHubApiUri(): string {
  if (!useEnterprise()) return DEFAULT_GITHUB_API;
  const base = getConfiguration().get<string>("github-enterprise.uri", DEFAULT_GITHUB_API).replace(/\/$/, "");
  if (base === DEFAULT_GITHUB_API) {
    return base;
  }

  if (base.endsWith(".ghe.com")) {
    return base.replace(/^(https?):\/\//, "$1://api.");
  } else {
    return `${base}/api/v3`;
  }
}

export function getGitHubBaseUri(): string {
  if (!useEnterprise()) return DEFAULT_GITHUB_BASE;

  const base = getConfiguration().get<string>("github-enterprise.uri", DEFAULT_GITHUB_BASE).replace(/\/$/, "");
  if (base === DEFAULT_GITHUB_API) {
    return DEFAULT_GITHUB_BASE;
  }

  if (base.endsWith("/api/v3")) {
    return base.replace(/\/api\/v3$/, "");
  }

  if (/^https?:\/\/api\..+\.ghe\.com$/i.test(base)) {
    return base.replace(/^(https?):\/\/api\./i, "$1://");
  }

  return base;
}

async function updateLanguageServerApiUrl(context: vscode.ExtensionContext) {
  await deactivateLanguageServer();

  await initLanguageServer(context);
}
