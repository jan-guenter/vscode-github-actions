import {createProxyAwareFetch, resolveGitHubProxyOptions, resolveProxyUrlForRequest} from "./proxyCore";

describe("proxyCore", () => {
  it("prefers VS Code proxy settings over environment variables", () => {
    const result = resolveGitHubProxyOptions(
      {
        proxy: "http://vscode-proxy.internal:8080",
        proxyAuthorization: "Basic abc123",
        strictSSL: false
      },
      {
        HTTPS_PROXY: "http://env-proxy.internal:9090"
      }
    );

    expect(result.source).toBe("vscode");
    expect(result.options).toEqual({
      proxyUrl: "http://vscode-proxy.internal:8080/",
      proxyAuthorization: "Basic abc123",
      strictSSL: false
    });
  });

  it("falls back to environment variables and respects NO_PROXY", () => {
    const {options, source} = resolveGitHubProxyOptions(
      {
        strictSSL: true
      },
      {
        HTTPS_PROXY: "http://env-proxy.internal:9090",
        NO_PROXY: "raw.githubusercontent.com"
      }
    );

    expect(source).toBe("env");
    expect(resolveProxyUrlForRequest("https://api.github.com/", options, {HTTPS_PROXY: "http://env-proxy.internal:9090"})).toBe(
      "http://env-proxy.internal:9090/"
    );
    expect(
      resolveProxyUrlForRequest("https://raw.githubusercontent.com/actions/checkout/action.yml", options, {
        HTTPS_PROXY: "http://env-proxy.internal:9090"
      })
    ).toBeUndefined();
  });

  it("builds a tunneling fetch with proxy authorization and strict SSL settings", async () => {
    const fetch = jest.fn().mockResolvedValue({ok: true});
    const createHttpsOverHttpAgent = jest.fn().mockReturnValue({kind: "https-over-http"});
    const proxyFetch = createProxyAwareFetch(
      {
        proxyUrl: "http://proxy.internal:8080",
        proxyAuthorization: "Basic abc123",
        strictSSL: false
      },
      {},
      {
        fetch,
        createDirectHttpAgent: jest.fn().mockReturnValue({kind: "direct-http"}),
        createDirectHttpsAgent: jest.fn().mockReturnValue({kind: "direct-https"}),
        createHttpOverHttpAgent: jest.fn(),
        createHttpOverHttpsAgent: jest.fn(),
        createHttpsOverHttpAgent,
        createHttpsOverHttpsAgent: jest.fn()
      }
    );

    await proxyFetch("https://api.github.com/user", {method: "GET"});

    expect(createHttpsOverHttpAgent).toHaveBeenCalledWith({
      proxy: {
        host: "proxy.internal",
        port: 8080,
        headers: {
          "Proxy-Authorization": "Basic abc123"
        }
      },
      rejectUnauthorized: false
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({
        agent: {kind: "https-over-http"},
        method: "GET"
      })
    );
  });
});
