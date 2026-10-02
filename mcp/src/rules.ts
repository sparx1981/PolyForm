/**
 * The standing rules Claude is given every time it connects. This is the one place to edit them:
 * `http.ts` sends this text as the server's instructions, and `npm run rules:export` writes it, the
 * tool descriptions and the automatic checks into RULES.md for review.
 *
 * Keep each rule short and testable, and say why: Claude follows a rule it understands.
 */

export const GENERAL_RULES = `PolyForm is a 3D modelling app for buildings and gardens. Units are metres; y is up and the ground is y = 0 (or the terrain).
Find the model first (list_models), then read it (get_model, list_objects) before changing it. Always pass the model's id, not its name, to every tool after that. Building tools add real PolyForm objects that also appear live in the app if it is open.
Screenshots are slow and costly: take one only when you need to check something you can't tell from list_objects, not after every change. When a design is finished (created or changed), always call preview_model once and show the user its pictures: a 3D view and, for buildings, a floor plan of each level. Pass room_labels naming the rooms you built.
Each change can be reversed with undo_last_change.`;

/** Rules for building a house, learned from reviewing real models. Numbered so they can be discussed. */
export const BUILDING_RULES: { id: string; title: string; rule: string; why: string }[] = [
  {
    id: 'B1',
    title: 'Ask about what the picture does not show',
    rule: 'When building from a photo, drawing or description, list what you are assuming that is not visible (the far side of the roof, the rear elevation, floor-to-floor heights, where the stairs go, how many floors) and ask the user to confirm before you build. Ask with short multiple-choice questions.',
    why: 'A real house often has a different roof form or extension out of sight (for example a sloping roof on one side and a full-width flat dormer on the other). Guessing it wrong costs a rebuild.',
  },
  {
    id: 'B2',
    title: 'One storey at a time, at its real height',
    rule: 'Build the ground floor first, then each upper floor with add_room at that floor\'s height (y = 2.8 for the first floor above 2.8 m walls). Upper floors sit inside the footprint below unless the design overhangs. Check list_rooms shows the right level for each room.',
    why: 'Walls are filed under a level by their height. The Outliner, floor plans, roofs and stairs all read it.',
  },
  {
    id: 'B3',
    title: 'Stairs: let PolyForm place them, never through bedrooms',
    rule: 'Use add_stairs with room (an id from list_rooms) so the flight is placed inside that room. Choose a hall, landing or other circulation space, not a bedroom, unless the user asked. A straight flight for 2.7 m rise needs about 3.6 m of clear length; if the room is too short use an L- or U-shape. The floor above gets its stairwell opening automatically; never cut one by hand.',
    why: 'Stairs placed by coordinates stuck out of the house and cut into a bedroom. The tool now refuses a flight that leaves the room.',
  },
  {
    id: 'B4',
    title: 'Real objects, not look-alikes',
    rule: 'Use the app\'s own tools for anything it already has: add_roof_window for Velux roof windows and skylights, add_dormers for dormers, add_porch for a porch over a door, add_opening for doors and windows in walls, add_stairs, add_railing, add_roof. Never draw these from boxes, kernel shapes or push/pull.',
    why: 'Look-alikes do not cut the roof, move with the building, show on plans or match the app\'s own objects.',
  },
  {
    id: 'B5',
    title: 'Furnish with furnish_room; mind the ceiling',
    rule: 'Furnish rooms with furnish_room, which avoids collisions and drops anything too tall for the ceiling or sloping roof. Do not place tall items (wardrobes, shoe cabinets, bookcases) near the eaves of a loft or attic room. After furnishing, read the message for items that were left out.',
    why: 'A tall item put under a sloping roof poked through it.',
  },
  {
    id: 'B6',
    title: 'Match the reference, then check it',
    rule: 'After building, call check_model_health and preview_model, then compare the picture with the reference. Name anything that does not match (porch, roof form, window count, proportions) and offer to fix it. Do not claim a match you have not checked.',
    why: 'A porch was silently missed on the first attempt.',
  },
  {
    id: 'B7',
    title: 'Roof forms the tool cannot make',
    rule: 'add_roof makes gable, hip and flat (parapet) roofs, with lean-tos on lower storeys. For a roof with a single slope on one side and a flat-roofed dormer on the other, build a gable roof, then add_dormers with type flat and full_width true on the flat side. Tell the user what you approximated.',
    why: 'There is no single-slope roof type yet.',
  },
];

/** Checks the connector runs itself, whatever Claude does. Listed here so the exported rules show them. */
export const AUTOMATIC_CHECKS: { id: string; where: string; check: string }[] = [
  { id: 'C1', where: 'every change', check: 'Walls, floor slabs, ceiling slabs and foundation skirts are re-filed under the storey their height belongs to (story-N tag), so upper floors are never left under Level 1.' },
  { id: 'C2', where: 'add_room', check: 'The storey is worked out from the floor height, and only the ground floor gets a foundation.' },
  { id: 'C3', where: 'add_stairs', check: 'The flight must lie wholly inside one room of the floor it starts on, clear of walls and of other stairs, or nothing is added and the reason is given. With room set, a spot that fits is found by search (straight, then L, then U). A warning is given if the top does not arrive inside a room above.' },
  { id: 'C4', where: 'every change', check: 'When the model has stairs, the floor slab above each flight gets its stairwell opening and guard railing, as the app does.' },
  { id: 'C5', where: 'add_interior_furniture, furnish_room', check: 'Every point of a new item must be under the ceiling or sloping roof above it. add_interior_furniture refuses a tall item; furnish_room drops it and says so.' },
  { id: 'C6', where: 'add_roof_window', check: 'A roof window must lie wholly on one roof slope (not off the roof, across a ridge or hip, or on a flat roof).' },
  { id: 'C7', where: 'add_dormers', check: 'Each dormer must fit wholly on one slope. A full-width dormer is measured from the slope and narrowed until it fits.' },
  { id: 'C8', where: 'add_porch', check: 'The porch is built on the outside of the door\'s wall (the side facing away from the building) and its roof is above the door head.' },
];

/** What is sent to Claude as the server instructions. */
export function instructions(): string {
  const rules = BUILDING_RULES.map(r => `${r.id}. ${r.title}: ${r.rule}`).join('\n');
  return `${GENERAL_RULES}\n\nBuilding rules:\n${rules}`;
}
