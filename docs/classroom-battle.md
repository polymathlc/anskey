# Pixel classroom adventure

Open **Classroom battle** from the teacher toolbar or name wheel, choose a class, then start an encounter. Pixel heroes stand four per column on the left, facing an enemy on the right. Large rosters scroll horizontally within the party formation. The original classroom wheel still calls each student once per round.

## Student ownership and lesson slots

The teacher adds student names and Lesson slots using the existing rewards roster. After Google sign-in and initial worksheet profile setup, students automatically open **My Hero**. They select a **Lesson slot**, request their own roster name, and wait for approval in the teacher's **Hero claims** panel. Pending and approved names cannot be claimed by another account. Once approved, the student chooses a **Hero class**: Warrior, Ranger, Mage or Cleric.

The account links to the existing roster character without replacing XP, equipment, learned skills or rewards. Moving that same roster document to another Lesson slot keeps the character. **Unlink account** corrects a mistaken claim without deleting character progress. The teacher can **End encounter** from Hero claims even if its old lesson has disappeared from the roster; ending releases the party but does not grant victory rewards.

My Hero shows level, XP, skill points, a connected pixel skill tree and the treasure bag. It refreshes while open, and future logins return to the saved hero. Student build changes wait until the active encounter is finished or ended; appearance changes remain available during an encounter.

## Temporary guests from another lesson

In the wheel or battle sidebar, choose **Add student from another slot**, select the student's source **Lesson slot** and name, then **Add guest**. The student joins the current wheel and battle with their saved hero. Their home lesson slot and account claim stay unchanged, and points, XP, skills, equipment and treasure continue on the same character. Guests can give or receive assists and share class mission prizes.

Guest entries survive closing or refreshing the page. Open **Lesson guests** and press **Remove** when they leave; the Guest chip's × does the same. Removing a guest preserves their progress and the enemy's current health. Finish the selected answer before changing guests. If their hero is still fighting in another lesson, finish or end that encounter first. A failed save offers a safe retry of the same change.

## Character gender

All four base classes and eight advanced jobs offer **Male** and **Female** character versions, each with four idle and four attack frames. Students choose **My Hero → Character gender**. Teachers click a hero in the battle formation and use **Character gender** in the hero journal (start the first encounter to create a saved character).

This is the character’s appearance, independent of the student’s account profile. It can change during a pending answer and preserves the hero’s class/job, XP, skill points, learned skills, inventory, equipment, HP/MP and the current turn. The saved choice carries through lesson moves and class/job upgrades, and appears in the wheel, party, class picker, skill tree and skill previews. Existing heroes default to Male until changed.

## Quick wheel fights

The ordinary **Wheel** starts with **Quick fight** enabled. Choose a Lesson slot and spin to select a student. Their avatar idles opposite the enemy; spinning does not spend MP, deal damage, grant XP, trigger an enemy reply or open treasure.

Award points with **+1 / +2 / +5 / +10 / Give** after a correct answer. The hero automatically chooses an available learned skill or normal attack, then the enemy replies if it survives. Attack damage is the rounded normal damage multiplied by awarded points, capped at remaining enemy HP: +1 = 1×, +5 = 5×. Healing, shields and poison damage scale too; each award grants one correct-answer turn and 12 XP, and enemy power stays unchanged. More than one award can be given to the same called student. Each award uses its own receipt.

Points, the award history, school-wide boss damage and hero combat progress save in one server transaction. If a connection fails, **Retry +N points** checks the same award without counting it twice, including after reopening or reloading the wheel. Confirmed rejected changes unlock the controls so the roster or encounter can be corrected. The next points award after victory or defeat starts another encounter from the saved enemy round and restores party HP/MP. Victory treasure goes to every hero.

In v1.121.0, the server-confirmed HP/MP, damage log and victory treasure appear immediately. Animation continues as visual feedback without delaying the next spin or points award. The controls wait only for the save or a request that needs retry confirmation. The **Damage log** retains the latest 40 saved turns across encounters, showing the named hero and enemy, chosen move, awarded points, damage, critical hits, HP healing, actual MP restoration, shields, poison and enemy replies. Incorrect and skipped manual answers also appear. Reloading retains this history and does not replay old attacks.

