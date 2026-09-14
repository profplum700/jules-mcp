# Contributing

Read AGENTS.md and SECURITY.md first. Keep patches small and include synthetic regression tests. Do not add production credentials to fixtures, CI, examples or issue descriptions. Keep upstream API assumptions in the Jules module and its coverage manifest.

Run `pnpm install --frozen-lockfile` with pnpm 10.13.1, then `pnpm check` and `pnpm audit --prod --audit-level=high`. Use a complete clone for history scanning. The real dependency graph and Worker tests pass locally; deployment and actual hosted-client validation remain separate gates.

Before claiming compatibility, record the exact client/surface/version, authentication method, operations, deployed commit and any host confirmation. Mocked tests never qualify a client. Before changing a tool schema, update the checked-in schema fixture deliberately and refresh connected clients’ definitions.

Pull requests run without production secrets on standard hosted runners. No automatic merges. Security fixes should be reviewed promptly rather than waiting for the grouped monthly dependency update.
