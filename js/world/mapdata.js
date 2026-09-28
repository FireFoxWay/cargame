// Aethelgard Bay, traced from assets/world-map.webp (1024 x 559 px, 4 m per pixel, north up).
// Everything here is in map pixels; W() turns a pixel into world metres (+z north, -x east).
export const MPX = 4;
export const W = (px, py) => [(512 - px) * MPX, (280 - py) * MPX];
export const toPx = (x, z) => [512 - x / MPX, 280 - z / MPX];

// Coastline, clockwise from the north-west; the sea lies west and south-west of it.
export const LAND = [[305, -40], [1100, -40], [1100, 600], [420, 600], [420, 520], [380, 515], [340, 530], [300, 520], [260, 515], [220, 505], [195, 480], [175, 455], [150, 440], [130, 425], [112, 400], [105, 370], [100, 340], [100, 310], [108, 290], [118, 265], [122, 240], [125, 215], [135, 190], [150, 165], [170, 145], [195, 122], [225, 100], [255, 75], [280, 45], [300, 10]];

export const LAKES = [
  { px: 641, py: 224, rx: 13, ry: 31, rot: 0.35, level: 8 },
  { px: 616, py: 288, rx: 12, ry: 18, rot: -0.2, level: 8 },
];
export const CITY = { px0: 110, px1: 335, py0: 280, py1: 475, y: 3 };
export const DOWNTOWN = [230, 370];
export const AIRPORT = { a: [290, 150], b: [390, 103], width: 40, y: 24 };
export const STADIUM = { px: 365, py: 335, r: 20, y: 5 };
export const SPEEDWAY = { px: 955, py: 198, a: 30, b: 20, rot: -0.44, y: 18 };
export const SALT = { px: 845, py: 118, rx: 60, ry: 30, y: 16 };
export const CANYON = [[790, 214], [830, 226], [870, 211], [905, 200]];
export const HARBOR = { px0: 222, px1: 300, py0: 478, py1: 506 };
export const SUMMIT = [640, 52];

export const REGIONS = [
  { name: 'Aethelgard City', px: 225, py: 375, r: 105 },
  { name: 'Aethelgard Harbor', px: 245, py: 495, r: 38 },
  { name: 'Sunset Pier', px: 80, py: 382, r: 30 },
  { name: 'Grand Stadium', px: 365, py: 335, r: 40 },
  { name: 'Aethelgard International Airport', px: 340, py: 128, r: 55 },
  { name: 'Valley View', px: 400, py: 200, r: 85 },
  { name: 'Piine Creek', px: 245, py: 105, r: 35 },
  { name: 'Sierra Peaks', px: 590, py: 100, r: 110 },
  { name: 'Snowy Summit', px: 640, py: 52, r: 28 },
  { name: 'Bear Lake Reservoir', px: 630, py: 250, r: 45 },
  { name: 'Evergreen National Forest', px: 770, py: 320, r: 120 },
  { name: 'Rural Oakhaven', px: 715, py: 372, r: 32 },
  { name: 'Whispering Woods', px: 895, py: 345, r: 40 },
  { name: 'Sunscorched Badlands', px: 860, py: 160, r: 140 },
  { name: 'Salt Flats', px: 845, py: 118, r: 55 },
  { name: 'Coyote Canyon', px: 850, py: 215, r: 40 },
  { name: 'Rust Valley Speedway', px: 955, py: 198, r: 45 },
  { name: 'Dune Crest', px: 880, py: 450, r: 75 },
  { name: 'The Marshlands', px: 620, py: 500, r: 120 },
  { name: 'Stadium District', px: 305, py: 480, r: 40 },
];