Turn off Quick fight to use the ordinary name wheel and marks buttons. Open Battle for manual answer-driven commands and the boss timing meter. An unresolved manual answer must be finished there before Quick fight continues. Closing the wheel or switching context cancels presentation; an already committed award remains saved.

## Teamwork and visible resources

The wheel shows labelled HP and MP bars for the called hero and the enemy. Enemy skills spend 30 of 60 MP; normal attacks recover 15 MP. Bars show the saved result immediately, without waiting for an animation or an animated bar transition.

After a student is called, select **Assist · reward a helper**, choose another student in the same Lesson slot, and click **Give 6 assist XP**. The helper gains 6 XP once per called question. Assist itself does not award marks, spend MP, attack, or trigger an enemy reply; completing an Assist mission can separately earn its class prize. The saved receipt prevents duplicate XP after retries or concurrent clicks. An interrupted save offers **Retry assist** and keeps the original helper/question through reopening the wheel.

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

Both male and female versions of all four base hero classes and eight advanced jobs have four generated breathing idle frames and four action frames. Idle loops appear in the quick duel, party formation, journal, My Hero, class picker and skill-tree centre. Resting party heroes remain still. Warrior action frames show a sword windup, slash and recovery; Ranger frames draw and release the bow; Mage and Cleric frames raise their staffs and cast.

After the server saves a quick or manual turn, the hero animates and a generated effect appears. Quick fight then plays the saved enemy reply; manual enemy turns remain teacher controlled. Warrior slashes strike the enemy, Ranger arrows travel across the duel, and Mage effects follow the selected skill path: Pyromancy uses fire, Frostcraft ice, and Arcanist lightning. Healing sparkles appear on heroes who actually received healing; affected teammates appear below the duel when needed. Damage numbers reflect the saved event. Health, the log and victory treasure are already visible while these effects play. A new spin or saved turn can cancel the current effect and continue immediately.

The 35 hero and spell PNG sheets in `assets/battle-pixel/animations/` contain 392 distinct frames. Version 1.120 added twelve paired appearance sheets with 192 frames: four columns and four rows for male idle, male attack, female idle and female attack. Version 1.121 adds three mission and One-Punch Chung sheets with 20 frames, bringing this folder to 38 sheets and 412 animation frames. The new mission-machine and Chung sheets each use four columns and two rows; the huge-punch effect uses two columns and two rows. All are native transparent built-in ImageGen outputs copied unchanged, with full generation/revision prompts, source filenames and integrity manifests. The five item atlases are stored separately in `assets/battle-pixel/items/`.

All 144 skills have their own deterministic effect choreography; generated effects include shields, revival, cleansing, time magic, wolves, hawks, phoenixes and healing roots. Both wheel and manual casts use these effects, and each skill has a replayable preview. Sprite sheets preload for Quick fight; missing sheets show an accessible gender badge without displaying the wrong character version. Reduced-motion preferences skip combat playback and hold a still idle frame. Closing or changing context cancels visual effects without changing the saved result. Job advancement, Assist, appearance and missions require the updated `ansKeyHeroes` service; no new rules migration is needed.

## Commands and progression

After the wheel chooses a hero, select **Attack**, **Skills** or **Items**, then choose **Correct / execute**, **Incorrect** or **Skip**. Only a correct answer executes the command and spends MP or an item. Normal attacks restore 10 MP. Resting heroes rally at 25% health when they answer correctly. Healing can revive other resting teammates.

Click any hero to open their journal. Choose Warrior, Ranger, Mage or Cleric; each has **12 skills**, arranged in three paths and four prerequisite tiers. Skill nodes explain the effect, level requirement, point cost, MP and cooldown. Gain 12 XP per correct answer and encounter XP on victory. Level gains award two skill points. Cooldowns count that hero's subsequent correct commands. Skills stay learned when switching classes, but only the current class's skills and passives apply. Equipment and XP carry across class changes.

