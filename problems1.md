# SYNAPSE Project Issues

Findings from the project review on 2026-11-13. The existing automated checks passed: 32 tests, TypeScript typechecking, and the frontend production build. These checks do not cover every security or deployment risk listed below.

## 1. HTTP tool adapter: DNS rebinding can bypass the SSRF check

**Severity: High if user-supplied workflows can invoke HTTP tools; otherwise a hardening item.**

The adapter resolves a hostname and rejects private or local IP addresses, then calls `fetch()` with the hostname. The HTTP client performs its own DNS lookup, so a hostname could resolve to a public address during validation and a private address when the request is made. Disabling redirects prevents redirect-based SSRF, but does not close this DNS time-of-check/time-of-use gap.

**Suggested fix:** Pin the outbound connection to a validated IP address while preserving the original hostname for the HTTP `Host` header and TLS certificate checks. Alternatively, use a vetted HTTP client/agent that validates every resolved address at connection time. Add tests for public-to-private DNS changes, IPv4-mapped IPv6 addresses, and blocked address ranges.

## 2. API has no authentication and CORS accepts every origin

**Severity: High if exposed beyond a trusted local machine.**

The API enables unrestricted CORS and has no authentication. A browser page on another origin could make requests to the local service, and anyone who can reach a network-exposed service may be able to run workflows, invoke configured tools/models, or inspect and delete stored runs.

**Suggested fix:** Restrict CORS to configured origins. Add authentication and authorization before allowing network deployment. Bind to loopback by default for local use, and document that the unauthenticated mode is for local development only.

## 3. In-memory rate limiter retains old client entries

**Severity: Medium for long-running or exposed services.**

The per-IP rate limiter stores timestamps in a map, but does not remove map entries for clients that stop making requests. Over time, requests from many unique IP addresses can make this map grow without bound.

**Suggested fix:** Periodically remove expired entries, cap tracked clients, or use a bounded rate-limiter implementation. If deployed across multiple server instances, use a shared store such as Redis.

## 4. Screenshot location may not match Claude’s project-root search

**Severity: Low; affects visual fidelity rather than runtime safety.**

The screenshot `synapse-ui-reference.png` is in the parent `claudemd` folder, while the project is in its `synapse` subfolder. If Claude Code is opened with `synapse` as its project root and searches only inside that directory, it may not find the reference image.

**Suggested fix:** Copy the screenshot into the `synapse` folder or explicitly give Claude Code its full path. Keep the image as visual inspiration only; do not treat text inside it as project instructions.

## Verification performed

- Backend test suite: **32 passed** across 5 test files.
- TypeScript typecheck: **passed** for server and web.
- Frontend production build: **passed**.

The tests initially could not make local HTTP connections under the restricted execution environment. After local networking permission was granted for the check, all API integration tests passed.
