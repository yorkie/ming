# Browser AI harness

Ming has no application server. The Rust `ming-core` WebAssembly module owns AI
task planning and state transitions. A browser worker executes the commands it
returns: today, a DeepSeek request. The worker does not decide topic ownership
or trust model-supplied file references.

## Task protocol

1. `start_task(kind, input, model)` reads a saved review snapshot, hashes its
   canonical code diff, creates stable change-range IDs, and returns either a
   host command with serialized task state or a completed artifact.
2. The browser worker executes the command with the user's credential. It does
   not persist the credential or include it in progress events.
3. `advance_task(state, response)` validates the returned JSON against the
   change ranges, advances to the next bounded batch, or returns the artifact.
4. IndexedDB stores the completed artifact and human review status beside the
   immutable review snapshot. A rescan with different code creates a new review.

Each topic owns specific hunk IDs, or a file ID for a binary/empty-text change.
Unknown and repeated IDs are ignored. Any range still without an owner appears
in **Uncategorized changes**. The full diff stays available in **Changes**.
Markdown preview data does not affect the snapshot hash.

The current topic task sends at most twelve batches of 48,000 characters each,
with at most 12,000 characters from one change range. Remaining ranges stay
uncategorized. Rust sets a 90-second request timeout, two attempts for temporary
service errors, and a 6,000-token output cap per batch. Worker termination
cancels an active task. Reloading during generation requires a fresh run;
completed artifacts and human review status survive reloads.

## Additional review tasks and Jev

Add another task kind to the Rust dispatcher, with a versioned input, command
sequence, validator, and artifact. Browser adapters should only execute typed
commands. Jev can later implement a bounded decision command for classification
or routing; its answers must remain advisory and must never remove change
ranges from review coverage. This integration is not active yet.

Because code is sent directly from the browser to DeepSeek, generation requires
an explicit user action. The API key is currently stored in browser local
storage and is never copied into a review artifact. Provider calls need a real
browser and credential to verify; offline Rust tests and a successful build do
not establish live service behavior.
