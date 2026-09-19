import { readFile, writeFile } from 'node:fs/promises';
import type { ReleaseSnapshot } from './types';

const proposals: Array<{ namespace: string; key: string; recommended: string | null; candidates: string[]; reason: string }> = [
  { namespace: 'architectural', key: 'red-brick', recommended: 'brick_4', candidates: ['brick_4', 'brick_wall_001', 'castle_brick_02_red'], reason: 'Weathered red clay running-bond wall material.' },
  { namespace: 'architectural', key: 'coursed-stone', recommended: 'stone_brick_wall_001', candidates: ['stone_brick_wall_001', 'japanese_stone_wall', 'medieval_blocks_03'], reason: 'Canonical taxonomy explicitly identifies coursed stone.' },
  { namespace: 'architectural', key: 'polished-concrete', recommended: null, candidates: ['anti_slip_concrete', 'concrete_floor_worn_001', 'concrete_wall_009'], reason: 'No discovered candidate accurately represents polished concrete; retain unless a visual candidate is approved.' },
  { namespace: 'architectural', key: 'stucco-white', recommended: 'white_stucco', candidates: ['white_stucco', 'plaster_wall_03', 'concrete_wall_001'], reason: 'Exact white stucco match with wall use.' },
  { namespace: 'architectural', key: 'vertical-timber', recommended: 'japanese_cedar_planks', candidates: ['japanese_cedar_planks', 'dark_wooden_planks', 'brown_planks_03'], reason: 'Metadata explicitly describes vertical cedar paneling.' },
  { namespace: 'architectural', key: 'architectural-glass', recommended: null, candidates: [], reason: 'Retain transmission/opacity material; no compatible opaque texture replacement.' },
  { namespace: 'architectural', key: 'standing-seam-zinc', recommended: null, candidates: ['box_profile_metal_sheet', 'corrugated_iron', 'blue_metal_plate'], reason: 'No standing-seam zinc asset was discovered; corrugated sheets are not equivalent.' },
  { namespace: 'architectural', key: 'weathered-steel', recommended: 'corrugated_iron', candidates: ['corrugated_iron', 'worn_corrugated_iron', 'rust_coarse_01'], reason: 'Weathered metallic exterior sheet with rust and complete PBR coverage.' },
  { namespace: 'architectural', key: 'travertine-marble', recommended: null, candidates: ['marble_01', 'floor_tiles_02', 'grey_cartago_01'], reason: 'No travertine asset was discovered; retain unless a marble substitute is explicitly approved.' },
  { namespace: 'architectural', key: 'terracotta-tile', recommended: 'roof_tiles', candidates: ['roof_tiles', 'clay_roof_tiles', 'clay_roof_tiles_02'], reason: 'Weathered terracotta roofing material.' },
  { namespace: 'architectural', key: 'black-granite', recommended: 'granite_tile', candidates: ['granite_tile', 'granite_tile_03', 'grey_cartago_01'], reason: 'Dark grey granite tile is the closest taxonomically correct match.' },
  { namespace: 'terrain', key: 'lush_grass', recommended: 'leafy_grass', candidates: ['leafy_grass', 'grass_ground', 'aerial_grass_rock'], reason: 'Canonical lush and green grass ground taxonomy.' },
  { namespace: 'terrain', key: 'manicured_turf', recommended: 'grass_ground', candidates: ['grass_ground', 'leafy_grass'], reason: 'Closest ground/turf material; review because it is worn and dry rather than manicured.' },
  { namespace: 'terrain', key: 'alpine_rock', recommended: 'aerial_rocks_02', candidates: ['aerial_rocks_02', 'aerial_ground_rock', 'aerial_grass_rock'], reason: 'Aerial rough rock suitable for broad terrain.' },
  { namespace: 'terrain', key: 'forest_mulch', recommended: 'wood_chips', candidates: ['wood_chips', 'wood_chip_path', 'aerial_wood_snips'], reason: 'Canonical mulch and wood-chip forest-floor taxonomy.' },
  { namespace: 'terrain', key: 'desert_sand', recommended: 'aerial_sand', candidates: ['aerial_sand', 'sandy_gravel_02', 'dry_ground_01'], reason: 'Broad aerial compacted sand; alternatives are gravel or cracked clay.' },
  { namespace: 'terrain', key: 'cobblestone', recommended: 'cobblestone_01', candidates: ['cobblestone_01', 'cobblestone_02', 'brick_pavement'], reason: 'Direct cobblestone match.' },
  { namespace: 'terrain', key: 'crushed_gravel', recommended: 'gravel_ground_01', candidates: ['gravel_ground_01', 'ground_grey', 'brick_gravel'], reason: 'Canonical crushed-aggregate ground taxonomy.' },
  { namespace: 'terrain', key: 'fresh_snow', recommended: 'snow_02', candidates: ['snow_02', 'snow_01', 'snow_field_aerial'], reason: 'Canonical fresh-snow taxonomy.' },
  { namespace: 'terrain', key: 'weathered_asphalt', recommended: 'asphalt_02', candidates: ['asphalt_02', 'asphalt_04', 'asphalt_07'], reason: 'Weathered cracked asphalt road material.' },
  { namespace: 'terrain', key: 'terracotta_clay', recommended: 'dry_ground_01', candidates: ['dry_ground_01', 'clay_roof_tiles', 'terrain_red_01'], reason: 'Dry baked clay ground; roof tiles are shown only as a color/material alternative.' },
];

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

