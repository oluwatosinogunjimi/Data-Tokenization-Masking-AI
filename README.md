# Paste Masker

Mask sensitive values in logs, config and notes before you paste them into an AI chat, then put the real values back into the reply.

Paste Masker is a single offline HTML file. It replaces usernames, emails, hostnames, IP addresses, secrets and similar values with consistent tokens such as `[USER_1]` or `[PRIVATE_IP_3]`. The text stays useful to the AI because the same value always gets the same token, and tokens keep the useful part of what they replace: whether an IP is private or public, the RID of a SID, the last four digits of a card, the service a cloud resource belongs to. When the AI answers, paste the reply back and press Restore to swap the tokens for the real values.

Nothing leaves your machine. The page blocks all network access and saves nothing.

## Quick start

1. Download `paste-masker.html` and open it in a browser. There is nothing to install.
2. Paste your text into **Raw text** and press **Mask** (or Ctrl+Enter).
3. Read the masked output, then copy it into your AI chat.
4. Paste the AI's reply into **AI reply** and press **Restore** (or Ctrl+Enter). Restore copes with tokens the AI reformats, such as `[host_1]`, `\[HOST\_1\]` or `[HOST 1]`, and lists any tokens it couldn't restore.

Press **Load sample** to see it work on fictional data.

```text
Raw:     Account CONTOSO\jdoe logged on to fs01.corp.contoso.com from 10.20.30.40
         net use \\fs01\share /user:CONTOSO\jdoe Summer2026!

Masked:  Account [NETBIOS_1]\[USER_1] logged on to [HOST_1] from [PRIVATE_IP_1]
         net use \\[HOST_2]\share /user:[NETBIOS_1]\[USER_1] [SECRET_1]
```

## What it masks

| Kind | Examples | Restorable |
|---|---|---|
| Secrets | Private keys, JWTs, AWS/GitHub/Slack/Google keys, Bearer and Basic auth, `password=`-style values, passwords in command lines and URLs, Entra client secrets | No (one-way) |
| Card numbers | Known card prefixes with a valid Luhn check, shown as `[CARD_1:****1111]` | No (one-way) |
| National IDs | BVN and NIN after their keyword | No (one-way) |
| People and accounts | Emails and UPNs, `DOMAIN\user`, profile paths, usernames in commands, account and display-name fields in logs (Windows events, JSON, key=value, syslog, mail headers), names after a title, phone numbers, account numbers after a keyword | Yes |
| Machines and networks | Hostnames under your internal domains or the domains of masked emails, host fields in logs, `DESKTOP-`-style names, UNC hosts, machine accounts (`[HOST_1]$`), Azure resource names, IPv4/IPv6 (including defanged), MAC addresses | Yes |
| Identifiers | GUIDs, domain SIDs (the RID is kept) | Yes |
| Your own terms | Anything you list under **Custom terms**, with an optional label: `Acme Ltd \| ORG` | Yes |

Once a user, host or name has a token, it gets the same token wherever else it appears in the session. Well-known values are left alone: `NT AUTHORITY\SYSTEM`, `BUILTIN`, registry hives, built-in accounts such as `Administrator` and `root`, loopback addresses, file paths, version numbers, hashes and timestamps.

## Options

- **Per-type toggles** turn each detector on or off.
- **Keep email domain** masks only the name part of an email, and leaves that domain visible elsewhere.
- **Keep public IPs** leaves public addresses visible.
- **Internal domains** turns any host under them into `HOST_n`.
- **Never mask** lists exact values to leave alone.
- To preload your own terms, domains or never-mask values, edit `DEFAULT_TERMS`, `DEFAULT_INTERNAL_DOMAINS` and `DEFAULT_NEVER_MASK` at the top of the script in your copy of the file.

## Privacy and limits

- A Content Security Policy blocks every network request from the page.
- The token map is kept in memory for the current tab only. **Clear mapping**, a reload or closing the tab discards it.
- One-way values are never stored, so they can't be restored or recovered.
- Text boxes ask the browser not to save, spell-check, translate or autocorrect their contents, and opt out of grammar extensions that upload text. They are cleared when the tab closes.

Masking is pattern-based, so it **will** miss things: names in free text, unusual password formats, identifiers it has no pattern for. Always read the masked output before you paste it, and add anything it missed to Custom terms. Masking reduces risk; it doesn't replace the data-handling rules that apply to you.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works, the full detector list and the exact guarantees.

## Development

There is no build step. Edit `paste-masker.html` directly.

```sh
node tests/run.js           # masking, restore, sample round trip, performance
node tests/run.js --gaps    # also list known gaps
node tests/public-safety.js # check the repo contains no real-looking data
```

Tests need Node 18 or later and nothing else. Test data must be fictional: use example domains (`example.com`, `contoso.com`), documentation IP ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`) and published test card numbers. To catch terms of your own, list them in a local `.public-safety-denylist` file. It is git-ignored and read by `tests/public-safety.js`.

```text
paste-masker.html        the tool
docs/ARCHITECTURE.md     components, data flow, detectors, token map, guarantees and limits
tests/page.js            loads the page script in Node with a small DOM stub
tests/cases.js           masking test cases, including known gaps
tests/run.js             test runner
tests/public-safety.js   real-data lint for the repo
```

## Roadmap

- A refreshed interface with highlighted tokens, hover to see a value, and click to copy
- A review panel that flags likely misses before you copy
- More detectors: UK landlines, masked card numbers, more ID formats

## License

[MIT](LICENSE)
