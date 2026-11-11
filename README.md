# Paste Masker

Mask sensitive values in logs, config and notes before you paste them into an AI chat, then put the real values back into the reply.

Paste Masker is a single offline HTML file. It replaces usernames, emails, hostnames, IP addresses, secrets and similar values with consistent tokens such as `[USER_1]` or `[PRIVATE_IP_3]`. The text stays useful to the AI because the same value always gets the same token, and tokens keep the useful part of what they replace: whether an IP is private or public, the RID of a SID, the last four digits of a card, the service a cloud resource belongs to. When the AI answers, paste the reply back and press Restore to swap the tokens for the real values.

Nothing leaves your machine. The page blocks all network access and saves none of your text.

**Use it online:** https://oluwatosinogunjimi.github.io/Data-Tokenization-Masking-AI/ (the same file, served by GitHub Pages; it still runs entirely in your browser). Or download `paste-masker.html` and open it locally.

## Quick start

1. Download `paste-masker.html` and open it in a browser. There is nothing to install.
2. On the **1 Mask** tab, paste your text and press **Mask** (or Ctrl+Enter, ⌘+Enter on a Mac).
3. Read the masked output. Each token is highlighted by type. Hover or focus a token to see its real value, click it to copy the real value, or Shift-click to copy the token. On a touch screen, tap a token for both.
4. Press **Copy masked** and paste into your AI chat. Copying always gives plain text, exactly as masked.
5. On the **2 Restore** tab, paste the AI's reply and press **Restore** (or Ctrl+Enter). Restore copes with tokens the AI reformats, such as `[host_1]`, `\[HOST\_1\]` or `[HOST 1]`, marks every restored value, and lists any tokens it couldn't restore.

Press **Load sample** to see it work on fictional data. The **Mapping** table under both tabs lists every token in the session; filter it, copy a token or a value, or press **Hide values** before you share your screen (copying still works). **End session** clears every token.

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
| Your entities | Names and terms you list as **Entities**, with linked tokens for a person's name forms (see below) | Yes |

Once a user, host or name has a token, it gets the same token wherever else it appears in the session. Well-known values are left alone: `NT AUTHORITY\SYSTEM`, `BUILTIN`, registry hives, built-in accounts such as `Administrator` and `root`, loopback addresses, file paths, version numbers, hashes and timestamps.

## Entities

List the names and terms you consider sensitive in the **Entities** strip on the Mask tab: type one, pick a type (Person, Organisation, Host, Project, Other) and press **Add**. You can also select text in the raw box, or text the masked output left unmasked, and press **Add as entity**. Adding or removing an entity re-masks.

A person gets linked tokens that share one number, so the AI can tell they are the same person:

```text
Jane Doe, Doe, Jane, J. Doe   ->  [PERSON_1], [PERSON_1.2], [PERSON_1.3]
Jane (capitalised only)       ->  [PERSON_FIRST_1]
Doe (capitalised only)        ->  [PERSON_LAST_1]
jdoe, jane.doe, CORP\jdoe     ->  [PERSON_USER_1], [PERSON_USER_1.2], [NETBIOS_1]\[PERSON_USER_1]
```

Each different spelling gets its own sub-index (`.2`, `.3`), so Restore puts back exactly what was there. Other types match the whole term only. "grace period" or "will" stay as they are; a capitalised "Will" at the start of a sentence is masked if a listed person is called Will. The list is the same as **Custom terms** in Settings (`Jane Doe | PERSON`, one per line). It is kept for the tab, also after **End session**; to preload entities, edit `DEFAULT_TERMS` in your copy of the file.

## Settings and shortcuts

Open **Settings** (or press S) for a drawer with these options. Changes apply the next time you press Mask.

- **Per-type toggles** turn each detector on or off, grouped by the same colours as the tokens.
- **Keep email domain** masks only the name part of an email, and leaves that domain visible elsewhere.
- **Keep public IPs** leaves public addresses visible.
- **Custom terms** is the entity list as text, for editing many at once.
- **Internal domains** turns any host under them into `HOST_n`.
- **Never mask** lists exact values to leave alone.
- To preload your own terms, domains or never-mask values, edit `DEFAULT_TERMS`, `DEFAULT_INTERNAL_DOMAINS` and `DEFAULT_NEVER_MASK` at the top of the engine script in your copy of the file.

Keys: Ctrl/⌘+Enter runs the current tab, M and R switch tabs, S opens settings, / filters the mapping, arrow keys move between tokens in an output and Enter copies, ? lists the shortcuts, Esc closes. Letter keys work when you are not typing in a box. The sun/moon button switches between the Day and Night themes.

## Privacy and limits

- A Content Security Policy blocks every network request from the page.
- The token map is kept in memory for the current tab only. **End session**, a reload or closing the tab discards it.
- The only thing the page stores is your theme choice: the word `light` or `dark` in the browser's local storage. Never any text or value.
- One-way values are never stored, so they can't be restored or recovered.
- Text boxes ask the browser not to save, spell-check, translate or autocorrect their contents, and opt out of grammar extensions that upload text. They and both outputs are cleared when the tab closes.

Masking is pattern-based, so it **will** miss things: names in free text, unusual password formats, identifiers it has no pattern for. Always read the masked output before you paste it, and add anything it missed as an entity. Masking reduces risk; it doesn't replace the data-handling rules that apply to you.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works, the full detector list and the exact guarantees.

## Development

There is no build step. Edit `paste-masker.html` directly. It holds two scripts: the masking engine (`<script id="engine">`, no page access) and the interface (`<script id="ui">`), which reaches the engine only through its `PM` object.

```sh
node tests/run.js           # engine: masking, restore, spans, sample round trip, performance; static page checks
node tests/run.js --gaps    # also list known gaps
node tests/public-safety.js # check the repo contains no real-looking data
node tests/ui.js            # the interface in headless Chromium (needs: npm i --no-save playwright)
```

`run.js` and `public-safety.js` need Node 18 or later and nothing else. `ui.js` needs the `playwright` package and a Chromium (`npx playwright install chromium`); without it, it prints "skipped". Test data must be fictional: use example domains (`example.com`, `contoso.com`), documentation IP ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`) and published test card numbers. To catch terms of your own, list them in a local `.public-safety-denylist` file. It is git-ignored and read by `tests/public-safety.js`.

```text
paste-masker.html        the tool
index.html               redirects the GitHub Pages site to the tool
.nojekyll                serves files as they are (no Jekyll processing)
docs/ARCHITECTURE.md     components, data flow, detectors, token map, guarantees and limits
tests/page.js            loads the engine script in Node, with no DOM
tests/cases.js           masking test cases, including known gaps
tests/run.js             engine and static page checks
tests/ui.js              end-to-end interface checks in a browser
tests/public-safety.js   real-data lint for the repo
LICENSES/                licences of the embedded fonts
```

## Roadmap

- A review panel that flags likely misses before you copy
- More detectors: UK landlines, masked card numbers, more ID formats

## License

[MIT](LICENSE). The embedded fonts, Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono, are under the SIL Open Font License 1.1; their licence texts are in [LICENSES/](LICENSES/).
