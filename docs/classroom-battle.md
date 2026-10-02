# Pixel classroom adventure

Open **Classroom battle** from the teacher toolbar or name wheel, choose a class, then start an encounter. Pixel heroes stand four per column on the left, facing an enemy on the right. Large rosters scroll horizontally within the party formation. The original classroom wheel still calls each student once per round.

## Commands and progression

After the wheel chooses a hero, select **Attack**, **Skills** or **Items**, then choose **Correct / execute**, **Incorrect** or **Skip**. Only a correct answer executes the command and spends MP or an item. Normal attacks restore 10 MP. Resting heroes rally at 25% health when they answer correctly. Healing can revive other resting teammates.

Click any hero to open their journal. Choose Warrior, Ranger, Mage or Cleric; each has **12 skills**, arranged in three paths and four prerequisite tiers. Skill nodes explain the effect, level requirement, point cost, MP and cooldown. Gain 12 XP per correct answer and encounter XP on victory. Level gains award two skill points. Cooldowns count that hero's subsequent correct commands. Skills stay learned when switching classes, but only the current class's skills and passives apply. Equipment and XP carry across class changes.

Class changes, learning and equipment changes wait until the selected answer is resolved. Choose one relic from the treasure bag to equip; consumables are used from the Items command and can target a teammate. Classroom heroes, skills, statistics and treasure are independent of CER. CER equipment and avatars no longer stream into this game. Stable register UID/ID keeps namesakes distinct.

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

Rewards are selected deterministically from an encounter ID and hero ID, with independent rarity and item rolls. Different heroes can receive the same item by chance. The catalogue contains 22 items. Duplicate items stack to 999; each hero equips one relic at a time. Up to 100 active and 100 temporarily removed heroes retain progress in the class document. Removing older archived heroes beyond that cap retires the oldest entries.

## Saving and migration

The existing shared Firebase instance and teacher-only authorization remain in use. State lives at `classroomBattles/{teacherUid}/classes/{classKey}`. Every action reads an immutable receipt and state in one transaction. Answers require the encounter and pending-turn ID; start, selection, boss turns and journal commands also enforce revisions. Failure is displayed instead of claiming the action saved.

The state keeps schemaVersion 1 for deployed-rule compatibility. Hero progressionVersion 1 marks the independent character model. An older saved encounter retains its enemy, pending turn and proportional hero health during migration; Healer becomes Cleric. It receives no retroactive loot for an already completed encounter. Roster synchronization can update names and membership but cannot overwrite saved stats, skills or inventory. New encounters never trust roster-supplied progression.

`battle-content.js` owns class skills and items; `battle-core.js` applies deterministic mechanics; `battle-store.js` owns transactions; `classroom-battle.js` and its CSS present the arena. Original generated assets and complete built-in ImageGen prompts are in `assets/battle-pixel/`. The chest sheet has four 543×724 frames, displayed with a 3:4 aspect ratio. Skill glyphs are crisp-edged inline pixel SVGs.

No Firestore rules deployment is required: journal operations use the already allowed `sync` action type. Do not replace the shared project's rules with an app-local rules file.

## Validation

- `node tools/check-syntax.mjs` and `node --test tools/*-tests.mjs` validate application scripts, core mechanics, deduplication/retries, loot, migration, class isolation, artwork, and existing worksheet features.
- `npm --prefix functions ci --ignore-scripts --no-audit --no-fund` and `npm --prefix functions test` validate the existing server.
- `PW=/path/to/playwright/index.mjs node tools/classroom-battle-browser-check.mjs` runs the real UI/core/store/wheel with synthetic Firebase transactions. It checks commands, skill trees, the meter, inventories, victory/reload, class isolation and desktop/tablet/phone layouts.
- `PW=/path/to/playwright/index.mjs node tools/wheel-check.mjs` checks the original wheel. Set `PLAYWRIGHT_BROWSER_CHANNEL=chrome` to use local Chrome. CI installs Chromium and saves screenshots.
