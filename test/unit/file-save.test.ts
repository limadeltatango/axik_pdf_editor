import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { documentFingerprint } from "@axik/recovery";
import {
  safeSaveAs, safeOverwriteOriginal,
  FileChangedError, FileSaveSafetyError,
  type ExplicitFileHandle, type WritableFileStreamLike
} from "../../packages/editor-ui/src/save-files";

class MemoryFileHandle implements ExplicitFileHandle {
  bytes: Uint8Array;
  writeCount = 0;
  constructor(readonly name: string, bytes = new Uint8Array()) {
    this.bytes = bytes.slice();
  }
  async getFile(): Promise<File> {
    return new File([this.bytes.slice()], this.name, { type: "application/pdf" });
  }
  async isSameEntry(other: ExplicitFileHandle): Promise<boolean> {
    return other === this;
  }
  async createWritable({ mode }: { mode?: "exclusive" | "siloed" } = {}): Promise<WritableFileStreamLike> {
    assert.equal(mode, "exclusive", "Unsafe non-exclusive file write was requested.");
    let staged: Uint8Array | undefined;
    return {
      write: async (value: Uint8Array) => {
        staged = value.slice();
      },
      close: async () => {
        if (!staged) throw new Error("Nothing staged for write.");
        this.bytes = staged;
        this.writeCount++;
      },
      abort: async () => { staged = undefined; }
    };
  }
}

class CorruptBackupHandle extends MemoryFileHandle {
  async createWritable(options: {mode?: "exclusive" | "siloed"} = {}): Promise<WritableFileStreamLike> {
    const stream = await super.createWritable(options);
    return {
      write: async (value) => stream.write(value),
      close: async () => {
        await stream.close();
        this.bytes = new Uint8Array(this.bytes.byteLength).fill(55);
      },
      abort: async (reason) => stream.abort?.(reason)
    };
  }
}

async function twoPdfs() {
  const first = await PDFDocument.create();
  first.addPage([612, 792]);
  const second = await PDFDocument.create();
  second.addPage([612, 792]);
  second.addPage([792, 612]);
  return {
    oldPdf: new Uint8Array(await first.save()),
    editedPdf: new Uint8Array(await second.save())
  };
}

test("Save requires separate verified backup, detects staleness, and preserves original", async () => {
  const { oldPdf, editedPdf } = await twoPdfs();
  const original = new MemoryFileHandle("plan.pdf", oldPdf);
  const backup = new MemoryFileHandle("plan.axik-before-save.pdf");
  const oldHash = await documentFingerprint(oldPdf);
  const result = await safeOverwriteOriginal({
    originalHandle: original, backupHandle: backup,
    sourceFingerprint: oldHash, originalBytes: oldPdf, editedBytes: editedPdf
  });
  assert.equal(result, await documentFingerprint(editedPdf));
  assert.deepEqual(original.bytes, editedPdf);
  assert.deepEqual(backup.bytes, oldPdf);
  assert.equal(backup.writeCount, 1);
  assert.equal(original.writeCount, 1);
});

test("Save fails before touching original if another program changed source", async () => {
  const { oldPdf, editedPdf } = await twoPdfs();
  const original = new MemoryFileHandle("plan.pdf", oldPdf);
  const backup = new MemoryFileHandle("plan-backup.pdf");
  const oldHash = await documentFingerprint(oldPdf);
  original.bytes = editedPdf.slice(); // simulate external overwrite
  await assert.rejects(safeOverwriteOriginal({
    originalHandle: original, backupHandle: backup,
    sourceFingerprint: oldHash, originalBytes: oldPdf, editedBytes: oldPdf
  }), FileChangedError);
  assert.deepEqual(original.bytes, editedPdf);
  assert.equal(backup.writeCount, 0);
});

test("Save refuses same-handle backup and does not modify source", async () => {
  const { oldPdf, editedPdf } = await twoPdfs();
  const original = new MemoryFileHandle("plan.pdf", oldPdf);
  await assert.rejects(safeOverwriteOriginal({
    originalHandle: original, backupHandle: original,
    sourceFingerprint: await documentFingerprint(oldPdf),
    originalBytes: oldPdf, editedBytes: editedPdf
  }), FileSaveSafetyError);
  assert.equal(original.writeCount, 0);
});

test("Save blocks if verified backup write is corrupt; original is preserved", async () => {
  const { oldPdf, editedPdf } = await twoPdfs();
  const original = new MemoryFileHandle("plan.pdf", oldPdf);
  const badBackup = new CorruptBackupHandle("bad-backup.pdf");
  await assert.rejects(safeOverwriteOriginal({
    originalHandle: original, backupHandle: badBackup,
    sourceFingerprint: await documentFingerprint(oldPdf),
    originalBytes: oldPdf, editedBytes: editedPdf
  }), FileSaveSafetyError);
  assert.deepEqual(original.bytes, oldPdf);
  assert.equal(original.writeCount, 0);
});

test("Save As writes a new selected target and blocks existing nonempty targets", async () => {
  const { oldPdf, editedPdf } = await twoPdfs();
  const original = new MemoryFileHandle("original.pdf", oldPdf);
  const newTarget = new MemoryFileHandle("new-edited.pdf");
  const hash = await safeSaveAs(newTarget, editedPdf, original);
  assert.equal(hash, await documentFingerprint(editedPdf));
  assert.deepEqual(newTarget.bytes, editedPdf);
  assert.deepEqual(original.bytes, oldPdf);
  await assert.rejects(safeSaveAs(original, editedPdf, original), FileSaveSafetyError);
  await assert.rejects(safeSaveAs(newTarget, oldPdf, original), FileSaveSafetyError);
});
