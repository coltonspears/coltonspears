#!/usr/bin/env node
'use strict';

/**
 * Rebuild the GitHub profile's self-contained SVG images.
 *
 *   node scripts/build-art.cjs
 *   node scripts/build-art.cjs --report /path/to/reports/greedy.json --game 0
 *
 * A report import records the original actions and provenance in assets/replay.json.
 * Every build validates every action using Standard Ultimate Tic-Tac-Toe rules.
 * SVGs use system fonts, internal references and CSS only; reduced motion gets the
 * recorded final position. There are no external assets, scripts or foreignObject.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'assets');
fs.mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}
const reportPath = option('--report');
if (reportPath) {
  const source = fs.readFileSync(path.resolve(reportPath));
  const report = JSON.parse(source);
  const gameIndex = Number(option('--game', '0'));
  const game = report.games_detail?.[gameIndex];
  if (!game?.moves?.length) throw new Error('Selected report game must include recorded moves.');
  const replay = {
    schema: 1,
    description: 'A recorded generation-168 evaluation game against the one-ply greedy reference policy.',
    source: 'ultimate-tic-tac-toe-ml/reports/greedy.json',
    source_sha256: crypto.createHash('sha256').update(source).digest('hex'),
    game_index: gameIndex,
    seed: report.seed,
    weights: report.weights,
    weights_sha256: report.weights_sha256,
    simulations_per_move: report.simulations_per_move,
    opponent: report.opponent,
    candidate: game.candidate,
    opening: game.opening,
    result: game.result,
    action_encoding: 'board*9+cell; both board and cell are row-major 0..8',
    moves: game.moves,
  };
  fs.writeFileSync(path.join(out, 'replay.json'), JSON.stringify(replay, null, 2) + '\n');
}
const replay = JSON.parse(fs.readFileSync(path.join(out, 'replay.json'), 'utf8'));
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function result(values) {
  for (const [a,b,c] of LINES) {
    if ((values[a] === 1 || values[a] === 2) && values[a] === values[b] && values[a] === values[c]) return values[a];
  }
  return values.every(Boolean) ? 3 : 0;
}
function validateReplay(data) {
  const cells = Array(81).fill(0);
  const boards = Array(9).fill(0);
  let forced = null;
  let winner = 0;
  const states = [{ cells: [...cells], boards: [...boards], forced, winner, move: 0, last: null }];
  if (!['X','O'].includes(data.candidate)) throw new Error('Unknown model side.');
  if (!data.opening.every((action, index) => action === data.moves[index])) throw new Error('Opening is not a prefix of the recording.');
  data.moves.forEach((action, index) => {
    const board = Math.floor(action / 9);
    const cell = action % 9;
    if (!Number.isInteger(action) || action < 0 || action >= 81 || winner || cells[action] || boards[board] || (forced !== null && board !== forced)) {
      throw new Error(`Illegal recorded action ${action} at move ${index + 1}.`);
    }
    cells[action] = index % 2 + 1;
    boards[board] = result(cells.slice(board * 9, board * 9 + 9));
    winner = result(boards);
    forced = boards[cell] === 0 ? cell : null;
    states.push({ cells: [...cells], boards: [...boards], forced, winner, move: index + 1, last: action });
  });
  if (['IN_PROGRESS','X_WIN','O_WIN','DRAW'][winner] !== data.result) throw new Error('Recorded result does not match legal replay.');
  if (!winner) throw new Error('Recording must be a complete game.');
  return states;
}
const states = validateReplay(replay);
const esc = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const THEMES = {
  dark: { bg:'#0d1117', panel:'#161b22', card:'#10161e', art:'#19222d', ink:'#e6edf3', muted:'#a6b2c1', border:'#303d4d', blue:'#79b8ff', amber:'#e6b85c', hero:'#152435', board:'#111c2b', tile:'#1b2b3e', active:'#263e57', green:'#8dbba3', paper:'#17212d', button:'#79b8ff', buttonInk:'#0d1117' },
  light: { bg:'#ffffff', panel:'#f6f8fa', card:'#ffffff', art:'#edf1f5', ink:'#1f2328', muted:'#596775', border:'#cbd6e2', blue:'#0969da', amber:'#a86b0b', hero:'#eaf2fa', board:'#dae6f3', tile:'#f4f8fc', active:'#c9def4', green:'#316948', paper:'#ffffff', button:'#0969da', buttonInk:'#ffffff' },
};
function text(x,y,content,size=16,fill='currentColor',extra='') {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(content)}</text>`;
}
function rect(x,y,w,h,fill,r=0,extra='') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
}
function svg(w,h,title,description,body,defs='',style='') {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc">\n<title id="title">${esc(title)}</title><desc id="desc">${esc(description)}</desc>\n<defs>${defs}</defs>\n<style>text{font-family:'Segoe UI',Arial,sans-serif} ${style}</style>\n${body}\n</svg>\n`;
}
function piece(player,cx,cy,color,size=7,extra='') {
  return player === 1
    ? `<path d="M${cx-size} ${cy-size}L${cx+size} ${cy+size}M${cx+size} ${cy-size}L${cx-size} ${cy+size}" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" ${extra}/>`
    : `<circle cx="${cx}" cy="${cy}" r="${size}" fill="none" stroke="${color}" stroke-width="2.3" ${extra}/>`;
}
function boardPosition(board) { return [Math.floor(board % 3) * 98, Math.floor(board / 3) * 98]; }
function cellPosition(action) {
  const [bx,by] = boardPosition(Math.floor(action / 9));
  return [bx + action % 3 * 29 + 16, by + Math.floor(action % 9 / 3) * 29 + 16];
}
function boardGrid(t) {
  let art = rect(-8,-8,302,302,t.board,10);
  for (let board = 0; board < 9; board++) {
    const [bx,by] = boardPosition(board);
    art += rect(bx-1,by-1,90,90,'none',4,`stroke="${t.border}" stroke-width=".8"`);
    for (let cell = 0; cell < 9; cell++) art += rect(bx+cell%3*29+2,by+Math.floor(cell/3)*29+2,27,27,t.tile,2);
  }
  return `<g id="board-grid">${art}</g>`;
}
function frameArt(state,t) {
  let art = '<use xlink:href="#board-grid"/>';
  if (!state.winner) {
    for (let board = 0; board < 9; board++) {
      if (state.boards[board] === 0 && (state.forced === null || state.forced === board)) {
        const [bx,by] = boardPosition(board);
        art += rect(bx-1,by-1,90,90,t.active,4,`stroke="${t.blue}" stroke-width="1.2" fill-opacity=".65"`);
      }
    }
  }
  state.cells.forEach((player,action) => {
    if (!player) return;
    const [cx,cy] = cellPosition(action);
    art += piece(player,cx,cy,player === 1 ? t.blue : t.amber);
  });
  if (state.last !== null) {
    const [cx,cy] = cellPosition(state.last);
    art += rect(cx-12,cy-12,24,24,'none',3,`stroke="${state.move % 2 ? t.blue : t.amber}" stroke-width="1" opacity=".8"`);
  }
  state.boards.forEach((winner,board) => {
    if (!winner) return;
    const [bx,by] = boardPosition(board);
    const color = winner === 1 ? t.blue : winner === 2 ? t.amber : t.muted;
    art += rect(bx,by,88,88,t.board,4,'fill-opacity=".87"');
    art += rect(bx-1,by-1,90,90,'none',4,`stroke="${color}" stroke-width="1.5"`);
    if (winner < 3) art += piece(winner,bx+44,by+44,color,24,'opacity=".95"');
  });
  if (state.winner < 3 && state.winner > 0) {
    const line = LINES.find(line => line.every(board => state.boards[board] === state.winner));
    const [x1,y1] = boardPosition(line[0]);
    const [x2,y2] = boardPosition(line[2]);
    art += `<path d="M${x1+44} ${y1+44}L${x2+44} ${y2+44}" fill="none" stroke="${state.winner === 1 ? t.blue : t.amber}" stroke-width="3" stroke-linecap="round" opacity=".6"/>`;
  }
  const status = state.winner ? (state.winner === 3 ? 'Draw' : `${state.winner === (replay.candidate === 'X' ? 1 : 2) ? 'Model' : 'Greedy'} wins`) : `Move ${String(state.move).padStart(2,'0')} / ${replay.moves.length}`;
  art += text(286,-22,status,13,state.winner ? t.blue : t.muted,'text-anchor="end"');
  return art;
}
function hero(t) {
  const duration = states.length + 3;
  let css = '.replay{display:none}.static{display:inline}';
  let frames = '';
  states.forEach((state,index) => {
    const start = index / duration * 100;
    const end = index === states.length-1 ? 100 : (index+1) / duration * 100;
    const keyframes = index === 0
      ? `0%{opacity:1}${end.toFixed(5)}%,100%{opacity:0}`
      : `0%{opacity:0}${start.toFixed(5)}%{opacity:1}${end.toFixed(5)}%{opacity:0}`;
    css += `@keyframes frame${index}{${keyframes}}.f${index}{opacity:0;animation:frame${index} ${duration}s step-end infinite}`;
    frames += `<g class="f${index}">${frameArt(state,t)}</g>`;
  });
  css += '@media(prefers-reduced-motion:no-preference){.replay{display:inline}.static{display:none}}';
  let body = rect(.5,.5,899,379,t.hero,12,`stroke="${t.border}"`);
  body += `<circle cx="40" cy="42" r="3.5" fill="${t.blue}"/>`;
  body += text(52,47,'Ultimate Tic-Tac-Toe ML',16,t.blue,'font-weight="600"');
  body += text(36,111,'Your next move.',43,t.ink,'font-weight="650" letter-spacing="-1.3"');
  body += text(36,158,'My little neural net.',43,t.ink,'font-weight="650" letter-spacing="-1.3"');
  body += text(37,197,'Nine boards. One game.',17,t.muted);
  body += text(37,222,'A small model learning a big strategy.',17,t.muted);
  body += rect(36,251,232,45,t.button,7);
  body += `<path d="M54 265L54 282L67 273.5Z" fill="${t.buttonInk}"/>`;
  body += text(80,279,'Play against my AI',17,t.buttonInk,'font-weight="600"');
  body += text(37,341,'132,266 parameters',13,t.muted);
  body += text(203,341,'Self-play',13,t.muted);
  body += text(304,341,'Generation 168',13,t.muted);
  body += `<g transform="translate(568 63)">${text(0,-22,'Recorded match',13,t.muted)}<g class="static">${frameArt(states.at(-1),t)}</g><g class="replay">${frames}</g></g>`;
  body += piece(1,576,368,t.blue,4);
  body += text(587,372,replay.candidate === 'X' ? 'Trained model' : 'Greedy',12,t.muted);
  body += piece(2,715,368,t.amber,4);
  body += text(727,372,replay.candidate === 'O' ? 'Trained model' : 'Greedy',12,t.muted);
  const desc = `Play against a neural network trained through self-play. 132,266 parameters, generation 168. The board replays ${replay.moves.length} legal moves from a recorded evaluation against a one-ply greedy policy at ${replay.simulations_per_move} simulations per move; the first ${replay.opening.length} moves are the fixed opening. Model plays ${replay.candidate}. Result: ${replay.result}. Reduced-motion users see the final position.`;
  return svg(900,380,'Your next move. My little neural net. Ultimate Tic-Tac-Toe ML.',desc,body,boardGrid(t),css);
}
function flower(type) {
  if (type === 'white') return '<rect width="100" height="90" fill="#344c3d"/><path d="M51 87L49 37M49 69Q25 59 33 52Q45 53 49 69M50 78Q74 66 72 57Q57 59 50 78" stroke="#92ad73" stroke-width="3" fill="#63805e"/><g fill="#f4eee3" transform="translate(49 34)"><ellipse ry="23" rx="8"/><ellipse ry="23" rx="8" transform="rotate(45)"/><ellipse ry="23" rx="8" transform="rotate(90)"/><ellipse ry="23" rx="8" transform="rotate(135)"/><circle r="9" fill="#e2b34b"/><circle r="5" fill="#ba8632"/></g>';
  if (type === 'yellow') return '<rect width="100" height="90" fill="#3f5050"/><path d="M49 90V35" stroke="#8aa57b" stroke-width="4"/><g fill="#deb34e" transform="translate(50 37)"><ellipse ry="26" rx="9"/><ellipse ry="26" rx="9" transform="rotate(30)"/><ellipse ry="26" rx="9" transform="rotate(60)"/><ellipse ry="26" rx="9" transform="rotate(90)"/><ellipse ry="26" rx="9" transform="rotate(120)"/><ellipse ry="26" rx="9" transform="rotate(150)"/><circle r="12" fill="#5c452d"/></g>';
  return '<rect width="100" height="90" fill="#3f4848"/><path d="M47 90L51 35" stroke="#77976e" stroke-width="3"/><g transform="translate(50 34)"><circle r="24" fill="#ba6e83"/><circle cx="-9" cy="-5" r="15" fill="#d68ca1"/><circle cx="8" cy="-5" r="14" fill="#c5788f"/><circle cx="0" cy="10" r="14" fill="#dc97ab"/><circle r="12" fill="#b66c84"/><circle cx="3" cy="-2" r="6" fill="#dba2b2"/></g>';
}
function photo(type,x,y,angle) {
  return `<g transform="translate(${x} ${y}) rotate(${angle} 40 39)">${rect(-4,-4,88,86,'#eceee8',2)}<g transform="scale(.8)">${flower(type)}</g></g>`;
}
function cardBase(t) {
  return rect(.5,.5,439,249,t.card,10,`stroke="${t.border}"`) + `<path d="M10 1H430Q439 1 439 10V135H1V10Q1 1 10 1Z" fill="${t.art}"/>`;
}
function sorter(t) {
  let body = cardBase(t);
  body += text(22,22,'Illustrated workflow',12,t.muted);
  body += photo('yellow',42,41,-14) + photo('pink',61,43,11) + photo('white',51,47,-3);
  body += `<path d="M162 81H201M195 75L201 81L195 87" stroke="${t.muted}" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  [['Daisy',t.green],['Sunflower',t.amber],['Rose','#d28ba1']].forEach(([label,color],i) => {
    const y = 38 + i * 28;
    body += rect(220,y,191,23,t.paper,4,`stroke="${t.border}"`);
    body += `<path d="M230 ${y+7}H236L238 ${y+9}H246V${y+18}H230Z" fill="none" stroke="${color}" stroke-width="1.3"/>`;
    body += text(258,y+16,label,13,t.ink);
  });
  body += text(22,164,'Practical Image Sorter',23,t.ink,'font-weight="600" letter-spacing="-.5"');
  body += text(22,190,'A folder of images. A small CNN.',15,t.muted);
  body += text(22,211,'Sorting decisions you can inspect.',15,t.muted);
  body += `<circle cx="26" cy="235" r="3.5" fill="${t.blue}"/>`;
  body += text(37,239,'Python / PyTorch',12,t.muted);
  body += text(417,239,'Explore project',12,t.blue,'text-anchor="end"');
  return svg(440,250,'Practical Image Sorter','An illustrated workflow: flower images sorted into Daisy, Sunflower, and Rose folders. This is a conceptual illustration, not a model prediction or measured confidence. A folder of images, a small CNN, and sorting decisions you can inspect.',body);
}
function digest(t) {
  let body = cardBase(t);
  body += text(22,22,'Illustrative digest',12,t.muted);
  body += rect(22,32,396,92,t.paper,6,`stroke="${t.border}"`);
  body += `<path d="M22 58H418" stroke="${t.border}"/>`;
  body += text(35,50,'›_',14,t.blue,'font-family="Consolas,monospace"');
  body += text(58,50,'prdigest',12,t.ink,'font-family="Consolas,monospace"');
  body += text(404,50,'review.md',12,t.muted,'text-anchor="end" font-family="Consolas,monospace"');
  const rows = [['Changes','What changed and why'],['Reviews','Context and open questions'],['Checks','Results in one place']];
  rows.forEach(([label,value],i) => {
    const y = 76 + i * 19;
    body += text(35,y,'+',13,t.green,'font-family="Consolas,monospace"');
    body += text(54,y,label,12,t.ink,'font-weight="600"');
    body += text(121,y,value,12,t.muted);
  });
  body += text(22,164,'PRdigest',23,t.ink,'font-weight="600" letter-spacing="-.5"');
  body += text(22,190,'Changes, reviews, and checks.',15,t.muted);
  body += text(22,211,'One readable Markdown digest.',15,t.muted);
  body += `<circle cx="26" cy="235" r="3.5" fill="${t.blue}"/>`;
  body += text(37,239,'Python',12,t.muted);
  body += text(417,239,'Explore project',12,t.blue,'text-anchor="end"');
  return svg(440,250,'PRdigest','An illustrative pull request digest showing sections for changes, reviews, and checks. One readable Markdown digest.',body);
}
for (const [name,theme] of Object.entries(THEMES)) {
  for (const [kind,render] of [['hero',hero],['image-sorter',sorter],['prdigest',digest]]) {
    fs.writeFileSync(path.join(out,`${kind}-${name}.svg`),render(theme));
  }
}
console.log(`Built 6 SVGs; validated ${replay.moves.length} legal moves, ${replay.result}, generation ${replay.weights}.`);
