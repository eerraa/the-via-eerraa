# EERRAA VIA

This is the Git root; the VIA application lives in `the-via-eerraa/`.
Agent work starts at [AGENTS.md](AGENTS.md); app tasks and product contracts
start at the [app entry](the-via-eerraa/AGENTS.md).

## Fresh clone

```sh
git clone --branch main https://github.com/eerraa/the-via-eerraa.git
cd the-via-eerraa
git config core.hooksPath hooks
cd the-via-eerraa
bun install --frozen-lockfile
```

There are no submodules. Install Git, Bun and Node.js before running these
commands; supported Node versions are declared in the component `package.json`.
The existing deployment uses Node 22. Hook configuration is local and must be
set once per clone. The hook shell and Bun must be on PATH; Git for Windows
provides the shell. The hook checks a staged snapshot without deploying.

## Local development

From the app component directory:

```sh
bun test tests/docs-contract.test.ts
bun run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`. `bun run build` produces the component's `dist/`;
it does not upload it. Local worktrees, handover backups, `.mixdog/`, dependencies
and generated outputs are not downloaded by cloning.

## Production

The [deployment manual](the-via-eerraa/docs/DEPLOYMENT.md) owns release approval,
Cloudflare settings and host checks. The root workflow deploys the existing
Pages project only from `main`; pushing main can update `usekb.cc`.
No credentials belong in the repository. Development and LM20 branches are
not setup dependencies and must not be merged merely to initialize a clone.
