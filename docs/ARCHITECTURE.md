# Architecture

Paste Masker is one HTML file with inline CSS and JavaScript. It has no build step, no dependencies and no network access. This document describes how it is put together and how text moves through it.

## Components

| Component | Where | Responsibility |
|---|---|---|
| Page shell | `<head>`, `<main>` | Layout, the Content Security Policy, the settings panel and the four text areas (raw, masked, AI reply, restored). |
| Defaults | `DEFAULT_TERMS`, `DEFAULT_INTERNAL_DOMAINS`, `DEFAULT_NEVER_MASK` at the top of the script | Values loaded into the settings boxes when the page opens. Edit them in your own copy of the file. |
| Config reader | `readCfg()` | Reads the toggles and text boxes into `CFG` (enabled groups, options, custom terms, internal domains) and `ALLOW` (never-mask list) on every Mask. |
| Detectors | `DETECTORS` array | Ordered list of pattern groups. Each replaces what it finds with a placeholder via `mk()`. |
| Tokeniser | `mk(label, value, options)` | Looks up or creates the token for a value, records it in the session store, and returns a placeholder. |
| Placeholder layer | `place()`, `enc()`, `dec()` | Holds finished tokens out of the text while the remaining detectors run (see below). |
| Session store | `S` | The token map for the current tab: forward map, reverse map, per-label counters and display rows. |
| Restorer | `restoreText()` | Swaps tokens in the AI reply back to their original values using the reverse map. |
| Renderers | `renderStats()`, `renderMap()` | The "Masked: …" summary and the mapping table. Values are written with `textContent`, never as HTML. |
| Clipboard | `copyFrom()` | Copies output with the Clipboard API, falling back to a selection copy. |

## Data flow

```mermaid
flowchart LR
  A[Raw text] -->|Mask| B[readCfg]
  B --> C[Detectors in order]
  C -->|each match| D["mk(): token from session store"]
  D --> E[Placeholder in text]
  E --> C
  C --> F[Expand placeholders to tokens]
  F --> G[Masked text]
  G -->|copy| H[(AI chat)]
  H -->|paste reply| I[Restore]
  I --> J[Reverse map lookup]
  J --> K[Restored text]
  D -.-> S[(Session store S, in memory)]
  J -.-> S
```

1. **Mask.** `readCfg()` captures the settings. `maskText()` resets the placeholder list and per-run counts, then runs each enabled detector over the text in order. Every match goes through `mk()`, which returns a placeholder. When all detectors are done, the placeholders are expanded into their visible tokens.
2. **Copy.** The masked text is copied and pasted into an AI chat by the user. The page itself sends nothing anywhere.
3. **Restore.** The AI reply is pasted back. `restoreText()` replaces every token it knows with the original value. Tokens it doesn't know, and one-way tokens, are left as they are.
4. **Clear.** "Clear mapping" (or closing the tab) empties the session store. After that, earlier masked text can no longer be restored.

## Tokens

A token is `[LABEL_n]`: an upper-case label and a counter that is separate per label, for example `[USER_3]` or `[PRIVATE_IP_12]`. Card tokens carry the last four digits as a suffix: `[CARD_2:****1111]`.

- **Consistent.** The same value always gets the same token for the life of the tab, across every Mask run, so correlation survives ("the same user on two hosts").
- **Normalised.** Values are compared after normalisation, so variants share a token: case for most values, digits only for phones (with `+234`/`+44` folded to a leading `0`), `:` separators for MACs, `.` for defanged IPs (`1.2.3[.]4`).
- **Signal-preserving.** Labels keep the type, and some detectors keep structure outside the token: the RID of a domain SID (`S-1-5-21-[DOMAIN_SID_1]-500`), the last four card digits, the private vs public IP label, the service suffix of a cloud resource (`[AZ_STORAGE_1].blob.core.windows.net`), and the `-my` of a OneDrive host.

### Reversible and one-way

| Mode | Stored | Restorable | Used for |
|---|---|---|---|
| Reversible | Original value in the reverse map | Yes | Identifiers you want back in the reply: users, emails, hosts, IPs, GUIDs, phones, account numbers, custom terms. |
| One-way | A 32-bit FNV-1a hash of the normalised value, used only to keep the token consistent | No | Secrets and high-risk numbers: keys, tokens, passwords, card numbers, BVN, NIN. The mapping table shows "not stored (one-way)". |

## Session store

```text
S = {
  fwd:  Map<"LABEL|normalised value" | "LABEL|#hash", "[LABEL_n]">   // value -> token
  rev:  Map<"[LABEL_n]", original value>                             // token -> value (reversible only)
  cnt:  { LABEL: n }                                                  // last number used per label
  rows: [{ token, orig | null }]                                      // mapping table, in creation order
}
```

The store lives only in page memory. Nothing is written to `localStorage`, cookies, IndexedDB or files.

## Placeholder mechanism