// Roads as Catmull-Rom control points. `grade` caps the climb; `lamps` lines them with street lights.
export const ROADS = [
  { id: 'loop', name: 'I-5 Ring', closed: true, main: true, lamps: true, grade: 0.09, pts: [[300, 318], [335, 300], [372, 284], [410, 258], [440, 228], [468, 196], [500, 178], [545, 178], [600, 178], [650, 176], [700, 190], [745, 212], [790, 236], [840, 262], [885, 295], [912, 335], [915, 380], [895, 412], [850, 428], [790, 432], [735, 428], [680, 418], [625, 405], [575, 395], [530, 395], [490, 415], [450, 432], [400, 438], [350, 436], [305, 430], [270, 415], [250, 392], [248, 362], [262, 338]] },
  { id: 'a1', name: 'A1 Coastal Way', grade: 0.1, pts: [[312, 14], [298, 32], [275, 60], [245, 95], [212, 130], [185, 170], [165, 215], [165, 255], [182, 290], [215, 312], [262, 338]] },
  { id: 'airport', name: 'Airport Road', grade: 0.1, pts: [[245, 95], [275, 112], [300, 124], [318, 122]] },
  { id: 'i5n', name: 'I-5 North', grade: 0.09, pts: [[700, 190], [722, 150], [745, 110], [770, 70], [790, 38], [800, 18]] },
  { id: 'valley', name: 'Valley View Road', grade: 0.12, pts: [[300, 20], [345, 35], [395, 55], [440, 75], [478, 95], [505, 120], [500, 160], [500, 178]] },
  { id: 'switchS', name: 'The Switchbacks', grade: 0.15, pts: [[545, 178], [600, 166], [625, 156], [610, 146], [545, 140], [520, 130], [530, 120], [600, 114], [630, 104], [618, 94], [560, 88], [545, 78], [560, 68], [615, 62], [640, 52]] },
  { id: 'switchE', name: 'Summit Descent', grade: 0.15, pts: [[640, 52], [680, 58], [705, 70], [690, 84], [655, 92], [660, 108], [700, 118], [720, 132], [705, 148], [700, 172], [700, 190]] },
  { id: 'forest', name: 'Redwood Trail', grade: 0.12, pts: [[700, 190], [690, 225], [700, 255], [740, 262], [790, 272], [830, 288], [850, 320], [845, 350], [800, 368], [750, 372], [712, 378], [690, 400], [680, 418]] },
  { id: 'lake', name: 'Reservoir Road', grade: 0.1, pts: [[575, 395], [582, 350], [590, 310], [596, 275], [602, 245], [612, 212], [628, 190], [650, 176]] },
  { id: 'bad', name: 'Canyon Road', grade: 0.1, pts: [[790, 236], [815, 208], [845, 182], [880, 172], [906, 186], [926, 204]] },
  { id: 'flats', name: 'Flats Access', grade: 0.15, pts: [[845, 182], [843, 162], [840, 138]] },
  { id: 'speedway', name: 'Rust Valley Speedway', closed: true, speedway: true, grade: 0.05, pts: null },
  { id: 'stadium', name: 'Stadium Avenue', grade: 0.1, pts: [[400, 438], [395, 470], [380, 500], [350, 512], [300, 505], [255, 495]] },
  { id: 'marsh', name: 'Marsh Causeway', grade: 0.08, pts: [[530, 395], [520, 440], [540, 480], [580, 505], [640, 515], [700, 505], [760, 480], [790, 432]] },
  { id: 'pier', name: 'Sunset Pier', grade: 0, fixedY: 3, pier: true, pts: [[112, 380], [90, 381], [68, 382], [48, 383]] },
];
// The speedway oval, generated so the canyon road can meet it.
{
  const s = SPEEDWAY, pts = [];
  for (let k = 0; k < 18; k++) { const t = (k / 18) * Math.PI * 2, lx = Math.cos(t) * s.a, ly = Math.sin(t) * s.b; pts.push([s.px + lx * Math.cos(s.rot) - ly * Math.sin(s.rot), s.py + lx * Math.sin(s.rot) + ly * Math.cos(s.rot)]); }
  ROADS.find((r) => r.id === 'speedway').pts = pts;
}

// Timed events: a start beacon, checkpoints along the route, medals against a reference time.
export const EVENTS = [
  { id: 'switchback', name: 'Switchback Pass', road: 'switchS', desc: 'Climb the hairpins to the Snowy Summit.' },
  { id: 'coastal', name: 'Coastal Way Sprint', road: 'a1', desc: 'Down the A1 from the northern cliffs into the city.' },
  { id: 'redwood', name: 'Redwood Trail Rally', road: 'forest', desc: 'Through the Evergreen National Forest.' },
  { id: 'saltflats', name: 'Salt Flats Dash', pts: [[840, 138], [812, 122], [838, 100], [882, 100], [902, 122], [878, 142]], desc: 'Flat out across the dry lake bed.' },
  { id: 'speedway', name: 'Rust Valley Speedway', road: 'speedway', laps: 3, desc: 'Three laps of the desert oval.' },
  { id: 'marsh', name: 'Marshland Run', road: 'marsh', desc: 'Across the causeway through the Marshlands.' },
  { id: 'grandtour', name: 'Grand Tour', road: 'loop', laps: 1, desc: 'One lap of the whole I-5 ring.' },
];

export const COLLECTIBLES = [
  ['Snowy Summit', 646, 48], ['Bear Lake Shore', 611, 205], ["Logger's Camp", 828, 283], ['Whispering Woods', 903, 345], ['Rural Oakhaven', 716, 368],
  ['Valley View Farms', 765, 443], ['Dune Crest East', 902, 422], ['Dune Crest South', 776, 522], ['The Marshlands', 602, 517], ['Stadium District', 318, 489],
  ['Aethelgard Harbor', 232, 497], ['Sunset Pier', 52, 383], ['Grand Stadium', 365, 302], ['Downtown', 232, 372], ['Airport Terminal', 318, 116],
  ['Piine Creek', 247, 104], ['Dune Crest Beach', 196, 150], ['Valley View Heights', 440, 80], ['Valley Creek', 300, 240], ['Salt Flats', 862, 122],
  ['Coyote Canyon', 850, 219], ['Speedway Infield', 955, 198], ['I-5 North', 792, 34], ['Switchback Bend', 602, 116], ['Redwood Trail', 700, 247],
];

// Stunt ramps: position (px), heading as a map direction (degrees, 0 = north, 90 = east).
export const RAMPS = [
  { name: 'Salt Flats', px: 812, py: 136, dir: 60 },
  { name: 'Forest Clearing', px: 758, py: 266, dir: 100 },
  { name: 'Runway End', px: 384, py: 106, dir: 64 },
  { name: 'Dune Crest', px: 872, py: 440, dir: 170 },
  { name: 'Beach', px: 205, py: 158, dir: 200 },
];