Teacher journal build changes wait until the selected answer is resolved; students change builds between encounters. Character gender is cosmetic and can be changed while an answer is pending. Choose equipment and a companion for their slots in the character panel or treasure bag; consumables are used from the Items command and can target a teammate. Classroom heroes, skills, statistics and treasure are independent of CER. CER equipment and avatars no longer stream into this game. Stable roster document IDs keep namesakes distinct even when account ownership changes.

## Enemies and power meter

The playable roster has 100 enemies across Common, Uncommon, Rare, Epic, Legendary and Mythical rarities, from introductory creatures to powerful bosses. Every enemy appears once before the next round starts. The server saves round progress per teacher and Lesson slot, shared by quick and manual battles, and preserves it across reloads, roster changes and retries. The six existing pixel enemies remain in the pool; the earlier 20 bosses remain compatible with historical encounters. Enemy health scales with party attack.

The teacher triggers the enemy's normal attack or fully charged skill. Both start a moving power meter. Press **Stop meter** or activate the focused button with the keyboard to commit the attack. Black covers 0–55%, orange 55–85%, and red 85–100%; damage scales continuously from 0.55× to 2× as the needle approaches the right edge. Cancel, closing the battle, or switching class cancels an uncommitted meter. A meter cannot apply after another screen changes the encounter revision. No background timer attacks students.

## Treasure

Victory opens an animated four-frame pixel chest and gives **every hero**, including resting heroes, an independently rolled personal item and encounter XP. Rewards are saved in the victory transaction, so reloads, retries and duplicate clicks cannot reroll or duplicate them. Begin a new encounter to restore the party's health and MP while retaining inventory, XP and learned skills.

| Rarity | Chance | Examples |
| --- | ---: | --- |
| Common | 45% | Red Potion, Copper Sabre, Buckler of Bravery, Apprentice Grimoire |
| Uncommon | 27% | Party Tonic, Mossguard Shield, Tideglass Pendant, Windfletch Quiver |
| Rare | 16% | Phoenix Feather, Ruby Fang, Frostbite Bow, Celestial Censer |
| Epic | 8% | Starbomb, Voidsteel Katana, Thunderwing Quiver, Eclipse Grimoire |
| Legendary | 3.3% | Solar Sovereign Blade heals the team on damaging actions; Infinity Mana Lantern improves MP capacity and recovery |
| Mythical | 0.7% | Eternal Phoenix Diadem revives a fallen ally, Hourglass of Infinity echoes every third damaging action, Reality Cleaver bypasses armour/guard, Heart of the Constellation restores team HP/MP |

Rewards are selected deterministically from an encounter ID and hero ID, with independent rarity and item rolls. Different heroes can receive the same item by chance. Version 1.121 adds 50 equipment items: 10 common, 10 uncommon, 10 rare, 8 epic, 8 legendary and 4 mythical, in the original collection. Version 1.127 expands this to **238 items total**: 200 equipment items, 30 pets and eight consumables. Their bonuses use actual attack, defence, HP, MP, healing, critical, recovery and special equipment mechanics. The original 22 IDs and effects remain compatible.

The treasure screen shows a responsive grid with each student's name, item picture, rarity, XP, effects and any newly auto-equipped relic. Pictures also appear in My Hero, the teacher's character equipment panel, treasure bag and Items menu. The armory and companions add eleven native ImageGen atlases, with full generation prompts and integrity manifests in armory-provenance.json and armory-manifest.json. Ninety-four new enemies have ten additional native ImageGen atlases in assets/battle-pixel/bosses/. Five native ImageGen atlases contain ten distinct icons each in a five-column, two-row grid; the original items reuse suitable vial, feather, weapon, shield, book and relic pictures. Their catalog, full prompts, generation/edit provenance and integrity manifest are in `assets/battle-pixel/items/`.

