import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Map, { Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { LineChart, Line, XAxis, YAxis } from 'recharts';

// Sample data generator for people's positions
const generatePeople = (count, bounds) => {
  const people = Array(count).fill().map((_, i) => ({
    id: i,
    coordinates: [
      bounds.lng.min + Math.random() * (bounds.lng.max - bounds.lng.min),
      bounds.lat.min + Math.random() * (bounds.lat.max - bounds.lat.min)
    ],
    destination: [
      bounds.lng.min + Math.random() * (bounds.lng.max - bounds.lng.min),
      bounds.lat.min + Math.random() * (bounds.lat.max - bounds.lat.min)
    ],
    color: `rgb(${Math.floor(Math.random() * 100)},${Math.floor(Math.random() * 155 + 100)},${Math.floor(Math.random() * 100)})`, // Green tints
    progress: 0,
    isDestabilized: false, // Default not destabilized
    infectionTime: null, // Track when agent was infected
    speed: 0.002 + Math.random() * 0.002 // Reduced, more consistent movement speeds
  }));
  
  // Set first agent to be destabilized
  people[0].isDestabilized = true;
  people[0].infectionTime = Date.now();
  people[0].color = 'rgb(255, 50, 50)'; // Start with bright red for patient zero
  
  return people;
};

// SF bounds (approximately covering the main SF area)
const SF_BOUNDS = {
  lng: { min: -122.51, max: -122.39 }, // From Golden Gate Park to Bay Bridge
  lat: { min: 37.70, max: 37.80 }      // From Hunters Point to Marina District
};

// Central location for visualization context
const SPECIAL_LOCATION = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [-122.3965992, 37.7883739]
    }
  }]
};

