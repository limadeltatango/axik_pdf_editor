# Windows printer preflight — APDF-19 (read-only foundation)

**Branch:** \`feat/apdf-19-printer-capabilities\`  
**Status:** Driver capability discovery and UI authored; Windows build and user-hardware verification required.

## Behavior

- When opened in the **Windows desktop** application, the Print dialog queries installed printer names using \`EnumPrintersW(PRINTER_INFO_4W)\`. This is fast and avoids querying offline network printers with \`PRINTER_INFO_2W\` during the initial list.
- The user explicitly selects the printer to inspect. Axik queries \`DeviceCapabilitiesW\` for the driver-advertised \`DC_PAPERS\`, \`DC_PAPERNAMES\`, \`DC_PAPERSIZE\`, \`DC_DUPLEX\` and \`DC_COLORDEVICE\`.
- Standard and architectural media use true physical dimensions in points: Letter, Legal, Tabloid, Arch C (18x24), Arch D (24x36), and Arch E (36x48). Match dimensions in millimeters, with limited driver rounding tolerance. Do NOT match by English paper name alone.
- If a selected driver does not advertise the paper stock or duplex mode, show a preflight warning and disable the **Open in Windows PDF Viewer** button. The user can still download a print-ready PDF for a different printer or a later date.
- If driver capabilities are unavailable, mark the condition **unknown**, not "supported."
- Selecting a printer in this preflight is **not yet printer selection for physical output**. The user must select the same physical device and paper stock in their external PDF viewer. Printing is never triggered silently.
- Driver inventory/results are used locally within the modal and are not included in automated diagnostics or cloud telemetry.

## Major unresolved hardware work

Driver capabilities do **not** establish that the stock is physically loaded. They also do not validate hard margins, print scale, tray selection, duplex edge direction, printer firmware overrides, paper handling, offline conditions or completed print jobs. **The full direct Windows spool engine is not implemented.**

References:
- https://learn.microsoft.com/en-us/windows/win32/printdocs/printer-info-4
- https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-devicecapabilitiesw
- https://learn.microsoft.com/en-us/windows/win32/printdocs/enumprinters

## Exit criteria before APDF-19 is Done

1. Windows x64 CI compiles and produces installer.
2. User desktop shows the correct printer list, including Windows print-to-PDF, local and network devices; missing/offline devices do not freeze UI.
3. Selecting each printer returns realistic sizes, supports mixed orientation on fixed stock, and refuses nonexistent physical paper with a clear explanation.
4. Physically verify at least two driver/printer classes, including duplex, a real Arch drawing-size sheet where available, and actual-size calibration.
5. Replace the external viewer handoff with validated driver-aware native spooling or explicitly scope the release to the external-dialog path.
6. Printer identities are excluded from the automatic support ZIP absent explicit consent.

Until (4) and (5), classify the feature as **driver preflight**, not completed intelligent physical printing.
