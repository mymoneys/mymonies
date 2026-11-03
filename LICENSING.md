# Licensing

Copyright (c) 2026 Fred Gitonga.

MyMonies uses three licences. A file's own `SPDX-License-Identifier` line wins
over this table.

| What | Licence | Text |
|---|---|---|
| The app: everything not listed below | GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`) | [LICENSE](LICENSE) |
| M-Pesa parser and redaction code: `src/parser.ts`, `src/redact.ts`, `src/redact.test.ts` | Apache License 2.0 (`Apache-2.0`) | [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt) |
| Documentation: the prose in `README.md` and files in `docs/` | Creative Commons Attribution 4.0 International (`CC-BY-4.0`) | [LICENSES/CC-BY-4.0.txt](LICENSES/CC-BY-4.0.txt) |

Code samples inside the documentation follow the licence of the code they come
from.

## What this means

- **App (AGPL-3.0):** you can use, study, change and share it. If you
  distribute a changed version, or let people use one over a network, you must
  share its source under the same licence.
- **Parsers (Apache-2.0):** reuse them in any project, open or closed. Keep the
  copyright and licence notice.
- **Docs (CC BY 4.0):** reuse and adapt them for any purpose, with credit to
  MyMonies.

The names "MyMonies" and "Akiba" and the app's logo are not licensed for use in
your own products, so forks should use a different name.

Third-party packages keep their own licences. See each package in
`node_modules` or on npm.
