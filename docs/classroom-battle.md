# Pixel classroom adventure

Open **Classroom battle** from the teacher toolbar or name wheel, choose a class, then start an encounter. Pixel heroes stand four per column on the left, facing an enemy on the right. Large rosters scroll horizontally within the party formation. The original classroom wheel still calls each student once per round.

## Student ownership and lesson slots

The teacher adds student names and Lesson slots using the existing rewards roster. After Google sign-in and initial worksheet profile setup, students automatically open **My Hero**. They select a **Lesson slot**, request their own roster name, and wait for approval in the teacher's **Hero claims** panel. Pending and approved names cannot be claimed by another account. Once approved, the student chooses a **Hero class**: Warrior, Ranger, Mage or Cleric.

The account links to the existing roster character without replacing XP, equipment, learned skills or rewards. Moving that same roster document to another Lesson slot keeps the character. **Unlink account** corrects a mistaken claim without deleting character progress. The teacher can **End encounter** from Hero claims even if its old lesson has disappeared from the roster; ending releases the party but does not grant victory rewards.

My Hero shows level, XP, skill points, a connected pixel skill tree and the treasure bag. It refreshes while open, and future logins return to the saved hero. Student build changes wait until the active encounter is finished or ended.

## Quick wheel fights

The ordinary **Wheel** starts with **Quick fight** enabled. Choose a Lesson slot and spin: the called student's avatar faces the enemy, uses an appropriate available learned skill (or a normal attack), then the enemy responds automatically. It uses charged enemy skills when ready. The next spin after victory or defeat starts another random encounter and restores party HP/MP. The victory chest gives every hero their own reward.

Quick turns award combat XP, but never award answer marks or record a correct answer. Manual mark buttons remain available separately. Turn off Quick fight to use the ordinary name wheel. Open Battle for answer-driven commands and the boss timing meter. An unresolved manual answer must be finished there before Quick fight continues. Closing the wheel or switching lesson cancels an action that has not yet been dispatched; an already committed action remains saved and cannot execute twice.

## Generated animation

All four hero classes have four generated breathing idle frames and four action frames. Idle loops appear in the quick duel, party formation, journal, My Hero, class picker and skill-tree centre. Resting party heroes remain still. Warrior action frames show a sword windup, slash and recovery; Ranger frames draw and release the bow; Mage and Cleric frames raise their staffs and cast.

After the server saves a quick turn, the hero animates, a generated effect appears, then the enemy responds. Warrior slashes strike the enemy, Ranger arrows travel across the duel, and Mage effects follow the selected skill path: Pyromancy uses fire, Frostcraft ice, and Arcanist lightning. Healing sparkles appear on heroes who actually received healing; affected teammates appear below the duel when needed. Damage numbers reflect the saved event. Health and victory treasure settle after the sequence, which takes about two seconds with an enemy response.

The ten unchanged transparent PNG sheets in `assets/battle-pixel/animations/` were made with built-in ImageGen. Their 56 distinct frames, full generation/revision prompts, source filenames, and integrity manifest ship with the app. Sprite sheets preload for Quick fight; missing sheets retain the original static avatar. Reduced-motion preferences skip combat playback and hold a still idle frame. Closing or changing context cancels visual effects without changing the saved result. No server or rule change is needed for this animation release.

## Commands and progression

After the wheel chooses a hero, select **Attack**, **Skills** or **Items**, then choose **Correct / execute**, **Incorrect** or **Skip**. Only a correct answer executes the command and spends MP or an item. Normal attacks restore 10 MP. Resting heroes rally at 25% health when they answer correctly. Healing can revive other resting teammates.

Click any hero to open their journal. Choose Warrior, Ranger, Mage or Cleric; each has **12 skills**, arranged in three paths and four prerequisite tiers. Skill nodes explain the effect, level requirement, point cost, MP and cooldown. Gain 12 XP per correct answer and encounter XP on victory. Level gains award two skill points. Cooldowns count that hero's subsequent correct commands. Skills stay learned when switching classes, but only the current class's skills and passives apply. Equipment and XP carry across class changes.

Teacher journal changes wait until the selected answer is resolved; students change builds between encounters. Choose one relic from the treasure bag to equip; consumables are used from the Items command and can target a teammate. Classroom heroes, skills, statistics and treasure are independent of CER. CER equipment and avatars no longer stream into this game. Stable roster document IDs keep namesakes distinct even when account ownership changes.

## Enemies and power meter

Choose a random encounter or a specific enemy. The six original pixel enemies are a goblin, slime, goblin shaman, stone golem, dragon and lich, ranging from easy introductory encounters to strong bosses. Enemy health scales with party attack. Existing encounters with the earlier 20 bosses remain playable.

The teacher triggers the enemy's normal attack or fully charged skill. Both start a moving power meter. Press **Stop meter** or activate the focused button with the keyboard to commit the attack. Black covers 0–55%, orange 55–85%, and red 85–100%; damage scales continuously from 0.55× to 2× as the needle approaches the right edge. Cancel, closing the battle, or switching class cancels an uncommitted meter. A meter cannot apply after another screen changes the encounter revision. No background timer attacks students.