async function main() {
  const [snapshotPath, outputPath] = process.argv.slice(2);
  if (!snapshotPath || !outputPath) throw new Error('Usage: build-review discovery.json output.html');
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as ReleaseSnapshot;
  const cards = proposals.map(proposal => {
    const options = proposal.candidates.map(id => {
      const info = snapshot.records[id]?.info as Record<string, unknown> | undefined;
      if (!info) return '';
      const recommended = id === proposal.recommended;
      return `<label class="option ${recommended ? 'recommended' : ''}"><input type="radio" name="${escape(proposal.namespace)}:${escape(proposal.key)}" value="${escape(id)}" ${recommended ? 'checked' : ''}><img src="${escape(info.thumbnail_url)}" alt=""><strong>${escape(info.name)}</strong><small>${escape(info.category)}</small><code>${escape(id)}</code>${recommended ? '<b>Recommended</b>' : ''}</label>`;
    }).join('');
    const retainChecked = proposal.recommended === null ? 'checked' : '';
    return `<section><h2>${escape(proposal.key)}</h2><p>${escape(proposal.reason)}</p><div class="options">${options}<label class="option retain"><input type="radio" name="${escape(proposal.namespace)}:${escape(proposal.key)}" value="retain" ${retainChecked}><div class="retain-box">Retain existing</div><strong>No replacement</strong><small>Preserve legacy appearance and behavior.</small></label></div></section>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Polyform Poly Haven pilot review</title><style>body{font:14px system-ui;margin:0;background:#f5f6f8;color:#172033}header{position:sticky;top:0;background:#172033;color:white;padding:18px 28px;z-index:2}main{max-width:1200px;margin:auto;padding:24px}section{background:white;border-radius:12px;padding:18px;margin-bottom:18px;box-shadow:0 1px 4px #0002}h2{margin:0 0 6px}p{color:#526070}.options{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.option{position:relative;border:2px solid #dde2e9;border-radius:10px;padding:10px;display:flex;gap:6px;flex-direction:column;cursor:pointer}.option:has(input:checked){border-color:#1769e0;background:#eef5ff}.option img,.retain-box{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;background:#e8ebef}.retain-box{display:grid;place-items:center;font-size:20px;color:#677386}.option input{position:absolute;right:16px;top:16px}.option small{min-height:34px;color:#5d6878}.option code{font-size:11px}.option b{color:#1769e0}button{background:#2f80ed;color:white;border:0;border-radius:7px;padding:10px 16px;font-weight:700}</style></head><body><header><strong>Poly Haven pilot mapping review</strong> · ${escape(snapshot.release)} · <button onclick="copyReview()">Copy decisions JSON</button></header><main>${cards}</main><script>async function copyReview(){const decisions=[...document.querySelectorAll('input[type=radio]:checked')].map(x=>{const [legacyNamespace,legacyKey]=x.name.split(':');return{legacyNamespace,legacyKey,decision:x.value==='retain'?'retain':'replace',targetSourceId:x.value==='retain'?undefined:x.value}});await navigator.clipboard.writeText(JSON.stringify({release:${JSON.stringify(snapshot.release)},reviewedBy:'Craig',decisions},null,2));alert('Decisions copied. Paste them into the Codex chat.');}</script></body></html>`;
  await writeFile(outputPath, html);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