Duplicate items stack to 999. Every hero has Helm, Torso, Gloves, Legs, Boots, Amulet, Ring 1, Ring 2, Main Hand, Off Hand and Pet slots. Each of the ten gear slots has exactly 20 items spanning all six rarities; the pet slot has 30 different companions, five per rarity. Items fit their named slot; rings may occupy either ring slot, with one owned copy required for each equipped position. All equipped bonuses apply together. Existing saved relics migrate to their matching slot without losing inventory or effects. After every treasure drop, each slot automatically selects its highest-rarity owned item; consumables are excluded and equal-rarity ties keep the current choice. Auto-equipping never restores HP or MP by itself. An encounter supports 100 heroes. Canonical roster profiles retain their progression independently of lesson snapshots and their bounded archives.

## Mission machine and One-Punch Chung

In the name wheel, the **Mission machine** is always visible beside the larger pixel-art wheel; press **Turn** directly. It remains available when Quick fight is off. The same window stacks the panels on smaller screens, and remembers subsequent moves and resizes. The manual battle retains its compact mission drawer. The server independently chooses one of four equally likely class objectives and one prize. Finish or cancel the current mission before turning again. Missions and the class prize bank belong to the Lesson slot and persist across encounters and reloads.

| Objective | How it progresses |
| --- | --- |
| Defeat the next enemy | Defeat the current active enemy, or the next encounter if none is active. |
| 7 correct answers in a row | Correct manual answers and saved wheel point awards count; an incorrect answer resets the streak. Multiple awards for the same wheel question count only once toward the streak. In Quick fight, use **Incorrect answer · reset streak** when needed. |
| Stay focused and quiet for 30 minutes | The saved server timer must elapse, then the teacher clicks **Confirm 30 focused minutes**. Focus is teacher confirmed rather than automatically observed. |
| Assist your friends 3 times | Three newly saved Assist actions complete it; duplicate helper/question receipts do not add progress. |

| Class prize | Chance |
| --- | ---: |
| Summon One-Punch Chung — rare | 5% |
| +1 minute Blooket | 15% |
| +2 minutes Blooket | 15% |
| +3 minutes Blooket | 15% |
| +1 minute Gimkit | 15% |
| +2 minutes Gimkit | 15% |
| +3 minutes Gimkit | 15% |
| +5 bonus points for all students — rare | 5% |

Minute prizes remain in the **Class prize bank** until the teacher marks them as used. The app records these rewards; the teacher provides the extra Blooket or Gimkit time. The points prize immediately gives 5 marks to every current roster student in that Lesson slot, even if they are not in the encounter. This payout has an award ledger entry for each student and is committed once with mission completion.

**Use earned summon** spends one saved class summon. **Teacher help · one punch** is always available to the teacher during an active encounter and spends no reward. Both call the generated One-Punch Chung avatar, whose **One Huge Punch** defeats any enemy regardless of armour or guard, clears a pending answer and awards the ordinary victory treasure to every hero. HP, victory and the damage log update immediately after the save; the large punch animation is visual feedback. A retry cannot spend the summon or award loot twice.

Mission rolls, completion and prize redemption use durable receipts. If a save response is lost, **Retry saved request** retains the same roll, prize or summon instead of creating a new action. A failed transaction grants no prize. Lesson changes and closure cancel presentation without undoing committed progress.

## Enemy health

From v1.123.0, every enemy has half its previous maximum HP, with odd values rounded up. Existing active fights have both current and maximum HP halved once when opened or on their next saved action. This keeps ongoing damage progress while making the remaining fight shorter. Student stats, attack damage, XP and treasure are unchanged; completed encounters are preserved.

## Saving and migration

The existing shared Firebase project remains in use. `ansKeyHeroes` verifies Google Firebase Auth and App Check, then authorizes each operation. Canonical characters and account claims live under `classroomHeroData/{teacherUid}`; encounter snapshots remain at `classroomBattles/{teacherUid}/classes/{classKey}`. Every server action updates its immutable receipt, encounter and participating canonical profiles in one transaction. Active encounter locks prevent one character fighting in two lessons simultaneously. Answers require the encounter and pending-turn ID; start, selection, boss turns and journal commands also enforce revisions. Failure is displayed instead of claiming the action saved.

The state keeps schemaVersion 1 for deployed-rule compatibility. Hero progressionVersion 1 marks the independent character model. An older saved encounter retains its enemy, pending turn and proportional hero health during migration; Healer becomes Cleric. It receives no retroactive loot for an already completed encounter. Roster synchronization can update names and membership but cannot overwrite saved stats, skills or inventory. New encounters never trust roster-supplied progression.