Detectors run one after another over the same string. Without protection, a later detector could match inside a token written by an earlier one, or inside text the earlier one deliberately kept (for example the digits `-500` after a SID, or a card's `****1111`).

So `mk()` doesn't put the token into the text. It pushes the finished token onto a list `PH` and returns a placeholder made only of Unicode private-use characters:

```text
U+E000  +  index digits encoded as U+E010..U+E019  +  U+E001
```

No detector pattern matches those characters, and value classes that could otherwise run into a placeholder exclude the range `\uE000-\uE0FF` explicitly. After the last detector, one pass replaces each placeholder with `PH[index]`.

## Detectors

Detectors run in this order. Earlier means more specific: secrets go first so a password is never half-matched as a hostname, and GUIDs go before phones and cards because an all-digit GUID segment looks like a number.

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
| 8 | Usernames | `USER`, `NETBIOS` | `C:\Users\NAME`, `/home/NAME`, `/Users/NAME`, `DOMAIN\NAME` (skips well-known domains, file names and folders inside spaced paths) | Reversible |
| 9 | Hostnames and cloud resource names | `HOST`, `ORG_DOMAIN` | Anything under a listed internal domain; `\\host\share`; `DESKTOP-`, `LAPTOP-`, `WIN-`, `SRV-` names | Reversible |
| | | `AZ_STORAGE`, `AZ_SERVICEBUS`, `AZ_SQL`, `AZ_KEYVAULT`, `AZ_APP`, `AZ_REGISTRY`, `AZ_COSMOS`, `TENANT` | The resource name before a known Azure suffix, and `AccountName=` in connection strings | Reversible |
| 10 | Custom terms (always on) | Your label, or `TERM` | Exact terms from the Custom terms box, longest first, whole-word | Reversible |
| 11 | Domain SIDs | `DOMAIN_SID` | The domain part of `S-1-5-21-a-b-c`, keeping the RID | Reversible |
| 12 | MAC addresses | `MAC` | `aa:bb:cc:dd:ee:ff` / `aa-bb-…` (skips all-zero and broadcast) | Reversible |
| 13 | IP addresses | `PRIVATE_IP`, `PUBLIC_IP` | IPv4 (including defanged `[.]` and `(.)`) and IPv6; skips loopback, `0.0.0.0` and broadcast | Reversible |

**Skipped on purpose:** `NT AUTHORITY`, `BUILTIN`, `NT SERVICE` and other well-known domains; registry hives (`HKLM`, `HKCU`…); `SYSTEM`, `Administrator`, `Guest`, `krbtgt`, `Public`, `Default`; values such as `true`, `null`, `none`, `redacted`, `****`; variables and placeholders (`$pw`, `%PW%`, `*`, `<password>`, `{{pw}}`); anything in the never-mask list.

**Options that change detectors:** *Keep email domain* masks only the local part, as `USER`. *Keep public IPs* leaves public addresses as they are. Turning a group off skips it entirely.

### Performance

Every pattern is bounded so the work stays roughly linear in the input size. Long lines can't trigger runaway backtracking: email parts have length limits, the gap between a tool name and its password flag is capped at 500 characters, and the spaced-path check looks back at most 400 characters. The test suite times known worst-case inputs.

## Privacy guarantees

- **No network.** The CSP meta tag is `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:`, so the page cannot fetch, post, open sockets or load remote resources.
- **No persistence of values.** The session store lives in memory only. Closing or reloading the tab, or "Clear mapping", discards it.
- **One-way stays one-way.** Secrets are never stored. Only a short hash is kept, to keep their token consistent, and restore can never bring them back.
- **No HTML injection.** Pasted text and stored values are only ever placed with `textContent` or into text areas.

## Limits

- **Pattern matching misses things.** Names in free text, unusual password formats, and identifiers with no recognisable shape or keyword pass through. Always read the masked output before pasting it. Add misses to Custom terms.
- **Tokens still carry information.** Labels reveal the type and the counters reveal how many distinct values there were. Consistent tokens reveal which events share a value. Kept structure (RIDs, last four card digits, cloud suffixes) is visible by design.
- **Options reduce masking.** "Keep email domain" and "Keep public IPs" deliberately leave those values in the clear.
- **The hash is not a secret.** A 32-bit hash of a short one-way value could be brute-forced by someone who can read the tab's memory. It never leaves the page.
- **The CSP doesn't cover everything.** It doesn't stop browser extensions from reading the page, other apps from reading the clipboard, or a user from following a link. The page contains no links for that reason.
- **Restore trusts token shapes.** Any `[LABEL_n]` in the reply that matches a stored token is replaced, even if the AI used it to mean something else.

## Tests

`tests/` runs the real page script in Node with a small DOM stub (`tests/page.js`), so tests exercise `readCfg`, the buttons, masking and restore exactly as the page does.

- `node tests/run.js` runs the masking cases in `tests/cases.js` (leak and keep checks), restore checks, the built-in sample round trip, and timing on worst-case inputs. Cases marked `todo` are known gaps. They are listed with `--gaps`, and the run fails if one starts passing so its `todo` gets removed.
- `node tests/public-safety.js` keeps real-looking data out of the repo: unknown GUIDs, non-example email domains, public IPs outside documentation ranges, and terms from a private, git-ignored `.public-safety-denylist`.
