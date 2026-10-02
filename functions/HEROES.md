# Classroom hero service

`ansKeyHeroes` is the authoritative classroom RPG endpoint. Every request verifies a non-revoked Google Firebase ID token, verified email, the existing Ans Key App Check app ID, and the allowed app origin. The teacher realm is resolved from the actual Firebase Auth account for `chungzhikai@gmail.com`; request bodies cannot select ownership or administrator status.

Students claim an existing `students/{id}` register document, not a display name, email guess, or CER UID. A transaction reserves both the roster profile and the account binding. Only the teacher can approve, reject, unlink or run combat. Pending claims can be cancelled by their applicant. Approved claims cannot be taken by another account. Neither claiming nor unlinking changes shared roster/CER identity fields.

Canonical data lives under `classroomHeroData/{teacherUid}/profiles/{studentId}` and `accounts/{uid}`. Browser reads and writes are denied by the shared rules migration in `tools/hero-rules.mjs`. The teacher can still subscribe to `classroomBattles/{teacherUid}/classes/{encodedSlot}`; all battle writes now pass through this service. The migration retains unrelated shared-project rules and validates the old protected/public collection boundaries before publishing with a concurrent-release check.

One canonical profile owns XP, learned skills across hero classes, inventory, equipment, and the active encounter lock. Register slot changes preserve that profile. Claiming imports one strongest existing saved battle snapshot by XP, then newest update/revision; it never sums duplicated rewards across lessons. Active legacy encounters still hold a lock even if the highest-XP snapshot is already complete. A teacher can end an encounter from Hero claims, including an old lesson slot no longer in the roster, to free the party. Wrong claims can be unlinked without erasing progress.

Battle actions and their immutable receipts commit in the same transaction as every participating hero profile. Shared roster IDs, current slot membership, canonical progression and locks are checked on the server. Clients cannot supply XP, stats, skill points or loot. The deterministic reducer calculates actions/rewards. A repeated action/award ID returns the saved state without repeating damage, consumable use, XP or treasure. Cross-slot battles involving the same hero serialize through the profile lock. Guest wheel entries remain local to their battle rather than becoming claimable register names.

## Request contract

All routes use POST JSON `{type, ...fields}` and the `Authorization: Bearer ...` and `X-Firebase-AppCheck` headers.

| Type | Fields | Result |
|---|---|---|
| `me` | None | `{status, claim?, hero?, activeEncounter?}`; hero includes `classChosen` |
| `catalog` | Optional `lessonSlot` | `{slots:[{id,name}],students:[{id,name,lessonSlots,status}]}` |
| `claim` | `studentId`, `lessonSlot` | Pending self view |
| `cancelClaim` | None | Unclaimed self view |
| `configure` | `command: class/learn/equip`; `role`/`skillId`/`itemId` | Updated owned hero; blocked during active encounter |
| `claims` | Teacher only | `{claims,activeEncounters}` including locks on unclaimed profiles |
| `approve`, `reject`, `unlink` | Teacher only, `studentId` | Updated claim status |
| `endEncounter` | Teacher only, `studentId` | `{state}` or idempotent `{status:'ended'}` |
| `battle` | Teacher only, `classId`, manual `action` (direct `auto` is rejected) | `{state}` |
| `wheelAward` | Teacher only, `classId`, `studentId`, positive whole `delta` (1–10000), optional `reason`, `action:{type:'auto',id,spinId,heroId,heroes,bossId,encounterId?,expectedRevision?}` | `{state,award:{id,studentId,delta,marks},duplicate?}` |

`configure` may include `studentId` only for the teacher or the student's own approved binding. Optional `expectedRevision` checks the canonical profile version. Class changes preserve skills learned in other classes and current inventory; they do not grant new XP or skill points.

Quick wheel spins only select a student. `wheelAward` derives combat power from `delta` and commits marks, the standard `awards` history (Firestore timestamp), active school-wide boss point damage, battle state, all canonical profiles and the receipt atomically. Its unique award ID is separate from the saved spin ID. Reusing a receipt with different student/points/spin/reason is rejected; an identical retry returns the latest battle and current marks without repeating the award. A failed or stale transaction writes nothing. The client keeps uncertain requests in session storage and offers Retry. Deploy the updated endpoint before the v1.118 frontend; no additional shared-rules migration is required for this change.

## Build and deployment

Run `node tools/sync-hero-game.mjs` after editing browser battle rules. The checked-in `functions/hero-game` copy is needed because Firebase uploads only the functions source directory. Tests verify byte parity. Run `npm --prefix functions test`, `node --test tools/hero-api-tests.mjs tools/hero-rules-tests.mjs`, and the existing battle checks before deployment.

Deploy `ansKeyHeroes` and apply `tools/hero-rules.mjs` against the current shared rules before publishing the frontend release. The Firebase service account must retain normal Admin Firestore and Firebase Auth user lookup access. No new secrets are needed. Do not deploy an app-local replacement Firestore rules file. Old browser battle writers are intentionally rejected after the authoritative rules upgrade; users refresh Ans Key to use the new server route.
