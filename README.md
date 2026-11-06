# efy-yard

Static ArcGIS / Calcite yard operations demo. Open the app through a static server at
http://127.0.0.1:5500/index.html and sign in to the configured ArcGIS organization.

## Beer Distribution Picking Scenarios

Quick Views includes **current pick pattern** and **optimized pick pattern** (keys 1 and 2).
Each has its own four moving forklifts and uniquely colored point breadcrumbs.
Breadcrumbs are point FeatureLayers with forklift IDs and date-valued timestamps.
The default map shows a rolling 30-minute simulation window, sampled every 30
simulated seconds. Samples follow the routed positions, including stops; repeated
stationary samples are omitted. Replay speed controls the simulation clock.
The forklift selector filters individual trails, and dated history shows a 30-minute
window ending at that day's final synthetic event. Weekly metrics use all served trips.
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
retains equal demand unless the uplift option is enabled. Current fast movers are dispersed;
optimized SKU groups are assigned to storage positions ranked by nearest operational
dock travel distance, separately for pallet racks and trailer/container positions.
Empty repositioning between successive delivery docks is included in travel totals.
Unreachable storage stays colored on the map but is excluded from both scenarios'
travel totals. Optimization preserves the served workload and does not relocate
reachable demand into unreachable storage. The optional optimized uplift adds work
only at reachable positions.

Assumptions: 7.2 km/h, 35 seconds picking, 25 seconds unloading, 24 kWh batteries,
and 0.45 kWh/km traction energy. Battery estimates exclude charging and auxiliary loads.
Only ground-floor racks are used. Trailer parking stalls are a **container-storage
proxy**, not actual container inventory. Cold-chain, capacity, relocation cost, congestion,
aisle clearance, and operational scheduling constraints are not modeled.

Routing uses the pinned CDN `pathfinding` A* engine on a 1.25 m grid. Cells are limited
to the mapped site land, outdoor yard and accessible ground-floor units; racks,
parked trailers and mapped walls are obstacles. Mapped loading-door openings connect
the yard to indoor staging. Delivery endpoints are 4 m inside the dock face; storage
endpoints snap to an accessible aisle within 8 m, rather than to a pallet's center.
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

## Verification

Run the focused model tests with Node.js:

```sh
node --test picking.test.js
```

The app itself remains static and CDN-based, with no npm dependencies or build step.