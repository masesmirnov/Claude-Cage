# Security issues

Cage is still in Alpha. For the scope of isolation and network checks, see the [README](README.md) and [Network and data boundaries](docs/getting-started.md#network-and-data-boundaries).

Do not upload proxy subscriptions, node passwords, session entry points, access tokens, full configuration directories or unredacted diagnostic output to public issues.

If you find a way to bypass isolation, read files that are not shared, or reach a control interface, report it privately through the repository's **Security → Report a vulnerability**. If that option is not enabled yet, contact the maintainer through the [maintainer's GitHub profile](https://github.com/Lee-xeo), saying only that you need to report a security issue privately, without publishing vulnerability details.

Include the Cage version, operating system version and processor architecture, minimal reproduction steps, the expected boundary and the actual result. Reproduce with test files and placeholder credentials, and say whether it still affects real data.
