import {Octokit} from "@octokit/rest";
import fetch from "cross-fetch";
import {version} from "../../package.json";
import {getGitHubApiUri} from "../configuration/configuration";

export const userAgent = `VS Code GitHub Actions (${version})`;

export function getClient(token: string): Octokit {
  return new Octokit({
    auth: token,
    userAgent: userAgent,
    baseUrl: getGitHubApiUri(),
    request: {
      fetch
    }
  });
}
