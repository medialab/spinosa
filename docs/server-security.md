# Server security

Spinosa binds to `127.0.0.1` by default. An unauthenticated loopback listener accepts only
loopback `Host` values (`localhost`, `*.localhost`, `127.0.0.0/8`, and `[::1]`). This check applies
before legacy, V2, and WebSocket routes, including requests without an `Origin` header, to prevent
DNS rebinding from treating an attacker-controlled hostname as the local server.

A non-loopback bind requires `SPINOSA_SERVER_PASSWORD`. Spinosa uses HTTP Basic authentication,
which authenticates requests but does not encrypt the password or response data. For remote access,
put an HTTPS reverse proxy in front of a loopback-bound Spinosa server or connect through an encrypted
tunnel. Authenticated listeners allow proxy-supplied and custom `Host` values.
