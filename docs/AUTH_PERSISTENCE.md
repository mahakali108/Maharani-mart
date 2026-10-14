# Android session persistence

Scope: `android/core/auth` (`KeystoreTokenStore`, `AtomicFileWriter`,
`SessionManager`) and its interaction with `TokenRefreshCoordinator` in
`android/core/network`. This describes what the code is written to do, what it
does not do, and what has not been verified. It makes no device-compatibility
claim: nothing here has run on an Android device or emulator.

## Verification status (read this first)

| Check | Status |
|---|---|
| `SessionManagerTest` (JVM, 47 `@Test`s: 37 existing, 10 added for the concurrency, storage and registration regressions) | Written. **Not executed**: no JDK, Gradle or Android SDK is installed in the environment where it was written. |
| `AtomicFileWriterTest` (JVM, real files) | Written. **Not executed**, same reason. See the note on `Files.move` below. |
| `TokenRefreshCoordinatorTest` (PR #89) | Unchanged. Not re-executed. |
| `KeystoreTokenStore` | Not testable on the JVM. Requires a device. |
| Android compile, `lintDebug`, `assembleDebug` | **Not run.** |
| `Os.rename` behaviour on any Android API level | **Not verified.** |

Until the JVM tests and the Android build have been run, treat every behavioural
statement below as the intended design, not as a tested fact.

## Storage

- Session tokens are encrypted with an AES-256-GCM key held in the Android
  Keystore. The key does not leave the Keystore.
- The ciphertext lives at `filesDir/maharani.session.bin`: a 12-byte IV followed
  by the GCM ciphertext and tag.
- Reads fail closed. A tampered, truncated or undecryptable file is treated as
  "no stored session".

## Atomic replacement (`AtomicFileWriter`)

Each write:

1. writes the new ciphertext to `maharani.session.bin.tmp`;
2. calls `FileOutputStream.fd.sync()` on the temporary file;
3. calls `android.system.Os.rename` to replace the live file.

Step 3 is the atomic step. `rename(2)` within one directory replaces the
destination in one operation, so a reader sees the old file or the new file.

- **The parent directory is not `fsync`ed after the rename.** Java cannot open a
  directory for syncing on Android. After a power loss the directory entry may
  revert to the previous file. This is a durability limit; it does not produce a
  torn file.
- `Os.rename` is used instead of `Files.move(ATOMIC_MOVE)`, which needs API 26 and
  this app supports API 24. `Os` is present from API 21. That is a reading of the
  API documentation, not a device result.
- **The JVM tests do not exercise production `Os.rename`.** `AtomicFileWriterTest`
  injects `Files.move(ATOMIC_MOVE)` as the rename step. It tests the writer's
  ordering, cleanup and failure handling. It does not test the production rename
  call, and it says nothing about how `Os.rename` behaves on a device.
- A leftover `.tmp` is never read as session material. It is overwritten by the
  next write and removed by `clear()` and after a failed write.

## Persistence outcome (`SessionManager.persistLocked`)

A save is `SAVED` only when the write succeeds and reading the file back decrypts
to exactly the same pair. Anything else is `FAILED`. Every caller acts on the
outcome. Failures are not swallowed.

## Session generations

`SessionManager` keeps a `generation` counter. It advances under `credentialLock`
whenever a session **begins** (a sign-in is accepted) or **ends** (sign-out,
refused token, storage clear, unverifiable account). A failed sign-in does not
advance it.

Each asynchronous step captures the generation it started under and checks it
under the lock before it does any of the following:

- publishes state;
- writes or clears the encrypted file;
- sets or clears the in-memory access token;
- changes the pending pair.

A step that finds a different generation does nothing. A late network answer
from an earlier session therefore cannot overwrite a sign-out, wipe a newer
account, or write credentials back to disk.

## Pending credentials

When the server accepts a rotation but the encrypted write fails, the new pair
is kept **in memory only** as the pending pair.

- The old stored refresh token has already been invalidated by the server, so
  the pending pair is the only valid credential the process holds.
- Access is withheld while a pair is pending. The pending access token is not
  handed to the interceptor until it is saved.
- The next `restore()` or runtime refresh saves the pending pair before anything
  reads the stored token. The stored, invalidated refresh token is never sent
  while a newer pair exists.
- Sign-out and every session end discard the pending pair. A rotation that
  returns after a session has ended is `ABANDONED` and is never written.
- A pending pair is **lost if the process dies** before it is saved. See the
  process-death section.

## Serialisation

| Lock | Guards | Held across network? |
|---|---|---|
| `sessionMutex` | `restore()`, `signIn()`, `registerRetailer()`: serialises the operations that start a session | Yes. Nothing reached through it takes it again. |
| coordinator mutex (`TokenRefreshCoordinator`, unchanged) | Single-flight runtime refresh | Yes |
| `refreshMutex` | Every refresh exchange. Credential selection and rotation persistence happen inside it. | Yes. The refresh call never replays (`replayOnTokenFailure = false`), so it cannot re-enter the coordinator. |
| `credentialLock` | Generation, pending pair, encrypted file, in-memory token, state publication | No. Local work only. |

Lock order, outermost first: `sessionMutex` → coordinator mutex → `refreshMutex`
→ `credentialLock`. No path takes them in another order. `signOut()` does not take
`sessionMutex`, so sign-out is never queued behind a slow sign-in or restore.

Store callbacks (`SessionScopedStore.onSessionEnded`) run under `credentialLock`.
They must stay local cache clears and must not call back into `SessionManager`.

## Failure policy

| Situation | Behaviour |
|---|---|
| Sign-in accepted, credentials cannot be saved | Nothing is published as authenticated. The shell stays on the sign-in screen (`SignedOut`). The returned `Unavailable` has `storageFailure = true` and the form shows it. Disk and pending pair are cleared. |
| Sign-in: wrong password, unconfirmed email, network error | Returned to the sign-in form as `Unavailable`. The shell state is not replaced. Account gates (suspended, pending approval, lapsed) still publish their own screens. |
| Restore: launch refresh rotated the token, save failed | Pending pair kept in memory. Access withheld. `Unavailable(storageFailure = true)`, retryable. |
| Restore: refresh could not reach the server | Stored tokens kept. `Unavailable(storageFailure = false)`, retryable. |
| Restore: refresh token refused | Storage cleared. `SignedOut(SESSION_EXPIRED)`. |
| Restore: verification rejected the token, and a newer pair appeared meanwhile | Newer credentials kept (not wiped). Access withheld. `Unavailable`, retryable. Retry uses the newer pair. |
| Verification rejected the token, and it is still the newest credential | Storage cleared. `SignedOut(SESSION_EXPIRED)`. |
| Runtime 401 refresh rotated the token, save failed | Pending pair kept. Access withheld. The failing request reports its error. The published state is left alone. |
| Runtime refresh refused, and the stored credentials are unchanged | Storage cleared. `SignedOut(SESSION_EXPIRED)`. |
| Runtime refresh refused, but the credentials changed or the session ended | Nothing cleared. A newer session is never touched. |
| Registration succeeds, still current | `SignedOut(PENDING_APPROVAL)`. Any returned tokens are saved, or nothing is kept if they cannot be. |
| Registration succeeds, but a sign-out happened while the request was in flight | The account is still created, so the caller gets `Registered`. Nothing is stored, the state is not changed, and no token is kept in memory. |

`storageFailure` is the only signal that separates "the device could not keep
its credentials" from "the server could not be reached". `ConnectionProblemScreen`
titles the two cases differently, so a storage fault is not presented as a
connectivity problem. No token, key, or decrypted payload appears in any log line,
exception message, or UI string written by this layer. The storage messages are
fixed text. Server-supplied messages (`AppError.message`) are shown as the server
sent them; this layer does not add credentials to them and cannot verify what the
server puts in them.

## Process-death limitation (rotation window)

If the server rotates the refresh token and the process dies before the new pair
is durably written, the new pair is lost. The server has already invalidated the
old token. On the next launch the stored refresh token is refused and the user
must sign in again. This is a fail-closed outcome: no stale credential is used.

The window is the time between receiving the rotation response and completing
the write. The client cannot close it alone. The client-side pending slot covers
failures while the process is alive, but nothing covers death. A server-side
refresh-token reuse grace period would close the window. That is backend work and
is out of scope here.

## Limitations

1. A sign-in whose save fails leaves the server session it created un-revoked
   until the server expires it. The client has no durably accepted token to revoke
   it with.
2. While a pair is pending, sign-out does not call server revocation, because no
   access token is attached to the request. The pending refresh token is discarded
   locally.
3. `sessionMutex` holds a restore or sign-in across its network calls. A slow
   server can delay the next sign-in attempt until the request times out. Sign-out
   is not affected.
4. The `Os.rename` production path, `KeystoreTokenStore`, and device behaviour of
   every write path are unverified until they run on a device.
5. A runtime refresh that is rejected by the server or fails to save can leave the user on a retry screen while a valid newer pair still exists in memory. This is conservative: the next restore uses that pair. A 401 that is still returned after the executor's own replay is reported as retry, not as an expired session, until the next restore.
6. The JVM tests cover the logic with fakes. They do not prove the Keystore,
   file-system, or process-death behaviour.

## Device checks still required

- Force-kill the process during a refresh (after the response, before the write)
  and confirm the next launch signs in again rather than crashing.
- Kill the process while a write is in progress. Confirm the app launches with no
  torn file, signed in on the previous token or signed out.
- Confirm `Os.rename` replaces an existing `maharani.session.bin` on API 24 and on
  a current API level.
- Make the Keystore key unusable (for example via a restored backup). Confirm a
  restored session fails closed to "signed out", and that a new sign-in reports
  the storage message only when the write genuinely fails.
