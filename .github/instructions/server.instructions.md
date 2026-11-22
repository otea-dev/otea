---
applyTo: "src/server/**,src/app/phone.ts,src/app/devices.ts,src/app/tailscale*.ts,src/cli/phone.ts,src/cli/serve*.ts,ui/public/**"
---

# Network exposure and auth (HIGH)

`otea serve` answers 127.0.0.1 only (`src/server/listen.ts`, `HOST`). A phone reaches it through a transport the person chose: the local network (opened and closed at runtime, `src/server/lan-access.ts`) or Tailscale HTTPS. Contract: `docs/phone.md`. Flag:

- **Binding:** any listener on `0.0.0.0`, `::` or a non-loopback address by default, or one that opens without the signed-in desk's explicit action. Otea never touches the firewall.
- **Missing checks:** a new `/api` route, or `/p/<id>/api` route, that skips the sign-in (`session.ts`: `canWrite`, `canManageDevices`, `canConfigure`) or, on a write, `assertSameOrigin` / `assertWritable` (`writes.ts`). A paired device works on items; it must not configure the project, pair, revoke or open the network.
- **Host and address policy** (`hosts.ts`, `lan.ts`): a request from the network must be a private address (Tailscale 100.64.0.0/10 included), name one of this computer's IPs or its `.local` name as host, and carry a device token. Trusting `X-Forwarded-For` or `Host` without that, or taking a forwarded request for the local browser.
- **CORS:** any `Access-Control-Allow-*` header, wildcard origins, or reading the `Origin` header loosely.
- **Pairing and tokens** (`pairing.ts`, `token.ts`): codes must stay single-use, 10 minutes, 5 wrong tries, 10 attempts a minute per address. Tokens are compared with `sameToken` (constant time), stored hashed (SHA-256), set in HTTP-only cookies (`Secure` over HTTPS), files at mode 0600 (`restrictToOwner`). Flag a weaker comparison, a token in a URL, a log line or an error message, or a longer lifetime.
- **Sign-in redirects:** the sign-in may go only to a project page on this server (`PROJECT_PAGE` in `session.ts`); an open redirect is HIGH.
- **Push** (`push.ts`, `notify-api.ts`): subscription endpoints and keys are secrets of the device. They go only to the push service they name, never to logs (log the device id only), other hosts, or other devices. Check the 410/404 drop path still works.
- **Evidence and attachments** (`evidence.ts`): served from the app's own origin, so they must stay inert (no inline script, sandbox policy kept, content type fixed, size limits kept, no path from user input).
- **Server state:** the files in the Otea home (`ui-token`, `machine.db`, `push-keys.json`, `serve.json`) keep their owner-only permissions.
