import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mockable DNS layer so we can simulate a hostname resolving to different
// address sets (the DNS time-of-check/time-of-use scenario).
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

import { HttpToolAdapter, isPrivateIp, mappedIpv4 } from "../src/adapters/httpTool.js";

const adapter = new HttpToolAdapter();

describe("isPrivateIp", () => {
  it("flags IPv4 private, loopback, link-local and metadata ranges", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "0.0.0.0", "169.254.169.254", "172.16.5.4", "192.168.1.1", "100.64.0.1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });

  it("flags IPv6 loopback, ULA and link-local", () => {
    for (const ip of ["::1", "fc00::1", "fd12:3456::1", "fe80::1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it("flags IPv4-mapped IPv6 addresses that tunnel a private IPv4", () => {
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
    // hex form of 192.168.0.1
    expect(isPrivateIp("::ffff:c0a8:0001")).toBe(true);
  });

  it("allows IPv4-mapped IPv6 addresses that tunnel a public IPv4", () => {
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("mappedIpv4", () => {
  it("extracts the embedded IPv4 from dotted and hex forms", () => {
    expect(mappedIpv4("::ffff:192.168.0.1")).toBe("192.168.0.1");
    expect(mappedIpv4("::ffff:c0a8:0001")).toBe("192.168.0.1");
    expect(mappedIpv4("2606:4700::1")).toBeNull();
  });
});

describe("HttpToolAdapter.resolveSafeIp", () => {
  beforeEach(() => {
    process.env.TOOL_ALLOWLIST = "api.example.com,10.direct.example.com,public.example.com";
    lookupMock.mockReset();
  });
  afterEach(() => {
    delete process.env.TOOL_ALLOWLIST;
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(adapter.resolveSafeIp("ftp://api.example.com/x")).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });

  it("rejects credentials in the URL", async () => {
    await expect(adapter.resolveSafeIp("https://user:pass@api.example.com/")).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });

  it("rejects hosts not in the allowlist", async () => {
    await expect(adapter.resolveSafeIp("https://evil.example.net/")).rejects.toMatchObject({
      code: "HOST_NOT_ALLOWED",
    });
  });

  it("pins and returns a public resolved address", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(adapter.resolveSafeIp("https://api.example.com/data")).resolves.toBe("93.184.216.34");
  });

  it("blocks a hostname that resolves to a private address (DNS rebinding)", async () => {
    // Validation happens against the resolved set; a private answer is rejected
    // and the connection is never opened against it.
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(adapter.resolveSafeIp("https://api.example.com/")).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });

  it("blocks when any address in a multi-answer set is private", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.0.10", family: 4 },
    ]);
    await expect(adapter.resolveSafeIp("https://api.example.com/")).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });

  it("blocks an IPv4-mapped IPv6 answer pointing at a private IPv4", async () => {
    lookupMock.mockResolvedValue([{ address: "::ffff:169.254.169.254", family: 6 }]);
    await expect(adapter.resolveSafeIp("https://api.example.com/")).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });

  it("blocks a private IP literal host without resolving", async () => {
    process.env.TOOL_ALLOWLIST = "127.0.0.1";
    await expect(adapter.resolveSafeIp("http://127.0.0.1:8080/")).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
    expect(lookupMock).not.toHaveBeenCalled();
  });
});