## Treasure

Victory opens an animated four-frame pixel chest and gives **every hero**, including resting heroes, an independently rolled personal item and encounter XP. Rewards are saved in the victory transaction, so reloads, retries and duplicate clicks cannot reroll or duplicate them. Begin a new encounter to restore the party's health and MP while retaining inventory, XP and learned skills.

| Rarity | Chance | Examples |
| --- | ---: | --- |
| Common | 45% | Red Potion, Blue Ether, Iron Charm, Bronze Blade |
| Uncommon | 27% | Fire Flask, Party Tonic, Oak Amulet, Hunter's Band |
| Rare | 16% | Phoenix Feather, Mana Prism, Crimson Edge, Silver Aegis |
| Epic | 8% | Astral Elixir, Starbomb, Storm Quiver, Moon Codex |
| Legendary | 3.3% | Dawnbringer heals the team on damaging actions; Worldroot improves durability and MP recovery |
| Mythical | 0.7% | Phoenix Crown revives a fallen ally, Chronicle echoes every third damaging action, Void Edge bypasses armour/guard, Sovereign Star restores team HP/MP |

Rewards are selected deterministically from an encounter ID and hero ID, with independent rarity and item rolls. Different heroes can receive the same item by chance. The catalogue contains 22 items. Duplicate items stack to 999; each hero equips one relic at a time. An encounter supports 100 heroes. Canonical roster profiles retain their progression independently of lesson snapshots and their bounded archives.

## Saving and migration

The existing shared Firebase project remains in use. `ansKeyHeroes` verifies Google Firebase Auth and App Check, then authorizes each operation. Canonical characters and account claims live under `classroomHeroData/{teacherUid}`; encounter snapshots remain at `classroomBattles/{teacherUid}/classes/{classKey}`. Every server action updates its immutable receipt, encounter and participating canonical profiles in one transaction. Active encounter locks prevent one character fighting in two lessons simultaneously. Answers require the encounter and pending-turn ID; start, selection, boss turns and journal commands also enforce revisions. Failure is displayed instead of claiming the action saved.

The state keeps schemaVersion 1 for deployed-rule compatibility. Hero progressionVersion 1 marks the independent character model. An older saved encounter retains its enemy, pending turn and proportional hero health during migration; Healer becomes Cleric. It receives no retroactive loot for an already completed encounter. Roster synchronization can update names and membership but cannot overwrite saved stats, skills or inventory. New encounters never trust roster-supplied progression.

`battle-content.js` owns class skills and items; `battle-core.js` applies deterministic mechanics; `battle-store.js` subscribes to saved state and dispatches authenticated API requests; `functions/hero-repository.js` owns transactions. `classroom-battle.js` presents the arena, `quick-battle.js` the compact duel, `student-heroes.js` the claim/hero screens, and `hero-skill-tree.js` the reusable graph. Original generated assets and complete built-in ImageGen prompts are in `assets/battle-pixel/`. The chest sheet has four 543×724 frames, displayed with a 3:4 aspect ratio. Skill icons are crisp-edged inline pixel SVGs with distinct effect motifs.

This release requires `ansKeyHeroes` deployment and the narrow shared-rules upgrade in `tools/hero-rules.mjs`. All browser access to canonical profiles and direct battle writes is denied; verified teachers retain encounter reads. Existing progress migrates from one prior snapshot (highest XP, then latest update/revision) without summing duplicated inventories. Unfinished legacy encounters still hold their locks. Do not replace the shared project's rules with an app-local rules file. After changing game rules, synchronize the Functions bundle with `node tools/sync-hero-game.mjs`.

## Validation

- `node tools/check-syntax.mjs` and `node --test tools/*-tests.mjs` validate application scripts, core mechanics, deduplication/retries, loot, migration, class isolation, artwork, and existing worksheet features.
- `npm --prefix functions ci --ignore-scripts --no-audit --no-fund` and `npm --prefix functions test` validate authentication, claim races, approval, ownership, migration, encounter locks and receipt deduplication alongside the existing server.
- `PW=/path/to/playwright/index.mjs node tools/classroom-battle-browser-check.mjs` runs the real UI/core/store/wheel with synthetic Firebase transactions. It checks commands, skill trees, the meter, inventories, victory/reload, class isolation and desktop/tablet/phone layouts.
- `PW=/path/to/playwright/index.mjs node tools/wheel-check.mjs` checks the original wheel. Set `PLAYWRIGHT_BROWSER_CHANNEL=chrome` to use local Chrome. CI installs Chromium and saves screenshots.
- `tools/quick-wheel-browser-check.mjs`, `tools/student-heroes-browser-check.mjs` and `tools/hero-skill-tree-browser-check.mjs` exercise automatic fights, claim/picker/teacher flows, account races, pixel graphs and mobile layouts with synthetic service fixtures. Production credentials are never embedded in the tests.
- `tools/battle-animation-art-tests.mjs` verifies all generated sheet hashes, alpha, grid boundaries and distinct frame content. `tools/battle-animation-browser-check.mjs` verifies idle motion, each class effect, playback ordering, cancellation, duplicate callbacks, missing assets and reduced motion.
