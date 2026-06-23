const QRCode = require('qrcode');

const TEAM_COLORS = [
  '#FF2D55', '#5856D6', '#FF9500', '#34C759',
  '#00C7BE', '#FF375F', '#BF5AF2', '#FFD60A'
];
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const QUESTIONS = [
  {
    q: 'Name something people do first thing in the morning',
    a: [
      { t: 'Check their phone', p: 62 },
      { t: 'Make tea or coffee', p: 55 },
      { t: 'Use the bathroom', p: 48 },
      { t: 'Have a shower', p: 42 },
      { t: 'Eat breakfast', p: 35 },
      { t: 'Snooze the alarm', p: 28 }
    ]
  },
  {
    q: 'Name something you always run out of at home',
    a: [
      { t: 'Milk', p: 72 },
      { t: 'Toilet roll', p: 65 },
      { t: 'Bread', p: 55 },
      { t: 'Coffee', p: 48 },
      { t: 'Sugar', p: 35 },
      { t: 'Bin bags', p: 25 }
    ]
  },
  {
    q: 'Name something you find in every British home',
    a: [
      { t: 'A kettle', p: 92 },
      { t: 'A TV', p: 85 },
      { t: 'Biscuits', p: 78 },
      { t: 'A pile of laundry', p: 65 },
      { t: 'A junk drawer', p: 52 },
      { t: 'A confused smoke alarm', p: 38 }
    ]
  },
  {
    q: 'Name a reason couples argue',
    a: [
      { t: 'Money', p: 68 },
      { t: 'Housework', p: 62 },
      { t: 'The TV remote', p: 55 },
      { t: 'Where to eat', p: 48 },
      { t: 'Time with family', p: 38 },
      { t: 'Snoring', p: 30 }
    ]
  },
  {
    q: 'Name something you find at a British BBQ',
    a: [
      { t: 'Burnt sausages', p: 75 },
      { t: 'Burgers', p: 68 },
      { t: 'Beer', p: 62 },
      { t: 'Rain', p: 58 },
      { t: 'Potato salad', p: 38 },
      { t: 'Paper plates', p: 28 }
    ]
  },
  {
    q: 'Name a reason a flight gets delayed',
    a: [
      { t: 'Bad weather', p: 72 },
      { t: 'Technical issues', p: 65 },
      { t: 'Late crew', p: 55 },
      { t: 'Air traffic control', p: 48 },
      { t: 'Missing passengers', p: 38 },
      { t: 'Baggage issues', p: 28 }
    ]
  },
  {
    q: 'Name something found in a junk drawer',
    a: [
      { t: 'Old batteries', p: 72 },
      { t: 'Takeaway menus', p: 65 },
      { t: 'Old cables', p: 58 },
      { t: 'Coins', p: 52 },
      { t: 'Old pens', p: 42 },
      { t: 'Mystery keys', p: 35 }
    ]
  },
  {
    q: 'Name a topping people put on pizza',
    a: [
      { t: 'Cheese', p: 85 },
      { t: 'Pepperoni', p: 78 },
      { t: 'Mushrooms', p: 65 },
      { t: 'Sweetcorn', p: 52 },
      { t: 'Ham', p: 48 },
      { t: 'Pineapple', p: 38 }
    ]
  },
  {
    q: "Name something people do when they can't sleep",
    a: [
      { t: 'Check their phone', p: 72 },
      { t: 'Watch TV', p: 65 },
      { t: 'Read', p: 55 },
      { t: 'Go to the kitchen', p: 48 },
      { t: 'Count sheep', p: 38 },
      { t: 'Pace the room', p: 22 }
    ]
  },
  {
    q: 'Name something Brits complain about',
    a: [
      { t: 'The weather', p: 88 },
      { t: 'The government', p: 78 },
      { t: 'Train delays', p: 72 },
      { t: 'Queue jumpers', p: 62 },
      { t: 'NHS waiting times', p: 52 },
      { t: 'Rising prices', p: 45 }
    ]
  },
  {
    q: 'Name something people put off doing',
    a: [
      { t: 'Calling the dentist', p: 72 },
      { t: 'Doing the washing up', p: 65 },
      { t: 'Replying to messages', p: 58 },
      { t: 'Sorting finances', p: 52 },
      { t: 'Cleaning the bathroom', p: 45 },
      { t: 'Going to the doctor', p: 38 }
    ]
  },
  {
    q: 'Name something you would find at a music festival',
    a: [
      { t: 'Mud', p: 88 },
      { t: 'Overpriced food', p: 78 },
      { t: 'Portaloos', p: 72 },
      { t: 'Bad guitar playing', p: 55 },
      { t: 'A lost tent', p: 45 },
      { t: 'Wellies', p: 38 }
    ]
  },
  {
    q: 'Name something students live on',
    a: [
      { t: 'Pasta', p: 85 },
      { t: 'Toast', p: 78 },
      { t: 'Pot Noodle', p: 72 },
      { t: 'Pizza', p: 62 },
      { t: 'Beans on toast', p: 55 },
      { t: 'Cereal', p: 38 }
    ]
  },
  {
    q: 'Name something you would do if you won the lottery',
    a: [
      { t: 'Pay off the mortgage', p: 82 },
      { t: 'Quit your job', p: 78 },
      { t: 'Travel the world', p: 72 },
      { t: 'Buy a car', p: 55 },
      { t: 'Give to family', p: 48 },
      { t: 'Buy a big house', p: 42 }
    ]
  },
  {
    q: 'Name something people do immediately after a night out',
    a: [
      { t: 'Eat something unhealthy', p: 78 },
      { t: 'Order a takeaway', p: 72 },
      { t: 'Check what they texted', p: 65 },
      { t: 'Drink a pint of water', p: 52 },
      { t: 'Take their shoes off', p: 45 },
      { t: 'Pass out on the sofa', p: 35 }
    ]
  },
  {
    q: 'Name something British people do as soon as the sun comes out',
    a: [
      { t: 'Go to the beer garden', p: 82 },
      { t: 'Have a BBQ', p: 78 },
      { t: 'Wear shorts immediately', p: 72 },
      { t: "Complain it's too hot", p: 62 },
      { t: 'Fall asleep in the garden', p: 48 },
      { t: 'Get sunburned', p: 38 }
    ]
  },
  {
    q: 'Name something a football fan shouts at the referee',
    a: [
      { t: 'That was a foul!', p: 78 },
      { t: 'Off! Off! Off!', p: 72 },
      { t: 'Are you blind?!', p: 68 },
      { t: "You're useless!", p: 55 },
      { t: "That's a penalty!", p: 48 },
      { t: 'Cheating!', p: 35 }
    ]
  },
  {
    q: 'Name something an estate agent says that is always a lie',
    a: [
      { t: 'Full of potential', p: 78 },
      { t: 'Cosy', p: 72 },
      { t: 'Sought-after area', p: 65 },
      { t: 'Great transport links', p: 58 },
      { t: 'Easy to maintain', p: 45 },
      { t: 'Ideal for first-time buyers', p: 32 }
    ]
  },
  {
    q: 'Name a reason someone calls in sick to work',
    a: [
      { t: 'Hangover', p: 65 },
      { t: "Just couldn't face it", p: 58 },
      { t: 'Mental health day', p: 52 },
      { t: 'Mild illness exaggerated', p: 48 },
      { t: 'Family issue', p: 42 },
      { t: 'Weather was too bad', p: 28 }
    ]
  },
  {
    q: 'Name something people say they are going to do this year',
    a: [
      { t: 'Get fit', p: 82 },
      { t: 'Save money', p: 75 },
      { t: 'Learn a language', p: 68 },
      { t: 'Read more books', p: 55 },
      { t: 'Travel somewhere new', p: 48 },
      { t: 'Eat healthier', p: 42 }
    ]
  },
  {
    q: 'Name an excuse for not going to the gym',
    a: [
      { t: 'Too tired', p: 75 },
      { t: 'Too busy', p: 68 },
      { t: 'My knee hurts', p: 55 },
      { t: "It's raining", p: 48 },
      { t: "I'll start Monday", p: 42 },
      { t: "I'll go tomorrow", p: 35 }
    ]
  },
  {
    q: 'Name something people sneak into the cinema',
    a: [
      { t: 'Sweets or Haribo', p: 78 },
      { t: 'Crisps', p: 72 },
      { t: 'Popcorn from home', p: 62 },
      { t: 'Chocolate', p: 55 },
      { t: 'A flask', p: 38 },
      { t: 'A full meal', p: 25 }
    ]
  },
  {
    q: 'Name something dogs do that embarrass their owners',
    a: [
      { t: 'Jump on strangers', p: 72 },
      { t: 'Go for other dogs', p: 65 },
      { t: 'Roll in something disgusting', p: 58 },
      { t: 'Hump the furniture', p: 52 },
      { t: 'Bark uncontrollably', p: 45 },
      { t: 'Beg for food at the table', p: 35 }
    ]
  },
  {
    q: 'Name something always brought up at Christmas dinner',
    a: [
      { t: 'Old embarrassing stories', p: 72 },
      { t: 'Who is not there', p: 62 },
      { t: 'The divorce or breakup', p: 55 },
      { t: 'Politics', p: 48 },
      { t: 'How much everything cost', p: 42 },
      { t: 'That time someone did something', p: 35 }
    ]
  },
  {
    q: 'Name something people forget when packing for holiday',
    a: [
      { t: 'Phone charger', p: 78 },
      { t: 'Passport', p: 68 },
      { t: 'Toiletries', p: 62 },
      { t: 'Sunscreen', p: 55 },
      { t: 'Medication', p: 45 },
      { t: 'Plug adapter', p: 38 }
    ]
  },
  {
    q: 'Name something you would see in a traffic jam',
    a: [
      { t: 'Frustrated drivers', p: 82 },
      { t: 'People on phones', p: 75 },
      { t: 'Someone eating', p: 62 },
      { t: 'A near-miss', p: 52 },
      { t: 'Someone dancing in their seat', p: 42 },
      { t: 'Roadworks', p: 38 }
    ]
  },
  {
    q: 'Name a popular holiday destination for British people',
    a: [
      { t: 'Spain or Ibiza', p: 85 },
      { t: 'Greece', p: 78 },
      { t: 'Turkey', p: 72 },
      { t: 'Florida or USA', p: 62 },
      { t: 'Benidorm', p: 55 },
      { t: 'France', p: 42 }
    ]
  },
  {
    q: 'Name something you would find in a British pub',
    a: [
      { t: 'Pints of beer', p: 88 },
      { t: 'Old men', p: 72 },
      { t: 'Sticky carpet', p: 65 },
      { t: 'Fruit machine', p: 52 },
      { t: 'Quiz night poster', p: 42 },
      { t: 'Pool table', p: 35 }
    ]
  },
  {
    q: 'Name something people Google at 3am',
    a: [
      { t: 'Health symptoms', p: 78 },
      { t: 'Lyrics to a song', p: 65 },
      { t: 'Random what-if questions', p: 58 },
      { t: 'Their ex', p: 52 },
      { t: 'Whether shops are open', p: 42 },
      { t: 'Unsettling news', p: 32 }
    ]
  },
  {
    q: 'Name something people lie about on their CV',
    a: [
      { t: 'Languages spoken', p: 72 },
      { t: 'IT skills', p: 65 },
      { t: 'Excel knowledge', p: 58 },
      { t: 'Works well under pressure', p: 52 },
      { t: 'Interests and hobbies', p: 42 },
      { t: 'Communication skills', p: 35 }
    ]
  },
  {
    q: 'Name a reason someone moved house',
    a: [
      { t: 'Need more space', p: 75 },
      { t: "Can't afford the area", p: 68 },
      { t: 'New job in a different city', p: 58 },
      { t: 'Better schools nearby', p: 52 },
      { t: 'Relationship breakdown', p: 45 },
      { t: 'Neighbours from hell', p: 38 }
    ]
  },
  {
    q: 'Name something people do to look busy at work',
    a: [
      { t: 'Stare at their screen', p: 78 },
      { t: 'Walk around with papers', p: 68 },
      { t: 'Type loudly', p: 58 },
      { t: 'Have a lot of tabs open', p: 52 },
      { t: 'Always have a coffee in hand', p: 42 },
      { t: 'Nod in meetings', p: 32 }
    ]
  },
  {
    q: 'Name something you would do on a Sunday morning',
    a: [
      { t: 'Lie in', p: 82 },
      { t: 'Have a big breakfast', p: 72 },
      { t: 'Watch TV', p: 62 },
      { t: 'Go for a walk', p: 52 },
      { t: 'Do the food shop', p: 42 },
      { t: 'Read the papers', p: 32 }
    ]
  },
  {
    q: 'Name something people do in a long queue',
    a: [
      { t: 'Go on their phone', p: 85 },
      { t: 'Huff and sigh loudly', p: 72 },
      { t: 'Count people ahead', p: 58 },
      { t: 'Talk to strangers', p: 48 },
      { t: 'Contemplate leaving', p: 38 },
      { t: 'Move to a different queue', p: 28 }
    ]
  },
  {
    q: 'Name something a toddler does that drives parents mad',
    a: [
      { t: 'Tantrums in public', p: 75 },
      { t: 'Refuses to eat food', p: 68 },
      { t: "Won't go to sleep", p: 62 },
      { t: 'Says why endlessly', p: 52 },
      { t: 'Draws on the walls', p: 45 },
      { t: 'Breaks everything', p: 35 }
    ]
  },
  {
    q: 'Name something people buy in January but abandon by February',
    a: [
      { t: 'Gym membership', p: 82 },
      { t: 'Fitness equipment', p: 72 },
      { t: 'Diet books or plans', p: 62 },
      { t: 'A journal', p: 55 },
      { t: 'A blender or juicer', p: 45 },
      { t: 'Language learning app', p: 35 }
    ]
  },
  {
    q: 'Name something annoying about commuting',
    a: [
      { t: 'Delays and cancellations', p: 82 },
      { t: 'Cost', p: 72 },
      { t: 'Overcrowding', p: 65 },
      { t: 'Rude passengers', p: 55 },
      { t: 'Signal failure', p: 45 },
      { t: 'No seats', p: 38 }
    ]
  },
  {
    q: 'Name something people do at a work party they regret',
    a: [
      { t: 'Drink too much', p: 82 },
      { t: 'Dance embarrassingly', p: 68 },
      { t: 'Say something to the boss', p: 58 },
      { t: 'Flirt inappropriately', p: 48 },
      { t: 'Rant about a colleague', p: 38 },
      { t: 'Call in sick next day', p: 28 }
    ]
  },
  {
    q: 'Name something you find in a handbag',
    a: [
      { t: 'Phone', p: 85 },
      { t: 'Purse or wallet', p: 78 },
      { t: 'Lip balm or makeup', p: 68 },
      { t: 'Tissues', p: 52 },
      { t: 'Receipts', p: 42 },
      { t: 'Mysterious items', p: 28 }
    ]
  },
  {
    q: 'Name a reason to open a bottle of wine',
    a: [
      { t: 'End of the working week', p: 82 },
      { t: "It's been a long day", p: 72 },
      { t: 'Good news to celebrate', p: 62 },
      { t: 'Dinner with friends', p: 52 },
      { t: "It's Tuesday", p: 42 },
      { t: 'The bottle was open', p: 28 }
    ]
  },
  {
    q: 'Name something parents dread about the school holidays',
    a: [
      { t: "I'm bored every 5 minutes", p: 78 },
      { t: 'Entertainment costs', p: 68 },
      { t: 'Childcare problems', p: 62 },
      { t: 'Food costs going up', p: 52 },
      { t: 'Sibling arguments', p: 45 },
      { t: 'No routine', p: 35 }
    ]
  },
  {
    q: 'Name something a couple argues about during a road trip',
    a: [
      { t: 'Directions and navigation', p: 72 },
      { t: 'A missed turning', p: 65 },
      { t: 'Music choice', p: 55 },
      { t: 'Temperature in the car', p: 48 },
      { t: 'How often to stop', p: 42 },
      { t: "Who's driving", p: 35 }
    ]
  },
  {
    q: "Name something people say they don't care about but secretly do",
    a: [
      { t: 'How many likes they get', p: 78 },
      { t: 'What their ex is up to', p: 72 },
      { t: 'What people think of them', p: 65 },
      { t: 'Their weight or appearance', p: 55 },
      { t: 'Being right in arguments', p: 45 },
      { t: 'Getting older', p: 38 }
    ]
  },
  {
    q: "Name a job people respect but wouldn't want to do themselves",
    a: [
      { t: 'Surgeon', p: 78 },
      { t: 'Teacher', p: 72 },
      { t: 'Nurse', p: 68 },
      { t: 'Police officer', p: 58 },
      { t: 'Refuse collector', p: 48 },
      { t: 'Politician', p: 28 }
    ]
  },
  {
    q: 'Name something you find in a first aid kit',
    a: [
      { t: 'Plasters', p: 88 },
      { t: 'Paracetamol', p: 78 },
      { t: 'Bandages', p: 65 },
      { t: 'Antiseptic cream', p: 55 },
      { t: 'Scissors', p: 42 },
      { t: 'An out-of-date item', p: 32 }
    ]
  },
  {
    q: "Name something people put in their dating profile that isn't quite true",
    a: [
      { t: 'Their height', p: 78 },
      { t: 'Their age', p: 72 },
      { t: 'Old photos', p: 68 },
      { t: 'Their job title', p: 55 },
      { t: 'Loving the outdoors', p: 45 },
      { t: 'Their personality', p: 35 }
    ]
  },
  {
    q: 'Name something found in a typical break room at work',
    a: [
      { t: 'Kettle and mugs', p: 88 },
      { t: 'Passive-aggressive note', p: 72 },
      { t: 'Microwave', p: 65 },
      { t: "Someone else's old lunch", p: 52 },
      { t: 'Motivational poster', p: 42 },
      { t: 'Broken biscuits', p: 32 }
    ]
  },
  {
    q: 'Name a word people use to describe terrible weather',
    a: [
      { t: 'Rubbish', p: 85 },
      { t: 'Miserable', p: 72 },
      { t: 'Bitter', p: 65 },
      { t: 'Awful', p: 52 },
      { t: 'Grim', p: 42 },
      { t: 'Treacherous', p: 28 }
    ]
  },
  {
    q: 'Name something you would bring to a house party',
    a: [
      { t: 'Wine or beer', p: 88 },
      { t: 'Snacks or dips', p: 75 },
      { t: 'A playlist suggestion', p: 52 },
      { t: 'Flowers', p: 42 },
      { t: 'A game', p: 35 },
      { t: 'The wrong person', p: 25 }
    ]
  },
  {
    q: 'Name something people always forget the name of',
    a: [
      { t: 'That film with that actor', p: 78 },
      { t: "Their colleague's partner", p: 68 },
      { t: 'The name of that song', p: 62 },
      { t: "Their neighbour's name", p: 55 },
      { t: 'The place they visited abroad', p: 45 },
      { t: "Their doctor's name", p: 38 }
    ]
  }
];

