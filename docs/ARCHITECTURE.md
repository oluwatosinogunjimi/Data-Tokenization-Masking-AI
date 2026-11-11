# Architecture

Paste Masker is one HTML file with inline CSS and JavaScript. It has no build step, no dependencies and no network access. This document describes how it is put together and how text moves through it.

## Components

The file has two scripts. The **engine** (`<script id="engine">`) does all masking and restoring and never touches the page: no `document`, no events, no storage. The **interface** (`<script id="ui">`) reads the settings, calls the engine through one object, `PM`, and draws the results. The tests load the engine block on its own, so what they check is exactly what the page runs.

| Component | Where | Responsibility |
|---|---|---|
| Page shell | `<head>`, `<header>`, `<main>`, dialogs | The Content Security Policy, the two embedded fonts, the top bar, the Mask and Restore tabs, the mapping table, the settings drawer, the confirm dialog and the shortcuts panel. Every text field carries the privacy attributes described under [Text fields](#text-fields). |
| Defaults | `DEFAULT_TERMS`, `DEFAULT_INTERNAL_DOMAINS`, `DEFAULT_NEVER_MASK` at the top of the engine script | Values loaded into the settings boxes when the page opens. Edit them in your own copy of the file. |
| Engine interface | `PM` at the end of the engine script | The only way in or out of the engine (see [The PM interface](#the-pm-interface)). |
| Config | `configure()` | Turns a plain settings object into `CFG` (enabled groups, options, custom terms, internal domains) and `ALLOW` (never-mask list). |
| Detectors | `DETECTORS` array | Ordered list of pattern groups. Each replaces what it finds with a placeholder via `mk()`. |
| Tokeniser | `mk(label, value, options)` | Looks up or creates the token for a value, records it in the session store, counts how often it was seen, and returns a placeholder. |
| Placeholder layer | `place()`, `enc()`, `dec()` | Holds finished tokens out of the text while the remaining detectors run (see below). |
| Session store | `S` | The token map for the current tab: forward map, reverse map, per-label counters, mapping rows and learned domains. |
| Restorer | `restoreText()`, `restoreReport()` | Swaps tokens in the AI reply back to their original values, tolerating reformatted tokens, and builds the report of what it couldn't restore. |
| Interface | the `ui` script | Tabs, rendering of highlighted output, the token popover, copy, the mapping table, settings, shortcuts, theme and toasts. Values are written with `textContent`, never as HTML. |

## The PM interface

```text
PM.configure({ on: { group: false }, keepEmailDomain, keepPublicIp, terms, domains, allow })
    Groups left out of "on" are on. terms, domains and allow are arrays of lines or one newline-separated string.
PM.mask(text)      -> { text, spans: [{ start, end, token }], counts: { LABEL: n } }
PM.restore(text)   -> { text, restored, unknown: [token], oneWay: [token], mappingEmpty,
                        spans: [{ start, end, token, kind: 'restored' | 'oneway' | 'unknown' }] }
PM.report(result)  -> [{ kind, text }]   the restore report lines, built from the token lists only
PM.rows()          -> [{ token, label, value (null if one-way), oneWay, seen }] in creation order
PM.lookup(token)   -> one such row, or null
PM.size()          -> number of tokens in the session
PM.clear()         -> forget every token and learned domain
PM.groups, PM.defaults, PM.sample   detector group names, the editable defaults, the built-in sample
```

`spans` give the position of every token in the masked text (or of every restored value, kept one-way token and unknown token in the restored text). They are collected while the placeholders are expanded, so the interface highlights tokens without parsing the text again. A card token's span shows `[CARD_1:****1111]` and names `[CARD_1]`, the token the mapping knows.

## Data flow

```mermaid
flowchart LR
  A[Raw text] -->|Mask| B["PM.configure(settings)"]
  B --> C[Detectors in order]
  C -->|each match| D["mk(): token from session store"]
  D --> E[Placeholder in text]
  E --> C
  C --> F[Expand placeholders, record spans]
  F --> G[Masked text + spans]
  G --> R[Highlighted output]
  G -->|Copy masked| H[(AI chat)]
  H -->|paste reply| I["PM.restore()"]
  I --> J[Reverse map lookup]
  J --> K[Restored text + spans + report]
  D -.-> S[(Session store S, in memory)]
  J -.-> S
```

1. **Mask.** The interface reads the settings drawer into a plain object and calls `PM.configure()`, then `PM.mask()`. `maskText()` resets the placeholder list and per-run counts, learns organisation domains from the email addresses in the text, then runs each enabled detector over the text in order. Every match goes through `mk()`, which returns a placeholder. When all detectors are done, the placeholders are expanded into their visible tokens and each token's position is recorded.
2. **Review and copy.** The interface renders the masked text with one highlighted element per token. **Copy masked** copies the engine's string. The page itself sends nothing anywhere.
3. **Restore.** The AI reply is pasted into the Restore tab. `PM.restore()` replaces every token it knows with the original value, including tokens the AI reformatted. One-way tokens stay tokens and unknown ones are left as they are; `PM.report()` turns both lists into the report under the output.
4. **End session.** "End session" (after an in-page confirmation) calls `PM.clear()` and empties every text box and output. Closing or reloading the tab discards the store too. After that, earlier masked text can no longer be restored.

## Interface

- **Tabs.** "1 Mask" and "2 Restore" follow the ARIA tab pattern (arrow keys, Home and End move between tabs). Each tab has an input pane and an output pane side by side, stacked below 900 px wide, and a badge such as "26 tokens" or "8 restored". One primary button per tab: the run button until there is output, then the copy button.
- **Highlighted output.** The output is built from text nodes and one `<span>` per token, with `createElement` and `textContent`. Joined, the text nodes are exactly the engine's string. Colour marks the category, and the token's own label stays visible, so colour is never the only cue: identity (users, people, emails, NetBIOS domains) violet, hosts and cloud resources teal, network (IPs, MACs) plum, organisation (custom terms, organisation domains, tenants) ochre, reference IDs (GUIDs, SIDs, account numbers, phones) tan, and one-way tokens grey with a dashed underline. A legend counts each category; hovering an entry outlines all its tokens.
- **Token popover.** Hovering or focusing a token shows its token, type, how often it was seen and its real value, and outlines every occurrence. Click copies the real value, Shift-click the token; a one-way token says its value was never kept and click copies the token. On touch, a tap pins the popover with "Copy value" and "Copy token" buttons. In an output, arrow keys move between tokens and Enter copies. In the restored text, the popover shows which token a value came from; unknown tokens get a wavy underline.
- **Copy is always plain text.** Copy buttons write the engine's string. A copy handler on the document writes `text/plain` only; when the selection is inside an output, its start and end are mapped back to offsets in the engine's string and that slice is copied, so a hand-made selection is exactly the masked (or restored) text. Toasts name the token ("Copied real value of [HOST_1]") and never contain a value.
- **Hide values.** For screen sharing, real values are left out of the popover and the mapping table altogether, replaced by a fixed-width bar; copying still works. While it is on, the filter matches tokens and types only.
- **Mapping table.** Token (click copies it), type, real value, times seen, and a copy-value button (disabled for one-way rows, which read "Not kept (one-way)"). A filter box (`/`) narrows it. At most 500 rows are drawn, with a note to filter, so huge sessions stay fast.
- **Settings drawer.** A modal `<dialog>` from the right (full width on phones): detector toggles grouped by category with the same swatches, the two keep options, Custom terms, Internal domains, Never mask, and the data-handling note. Esc closes it and focus returns. A summary in the Mask pane ("12 detectors on, 1 custom term, 1 domain") opens it. Changes apply on the next Mask.
- **Shortcuts.** Ctrl/⌘+Enter runs the current tab; M and R switch tabs, S opens settings, / focuses the filter, ? shows the list, Esc closes. Single letters only act when focus is not in a text field and no dialog is open.
- **Theme.** Day (paper) and Night (graphite) palettes. The page follows `prefers-color-scheme` until the user picks one with the sun/moon button.
- **Large pastes.** The first 20,000 tokens are highlighted and the rest of the output is plain text, with a note; Copy masked still copies everything.

## Tokens

A token is `[LABEL_n]`: an upper-case label and a counter that is separate per label, for example `[USER_3]` or `[PRIVATE_IP_12]`. Card tokens carry the last four digits as a suffix: `[CARD_2:****1111]`.

- **Consistent.** The same value always gets the same token for the life of the tab, across every Mask run, so correlation survives ("the same user on two hosts"). Once a user, host or name has a token, the re-masking step gives it the same token wherever else it appears, even where no detector would have found it.
- **Normalised.** Values are compared after normalisation, so variants share a token: case for most values, digits only for phones (with `+234`/`+44` folded to a leading `0`), `:` separators for MACs, `.` for defanged IPs (`1.2.3[.]4`).
- **Signal-preserving.** Labels keep the type, and some detectors keep structure outside the token: the RID of a domain SID (`S-1-5-21-[DOMAIN_SID_1]-500`), the last four card digits, the private vs public IP label, the service suffix of a cloud resource (`[AZ_STORAGE_1].blob.core.windows.net`), the `-my` of a OneDrive host, and the `$` of a machine account (`[HOST_1]$`, which shares its token with the same name in a `Workstation Name:` field).

### Reversible and one-way

| Mode | Stored | Restorable | Used for |
|---|---|---|---|
| Reversible | Original value in the reverse map | Yes | Identifiers you want back in the reply: users, names, emails, hosts, IPs, GUIDs, phones, account numbers, custom terms. |
| One-way | A 32-bit FNV-1a hash of the normalised value, used only to keep the token consistent | No | Secrets and high-risk numbers: keys, tokens, passwords, card numbers, BVN, NIN. The mapping table shows "not stored (one-way)". |

## Restore

AI replies often reformat tokens. Restore accepts, for any label used in this session:

| Form in the reply | Example | Restored |
|---|---|---|
| As written, in backticks or bold | `[HOST_1]`, `` `[HOST_1]` ``, `**[HOST_1]**` | Yes |
| Bare | `HOST_1` | Yes |
| Any case, in brackets | `[host_1]`, `[Host_1]` | Yes |
| Markdown-escaped | `\[HOST\_1\]`, `[HOST\_1]`, `HOST\_1` | Yes |
| Space, hyphen, non-breaking space or padding | `[HOST 1]`, `[HOST-1]`, `[ HOST_1 ]`, `[private ip 1]` | Yes |
| One bracket missing | `[HOST_1 was down`, `HOST_1]` | Yes |
| Plural or possessive | `HOST_1s`, `HOST_1's` | Yes (the `s` stays) |
| Invisible characters inside | zero-width space or joiner between label and number | Yes |
| Bare lowercase | `host_1` | No: more likely a code identifier |
| Prose | `host 1`, `user 1 of 3` | No: bare forms need the underscore |
| A different number | `HOST_10` when only `HOST_1` exists | No, reported as not restored |

How it works: one pass matches bracketed forms case-insensitively, a second matches bare upper-case forms. Each resolved piece is held in a private-use placeholder (`U+E002 … U+E003`), together with its kind and token, until both passes finish, so the second pass can't re-match a token the first pass wrote back, or text inside a restored value. A `\` before `[` only counts as a markdown escape when the `]` is escaped too, so `C:\Users\[USER_1]\AppData` restores to the real path.

The report under the restored text (`PM.report()`) lists:

- **Restored**: how many values came back.
- **Not restored, not from this session**: token-shaped text the session doesn't know, such as a number the AI invented, a token from another tab, or anything left after "End session".
- **One-way, kept as tokens**: secrets, cards and national IDs, written back in their canonical form (`[SECRET_1]`, `[CARD_1:****1111]`).

## Session store

```text
S = {
  fwd:  Map<"LABEL|normalised value" | "LABEL|#hash", "[LABEL_n]">   // value -> token
  rev:  Map<"[LABEL_n]", original value>                             // token -> value (reversible only)
  cnt:  { LABEL: n }                                                  // last number used per label
  rows: [{ token, label, orig | null, seen }]                         // mapping table, in creation order
  byToken: Map<"[LABEL_n]", row>
  learned: Set<domain>                                                // organisation domains learned from emails
}
```

Each row also counts how often its token was used (`seen`), and `byToken` indexes the rows by token. The store lives only in page memory. Nothing is written to `localStorage`, cookies, IndexedDB or files.

## Placeholder mechanism

Detectors run one after another over the same string. Without protection, a later detector could match inside a token written by an earlier one, or inside text the earlier one deliberately kept (for example the digits `-500` after a SID, or a card's `****1111`).

So `mk()` doesn't put the token into the text. It pushes the finished token onto a list `PH` and returns a placeholder made only of Unicode private-use characters:

```text
U+E000  +  index digits encoded as U+E010..U+E019  +  U+E001
```

No detector pattern matches those characters, and value classes that could otherwise run into a placeholder exclude the range `\uE000-\uE0FF` explicitly. After the last detector, one pass replaces each placeholder with `PH[index]`.

## Detectors

Detectors run in this order. Earlier means more specific: secrets go first so a password is never half-matched as a hostname, GUIDs go before phones and cards because an all-digit GUID segment looks like a number, and usernames in command lines are found after the passwords next to them are already masked.

| # | Group (toggle) | Labels | What it matches | Mode |
|---|---|---|---|---|
| 1 | Secrets and tokens | `PRIVATE_KEY` | PEM private key blocks | One-way |
| | | `JWT` | `eyJ…` three-part tokens | One-way |
| | | `AWS_KEY` | `AKIA`/`ASIA` access key IDs | One-way |
| | | `TOKEN` | GitHub (`ghp_`, `github_pat_`…) and Slack (`xox?-`) tokens; values after `Bearer` | One-way |
| | | `API_KEY` | Google API keys (`AIza…`) | One-way |
| | | `USER` + `SECRET` | `scheme://user:password@host`: the user is reversible, the password one-way | Mixed |
| | | `SECRET` | Key/value secrets (`password`, `pwd`, `secret`, `token`, `api_key`, `client_secret`, `sig`, `AccountKey`, `SharedAccessKey`…) with `=` or `:`, quoted values with spaces, and `&`-separated URL parameters | One-way |
| | | `SECRET` | URL query secrets (`code`, `key`, `signature`, `session`, `x-amz-signature`…) | One-way |
| | | `SECRET` | Entra ID client secret format (`xxx9Q~…`) without a key | One-way |
| | | `SECRET` | Command-line passwords: `net user NAME PASS`, `net use … PASS`, password-only flags (`--password`, `-Password`, `-pw`, `/rp`, `/password:`…), `-p`/`/p:` for tools where it means password (psexec, sshpass, xfreerdp, nxc and similar), `sqlcmd -P`, `mysql -pPASS`, `curl -u user:PASS`, `smbclient -U user%PASS`, `domain/user:PASS@host`, `ConvertTo-SecureString`, `openssl -pass pass:`, `Authorization: Basic/Digest/NTLM/Negotiate` | One-way |
| 2 | GUIDs | `GUID` | 8-4-4-4-12 hex | Reversible |
| 3 | BVN / NIN | `BVN`, `NIN` | 11 digits after the keyword | One-way |
| 4 | Account numbers | `ACCOUNT` | 10 digits after `account`, `acct`, `a/c` or `NUBAN` | Reversible |
| 5 | Phone numbers | `PHONE` | Nigerian mobile, UK mobile, and `+country` numbers, 10–15 digits | Reversible |
| 6 | Card numbers | `CARD` (`:****last4`) | 13–19 digits with a known card prefix (IIN) and a valid Luhn check | One-way |
| 7 | Emails and UPNs | `EMAIL`, or `USER` with "keep email domain" | `name@example.com`-style addresses, with bounded repeats | Reversible |
| 8 | Usernames and names | `USER`, `NETBIOS` | `C:\Users\NAME`, `/home/NAME`, `/Users/NAME`, `DOMAIN\NAME` (skips well-known domains, file names and folders inside spaced paths). `DOMAIN\NAME$` is a machine account and becomes `HOST` | Reversible |
| | | `USER` | Usernames in commands: `net user NAME`, `net localgroup … NAME /add`, `/user:`, `/u:`, `/ru`, `--user`, `-UserName`, and `-u`/`-U`/`-l` for tools where it means user (psexec, nxc, sqlcmd, mysql, psql, smbclient, hydra and similar), `curl -u NAME:`, `domain/NAME:…@host` | Reversible |
| | | `USER`, `NETBIOS`, `ORG_DOMAIN` | Key/value fields in Windows events, JSON, CEF and key=value logs: account keys (`Account Name`, `*AccountName`, `*UserName`, `SAM Account Name`, `suser`, `duser`, `user`…) and domain keys (`Account Domain`, `*DomainName`…) | Reversible |
| | | `USER` | Auth logs: `Accepted/Failed … for NAME`, `Invalid user NAME`, `session opened for user NAME`, `sudo: NAME :` | Reversible |
| | | `PERSON` | Display-name fields (`Display Name`, `DisplayName`, `UserDisplayName`, `givenName`…), a name after a title (`Mr`, `Mrs`, `Dr`, `Prof`, `Engr`…), and a mail display name before a masked address (`"Jane Doe" <…>`) | Reversible |
| 9 | Hostnames and cloud resource names | `HOST`, `ORG_DOMAIN` | Anything under a listed internal domain or a domain learned from email addresses; `\\host\share`; `DESKTOP-`, `LAPTOP-`, `WIN-`, `SRV-` names | Reversible |
| | | `HOST` | Host fields (`*DeviceName`, `*ComputerName`, `*HostName`, `Workstation Name`, `Computer`, `devname`, `shost`, `dhost`, `host=`…), the host in a syslog line, and hostname-shaped words after `device`, `host`, `computer`, `server`, `workstation`. A dotted name in a destination-style field (`DestinationHostName`, `dhost`, `host=`) is often a public site, so it is masked only under a known domain or a private suffix (`.local`, `.lan`, `.internal`, `.corp`) | Reversible |
| | | `AZ_STORAGE`, `AZ_SERVICEBUS`, `AZ_SQL`, `AZ_KEYVAULT`, `AZ_APP`, `AZ_REGISTRY`, `AZ_COSMOS`, `TENANT` | The resource name before a known Azure suffix, and `AccountName=` in connection strings | Reversible |
| 10 | Custom terms (always on) | Your label, or `TERM` | Exact terms from the Custom terms box, longest first, whole-word | Reversible |
| 11 | Domain SIDs | `DOMAIN_SID` | The domain part of `S-1-5-21-a-b-c`, keeping the RID | Reversible |
| 12 | MAC addresses | `MAC` | `aa:bb:cc:dd:ee:ff` / `aa-bb-…` (skips all-zero and broadcast) | Reversible |
| 13 | IP addresses | `PRIVATE_IP`, `PUBLIC_IP` | IPv4 (including defanged `[.]` and `(.)`) and IPv6; skips loopback, `0.0.0.0` and broadcast | Reversible |
| 14 | Re-masking (always on) | The value's existing label | Any user, NETBIOS domain, person or host already in the session store, wherever it appears as a whole word (machine-account `$` and sentence punctuation kept outside). Follows the toggle of the original group | Reversible |

**Skipped on purpose:** `NT AUTHORITY`, `BUILTIN`, `NT SERVICE` and other well-known domains; registry hives (`HKLM`, `HKCU`…); built-in and default accounts (`SYSTEM`, `Administrator`, `Guest`, `krbtgt`, `root`, `admin`, `sa`, `www-data`, `Public`, `Default`…); empty field values (`-`, `N/A`) and log levels (`INFO`, `ERROR`); values such as `true`, `null`, `none`, `redacted`, `****`; variables and placeholders (`$pw`, `%PW%`, `*`, `<password>`, `{{pw}}`); anything in the never-mask list.

### Learned domains

When emails are masked whole, the domain of each address is considered sensitive too. Before the detectors run, `learnDomains()` reduces each address's domain to its organisation domain (`mail.corp.example.co.uk` → `example.co.uk`) and adds it to `S.learned`. The hosts detector then treats learned domains like listed internal domains, so the same organisation is masked in `Received:` headers, URLs and FQDNs. Webmail and large shared platforms (`gmail.com`, `outlook.com`, `microsoft.com`, `onmicrosoft.com`…) are never learned. With *Keep email domain* on, nothing is learned. Learned domains last for the session and are forgotten by "End session".

### Re-masking rules

The last step looks up every whole word in a map of the session's users, NETBIOS domains, persons and hosts (one linear pass, so thousands of known values cost little). To avoid masking ordinary words:

- Values shorter than 4 characters, all-digit values and common words (`backup`, `sales`, `admin`, `support`, `server`…) are never re-masked.
- A short all-letter value (under 8 letters) is only re-masked with the same case, so the account `FINCO` doesn't swallow "Finco" in prose.
- Multi-word names (`Jane Doe`) are matched as a phrase.

**Options that change detectors:** *Keep email domain* masks only the local part, as `USER`, and turns off domain learning. *Keep public IPs* leaves public addresses as they are. Turning a group off skips it entirely, including re-masking of values that group found.

### Performance

Every pattern is bounded so the work stays roughly linear in the input size. Long lines can't trigger runaway backtracking: email parts have length limits, the gap between a tool name and its flag is capped at 500 characters, and the spaced-path check looks back at most 400 characters. Re-masking is a single pass with a map lookup per word. As a rough guide, 1.5 MB of mixed logs masks in about half a second. The test suite times known worst-case inputs.

Drawing the result is bounded too: at most 20,000 highlighted tokens and 500 mapping rows. Measured in headless Chromium with `tests/ui.js`, a 1.5 MB paste is masked, rendered and painted in about 1.2 s for mixed logs (about 36,000 tokens) and 1.4 s for 1.5 MB of distinct values (about 64,000 tokens, all in the mapping).

## Privacy guarantees

- **No network.** The CSP meta tag is `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'`, so the page cannot fetch, post, open sockets or load remote resources. `font-src data:` only allows the two fonts embedded in the file.
- **No persistence of values.** The session store lives in memory only. Closing or reloading the tab, or "End session", discards it.
- **One stored setting.** The theme choice is the only thing written to storage: one `localStorage` key, `paste-masker-theme`, whose value is only ever the literal `light` or `dark`. It is stored so the page doesn't flash the wrong palette on every open, and it carries no text or value. Every read and write is wrapped in `try`, so a browser that blocks storage still works (the choice then lasts for the tab). The test suite fails on any other storage use: other keys or values, `sessionStorage`, IndexedDB or cookies.
- **One-way stays one-way.** Secrets are never stored. Only a short hash is kept, to keep their token consistent, and restore can never bring them back.
- **No HTML injection.** Pasted text and stored values are only ever placed with `textContent` or into text areas. The page has no `innerHTML`-style calls at all; icons are static markup or cloned from a `<template>`.
- **Plain-text copies.** Every copy from the page is `text/plain` only, and toasts and status lines never contain a real value.
- **Hardened text fields.** See below.

### Text fields

Every text area, and the mapping filter box, asks the browser and common extensions not to keep or send its contents:

| Attribute | Stops |
|---|---|
| `autocomplete="off"` | Form history, and restoring the text after a reload, a crash or a discarded tab (the browser doesn't save these fields in session history) |
| `spellcheck="false"`, `autocorrect="off"`, `autocapitalize="off"` | Spell-check (including cloud-enhanced spell-check) and mobile keyboard corrections |
| `translate="no"` (also on `<html>`), `<meta name="google" content="notranslate">` | Offers to translate the page, which sends its text to a translation service |
| `writingsuggestions="false"` | Built-in writing suggestions |
| `data-gramm`, `data-gramm_editor`, `data-enable-grammarly`, `data-lt-active`, `data-ms-editor` (all `"false"`) | Grammarly, LanguageTool and Microsoft Editor, which send text to their servers |

As a backstop, the raw text and reply boxes and both rendered outputs are cleared on `pagehide`, when the tab closes or navigates away. The mapping itself is never written anywhere. The CSP also sets `form-action 'none'` and `base-uri 'none'`, which `default-src` doesn't cover, and the page has no forms or links. The test suite fails if any text field lacks one of these attributes.

## Limits

- **Pattern matching misses things.** Names in free text, unusual password formats, and identifiers with no recognisable shape or keyword pass through. Always read the masked output before pasting it. Add misses to Custom terms.
- **Tokens still carry information.** Labels reveal the type and the counters reveal how many distinct values there were. Consistent tokens reveal which events share a value. Kept structure (RIDs, last four card digits, cloud suffixes) is visible by design.
- **Options reduce masking.** "Keep email domain" and "Keep public IPs" deliberately leave those values in the clear.
- **The hash is not a secret.** A 32-bit hash of a short one-way value could be brute-forced by someone who can read the tab's memory. It never leaves the page.
- **The CSP doesn't cover everything.** It doesn't stop browser extensions from reading the page, other apps from reading the clipboard, or a user from following a link. The page contains no links for that reason.
- **Opt-outs are requests.** The field attributes are honoured by browsers and the named extensions, but an extension can ignore them. Use a browser profile without such extensions for sensitive text.
- **Cues can be wrong.** Field and keyword cues assume the value after `user=` is a user and the value after `Display Name:` is a person. An app name in a `DisplayName` field becomes a `PERSON` token, and an ordinary word that happens to equal a known username elsewhere is re-masked.
- **Learned domains hide destinations.** If the text contains an address at a domain, every URL and host under that domain is masked too. Turn on *Keep email domain* when those destinations matter.
- **Restore trusts token shapes.** Any token form in the reply that matches a stored token is replaced, even if the AI used it to mean something else.

## Tests

- `node tests/run.js` loads only the engine block into a Node VM with no DOM (`tests/page.js`) and drives `PM` directly, with a fresh engine per case. It runs the masking cases in `tests/cases.js` (leak and keep checks), restore checks (including the `unknown` and `oneWay` lists and the report built from them), span positions, mapping rows, session reuse, the built-in sample round trip and timing on worst-case inputs. It also checks the whole file statically: hardened text fields, the CSP, the theme-only storage rule, no other storage, network, HTML injection, links or forms, no page access from the engine, and the `pagehide` handler. Cases marked `todo` are known gaps. They are listed with `--gaps`, and the run fails if one starts passing so its `todo` gets removed.
- `node tests/ui.js` opens the page in headless Chromium with Playwright and goes through it end to end: the sample, highlighted tokens, plain-text copies equal to the engine's output (including a hand-made selection), hover, click, Shift-click and keyboard on tokens, Hide values, the mapping filter, the settings drawer and a toggle, shortcuts, restore of a reformatted reply and its report, `pagehide`, End session, the theme persisting with only the allowed key, a 390 px phone layout without horizontal scrolling, timing for 1.5 MB inputs, and no console errors or network requests. Without the `playwright` package it prints "skipped" and exits 0. CI installs it after the dependency-free steps.
- `node tests/public-safety.js` keeps real-looking data out of the repo: unknown GUIDs, non-example email domains, public IPs outside documentation ranges, and terms from a private, git-ignored `.public-safety-denylist`.
