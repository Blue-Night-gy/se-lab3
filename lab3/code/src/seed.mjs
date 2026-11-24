import { addDays, passwordDigest, today } from './model.mjs';

const fixtureHotels = [
  [1, 'H01', '江城酒店', '武汉', '武昌滨江', 'wood-room.jpg'],
  [2, 'H02', '海湾酒店', '厦门', '环岛东路', 'room-city.jpg'],
  [3, 'H03', '溪山酒店', '杭州', '西溪湿地', 'room-river.jpg'],
];
const fixtureTypes = [
  [
    1,
    1,
    'T01',
    '明亮双床房',
    2,
    '两张独立床位、木质长桌与窗边座椅',
    'wood-twin.jpg',
    [26000, 28000, 31000],
    2,
  ],
  [2, 1, 'T02', '滨江大床房', 2, '一张大床，窗边休息区面向城市', 'wood-room.jpg', [35000, 38000, 38000], 5],
  [3, 2, 'T03', '海湾双床房', 2, '双床与沙发休息区，适合结伴入住', 'warm-twin.jpg', [32000, 36000, 36000], 3],
  [4, 2, 'T04', '开阔大床房', 2, '自然光充足，设独立阅读区', 'room-city.jpg', [48000, 51000, 51000], 5],
  [5, 3, 'T05', '溪景大床房', 2, '窗边望向园景，带独立工作台', 'room-river.jpg', [42900, 45900, 47900], 4],
  [6, 3, 'T06', '园景家庭房', 4, '容纳四位住客，设宽敞休息区', 'room-deluxe.jpg', [62000, 66000, 72000], 3],
];

export function seedDemo(db) {
  if (db.get('SELECT COUNT(*) AS n FROM accounts').n) return;
  db.transaction(() => {
    if (db.get('SELECT COUNT(*) AS n FROM accounts').n) return;
    const digest = passwordDigest('bosu-demo');
    const users = [
      [1, 'guest', '叶青', 'guest'],
      [2, 'guest2', '梁暄', 'guest'],
      [3, 'desk', '夏宁', 'staff'],
      [4, 'audit', '江澄', 'staff'],
      [5, 'admin', '顾岚', 'admin'],
    ];
    for (const user of users) {
      db.run('INSERT INTO accounts(id,username,name,role,digest) VALUES(?,?,?,?,?)', ...user, digest);
    }
    for (const record of fixtureHotels) db.run('INSERT INTO hotels VALUES(?,?,?,?,?,?)', ...record);
    const first = today(db.clock());
    for (const [id, hotelId, code, name, capacity, description, photo, rates, floor] of fixtureTypes) {
      db.run(
        'INSERT INTO types VALUES(?,?,?,?,?,?,?)',
        id,
        hotelId,
        code,
        name,
        capacity,
        description,
        photo,
      );
      for (let index = 0; index < 5; index += 1) {
        db.run('INSERT INTO rooms(type_id,number) VALUES(?,?)', id, String(floor * 100 + index + 1));
      }
      for (let index = 0; index < 91; index += 1) {
        const supplies = [4, 2, 3];
        db.run(
          'INSERT INTO offers(type_id,night,capacity,price) VALUES(?,?,?,?)',
          id,
          addDays(first, index),
          id === 1 ? supplies[index % 3] : 5,
          rates[index % 3],
        );
      }
    }
    db.run('INSERT INTO grants VALUES(3,1,0),(4,1,1),(4,2,1)');
  });
}
