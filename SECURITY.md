# Security

## Reporting a problem

Please report security issues privately through GitHub's **Report a vulnerability** button on the repository's Security tab, rather than in a public issue.

Useful reports include:

- A value that should be masked but isn't (a leak).
- A way to make the page send data over the network, store data, or run injected script.
- Input that makes the page hang.

**Never include real data in a report.** Reproduce the problem with fictional values: example domains, documentation IP ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`) and published test card numbers.

## What the tool guarantees

- The page makes no network requests. A Content Security Policy blocks them.
- Real values are held in memory for the current tab only and are never written to storage. The only stored setting is the theme choice, the word `light` or `dark`.
- One-way values (secrets, card numbers, national IDs) are never stored and can't be restored.
- Text fields opt out of form history, session restore, spell-check, translation and common grammar extensions.

## What it doesn't

Masking is pattern-based and will miss values it has no pattern for. Read the output before you paste it anywhere. The full list of limits is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#limits).