const rooms = new Map();

function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getScores(room) {
  return room.teams.map((t, i) => ({ index: i, name: t.name, color: t.color, score: t.score }));
}

module.exports = function registerFamilyFeud(namespace, localIP, port) {

  namespace.on('connection', (socket) => {

    socket.on('create-room', ({ teamCount, teamNames, baseUrl }) => {
      try {
        console.log('[family-feud] create-room from', socket.id);
        const count = Math.min(Math.max(parseInt(teamCount) || 2, 2), 8);
        const teams = Array.from({ length: count }, (_, i) => ({
          name: ((teamNames || [])[i] || `Team ${i + 1}`).trim() || `Team ${i + 1}`,
          color: TEAM_COLORS[i],
          score: 0
        }));

        const roomCode = generateRoomCode();
        const room = {
          roomCode,
          hostSocketId: socket.id,
          teams,
          players: [],
          phase: 'lobby',
          questions: shuffle(QUESTIONS),
          questionIndex: 0,
          currentQuestion: null,
          revealedAnswers: [],
          strikes: 0,
          activeTeamIndex: 0,
          stealTeamIndex: -1,
          buzzLocked: false,
          buzzer: null,
          roundPot: 0
        };

        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.isHost = true;

        // Host might have opened the page on localhost — players on phones
        // can't reach that, so swap localhost/127.0.0.1 for the LAN IP.
        const isLocalhost = baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(baseUrl);
        const playerBaseUrl = (!baseUrl || isLocalhost) ? `http://${localIP}:${port}` : baseUrl;
        const joinUrl = `${playerBaseUrl}/games/family-feud/player.html?room=${roomCode}`;

        console.log('[family-feud] Room created:', roomCode);

        socket.emit('room-created', {
          roomCode, joinUrl, localIP, port, teams: room.teams
        });

        QRCode.toDataURL(joinUrl, { width: 200, margin: 1, color: { dark: '#ffffff', light: '#0a0a18' } })
          .then(qrDataUrl => socket.emit('qr-ready', { qrDataUrl }))
          .catch(e => console.error('[family-feud] QR error:', e.message));

      } catch (err) {
        console.error('[family-feud] create-room error:', err);
        socket.emit('create-room-error', { message: 'Failed to create room: ' + err.message });
      }
    });

    socket.on('check-room', ({ roomCode }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.phase === 'game-over') {
        socket.emit('room-check-result', {
          found: false,
          message: room ? 'This game has ended.' : 'Room not found. Check the code and try again.'
        });
        return;
      }
      socket.emit('room-check-result', {
        found: true,
        teams: room.teams.map(t => ({ name: t.name, color: t.color }))
      });
    });

    socket.on('join-room', ({ roomCode, playerName, teamIndex }) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.phase === 'game-over') {
        socket.emit('join-error', { message: room ? 'This game has ended.' : 'Room not found.' });
        return;
      }
      const name = (playerName || '').trim() || 'Anonymous';
      const idx = parseInt(teamIndex);
      if (isNaN(idx) || idx < 0 || idx >= room.teams.length) {
        socket.emit('join-error', { message: 'Invalid team.' });
        return;
      }
      socket.join(code);
      socket.roomCode = code;
      socket.playerName = name;
      socket.teamIndex = idx;
      socket.isHost = false;
      room.players.push({ socketId: socket.id, name, teamIndex: idx });
      socket.emit('joined', {
        teamIndex: idx,
        teamNames: room.teams.map(t => t.name),
        teamColors: room.teams.map(t => t.color),
        scores: getScores(room),
        phase: room.phase
      });
      namespace.to(room.hostSocketId).emit('player-joined', {
        playerName: name, teamIndex: idx, allPlayers: room.players
      });
    });

    // Host: start next question
    socket.on('start-question', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;

      if (room.questionIndex >= room.questions.length) {
        const scores = getScores(room).sort((a, b) => b.score - a.score);
        namespace.to(room.roomCode).emit('game-over', { scores });
        room.phase = 'game-over';
        return;
      }

      const q = room.questions[room.questionIndex++];
      room.currentQuestion = q;
      room.revealedAnswers = [];
      room.strikes = 0;
      room.buzzLocked = false;
      room.buzzer = null;
      room.roundPot = 0;
      room.stealTeamIndex = -1;
      room.phase = 'buzzers-live';

      const activeTeam = room.teams[room.activeTeamIndex];

      namespace.to(room.roomCode).emit('question-start', {
        question: q.q,
        answerCount: q.a.length,
        round: room.questionIndex,
        activeTeamIndex: room.activeTeamIndex,
        activeTeamName: activeTeam.name,
        activeTeamColor: activeTeam.color,
        scores: getScores(room)
      });

      namespace.to(room.roomCode).emit('buzzers-live', {
        activeTeamIndex: room.activeTeamIndex
      });
    });

    // Host: reveal a specific answer
    socket.on('reveal-answer', ({ answerIndex }) => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      if (room.revealedAnswers.includes(answerIndex)) return;

      const answer = room.currentQuestion.a[answerIndex];
      if (!answer) return;

      room.revealedAnswers.push(answerIndex);
      room.roundPot += answer.p;
      room.buzzLocked = false;

      namespace.to(room.roomCode).emit('answer-revealed', {
        answerIndex,
        text: answer.t,
        pts: answer.p,
        revealedAnswers: [...room.revealedAnswers]
      });

      // If in steal-judging: steal team wins the pot
      if (room.phase === 'steal-judging') {
        const stealTeam = room.teams[room.stealTeamIndex];
        stealTeam.score += room.roundPot;
        const scores = getScores(room);

        namespace.to(room.roomCode).emit('round-complete', {
          scores,
          roundPot: room.roundPot,
          winnerTeamIndex: room.stealTeamIndex,
          winnerTeamName: stealTeam.name,
          winnerTeamColor: stealTeam.color,
          allAnswers: room.currentQuestion.a,
          stealSuccess: true,
          stealFailed: false
        });

        room.activeTeamIndex = (room.activeTeamIndex + 1) % room.teams.length;
        room.phase = 'round-over';
        return;
      }

      // Check if all answers are revealed
      if (room.revealedAnswers.length >= room.currentQuestion.a.length) {
        const activeTeam = room.teams[room.activeTeamIndex];
        activeTeam.score += room.roundPot;
        const scores = getScores(room);

        namespace.to(room.roomCode).emit('round-complete', {
          scores,
          roundPot: room.roundPot,
          winnerTeamIndex: room.activeTeamIndex,
          winnerTeamName: activeTeam.name,
          winnerTeamColor: activeTeam.color,
          allAnswers: room.currentQuestion.a,
          stealSuccess: false,
          stealFailed: false
        });

        room.activeTeamIndex = (room.activeTeamIndex + 1) % room.teams.length;
        room.phase = 'round-over';
        return;
      }

      // Continue playing: open buzzers again
      room.phase = 'buzzers-live';
      namespace.to(room.roomCode).emit('buzzers-live', {
        activeTeamIndex: room.activeTeamIndex
      });
    });

    // Host: mark a wrong answer
    socket.on('host-wrong', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;

      // In steal-judging: active team wins pot (steal failed)
      if (room.phase === 'steal-judging') {
        const activeTeam = room.teams[room.activeTeamIndex];
        activeTeam.score += room.roundPot;
        const scores = getScores(room);

        namespace.to(room.roomCode).emit('round-complete', {
          scores,
          roundPot: room.roundPot,
          winnerTeamIndex: room.activeTeamIndex,
          winnerTeamName: activeTeam.name,
          winnerTeamColor: activeTeam.color,
          allAnswers: room.currentQuestion.a,
          stealSuccess: false,
          stealFailed: true
        });

        room.activeTeamIndex = (room.activeTeamIndex + 1) % room.teams.length;
        room.phase = 'round-over';
        return;
      }

      room.strikes++;
      const stealMode = room.strikes >= 3;

      namespace.to(room.roomCode).emit('wrong-answer', {
        strikes: room.strikes,
        stealMode
      });

      if (stealMode) {
        // Determine steal team (next team after active)
        room.stealTeamIndex = (room.activeTeamIndex + 1) % room.teams.length;
        room.phase = 'steal-live';
        room.buzzLocked = false;
        const stealTeam = room.teams[room.stealTeamIndex];

        namespace.to(room.roomCode).emit('steal-mode', {
          stealTeamIndex: room.stealTeamIndex,
          stealTeamName: stealTeam.name,
          stealTeamColor: stealTeam.color,
          roundPot: room.roundPot
        });
      } else {
        room.phase = 'buzzers-live';
        room.buzzLocked = false;
        namespace.to(room.roomCode).emit('buzzers-live', {
          activeTeamIndex: room.activeTeamIndex
        });
      }
    });

    // Host: end round manually (active team gets all points)
    socket.on('end-round', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;

      const activeTeam = room.teams[room.activeTeamIndex];
      activeTeam.score += room.roundPot;
      const scores = getScores(room);

      namespace.to(room.roomCode).emit('round-complete', {
        scores,
        roundPot: room.roundPot,
        winnerTeamIndex: room.activeTeamIndex,
        winnerTeamName: activeTeam.name,
        winnerTeamColor: activeTeam.color,
        allAnswers: room.currentQuestion.a,
        stealSuccess: false,
        stealFailed: false
      });

      room.activeTeamIndex = (room.activeTeamIndex + 1) % room.teams.length;
      room.phase = 'round-over';
    });

    // Host: end game
    socket.on('end-game', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.isHost) return;
      room.phase = 'game-over';
      const scores = getScores(room).sort((a, b) => b.score - a.score);
      namespace.to(room.roomCode).emit('game-over', { scores });
    });

    // Player: buzz in
    socket.on('buzz', () => {
      const room = rooms.get(socket.roomCode);
      if (!room || room.buzzLocked) return;

      const validActiveBuzz = room.phase === 'buzzers-live' && socket.teamIndex === room.activeTeamIndex;
      const validStealBuzz  = room.phase === 'steal-live'   && socket.teamIndex === room.stealTeamIndex;

      if (!validActiveBuzz && !validStealBuzz) return;

      room.buzzLocked = true;
      room.phase = validStealBuzz ? 'steal-judging' : 'judging';
      room.buzzer = { socketId: socket.id, playerName: socket.playerName, teamIndex: socket.teamIndex };

      const team = room.teams[socket.teamIndex];
      const isSteal = validStealBuzz;

      namespace.to(room.hostSocketId).emit('player-buzzed', {
        playerName: socket.playerName,
        teamIndex: socket.teamIndex,
        teamName: team.name,
        teamColor: team.color,
        isSteal
      });

      socket.emit('you-buzzed-ff', {
        teamName: team.name,
        teamColor: team.color,
        isSteal
      });

      socket.broadcast.to(room.roomCode).emit('someone-buzzed', {
        playerName: socket.playerName,
        teamIndex: socket.teamIndex,
        teamName: team.name,
        teamColor: team.color,
        isSteal
      });
    });

    socket.on('disconnect', () => {
      const roomCode = socket.roomCode;
      if (!roomCode) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      if (socket.isHost) {
        namespace.to(roomCode).emit('host-disconnected', {});
        rooms.delete(roomCode);
      } else {
        room.players = room.players.filter(p => p.socketId !== socket.id);
        if (room.hostSocketId) {
          namespace.to(room.hostSocketId).emit('player-left', {
            playerName: socket.playerName,
            teamIndex: socket.teamIndex,
            allPlayers: room.players
          });
        }
      }
    });
  });
};
