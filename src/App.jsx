import React, { useState } from "react";
import {
  GoogleMap,
  LoadScript,
  DirectionsRenderer,
  Marker
} from "@react-google-maps/api";
import { vendingMachines } from "./machines";
import ProgressBar from "./ProgressBar";
import "./App.css";

const containerStyle = {
  width: "100%",
  height: "100%"
};

const center = {
  lat: 39.7392,
  lng: -104.9903
};

function App() {
  // Route input states
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");

  // Route & UI states
  const [directions, setDirections] = useState(null);
  const [filteredMachines, setFilteredMachines] = useState([]);
  const [routeDetails, setRouteDetails] = useState([]);
  const [totalExtraTime, setTotalExtraTime] = useState(null);
  const [baseDuration, setBaseDuration] = useState(null);
  
  // New state to store the departure time (when route planning began)
  const [routeStartTime, setRouteStartTime] = useState(null);

  // Show/hide splash screen, loading state, and progress
  const [showSplash, setShowSplash] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Toggle between recommended stops vs. all machines
  const [showAllLocations, setShowAllLocations] = useState(false);

  // Safely get DirectionsService if google is loaded
  const getDirectionsService = () => {
    if (!window.google || !window.google.maps) {
      console.error("Google Maps script not loaded yet!");
      return null;
    }
    return new window.google.maps.DirectionsService();
  };

  // Update the route and compute ETA for each leg
  // Accepts an optional departureTime; if not provided, uses routeStartTime (or new Date() as fallback)
  const updateOptimizedRoute = async (stops, departureTime = routeStartTime || new Date()) => {
    const directionsService = getDirectionsService();
    if (!directionsService) return Infinity;

    if (stops.length > 0) {
      try {
        const optimizedResult = await new Promise((resolve, reject) => {
          directionsService.route(
            {
              origin: start,
              destination: end,
              travelMode: window.google.maps.TravelMode.DRIVING,
              waypoints: stops.map((vm) => ({
                location: { lat: vm.lat, lng: vm.lng },
                stopover: true
              })),
              optimizeWaypoints: true
            },
            (result, status) => {
              if (status === "OK") resolve(result);
              else reject("Optimized route failed: " + status);
            }
          );
        });
        setDirections(optimizedResult);

        const legs = optimizedResult.routes[0].legs;
        const optimizedDuration = legs.reduce(
          (sum, leg) => sum + leg.duration.value,
          0
        );
        const extraTime = ((optimizedDuration - baseDuration) / 60).toFixed(2);
        setTotalExtraTime(extraTime);

        // Compute ETA for each leg using cumulative duration added to departureTime
        let cumulativeTime = 0;
        const routeStops = legs.map((leg) => {
          cumulativeTime += leg.duration.value; // duration.value is in seconds
          const eta = new Date(departureTime.getTime() + cumulativeTime * 1000);
          const hours = eta.getHours().toString().padStart(2, "0");
          const minutes = eta.getMinutes().toString().padStart(2, "0");
          return {
            start: leg.start_address,
            end: leg.end_address,
            duration: leg.duration.text,
            eta: `${hours}:${minutes}`
          };
        });
        setRouteDetails(routeStops);

        return optimizedDuration;
      } catch (err) {
        console.error(err);
        return Infinity;
      }
    } else {
      setTotalExtraTime(0);
      return baseDuration;
    }
  };

  // Remove a stop and update the route (ETA recalculated)
  const removeStop = async (stopToRemove) => {
    const updatedStops = filteredMachines.filter(
      (vm) => vm.label !== stopToRemove.label
    );
    setFilteredMachines(updatedStops);
    await updateOptimizedRoute(updatedStops);
  };

  // Main route planning function (with simulated progress)
  const handleRoute = async () => {
    if (!start || !end || !arrivalTime) {
      alert("Please fill in all fields.");
      return;
    }

    setLoading(true);
    setProgress(0);

    const directionsService = getDirectionsService();
    if (!directionsService) {
      alert("Google Maps not loaded yet. Try again in a moment.");
      setLoading(false);
      return;
    }

    try {
      // Set the departure time as now and store it
      const currentDepartureTime = new Date();
      setRouteStartTime(currentDepartureTime);

      // Step 1: Get base route
      setProgress(20);
      const baseResult = await new Promise((resolve, reject) => {
        directionsService.route(
          {
            origin: start,
            destination: end,
            travelMode: window.google.maps.TravelMode.DRIVING
          },
          (result, status) => {
            if (status === "OK") resolve(result);
            else reject("Base route failed: " + status);
          }
        );
      });
      setProgress(40);
      setDirections(baseResult);
      const baseDurationVal = baseResult.routes[0].legs[0].duration.value;
      setBaseDuration(baseDurationVal);

      // Step 2: Check available time (for desired arrival)
      const now = new Date();
      const [inputHours, inputMinutes] = arrivalTime.split(":").map(Number);
      let arrivalDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        inputHours,
        inputMinutes
      );
      if (arrivalDate < now) {
        arrivalDate.setDate(arrivalDate.getDate() + 1);
      }
      const availableTimeInSeconds = (arrivalDate.getTime() - now.getTime()) / 1000;
      if (availableTimeInSeconds < baseDurationVal) {
        alert("Your desired arrival time is too soon for the base route!");
        throw new Error("Insufficient available time");
      }
      setProgress(50);

      // Step 3: Identify nearby vending machines along route
      const baseRoute = baseResult.routes[0].overview_path;
      const bounds = new window.google.maps.LatLngBounds();
      baseRoute.forEach((point) => bounds.extend(point));
      const nearbyMachines = vendingMachines.filter((vm) =>
        bounds.contains(new window.google.maps.LatLng(vm.lat, vm.lng))
      );
      setProgress(60);

      // Step 4: Evaluate candidate stops
      let candidateStops = [];
      for (const vm of nearbyMachines) {
        const result = await new Promise((resolve) => {
          directionsService.route(
            {
              origin: start,
              destination: end,
              travelMode: window.google.maps.TravelMode.DRIVING,
              waypoints: [{ location: { lat: vm.lat, lng: vm.lng }, stopover: true }]
            },
            (result, status) => {
              if (status === "OK") resolve(result);
              else resolve(null);
            }
          );
        });
        if (!result) continue;
        const detourDuration = result.routes[0].legs.reduce(
          (sum, leg) => sum + leg.duration.value,
          0
        );
        const addedTime = (detourDuration - baseDurationVal) / 60;
        if (addedTime <= 10) {
          candidateStops.push({ ...vm, extraTime: Number(addedTime.toFixed(2)) });
        }
      }
      candidateStops.sort((a, b) => a.extraTime - b.extraTime);
      setProgress(70);

      // Step 5: Incrementally add stops
      let selectedStops = [];
      for (const candidate of candidateStops) {
        const testStops = [...selectedStops, candidate];
        const optimizedDuration = await updateOptimizedRoute(testStops);
        if (optimizedDuration <= availableTimeInSeconds) {
          selectedStops = testStops;
        }
      }
      setFilteredMachines(selectedStops);
      await updateOptimizedRoute(selectedStops);
      setProgress(100);

      setLoading(false);
      setShowSplash(false);
    } catch (error) {
      console.error("Error during route planning:", error);
      setLoading(false);
      alert("An error occurred while planning the route. Check console for details.");
    }
  };

  // Determine which machines to show on the map
  const machinesToShow = showAllLocations ? vendingMachines : filteredMachines;

  return (
    <LoadScript googleMapsApiKey="AIzaSyDpyRnklwbrsqkjAZkqi7Tg6QDuSWSfqiE">
      <div className="app-wrapper">
        {/* Splash Screen */}
        {showSplash && (
          <div className="splash">
            <div className="splash-content">
              <h1>Route Planner</h1>
              <div className="form-fields">
                <label htmlFor="start">Start Location</label>
                <input
                  id="start"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  placeholder="Enter start location"
                />
                <label htmlFor="end">Destination</label>
                <input
                  id="end"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  placeholder="Enter destination"
                />
                <label htmlFor="arrivalTime">Arrival Time</label>
                <input
                  id="arrivalTime"
                  type="time"
                  value={arrivalTime}
                  onChange={(e) => setArrivalTime(e.target.value)}
                  placeholder="HH:MM"
                />
              </div>
              {loading ? (
                <ProgressBar progress={progress} />
              ) : (
                <button onClick={handleRoute}>Plan Route</button>
              )}
            </div>
          </div>
        )}

        {/* Main Layout */}
        {!showSplash && (
          <div className="main-container">
            <div className="sidebar-content">
              <h2>Your Route</h2>
              {/* Side form for planning new routes */}
              <div className="side-form">
                <label>Start</label>
                <input
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  placeholder="Enter start location"
                />
                <label>Destination</label>
                <input
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  placeholder="Enter destination"
                />
                <label>Arrival Time</label>
                <input
                  type="time"
                  value={arrivalTime}
                  onChange={(e) => setArrivalTime(e.target.value)}
                />
                <button onClick={handleRoute} disabled={loading}>
                  {loading ? "Loading..." : "Plan New Route"}
                </button>
              </div>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showAllLocations}
                  onChange={() => setShowAllLocations(!showAllLocations)}
                />
                Show all vending machines
              </label>

              {/* Vending Machines on Your Route */}
              <div className="stops-container">
                <h3>Vending Machines on Your Route</h3>
                <div className="stop-list">
                  {filteredMachines.length === 0 ? (
                    <p className="no-stops">No recommended stops found.</p>
                  ) : (
                    filteredMachines.map((vm, idx) => (
                      <div className="stop-item" key={idx}>
                        <div className="stop-info">
                          <span className="stop-label">{vm.label}</span>
                          <span className="stop-extra">+{vm.extraTime} min</span>
                        </div>
                        <button onClick={() => removeStop(vm)}>Remove</button>
                      </div>
                    ))
                  )}
                </div>
                {totalExtraTime !== null && (
                  <p className="extra-time">
                    Total extra time added: <strong>{totalExtraTime} minutes</strong>
                  </p>
                )}
              </div>

              {/* Route Steps with ETA */}
              <div className="route-steps-container">
                <h3>Route Steps</h3>
                <div className="route-list">
                  {routeDetails.length === 0 ? (
                    <p className="no-route-details">No route details yet.</p>
                  ) : (
                    routeDetails.map((leg, idx) => (
                      <div className="route-step" key={idx}>
                        <p>
                          <strong>From:</strong> {leg.start}
                        </p>
                        <p>
                          <strong>To:</strong> {leg.end}
                        </p>
                        <p>
                          <strong>Duration:</strong> {leg.duration}
                        </p>
                        <p>
                          <strong>ETA:</strong> {leg.eta}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="map-container">
              <GoogleMap mapContainerStyle={containerStyle} center={center} zoom={10}>
                {directions && <DirectionsRenderer directions={directions} />}
                {machinesToShow.map((vm, index) => (
                  <Marker
                    key={index}
                    position={{ lat: vm.lat, lng: vm.lng }}
                    label={vm.label}
                  />
                ))}
              </GoogleMap>
            </div>
          </div>
        )}
      </div>
    </LoadScript>
  );
}

export default App;
