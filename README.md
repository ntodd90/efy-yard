# efy-yard

Static ArcGIS / Calcite yard operations demo. Open the app through a static server at
http://127.0.0.1:5500/index.html and sign in to the configured ArcGIS organization.

## Warehouse-to-Quay Scenarios

The current workflow is **warehouse to ship-loading quay**, not delivery to
warehouse doors. `QUAY-W` and `QUAY-E` are two explicit land-side handoffs on the
southern quay, corresponding to the supplied ship-loading image. Yellow squares
and labels mark them on the map. Every loaded trip runs directly from a warehouse
storage position to one handoff; the forklift stops on the dock. A berth crane then
transfers the container to its stationary cargo ship. Warehouse doors are routing
access points only. Trailer parking is not used as a warehouse cargo source.

## Cargo Ships and Cranes

Two additional independent GraphicsLayers provide **Cargo ships (Simulated)** and
**Quayside cranes (Simulated)**. Original CAD-style polygon drawings depict fixed,
map-scale coastal cargo vessels at the two berths, with hulls, hatch areas,
superstructures, lifeboats, mooring lines and indicative container stacks. These are
representative 2D drawings, not surveyed CAD or the specifications of the vessels
visible in aerial imagery. Hulls stay fixed; crane booms, spreaders and suspended
containers move on the same simulation clock as the forklifts.

Each completed forklift handoff adds one 20-foot container (1 TEU) to that berth's
queue. Two containers are initially staged at each berth so an initial loading cycle
can start immediately. A ship's onboard cargo increases only when the crane places
its suspended container on deck, not when cargo merely arrives. Loading stops at
100%; excess arrivals remain queued. Scenario switching preserves separate berth
states, pause/speed controls apply to cranes, and Restart resets that scenario's call.

Ship and crane popups include a live capacity meter, TEU onboard/available,
containers loaded this call, quayside queue, achieved lifts/hour, estimated cargo
mass, length/beam, modeled draft, design deadweight, crane outreach/lift rating and
nominal cycle, vessel class, demo registry/call sign, and service. All vessel and
loading values are illustrative; no live AIS, stability calculation or approved
stowage plan is implied. Vessel capacities are 360/240 TEU with 90/80-second crane
cycles and 12 t per simulated container. No hosted data is edited.

Quick Views includes **current pick pattern** and **optimized pick pattern** (keys 1 and 2).
Each has its own four moving forklifts and a travel heatmap built from point breadcrumbs.
Breadcrumbs are point FeatureLayers with forklift IDs and date-valued timestamps.
Travel heat is off by default; the button beside the forklift filter toggles it quickly.
Replay starts at 1x. History options are rolling **30 min, 1 hour, 2 hour and 12 hour**
windows, sampled every 30 simulated seconds. Vehicles and heat use the same cumulative
trip timeline, including warehouse pickups, quay deliveries, queues and reversing.
Stationary samples are retained so waiting areas accumulate density. Larger windows
include all shorter-window samples plus older history, with a fixed renderer density
scale. Replay begins after a matching 12-hour simulated pre-roll, so historical
movement is available immediately; no end-of-week history is invented before the
replay start. Replay speed controls that shared simulation clock. The forklift
selector filters both vehicles and their heat samples. Weekly metrics use all served trips.
Two supporting storage overlays show high-frequency picks in yellow, medium in mint,
and low in dark blue-gray. Ordinary views restore the web map's original styling.

The sidebar compares weekly fleet distance, travel time, pallet picks, traction energy,
distance per pick, handling time, and modeled productivity. Each forklift has its own
weekly totals and estimated battery remaining during replay. Pause, restart, and replay
speed controls do not change the weekly workload.

All activity is **simulated**, not recorded GPS, WMS transactions, or proven savings.
The previous seven complete UTC days are generated at page load with deterministic
SKU demand (56, 21, or 7 picks per storage position per week). Both scenarios retain
the same base SKU demand. The app's optimized scenario adds 5% more served pallet
picks, rounded to whole pallets, as an explicit simulated productivity assumption.
Those additional trips are included in forklift, storage, travel, handling and energy
totals; they are not just a KPI display adjustment. The pure model's default comparison
retains equal demand unless the uplift option is enabled. The current scenario sends
shared order batches to the same busy rack aisles. Optimized slotting balances dock
distance against spatial crowding and aisle demand within warehouse storage,
spreading high-volume products instead of clustering them at the closest handoff.
Three forklifts have zoned picking assignments; FL-04
serves the farthest quarter of reachable racks, including its initial replay trip.
Empty travel from the previous quay handoff to the next warehouse pickup is
included in travel totals, along with the direct loaded trip back to the quay.

