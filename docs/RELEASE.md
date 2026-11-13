# Releases and deployment

These are operator instructions, not actions performed by the audit.

## Release 1.0.0

Review and commit the intended changes first. In a clean checkout, with the
Astrodienst ephemeris files installed, run:

```sh
npm ci
EPHE_PATH=/path/to/ephe npm test
git status --short
git tag -a v1.0.0 -m "sweph-core 1.0.0"
git push origin main
git push origin v1.0.0
gh release create v1.0.0 --verify-tag --title "sweph-core 1.0.0" --notes-file CHANGELOG.md
```

Do not move an existing release tag. A fix receives a new version and tag.

## Deploy the published tag

Use a separate release directory. Obtain the URL from package.json repository
(remove the `git+` prefix); REPO_URL below is that URL. Keep data files and
secrets outside the checkout.

```sh
git clone --branch v1.0.0 --single-branch "$REPO_URL" release-v1.0.0
cd release-v1.0.0
git checkout --detach v1.0.0
git status --porcelain
export GIT_COMMIT="$(git rev-parse HEAD)"
export GIT_TAG=v1.0.0
export SOURCE_URL="${REPO_URL%.git}/tree/$GIT_COMMIT"
npm ci --omit=dev
# Supply CORE_SECRET and EPHE_PATH through the process manager's protected environment.
node server.cjs
```

The working tree must be clean. Persist GIT_COMMIT, GIT_TAG and SOURCE_URL in
the deployment environment before packaging; the runtime does not call Git.
Use Node >=22.12 and a C++ toolchain appropriate to the deployment platform.
Preserve the source at the advertised URL and the lockfile. A tag label is not
proof of a build's identity: compare the resolved commit with the release.

Run one instance under a process manager configured to restart on failure.
Check GET /health, then authenticated GET /version: service.version must be
1.0.0, service.gitCommit and service.gitTag must match the deployment, and
X-Source-Code must point to that published source. Record the ephemeris digest
and retain the matching data snapshot. Start the client application afterward.
For rollback, stop the client, restore the previous release directory, its
build environment and data snapshot, restart and verify before restarting the
client. Do not roll back by moving tags.

## Moving to a neutral account or organization

1. Prefer GitHub Settings > General > Transfer ownership. Confirm access to the
   destination and inspect its permissions and repository settings. Alternatively,
   create an empty repository and copy branches/tags after deciding whether to
   retain or clean the history. A transfer retains the existing history.
2. Update package.json repository, homepage and bugs together. Runtime uses
   SOURCE_URL when set and otherwise derives the public address from repository.
   README uses this metadata rather than another hard-coded repository URL.
3. Publish the matching source at the new location, update SOURCE_URL in every
   deployment, and update the website's source link/notice. Verify X-Source-Code.
4. For each local clone, the owner may run (not executed by this audit):

   ```sh
   git remote set-url origin https://github.com/NEW_OWNER/sweph-core.git
   git remote -v
   ```

5. Check releases, issues, permissions and links after transfer. GitHub normally
   redirects old repository links after transfer, but update consumers explicitly
   and avoid reusing the old path. A new repository does not automatically provide
   redirects or migrate issues/releases. Existing clones keep their old remote and
   all previously downloaded history until their owners update or replace them.

## Optional history cleanup

Ordinary commits do not remove old data. Rotate/revoke a real credential first;
no credential requiring rotation was identified by this audit. Rewriting is
optional for metadata and obsolete internal references, and requires coordination
with every collaborator. Never treat rewriting as revocation.

The detailed local audit report lists the exact historical files. If the owner
chooses to remove those files from ALL history, use a fresh mirror, not the
working repository (this removes historical versions of useful files too):

```sh
git clone --mirror "$REPO_URL" cleanup.git
cd cleanup.git
# Save the accepted clean release before removing these files from history:
git archive refs/heads/main -o ../reviewed-source.tar
git filter-repo --invert-paths --path README.md --path src/ephemeris.cjs --path test/helpers.mjs --path test/parity-7a.test.mjs --path test/fixtures/parity-7a.json --path src/codec.cjs --path src/contract.cjs --path src/errors.cjs
# Review the rewritten history, then restore the accepted clean snapshot:
git clone . ../cleanup-work
cd ../cleanup-work
tar -xf ../reviewed-source.tar
git add -A
git commit -m "Restore reviewed source after history cleanup"
git push origin main
cd ../cleanup.git
# filter-repo normally removes origin; only the owner may restore it:
git remote add origin "$REPO_URL"
# Only after verifying every ref and coordinating protections/collaborators:
git push --force --mirror origin
```

Do not run the mirror push blindly: it can delete remote refs. For email-only
cleanup, instead of the file-removal invocation, prepare a private mailmap and use
`git filter-repo --mailmap ../private.mailmap`. A mailmap record has the form
`Georgi Dimov <YOUR_GITHUB_NOREPLY> <OLD_EMAIL>`. Copy the old email from the
local audit report. It must cover both author and committer identities.

Rewriting changes commit IDs and can invalidate tags/signatures and release
references. Existing clones, forks and caches still retain old data. Arrange fresh
clones and ask GitHub Support about cached sensitive content when applicable.
For future commits only, copy the exact noreply address from GitHub Settings >
Emails and run `git config --local user.email "YOUR_GITHUB_NOREPLY"`.
This changes no past commits and is not executed by this audit.
