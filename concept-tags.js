/* =====================================================================
   🎯 CONCEPT TAGS — what went wrong, named from ONE fixed list
   (concept-tags.js v1.0.0)

   THIS FILE IS BYTE FOR BYTE THE SAME in Study Buddy (polymathlc/tutor)
   and Ans Key (polymathlc/anskey). Study Buddy WRITES the tags — they come
   back inside the marking call that already runs, and nowhere else — and
   Ans Key READS them back as the per-student gap view. A tag id that means
   one thing in one app and another thing in the other is a gap view that
   tells the teacher the wrong lesson, so copy every change across and let
   each repo's test compare the two copies when both are checked out side
   by side.

   WHY A FIXED LIST. A mistake named freely is named five ways over five
   papers ("careless", "calculation error", "arithmetic slip", "computed
   wrongly", "silly mistake") and never adds up to anything. Handed one
   list per subject, with a handful of extra tags for the topics where a
   very particular slip lives (unlike denominators in fractions, heat
   against temperature in Heat), the same slip lands on the same id every
   time, and "sign error, 7 times in 5 papers, getting better" becomes a
   sentence the app can say.

   WHAT IS STORED. Each worksheet the student has marked is ONE entry on
   their roster row (`studentProfiles/{uid}.tutorGaps.{worksheetId}`): the
   worksheet's name, subject, level, when it was marked, how many questions
   were attempted, and one row per tagged mistake (the tag, the question
   number, the one-line reason, the verdict and the mistake-book id). A
   re-mark of the same worksheet REPLACES its entry, so marking twice never
   counts a mistake twice. The trend is worked out here, in plain code,
   from those entries — never by a second model call.

   EVERYTHING HERE IS PURE: no DOM, no network, no Firebase. The harness
   loads it in Node (module.exports) and the apps load it with a <script>
   tag (window.ConceptTags).
   ===================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.ConceptTags = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ---- THE CATALOGUE ----
     `label` is what the student and the teacher read. `use` is what the
     MODEL reads — when this tag is the right one — and it is written to
     tell two neighbouring tags apart, because that is where a model
     hesitates. `fix` is the nudge Study Buddy gives a student working on
     this gap: one sentence, an action, never the answer to anything.
     An id is FOR EVER: renaming one orphans every row already filed under
     it. Add a new id instead, and leave the old one in the catalogue. */
  var DEFS = {
    /* Every subject */
    'misread-question': {
      label: 'Misread the question',
      use: 'they answered a different question from the one printed: missed a word such as NOT, EACH, MORE THAN, ' +
           'or LEAST, or used the wrong number from the question',
      fix: 'Before you start, underline what the question is asking for and circle the numbers or words you will need.'
    },
    'incomplete-answer': {
      label: 'Answer left incomplete',
      use: 'what they wrote is right as far as it goes but one required part is missing: the second part of a ' +
           'two-part question, a reason, a comparison, or the last step',
      fix: 'When you finish, read the question again and tick off every part it asks for.'
    },
    'careless-copy': {
      label: 'Copied something wrongly',
      use: 'they copied a number, word or option wrongly from the question or from their own working (wrote 36 ' +
           'for 63, picked option 3 after working out option 2)',
      fix: 'Check each number you copy against the question, and check your final answer against your working.'
    },
    'no-working': {
      label: 'Working not shown',
      use: 'the final answer is given (right or wrong) but the working or explanation the question requires is ' +
           'missing, so the method marks cannot be given',
      fix: 'Write each step on its own line, so a marker can follow how you got there.'
    },
    'concept-gap': {
      label: 'Idea not understood yet',
      use: 'the mistake comes from not understanding the idea the question tests, and no more particular tag ' +
           'on this list fits it',
      fix: 'Go back to the idea behind this question with your teacher before you practise it again.'
    },

    /* Mathematics */
    'calc-slip': {
      label: 'Calculation slip',
      use: 'the method is right but an addition, subtraction, multiplication or division along the way is wrong',
      fix: 'Check each calculation by working it backwards, for example check a subtraction by adding.'
    },
    'wrong-operation': {
      label: 'Wrong operation',
      use: 'they chose the wrong operation for the situation: added when they should have multiplied, divided ' +
           'the wrong way round, or multiplied when the question shares something out',
      fix: 'Say the story in your own words first, then decide: is it joining, taking away, groups of, or sharing?'
    },
    'sign-error': {
      label: 'Sign or direction error',
      use: 'they mixed up plus and minus, took away the wrong way round, or went the wrong direction on "more ' +
           'than / less than", "increase / decrease", "gain / loss" or "before / after"',
      fix: 'Ask yourself: should the answer be bigger or smaller than what I started with? Then check your sign.'
    },
    'forgot-units': {
      label: 'Forgot or wrong units',
      use: 'the number is right but the unit is missing or wrong (cm for cm², ml for ℓ, no $ sign, no unit at all)',
      fix: 'Finish every answer by writing the unit the question asks for, and check it is the right kind of unit.'
    },
    'unit-conversion': {
      label: 'Unit conversion',
      use: 'they converted between units wrongly or not at all: cm and m, g and kg, ml and ℓ, minutes and hours, ' +
           'cents and dollars',
      fix: 'Before you calculate, change every measurement into the SAME unit, and write the conversion down.'
    },
    'place-value': {
      label: 'Place value or decimal point',
      use: 'the digits are right but in the wrong place: the decimal point moved, a zero lost or added, tens and ' +
           'ones mixed up',
      fix: 'Line the digits up by place value (or by the decimal point) before you add, subtract or compare.'
    },
    'stopped-early': {
      label: 'Stopped one step early',
      use: 'they worked out a correct middle value (one part, one group, the difference) but the question asked ' +
           'for something one or two steps further (the total, the other part, the new amount)',
      fix: 'When you get a number, ask: is THIS what the question asked for, or do I need one more step?'
    },
    'model-setup': {
      label: 'Model or unitary set-up',
      use: 'the bar model, the units or the unitary method is set up wrongly: wrong number of units, units for ' +
           'the wrong quantity, the before-and-after model mixed up',
      fix: 'Draw the model first, label every bar with what it stands for, and check it matches every sentence.'
    },
    'wrong-formula': {
      label: 'Wrong formula',
      use: 'they used the wrong formula or rule for the shape or the situation, for example perimeter for area, ' +
           'radius for diameter, or the wrong average formula',
      fix: 'Write the formula in words before you put numbers in, and check it is the one for THIS shape.'
    },
    'rounding': {
      label: 'Rounding or estimating',
      use: 'they rounded to the wrong place, rounded too early, or rounded the wrong way',
      fix: 'Keep the exact value until the end, and only round once, to the place the question asks for.'
    },
    'read-graph': {
      label: 'Misread a graph, table or diagram',
      use: 'they read a value, a scale, a label or a key wrongly from a graph, table, chart or diagram',
      fix: 'Read the title, the labels and the scale first, then trace across with your finger to read the value.'
    },
    /* Mathematics — topic extras (offered only on those topics' questions) */
    'unlike-denominators': {
      label: 'Unlike denominators',
      use: 'FRACTIONS: they added or subtracted fractions without first making the denominators the same, or ' +
           'added the denominators together',
      fix: 'Make the denominators the same first, then add or subtract only the numerators.'
    },
    'fraction-of-what': {
      label: 'Fraction of the wrong whole',
      use: 'FRACTIONS: they took the fraction of the wrong quantity, for example of the whole when the question ' +
           'says "of the remainder" or "of the rest"',
      fix: 'Ask: a fraction OF WHAT? Mark that whole on your model before you work out the part.'
    },
    'ratio-order': {
      label: 'Ratio the wrong way round',
      use: 'RATIO: they wrote or used the ratio in the wrong order, or matched the parts to the wrong people',
      fix: 'Write the names above the ratio numbers, in the order the question gives them.'
    },
    'unchanged-quantity': {
      label: 'Did not keep the unchanged part',
      use: 'RATIO / BEFORE-AND-AFTER: they did not hold constant the quantity that stays the same (the total, ' +
           'or one person\'s share) when the ratio changes',
      fix: 'Find what does NOT change, and make its units the same in the before and the after.'
    },
    'percent-base': {
      label: 'Percentage of the wrong amount',
      use: 'PERCENTAGE: they found the percentage of the wrong base amount (the new price instead of the ' +
           'original, the part instead of the whole)',
      fix: 'Ask: this percentage is OF WHAT? Make that amount your 100%.'
    },
    'angle-property': {
      label: 'Angle fact',
      use: 'ANGLES / GEOMETRY: they used a wrong angle fact (angles on a straight line, at a point, in a ' +
           'triangle, vertically opposite, in a special quadrilateral)',
      fix: 'Name the angle fact you are using next to every step, for example "angles on a straight line = 180°".'
    },
    'area-perimeter': {
      label: 'Area mixed up with perimeter',
      use: 'AREA / PERIMETER / VOLUME: they found the area when the perimeter was asked for, or the other way ' +
           'round, or used square units for a length',
      fix: 'Perimeter goes AROUND the edge (cm); area covers the INSIDE (cm²). Decide which one is asked first.'
    },
    'time-interval': {
      label: 'Time across the hour',
      use: 'TIME: they worked out a time interval or end time wrongly across an hour, noon or midnight, or ' +
           'treated minutes as hundredths',
      fix: 'Count on to the next full hour first, then count the rest — remember 1 hour is 60 minutes, not 100.'
    },
    'speed-relation': {
      label: 'Speed, distance and time',
      use: 'SPEED: they mixed up how speed, distance and time are related, or used inconsistent units',
      fix: 'Write distance = speed × time, put the units beside each number, and make the units match.'
    },

    /* Science */
    'missing-keyword': {
      label: 'Missing the science word',
      use: 'the idea is roughly right but the scientific term the answer needs is missing or wrong ' +
           '(evaporation, conductor, photosynthesis, gains heat)',
      fix: 'Name the process with its science word, then explain it.'
    },
    'cause-effect': {
      label: 'Cause without effect (or the other way)',
      use: 'they gave only what happened and not why, or only the reason and not what it causes; the answer ' +
           'is missing one half of the cause-and-effect chain',
      fix: 'Answer in two parts: what happens, BECAUSE why it happens.'
    },
    'vague-answer': {
      label: 'Too vague',
      use: 'the answer is too general to earn the mark ("it is better", "it changes") and does not say what, ' +
           'how much, or compared with what',
      fix: 'Say exactly WHAT changes and HOW — more or less, faster or slower, compared with what.'
    },
    'not-linked': {
      label: 'Not linked to the experiment',
      use: 'they gave a textbook fact but did not apply it to the set-up, the object or the data in THIS question',
      fix: 'Use the names from the question (the beaker, set-up A, the plant) in your answer.'
    },
    'fair-test': {
      label: 'Fair test or variables',
      use: 'they mixed up the variable that is changed, measured and kept the same, or could not say why a ' +
           'set-up is (or is not) a fair test',
      fix: 'List what is CHANGED, what is MEASURED and what is KEPT THE SAME before you answer.'
    },
    'misconception': {
      label: 'Wrong science idea',
      use: 'the answer rests on a common wrong idea about how the world works (heavier objects fall faster, ' +
           'plants get food from the soil) and no topic tag below fits it more closely',
      fix: 'Check this idea against your notes — your answer is built on something that is not true.'
    },
    /* Science — topic extras */
    'heat-vs-temperature': {
      label: 'Heat mixed up with temperature',
      use: 'HEAT: they confused heat (energy that flows) with temperature (how hot), or said "cold flows"',
      fix: 'Heat FLOWS from the hotter thing to the colder thing; temperature is how hot something is.'
    },
    'conductor-insulator': {
      label: 'Conductor or insulator',
      use: 'HEAT / ELECTRICITY: they mixed up good and poor conductors of heat or electricity, or how that ' +
           'property explains the result',
      fix: 'Say which material is the better conductor, then what that does to the heat (or current) flow.'
    },
    'circuit-path': {
      label: 'Circuit path',
      use: 'ELECTRICITY: they misjudged whether the circuit is closed, which bulbs light, or how a switch, ' +
           'series or parallel arrangement changes it',
      fix: 'Trace the path from one end of the battery to the other with your finger — is there a full loop?'
    },
    'light-path': {
      label: 'Path of light',
      use: 'LIGHT / SHADOWS: they mixed up how light travels, reflects or is blocked, or how a shadow forms or ' +
           'changes size',
      fix: 'Draw the ray of light as a straight line from the source and see where it is blocked or reflected.'
    },
    'photosynthesis-io': {
      label: 'What plants need and make',
      use: 'PLANTS / PHOTOSYNTHESIS: they mixed up what a plant takes in and gives out, or which part does it',
      fix: 'Plants take in carbon dioxide and water, use light, and make food (sugar) and oxygen.'
    },
    'part-function': {
      label: 'Part and its job',
      use: 'SYSTEMS / CELLS / PLANT PARTS: they named the right part with the wrong job, or the right job ' +
           'with the wrong part',
      fix: 'Learn each part as a pair: the PART, and the JOB it does.'
    },
    'state-change': {
      label: 'Change of state',
      use: 'MATTER / WATER CYCLE: they mixed up melting, freezing, evaporation, boiling and condensation, or ' +
           'whether heat is gained or lost',
      fix: 'For each change of state, say whether heat is GAINED or LOST, and name the change.'
    },
    'force-direction': {
      label: 'Force and its direction',
      use: 'FORCES / MAGNETS: they gave the wrong force, its direction, or its effect (friction against ' +
           'motion, gravity downwards, like poles repel)',
      fix: 'Draw an arrow for each force on the object and label it with its name.'
    },
    'cycle-order': {
      label: 'Life cycle order',
      use: 'LIFE CYCLES / REPRODUCTION: they put stages in the wrong order or mixed up stages between organisms',
      fix: 'Write the stages in order with an arrow between each, then check the number of stages.'
    },
    'food-chain-direction': {
      label: 'Food chain direction',
      use: 'ENVIRONMENT / FOOD CHAINS: the arrows point the wrong way, or they mixed up producers, consumers, ' +
           'predators and prey, or what happens when one population changes',
      fix: 'The arrow points to the one that EATS — it shows where the food (energy) goes.'
    },

    /* English */
    'tense': {
      label: 'Tense',
      use: 'the verb is in the wrong tense, or the tense changes where it should not',
      fix: 'Find the time word in the sentence (yesterday, now, every day) and match the verb to it.'
    },
    'subject-verb': {
      label: 'Subject–verb agreement',
      use: 'the verb does not agree with its subject (singular against plural, "each of them are")',
      fix: 'Find the real subject — the WHO or WHAT — and check if it is one or many.'
    },
    'spelling': {
      label: 'Spelling',
      use: 'the word chosen is right but spelt wrongly',
      fix: 'Say the word slowly in parts, then check the tricky part against the passage or a dictionary.'
    },
    'word-choice': {
      label: 'Word choice',
      use: 'they chose a word with the wrong meaning or wrong part of speech for the blank (vocabulary, cloze, ' +
           'prepositions, connectors)',
      fix: 'Read the whole sentence with your word in it — does it make sense AND sound right?'
    },
    'punctuation': {
      label: 'Punctuation',
      use: 'the punctuation is wrong or missing (capital letters, full stops, commas, apostrophes, speech marks)',
      fix: 'Read your sentence aloud and check each place you paused or changed speaker.'
    },
    'own-words': {
      label: 'Not in own words',
      use: 'COMPREHENSION: they copied a chunk of the passage when the question asked for their own words, ' +
           'or did not answer in a full sentence',
      fix: 'Find the answer in the passage, then say it again in your own words, as a full sentence.'
    },
    'missing-evidence': {
      label: 'No evidence from the passage',
      use: 'COMPREHENSION: the question asks for evidence, a quote or a reason from the passage and none is given',
      fix: 'Quote the exact words from the passage that prove your answer.'
    },
    'synthesis-structure': {
      label: 'Sentence structure',
      use: 'SYNTHESIS / TRANSFORMATION: the combined or rewritten sentence uses the given word wrongly, changes ' +
           'the meaning, or breaks the grammar',
      fix: 'Start with the given word, keep the meaning the same, and check the whole sentence reads correctly.'
    },

    /* Chinese */
    'wrong-character': {
      label: '错别字 Wrong character',
      use: 'CHINESE: a character is written wrongly or a similar-looking or similar-sounding character is used',
      fix: '写完后，把容易写错的字圈出来，再检查一次部首和笔画。'
    },
    'collocation': {
      label: '搭配 Word pairing',
      use: 'CHINESE: the word is used with the wrong partner word (a verb, measure word or adjective that does ' +
           'not go with it)',
      fix: '把整个词组读一遍，想一想这两个词平时会不会放在一起用。'
    },
    'pinyin-tone': {
      label: '拼音 Pinyin or tone',
      use: 'CHINESE: the pinyin spelling or the tone mark is wrong',
      fix: '慢慢读出这个字，先确定声母和韵母，再标声调。'
    },
    'word-order': {
      label: '语序 Word order',
      use: 'CHINESE: the words are right but in the wrong order for a Chinese sentence',
      fix: '先找出“谁 + 什么时候 + 在哪里 + 做什么”，再排句子。'
    },
    'reading-detail': {
      label: '阅读 Missed a detail',
      use: 'CHINESE COMPREHENSION: the answer misses or misreads the detail in the passage that the question ' +
           'points to',
      fix: '回到文章里找到相关的句子，把关键词划下来再作答。'
    },
    'not-in-chinese': {
      label: 'Answered in English',
      use: 'CHINESE: they answered in English or in pinyin where characters were needed',
      fix: '用华文作答；不会写的字，先写拼音，再请老师帮忙。'
    }
  };

  /* WHICH TAGS EACH SUBJECT IS OFFERED. Common ones last, so the model reads
     the particular before the general — and `concept-gap` is always the
     very last line, the tag of last resort. */
  var COMMON_IDS = ['misread-question', 'incomplete-answer', 'careless-copy', 'no-working', 'concept-gap'];
  var SUBJECT_IDS = {
    math: ['calc-slip', 'wrong-operation', 'sign-error', 'forgot-units', 'unit-conversion', 'place-value',
           'stopped-early', 'model-setup', 'wrong-formula', 'rounding', 'read-graph'],
    science: ['missing-keyword', 'cause-effect', 'vague-answer', 'not-linked', 'fair-test', 'read-graph',
              'forgot-units', 'misconception'],
    english: ['tense', 'subject-verb', 'spelling', 'word-choice', 'punctuation', 'own-words', 'missing-evidence',
              'synthesis-structure'],
    chinese: ['wrong-character', 'collocation', 'pinyin-tone', 'word-order', 'reading-detail', 'not-in-chinese']
  };
  /* THE TOPIC EXTRAS. `re` is matched against the question's TOPIC as the
     marking named it (and its syllabus heading), and an extra is offered
     only when it matches — so "Unlike denominators" never turns up on a
     question about angles. The prompt still lists every extra for the
     subject, labelled with its topic, because a page holds questions on
     several topics and the topic is decided in the same reply. */
  var TOPIC_IDS = [
    { subject: 'math', topic: 'Fractions', re: /fraction/i, ids: ['unlike-denominators', 'fraction-of-what'] },
    { subject: 'math', topic: 'Ratio', re: /ratio|proportion/i, ids: ['ratio-order', 'unchanged-quantity'] },
    { subject: 'math', topic: 'Percentage', re: /percent|discount|gst|interest/i, ids: ['percent-base'] },
    { subject: 'math', topic: 'Angles and geometry', re: /angle|triangle|quadrilateral|parallelogram|rhombus|trapezium|geometr|circle/i,
      ids: ['angle-property'] },
    { subject: 'math', topic: 'Area, perimeter and volume', re: /area|perimeter|volume|cuboid|cube/i, ids: ['area-perimeter'] },
    { subject: 'math', topic: 'Time', re: /\btime\b|clock|24-hour|duration/i, ids: ['time-interval'] },
    { subject: 'math', topic: 'Speed', re: /speed|distance/i, ids: ['speed-relation'] },
    { subject: 'science', topic: 'Heat', re: /heat|temperature|thermal/i, ids: ['heat-vs-temperature', 'conductor-insulator'] },
    { subject: 'science', topic: 'Electricity', re: /electric|circuit|conductor|battery|bulb/i, ids: ['circuit-path', 'conductor-insulator'] },
    { subject: 'science', topic: 'Light', re: /light|shadow|reflect/i, ids: ['light-path'] },
    { subject: 'science', topic: 'Plants', re: /photosynth|plant|leaf|leaves|transport/i, ids: ['photosynthesis-io', 'part-function'] },
    { subject: 'science', topic: 'Systems and cells', re: /system|cell|organ|digest|respirat|circulat|skeletal|muscular/i,
      ids: ['part-function'] },
    { subject: 'science', topic: 'Matter and water', re: /matter|state|water cycle|evaporat|condens|melt|boil|freez/i,
      ids: ['state-change'] },
    { subject: 'science', topic: 'Forces and magnets', re: /force|magnet|friction|gravity|spring/i, ids: ['force-direction'] },
    { subject: 'science', topic: 'Life cycles', re: /life cycle|cycles|reproduc|pollinat|germinat|seed dispersal/i,
      ids: ['cycle-order'] },
    { subject: 'science', topic: 'Environment', re: /food chain|food web|environment|adapt|habitat|interaction|community|population/i,
      ids: ['food-chain-direction'] }
  ];

  var WHY_MAX = 140;
  var SHEET_TAGS_MAX = 40;
  var SHEETS_MAX = 80;

  function str(v, cap) {
    var s = String(v == null ? '' : v).replace(/\s*\n\s*/g, ' ').trim();
    return cap && s.length > cap ? s.slice(0, cap).replace(/\s+\S*$/, '') + '…' : s;
  }
  function uniq(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  /* The subjects the apps write, read one way: Study Buddy says `math`,
     Ans Key's old pairing says `both` (which picks nothing here, so the
     whole catalogue is offered), and a typed "Maths" is still maths. */
  function subjectKey(s) {
    var k = String(s == null ? '' : s).toLowerCase().trim();
    if (/^math/.test(k)) return 'math';
    if (/^sci/.test(k)) return 'science';
    if (/^eng/.test(k)) return 'english';
    if (/^(chi|mandarin|华文|中文)/.test(k)) return 'chinese';
    return '';
  }

  function topicExtras(subject, topic) {
    var sub = subjectKey(subject), t = String(topic == null ? '' : topic);
    var out = [];
    TOPIC_IDS.forEach(function (row) {
      if (sub && row.subject !== sub) return;
      if (t && row.re.test(t)) out = out.concat(row.ids);
    });
    return uniq(out);
  }

  /* THE TAGS ONE QUESTION MAY TAKE: its topic's extras, then its subject's,
     then the common ones. A subject this file has never heard of (an
     unlevelled worksheet, `both`) is offered every subject's list, because
     the marking works the subject out from the page in that case and the
     tag has to be able to follow it. */
  function idsFor(subject, topic) {
    var sub = subjectKey(subject);
    var base = sub ? SUBJECT_IDS[sub] : Object.keys(SUBJECT_IDS).reduce(function (a, k) {
      return a.concat(SUBJECT_IDS[k]);
    }, []);
    return uniq(topicExtras(sub, topic).concat(base, COMMON_IDS));
  }
  /* EVERY tag a subject can carry, its topic extras included — what a
     reply is checked against. A question the model filed under "Heat" may
     reasonably carry `conductor-insulator` even when the topic it named
     was "Energy", so the extras of the WHOLE subject are allowed back in. */
  function allIdsFor(subject) {
    var sub = subjectKey(subject);
    var extras = [];
    TOPIC_IDS.forEach(function (row) { if (!sub || row.subject === sub) extras = extras.concat(row.ids); });
    return uniq(idsFor(sub, '').concat(extras));
  }
  function isTag(id) { return Object.prototype.hasOwnProperty.call(DEFS, String(id || '')); }
  function label(id) { return isTag(id) ? DEFS[id].label : ''; }
  function fix(id) { return isTag(id) ? DEFS[id].fix : ''; }
  function use(id) { return isTag(id) ? DEFS[id].use : ''; }

  /* A reply's tag, read back. The model was handed ids, and an id is what
     is kept — but a reply that answered with the LABEL ("Sign or direction
     error") or a spacing of the id ("sign error") is the same choice and is
     read as it. Anything else is not on the list, and a mistake off the list
     is filed under the tag of last resort with the model's reason kept: a
     wrong or partly right answer with NO tag is a hole in the gap view, and
     one with a made-up tag is a row nothing else will ever add up with.
     A correct answer and a blank carry no tag at all, whatever came back. */
  function readTag(subject, raw) {
    var s = String(raw == null ? '' : raw).toLowerCase().trim();
    if (!s) return '';
    var allowed = allIdsFor(subject);
    if (allowed.indexOf(s) >= 0) return s;
    var dashed = s.replace(/[\s_]+/g, '-').replace(/[^a-z0-9\-]/g, '');
    if (allowed.indexOf(dashed) >= 0) return dashed;
    for (var i = 0; i < allowed.length; i++) {
      if (DEFS[allowed[i]].label.toLowerCase() === s) return allowed[i];
    }
    return '';
  }
  function clean(subject, verdict, rawTag, rawWhy) {
    var v = String(verdict == null ? '' : verdict).toLowerCase().trim();
    if (v !== 'wrong' && v !== 'partial') return { tag: '', why: '' };
    var t = readTag(subject, rawTag);
    return { tag: t || 'concept-gap', why: str(rawWhy, WHY_MAX) };
  }

  /* THE BLOCK THE MARKING PROMPT CARRIES. It goes in the SYSTEM prompt of
     the one marking call that already runs, so a tag costs a few dozen
     output tokens on the reply and NO call of its own. */
  function promptBlock(subject) {
    var sub = subjectKey(subject);
    var base = uniq((sub ? SUBJECT_IDS[sub] : Object.keys(SUBJECT_IDS).reduce(function (a, k) {
      return a.concat(SUBJECT_IDS[k]);
    }, [])).concat(COMMON_IDS));
    var lines = base.map(function (id) { return '• ' + id + ' — ' + DEFS[id].label + ': ' + DEFS[id].use; });
    /* An extra that two topics share (conductor-insulator is Heat AND
       Electricity) is listed ONCE, naming both, so the model reads one id. */
    var extraIds = [], topicsOf = {};
    TOPIC_IDS.forEach(function (row) {
      if (sub && row.subject !== sub) return;
      row.ids.forEach(function (id) {
        if (base.indexOf(id) >= 0) return;
        if (!topicsOf[id]) { topicsOf[id] = []; extraIds.push(id); }
        if (topicsOf[id].indexOf(row.topic) < 0) topicsOf[id].push(row.topic);
      });
    });
    var extras = extraIds.map(function (id) {
      return '• ' + id + ' — ' + DEFS[id].label + ' (only on ' + topicsOf[id].join(' or ') + ' questions): ' +
        DEFS[id].use;
    });
    return '\nCONCEPT TAGS — WHAT WENT WRONG, FROM ONE FIXED LIST. For every question you mark "wrong" or ' +
      '"partial", "tag" is the ONE id below that best names the gap behind THIS student\'s mistake, and "tagWhy" ' +
      'is ONE short line (at most 20 words) saying exactly what went wrong in what they wrote — "took 3/4 of the ' +
      'whole instead of the remainder", not "careless". Pick the MOST PARTICULAR id that fits: a topic tag before ' +
      'a subject tag, a subject tag before a common one, and "concept-gap" only when nothing more particular ' +
      'fits. Copy the id exactly; never invent one. For a question marked "correct", and for a blank, "tag" and ' +
      '"tagWhy" are empty strings. These are counted across every paper the student does, so the same slip must ' +
      'get the same id every time.\n' +
      lines.join('\n') + (extras.length ? '\n' + extras.join('\n') : '') + '\n';
  }

  /* ---- ONE WORKSHEET'S ENTRY ----
     Built from the marked questions in paper order. `mids` maps a question
     to its mistake-book id (the link the gap view follows), and is optional:
     a mistake that has not been filed yet simply has no link. */
  function sheetEntry(o) {
    o = o || {};
    var items = Array.isArray(o.items) ? o.items : [];
    var n = 0, wrong = 0, tags = [];
    items.forEach(function (it) {
      if (!it || !it.marked) return;
      n++;
      if (it.verdict !== 'wrong' && it.verdict !== 'partial') return;
      wrong++;
      if (!it.tag || !isTag(it.tag) || tags.length >= SHEET_TAGS_MAX) return;
      var mid = typeof o.mids === 'function' ? str(o.mids(it), 40) : '';
      tags.push({
        t: it.tag,
        q: str(it.number, 16),
        why: str(it.tagWhy, WHY_MAX),
        v: it.verdict,
        top: str(it.sylTopic || it.topic, 70),
        p: Number(it.page) || 0,
        mid: mid
      });
    });
    return {
      ws: str(o.ws, 80),
      sub: str(o.subject, 16),
      lvl: str(o.level, 8),
      at: Number(o.at) || 0,
      n: n,
      w: wrong,
      tags: tags,
      v: VERSION
    };
  }

  /* The map on the roster row, as a list oldest first. A row that is not a
     row (a later version's field, a half-written one) is skipped rather
     than read as a sheet with no mistakes on it. */
  function sheetsOf(map) {
    var out = [];
    if (!map || typeof map !== 'object') return out;
    Object.keys(map).forEach(function (id) {
      var e = map[id];
      if (!e || typeof e !== 'object' || !(Number(e.at) > 0) || !Array.isArray(e.tags)) return;
      out.push({ id: id, ws: str(e.ws, 80) || 'Worksheet', sub: subjectKey(e.sub), lvl: str(e.lvl, 8),
                 at: Number(e.at), n: Math.max(0, Number(e.n) || 0), w: Math.max(0, Number(e.w) || 0),
                 tags: e.tags.filter(function (t) { return t && isTag(t.t); }) });
    });
    out.sort(function (a, b) { return a.at - b.at || (a.id < b.id ? -1 : 1); });
    return out;
  }

  /* The sheets beyond the newest `max`, which the writer deletes so a row
     a student keeps for years never grows past what a document can hold. */
  function pruneIds(map, max) {
    var keep = max > 0 ? max : SHEETS_MAX;
    var list = sheetsOf(map);
    var bad = [];
    if (map && typeof map === 'object') {
      Object.keys(map).forEach(function (id) {
        if (!list.some(function (s) { return s.id === id; })) bad.push(id);
      });
    }
    if (list.length <= keep) return bad;
    return bad.concat(list.slice(0, list.length - keep).map(function (s) { return s.id; }));
  }

  /* ---- THE TREND ----
     Is this gap getting smaller? Asked of the RATE, never the count: a
     student who did twice as many papers this month makes more of every
     mistake and is not getting worse for it. The sheets of the subject are
     cut in two by time — the newer half against the older half — and the
     tag's rate per attempted question compared. Too few sheets is said as
     such ("new"), rather than dressed up as a trend. */
  var TREND_MIN_SHEETS = 3;
  function trendOf(sheets, tag) {
    if (sheets.length < TREND_MIN_SHEETS) return { trend: 'new', before: 0, after: 0 };
    var cut = Math.floor(sheets.length / 2);
    var old = sheets.slice(0, cut), recent = sheets.slice(cut);
    function rate(list) {
      var hits = 0, tried = 0;
      list.forEach(function (s) {
        tried += Math.max(1, s.n);
        s.tags.forEach(function (t) { if (t.t === tag) hits++; });
      });
      return { hits: hits, rate: tried ? hits / tried : 0 };
    }
    var a = rate(old), b = rate(recent);
    var trend = 'steady';
    if (a.hits === 0 && b.hits > 0) trend = 'new';
    else if (b.hits === 0 && a.hits > 0) trend = 'improving';
    else if (b.rate <= a.rate * 0.6) trend = 'improving';
    else if (b.rate >= a.rate * 1.5 && b.hits >= 2) trend = 'worse';
    return { trend: trend, before: a.rate, after: b.rate };
  }
  var TREND_WORDS = {
    improving: { word: 'Improving', ico: '✓', cls: 'gapUp' },
    steady: { word: 'Still there', ico: '–', cls: 'gapSteady' },
    worse: { word: 'Getting worse', ico: '▲', cls: 'gapDown' },
    'new': { word: 'New', ico: '🆕', cls: 'gapNew' }
  };
  function trendWord(t) { return TREND_WORDS[t] || TREND_WORDS.steady; }

  /* THE GAP VIEW'S NUMBERS. Ranked by a recency-weighted count (a slip made
     this week outweighs one made last term), with every occurrence kept so
     the view can link to the actual mistakes. */
  var HALF_LIFE_DAYS = 30;
  /* A slip counts at least RECENCY_FLOOR of itself however old it is, and
     the rest fades with a 30-day half-life — so a slip made three times last
     term still outranks one made once this week, while of two made equally
     often, the recent one comes first. */
  var RECENCY_FLOOR = 0.4;
  function recencyWeight(ageDays) {
    return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS);
  }
  function summarize(map, opts) {
    opts = opts || {};
    var now = Number(opts.now) || Date.now();
    var want = opts.subject && opts.subject !== 'all' ? subjectKey(opts.subject) : '';
    var all = sheetsOf(map);
    var sheets = want ? all.filter(function (s) { return s.sub === want; }) : all;
    var by = {};
    sheets.forEach(function (s, si) {
      s.tags.forEach(function (t) {
        var g = by[t.t];
        if (!g) {
          g = by[t.t] = { tag: t.t, label: label(t.t), fix: fix(t.t), n: 0, score: 0, sheets: {},
                          subjects: {}, last: 0, lastIdx: -1, mistakes: [] };
        }
        g.n++;
        var age = Math.max(0, (now - s.at) / 86400000);
        g.score += recencyWeight(age);
        g.sheets[s.id] = 1;
        if (s.sub) g.subjects[s.sub] = 1;
        if (s.at >= g.last) { g.last = s.at; g.lastIdx = si; }
        g.mistakes.push({ sheet: s.id, ws: s.ws, at: s.at, q: t.q, why: t.why, v: t.v, top: t.top, p: t.p, mid: t.mid });
      });
    });
    var gaps = Object.keys(by).map(function (k) {
      var g = by[k];
      var tr = trendOf(g.subjects && Object.keys(g.subjects).length === 1 && !want
        ? all.filter(function (s) { return s.sub === Object.keys(g.subjects)[0]; })
        : sheets, g.tag);
      g.sheetCount = Object.keys(g.sheets).length;
      g.trend = tr.trend;
      g.rateBefore = tr.before;
      g.rateAfter = tr.after;
      g.cleanSince = g.lastIdx >= 0 ? sheets.length - 1 - g.lastIdx : 0;
      g.mistakes.sort(function (a, b) { return b.at - a.at; });
      g.subjects = Object.keys(g.subjects);
      delete g.sheets;
      delete g.lastIdx;
      return g;
    });
    gaps.sort(function (a, b) { return b.score - a.score || b.n - a.n || (a.tag < b.tag ? -1 : 1); });
    var attempted = 0, wrong = 0;
    sheets.forEach(function (s) { attempted += s.n; wrong += s.w; });
    return {
      sheets: sheets.length,
      attempted: attempted,
      wrong: wrong,
      first: sheets.length ? sheets[0].at : 0,
      latest: sheets.length ? sheets[sheets.length - 1].at : 0,
      subjects: uniq(all.map(function (s) { return s.sub; }).filter(Boolean)),
      gaps: opts.limit > 0 ? gaps.slice(0, opts.limit) : gaps,
      timeline: sheets.map(function (s) { return { id: s.id, ws: s.ws, sub: s.sub, at: s.at, n: s.n, w: s.w, tags: s.tags.length }; })
    };
  }

  /* ---- THE STUDENT'S OWN GAPS, from their mistake book ----
     What Study Buddy aims a hint and a practice session at. Read off the
     book already in memory (no read of its own): a mistake still to redo
     counts in full, one they have since got right (Sorted) counts for a
     little — it was a gap, and it may come back — and an old one fades. */
  function fromMistakes(rows, opts) {
    opts = opts || {};
    var now = Number(opts.now) || Date.now();
    var want = opts.subject ? subjectKey(opts.subject) : '';
    var by = {};
    (rows || []).forEach(function (m) {
      if (!m || !isTag(m.tag)) return;
      if (want && subjectKey(m.subject) && subjectKey(m.subject) !== want) return;
      var at = Number(m.at) || now;
      var w = recencyWeight(Math.max(0, (now - at) / 86400000)) * (m.cleared ? 0.35 : 1);
      var g = by[m.tag] || (by[m.tag] = { tag: m.tag, label: label(m.tag), fix: fix(m.tag), n: 0, open: 0, score: 0, ids: [], whys: [] });
      g.n++;
      if (!m.cleared) { g.open++; if (m.id) g.ids.push(m.id); }
      g.score += w;
      if (m.why && g.whys.length < 3) g.whys.push(str(m.why, WHY_MAX));
    });
    var out = Object.keys(by).map(function (k) { return by[k]; });
    out.sort(function (a, b) { return b.score - a.score || b.open - a.open || (a.tag < b.tag ? -1 : 1); });
    return opts.limit > 0 ? out.slice(0, opts.limit) : out;
  }

  /* THE LINE A HINT CARRIES. It names the student's real gaps so a nudge
     can be aimed at the slip they actually make — and it says, in the same
     breath, that this is never permission to give more help than the help
     level allows. */
  function hintBlock(gaps) {
    var list = (gaps || []).filter(function (g) { return g && isTag(g.tag); }).slice(0, 3);
    if (!list.length) return '';
    return '\nTHIS STUDENT\'S KNOWN GAPS in this subject, from their own marked papers (most frequent first):\n' +
      list.map(function (g) {
        return '• ' + g.label + ' (' + g.n + ' time' + (g.n === 1 ? '' : 's') + ')' +
          (g.whys && g.whys.length ? ' — for example: ' + g.whys[0] : '');
      }).join('\n') +
      '\nWhere the question in front of them is one where that slip could happen, aim your nudge at it ' +
      '("check which whole the fraction is of"). Never mention a gap that does not fit this question, never ' +
      'shame them for it, and never give more of the answer than their help level allows.\n';
  }

  return {
    VERSION: VERSION,
    DEFS: DEFS,
    COMMON_IDS: COMMON_IDS,
    SUBJECT_IDS: SUBJECT_IDS,
    TOPIC_IDS: TOPIC_IDS,
    WHY_MAX: WHY_MAX,
    SHEETS_MAX: SHEETS_MAX,
    SHEET_TAGS_MAX: SHEET_TAGS_MAX,
    subjectKey: subjectKey,
    idsFor: idsFor,
    allIdsFor: allIdsFor,
    topicExtras: topicExtras,
    isTag: isTag,
    label: label,
    fix: fix,
    use: use,
    readTag: readTag,
    clean: clean,
    promptBlock: promptBlock,
    sheetEntry: sheetEntry,
    sheetsOf: sheetsOf,
    pruneIds: pruneIds,
    trendOf: trendOf,
    trendWord: trendWord,
    summarize: summarize,
    fromMistakes: fromMistakes,
    hintBlock: hintBlock
  };
});
