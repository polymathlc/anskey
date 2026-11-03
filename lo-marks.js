/* =====================================================================
   📐 MARKS BY LEARNING OBJECTIVE — every marked maths question filed under
   the MOE syllabus objective it tests, paper by paper (lo-marks.js)

   BYTE FOR BYTE THE SAME FILE in polymathlc/tutor (Study Buddy, the one
   WRITER) and polymathlc/anskey (Ans Key, the teacher's READER). Change it
   in one, copy it to the other; `tools/lo-marks-tests.mjs` (also the same
   file in both repos) compares the two copies when both are checked out
   side by side.

   WHERE THE NUMBERS COME FROM. Study Buddy's marking already files every
   question under a syllabus objective INSIDE the marking call it was
   already making (the 📐 SYLLABUS LIST block — no extra ChatGPT call), and
   adds the marks up per objective in `diagSummary()`, which rides the
   worksheet document beside `score`. This file turns that summary into ONE
   small entry per marked worksheet:

     studentProfiles/{uid}.tutorLos.{worksheetId}
       = { v: 1, ws, sub, lvl, at,
           r: [{ l: objective id, k: topic key (no single objective),
                 p: the marking's own words (not on the list),
                 q: questions, x: marks on the paper, g: marks got,
                 a: marks on attempted questions, s: "3=2/2 5=0/1 7=-/2" }] }

   and draws THE TABLE: one row per objective, one column per worksheet in
   the order they were marked, every cell the marks got over the marks
   attempted on that objective in that paper — densely packed, so a teacher
   reads a term of diagnostic tracking on one screen.

   - THE IDS ARE THE MATHS APP'S (`P5.FR.2.6`), from `MOE_SYLLABUS` in
     polymathlc/math — the content column of the MOE Primary Mathematics
     Syllabus 2021, P1 to P6, 240 objectives. An id is for ever: the tree
     below is APPENDED to, never renumbered, exactly as that app's is.
   - A BLANK IS NOT A WRONG ANSWER. A cell is got over ATTEMPTED marks (the
     rule the headline score follows), and a question left blank shows as a
     dash with the marks it carried, never as a nought.
   - PLAIN CODE, NO CALLS. Nothing here asks a model anything; the same
     rows draw the same table every time.
   - EVERYTHING IS textContent. The rows were written on a child's device:
     a worksheet name is text, never markup.
   - IT IS BOUNDED. `SHEETS_MAX` entries, `ROWS_MAX` rows each and
     `QS_MAX` questions a row, so the roster row (which also carries the
     mistake mirror and the concept gaps) never nears Firestore's megabyte.
   ===================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.LoMarks = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var VERSION = 1;
  var SHEETS_MAX = 60;
  var ROWS_MAX = 60;
  var QS_MAX = 40;
  var HI_PCT = 80;
  var MID_PCT = 50;
  var TREND_STEP = 15;     // percentage points between the older and newer half
  var UNLISTED = 'Not on the syllabus list';

  /* THE TREE — [level, [[sub-strand key, sub-strand, strand, [[topic,
     [[code, objective], …]], …]], …]]. Generated from the maths app's
     MOE_SYLLABUS; the id of an objective is level.key.code. */
  var MATH_TREE = [
    ['P1', [
      ['WN', 'Whole Numbers', 'Number and Algebra', [
        ['Numbers up to 100', [
          ['1.1', 'counting to tell the number of objects in a given set'],
          ['1.2', 'number notation, representations and place values (tens, ones)'],
          ['1.3', 'reading and writing numbers in numerals and in words'],
          ['1.4', 'comparing the number of objects in two or more sets'],
          ['1.5', 'comparing and ordering numbers'],
          ['1.6', 'patterns in number sequences'],
          ['1.7', 'ordinal numbers (first, second, up to tenth) and symbols (1st, 2nd, 3rd, etc)'],
          ['1.8', 'number bonds for numbers up to 10'],
        ]],
        ['Addition and Subtraction', [
          ['2.1', 'concepts of addition and subtraction'],
          ['2.2', 'use of +, – and ='],
          ['2.3', 'relationship between addition and subtraction'],
          ['2.4', 'adding more than two 1-digit numbers'],
          ['2.5', 'adding and subtracting within 100'],
          ['2.6', 'adding and subtracting using algorithms'],
          ['2.7', 'solving 1-step word problems involving addition and subtraction within 20'],
          ['2.8', 'mental calculation involving addition and subtraction'],
        ]],
        ['Multiplication and Division', [
          ['3.1', 'concepts of multiplication and division'],
          ['3.2', 'use of ×'],
          ['3.3', 'multiplying within 40'],
          ['3.4', 'dividing within 20'],
          ['3.5', 'solving 1-step word problems involving multiplication and division with pictorial representation'],
        ]],
      ]],
      ['MON', 'Money', 'Number and Algebra', [
        ['Money', [
          ['1.1', 'counting amount of money'],
          ['1.2', 'solving 1-step word problems involving addition and subtraction of money in dollars only (or in cents only)'],
        ]],
      ]],
      ['MEA', 'Measurement', 'Measurement and Geometry', [
        ['Length', [
          ['1.1', 'measuring and comparing the length of objects in non-standard units'],
        ]],
        ['Time', [
          ['2.1', 'telling time to the hour/half hour'],
        ]],
      ]],
      ['GEO', 'Geometry', 'Measurement and Geometry', [
        ['2D Shapes', [
          ['1.1', 'identifying, naming, describing and classifying 2D shapes'],
          ['1.2', 'making/completing patterns with 2D shapes according to one or two of the following attributes'],
        ]],
      ]],
      ['DRI', 'Data Representation and Interpretation', 'Statistics', [
        ['Picture Graphs', [
          ['1.1', 'reading and interpreting data from picture graphs'],
        ]],
      ]],
    ]],
    ['P2', [
      ['WN', 'Whole Numbers', 'Number and Algebra', [
        ['Numbers up to 1000', [
          ['1.1', 'counting in tens/hundreds'],
          ['1.2', 'number notation, representations and place values (hundreds, tens, ones)'],
          ['1.3', 'reading and writing numbers in numerals and in words'],
          ['1.4', 'comparing and ordering numbers'],
          ['1.5', 'patterns in number sequences'],
          ['1.6', 'odd and even numbers'],
        ]],
        ['Addition and Subtraction', [
          ['2.1', 'addition and subtraction algorithms (up to 3 digits)'],
          ['2.2', 'solving up to 2-step word problems involving addition and subtraction'],
          ['2.3', 'mental calculation involving addition and subtraction of a 3-digit number and ones/tens/ hundreds'],
        ]],
        ['Multiplication and Division', [
          ['3.1', 'multiplication tables of 2, 3, 4, 5 and 10'],
          ['3.2', 'use of ÷'],
          ['3.3', 'relationship between multiplication and division'],
          ['3.4', 'multiplying and dividing within the multiplication tables'],
          ['3.5', 'solving 1-step word problems involving multiplication and division within the multiplication tables'],
          ['3.6', 'mental calculation involving multiplication and division within the multiplication tables of 2, 3, 4, 5 and 10'],
        ]],
      ]],
      ['FR', 'Fractions', 'Number and Algebra', [
        ['Fraction of a Whole', [
          ['1.1', 'fraction as part of a whole'],
          ['1.2', 'notation and representations of fractions'],
          ['1.3', 'comparing and ordering fractions with denominators of given fractions not exceeding 12'],
        ]],
        ['Addition and Subtraction', [
          ['2.1', 'adding and subtracting like fractions within one whole with denominators of given fractions not exceeding 12'],
        ]],
      ]],
      ['MON', 'Money', 'Number and Algebra', [
        ['Money', [
          ['1.1', 'counting amount of money in dollars and cents'],
          ['1.2', 'reading and writing money in decimal notation'],
          ['1.3', 'comparing two or three amounts of money'],
          ['1.4', 'converting an amount of money in decimal notation to cents only, and vice versa'],
          ['1.5', 'solving word problems involving money in dollars only (or in cents only)'],
        ]],
      ]],
      ['MEA', 'Measurement', 'Measurement and Geometry', [
        ['Length, Mass and Volume', [
          ['1.1', 'measuring'],
          ['1.2', 'measuring and drawing a line segment to the nearest cm'],
          ['1.3', 'using appropriate units of measurement and their abbreviations cm, m, g, kg, ℓ'],
          ['1.4', 'comparing and ordering'],
          ['1.5', 'solving word problems involving length/mass/ volume'],
        ]],
        ['Time', [
          ['2.1', 'telling time to 5 minutes'],
          ['2.2', 'use of ‘a.m.’ and ‘p.m.’'],
          ['2.3', 'use of abbreviations h and min'],
          ['2.4', 'drawing hands on the clock face to show time'],
          ['2.5', 'duration of 1 hour/half hour'],
        ]],
      ]],
      ['GEO', 'Geometry', 'Measurement and Geometry', [
        ['2D Shapes', [
          ['1.1', 'identifying, naming and describing 2D shapes'],
          ['1.2', 'identifying the basic shapes that make up a given figure'],
          ['1.3', 'forming different 2D figures with'],
          ['1.4', 'copying figures on dot grid or square grid'],
        ]],
        ['3D Shapes', [
          ['2.1', 'identifying, naming, describing and classifying 3D shapes'],
        ]],
      ]],
      ['DRI', 'Data Representation and Interpretation', 'Statistics', [
        ['Picture Graphs with Scales', [
          ['1.1', 'reading and interpreting data from picture graphs with scales'],
          ['1.2', 'solving 1-step problems using data from picture graphs'],
        ]],
      ]],
    ]],
    ['P3', [
      ['WN', 'Whole Numbers', 'Number and Algebra', [
        ['Numbers up to 10 000', [
          ['1.1', 'counting in hundreds/thousands'],
          ['1.2', 'number notation, representations and place values (thousands, hundreds, tens, ones)'],
          ['1.3', 'reading and writing numbers in numerals and in words'],
          ['1.4', 'comparing and ordering numbers'],
          ['1.5', 'patterns in number sequences'],
        ]],
        ['Addition and Subtraction', [
          ['2.1', 'addition and subtraction algorithms (up to 4 digits)'],
          ['2.2', 'solving up to 2-step word problems involving addition and subtraction'],
          ['2.3', 'mental calculation involving addition and subtraction of two 2-digit numbers'],
        ]],
        ['Multiplication and Division', [
          ['3.1', 'multiplication tables of 6, 7, 8 and 9'],
          ['3.2', 'multiplying and dividing within the multiplication tables'],
          ['3.3', 'division with remainder'],
          ['3.4', 'multiplication and division algorithms (up to 3 digits by 1 digit)'],
          ['3.5', 'solving up to 2-step word problems involving the 4 operations'],
          ['3.6', 'mental calculation involving multiplication and division within the multiplication tables'],
        ]],
      ]],
      ['FR', 'Fractions', 'Number and Algebra', [
        ['Equivalent fractions', [
          ['1.1', 'equivalent fractions'],
          ['1.2', 'expressing a fraction in its simplest form'],
          ['1.3', 'comparing and ordering unlike fractions with denominators of given fractions not exceeding 12'],
          ['1.4', 'writing the equivalent fraction of a fraction given the denominator or the numerator'],
        ]],
        ['Addition and subtraction', [
          ['2.1', 'adding and subtracting two related fractions within one whole with denominators of given fractions not exceeding 12'],
        ]],
      ]],
      ['MON', 'Money', 'Number and Algebra', [
        ['Money', [
          ['1.1', 'adding and subtracting money in decimal notation'],
          ['1.2', 'solving word problems involving addition and subtraction of money in decimal notation'],
        ]],
      ]],
      ['MEA', 'Measurement', 'Measurement and Geometry', [
        ['Length, Mass and Volume', [
          ['1.1', 'measuring'],
          ['1.2', 'measuring length/mass/volume (of liquid) in compound units'],
          ['1.3', 'converting a measurement in compound units to the smaller unit, and vice versa'],
          ['1.4', 'solving word problems involving length/mass/ volume/capacity excluding fractions and compound units'],
        ]],
        ['Time', [
          ['2.1', 'telling time to the minute'],
          ['2.2', 'use of ‘past’ and ‘to’ to tell time'],
          ['2.3', 'measuring time in hours and minutes'],
          ['2.4', 'converting time in hours and minutes to minutes only, and vice versa'],
          ['2.5', 'finding the starting time, finishing time or duration given the other two quantities'],
          ['2.6', 'solving problems involving time in hours and minutes'],
        ]],
      ]],
      ['AV', 'Area and Volume', 'Measurement and Geometry', [
        ['Area and Perimeter', [
          ['1.1', 'concepts of area and perimeter of a plane figure'],
          ['1.2', 'measuring area in square units, cm² and m², excluding conversion between cm² and m²'],
          ['1.3', 'perimeter of'],
          ['1.4', 'area of rectangle/square'],
        ]],
      ]],
      ['GEO', 'Geometry', 'Measurement and Geometry', [
        ['Angles', [
          ['1.1', 'concepts of angle'],
          ['1.2', 'right angles, angles greater than/smaller than a right angle'],
        ]],
        ['Perpendicular and Parallel Lines', [
          ['2.1', 'perpendicular and parallel lines'],
          ['2.2', 'draw perpendicular and parallel lines on square grid'],
        ]],
      ]],
      ['DRI', 'Data Representation and Interpretation', 'Statistics', [
        ['Bar Graphs', [
          ['1.1', 'reading and interpreting data from bar graphs'],
          ['1.2', 'using different scales on axis'],
          ['1.3', 'solving 1-step problems using data from bar graphs'],
        ]],
      ]],
    ]],
    ['P4', [
      ['WN', 'Whole Numbers', 'Number and Algebra', [
        ['Numbers up to 100 000', [
          ['1.1', 'number notation, representations and place values (ten thousands, thousands, hundreds, tens, ones)'],
          ['1.2', 'reading and writing numbers in numerals and in words'],
          ['1.3', 'comparing and ordering numbers'],
          ['1.4', 'patterns in number sequences'],
          ['1.5', 'rounding numbers to the nearest 10, 100 or 1000'],
          ['1.6', 'use of ≈'],
        ]],
        ['Factors and Multiples', [
          ['2.1', 'factors, multiples and their relationship'],
          ['2.2', 'determining if a 1-digit number is a factor of a given number within 100'],
          ['2.3', 'finding the common factors of two given numbers'],
          ['2.4', 'determining if a number is a multiple of a given 1-digit number'],
          ['2.5', 'finding the common multiples of two given 1-digit numbers'],
        ]],
        ['Four Operations', [
          ['3.1', 'multiplication algorithm'],
          ['3.2', 'division algorithm (up to 4 digits by 1 digit)'],
          ['3.3', 'solving up to 3-step word problems involving the 4 operations'],
        ]],
      ]],
      ['FR', 'Fractions', 'Number and Algebra', [
        ['Mixed Numbers and Improper Fractions', [
          ['1.1', 'mixed numbers, improper fractions and their relationships'],
        ]],
        ['Fraction of a Set of Objects', [
          ['2.1', 'fraction as part of a set of objects'],
        ]],
        ['Addition and Subtraction', [
          ['3.1', 'adding and subtracting fractions with denominators of given fractions not exceeding 12 and not more than two different denominators'],
          ['3.2', 'solving up to 2-step word problems involving addition and subtraction'],
        ]],
      ]],
      ['DEC', 'Decimals', 'Number and Algebra', [
        ['Decimals up to 3 decimal places', [
          ['1.1', 'notation, representations and place values (tenths, hundredths, thousandths)'],
          ['1.2', 'comparing and ordering decimals'],
          ['1.3', 'dividing a whole number by a whole number with quotient as a decimal'],
          ['1.4', 'converting decimals to fractions'],
          ['1.5', 'converting fractions to decimals when the denominator is a factor of 10 or 100'],
          ['1.6', 'rounding decimals to'],
        ]],
        ['Addition and Subtraction', [
          ['2.1', 'adding and subtracting decimals (up to 2 decimal places)'],
        ]],
        ['Multiplication and Division', [
          ['3.1', 'multiplying and dividing decimals (up to 2 decimal places) by a 1-digit whole number'],
          ['3.2', 'solving up to 2-step word problems involving the 4 operations'],
          ['3.3', 'rounding off answers to a specified degree of accuracy'],
        ]],
      ]],
      ['MEA', 'Measurement', 'Measurement and Geometry', [
        ['Time', [
          ['1.1', 'measuring time in seconds'],
          ['1.2', '24-hour clock'],
          ['1.3', 'solving problems involving time in 24-hour clock'],
        ]],
      ]],
      ['AV', 'Area and Volume', 'Measurement and Geometry', [
        ['Area and Perimeter', [
          ['1.1', 'finding one dimension of a rectangle given the other dimension and its area/perimeter'],
          ['1.2', 'finding the length of one side of a square given its area/perimeter'],
          ['1.3', 'finding the area and perimeter of composite figures made up of rectangles and squares'],
        ]],
      ]],
      ['GEO', 'Geometry', 'Measurement and Geometry', [
        ['Angles', [
          ['1.1', 'using notation such as ABC and a to name angles'],
          ['1.2', 'measuring angles in degrees'],
          ['1.3', 'drawing an angle of given size'],
          ['1.4', 'relating quarter, half and complete turns to angles in degrees'],
          ['1.5', '8-point compass'],
        ]],
        ['Rectangle and Square', [
          ['2.1', 'properties of rectangle and square, excluding diagonal properties'],
          ['2.2', 'drawing rectangles and squares on square grid'],
        ]],
        ['Line Symmetry', [
          ['3.1', 'identifying symmetric figures'],
          ['3.2', 'determining whether a straight line is a line of symmetry of a symmetric figure'],
          ['3.3', 'completing a symmetric figure with respect to a given line of symmetry on square grid'],
        ]],
      ]],
      ['DRI', 'Data Representation and Interpretation', 'Statistics', [
        ['Tables and Line Graphs', [
          ['1.1', 'completing a table from given data'],
          ['1.2', 'reading and interpreting data from tables/line graphs'],
          ['1.3', 'solve 1-step problems using data from tables/graphs'],
        ]],
      ]],
    ]],
    ['P5', [
      ['WN', 'Whole Numbers', 'Number and Algebra', [
        ['Numbers up to 10 million', [
          ['1.1', 'reading and writing numbers in numerals and in words'],
        ]],
        ['Four Operations', [
          ['2.1', 'multiplying and dividing by 10, 100, 1000 and their multiples without calculator'],
          ['2.2', 'order of operations without calculator'],
          ['2.3', 'use of brackets without calculator'],
          ['2.4', 'solving word problems involving the 4 operations'],
        ]],
      ]],
      ['FR', 'Fractions', 'Number and Algebra', [
        ['Fraction and Division', [
          ['1.1', 'dividing a whole number by a whole number with quotient as a fraction'],
          ['1.2', 'converting fractions to decimals'],
        ]],
        ['Four Operations', [
          ['2.1', 'adding and subtracting mixed numbers'],
          ['2.2', 'multiplying a proper/improper fraction and a whole number without calculator'],
          ['2.3', 'multiplying a proper fraction and a proper/ improper fractions without calculator'],
          ['2.4', 'multiplying two improper fractions'],
          ['2.5', 'multiplying a mixed number and a whole number'],
          ['2.6', 'solving word problems involving addition, subtraction and multiplication'],
        ]],
      ]],
      ['DEC', 'Decimals', 'Number and Algebra', [
        ['Four Operations', [
          ['1.1', 'multiplying and dividing decimals (up to 3 decimal places) by 10, 100, 1000 and their multiples without calculator'],
          ['1.2', 'converting a measurement from a smaller unit to a larger unit in decimal form, and vice versa'],
          ['1.3', 'solving word problems involving the 4 operations'],
        ]],
      ]],
      ['PCT', 'Percentage', 'Number and Algebra', [
        ['Percentage', [
          ['1.1', 'expressing a part of a whole as a percentage'],
          ['1.2', 'use of %'],
          ['1.3', 'finding a percentage part of a whole'],
          ['1.4', 'finding discount, GST and annual interest'],
          ['1.5', 'solving up to 2-step word problems involving percentage'],
        ]],
      ]],
      ['RAT', 'Ratio', 'Number and Algebra', [
        ['Ratio', [
          ['1.1', 'notation, representations and interpretation of a:b and a:b:c, where a, b and c are whole numbers, excluding ratios involving fractions and decimals'],
          ['1.2', 'equivalent ratios'],
          ['1.3', 'dividing a quantity in a given ratio'],
          ['1.4', 'expressing a ratio in its simplest form'],
          ['1.5', 'finding the ratio of two or three given quantities'],
          ['1.6', 'finding the missing term in a pair of equivalent ratios'],
          ['1.7', 'solving up to 2-step word problems involving ratio'],
        ]],
      ]],
      ['RS', 'Rate and Speed', 'Number and Algebra', [
        ['Rate', [
          ['1.1', 'rate as the amount of a quantity per unit of another quantity'],
          ['1.2', 'finding rate, total amount or number of units given the other two quantities'],
          ['1.3', 'solving word problems involving rate'],
        ]],
      ]],
      ['AV', 'Area and Volume', 'Measurement and Geometry', [
        ['Area of Triangle', [
          ['1.1', 'concepts of base and height of a triangle'],
          ['1.2', 'area of triangle'],
          ['1.3', 'finding the area of composite figures made up of rectangles, squares and triangles'],
        ]],
        ['Volume of Cube and Cuboid', [
          ['2.1', 'building solids with unit cubes'],
          ['2.2', 'measuring volume in cubic units, cm³ and m³, excluding conversion between cm³ and m³'],
          ['2.3', 'drawing cubes and cuboids on isometric grid'],
          ['2.4', 'volume of a cube/cuboid'],
          ['2.5', 'finding the volume of liquid in a rectangular tank'],
          ['2.6', 'relationship between ℓ (or ml) and cm³'],
        ]],
      ]],
      ['GEO', 'Geometry', 'Measurement and Geometry', [
        ['Angles', [
          ['1.1', 'angles on a straight line'],
          ['1.2', 'angles at a point'],
          ['1.3', 'vertically opposite angles'],
          ['1.4', 'finding unknown angles'],
        ]],
        ['Triangle', [
          ['2.1', 'properties of'],
          ['2.2', 'angle sum of a triangle'],
          ['2.3', 'finding unknown angles without additional construction of lines'],
        ]],
        ['Parallelogram, Rhombus and Trapezium', [
          ['3.1', 'properties of'],
          ['3.2', 'finding unknown angles without additional construction of lines'],
        ]],
      ]],
      ['DA', 'Data Analysis', 'Statistics', [
        ['Average of a Set of Data', [
          ['1.1', 'average as ‘total value ÷ number of data’'],
          ['1.2', 'relationship between average, total value and number of data'],
        ]],
      ]],
    ]],
    ['P6', [
      ['FR', 'Fractions', 'Number and Algebra', [
        ['Four Operations', [
          ['1.1', 'dividing a proper fraction by a whole number without calculator'],
          ['1.2', 'dividing a whole number/proper fraction by a proper fraction without calculator'],
          ['1.3', 'solving word problems involving the 4 operations'],
        ]],
      ]],
      ['PCT', 'Percentage', 'Number and Algebra', [
        ['Percentage', [
          ['1.1', 'finding the whole given a part and the percentage'],
          ['1.2', 'finding percentage increase/decrease'],
          ['1.3', 'solving word problems involving percentage'],
        ]],
      ]],
      ['RAT', 'Ratio', 'Number and Algebra', [
        ['Ratio', [
          ['1.1', 'relationship between fraction and ratio'],
          ['1.2', 'solving word problems involving ratio including changing ratios'],
        ]],
      ]],
      ['RS', 'Rate and Speed', 'Number and Algebra', [
        ['Distance, Time and Speed', [
          ['1.1', 'concepts of speed and average speed'],
          ['1.2', 'relationship between distance, time and speed exclude conversion of units e.g. km/h to m/min'],
          ['1.3', 'writing speed in different units such as km/h, m/min, m/s and cm/s'],
          ['1.4', 'solving up to 3-step word problems involving speed and average speed'],
        ]],
      ]],
      ['ALG', 'Algebra', 'Number and Algebra', [
        ['Algebra', [
          ['1.1', 'using a letter to represent an unknown number'],
          ['1.2', 'notation, representations and interpretation of simple algebraic expressions such as'],
          ['1.3', 'simplifying simple linear expressions excluding brackets'],
          ['1.4', 'evaluating simple linear expressions by substitution'],
          ['1.5', 'solving simple linear equations involving whole number coefficient only in simple context'],
        ]],
      ]],
      ['AV', 'Area and Volume', 'Measurement and Geometry', [
        ['Area and Circumference of Circle', [
          ['1.1', 'area and circumference of circle'],
          ['1.2', 'finding the area and perimeter of'],
          ['1.3', 'finding the area and perimeter of composite figures made up of square, rectangle, triangle, semicircle and quarter circle'],
        ]],
        ['Volume of Cube and Cuboid', [
          ['2.1', 'finding one dimension of a cuboid given its volume and the other dimensions'],
          ['2.2', 'finding the length of one edge of a cube given its volume'],
          ['2.3', 'finding the height of a cuboid given its volume and base area'],
          ['2.4', 'finding the area of a face of a cuboid given its volume and one dimension'],
          ['2.5', 'use of √ and ∛'],
        ]],
      ]],
      ['GEO', 'Geometry', 'Measurement and Geometry', [
        ['Special Quadrilaterals', [
          ['1.1', 'finding unknown angles, without additional construction of lines, in composite geometric figures involving'],
        ]],
        ['Nets', [
          ['2.1', 'identifying and drawing 2D representations of'],
          ['2.2', 'identifying the nets of 3D solids'],
          ['2.3', 'identifying the solid which can be formed by a given net'],
        ]],
      ]],
      ['DRI', 'Data Representation and Interpretation', 'Statistics', [
        ['Pie Charts', [
          ['1.1', 'reading and interpreting data from pie charts'],
          ['1.2', 'solving 1-step problems using data from tables/graphs'],
        ]],
      ]],
    ]],  ];

  /* ---- THE CATALOGUE, flattened once ---- */
  var _cat = null;
  function catalogue() {
    if (_cat) return _cat;
    var list = [], byId = {}, byTkey = {}, levels = [];
    MATH_TREE.forEach(function (L, li) {
      var lv = L[0];
      levels.push(lv);
      L[1].forEach(function (sb, si) {
        sb[3].forEach(function (tp, ti) {
          var tname = sb[1] + ': ' + tp[0];
          var tkey = lv + '.' + sb[0] + ' ' + tname;
          var gkey = lv + '|' + sb[0] + '|' + tp[0];
          tp[1].forEach(function (row, ri) {
            var e = {
              id: lv + '.' + sb[0] + '.' + row[0],
              level: lv, subKey: sb[0], sub: sb[1], strand: sb[2], topic: tp[0],
              tname: tname, tkey: tkey, gkey: gkey,
              code: row[0], text: row[1],
              order: li * 1000000 + si * 10000 + ti * 100 + ri
            };
            list.push(e);
            byId[e.id.toLowerCase()] = e;
            if (!byTkey[tkey]) byTkey[tkey] = e;
          });
        });
      });
    });
    _cat = { list: list, byId: byId, byTkey: byTkey, levels: levels };
    return _cat;
  }
  function entries(subject) { return subject === 'math' ? catalogue().list.slice() : []; }
  function objective(id) { return catalogue().byId[String(id || '').trim().toLowerCase()] || null; }
  function topicOf(tkey) { return catalogue().byTkey[String(tkey || '')] || null; }

  /* ---- small pure helpers ---- */
  function str(v, cap) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return cap && s.length > cap ? s.slice(0, cap) + '…' : s;
  }
  function num(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  }
  /* 1.5 reads "1½" — a half mark is the only fraction a paper awards often,
     and "1.5/2" in a 34-pixel cell is a cell nobody can read. */
  function fmt(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    var whole = Math.floor(v), frac = Math.round((v - whole) * 100) / 100;
    if (frac === 0) return String(whole);
    if (frac === 0.5) return (whole ? String(whole) : '') + '½';
    return String(v);
  }
  function pct(got, att) {
    return att > 0 ? Math.round((got / att) * 100) : null;
  }
  function band(p) {
    if (p === null || p === undefined) return 'none';
    if (p >= HI_PCT) return 'hi';
    if (p >= MID_PCT) return 'mid';
    return 'lo';
  }
  function dateText(at) {
    var t = Number(at) || 0;
    if (!t) return '';
    var d = new Date(t);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: '2-digit' });
  }
  function levelNum(lv) { var m = /^P(\d)$/.exec(String(lv || '')); return m ? +m[1] : 0; }

  /* ---- THE QUESTIONS IN A CELL, as one short string ----
     "3=2/2 5a=0/1 7=-/2": the question number, then marks got (a dash for
     a blank) over the marks it carried. A string and not a list because
     Firestore refuses an array inside an array, and a list of objects per
     question is three times the bytes for the same four facts. */
  function qNum(v) {
    return str(v, 10).replace(/[\s=\/]+/g, '').slice(0, 8);
  }
  function encodeQs(list) {
    var out = [];
    (list || []).forEach(function (q) {
      if (!q || out.length >= QS_MAX) return;
      var tot = num(q.tot);
      var n = qNum(q.n) || '?';
      var got = q.marked === false ? '-' : fmt(num(q.got));
      out.push(n + '=' + got + '/' + (tot ? fmt(tot) : '?'));
    });
    return out.join(' ');
  }
  function parseMark(s) {
    var t = String(s || '').trim();
    if (!t || t === '?') return 0;
    var half = /½$/.test(t);
    var base = half ? t.slice(0, -1) : t;
    var n = base === '' ? 0 : Number(base);
    if (!isFinite(n)) return 0;
    return n + (half ? 0.5 : 0);
  }
  function decodeQs(s) {
    var out = [];
    String(s || '').split(/\s+/).forEach(function (tok) {
      var m = /^([^=]*)=([^\/]*)\/(.*)$/.exec(tok);
      if (!m) return;
      var blank = m[2] === '-';
      out.push({ n: m[1], got: blank ? 0 : parseMark(m[2]), tot: parseMark(m[3]), blank: blank });
    });
    return out;
  }
  function qsText(qs) {
    return (qs || []).map(function (q) {
      return 'Q' + q.n + ' ' + (q.blank ? 'blank' + (q.tot ? ' (' + fmt(q.tot) + ')' : '') : fmt(q.got) + '/' + fmt(q.tot));
    }).join(' · ');
  }

  /* ---- WRITING: Study Buddy's worksheet summary → the stored entry ----
     `w` is a worksheet: { name, subject, level, diagnostic }. The summary
     rows are `diagSummary()`'s: { t, n, lo, q, tot, got, att, qs }. Null
     for a worksheet that is not maths or that filed nothing on the list —
     an entry with no objective in it is a column of dashes. */
  function sheetEntry(w) {
    var d = w && w.diagnostic;
    if (!d || !Array.isArray(d.rows) || !d.rows.length) return null;
    var sub = String(d.subject || (w && w.subject) || '');
    if (sub !== 'math') return null;
    var rows = [], placed = 0;
    d.rows.forEach(function (r) {
      if (!r || typeof r !== 'object' || rows.length >= ROWS_MAX) return;
      var e = r.lo ? objective(r.lo) : null;
      var k = !e && r.t && topicOf(r.t) ? String(r.t) : '';
      var row = {
        l: e ? e.id : '',
        k: k,
        p: (!e && !k) ? str(r.n, 60) : '',
        q: Math.max(0, Math.round(Number(r.q) || 0)),
        x: num(r.tot),
        g: num(r.got),
        a: num(r.att),
        s: String(r.qs || '').slice(0, 600)
      };
      if (row.g > row.a) row.g = row.a;
      if (row.a > row.x) row.x = row.a;
      if (e || k) placed++;
      rows.push(row);
    });
    if (!placed) return null;
    var at = typeof d.at === 'number' ? d.at : (Number(w && w.at) || Date.now());
    return {
      v: VERSION,
      ws: str((w && w.name) || 'Worksheet', 80),
      sub: 'math',
      lvl: str(d.level || (w && w.level) || '', 4),
      at: at,
      r: rows
    };
  }

  /* ---- READING: whatever is on the roster row, made safe ---- */
  function cleanEntry(id, e) {
    if (!e || typeof e !== 'object' || e.sub !== 'math' || !Array.isArray(e.r)) return null;
    var rows = [];
    e.r.forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var o = r.l ? objective(r.l) : null;
      var k = !o && r.k && topicOf(r.k) ? String(r.k) : '';
      var p = (!o && !k) ? str(r.p, 60) : '';
      var x = num(r.x), a = num(r.a), g = num(r.g);
      if (g > a) g = a;
      if (a > x) x = a;
      rows.push({ lo: o ? o.id : '', tk: k, tp: p, q: Math.max(0, Math.round(Number(r.q) || 0)),
                  tot: x, got: g, att: a, qs: decodeQs(r.s) });
    });
    if (!rows.length) return null;
    return { id: String(id || ''), ws: str(e.ws, 80) || 'Worksheet', lvl: str(e.lvl, 4), at: Number(e.at) || 0, rows: rows };
  }
  function sheetsOf(map) {
    var out = [];
    if (!map || typeof map !== 'object') return out;
    Object.keys(map).forEach(function (id) {
      var c = cleanEntry(id, map[id]);
      if (c) out.push(c);
    });
    out.sort(function (a, b) { return (a.at - b.at) || a.id.localeCompare(b.id); });
    return out;
  }
  /* The ids to drop so at most `max` remain: the OLDEST by when they were
     marked, which is the order a term's tracking can most afford to lose. */
  function pruneIds(map, max) {
    var ids = Object.keys(map || {});
    var cap = max == null ? SHEETS_MAX : max;
    if (ids.length <= cap) return [];
    ids.sort(function (a, b) {
      var ea = map[a] || {}, eb = map[b] || {};
      return (Number(ea.at) || 0) - (Number(eb.at) || 0);
    });
    return ids.slice(0, ids.length - cap);
  }
  function count(map) { return sheetsOf(map).length; }

  /* ---- THE TABLE'S MODEL ----
     opts: { level: 'all' | 'P5', untested: bool, sort: 'syllabus' | 'weak' }.
     Columns are the worksheets (oldest first) that hold at least one row
     the level filter keeps; rows are objectives, grouped under level ·
     sub-strand · topic in syllabus order, a topic-only row after its
     topic's objectives, and the unplaced rows last. */
  function emptyCell() { return { got: 0, att: 0, tot: 0, q: 0, qs: [] }; }
  function addInto(c, r) {
    c.got += r.got; c.att += r.att; c.tot += r.tot; c.q += r.q;
    if (r.qs) c.qs = c.qs.concat(r.qs);
  }
  function trendOf(cells) {
    var tried = cells.filter(function (c) { return c && c.att > 0; });
    if (!tried.length) return '';
    if (tried.length === 1) return 'new';
    var half = Math.floor(tried.length / 2);
    var og = 0, oa = 0, ng = 0, na = 0;
    tried.forEach(function (c, i) {
      if (i < half) { og += c.got; oa += c.att; } else { ng += c.got; na += c.att; }
    });
    var d = pct(ng, na) - pct(og, oa);
    if (d >= TREND_STEP) return 'up';
    if (d <= -TREND_STEP) return 'down';
    return 'steady';
  }
  function levelsIn(sheets) {
    var seen = {};
    (sheets || []).forEach(function (s) {
      s.rows.forEach(function (r) {
        var e = r.lo ? objective(r.lo) : (r.tk ? topicOf(r.tk) : null);
        if (e) seen[e.level] = true;
      });
    });
    return catalogue().levels.filter(function (lv) { return seen[lv]; });
  }
  function matrix(sheets, opts) {
    opts = opts || {};
    var level = opts.level && opts.level !== 'all' ? String(opts.level) : '';
    sheets = (sheets || []).slice();
    var keep = function (e) { return !level || (e && e.level === level); };
    var by = {}, rows = [];
    var cols = [];
    sheets.forEach(function (s) {
      var any = false;
      s.rows.forEach(function (r) {
        var e = r.lo ? objective(r.lo) : (r.tk ? topicOf(r.tk) : null);
        if (level && !keep(e)) return;
        if (!level && !e && !r.tp) return;
        any = true;
      });
      if (any) cols.push(s);
    });
    function rowFor(key, make) {
      if (!by[key]) { by[key] = make(); by[key].cells = cols.map(function () { return null; }); rows.push(by[key]); }
      return by[key];
    }
    cols.forEach(function (s, ci) {
      s.rows.forEach(function (r) {
        var e = r.lo ? objective(r.lo) : (r.tk ? topicOf(r.tk) : null);
        if (level && !keep(e)) return;
        var row;
        if (r.lo && e) {
          row = rowFor('o:' + e.id, function () {
            return { key: 'o:' + e.id, kind: 'lo', id: e.id, code: e.code, text: e.text, level: e.level,
                     sub: e.sub, topic: e.topic, gkey: e.gkey, order: e.order };
          });
        } else if (e) {
          row = rowFor('t:' + e.tkey, function () {
            return { key: 't:' + e.tkey, kind: 'topic', id: '', code: '', text: 'Topic only — no single objective',
                     level: e.level, sub: e.sub, topic: e.topic, gkey: e.gkey, order: e.order + 99 };
          });
        } else {
          var name = r.tp || 'No topic named';
          row = rowFor('p:' + name.toLowerCase(), function () {
            return { key: 'p:' + name.toLowerCase(), kind: 'unlisted', id: '', code: '', text: name, level: '',
                     sub: '', topic: UNLISTED, gkey: '~', order: 1e12 };
          });
        }
        if (!row.cells[ci]) row.cells[ci] = emptyCell();
        addInto(row.cells[ci], r);
      });
    });
    if (opts.untested) {
      var lvls = level ? [level] : levelsIn(cols);
      catalogue().list.forEach(function (e) {
        if (lvls.indexOf(e.level) < 0 || by['o:' + e.id]) return;
        rowFor('o:' + e.id, function () {
          return { key: 'o:' + e.id, kind: 'lo', id: e.id, code: e.code, text: e.text, level: e.level,
                   sub: e.sub, topic: e.topic, gkey: e.gkey, order: e.order };
        });
      });
    }
    rows.forEach(function (row) {
      var t = emptyCell(), papers = 0;
      row.cells.forEach(function (c) { if (c) { addInto(t, c); papers++; } });
      row.got = t.got; row.att = t.att; row.tot = t.tot; row.q = t.q; row.papers = papers;
      row.pct = pct(t.got, t.att);
      row.trend = trendOf(row.cells);
      row.last = null;
      for (var i = row.cells.length - 1; i >= 0; i--) {
        if (row.cells[i] && row.cells[i].att > 0) { row.last = pct(row.cells[i].got, row.cells[i].att); break; }
      }
    });
    rows.sort(function (a, b) { return (a.order - b.order) || a.text.localeCompare(b.text); });
    var groups = [], gby = {};
    rows.forEach(function (row) {
      var g = gby[row.gkey];
      if (!g) {
        g = gby[row.gkey] = { key: row.gkey, level: row.level, sub: row.sub, topic: row.topic, rows: [],
                              cells: cols.map(function () { return null; }) };
        groups.push(g);
      }
      g.rows.push(row);
      row.cells.forEach(function (c, ci) {
        if (!c) return;
        if (!g.cells[ci]) g.cells[ci] = emptyCell();
        addInto(g.cells[ci], c);
      });
    });
    groups.forEach(function (g) {
      var t = emptyCell();
      g.cells.forEach(function (c) { if (c) addInto(t, c); });
      g.got = t.got; g.att = t.att; g.tot = t.tot; g.pct = pct(t.got, t.att);
      g.trend = trendOf(g.cells);
    });
    var colTotals = cols.map(function (s, ci) {
      var t = emptyCell();
      rows.forEach(function (row) { if (row.cells[ci]) addInto(t, row.cells[ci]); });
      return { id: s.id, ws: s.ws, at: s.at, lvl: s.lvl, got: t.got, att: t.att, tot: t.tot, q: t.q, pct: pct(t.got, t.att) };
    });
    var all = emptyCell();
    colTotals.forEach(function (c) { all.got += c.got; all.att += c.att; all.tot += c.tot; all.q += c.q; });
    var weak = rows.filter(function (r) { return r.kind === 'lo' && r.pct !== null && r.pct < HI_PCT; })
      .sort(function (a, b) { return (a.pct - b.pct) || (b.att - a.att); });
    var tested = rows.filter(function (r) { return r.kind === 'lo' && r.papers > 0; }).length;
    var listed = rows.filter(function (r) { return r.kind === 'lo'; }).length;
    var model = {
      cols: colTotals, rows: rows, groups: groups, level: level || 'all',
      levels: levelsIn(sheets), sort: opts.sort === 'weak' ? 'weak' : 'syllabus',
      total: { got: all.got, att: all.att, tot: all.tot, q: all.q, pct: pct(all.got, all.att) },
      tested: tested, listed: listed, weak: weak,
      syllabusCount: level ? catalogue().list.filter(function (e) { return e.level === level; }).length : catalogue().list.length
    };
    if (model.sort === 'weak') {
      model.flat = rows.slice().sort(function (a, b) {
        var pa = a.pct === null ? 1e9 : a.pct, pb = b.pct === null ? 1e9 : b.pct;
        return (pa - pb) || (b.att - a.att) || (a.order - b.order);
      });
    }
    return model;
  }

  /* ---- THE TABLE AS TEXT, tab-separated, for pasting into a spreadsheet ---- */
  function cellWords(c) {
    if (!c) return '';
    if (!(c.att > 0)) return c.tot > 0 ? 'blank/' + fmt(c.tot) : '';
    return fmt(c.got) + '/' + fmt(c.att);
  }
  function tsv(model, name) {
    var lines = [];
    var clean = function (s) { return String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' '); };
    if (name) lines.push(clean(name) + ' — maths marks by learning objective');
    var head = ['Level', 'Objective', 'Learning objective'];
    model.cols.forEach(function (c) { head.push(clean(c.ws) + (c.at ? ' (' + dateText(c.at) + ')' : '')); });
    head.push('Total', '%', 'Trend');
    lines.push(head.join('\t'));
    var rowLine = function (lv, code, text, cells, r) {
      var out = [clean(lv), clean(code), clean(text)];
      cells.forEach(function (c) { out.push(cellWords(c)); });
      out.push(r.att > 0 ? fmt(r.got) + '/' + fmt(r.att) : '', r.pct === null ? '' : String(r.pct), r.trend || '');
      lines.push(out.join('\t'));
    };
    model.groups.forEach(function (g) {
      rowLine(g.level, '', (g.sub ? g.sub + ' · ' : '') + g.topic, g.cells, g);
      g.rows.forEach(function (r) { rowLine(r.level, r.id, r.text, r.cells, r); });
    });
    var foot = ['', '', 'Paper (these objectives)'];
    model.cols.forEach(function (c) { foot.push(c.att > 0 ? fmt(c.got) + '/' + fmt(c.att) : ''); });
    foot.push(model.total.att > 0 ? fmt(model.total.got) + '/' + fmt(model.total.att) : '', model.total.pct === null ? '' : String(model.total.pct), '');
    lines.push(foot.join('\t'));
    return lines.join('\n');
  }

  /* ---- DRAWING ---- */
  var TREND_WORDS = { up: '▲', down: '▼', steady: '▬', 'new': '•', '': '' };
  var TREND_TITLES = {
    up: 'Getting better: the newer papers score higher than the older ones',
    down: 'Slipping: the newer papers score lower than the older ones',
    steady: 'About the same on the older and newer papers',
    'new': 'Only one paper so far',
    '': 'Not attempted yet'
  };
  function make(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function cellNode(doc, c, col, row, onPick, isGroup) {
    var td = make(doc, 'td', 'lmCell' + (isGroup ? ' lmGrpCell' : ''));
    if (!c) { td.classList.add('lmEmpty'); return td; }
    var p = pct(c.got, c.att);
    if (c.att > 0) {
      td.textContent = fmt(c.got) + '/' + fmt(c.att);
      td.classList.add('lm-' + band(p));
    } else {
      td.textContent = '–';
      td.classList.add('lm-blank');
    }
    var words = (col ? col.ws + (col.at ? ' · ' + dateText(col.at) : '') + '\n' : '') +
      (row ? (row.id ? row.id + ' ' : '') + row.text + '\n' : '') +
      (c.att > 0 ? fmt(c.got) + ' of ' + fmt(c.att) + ' marks on what was attempted (' + p + '%)' : 'Left blank') +
      (c.tot > c.att ? ' · ' + fmt(c.tot - c.att) + ' mark' + (c.tot - c.att === 1 ? '' : 's') + ' left blank' : '') +
      (c.qs && c.qs.length ? '\n' + qsText(c.qs) : '');
    td.title = words;
    td.tabIndex = 0;
    td.setAttribute('role', 'button');
    td.addEventListener('click', function () { onPick(words); });
    td.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(words); } });
    return td;
  }
  function sumCells(doc, tr, r) {
    var tot = make(doc, 'td', 'lmSum', r.att > 0 ? fmt(r.got) + '/' + fmt(r.att) : (r.tot > 0 ? '–' : ''));
    tr.appendChild(tot);
    var p = make(doc, 'td', 'lmPct', r.pct === null ? '' : r.pct + '%');
    if (r.pct !== null) p.classList.add('lm-' + band(r.pct));
    tr.appendChild(p);
    var t = make(doc, 'td', 'lmTrend lmT-' + (r.trend || 'none'), TREND_WORDS[r.trend || '']);
    t.title = TREND_TITLES[r.trend || ''];
    tr.appendChild(t);
  }
  function tableNode(doc, model, onPick) {
    var wrap = make(doc, 'div', 'lmScroll');
    var table = make(doc, 'table', 'lmTable');
    var thead = make(doc, 'thead');
    var hr = make(doc, 'tr');
    var corner = make(doc, 'th', 'lmCorner lmObjH', 'Learning objective');
    hr.appendChild(corner);
    model.cols.forEach(function (c, i) {
      var th = make(doc, 'th', 'lmColH');
      th.title = c.ws + (c.at ? ' · marked ' + dateText(c.at) : '') +
        (c.att > 0 ? ' · ' + fmt(c.got) + '/' + fmt(c.att) + ' on these objectives' : '');
      th.appendChild(make(doc, 'span', 'lmColNo', String(i + 1)));
      th.appendChild(make(doc, 'span', 'lmColName', str(c.ws, 26)));
      th.appendChild(make(doc, 'span', 'lmColDate', dateText(c.at)));
      hr.appendChild(th);
    });
    hr.appendChild(make(doc, 'th', 'lmSumH', 'Total'));
    hr.appendChild(make(doc, 'th', 'lmSumH', '%'));
    var th3 = make(doc, 'th', 'lmSumH', '↗');
    th3.title = 'Trend: the newer half of the papers against the older half';
    hr.appendChild(th3);
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = make(doc, 'tbody');
    var objRow = function (r, showTopic) {
      var tr = make(doc, 'tr', 'lmRow lmK-' + r.kind + (r.papers ? '' : ' lmUntested'));
      var th = make(doc, 'th', 'lmObj');
      th.scope = 'row';
      if (r.id) th.appendChild(make(doc, 'span', 'lmCode', r.id));
      th.appendChild(make(doc, 'span', 'lmText', r.text));
      if (showTopic && r.topic) th.appendChild(make(doc, 'span', 'lmTopicTag', (r.level ? r.level + ' ' : '') + r.topic));
      th.title = (r.id ? r.id + ' — ' : '') + r.text + (r.topic ? '\n' + (r.level ? r.level + ' · ' : '') + (r.sub ? r.sub + ' · ' : '') + r.topic : '');
      tr.appendChild(th);
      r.cells.forEach(function (c, ci) { tr.appendChild(cellNode(doc, c, model.cols[ci], r, onPick, false)); });
      sumCells(doc, tr, r);
      return tr;
    };
    if (model.sort === 'weak' && model.flat) {
      model.flat.forEach(function (r) { tbody.appendChild(objRow(r, true)); });
    } else {
      model.groups.forEach(function (g) {
        var gr = make(doc, 'tr', 'lmGroup');
        var gh = make(doc, 'th', 'lmObj lmGroupH');
        gh.scope = 'rowgroup';
        gh.appendChild(make(doc, 'span', 'lmGroupLv', g.level || '—'));
        gh.appendChild(make(doc, 'span', 'lmGroupName', (g.sub && g.sub !== g.topic ? g.sub + ' · ' : '') + g.topic));
        gr.appendChild(gh);
        g.cells.forEach(function (c, ci) {
          gr.appendChild(cellNode(doc, c, model.cols[ci], { id: '', text: g.topic }, onPick, true));
        });
        sumCells(doc, gr, g);
        tbody.appendChild(gr);
        g.rows.forEach(function (r) { tbody.appendChild(objRow(r, false)); });
      });
    }
    table.appendChild(tbody);
    var tfoot = make(doc, 'tfoot');
    var fr = make(doc, 'tr', 'lmFoot');
    fr.appendChild(make(doc, 'th', 'lmObj lmFootH', 'Paper, on these objectives'));
    model.cols.forEach(function (c) {
      var td = make(doc, 'td', 'lmCell lmFootCell', c.att > 0 ? fmt(c.got) + '/' + fmt(c.att) : '–');
      if (c.att > 0) td.classList.add('lm-' + band(c.pct));
      td.title = c.ws + (c.pct === null ? '' : ' · ' + c.pct + '%');
      fr.appendChild(td);
    });
    sumCells(doc, fr, { got: model.total.got, att: model.total.att, tot: model.total.tot, pct: model.total.pct,
                        trend: trendOf(model.cols) });
    tfoot.appendChild(fr);
    table.appendChild(tfoot);
    wrap.appendChild(table);
    return wrap;
  }

  /* mount(host, { sheets, name, doc, copy }) draws the controls and the
     table into `host`, and returns { update(sheets, name) }. Its own
     state (level, sort, untested) survives an update, so a live re-read
     of the roster row does not throw the teacher's filter away. */
  function mount(host, opts) {
    opts = opts || {};
    var doc = opts.doc || (host && host.ownerDocument) || (root && root.document);
    var state = { sheets: opts.sheets || [], name: opts.name || '', level: '', sort: 'syllabus', untested: false };
    function pickDefaultLevel() {
      var lv = levelsIn(state.sheets);
      if (state.level && (state.level === 'all' || lv.indexOf(state.level) >= 0)) return;
      state.level = lv.length === 1 ? lv[0] : 'all';
    }
    function copyText(text) {
      if (typeof opts.copy === 'function') return opts.copy(text);
      try {
        if (root && root.navigator && root.navigator.clipboard) return root.navigator.clipboard.writeText(text);
      } catch (e) { /* falls through */ }
      return null;
    }
    function draw() {
      host.innerHTML = '';
      pickDefaultLevel();
      if (!state.sheets.length) {
        host.appendChild(make(doc, 'div', 'lmEmptyNote', opts.emptyText ||
          'No maths worksheet has been marked by objective yet. The table fills in after the next maths worksheet is marked in Study Buddy.'));
        return;
      }
      var model = matrix(state.sheets, { level: state.level, untested: state.untested, sort: state.sort });
      var bar = make(doc, 'div', 'lmBar');
      var chips = make(doc, 'div', 'lmChips');
      ['all'].concat(model.levels).forEach(function (lv) {
        var b = make(doc, 'button', 'lmChip' + (state.level === lv ? ' on' : ''), lv === 'all' ? 'All levels' : lv);
        b.type = 'button';
        b.setAttribute('aria-pressed', state.level === lv ? 'true' : 'false');
        b.addEventListener('click', function () { state.level = lv; draw(); });
        chips.appendChild(b);
      });
      bar.appendChild(chips);
      var sortSel = make(doc, 'select', 'lmSelect');
      sortSel.setAttribute('aria-label', 'Order the objectives');
      [['syllabus', 'Syllabus order'], ['weak', 'Weakest first']].forEach(function (o) {
        var op = make(doc, 'option', null, o[1]);
        op.value = o[0];
        if (state.sort === o[0]) op.selected = true;
        sortSel.appendChild(op);
      });
      sortSel.addEventListener('change', function () { state.sort = sortSel.value; draw(); });
      bar.appendChild(sortSel);
      var lab = make(doc, 'label', 'lmCheck');
      var cb = make(doc, 'input');
      cb.type = 'checkbox';
      cb.checked = !!state.untested;
      cb.addEventListener('change', function () { state.untested = cb.checked; draw(); });
      lab.appendChild(cb);
      lab.appendChild(make(doc, 'span', null, 'Show objectives not tested yet'));
      bar.appendChild(lab);
      var copy = make(doc, 'button', 'lmCopy', '📋 Copy table');
      copy.type = 'button';
      copy.title = 'Copy the table, tab-separated, to paste into a spreadsheet';
      copy.addEventListener('click', function () {
        var p = copyText(tsv(model, state.name));
        var done = function () { copy.textContent = '✓ Copied'; setTimeout(function () { copy.textContent = '📋 Copy table'; }, 1600); };
        if (p && typeof p.then === 'function') p.then(done, function () { copy.textContent = 'Could not copy'; });
        else done();
      });
      bar.appendChild(copy);
      host.appendChild(bar);
      var sum = make(doc, 'div', 'lmSummary');
      var lvWord = model.level === 'all' ? '' : model.level + ' ';
      sum.textContent = model.cols.length + ' worksheet' + (model.cols.length === 1 ? '' : 's') + ' · ' +
        model.tested + ' of ' + model.syllabusCount + ' ' + lvWord + 'objectives tested · ' +
        (model.total.att > 0 ? fmt(model.total.got) + '/' + fmt(model.total.att) + ' marks (' + model.total.pct + '%) on what was attempted' : 'nothing attempted yet') +
        (model.weak.length ? ' · under ' + HI_PCT + '%: ' + model.weak.length + ' objective' + (model.weak.length === 1 ? '' : 's') : '');
      host.appendChild(sum);
      if (model.weak.length) {
        var wk = make(doc, 'div', 'lmWeak');
        wk.appendChild(make(doc, 'b', null, 'Weakest: '));
        model.weak.slice(0, 5).forEach(function (r, i) {
          if (i) wk.appendChild(doc.createTextNode(' · '));
          var s = make(doc, 'span', 'lmWeakItem lm-' + band(r.pct), r.id + ' ' + str(r.text, 48) + ' (' + r.pct + '%)');
          s.title = r.id + ' — ' + r.text;
          wk.appendChild(s);
        });
        host.appendChild(wk);
      }
      if (!model.rows.length) {
        host.appendChild(make(doc, 'div', 'lmEmptyNote', 'Nothing at this level yet.'));
        return;
      }
      var detail = make(doc, 'div', 'lmDetail', 'Tap a cell to see the questions behind it.');
      detail.setAttribute('aria-live', 'polite');
      host.appendChild(tableNode(doc, model, function (words) { detail.textContent = words; detail.classList.add('on'); }));
      host.appendChild(detail);
      var legend = make(doc, 'div', 'lmLegend');
      legend.appendChild(make(doc, 'span', null, 'Each cell: marks got / marks attempted on that objective in that paper.'));
      [['hi', HI_PCT + '% or more'], ['mid', MID_PCT + '–' + (HI_PCT - 1) + '%'], ['lo', 'under ' + MID_PCT + '%'], ['blank', '– left blank']].forEach(function (b) {
        legend.appendChild(make(doc, 'span', 'lmKey lm-' + b[0], b[1]));
      });
      legend.appendChild(make(doc, 'span', null, '▲ better · ▬ same · ▼ slipping (newer papers against older).'));
      host.appendChild(legend);
    }
    draw();
    return {
      update: function (sheets, name) {
        state.sheets = sheets || [];
        if (name != null) state.name = name;
        draw();
      },
      state: state
    };
  }

  return {
    VERSION: VERSION,
    SHEETS_MAX: SHEETS_MAX,
    ROWS_MAX: ROWS_MAX,
    QS_MAX: QS_MAX,
    UNLISTED: UNLISTED,
    MATH_TREE: MATH_TREE,
    catalogue: catalogue,
    entries: entries,
    objective: objective,
    topicOf: topicOf,
    fmt: fmt,
    pct: pct,
    band: band,
    levelNum: levelNum,
    encodeQs: encodeQs,
    decodeQs: decodeQs,
    qsText: qsText,
    sheetEntry: sheetEntry,
    cleanEntry: cleanEntry,
    sheetsOf: sheetsOf,
    pruneIds: pruneIds,
    count: count,
    levelsIn: levelsIn,
    matrix: matrix,
    tsv: tsv,
    tableNode: tableNode,
    mount: mount
  };
});
