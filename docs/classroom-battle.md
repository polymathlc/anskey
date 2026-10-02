# Pixel classroom adventure

Open **Classroom battle** from the teacher toolbar or name wheel, choose a class, then start an encounter. Pixel heroes stand four per column on the left, facing an enemy on the right. Large rosters scroll horizontally within the party formation. The original classroom wheel still calls each student once per round.

## Student ownership and lesson slots

The teacher adds student names and Lesson slots using the existing rewards roster. After Google sign-in and initial worksheet profile setup, students automatically open **My Hero**. They select a **Lesson slot**, request their own roster name, and wait for approval in the teacher's **Hero claims** panel. Pending and approved names cannot be claimed by another account. Once approved, the student chooses a **Hero class**: Warrior, Ranger, Mage or Cleric.

The account links to the existing roster character without replacing XP, equipment, learned skills or rewards. Moving that same roster document to another Lesson slot keeps the character. **Unlink account** corrects a mistaken claim without deleting character progress. The teacher can **End encounter** from Hero claims even if its old lesson has disappeared from the roster; ending releases the party but does not grant victory rewards.

My Hero shows level, XP, skill points, a connected pixel skill tree and the treasure bag. It refreshes while open, and future logins return to the saved hero. Student build changes wait until the active encounter is finished or ended.

## Quick wheel fights

The ordinary **Wheel** starts with **Quick fight** enabled. Choose a Lesson slot and spin to select a student. Their avatar idles opposite the enemy; spinning does not spend MP, deal damage, grant XP, trigger an enemy reply or open treasure.

Award points with **+1 / +2 / +5 / +10 / Give** after a correct answer. The hero automatically chooses an available learned skill or normal attack, then the enemy replies if it survives. Attack damage is the rounded normal damage multiplied by awarded points, capped at remaining enemy HP: +1 = 1×, +5 = 5×. Healing, shields and poison damage scale too; each award grants one correct-answer turn and 12 XP, and enemy power stays unchanged. More than one award can be given to the same called student. Each award uses its own receipt.

Points, the award history, school-wide boss damage and hero combat progress save in one server transaction. If a connection fails, **Retry +N points** checks the same award without counting it twice, including after reopening or reloading the wheel. Confirmed rejected changes unlock the controls so the roster or encounter can be corrected. The next points award after victory or defeat starts another random encounter and restores party HP/MP. Victory treasure goes to every hero.

Turn off Quick fight to use the ordinary name wheel and marks buttons. Open Battle for manual answer-driven commands and the boss timing meter. An unresolved manual answer must be finished there before Quick fight continues. Closing the wheel or switching context cancels presentation; an already committed award remains saved.

## Teamwork and visible resources

The wheel shows labelled HP and MP bars for the called hero and the enemy. Enemy skills spend 30 of 60 MP; normal attacks recover 15 MP. Bars retain the pre-turn values during animation and settle to the saved result afterward.

After a student is called, select **Assist · reward a helper**, choose another student in the same Lesson slot, and click **Give 6 assist XP**. The helper gains 6 XP once per called question. Assists do not award marks, spend MP, attack, or trigger an enemy reply. Their saved receipt prevents duplicate XP after retries or concurrent clicks. An interrupted save offers **Retry assist** and keeps the original helper/question through reopening the wheel.

## Level-15 job upgrades

Each base Hero class has two advanced jobs:

| Hero class | Job choices |
|---|---|
| Warrior | Paladin · Berserker |
| Ranger | Sharpshooter · Beastmaster |
| Mage | Archmage · Chronomancer |
| Cleric | Hierophant · Oracle |

At level 15, choose a job in **My Hero** or the teacher’s hero journal between encounters. Each job has a new 12-skill tree across three branches; its tiers unlock at levels 15, 18, 22 and 26. Later skills require the previous skill in their branch and cost skill points. The first skill is available upon advancement. The **foundation** tab keeps the original class tree available; learned foundation skills still work. Job changes retain XP, equipment and previously learned skills, while skills from inactive jobs remain dormant. The eight jobs add 96 skills, bringing the catalogue to 144 skills. Select a skill to inspect its effect and replay its animation preview; passive skills show their aura.

## Generated animation

All four base hero classes and eight advanced jobs have four generated breathing idle frames and four action frames. Idle loops appear in the quick duel, party formation, journal, My Hero, class picker and skill-tree centre. Resting party heroes remain still. Warrior action frames show a sword windup, slash and recovery; Ranger frames draw and release the bow; Mage and Cleric frames raise their staffs and cast.

After the server saves a quick or manual turn, the hero animates and a generated effect appears. Quick fight then plays the saved enemy reply; manual enemy turns remain teacher controlled. Warrior slashes strike the enemy, Ranger arrows travel across the duel, and Mage effects follow the selected skill path: Pyromancy uses fire, Frostcraft ice, and Arcanist lightning. Healing sparkles appear on heroes who actually received healing; affected teammates appear below the duel when needed. Damage numbers reflect the saved event. In Quick fight, health and victory treasure settle after the sequence, which takes about two seconds with an enemy response.

