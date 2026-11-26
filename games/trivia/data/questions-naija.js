// Hand-written trivia: "Naija & Black Culture" — Nigerian + broader African and
// Black-diaspora general knowledge (music, film, history, geography, sport,
// icons). Deliberately broad and well-known — things a Nigerian or anyone into
// Black culture would recognise — not niche. Merged into the main bank via
// questions-all.js. Shape matches questions-mc.js: { q, correct, wrong:[3], cat, diff, clean }.
const CAT = 'Naija & Black Culture';
module.exports = { QUESTIONS: [
  // ── Afrobeats & Nigerian music ──
  { q: 'Which Nigerian star won a Grammy for the album "Twice as Tall"?', correct: 'Burna Boy', wrong: ['Wizkid', 'Davido', 'Rema'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Fela Kuti is celebrated as the pioneer of which music genre?', correct: 'Afrobeat', wrong: ['Highlife', 'Juju', 'Fuji'], cat: CAT, diff: 'medium', clean: true },
  { q: 'The global hit "Essence" featured Wizkid and which other Nigerian singer?', correct: 'Tems', wrong: ['Tiwa Savage', 'Yemi Alade', 'Simi'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Which Nigerian artist released the worldwide smash "Calm Down"?', correct: 'Rema', wrong: ['Omah Lay', 'Ruger', 'Fireboy DML'], cat: CAT, diff: 'easy', clean: true },
  { q: '"Ojuelegba" and "Essence" are hits by which Afrobeats star nicknamed "Starboy"?', correct: 'Wizkid', wrong: ['Davido', 'Burna Boy', 'Mr Eazi'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Which artist completes Afrobeats’ "Big 3" alongside Wizkid and Davido?', correct: 'Burna Boy', wrong: ['Asake', 'Ayra Starr', 'CKay'], cat: CAT, diff: 'easy', clean: true },
  { q: 'The music duo of twin brothers Peter and Paul Okoye is known as?', correct: 'P-Square', wrong: ['Bracket', 'Styl-Plus', 'Psquare Jr'], cat: CAT, diff: 'medium', clean: true },
  { q: '2Baba (Tuface Idibia) first rose to fame with which classic hit?', correct: 'African Queen', wrong: ['Oliver Twist', 'Yori Yori', 'Johnny'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Which producer and label boss founded Mavin Records?', correct: 'Don Jazzy', wrong: ['Sarz', 'Pheelz', 'Masterkraft'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Davido’s record label is known by which initials?', correct: 'DMW', wrong: ['YBNL', 'Mavin', 'EME'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Afrobeats singer behind the hit "Johnny", often called "Mama Africa"?', correct: 'Yemi Alade', wrong: ['Tiwa Savage', 'Niniola', 'Simi'], cat: CAT, diff: 'hard', clean: true },
  { q: 'Asake rose to stardom signed to which Nigerian record label?', correct: 'YBNL', wrong: ['Mavin', 'DMW', 'Starboy'], cat: CAT, diff: 'hard', clean: true },

  // ── Nollywood ──
  { q: 'Nollywood is the film industry of which country?', correct: 'Nigeria', wrong: ['Ghana', 'Kenya', 'South Africa'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Nollywood is the world’s second-largest film industry by which measure?', correct: 'Number of films produced', wrong: ['Box-office revenue', 'Number of cinemas', 'Average budget'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Which actress directed "Lionheart", Netflix’s first original film from Nigeria?', correct: 'Genevieve Nnaji', wrong: ['Funke Akindele', 'Omotola Jalade', 'Rita Dominic'], cat: CAT, diff: 'hard', clean: true },
  { q: 'The 1992 film widely credited with sparking the Nollywood boom is?', correct: 'Living in Bondage', wrong: ['Osuofia in London', 'The Wedding Party', 'King of Boys'], cat: CAT, diff: 'hard', clean: true },
  { q: 'Funke Akindele is best known for playing which comedic character?', correct: 'Jenifa', wrong: ['Omalicha', 'Patience', 'Toyin'], cat: CAT, diff: 'medium', clean: true },

  // ── Nigeria: history, geography, letters ──
  { q: 'Nigeria gained independence from Britain in which year?', correct: '1960', wrong: ['1957', '1963', '1947'], cat: CAT, diff: 'easy', clean: true },
  { q: 'What is the capital city of Nigeria?', correct: 'Abuja', wrong: ['Lagos', 'Kano', 'Ibadan'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Which is Nigeria’s largest city and main commercial hub?', correct: 'Lagos', wrong: ['Abuja', 'Port Harcourt', 'Enugu'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Nnamdi Azikiwe is remembered as Nigeria’s first what?', correct: 'President', wrong: ['Prime Minister', 'Vice President', 'Military ruler'], cat: CAT, diff: 'medium', clean: true },
  { q: 'What is Nigeria’s official currency?', correct: 'Naira', wrong: ['Cedi', 'Shilling', 'Rand'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Nigeria is the most populous country on which continent?', correct: 'Africa', wrong: ['Asia', 'South America', 'Europe'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Which is one of Nigeria’s three major languages, alongside Hausa and Igbo?', correct: 'Yoruba', wrong: ['Swahili', 'Zulu', 'Amharic'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Author Chinua Achebe wrote which celebrated Nigerian novel?', correct: 'Things Fall Apart', wrong: ['Americanah', 'The Famished Road', 'Purple Hibiscus'], cat: CAT, diff: 'medium', clean: true },
  { q: 'In 1986 Wole Soyinka became the first African to win which prize?', correct: 'Nobel Prize in Literature', wrong: ['Booker Prize', 'Pulitzer Prize', 'Nobel Peace Prize'], cat: CAT, diff: 'hard', clean: true },
  { q: 'Who wrote the novels "Half of a Yellow Sun" and "Americanah"?', correct: 'Chimamanda Ngozi Adichie', wrong: ['Buchi Emecheta', 'Ben Okri', 'Sefi Atta'], cat: CAT, diff: 'medium', clean: true },

  // ── Africa: leaders & geography ──
  { q: 'Who became South Africa’s first Black president in 1994?', correct: 'Nelson Mandela', wrong: ['Desmond Tutu', 'Jacob Zuma', 'Thabo Mbeki'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Kwame Nkrumah led which country to independence in 1957?', correct: 'Ghana', wrong: ['Nigeria', 'Kenya', 'Senegal'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Ghanaian diplomat Kofi Annan served as head of which organisation?', correct: 'The United Nations', wrong: ['The African Union', 'NATO', 'The World Bank'], cat: CAT, diff: 'medium', clean: true },
  { q: 'What is the capital of Kenya?', correct: 'Nairobi', wrong: ['Mombasa', 'Kampala', 'Dar es Salaam'], cat: CAT, diff: 'easy', clean: true },
  { q: 'The highest mountain in Africa is?', correct: 'Mount Kilimanjaro', wrong: ['Mount Kenya', 'Table Mountain', 'Mount Cameroon'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Which is the longest river in Africa?', correct: 'The Nile', wrong: ['The Congo', 'The Niger', 'The Zambezi'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Roughly how many countries are there in Africa?', correct: '54', wrong: ['44', '64', '48'], cat: CAT, diff: 'medium', clean: true },
  { q: 'What is the capital of Ghana?', correct: 'Accra', wrong: ['Kumasi', 'Abidjan', 'Lagos'], cat: CAT, diff: 'easy', clean: true },
  { q: 'The ancient pyramids of Giza are found in which country?', correct: 'Egypt', wrong: ['Sudan', 'Libya', 'Ethiopia'], cat: CAT, diff: 'easy', clean: true },

  // ── Black icons across the world ──
  { q: 'Who was elected the first Black president of the United States?', correct: 'Barack Obama', wrong: ['Jesse Jackson', 'Colin Powell', 'Al Sharpton'], cat: CAT, diff: 'easy', clean: true },
  { q: '"I Have a Dream" was a famous 1963 speech by whom?', correct: 'Martin Luther King Jr.', wrong: ['Malcolm X', 'Frederick Douglass', 'W.E.B. Du Bois'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Which boxer called himself "The Greatest" and lit the 1996 Olympic flame?', correct: 'Muhammad Ali', wrong: ['Mike Tyson', 'Joe Frazier', 'George Foreman'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Which Jamaican sprinter is widely regarded as the fastest man ever?', correct: 'Usain Bolt', wrong: ['Yohan Blake', 'Carl Lewis', 'Tyson Gay'], cat: CAT, diff: 'easy', clean: true },
  { q: 'The "Queen of Soul", famed for the song "Respect", was?', correct: 'Aretha Franklin', wrong: ['Whitney Houston', 'Diana Ross', 'Tina Turner'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Reggae legend who recorded "No Woman, No Cry" and "Redemption Song"?', correct: 'Bob Marley', wrong: ['Peter Tosh', 'Jimmy Cliff', 'Burning Spear'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Who refused to give up her bus seat in Montgomery in 1955?', correct: 'Rosa Parks', wrong: ['Harriet Tubman', 'Angela Davis', 'Coretta Scott King'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Singer and business mogul Rihanna hails from which Caribbean nation?', correct: 'Barbados', wrong: ['Jamaica', 'Trinidad & Tobago', 'The Bahamas'], cat: CAT, diff: 'medium', clean: true },

  // ── Football ──
  { q: 'Nigeria’s national football team is nicknamed the?', correct: 'Super Eagles', wrong: ['Black Stars', 'Indomitable Lions', 'Pharaohs'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Nigeria won Olympic football gold at which 1996 Games?', correct: 'Atlanta', wrong: ['Sydney', 'Barcelona', 'Athens'], cat: CAT, diff: 'hard', clean: true },
  { q: 'Flamboyant Nigerian midfielder "so good they named him twice"?', correct: 'Jay-Jay Okocha', wrong: ['Rashidi Yekini', 'Finidi George', 'Sunday Oliseh'], cat: CAT, diff: 'medium', clean: true },
  { q: 'George Weah, the only African to win the Ballon d’Or, later became president of?', correct: 'Liberia', wrong: ['Ghana', 'Ivory Coast', 'Senegal'], cat: CAT, diff: 'hard', clean: true },
  { q: 'Egyptian forward and Liverpool star nicknamed the "Egyptian King"?', correct: 'Mohamed Salah', wrong: ['Sadio Mané', 'Riyad Mahrez', 'Victor Osimhen'], cat: CAT, diff: 'easy', clean: true },
  { q: 'Chelsea legend and striker Didier Drogba played for which national team?', correct: 'Ivory Coast', wrong: ['Ghana', 'Nigeria', 'Senegal'], cat: CAT, diff: 'medium', clean: true },
  { q: 'Which Nigerian striker won the 2023 Serie A top-scorer award with Napoli?', correct: 'Victor Osimhen', wrong: ['Kelechi Iheanacho', 'Ademola Lookman', 'Odion Ighalo'], cat: CAT, diff: 'hard', clean: true }
] };
