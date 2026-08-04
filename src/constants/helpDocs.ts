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
      'Use the Push-Pull tool afterwards to adjust height precisely.'
    ]
  },
  {
    id: 'poly-tool',
    title: 'Poly Tool',
    category: 'tools',
    content: 'The Poly Tool allows you to trace custom polygons on the ground or existing object faces. It is ideal for creating irregular floor plans or custom profiles that can be extruded using the Push-Pull tool.',
    steps: [
      'Select the Poly Tool from the Line sub-menu (click the Pen Line icon to reveal more tools).',
      'Set First Vertex: Click on the ground or a shape face to set the starting point and lock the drawing plane.',
      'Trace Shape: Click to place additional vertices. A preview line follows your cursor.',
      'Snap to Start: When your cursor is near the first vertex, it will highlight in yellow. Click to close the shape.',
      'Finalize via Keyboard: Press Enter to automatically close the shape from your last vertex back to the first.',
      'Undo & Cancel: Press Ctrl+Z to undo the last vertex placed, or Esc to cancel the entire drawing.',
      'Extrude: Once the 2D surface is created, use the Push-Pull tool (P) to pull it into a 3D solid.'
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
    title: 'Push-Pull Tool',
    category: 'tools',
    content: 'The Push-Pull tool is the fundamental method for extruding 2D shapes into 3D volumes or adjusting the faces of existing 3D objects. It now features full support for Poly tool surfaces.',
    steps: [
      'Select the Push-Pull tool (or press P).',
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
    content: 'The SDK has been expanded to support programmatic polygon creation. This allows you to generate custom 2D surfaces that are immediately compatible with the Push-Pull tool.',
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
    id: 'sketchup-import-export',
    title: 'SketchUp (.skp) Support',
    category: 'advanced',
    content: 'DraftUp provides high-fidelity bridge support for SketchUp files, allowing you to move designs between DraftUp and SketchUp with minimal data loss.',
    steps: [
      'Export to SKP: Go to the "Burger" menu, hover over "Export", and select "Export SKP". This packages your scene into a SketchUp-optimized format.',
      'Importing to SketchUp: Open SketchUp and use the Import function to bring your DraftUp design into your workspace.',
      'Import from SKP: In the same menu, click "Import SKP" to select a file from your computer and bring it into your current DraftUp scene as a custom object group.',
      'Bridge Format: The system currently uses an industry-standard GLTF/JSON bridge for maximum compatibility across different SketchUp versions.'
    ]
  },
  {
    id: 'embedded-webpages',
    title: 'Embedded Webpages',
    category: 'features',
    content: 'The Embedded Webpage feature allows you to open external URLs directly within a floating window in DraftUp, perfect for referencing documentation or importing assets from web hosted sources.',
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
