export const BERTH_VESSELS = [
  {
    id: "EFY-V01", berth: "QUAY-W", berthName: "West berth", name: "MV Eemhaven Trader", vesselType: "Coastal container / general cargo", callSign: "EFY-W01",
    center: [87810, 433112], heading: 110.2, length: 138, beam: 20.8, capacityTeu: 360, initialTeu: 162, deadweight: 7800,
    lightDraft: 3.8, ladenDraft: 6.8, containerTonnes: 12, craneCapacity: 45, craneReach: 58, cycleSeconds: 90,
    craneBase: [87754, 433172], handoff: [87745, 433168], initialStaged: 2, flag: "Netherlands (demo)", destination: "North Sea coastal service", hullColor: "#465c65"
  },
  {
    id: "EFY-V02", berth: "QUAY-E", berthName: "East berth", name: "MV Maas Feeder", vesselType: "Short-sea container feeder", callSign: "EFY-E01",
    center: [88630, 432824], heading: 110.2, length: 112, beam: 17.6, capacityTeu: 240, initialTeu: 96, deadweight: 5100,
    lightDraft: 3.3, ladenDraft: 5.8, containerTonnes: 12, craneCapacity: 35, craneReach: 48, cycleSeconds: 80,
    craneBase: [88629, 432866], handoff: [88620, 432861], initialStaged: 2, flag: "Netherlands (demo)", destination: "Benelux feeder service", hullColor: "#75534f"
  }
];

export function vesselPoint(vessel, along, across) {
  const radians = vessel.heading * Math.PI / 180;
  return [vessel.center[0] + Math.sin(radians) * along - Math.cos(radians) * across,
    vessel.center[1] + Math.cos(radians) * along + Math.sin(radians) * across];
}

export function cargoDeliveryEvents(timeline, fromSeconds, toSeconds) {
  if (!timeline.trips.length || toSeconds <= fromSeconds || timeline.duration <= 0) return [];
  const events = [];
  let cycle = Math.floor(Math.max(0, fromSeconds) / timeline.duration);
  const local = Math.max(0, fromSeconds) % timeline.duration;
  let low = 0, high = timeline.trips.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timeline.seconds[middle + 1] <= local) low = middle + 1;
    else high = middle;
  }
  let index = low;
  while (true) {
    const atSeconds = cycle * timeline.duration + timeline.seconds[index + 1];
    if (atSeconds > toSeconds) break;
    const trip = timeline.trips[index];
    if (atSeconds > fromSeconds && trip.slot?.dock?.kind === "quay") events.push({ berth: trip.slot.dock.id, atSeconds, units: 1 });
    index++;
    if (index === timeline.trips.length) { index = 0; cycle++; }
  }
  return events;
}

export function createBerthState(vessel) {
  return { vessel, onboard: vessel.initialTeu, loadedThisCall: 0, received: 0, queue: vessel.initialStaged,
    active: false, released: false, cycleElapsed: 0, elapsed: 0, completedCycles: 0 };
}

export function advanceBerth(state, seconds, arrivals = []) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Berth step must be a nonnegative finite duration.");
  const events = [...arrivals].sort((first, second) => first.offsetSeconds - second.offsetSeconds);
  if (events.some((event) => !Number.isFinite(event.offsetSeconds) || event.offsetSeconds < 0 || event.offsetSeconds > seconds || !Number.isInteger(event.units) || event.units < 0)) throw new Error("Cargo deliveries must occur within the berth step.");
  let time = 0, index = 0;
  const receiveArrivals = () => {
    while (index < events.length && events[index].offsetSeconds <= time + 1e-8) {
      state.queue += events[index].units;
      state.received += events[index].units;
      index++;
    }
  };
  while (time < seconds || (index < events.length && events[index].offsetSeconds <= time)) {
    receiveArrivals();
    if (!state.active && state.queue > 0 && state.onboard < state.vessel.capacityTeu) {
      state.queue--; state.active = true; state.released = false; state.cycleElapsed = 0;
    }
    const dropAt = state.vessel.cycleSeconds * 0.65;
    const phaseRemaining = state.active ? (state.released ? state.vessel.cycleSeconds : dropAt) - state.cycleElapsed : Infinity;
    const nextEvent = index < events.length ? events[index].offsetSeconds : Infinity;
    const delta = Math.min(seconds - time, Math.max(0, nextEvent - time), Math.max(0, phaseRemaining));
    if (delta > 0) { time += delta; if (state.active) state.cycleElapsed += delta; }
    if (state.active && !state.released && state.cycleElapsed >= dropAt - 1e-8) {
      state.onboard++; state.loadedThisCall++; state.released = true;
    }
    if (state.active && state.cycleElapsed >= state.vessel.cycleSeconds - 1e-8) {
      state.active = false; state.completedCycles++; state.cycleElapsed = 0;
    }
    if (time >= seconds) { receiveArrivals(); break; }
    if (!state.active && index >= events.length && (state.queue === 0 || state.onboard >= state.vessel.capacityTeu)) { time = seconds; break; }
  }
  state.elapsed += seconds;
  return state;
}

export function berthSnapshot(state) {
  const vessel = state.vessel, fraction = state.active ? state.cycleElapsed / vessel.cycleSeconds : 0;
  const phase = !state.active ? state.onboard >= vessel.capacityTeu ? "Vessel at capacity" : "Waiting for cargo"
    : fraction < 0.15 ? "Hoisting at handoff" : fraction < 0.55 ? "Slewing to vessel" : fraction < 0.65 ? "Lowering onto vessel" : "Returning spreader";
  return {
    onboard: state.onboard, capacity: vessel.capacityTeu, percentFull: state.onboard / vessel.capacityTeu * 100,
    remaining: vessel.capacityTeu - state.onboard, loadedThisCall: state.loadedThisCall, queue: state.queue, received: state.received,
    active: state.active, released: state.released, fraction, phase, elapsed: state.elapsed,
    cargoTonnes: state.onboard * vessel.containerTonnes, liftsPerHour: state.elapsed > 0 ? state.loadedThisCall * 3600 / state.elapsed : 0,
    estimatedDraft: vessel.lightDraft + (vessel.ladenDraft - vessel.lightDraft) * state.onboard / vessel.capacityTeu
  };
}

export function cranePose(vessel, snapshot, target) {
  const startAngle = Math.atan2(vessel.handoff[1] - vessel.craneBase[1], vessel.handoff[0] - vessel.craneBase[0]);
  const endAngle = Math.atan2(target[1] - vessel.craneBase[1], target[0] - vessel.craneBase[0]);
  let difference = ((endAngle - startAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const phase = snapshot.fraction;
  const raw = !snapshot.active || phase < 0.15 ? 0 : phase < 0.55 ? (phase - 0.15) / 0.4 : phase < 0.72 ? 1 : 1 - (phase - 0.72) / 0.28;
  const blend = Math.max(0, Math.min(1, raw)), eased = blend * blend * (3 - 2 * blend);
  const startRadius = Math.hypot(vessel.handoff[0] - vessel.craneBase[0], vessel.handoff[1] - vessel.craneBase[1]);
  const endRadius = Math.hypot(target[0] - vessel.craneBase[0], target[1] - vessel.craneBase[1]);
  const radius = startRadius + (endRadius - startRadius) * eased, angle = startAngle + difference * eased;
  return { hook: [vessel.craneBase[0] + Math.cos(angle) * radius, vessel.craneBase[1] + Math.sin(angle) * radius], angle,
    carrying: snapshot.active && !snapshot.released && phase >= 0.08, phase: snapshot.phase };
}