export default function Home() {
  const [viewState, setViewState] = useState({
    longitude: -122.43, // Center of SF
    latitude: 37.75,
    zoom: 12          // Zoom level for SF area
  });
  
  const [people, setPeople] = useState([]);
  const [hidePeople, setHidePeople] = useState(false);
  const [simulationActive, setSimulationActive] = useState(false);
  const [infectionRadius, setInfectionRadius] = useState(0.003); // Radius for infection spread
  const [statistics, setStatistics] = useState({
    totalAgents: 0,
    infectedAgents: 0,
    infectionRate: 0
  });
  const animationRef = useRef(null);
  const lastUpdateTimeRef = useRef(Date.now());
  const [connections, setConnections] = useState([]);
  const [infectionHistory, setInfectionHistory] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const startTimeRef = useRef(Date.now());
  const maxStatsRef = useRef({
    infectedAgents: 1,
    infectionRate: 0.5
  });

  // Initialize people data
  useEffect(() => {
    const initialPeople = generatePeople(200, SF_BOUNDS);
    setPeople(initialPeople);
    setStatistics({
      totalAgents: initialPeople.length,
      infectedAgents: 1, // Start with one infected
      infectionRate: (1 / initialPeople.length * 100).toFixed(1)
    });
    setInfectionHistory([{ time: 0, infected: 1 }]);
    setCurrentTime(0);
  }, []);

  // Helper function to calculate distance between two points
  const calculateDistance = (point1, point2) => {
    const dx = point1[0] - point2[0];
    const dy = point1[1] - point2[1];
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Animation loop for moving people and handling infections
  useEffect(() => {
    if (!simulationActive) return;

    const animatePeople = () => {
      const now = Date.now();
      const timeDelta = now - lastUpdateTimeRef.current;
      lastUpdateTimeRef.current = now;
      
      // Track new connections for visualization
      const newConnections = [];
      
      setPeople(prevPeople => {
        let infectedCount = 0;
        const updatedPeople = prevPeople.map(person => {
          // Calculate new position based on linear interpolation
          let progress = person.progress + (person.speed * (timeDelta / 30));
          
          // If reached destination, set new destination
          if (progress >= 1) {
            // Instead of teleporting, set a new destination from current location
            return {
              ...person,
              destination: [
                SF_BOUNDS.lng.min + Math.random() * (SF_BOUNDS.lng.max - SF_BOUNDS.lng.min),
                SF_BOUNDS.lat.min + Math.random() * (SF_BOUNDS.lat.max - SF_BOUNDS.lat.min)
              ],
              progress: 0
            };
          }
          
          // Smoother linear interpolation with controlled step size to prevent large jumps
          const step = Math.min(person.speed * (timeDelta / 30), 0.01); // Cap maximum movement per frame
          const newLng = person.coordinates[0] + (person.destination[0] - person.coordinates[0]) * step;
          const newLat = person.coordinates[1] + (person.destination[1] - person.coordinates[1]) * step;
          
          // Update person with new position
          const updatedPerson = {
            ...person,
            coordinates: [newLng, newLat],
            progress
          };
          
          if (updatedPerson.isDestabilized) {
            infectedCount++;
          }
          
          return updatedPerson;
        });
        
        // Check for new infections after updating positions
        const newlyInfected = [];
        
        // For each infected person, check for nearby non-infected people
        updatedPeople.forEach(person => {
          if (person.isDestabilized) {
            updatedPeople.forEach(otherPerson => {
              if (!otherPerson.isDestabilized) {
                const distance = calculateDistance(person.coordinates, otherPerson.coordinates);
                
                // If within infection radius, infect the other person
                if (distance < infectionRadius) {
                  otherPerson.isDestabilized = true;
                  otherPerson.infectionTime = now;
                  
                  // Red color for newly infected
                  otherPerson.color = 'rgb(255, 50, 50)';
                  
                  newlyInfected.push(otherPerson.id);
                  
                  // Add connection for visualization
                  newConnections.push({
                    id: `${person.id}-${otherPerson.id}`,
                    source: [...person.coordinates],
                    target: [...otherPerson.coordinates],
                    timestamp: now
                  });
                }
              }
            });
          }
        });
        
        // Fade color based on infection time
        updatedPeople.forEach(person => {
          if (person.isDestabilized && person.infectionTime) {
            const timeSinceInfection = now - person.infectionTime;
            if (timeSinceInfection > 10000) { // After 10 seconds, stabilize color
              if (person.color !== 'rgb(180, 0, 120)') { // Final color (deep magenta)
                person.color = 'rgb(180, 0, 120)';
              }
            } else {
              // Transition from red to magenta
              const ratio = Math.min(timeSinceInfection / 10000, 1);
              const r = Math.floor(255 - (75 * ratio));
              const g = Math.floor(0 + (0 * ratio));
              const b = Math.floor(50 + (70 * ratio));
              person.color = `rgb(${r}, ${g}, ${b})`;
            }
          }
        });
        
        // Get current max infected count from history
        const currentMaxInfected = infectionHistory.length > 0 
          ? Math.max(...infectionHistory.map(h => h.infected))
          : 0;

        // Only use the higher value between current infected and historical max
        const finalInfectedCount = Math.max(infectedCount, currentMaxInfected);
        
        // Update statistics with monotonic count
        const stats = {
          totalAgents: updatedPeople.length,
          infectedAgents: finalInfectedCount,
          infectionRate: (finalInfectedCount / updatedPeople.length * 100).toFixed(1)
        };

        // Update maxStatsRef with highest values
        maxStatsRef.current = {
          infectedAgents: Math.max(maxStatsRef.current.infectedAgents, stats.infectedAgents),
          infectionRate: Math.max(maxStatsRef.current.infectionRate, parseFloat(stats.infectionRate))
        };

        setStatistics(maxStatsRef.current);
        
        // Add new data point to infection history with monotonic count
        const timeElapsed = (now - startTimeRef.current) / 1000;
        setCurrentTime(timeElapsed);
        
        setInfectionHistory(prev => [
          ...prev, 
          {
            time: timeElapsed.toFixed(1),
            infected: finalInfectedCount
          }
        ]);
        
        return updatedPeople;
      });
      
      // Update connections
      setConnections(prevConnections => {
        // Add new connections
        const updatedConnections = [...prevConnections, ...newConnections];
        
        // Remove connections older than 2 seconds
        return updatedConnections.filter(conn => now - conn.timestamp < 2000);
      });
      
      animationRef.current = requestAnimationFrame(animatePeople);
    };
    
    animationRef.current = requestAnimationFrame(animatePeople);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [simulationActive, infectionRadius]);

  // Convert people data to GeoJSON
  const peopleGeoJSON = {
    type: 'FeatureCollection',
    features: people.map(person => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: person.coordinates
      },
      properties: {
        id: person.id,
        isDestabilized: person.isDestabilized,
        color: person.color
      }
    }))
  };
  
  // Convert connections to GeoJSON for lines
  const connectionsGeoJSON = {
    type: 'FeatureCollection',
    features: connections.map(conn => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [conn.source, conn.target]
      },
      properties: {
        id: conn.id,
        timestamp: conn.timestamp
      }
    }))
  };

  // Paint property for agents - all agents same size
  const getAgentPaint = () => ({
    "circle-radius": 5, // Consistent size for all agents
    "circle-opacity": 0.9,
    "circle-color": ["get", "color"]
  });
  
  // Paint property for connection lines
  const getConnectionPaint = () => ({
    "line-color": "rgba(255, 0, 120, 0.5)",
    "line-width": 2,
    "line-opacity": 0.7
  });

  // Reset the simulation
  const handleReset = () => {
    const initialPeople = generatePeople(200, SF_BOUNDS);
    setPeople(initialPeople);
    setConnections([]);
    maxStatsRef.current = {
      infectedAgents: 1,
      infectionRate: 0.5
    };
    setStatistics({
      totalAgents: initialPeople.length,
      infectedAgents: 1,
      infectionRate: (1 / initialPeople.length * 100).toFixed(1)
    });
    setInfectionHistory([{ time: 0, infected: 1 }]);
    setCurrentTime(0);
    startTimeRef.current = Date.now();
  };

  // Adjust infection radius
  const handleRadiusChange = (e) => {
    setInfectionRadius(parseFloat(e.target.value));
  };

  // Calculate domain for x-axis
  const xAxisDomain = [0, Math.max(10, parseFloat(currentTime.toFixed(1)))];

  return (
    <>
      <Head>
        <title>One Bad Apple</title>
        <meta name="description" content="Agent Corruption in San Francisco" />
      </Head>

      <div className="map-container" style={{ position: 'relative', width: '100vw', height: '100vh' }}>
        <Map
          {...viewState}
          onMove={evt => setViewState(evt.viewState)}
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_API_KEY}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          attributionControl={false}
          dragRotate={false}
        >
          {/* Center marker */}
          <Source id="special-location" type="geojson" data={SPECIAL_LOCATION}>
            <Layer
              id="special-location-marker"
              type="circle"
              paint={{
                "circle-color": "#FFD700", // Gold color
                "circle-radius": 8,
                "circle-stroke-width": 2,
                "circle-stroke-color": "#B8860B", // Darker gold for the border
                "circle-opacity": 0.5
              }}
            />
          </Source>

          {/* Connection lines */}
          {!hidePeople && (
            <Source
              id="connections"
              type="geojson"
              data={connectionsGeoJSON}
            >
              <Layer
                id="connections-layer"
                type="line"
                paint={getConnectionPaint()}
              />
            </Source>
          )}

          {/* People/agents layer */}
          {!hidePeople && (
            <Source
              id="people"
              type="geojson"
              data={peopleGeoJSON}
            >
              <Layer
                id="people-layer"
                type="circle"
                paint={getAgentPaint()}
              />
            </Source>
          )}
        </Map>
        
        <div style={{ position: 'absolute', bottom: 20, left: 20, background: 'rgba(0,0,0,0.8)', padding: 15, borderRadius: 5, color: 'white', maxWidth: '300px' }}>
          <h3 style={{ margin: '0 0 10px 0' }}> One Bad Apple</h3>
          <p style={{ margin: '5px 0', color: maxStatsRef.current.infectionRate > 50 ? '#ff5555' : '#ffaa55' }}>
            Destabilized: {maxStatsRef.current.infectedAgents} agents ({maxStatsRef.current.infectionRate.toFixed(1)}%)
          </p>
          
          <div style={{ marginTop: 15, display: 'flex', gap: 10 }}>
            <button 
              onClick={() => setSimulationActive(!simulationActive)} 
              style={{ 
                padding: '5px 10px',
                backgroundColor: simulationActive ? '#4CAF50' : '#ff5555',
                border: 'none',
                borderRadius: 3,
                color: 'white',
                cursor: 'pointer',
                flex: 1
              }}
            >
              {simulationActive ? 'Pause' : 'Resume'}
            </button>
            <button 
              onClick={handleReset}
              style={{ 
                padding: '5px 10px',
                backgroundColor: '#4a90e2',
                border: 'none',
                borderRadius: 3,
                color: 'white',
                cursor: 'pointer',
                flex: 1
              }}
            >
              Reset
            </button>
          </div>
        </div>
        
        <div style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          width: '300px',
          height: '200px',
          borderRadius: 5,
          padding: '5px'
        }}>
          <LineChart
            width={300}
            height={200}
            data={infectionHistory}
            margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
          >
            <XAxis
              dataKey="time"
              stroke="rgba(255, 255, 255, 0.5)"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fontFamily: 'Inter, sans-serif' }}
              domain={xAxisDomain}
            />
            <YAxis
              stroke="rgba(255, 255, 255, 0.5)"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fontFamily: 'Inter, sans-serif' }}
              domain={[0, 'auto']}
            />
            <Line
              type="monotone"
              dataKey="infected"
              stroke="#ff5555"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </div>
      </div>
    </>
  );
}