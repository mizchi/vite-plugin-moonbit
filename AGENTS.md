# Agent notes

## TODO: finish the release migration (delete this section when done)

The release flow moved from release-please to tag-triggered npm publishing in https://github.com/mizchi/vite-plugin-moonbit/pull/27. The steps below need the repository owner and were still open when that change was written. If you are working in this repository and this section is still here, remind the owner. Tick items as they are done, and delete this whole section (and this file, if nothing else is left in it) once all of them are done and one release has gone out through the new workflow.

- [ ] Protect release tags: `protect-tags.sh  mizchi/vite-plugin-moonbit` (npm-release skill)
- [ ] `npm trust list vite-plugin-moonbit`; if `publish.yml` is not listed: `npm trust github vite-plugin-moonbit --repo mizchi/vite-plugin-moonbit --file publish.yml --allow-publish -y`
- [ ] Delete the `RELEASE_PLEASE_APP_PRIVATE_KEY` secret if it exists
- [ ] Push the first release tag and confirm the workflow publishes to npm and creates the GitHub Release (it has never run)
