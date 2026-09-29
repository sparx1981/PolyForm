export interface HelpTopic {
  id: string;
  title: string;
  category: 'getting-started' | 'tools' | 'features' | 'advanced';
  content: string;
  steps?: string[];
}

export const HELP_DOCS: HelpTopic[] = [
  {
    id: 'export-options',
    title: 'Exporting Your Designs',
    category: 'getting-started',
    content: 'PolyForm supports exporting your 3D models into industry-standard formats for use in other CAD software, game engines, or 3D printing.',
    steps: [
      'Open the main "Burger" menu in the Top Bar.',
      'Hover over the "Export" menu entry.',
      'Choose your format: GLTF (ideal for web/glTF viewers) or STL (standard for 3D printing).',
      'The browser will automatically generate and download the file to your computer.'
    ]
  },
  {
    id: 'overview',
    title: 'Application Overview',
    category: 'getting-started',
    content: 'Welcome to the 3D Design & Automation platform. This tool allows you to create, manipulate, and automate 3D scenes with ease. You can draw shapes, apply materials, and even write custom scripts to automate complex tasks.',
    steps: [
      'Use the Toolbar on the left to select drawing tools.',
      'Click and drag in the viewport to create objects.',
      'Use the Right-Click menu on objects to see detailed information or perform operations.',
      'Open the Developer Console from the Top Bar to write automation scripts.'
    ]
  },
  {
    id: 'move-tool',
    title: 'Move Tool',
    category: 'tools',
    content: 'The Move Tool allows you to translate objects in 3D space using an interactive gizmo.',
    steps: [
      'Select an object using the Select tool (Space).',
      'Activate the Move tool (M or G). The 3D translation gizmo will appear.',
      'Drag the axes (Red for X, Green for Y, Blue for Z) to move the object in world space.',
      'Precision Move: While dragging, the Status Bar shows exact positional coordinates.',
      'Axis Snapping: Use X, Y, or Z keys while the Move tool is active to lock movement to a specific axis.',
      'Multi-Select Move: You can select multiple objects (Shift-click) and move them together using the gizmo.'
    ]
  },
  {
    id: 'patio-decking',
    title: 'Patio / Decking Tool',
    category: 'tools',
    content: 'Draw a paved patio set level into the ground, or a raised timber deck on posts, with steps, railings and lights. Everything is built as real 3D slabs, bricks, stones and boards.',
    steps: [
      'Pick Patio / Decking from the Landscapes toolbar and choose Patio (paving) or Decking (timber) in its panel.',
      'Click the corners of the outline and click the first point (or press Enter, or double-click) to finish. Or drag out a rectangle. Backspace removes the last point, Esc cancels.',
      'Hold Shift and click a point to make the next edge curve through it.',
      'Points snap to building walls (they turn blue). A patio or deck drawn against a building is set level with its floor, and the edges along the wall get no railing or steps.',
      'Patios are set into the ground (the terrain is levelled under them) with an optional kerb and a retaining wall where the ground is higher. Choose slabs, block paving (herringbone, stretcher, basketweave), natural stone, porcelain or gravel, and set slab size, pattern angle, joint width and grout colour.',
      'Decks sit on joists, beams and posts (or behind skirting boards). Choose softwood, hardwood, composite, weathered or painted boards, board width and gap, direction, picture-frame edging, grooved boards, a fascia, timber/glass/cable railings and built-in lights that glow at night.',
      '"Choose from library" applies any material library preset to the slabs or boards.',
      'Select a patio or deck to change its settings live. Drag the yellow corners to reshape, click a white dot to add a corner, Shift-drag a dot to curve that edge, right-click a corner to remove it.',
      'Click "Add steps: click an edge" and then click an edge to add a flight of steps down to the ground. The number of steps comes from the height.',
      'The Quantities box shows the area, perimeter, slab/brick count or board length for estimating.',
    ]
  },
  {
    id: 'walk-mode',
    title: 'Walk Mode',
    category: 'tools',
    content: 'Walk Mode lets you explore your model in first person, with gravity, collision, and stairs - as if you were physically walking through it.',
    steps: [
      'Select the Walk Mode tool (the footprints icon) from the Camera group.',
      'Click a spot on the floor or another walkable surface to start walking there.',
      'Move with WASD or the arrow keys, look around with the mouse, press Space to jump, hold Shift to sprint and hold C to crouch (you stay crouched under low ceilings until there is room to stand).',
      'Almost everything you draw or place blocks movement - walls, floors, basic shapes, drawn geometry, trees, and more - so you can walk into, stand on, or jump onto whatever you\'ve modeled; you can also climb stairs and small steps automatically.',
      'Closed doors block the way: look at a door and press E to open it, and press E again to close it. Archways are always open.',
      'Small plants/shrubs, scale-reference figures and dimension annotations are always walk-through.',
      'Press Esc to exit Walk Mode and return to your previous tool. Losing mouse focus (e.g. alt-tab) pauses instead of exiting.',
      'On touch devices, use the on-screen joystick to move, drag to look around, and the Jump/Crouch/Door/Exit buttons (Door opens or closes the door you are looking at).',
      'Adjust Movement Speed and Mouse Sensitivity in the Tool Modifier panel while Walk Mode is active.'
    ]
  },
  {
    id: 'rectangle-tool',
    title: 'Rectangle Tool',
    category: 'tools',
    content: 'The Rectangle tool allows you to draw 2D rectangular surfaces on the ground plane or other existing surfaces. It supports both free-hand drawing and precise numerical input.',
    steps: [
      'Select the Rectangle tool from the left toolbar (or press R).',
      'Method A (Drag): Click and hold on the ground to set the first corner, drag to define dimensions, and release.',
      'Method B (Input): Click once to set the starting point. Two input boxes will appear in the Status Bar.',
      'Type the X (Width) dimension, press Tab to move to Z (Depth), and hit Enter to finalize.',
      'Press Esc at any time to cancel the input mode.'
    ]
  },
  {
    id: 'box-tool',
    title: 'Box Tool',
    category: 'tools',
    content: 'Create 3D boxes directly in the scene.',
    steps: [
      'Select the Box tool.',
      'Click and drag to define the base of the box.',
      'Release to create the box with a default height.',
      'Use the Extrude tool afterwards to adjust height precisely.'
    ]
  },
  {
    id: 'poly-tool',
    title: 'Poly Tool',
    category: 'tools',
    content: 'The Poly Tool allows you to trace custom polygons on the ground or existing object faces. It is ideal for creating irregular floor plans or custom profiles that can be extruded using the Extrude tool.',
    steps: [
      'Select the Poly Tool from the Line sub-menu (click the Pen Line icon to reveal more tools).',
      'Set First Vertex: Click on the ground or a shape face to set the starting point and lock the drawing plane.',
      'Trace Shape: Click to place additional vertices. A preview line follows your cursor.',
      'Snap to Start: When your cursor is near the first vertex, it will highlight in yellow. Click to close the shape.',
      'Finalize via Keyboard: Press Enter to automatically close the shape from your last vertex back to the first.',
      'Undo & Cancel: Press Ctrl+Z to undo the last vertex placed, or Esc to cancel the entire drawing.',
      'Extrude: Once the 2D surface is created, use the Extrude tool (P) to pull it into a 3D solid.'
    ]
  },
  {
    id: 'ai-designer',
    title: 'AI 3D Designer',
    category: 'features',
    content: 'The AI 3D Designer allows you to build complex models simply by describing them. It uses a custom-trained model to interpret architectural requests and translates them into physical 3D scene objects.',
    steps: [
      'Open AI Tools: Click the AI icon (Magic Wand) in the left toolbar or select "AI Generate" from the status bar.',
      'Describe your Model: Type a detailed prompt (e.g., "A modern pavilion with a curved roof and 4 support pillars").',
      'Generate: Click "Generate Model". The AI will analyze your request and begin placing objects in the scene.',
      'Refine: Once generated, you can move, rotate, or modify the AI-created objects like any other shape.',
      'Context Awareness: The AI takes existing shapes into account to avoid overlapping unless requested.'
    ]
  },
  {
    id: 'contact-friction',
    title: 'Contact Friction (Resistance)',
    category: 'tools',
    content: 'Contact Friction is a specialized Move modifier that provides tactile feedback when objects meet in 3D space. It helps you align parts perfectly by "snapping" them into place upon first contact.',
    steps: [
      'Enable Friction: While the Move tool (M) is active, open the Tool Modifier Palette (Settings icon in top right) and toggle "Contact Friction".',
      'Move Object: Drag your selected object towards another object.',
      'The "Stick": When the bounding boxes of the two objects first touch, movement will pause for 200ms.',
      'Alignment: This pause allows you to feel the intersection point and choose to stop precisely there.',
      'Continuous Drag: To move through the object, simply keep dragging; the movement will resume after the brief pause.'
    ]
  },
  {
    id: 'push-pull',
    title: 'Extrude Tool',
    category: 'tools',
    content: 'The Extrude tool is the fundamental method for extruding 2D shapes into 3D volumes or adjusting the faces of existing 3D objects. It now features full support for Poly tool surfaces.',
    steps: [
      'Select the Extrude tool (or press P).',
      'Hover over a face; it will highlight in blue.',
      'Click and drag the face to extrude or intrude.',
      'Poly Strategy: Pull a polygon top/bottom cap to change its height, or pull a side face to uniformly scale its entire 2D profile.',
      'Release to finalize the new dimension.'
    ]
  },
  {
    id: 'world-view',
    title: 'WorldView Map Overlay',
    category: 'features',
    content: 'WorldView allows you to overlay a real-world map onto your 3D workspace. The map is rendered at the origin (0,0,0) and supports coverage from 50m to 450m.',
    steps: [
      'Select the Globe icon from the left toolbar to open WorldView settings.',
      'Configuring Diameter: Use the Map Coverage slider to set the radius from 50m to 450m. The default is 100m.',
      'Altitude Management: The map altitude is fixed at -0.1m to ensure it sits perfectly below your models and prevents z-fighting.',
      'Activation: Click "Activate Map Overlay" to show it. New designs default to "Overlay Off" for a clean workspace.',
      'Location Search: Search for a specific address or manually input Latitude and Longitude.'
    ]
  },
  {
    id: 'world-view-3d-site',
    title: 'WorldView 3D Site (real terrain and buildings)',
    category: 'features',
    content: 'Bring a real place into your model, up to 200 m square. You get its ground as an editable terrain and its existing buildings as white models. Design in context: delete a building and draw your own in its place, then show the old one as a ghost for before and after.',
    steps: [
      'Open WorldView (the Globe icon) and search for an address, a UK postcode or "lat, lng". The pin marks the centre of the site.',
      'Under 3D Site, choose the area (20 to 200 m square) and the ground: Plain (white model) or Satellite (the aerial photo, which needs a Google Maps key).',
      'Click "Import 3D site". The centre of the site becomes ground level (y = 0), and north is towards the top of the plan. Importing again replaces the site; your own design stays.',
      'The ground is an ordinary terrain: sculpt, flatten, dig and pave it with the landscape tools.',
      'Click an existing building to select it. Entity Info shows its height and where that came from: measured, from its number of floors (3 m each), or estimated. Type a new height to correct it.',
      'Delete a building (Delete key or "Remove building"), then draw your new design in its place. Tick "Show removed buildings as ghosts" to see what was there, or "Put back" to restore them.',
      'Existing buildings and the imported ground are left out of the bill of materials and are there from the start of a presentation build-up.',
      'Street life: moving cars and people. Cars drive the real roads, keeping to the side the country drives on. Plain white figures walk the footpaths and the pavements beside roads, a few stand chatting, and anyone can sit on benches you have added. They move in presentations and on the client page. Choose Off, Quiet, Normal or Busy under Street life in WorldView or with "Street" in presentation mode. Tick "Show moving cars and people while editing" to see them in the editor too. Phones and tablets show fewer.',
      'Draw your own routes with "Draw walking route" (people, e.g. across a new garden) or "Draw driving route" (cars, e.g. a new drive). Click along the ground, then double-click or press Enter to finish. While drawing, all the site\'s routes show as lines: grey from the map, blue for walking, amber for driving. "Remove last drawn" and "Remove all drawn" take yours away.',
      'LiDAR: in England and the Netherlands, the national LiDAR survey gives 1 m ground, each building\'s real height, and a basic roof (flat, lean-to, gable, hipped or pyramid). In the USA it gives 1 m ground only. A building the survey shows as open ground (newer than the survey, or a wrong outline) keeps the map\'s estimate and says "Check height".',
      'Data: building outlines © OpenStreetMap contributors (ODbL). Ground heights: Terrain Tiles (AWS open data), about 3 m apart, smoothed onto a 1 m grid; LiDAR from the Environment Agency (Open Government Licence), AHN (CC0) and USGS 3DEP (public domain) where available.'
    ]
  },
  {
    id: 'animations-scalable',
    title: 'Scalable Animations',
    category: 'features',
    content: 'Animations (particle effects) can be placed in your scene and scaled to match the size of your architectural models.',
    steps: [
      'Open the Animations panel in the Right Panel.',
      'Placement: Click "+ Add Effect" and then click anywhere in your 3D scene to set its position.',
      'Scale Control: Use the "Scale (Size)" slider to increase or decrease the overall volume and particle size of the effect.',
      'Density: Adjust the density slider to control the number of particles emitted.',
      'Looping: Toggle whether the effect should reset automatically or play once.'
    ]
  },
  {
    id: 'custom-lighting',
    title: 'Custom Lighting & Projectors',
    category: 'features',
    content: 'Add Spot, Point, Directional, or Projector lights to your scene to create professional architectural visualizations.',
    steps: [
      'Add a light from the Right Panel under Visualisation > Lighting.',
      'Resizeable Lights: Use the "Scale" slider on Spot, Point, and Directional lights to adjust their size and influence area.',
      'Projector Video: Projector lights now support video files. Enter a video URL and select "Video" mode to cast animated blueprints or environments.',
      'Spin Effect: Enable the "Spin" radio button to animate the texture rotation. This correctly rolls the projected image by spinning the light\'s `up` vector around its aim axis.',
      'Color vs Texture: Standard lights use a color picker. Projectors hide the color picker and focus exclusively on the provided texture map.',
      'Intensity: Adjust the brightness and distance to find the perfect balance for your model.'
    ]
  },
  {
    id: 'object-info',
    title: 'Editing Object Info',
    category: 'features',
    content: 'You can view and edit precise metadata for any object in the scene, including dimensions and position.',
    steps: [
      'Right-click any object in the viewport.',
      'Hover over or click "View Object Information".',
      'Click on any Dimension or Position value (X, Y, Z) to edit it.',
      'Type the new value and press Enter to apply.'
    ]
  },
  {
    id: 'developer-suite',
    title: 'Developer Extensibility Suite',
    category: 'advanced',
    content: 'The Developer Extensibility Suite allows you to write JavaScript scripts using our SDK to automate scene creation. It features a flexible, draggable, and collapsible workspace.',
    steps: [
      'Open the Help menu and select Developer Extensibility Suite.',
      'Draggable Handle: Click and drag the "Developer Extensibility Suite" title bar to reposition the window anywhere in your viewport.',
      'Collapse Interface: Click the "Minimize" icon next to the Close button to fold the suite away while keeping it active.',
      'Write your script in the editor using the `sdk` object and click "Run Script" to execute.',
      'Access the "Spec" tab for full technical documentation on every available SDK method and property.'
    ]
  },
  {
    id: 'collaboration',
    title: 'Collaborative Design',
    category: 'advanced',
    content: 'Work together with invited team members in real-time. Manage access through secure invitations and design-specific join links.',
    steps: [
      'Open the Collaboration panel on the right.',
      'Invite by Email: Enter a team member\'s email to send a secure invitation. Note: Designs must be saved before invitations can be sent.',
      'Generate Link: Create a unique join URL specific to your design. Only users with an invitation can join using this link.',
      'Revoke Access: As the owner, you can remove any collaborator from the session by clicking the "X" (Revoke) button next to their name.',
      'Active Sessions: See who else is currently viewing or editing your design with status indicators (green for active).'
    ]
  },
  {
    id: 'deform-tool',
    title: 'Deform Brush',
    category: 'tools',
    content: 'The Deform tool allows you to sculpt and manipulate geometry vertices directly in the 3D viewport. It acts as a soft brush that can pull or push geometry.',
    steps: [
      'Select the Deform tool from the left toolbar (or press D).',
      'Adjust the Brush Radius, Strength, and Direction in the Right Panel under Object Properties.',
      'Click and drag over a mesh to deform its surface.',
      'Geometry is automatically updated and saved as a custom object after release.'
    ]
  },
  {
    id: 'collaborative-messaging',
    title: 'Project Messaging',
    category: 'features',
    content: 'The Project Messaging system allows collaborators to communicate in real-time within the 3D workspace. It features a floating chat interface that can be minimized or expanded as needed.',
    steps: [
      'Open Messaging: Click the "MessageSquare" icon in the Collaboration panel or press the Messaging button.',
      'Sending Messages: Type your message in the text input and press Enter or click the Send icon.',
      'Real-time Updates: Messages from all active collaborators appear instantly, with timestamps and display names.',
      'Minimize/Expand: Use the Chevron icon or the title bar to collapse the chat window to the bottom of the screen while keeping it active.',
      'History: The system maintains a persistent record of the conversation throughout your design session.'
    ]
  },
  {
    id: 'collaborator-cursors',
    title: 'Collaborator Cursors',
    category: 'features',
    content: 'Real-time multi-user cursor tracking allows you to see where your teammates are looking and pointing in the 3D workspace. This provides high-fidelity spatial context during collaborative logic discussions.',
    steps: [
      'Toggle Visibility: Open the Collaboration panel on the right and toggle "Show Cursors".',
      '3D Tracking: You will see high-impact 75px wide triangle pointers with labels representing other active users.',
      'Precise Positioning: Cursors are anchored to the geometry faces or the ground plane using real-time raycasting.',
      'Privacy: You can hide other users\' cursors at any time to focus on your individual work.'
    ]
  },
  {
    id: 'transformation-sync',
    title: 'Visual Live Sync & Ghosts',
    category: 'features',
    content: 'See exactly what your team is working on with live transformation previews and collaborator "ghosts".',
    steps: [
      'Live Previews: When a collaborator moves, rotates, or scales an object, you will see a semi-transparent "ghost" of the object moving in real-time.',
      'Collaborator Labels: Each ghost includes the name of the teammate responsible for the change.',
      'Precision Sync: Transformations use Quaternions ensuring that even complex rotations are perfectly synchronized across all devices.',
      'Conflict Handling: The system provides visual feedback so you don\'t accidentally edit the same object at the same moment.'
    ]
  },
  {
    id: 'subtract-tool',
    title: 'Subtract Tool (Boolean)',
    category: 'tools',
    content: 'Perform Boolean subtraction between two objects. Use one object (the cutter) to carve a hole out of another (the target).',
    steps: [
      'Select the Subtract tool from the left toolbar (or press X).',
      'Step 1 (Target): Click the object you want to KEEP. This is the main body that will be modified.',
      'Step 2 (Cutter): Click the object you want to SUBTRACT. Ensure it intersects with the target.',
      'The operation will run automatically, removing the cutter and updating the target geometry.',
      'Note: CSG operations work best on closed meshes (Boxes, Prisms) without excessive complexity.'
    ]
  },
  {
    id: 'camera-settings',
    title: 'Camera & View Defaults',
    category: 'features',
    content: 'Define your preferred starting perspective by configuring default camera position settings.',
    steps: [
      'Open Settings from the Top Bar.',
      'Under "Default Camera Position", enter the X, Y, and Z coordinates for your preferred viewpoint.',
      'Click "Revert Camera" to quickly reset your starting position to the standard 80x80x80 perspective.',
      'Tip: Use the Zoom tool (Z) and click "Set Default" in the bottom Status Bar to instantly save your current view as the new default.',
      'Reset your view at any time by clicking the "Perspective" camera icon in the top view controls.'
    ]
  },
  {
    id: 'collaboration',
    title: 'Collaboration & Notes',
    category: 'features',
    content: 'Spatial Notes allow you to place coordinate-anchored annotations directly on your 3D geometry. These notes scale relative to the 3D space, ensuring they never obscure the viewport during close-up work.',
    steps: [
      'Select Note Tool: Press N or click the Pen icon in the left toolbar.',
      'Place Note: Click on any surface in the 3D scene. A placement card will appear.',
      'Type & Save: Enter your text and press Enter. The note stays relative to its 3D anchor.',
      'Relative Scaling: Zoom out to see notes shrink, or zoom in to see them grow naturally alongside your model.',
      'Completion Tracking: Click a note to toggle its "Completed" status, which dims the text and adds a checkmark.'
    ]
  },
  {
    id: 'realtime-sync',
    title: 'Real-time Synchronization',
    category: 'features',
    content: 'Experience seamless multi-user collaboration with our robust synchronization engine. All changes to shapes, materials, and scene settings are persisted instantly across all connected clients. We use an automated presence system to track active collaborators and broadcast their spatial transformations in real-time.',
    steps: [
      'Watch the Status Bar: A Cloud icon in the bottom-left indicates your current sync state.',
      'Synced (Green): Your design is fully saved and up to date with the cloud.',
      'Syncing (Blue Pulse): Local changes are being uploaded to the server.',
      'Sync Error (Red): There was a problem reaching the server. Check your connection.',
      'Collaborative Feedback: Changes made by other users will appear instantly in your viewport without needing to refresh.',
      'Automatic Session Joining: When you open a model, the system automatically joins you to the collaboration session, enabling your presence for other users.',
      'Conflict-Free Editing: Stripped data validation ensures that rapid edits (like moving or scaling) don\'t cause synchronization crashes.'
    ]
  },
  {
    id: 'sdk-poly-telemetry',
    title: 'Advanced SDK: Poly',
    category: 'advanced',
    content: 'The SDK has been expanded to support programmatic polygon creation. This allows you to generate custom 2D surfaces that are immediately compatible with the Extrude tool.',
    steps: [
      'sdk.createPoly({ vertices: [[x,y,z], ...] }): Create custom 3D polygons by providing a list of world-space coordinates. The system automatically calculates the geometry plane.',
      'Snap highlighting: When manually drawing, the entire closing segment highlights in thick yellow when you hover over the start vertex.',
      'Example: `sdk.createPoly({ vertices: [[0,0,0], [2,0,0], [2,0,2], [0,0,2]] })` will create a 2m flat square at the origin.'
    ]
  },
  {
    id: 'diagnostic-log',
    title: 'AI Diagnostic Log',
    category: 'advanced',
    content: 'The AI Diagnostic Log (v3.5) provides a real-time high-fidelity telemetry feed of the Three.js scene engine. It features 60fps frame-safe logging with specialized categories and visual JSON inspection for expert-level debugging.',
    steps: [
      'Toggle Entry: Press Ctrl+Shift+L or click the [DIAG] button in the TopBar to toggle the panel.',
      'Live Telemetry: View the continuous scroll of logs from the RENDER, FRAME, TEXTURE, and EFFECT engines.',
      'Category Filtering: Use the filter tags (e.g., TEXTURE for loading status, FRAME for rotation deltas) to isolate specific problematic behaviors.',
      'JSON Inspection: Click the dropdown arrow on any log entry to inspect the raw coordinate data or state objects.',
      'Auto-Scroll: The log automatically follows new entries. Scroll up manually to pause auto-scrolling and inspect a specific moment.',
      'Copy All: Click "Copy All" to get a telegram-style report formatted for analysis by an AI assistant.'
    ]
  },
  {
    id: 'snapping-inference',
    title: 'Snapping, Inference and Locks',
    category: 'tools',
    content: 'Line, Arc, Bézier, Poly and the shape tools all snap the same way. Point the cursor near something and a marker names what it found; coloured lines show the direction you are lined up with. Ending a line exactly on another one splits both, and closed outlines become surfaces.',
    steps: [
      'Corners (green diamond), midpoints (cyan), face centres, the origin and guide points snap first. Where two edges or guides cross (green square) snaps too, and so does any point ON an edge or guide (red square) - that is how a line ends exactly on another and splits it.',
      'Once you have started drawing, the cursor also lines up with directions from the start: along the red, green or blue axis; continuing an edge you are extending; and with anything you have rested on.',
      'Rest the pointer on a corner for a moment and lines can then be taken from it (aligned with that corner along an axis). Rest it on an edge and the next segment can be parallel or perpendicular to it (pink). Where two lines meet, or a line meets an edge, that exact point is offered.',
      'Locks: while drawing, press the Right arrow to lock the red axis, Left for green, Up for blue (the X, Y and Z keys do the same); press again or Esc to release. Press Down to lock parallel to the edge you rested on, again for perpendicular, again to release. Hold Shift to keep whatever direction is showing. A lock still snaps to corners, midpoints and crossings on its line, and to points lined up with them.',
      'Arc: click the start, click the other end of the chord, then move to bulge it and click. Start on an edge and the arc is tangent to it (cyan). Start on a straight edge near a corner and a pink point appears on the other edge: put the end on it and the arc rounds the corner (tangent to both edges) and trims it. Type a bulge (0.5) or radius (2r) and press Enter, or 12s for the number of segments.',
      'Bézier and Poly snap their points the same way; closing on the start point is offered in the same way for both.'
    ]
  },
  {
    id: 'groups-components',
    title: 'Groups and Components',
    category: 'tools',
    content: 'A group turns shapes you drew into one object: it moves, turns, copies, hides and takes tags as a whole, and nothing you draw against it sticks to it or cuts into it. A component is a group whose copies share their inside: change one and they all change - handy for windows, chairs, fence panels or anything repeated.',
    steps: [
      'Select the drawn faces (click, Shift-click or drag a selection), right-click one and choose Make Group or Make Component. The Make Component button in the toolbar does the same for the selected faces.',
      'Move, rotate, scale, copy and tag it like any other object. Copies of a component (Duplicate, or Copy in the Components panel) stay linked.',
      'Double-click it (or Edit inside in Entity Info) to change what is inside: the rest of the drawing fades and every drawing tool works as usual. Press Esc or Close to finish. For a component, every copy updates.',
      'Right-click a group > Explode turns it back into ordinary drawn faces, where it now stands. Right-click a component copy > Make Unique splits it off so it can be changed on its own; a group can become a component with Make Component.',
      'The Components panel lists the components in the model with how many copies each has: rename one, place another copy, or select all its copies.',
      'Undo takes back any of these in one step. Saving as .skp keeps components as real SketchUp components.'
    ]
  },
  {
    id: 'section-planes',
    title: 'Section Planes (slice the model to see inside)',
    category: 'tools',
    content: 'A section plane slices the model so you can see inside - a plan cut through a floor, or a cut through a wall to see the rooms behind it. Cut walls show a solid dark fill, like a drawing. Unlike the camera\'s depth clipping, a section plane stays where you put it as you orbit, cuts only the model (not the grid or sky), and is saved with the model.',
    steps: [
      'Pick Section Plane (next to Follow Me) and hover a wall, floor or any face: an orange square lines up with it.',
      'Click to place it. It cuts straight away, keeping the side away from you. The orange arrows point into the part that stays.',
      'To move it, drag its orange square with the Section Plane tool - it slides along its own direction. Or select it and type a distance under "Move along its direction".',
      'Select a plane (Select tool, click its square) to flip which side is cut away, or turn its cut off and on. You can keep several planes; one cuts at a time, and turning one on turns the others off.',
      'While a plane is cutting, clicks go straight through the part that is cut away, so you can draw and edit inside.',
      'Delete a plane like any object: select it and press Delete.'
    ]
  },
  {
    id: 'worldview-google-context',
    title: 'WorldView: Google surroundings and styled buildings',
    category: 'tools',
    content: 'Two switches on an imported 3D site (WorldView > 3D Site > Look) change how the site looks without changing what you can edit.',
    steps: [
      'Google photorealistic surroundings: shows Google\'s 3D map around the site, in the editor, in presentations and on the client page. It needs a Google Maps API key with the Map Tiles API enabled, and shows Google\'s attribution. It is for looking at: it can\'t be edited, measured, snapped to or exported.',
      'Cut out site: Google is cut away over the site, so the editable satellite ground and your buildings show there and Google fills in the rest. Google ground: the editable ground is hidden, your buildings stand on Google\'s ground, and Google\'s own buildings are pressed flat under them.',
      'Google as the site: untouched buildings, trees and ground come from Google\'s photographs. Click a Google building to select the editable copy. Change, move, paint or delete it and Google\'s version is pressed flat where it stood, and the editable one shows. Anything new you draw presses Google flat under it too. Put back removed buildings returns Google\'s. Trees or ground beside a building are part of the same Google surface, so they stay, and the edge of the flattened patch can look rough.',
      'The layer is matched to your site\'s ground height automatically; use the slider to raise or lower it if it looks off.',
      'Style the buildings: the editable buildings are dressed by what they are - houses, flats, shops, offices, towers, warehouses, garages, churches, greenhouses - with real brick, render, stone, concrete or metal at true scale and windows and doors generated from their floors and wall lengths. The map\'s colour or material wins where it has one; roofs take the colour seen from above. A building you have painted keeps its own colour. Turn it off to go back to white.'
    ]
  },
  {
    id: 'extrude-solids',
    title: 'Extrude on a solid (Push/Pull)',
    category: 'tools',
    content: 'Push/Pull changes the solid you have rather than adding a second one on top of it.',
    steps: [
      'Pull the top, end or side of a box: the face moves and the walls beside it stretch. The box keeps the same faces however many times you push.',
      'Draw a rectangle on a face and push it out for a bump, or in for a recess. The face you started from goes, so there is no floor left inside.',
      'Hold Ctrl when you let go to push a copy: the face stays and a new slab stacks on it, keeping the divider. Use this for floors.',
      'Double-click a face to repeat the last distance on it (Ctrl for a copy). You can also type a distance right after pushing.',
      'Pushing a face all the way through the other side is refused, and a free-standing shape still gets its base kept as before.'
    ]
  },
  {
    id: 'follow-me',
    title: 'Follow Me (sweep a shape along a path)',
    category: 'tools',
    content: 'Follow Me sweeps a flat shape along a path, the way SketchUp does: a moulding round a slab, a gutter along an eave, a kerb along a road edge, a handrail, a pipe. The result is ordinary drawn geometry you can push/pull, paint and erase.',
    steps: [
      'Draw the path with Line or Arc (or use the edge of a face you already have).',
      'Draw the profile - the cross-section - as a flat shape standing across the start of the path, facing along it. It does not have to touch the path.',
      'Pick Follow Me (next to Extrude), then click the profile.',
      'Hover the path: it lights up pink and the result shows as a blue wireframe. Hovering an edge uses the whole run of lines and arcs joined to it end to end; hovering a face goes all the way round its edge.',
      'Click to make it. Corners are mitred like a picture frame; along arcs the result is smooth. Undo takes it back in one step.',
      'If a bend is too tight for the size of the shape, or the shape lies flat along the path, the status bar says so and nothing is made.',
      'Esc lets go of the profile so you can pick another.'
    ]
  },
  {
    id: 'dimensions-labels',
    title: 'Dimensions, Area Labels and Leader Labels',
    category: 'tools',
    content: 'Annotations that stay in the model, unlike the Tape Measure\'s quick check. They are saved, undone and deleted like any object.',
    steps: [
      'Dimension: pick Dimension, click two points (corners snap), then move out to where the line should sit and click. It is drawn like a drawing dimension, with extension lines back to the points and a tick at each end. Esc cancels.',
      'Area Label: pick Area Label and click a drawn face. The label shows its area and perimeter and updates when you push/pull, resize or redraw the face. If the face is deleted it shows the last reading, dimmed.',
      'Leader Label: pick Leader Label, click what to point at, click where the text should go, type it and press Enter. A line joins the text to the point.',
      'Select any of them with Select and press Delete to remove it. Show All Dimensions (left toolbar) still labels every object automatically.',
      'Placed dimensions stay where you put them. If you move the geometry afterwards, move or redraw the dimension.'
    ]
  },
  {
    id: 'tape-measure-guides',
    title: 'Tape Measure and Guide Lines',
    category: 'tools',
    content: 'The Tape Measure measures distances and places guide lines: dashed lines you draw against, like a builder\'s string line. The drawing tools snap onto guides and onto the points where two guides cross.',
    steps: [
      'Measure: pick the Tape Measure, click a corner or any point, then click a second point. The distance stays in the model as a yellow measurement.',
      'Place a guide: click the middle of an edge (it lights up pink when you hover it), a guide, or the red, green or blue axis. Move away from it and click: a guide appears parallel to it at that distance. To be exact, type the distance (e.g. 2.5, 300mm or 8\'6") and press Enter.',
      'Change the last guide: straight after placing one, type a new distance and press Enter. A minus sign puts it on the other side.',
      'Build a grid: pull guides off other guides - for example every 3 m across a plot - and draw walls from crossing to crossing.',
      'Esc cancels a guide or measurement in progress.',
      'Hide or clear guides: Scene Helpers > Guides hides them all (hidden guides are not snapped to), and Delete All Guides removes every guide, including Protractor guides, in one step you can undo. To remove one guide, click it with the Select tool and press Delete.'
    ]
  },
  {
    id: 'skp-import-export',
    title: 'SKP Support',
    category: 'advanced',
    content: 'PolyForm opens and saves real SketchUp (.skp) files, so you can move designs between PolyForm and SketchUp.',
    steps: [
      'Export to SKP: open the menu, go to "Import / Export" and choose "Export SKP". You get a .skp file named after your model that SketchUp opens directly (it is saved in the SketchUp 2013-2020 format, which every newer SketchUp opens).',
      'What you get in SketchUp: shapes you drew with Line, Rectangle, Push/Pull and the other drawing tools arrive as ordinary SketchUp faces, holes included. Each other object (a wall, a roof, the terrain, a plant) arrives as a group named after it, and batched trees and timber arrive as components, so every copy of a tree shares one definition. Colours and transparency come across as named materials; textures do not come across yet.',
      'Import from SKP: in the same menu, click "Import SKP" to pick a .skp file from your computer. It comes into your scene as one object.',
      'Other formats: "Export GLTF" and "Export STL" export the same model - just your design, without the grid, sky or lights - each piece exactly where it sits in the scene.'
    ]
  },
  {
    id: 'embedded-webpages',
    title: 'Embedded Webpages',
    category: 'features',
    content: 'The Embedded Webpage feature allows you to open external URLs directly within a floating window in PolyForm, perfect for referencing documentation or importing assets from web hosted sources.',
    steps: [
      'SDK Trigger: This feature is primarily used by automation scripts. Running `sdk.openWebpage("https://example.com")` will instantly launch the modal.',
      'Contextual Reference: Use this to display manufacturer specification sheets or live data feeds while designing.',
      'Interactive Content: The window is interactive; you can browse and interact with the remote page as you would in a browser tab.',
      'Closing: Click the "X" in the top right or open another webpage to replace the current one.'
    ]
  },
  {
    id: 'open-model-recent',
    title: 'Finding Your Recent Models',
    category: 'getting-started',
    content: 'The Open Model popup now features a dedicated "Recent" section. This is the default view designed to help you quickly jump back into your most active projects.',
    steps: [
      'Click "Open Model" from the main menu or use the Folder icon.',
      'Recent Section: By default, the window opens to the "Recent" tab, which shows your models sorted by the last modified date.',
      'Most Recent First: Your latest work will always appear at the top-left of the grid or top of the list view.',
      'Other Views: Use the filter tabs at the top to switch between "All Models", "Made By Me", and "Shared Models" if you need to find an older or public project.',
      'Search: You can also use the search bar within the Recent section to filter your latest projects by name.'
    ]
  },
  {
    id: 'scenes-panel',
    title: 'Managing Scenes',
    category: 'features',
    content: 'Scenes allow you to save specific camera viewpoints and viewport states, enabling you to quickly switch between different presentations of your design.',
    steps: [
      'Open the Scenes panel in the Right Panel Stack.',
      'Save Scene: Position your camera where you want it and click "+ Save Scene". A thumbnail of your current view will be generated.',
      'Thumbnail Generation: The system renders a fresh snapshot of the viewport ensuring your thumbnail is up-to-date.',
      'Switching Scenes: Click on any scene thumbnail to instantly fly the camera back to that saved position.',
      'Renaming & Management: Right-click a scene thumbnail to rename it or delete it from the design.'
    ]
  }
];
