// Original deterministic high-pass ranked noise. Not NVIDIA's licensed STBN asset.
// 128x128x64 R8 layout expected by the renderer; uniform rank distribution per frame.
import { writeFileSync } from 'node:fs';
const width = 128, count = width * width, depth = 64;
const result = new Uint8Array(count * depth);
let seed = 0x706f6c79;
function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
for (let frame = 0; frame < depth; frame++) {
  const white = Float32Array.from({ length: count }, random);
  const filtered = new Float32Array(count);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    let neighbours = 0;
    for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) neighbours += white[((y+dy+width)%width)*width+(x+dx+width)%width];
    filtered[y*width+x] = white[y*width+x] - neighbours * 0.25;
  }
  const order = Array.from({ length: count }, (_,i) => i).sort((a,b) => filtered[a]-filtered[b]);
  order.forEach((pixel,rank) => { result[frame*count+pixel] = Math.floor(rank/count*256); });
}
writeFileSync(new URL('../public/beta/stbn.bin', import.meta.url), result);
