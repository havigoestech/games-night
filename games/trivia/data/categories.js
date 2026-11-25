// "Same Letter" content: a category + a random letter, and players race to name
// as many things as they can that start with that letter. All family-friendly.
// Validity is "starts with the letter" (lenient — we trust players); scoring is
// by uniqueness, so obscure-but-valid answers win.
module.exports = {
  CATEGORIES: [
    'Animals',
    'Foods',
    'Fruits & Vegetables',
    'Countries',
    'Cities',
    'Movies',
    'TV Shows',
    'Famous People',
    "Boys' Names",
    "Girls' Names",
    'Things in a Kitchen',
    'Things in a Bathroom',
    'Sports',
    'Jobs & Professions',
    'Parts of the Body',
    'Clothing',
    'Colours',
    'Things in Nature',
    'School Subjects',
    'Musical Instruments',
    'Things at the Beach',
    'Car Brands',
    'Board Games',
    'Superheroes',
    'Things That Are Cold',
    'Things That Are Round',
    'Drinks',
    'Desserts',
    'Things in Space',
    'Hobbies',
    'Things to Pack for Holiday',
    'Breakfast Foods',
    'Types of Weather',
    'Things with Wheels',
    'Pizza Toppings',
    'Cartoon Characters',
    'Things in a Garden',
    'Reasons to Be Late',
    'Things in a Classroom',
    'Birthday Party Things'
  ],
  // Letters players can be given — common/fun ones, skipping the near-impossible.
  LETTERS: 'ABCDEFGHIKLMNOPRSTW'.split('')
};
