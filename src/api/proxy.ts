import * as vscode from "vscode";
import type {GitHubProxyOptions} from "@actions/languageserver/initializationOptions";

import {logDebug} from "../log";
import {resolveGitHubProxyOptions} from "./proxyCore";

let lastLoggedProxySource: string | undefined;

export function getGitHubProxyOptions(): GitHubProxyOptions {
  const {options, source} = resolveGitHubProxyOptions(
    {
      proxy: vscode.workspace.getConfiguration().get<string>("http.proxy"),
      proxyAuthorization: vscode.workspace.getConfiguration().get<string>("http.proxyAuthorization"),
      strictSSL: vscode.workspace.getConfiguration().get<boolean>("http.proxyStrictSSL", true)
    },
    typeof process !== "undefined" ? process.env : {}
  );

  if (lastLoggedProxySource !== source) {
    lastLoggedProxySource = source;
    logDebug(`GitHub proxy source: ${source}`);
  }

  return options;
}
