import mapboxgl from 'https://cdn.skypack.dev/mapbox-gl';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken =
  'pk.eyJ1IjoibW9uaXJpZGRoYiIsImEiOiJjbXA5YXRwaXEwb29mMnFwdjE2c21yaWdjIn0.R7lZUy59cTHYykHkwsBQPg';

let timeFilter = -1;
let stations = [];
let trips = [];
let circles;
let radiusScale;

const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

const stationFlow = d3
  .scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);

  return date.toLocaleString('en-US', {
    timeStyle: 'short',
  });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) {
    return trips;
  }

  return trips.filter(trip => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);

    return (
      Math.abs(startedMinutes - timeFilter) <= 60 ||
      Math.abs(endedMinutes - timeFilter) <= 60
    );
  });
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    v => v.length,
    d => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    v => v.length,
    d => d.end_station_id
  );

  return stations.map(station => {
    const id = station.short_name;

    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;

    return station;
  });
}

function updateTimeDisplay() {
  timeFilter = Number(timeSlider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'block';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }

  updateScatterPlot();
}

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);

  return { cx: x, cy: y };
}

function updatePositions() {
  circles
    .attr('cx', d => getCoords(d).cx)
    .attr('cy', d => getCoords(d).cy);
}

function updateScatterPlot() {
  const filteredTrips = filterTripsByTime(trips, timeFilter);
  const filteredStations = computeStationTraffic(stations, filteredTrips);

  radiusScale
    .domain([0, d3.max(filteredStations, d => d.totalTraffic)])
    .range(timeFilter === -1 ? [2, 18] : [3, 30]);

  circles = circles
    .data(filteredStations, d => d.short_name)
    .join('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .attr('stroke', 'white')
    .attr('stroke-width', 1.5)
    .attr('fill-opacity', 0.55)
    .style('--departure-ratio', d => {
      if (d.totalTraffic === 0) {
        return 0.5;
      }

      return stationFlow(d.departures / d.totalTraffic);
    })
    .each(function (d) {
      d3.select(this).select('title').remove();

      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  updatePositions();
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/vis-society/labs/refs/heads/main/bikewatching/data/cambridge-bike-lanes.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });

  const stationData = await d3.json(
    'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
  );

  stations = stationData.data.stations;

  trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    trip => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    }
  );

  stations = computeStationTraffic(stations, trips);

  radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([2, 18]);

  const svg = d3.select('#map').append('svg');

  circles = svg
    .selectAll('circle')
    .data(stations, d => d.short_name)
    .join('circle');

  updateScatterPlot();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  timeSlider.addEventListener('input', updateTimeDisplay);

  updateTimeDisplay();
});