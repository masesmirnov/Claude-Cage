# Contributing

Cage uses the flow "contribution issue review → collaborator invitation → pull request → review and merge". Only collaborators can open pull requests in the repository; code fixes, feature improvements and documentation changes all start from a clear contribution proposal.

## Submit a proposal and wait for review

On the [new issue page](https://github.com/Lee-xeo/Claude-Cage/issues/new/choose), choose "Contribution". Describe the problem to solve, the version or commit it is based on, the systems it applies to, the approach, the verification results and the scope of impact. If there is code, attach the fork branch, specific commits, a diff or a patch; clearly mark the parts that have not been verified yet.

Use "Bug report" when you only have a problem description, and "Feature request" for a feature need without a concrete proposal. Search existing issues before submitting, and link related discussions in the contribution issue.

When creating it through the GitHub CLI or API, keep `[Contribution]` at the start of the title. Such requests cannot carry form labels, so the **Label contribution issues** workflow adds the `contribution` label based on the title prefix; this also applies after the title is edited.

After a repository administrator or a maintainer with `maintain` permission reviews the proposal and agrees to accept this contribution, they add the `accepted` label to the `contribution` issue while it is still open. Passing review means the work can move on to implementation and pull request review; the final merge still depends on code review and verification results.

## System labels

Issues carry six labels by the systems involved: `macOS host`, `Windows host`, `Linux host`, `macOS guest`, `Windows guest`, `Linux guest`. The host is the computer that runs Cage, and the guest is the system that runs inside Cage; one issue can carry several labels. Maintainers of each platform filter by label and pick up the issues they are responsible for.

When an issue is created, the **Label issues by system** workflow reads the fields in the body whose titles contain "host" or "guest" and adds the matching labels. When creating it through the GitHub CLI or API, reuse the form's field titles, for example write `macOS` under `### Host system` and `Linux` under `### Guest system`.

The workflow only adds labels, and labels maintainers adjusted by hand are kept. To detect them again after the body changes, choose **Run workflow** in **Actions → Label issues by system** and enter the issue number; when detection is wrong or the body has no system information, a maintainer fixes it by hand.

## Accept the collaborator invitation

Adding the `accepted` label triggers the **Invite approved contributors** workflow, which sends a collaborator invitation to the issue author and explains the next steps in the issue. Collaborators who already have write access can open a pull request directly; a pending invitation is reused.

Contributors accept the invitation through a GitHub notification or the [repository invitations page](https://github.com/Lee-xeo/Claude-Cage/invitations). If the invitation expires or the flow fails, contact the maintainers in the original issue.

Collaborators have write access to the whole repository, not only to this one issue. `main` is protected; collaborators deliver changes through their own branches and pull requests, which the code owner `@Lee-xeo` reviews before merging; new commits need another review. Closing the issue or removing the `accepted` label does not cancel the invitation or revoke existing access; repository administrators change access in the repository settings.

## Submit a pull request

1. After accepting the invitation, update your local base to the latest `main` of the repository.
2. Create a separate branch for this contribution, named "start date-GitHub username-work", for example `261112-alice-fix-startup`. Keep unrelated work in progress out of it, and keep the scope in line with the approved proposal; discuss in the original issue before widening it.
3. Finish the implementation and run the checks related to the change. For shared features, check macOS, Windows and Linux; state the platforms you actually verified, the results and what was not verified.
4. Push the branch and open a pull request against `main`. Link the contribution issue in the body, for example `Closes #123`, and describe the user-visible changes, the verification results and known limitations.
5. Update the pull request based on review comments. After it passes review and the required checks, a maintainer merges it, then the merged branch is deleted and the issue is closed.

Source code, configuration, logs and attachments must not contain sensitive information such as passwords, tokens or subscription links. When using third-party code, cite the source and keep the required license.

## Building macOS from source

The macOS app is built with `bash scripts/build-app.sh`. Both Apple Silicon and Intel build the embedded Tailscale guest component through `make cage`. A full build needs the minimum versions of both Go modules:

| Module | Minimum Go version | Version source |
| --- | --- | --- |
| Workbench and control service | 1.26.10 | Root [go.mod](../go.mod) |
| Tailscale guest component | 1.27.3 | [tools/tailnet/go.mod](../tools/tailnet/go.mod) |

Each module's `go.mod` is authoritative. Check both modules from the repository root before downloading materials and compiling:

```sh
go version
go list -m
(cd tools/tailnet && GOFLAGS= go version && GOFLAGS= go list -m)
bash scripts/build-app.sh
```

`GOTOOLCHAIN=auto` finds or downloads a toolchain that meets the module requirements when needed; if none is found locally, the Go toolchain download service must be reachable. The macOS CI `setup-go` reads the root `go.mod`, and building the submodule also relies on this selection. See the [Go toolchain documentation](https://go.dev/doc/toolchain) for the rules.

With `GOTOOLCHAIN=local`, the Go in `PATH` must itself meet the requirements of both modules, for example Go 1.27.3 or newer; preparing only Go 1.26.10 fails when building `tools/tailnet`. Offline builds also need the Go modules, frontend dependencies and download materials used by the build scripts prepared in advance. Windows and Linux builds use this submodule too and need the same version.

## Maintainers: configure automatic invitations

Automatic invitations use the secret `CONTRIBUTION_INVITE_TOKEN` in the `contribution-invites` environment. Use a fine-grained personal access token authorized only for `Lee-xeo/Claude-Cage`, with the repository permission **Administration: Read and write**; keep all other permissions minimal. Give the token an expiration date and renew it before it expires.

In the repository's **Settings → Environments → contribution-invites**, allow deployments only from the `main` branch and save the token as an environment secret. Do not put the invitation token in a regular repository secret, or collaborators with write access could use it in workflows on other branches. The built-in GitHub Actions `GITHUB_TOKEN` checks reviewer permissions and writes reminders, but cannot send collaborator invitations on its own.

Branch protection on `main` requires a pull request, at least one code owner review and another review after new commits, and forbids force pushes and deletion; `.github/CODEOWNERS` sets `@Lee-xeo` as the code owner of all paths. Administrators keep the right to handle their own changes. Together with the `main`-only environment, these protections keep regular collaborators from getting the invitation token on unreviewed branches.

Daily review steps:

1. Confirm that the issue has the `contribution` label, and finish reviewing the proposal and the contributor. Contributions without the `[Contribution]` title prefix do not get the label automatically; add it by hand once you confirm it is a contribution.
2. An administrator or a maintainer with `maintain` permission adds the `accepted` label. Regular `write`, `triage` and `read` permissions do not authorize it.
3. Check the result in **Actions → Invite approved contributors**. The workflow posts the next steps in the issue only if the invitation succeeded, a pending invitation exists or the author already has write access.
4. If the credential is missing, expired or lacks permission, or the invitation failed, fix the cause first, then choose **Run workflow** on that workflow page, use the `main` branch and enter the original issue number to retry. A retry also checks the current reviewer's permission, the issue state and both labels, and reuses the existing reminder.

The automation reads scripts from the default branch and does not run the applicant's code. It only handles the invitation and reminder after review; proposal review, accepting the invitation, implementation and pull request review are done by the people involved.

GitHub references: [collaborator invitation API](https://docs.github.com/en/rest/collaborators/collaborators#add-a-repository-collaborator), [workflow token permission boundaries](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token#granting-additional-permissions).