The routing plans now differ operationally, not just in storage colors. The current
baseline uses the shared outer network and does not enable the central link between
Warehouses C and E. The proposed optimized plan enables that link and uses validated
corridor legs when shorter, or within 5% of the outer-route distance to spread traffic.
Its placement and dispatch costs use those actual optimized routes. The two grids
share the same land/obstacle mask; a corridor access rule never creates walkable cells
inside water, racks, parked trailers or walls. Only warehouse positions reachable in
both plans participate in the comparison. The sidebar reports routing policy and
central-corridor trip counts. Enabling this proposed corridor requires operational
approval; the results are modeled, not a measured infrastructure improvement.

A synthetic manifest assigns each cargo group to a fixed quay before either plan is
built. That destination is held constant when optimized stock is relocated. The
current plan stores cargo wherever space is available; the optimized plan positions
cargo nearer its required quay while spreading busy aisles. Savings therefore do
not come from quietly changing a cargo group's ship-loading destination. This
manifest is generated demo data, not an uploaded vessel cargo manifest.

The optimized plan reserves a share of west-bound fast movers in a central Warehouse E
picking cell, relieving the busiest west-side aisles. FL-03 serves that zone and its
central-corridor route; FL-04 retains farther-rack work outside the central cell.
This is a proposed storage/dispatch layout, not a cosmetic change to the heat layer.
Unreachable storage stays colored on the map but is excluded from both scenarios'
travel totals. Optimization preserves the served workload and does not relocate
reachable demand into unreachable storage. The optional optimized uplift adds work
only at reachable positions.

Assumptions: 7.2 km/h, 35 seconds picking, 25 seconds unloading, 24 kWh batteries,
and 0.45 kWh/km traction energy. Battery estimates exclude charging and auxiliary loads.
Only ground-floor warehouse racks are used as illustrative container pickup
positions, not surveyed container inventory. Cold-chain, capacity, relocation cost,
aisle clearance, and operational scheduling constraints are not validated.

A shared-aisle reservation model schedules pick approaches across all four forklifts.
If an approach is occupied, the arriving forklift backs up a short distance along
its validated route, waits for the preceding forklift to clear, and advances again.
No sideways motion or off-route passing path is invented. Weekly queue/maneuver
delays, conflict counts and total labor time include this behavior; maneuver distance
also contributes to travel and traction energy. The animation uses the same delayed
trip timeline as the rolling heat samples. This is illustrative aisle traffic, not
a validated warehouse traffic-control or collision-avoidance system.

Routing uses the pinned CDN `pathfinding` A* engine on a 1.25 m grid. Cells are limited
to the mapped site land, outdoor yard and accessible ground-floor units; racks,
parked trailers and mapped walls are obstacles. Mapped loading-door openings connect
the yard to indoor storage. Delivery endpoints are on the land-side ship-loading
quay, not at warehouse doors or on ships. Storage endpoints snap to an accessible
aisle within 8 m, rather than to a rack's center.
Diagonal corner-cutting is disabled. Simplified route segments must remain on
walkable cells. There is no unrestricted fallback for disconnected routes.
The three geometrically closest compatible docks are considered for each position.
Mapped geometry is illustrative: clearance, door permissions, traffic and actual
operational routes still require validation. No published indoor routing service is
configured.

Vehicle layers and storage overlays are client-side GraphicsLayers; breadcrumbs
are client-side point FeatureLayers, visible in Layers. They do not modify hosted
inventory, publish new services, or persist historical telemetry. Original layer
filters are retained.

Routing and scenario construction run in a module Web Worker. The map and Quick
Views load independently, with picking progress shown when a picking bookmark is
selected. Worker or CDN failures leave the yard map usable and report the picking
error instead of blocking application startup. Each browser requires its own ArcGIS
sign-in. Use the registered local URL exactly: http://127.0.0.1:5500/index.html.

The compact pixel-style loading bar is work-driven, not timer-driven.
Its weighted phases count completed layer queries, navigation rows, route/scenario
construction and layer initialization. It stays below 100% until both scenarios'
sources are loaded and the active scenario's map layer views are ready. The 100%
frame appears as the ready controls replace loading, then fades out; errors never
report successful completion. The percentage is completed preparation work, not an
estimate of remaining seconds.

## Verification

Run the focused model tests with Node.js:

```sh
node --test picking.test.js
```

The app itself remains static and CDN-based, with no npm dependencies or build step.

The **Yard Overview** heading button restores the initial web-map camera, layer and
group visibility, feature filters, floor selection, and overview panel. It also clears
active quick-view highlighting and popups, resets the dock-door filter, forklift
simulation, travel heat, ship loading, and replay speed.