package com.maharanitraders.core.auth

import android.system.ErrnoException
import android.system.Os
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream

/**
 * Replaces a file's contents so that a reader only ever sees the complete old
 * bytes or the complete new bytes — never a torn mixture.
 *
 * Procedure:
 *  1. write the new bytes to a sibling temporary file (`<name>.tmp`);
 *  2. `fsync` the temporary file so its data is on storage before it is named;
 *  3. `rename(2)` the temporary file over the target.
 *
 * Step 3 is the atomic step. POSIX `rename` within one directory (same
 * filesystem) atomically replaces the destination, so a process that dies at
 * any point leaves either the old file or the new one in place. A leftover
 * `.tmp` file is harmless: it is overwritten by the next write and deleted by
 * [delete], and it is never read as session material.
 *
 * Platform choice: `java.nio.file.Files.move(ATOMIC_MOVE)` is not used because
 * it needs API 26 and this app supports API 24. `android.system.Os.rename`
 * exists since API 21 and calls `rename(2)` directly.
 *
 * Not guaranteed: the rename itself is not followed by an `fsync` of the parent
 * directory (Java cannot open a directory for syncing on Android). After a
 * power loss the directory entry may revert to the old file. That is a
 * durability limit, not a torn-write risk, and it is documented in
 * `docs/AUTH_PERSISTENCE.md`.
 *
 * [openStream] and [rename] are injectable only so that JVM tests can simulate
 * a failed write or an interrupted replacement. Production code uses the
 * defaults.
 */
internal class AtomicFileWriter(
  private val openStream: (File) -> OutputStream = { FileOutputStream(it) },
  private val rename: (from: File, to: File) -> Unit = ::osRename,
) {

  /** Replace [target] with [bytes]. Throws [IOException] if the old file is left untouched. */
  fun replace(target: File, bytes: ByteArray) {
    val temp = temporaryFor(target)
    try {
      openStream(temp).use { out ->
        out.write(bytes)
        out.flush()
        if (out is FileOutputStream) out.fd.sync()
      }
      rename(temp, target)
    } catch (failure: Throwable) {
      // Never leave a half-written temporary behind. A failure here means the
      // target was not replaced, so the previous session file is still intact.
      temp.delete()
      throw failure
    }
  }

  /** Remove the temporary file if an earlier, interrupted write left one. */
  fun delete(target: File) {
    temporaryFor(target).delete()
  }

  private fun temporaryFor(target: File): File = File(target.parentFile, target.name + SUFFIX)

  companion object {
    const val SUFFIX = ".tmp"
  }
}

/** `rename(2)` through Android's libcore; wraps errno failures as [IOException]. */
internal fun osRename(from: File, to: File) {
  try {
    Os.rename(from.path, to.path)
  } catch (failure: ErrnoException) {
    throw IOException("rename failed with errno ${failure.errno}", failure)
  }
}
