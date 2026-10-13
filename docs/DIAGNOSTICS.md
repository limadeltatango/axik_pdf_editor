# Axik PDF Editor — Local Diagnostics and Support Bundles (Foundation v1)

**Work items:** [APDF-38](https://axikai.atlassian.net/browse/APDF-38), [APDF-39](https://axikai.atlassian.net/browse/APDF-39), [APDF-40](https://axikai.atlassian.net/browse/APDF-40), [APDF-41](https://axikai.atlassian.net/browse/APDF-41), [APDF-42](https://axikai.atlassian.net/browse/APDF-42)  
**Source branch:** `feat/local-diagnostics-support-bundle`  
**Scope:** locally recorded structured diagnostics that a user can explicitly export as a ZIP for troubleshooting on either Desktop or Chromium.  
**Status:** coded foundation only; typecheck, ZIP interoperability, real crash recovery, GPU/driver instrumentation and privacy-penetration tests remain unverified.

## 1. User workflow

1. In the Desktop or Chromium extension editor, open **Diagnostics** (also available from the React crash screen).
2. Reproduce the problem if possible. By default only **minimal diagnostic events** are recorded locally.
3. Review the recent event code list and what the export includes.
4. Optionally include browser/OS environment (selected by default) and **separately opt in** to identifiable GPU vendor/renderer information (off by default).
5. Click **Export diagnostics ZIP**.
6. Inspect the file before sharing; attach the downloaded ZIP in a ChatGPT conversation, APDF issue or support report. Nothing is uploaded automatically.
7. Use **Clear local history** to delete logs. Disable collection if you do not want diagnostic history retained.

The ZIP filename is `axik-pdf-diagnostics-<ISO-UTC-timestamp>.zip`, independent of any PDF's name or location.

## 2. Strict collection boundary

Only events matching a fixed code enumeration, a fixed event area, severity, time, current random session ID, safe error *class* and numeric whitelisted metrics are accepted. Free-form log messages are deliberately absent. Exception `message` and `stack` are **not** recorded in diagnostic events because they can expose filenames, paths, document contents or secrets.

**Always excluded by the diagnostic recorder:**
- PDF bytes, rendered pages, text snippets, OCR output, comments and annotations;
- PDF filenames, document hashes/fingerprints, filesystem paths, source URLs and browser tab URLs;
- user-entered form data, keyboard typed text, screenshots, passwords, API tokens and credentials;
- full exception messages, raw stack traces and raw binary crash dumps.

*Note:* This is a scoped guarantee for the new `@axik/diagnostics` code, not for third-party OS/browser crash facilities. If an eventual native crash dump capture is introduced, it requires its **own** explicit user opt-in, security review and sanitization policy.

## 3. Current events

The shared foundation records:
- App boot, ready, global JavaScript errors, unhandled rejections and React UI exceptions;
- PDF open attempts/success/failure (rounded file-size bucket, number of pages, duration);
- page loading, rasterizing, cancel/success/failure, page index, zoom and duration;
- callout creation and successful local draft storage or failure;
- persisted draft read failure / manual draft recovery;
- geometric print-plan preview opening, number of sheets, count of warnings, failure type;
- extension PDF-link fetch start, success/failure, duration and explicit permission denial;
- attempted edited-PDF export while no standards-safe writer exists.

Event examples (illustrative only):
```json
{"schema":1,"sessionId":"00000000-0000-4000-8000-000000000000","sequence":42,"timestamp":"2026-10-13T02:00:00.000Z","area":"render","code":"PDF_RENDER_OK","level":"info","metrics":{"pageIndex":2,"zoomPercent":100,"durationMs":105.8}}
```

No source filenames, text or hashes are needed to identify the stage of failure. An eventual correlated document identifier may be desirable but is **not** enabled until a privacy-safe, rotating, consented scheme is reviewed.

## 4. Storage and privacy

- Collection is local-only, enabled by default in early builds; it can be turned off in Diagnostics and that preference is stored locally (when browser local storage is available).
- Only the last **600 events per session**, the last **8 sessions**, and a **7-day** local retention window are intended to be stored. The IndexedDB database is app/extension-origin-scoped.
- Small buffered writes are scheduled after ~700 ms. Fatal UI exceptions trigger an immediate best-effort flush. Power loss or a killed browser before that flush can lose the latest diagnostic events; do not call this guaranteed crash capture.
- IndexedDB can fail (quota, disabled storage, permissions). The runtime falls back to an in-memory bounded log and reports reduced persistence in the ZIP manifest. PDF editing should not be blocked by an instrumentation failure.
- **Clear local history** empties IndexedDB and the current in-memory recorder, even if the persisted clear fails. Any failure is reported in the UI.
- The export is created locally and is not encrypted. **You control whether to upload or share it.**
- No cloud analytics, background data collection service, automatic URL requests, Weave runtime dependency, or mandatory user account is added.

## 5. ZIP format (v1)

The ZIP is a small self-contained archive using uncompressed STORE entries with CRC32, for broad compatibility without an additional binary/runtime dependency:

| Entry | Content |
|---|---|
| `README.txt` | How to use/share safely and the exact content exclusions |
| `manifest.json` | Report format/schema, app version, desktop/extension, record counts, enabled state, persistence health and inclusion flags |
| `events.jsonl` | One strictly whitelisted structured JSON event per line, oldest to newest |\n| `summary.json` | Counts per event and P50/P95/max timings without personal document data |
| `environment.json` | Only when selected: browser/OS, display viewport, approximate hardware concurrency/RAM and optionally identifiable WebGL GPU vendor/renderer |

The ZIP limits are eight entries maximum, 4 MiB per entry and 8 MiB total. When the report exceeds limits, export fails visibly, rather than silently dropping information or uploading it elsewhere.

## 6. Known limitations / future upgrades

**Not implemented yet:**
- Native Windows Event Logs, ETW/WER exception data, C++ crash minidumps and stack traces;
- real printer driver model/firmware, spooler return codes, print tickets, sheet output confirmation, paper-source changes and duplex behavior;
- GPU driver version, hardware device resets and actual PDF compositor-vs-rasterizer GPU utilization;
- PDF performance traces for every tile/font/image stage and full memory/VRAM telemetry;
- enterprise upload endpoint, Jira auto-attachment or ChatGPT direct uploader;
- user-consented reproduction capture/attachments and stronger redaction of native log text;
- in-app ZIP preview beyond event list and disclosure; user must inspect the exported archive before sharing.

These need separate privacy review, cross-platform and native integration, and validation. We should not enable blanket logging of printed/document content to solve test issues.

## 7. Acceptance plan (APDF-42)

**Do not claim QA complete until tested:**
- ZIP opens with independent ZIP extractors and CRC checks pass for all entries;
- malicious/long error message, file paths, URLs, annotations, PDF text and document hashes never appear in the resulting archive;
- two sessions/relaunches persist for seven days, older sessions expire, quota failure preserves in-memory export, Clear eliminates stored records;
- disabled collection stays disabled on restart; disabling doesn't falsely promise prior logs deleted;
- crash boundary still offers export, even when normal app rendering fails;
- Chrome and Edge MV3 and Windows WebView2 create the ZIP with no remote request;
- environment toggles accurately include/exclude GPU fingerprint information;
- no materially measurable performance penalty from recording under normal interaction (bounded writes, event throttling, storage failures isolated).

Work should be connected to **APDF**. Axik AI Weave was authorized for future development and validation on 2026-10-12 local Eastern time, but is **not** an installed product dependency and this diagnostics commit alone does not demonstrate a Weave run or successful test.