`battle-content.js` owns class skills and items; `battle-core.js` applies deterministic mechanics and records the latest 40 combat turns; `mission-content.js` defines objectives, prize weights and mission progress. `battle-store.js` subscribes to saved state and dispatches authenticated API requests; `functions/hero-repository.js` owns transactions, mission receipts and class payouts. `classroom-battle.js` presents the arena, `quick-battle.js` the compact duel, `mission-machine.js` the shared teacher mission panel, `battle-display.js` the item pictures, treasure grid and saved damage log, `student-heroes.js` the claim/hero screens, and `hero-skill-tree.js` the reusable graph. Original generated assets and complete built-in ImageGen prompts are in `assets/battle-pixel/`. The chest sheet has four 543×724 frames, displayed with a 3:4 aspect ratio. Skill icons are crisp-edged inline pixel SVGs with distinct effect motifs.

This release requires the updated `ansKeyHeroes` deployment. Existing installations with the authoritative hero rules need no additional rules migration; fresh installations use the narrow shared-rules upgrade in `tools/hero-rules.mjs`. All browser access to canonical profiles and direct battle writes is denied; verified teachers retain encounter reads. Existing progress migrates from one prior snapshot (highest XP, then latest update/revision) without summing duplicated inventories. Unfinished legacy encounters still hold their locks. Do not replace the shared project's rules with an app-local rules file. After changing game rules, synchronize the Functions bundle with `node tools/sync-hero-game.mjs`.

## Validation

- `node tools/check-syntax.mjs` and `node --test tools/*-tests.mjs` validate application scripts, core mechanics, deduplication/retries, loot, migration, class isolation, artwork, and existing worksheet features.
- `npm --prefix functions ci --ignore-scripts --no-audit --no-fund` and `npm --prefix functions test` validate authentication, claim races, approval, ownership, migration, encounter locks and receipt deduplication alongside the existing server.
- `PW=/path/to/playwright/index.mjs node tools/classroom-battle-browser-check.mjs` runs the real UI/core/store/wheel with synthetic Firebase transactions. It checks commands, skill trees, the meter, inventories, victory/reload, class isolation and desktop/tablet/phone layouts.
- `PW=/path/to/playwright/index.mjs node tools/wheel-check.mjs` checks the original wheel. Set `PLAYWRIGHT_BROWSER_CHANNEL=chrome` to use local Chrome. CI installs Chromium and saves screenshots.
- `tools/quick-wheel-browser-check.mjs`, `tools/student-heroes-browser-check.mjs` and `tools/hero-skill-tree-browser-check.mjs` exercise automatic fights, claim/picker/teacher flows, account races, pixel graphs and mobile layouts with synthetic service fixtures. Production credentials are never embedded in the tests.
- `tools/battle-animation-art-tests.mjs` verifies all generated sheet hashes, alpha, grid boundaries and distinct frame content. `tools/battle-animation-browser-check.mjs` verifies idle motion, each class effect, playback ordering, cancellation, duplicate callbacks, missing assets and reduced motion.
- `tools/item-catalog-tests.mjs` checks all 238 loot entries, supported bonuses, drop reachability and the preserved 50 relic pictures. `tools/armory-art-tests.mjs` and `tools/boss-catalog-tests.mjs` verify generated artwork, catalog counts, transparency and unique tiles. `tools/equipment-rotation-tests.mjs` checks loadout migration, ownership and complete no-repeat rounds. `tools/mission-animation-art-tests.mjs` checks the native mission/Chung sheets. `tools/mission-tests.mjs` and the server tests cover mission probabilities, timer/streak/Assist progress, current-roster payouts, summon authority and exact-once receipts. `tools/mission-machine-browser-check.mjs` exercises the mission panel, class bank, failed-response retries and Lesson slot lifecycle.
- `tools/mission-animation-browser-check.mjs` checks Chung and machine playback, responsive controls during effects, cancellation, reduced motion and mobile layouts.