The 23 transparent PNG sheets in `assets/battle-pixel/animations/` were made with built-in ImageGen and copied unchanged. Their 200 distinct frames, full generation/revision prompts, source filenames, and integrity manifest ship with the app. This release adds 13 sheets with 144 new frames: eight advanced heroes, four role effect atlases and a Beastmaster creature atlas. All 144 skills have their own deterministic effect choreography; generated effects include shields, revival, cleansing, time magic, wolves, hawks, phoenixes and healing roots. Both wheel and manual casts use these effects, and each skill has a replayable preview. Sprite sheets preload for Quick fight; missing sheets retain the original static avatar. Reduced-motion preferences skip combat playback and hold a still idle frame. Closing or changing context cancels visual effects without changing the saved result. Job advancement and Assist require the updated `ansKeyHeroes` service; no new rules migration is needed.

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

Rewards are selected deterministically from an encounter ID and hero ID, with independent rarity and item rolls. Different heroes can receive the same item by chance. The catalogue contains 22 items. Duplicate items stack to 999; each hero equips one relic at a time. After every treasure drop, the hero automatically equips the highest-rarity equipment in their bag; consumables are excluded and equal-rarity ties keep the current relic. Auto-equipping never restores HP or MP by itself. The treasure result names any newly auto-equipped item. An encounter supports 100 heroes. Canonical roster profiles retain their progression independently of lesson snapshots and their bounded archives.

## Saving and migration

The existing shared Firebase project remains in use. `ansKeyHeroes` verifies Google Firebase Auth and App Check, then authorizes each operation. Canonical characters and account claims live under `classroomHeroData/{teacherUid}`; encounter snapshots remain at `classroomBattles/{teacherUid}/classes/{classKey}`. Every server action updates its immutable receipt, encounter and participating canonical profiles in one transaction. Active encounter locks prevent one character fighting in two lessons simultaneously. Answers require the encounter and pending-turn ID; start, selection, boss turns and journal commands also enforce revisions. Failure is displayed instead of claiming the action saved.

The state keeps schemaVersion 1 for deployed-rule compatibility. Hero progressionVersion 1 marks the independent character model. An older saved encounter retains its enemy, pending turn and proportional hero health during migration; Healer becomes Cleric. It receives no retroactive loot for an already completed encounter. Roster synchronization can update names and membership but cannot overwrite saved stats, skills or inventory. New encounters never trust roster-supplied progression.

`battle-content.js` owns class skills and items; `battle-core.js` applies deterministic mechanics; `battle-store.js` subscribes to saved state and dispatches authenticated API requests; `functions/hero-repository.js` owns transactions. `classroom-battle.js` presents the arena, `quick-battle.js` the compact duel, `student-heroes.js` the claim/hero screens, and `hero-skill-tree.js` the reusable graph. Original generated assets and complete built-in ImageGen prompts are in `assets/battle-pixel/`. The chest sheet has four 543×724 frames, displayed with a 3:4 aspect ratio. Skill icons are crisp-edged inline pixel SVGs with distinct effect motifs.

This release requires the updated `ansKeyHeroes` deployment. Existing installations with the authoritative hero rules need no additional rules migration; fresh installations use the narrow shared-rules upgrade in `tools/hero-rules.mjs`. All browser access to canonical profiles and direct battle writes is denied; verified teachers retain encounter reads. Existing progress migrates from one prior snapshot (highest XP, then latest update/revision) without summing duplicated inventories. Unfinished legacy encounters still hold their locks. Do not replace the shared project's rules with an app-local rules file. After changing game rules, synchronize the Functions bundle with `node tools/sync-hero-game.mjs`.

## Validation

- `node tools/check-syntax.mjs` and `node --test tools/*-tests.mjs` validate application scripts, core mechanics, deduplication/retries, loot, migration, class isolation, artwork, and existing worksheet features.
- `npm --prefix functions ci --ignore-scripts --no-audit --no-fund` and `npm --prefix functions test` validate authentication, claim races, approval, ownership, migration, encounter locks and receipt deduplication alongside the existing server.
- `PW=/path/to/playwright/index.mjs node tools/classroom-battle-browser-check.mjs` runs the real UI/core/store/wheel with synthetic Firebase transactions. It checks commands, skill trees, the meter, inventories, victory/reload, class isolation and desktop/tablet/phone layouts.
- `PW=/path/to/playwright/index.mjs node tools/wheel-check.mjs` checks the original wheel. Set `PLAYWRIGHT_BROWSER_CHANNEL=chrome` to use local Chrome. CI installs Chromium and saves screenshots.
- `tools/quick-wheel-browser-check.mjs`, `tools/student-heroes-browser-check.mjs` and `tools/hero-skill-tree-browser-check.mjs` exercise automatic fights, claim/picker/teacher flows, account races, pixel graphs and mobile layouts with synthetic service fixtures. Production credentials are never embedded in the tests.
- `tools/battle-animation-art-tests.mjs` verifies all generated sheet hashes, alpha, grid boundaries and distinct frame content. `tools/battle-animation-browser-check.mjs` verifies idle motion, each class effect, playback ordering, cancellation, duplicate callbacks, missing assets and reduced motion.
