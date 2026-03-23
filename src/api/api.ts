import {Octokit} from "@octokit/rest";
import {version} from "../../package.json";
import {getGitHubApiUri} from "../configuration/configuration";
import {getGitHubProxyOptions} from "./proxy";
import {createProxyAwareFetch} from "./proxyCore";

export const userAgent = `VS Code GitHub Actions (${version})`;

export function getClient(token: string): Octokit {
  const request = isNodeRuntime()
    ? {
        fetch: createProxyAwareFetch(getGitHubProxyOptions())
      }
    : undefined;

  return new Octokit({
    auth: token,
    userAgent: userAgent,
    baseUrl: getGitHubApiUri(),
    request
  });
}

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && process.versions?.node != null;
}
