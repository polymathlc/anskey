# Classroom boss battle

Teachers sign in to [anskey](https://polymathlc.github.io/anskey/), open **Classroom battle** in the toolbar (or **Battle** in the name wheel), choose a class, and press **Start encounter**. The existing wheel calls a student. **Correct** uses their role ability; **Incorrect** and **Skip** finish the turn without damage. Each selected answer resolves once. Teachers choose when to press the named boss attack or charged ultimate. A new boss is selected only when the teacher starts an encounter; refresh and reopening restore the same one. Starting another active encounter asks before replacing it.

Students choose Warrior, Ranger, Mage or Healer in **CER → Your Hero → Classroom boss battle role**. Opening CER once publishes existing characters to the shared `scienceGameLeaderboard/{uid}.battleHero` snapshot. Later equipment, role and stat changes stream into anskey. The `students` register's account UID is the only avatar link. Same-name students retain distinct register IDs. Unlinked students, unavailable profiles and failed images show a labelled starter hero; saved battle stats survive a temporarily unavailable profile.

## Abilities and balancing

The current CER `rpgPlayerStats()` output already incorporates level, equipment, upgrades, sets, skill passives, pets and rebirths. Battle stats use bounded square-root scaling so a new student can contribute beside an advanced character. Changes preserve damage already taken and never refill a resting hero merely because equipment changed.

| Role | Ability | Bonuses |
| --- | --- | --- |
| Warrior | One melee strike | 1.15× damage, 1.35× HP, 1.25× defence |
| Ranger | Two quick arrows, combined damage | +15 percentage points critical chance |
| Mage | Spell projectile | 1.35× damage plus CER spell power; ignores half boss armour; 0.95× HP, 0.9× defence |
| Healer | Light attack plus team healing | 0.55× damage, 1.1× HP; healing uses CER attack, spell and leech stats |

Base damage is `16 + 2√attack`, base HP `95 + 2.5√CER maximum HP`, and base defence `3 + 1.2√defence`, before role multipliers. Critical chance uses CER's percentage units and is capped at 45%; multiplier is bounded to 1.25–2×. Healing is `(12 + 1.5√attack) × (1 + leech + spell bonus)` with each bonus capped at 50%. Rounded stats are capped again at the state boundary. The interface shows each hero's damage, defence, healing, critical chance and maximum health, with role explanations.

Correct answers can rally a resting hero at 25% health, so an individual is never excluded from answering. Healers restore resting allies too. If the whole team falls, the encounter ends and the teacher can start another. Incorrect answers do not automatically punish a student with an attack. Victory and defeat both persist.

## Twenty bosses

`battle-bosses.js` is the catalogue; `assets/classroom-bosses/` contains original full-body transparent PNG artwork and its generation manifest. Each boss has a different name, normal move, ultimate, appearance and gameplay parameter combination. Armour, HP, hit strength and charge counts vary. Special styles include two-hit attacks, team splash, partial defence bypass, regeneration, reflection, a weakening effect and guarding. All ultimates hit every standing hero. Boss targets rotate deterministically through standing heroes, and the charge meter shows when the next ultimate is due. Normal attacks are disabled at full charge until the teacher triggers the ultimate.

Boss HP scales with the starting team's damage. Correct-answer critical rolls are deterministic for each encounter/turn, so a transaction retry cannot reroll an attack. No timer triggers attacks in the background.

## Firebase and concurrent sessions

The existing authentication and `mathgen--app` Firestore instance are reused. An encounter lives at `classroomBattles/{teacherUid}/classes/{classKey}`, where `classKey` encodes every UTF-16 unit of the full class name without collisions. Class labels are the existing reward register's identifiers; renaming a class creates a separate encounter scope.

Each resolved action reads the current encounter and an immutable `actions/{actionId}` receipt in one Firestore transaction, then saves both. Answer actions also require the pending turn ID and encounter ID; boss/select/restart actions require the observed revision. Duplicate requests return current state, competing answer outcomes cannot both apply, and stale controls cannot duplicate a boss turn. The state stores health, roles, derived stats, pending selection, charge, outcome and revision. Large avatar SVGs remain in existing CER profile documents, avoiding Firestore's encounter document size limit. Listeners restore state after reload and update another open session. Offline writes fail visibly rather than claiming progress was saved.

`tools/battle-rules.mjs` narrowly extends the **current deployed shared rules**, excluding only the battle namespace from the existing catch-all. It verifies the signed-in Google teacher and matching owner UID, validates state revisions, and makes action receipts immutable. It preserves and tests unrelated permissions; it refuses ambiguous rules or a concurrent rules release. Do not deploy a standalone Firestore rules file over the shared project's rules.

## Validation

- `node --test tools/*-tests.mjs` — core abilities, all boss behaviours, deduplication/retries, class isolation, wheel identity, existing worksheet/recording behaviour and rules migration.
- `node tools/check-syntax.mjs` and `npm --prefix functions test` — application scripts and existing server behaviour.
- `PW=/path/to/playwright/index.mjs node tools/classroom-battle-browser-check.mjs` — real wheel/controller/store integration, roles, correct/incorrect/skip, boss/ultimate, defeat, delayed profile restoration, all 20 images, desktop/tablet layouts. Firebase uses synthetic fixtures.
- `node tools/wheel-check.mjs` — existing wheel regression. Set `PLAYWRIGHT_BROWSER_CHANNEL=chrome` to use installed Chrome locally.
- `node tools/battle-rules.mjs --firebase-tools /path/to/firebase-tools` — test the migration through Google's Rules API; `--apply` validates, narrowly deploys, and verifies it.
- `node tools/battle-firestore-check.cjs /path/to/firebase-tools` — optional live transaction smoke test using existing CLI administrator authentication and uniquely scoped synthetic data. It checks real concurrent transactions and restoration, then removes its own fixture. Browser permissions are tested separately by the Rules API suite.

CI runs the unit/server and real-browser suites and retains layout screenshots. This update also repairs the existing server lockfile's `uuid` override mismatch so `npm ci` succeeds.
