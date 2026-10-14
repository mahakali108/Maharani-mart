package com.maharanitraders.core.auth

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Real files in a temporary directory, so the crash-safety claims are checked
 * against the filesystem rather than against a mock.
 *
 * Limit: production replaces files with `android.system.Os.rename`, which needs
 * a device. These tests substitute `Files.move(ATOMIC_MOVE)`, which has the same
 * rename-within-one-directory semantics on a POSIX filesystem. The Android path
 * is covered by the device checks in `docs/AUTH_PERSISTENCE.md`.
 */
class AtomicFileWriterTest {

  @get:Rule
  val folder = TemporaryFolder()

  private val posixRename: (File, File) -> Unit = { from, to ->
    Files.move(
      from.toPath(),
      to.toPath(),
      StandardCopyOption.REPLACE_EXISTING,
      StandardCopyOption.ATOMIC_MOVE,
    )
  }

  private fun liveFile(): File = File(folder.root, "session.bin").apply { writeBytes(OLD) }

  private fun temporary(): File = File(folder.root, "session.bin.tmp")

  @Test
  fun `replaces the file with the new bytes and leaves no temporary behind`() {
    val file = liveFile()

    AtomicFileWriter(rename = posixRename).replace(file, NEW)

    assertArrayEquals(NEW, file.readBytes())
    assertFalse(temporary().exists())
  }

  @Test
  fun `a crash before the rename keeps the previous file intact`() {
    val file = liveFile()
    val writer = AtomicFileWriter(
      rename = { _, _ -> throw IOException("simulated crash before rename") },
    )

    assertThrows(IOException::class.java) { writer.replace(file, NEW) }

    // The old session is still the one on disk, and the half-finished temporary
    // has been removed so it can never be mistaken for session material.
    assertArrayEquals(OLD, file.readBytes())
    assertFalse(temporary().exists())
  }

  @Test
  fun `a write that dies partway keeps the previous file intact`() {
    val file = liveFile()
    val writer = AtomicFileWriter(
      openStream = { target -> PartialWriteStream(target, failAfterBytes = 4) },
      rename = posixRename,
    )

    assertThrows(IOException::class.java) { writer.replace(file, NEW) }

    assertArrayEquals(OLD, file.readBytes())
    assertFalse(temporary().exists())
  }

  @Test
  fun `a failed write to a file that does not exist yet creates nothing`() {
    val file = File(folder.root, "session.bin")
    val writer = AtomicFileWriter(
      openStream = { target -> PartialWriteStream(target, failAfterBytes = 0) },
      rename = posixRename,
    )

    assertThrows(IOException::class.java) { writer.replace(file, NEW) }

    assertFalse(file.exists())
    assertFalse(temporary().exists())
  }

  @Test
  fun `delete removes a temporary left behind by an interrupted write`() {
    val file = liveFile()
    temporary().writeBytes(NEW)

    AtomicFileWriter().delete(file)

    assertFalse(temporary().exists())
    assertArrayEquals(OLD, file.readBytes())
  }

  /** Accepts [failAfterBytes] bytes, then throws, like a process killed or a disk filling mid-write. */
  private class PartialWriteStream(file: File, private val failAfterBytes: Int) : OutputStream() {
    private val delegate = FileOutputStream(file)
    private var written = 0

    override fun write(b: Int) {
      write(byteArrayOf(b.toByte()), 0, 1)
    }

    override fun write(b: ByteArray, off: Int, len: Int) {
      val allowed = failAfterBytes - written
      if (len > allowed) {
        if (allowed > 0) delegate.write(b, off, allowed)
        throw IOException("simulated write failure")
      }
      delegate.write(b, off, len)
      written += len
    }

    override fun close() {
      delegate.close()
    }
  }

  private companion object {
    val OLD = "previous-session-bytes".toByteArray()
    val NEW = "rotated-session-bytes-with-new-refresh-token".toByteArray()
  }
}
