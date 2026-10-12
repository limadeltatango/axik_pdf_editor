# Chromium extension — foundation

This is an explicit-action Chromium Manifest V3 extension. Clicking the toolbar
action opens a full-tab editor. Select a local PDF using the file picker; open,
navigate, zoom, add an in-session callout and recover annotations from local draft
storage. **Edited PDF export is not implemented.** The browser requests one-site access only when the user clicks **Allow site and open PDF** after selecting **Open PDF link with Axik PDF Editor** from a link's context menu. It never intercepts navigation or requests native messaging privileges.

The published-extension feature set in docs/CHROMIUM_EXTENSION_SPEC.md is
**not yet implemented**. In particular, automatic URL takeover, native handoff, standard
PDF annotation serialization, real redaction and reliable printing are deferred.

After a validated dependency install:

1. From the repository root: pnpm build:extension
2. Open chrome://extensions or edge://extensions and enable Developer mode.
3. Choose Load unpacked and select apps/chromium-extension/dist.
4. Click the extension toolbar icon, then choose a local PDF.

This build/load sequence is documented but has **not been run or validated** in
this implementation pass. No Weave, Github Actions or background development
agents are involved.

**Privacy:** the extension never uploads files. Recovery journals save plaintext
annotation drafts in browser IndexedDB. Avoid entering sensitive secrets into
drafts until encrypted-storage and expiration policies are implemented.
