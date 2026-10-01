# Beta day cycle and presentation refinements

Beta exposes time (UTC) without a date field. The retained model date supplies the season; day-cycle animation wraps midnight on that date rather than changing seasons. Physical sky and stars are always enabled with Beta. The saved compatibility fields normalize to sky=true, stars=true and starIntensity=10, including older models.

Animate day cycle defaults off. Speed ranges from 0.05 to 2 simulated hours per real second (a full day in 480 to 12 seconds); default 0.2 gives 120 seconds. Sun, sky illumination and star orientation advance each frame. Pausing or disabling Beta retains the displayed time. Animation does not write model state each frame. A persistent HDR sky cubemap refreshes at most four times per second; star geometry remains allocated and rotates with horizon clipping. Long background-tab gaps are limited to prevent jumping through the day on resume.

Presentation hides the infinite grid, world axis lines and corner axis gizmo by masking their visibility while active. Editor preferences remain untouched and take effect again immediately on exit. Sketch includes main roof geometry even above the previous 20,000-vertex limit, plus gable infill and flat roof decks. Tile and trim detail remains deferred. Pencil duration is 75% of the previous duration: 18–31.5 seconds instead of 24–42.

Validation: 39 targeted tests across five files, TypeScript checking and production Vite build. Unsaved browser fixtures verified manual midnight, star intensity 10 at night, day-cycle speed and pause, moving sun/stars with unchanged camera and star geometry, roof sketch visibility, and restoration of grid/axis helpers after presentation. Browser fixtures and screenshots are excluded from commits.
