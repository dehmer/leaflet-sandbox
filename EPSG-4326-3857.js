#!/usr/bin/env node

// Vienna: WGS84 -> Pseudo Mercator
// Proj4
const proj4 = require('proj4')
const p = proj4('EPSG:4326', 'EPSG:3857').forward

const TILE_SIZE = 256
const DEG2RAD = Math.PI / 180
const R = 6378137
const MAX_LATITUDE = 85.0511287798 // arctan(sinh(π))
const BOUNDS = {
  xmin: -Math.PI * R, ymin: -Math.PI * R, // top/left
  xmax:  Math.PI * R, ymax:  Math.PI * R  // bottom/right
}

console.log('BOUNDS', BOUNDS)

const zoomLevel = 0 // 0..22
const scale = 1 << zoomLevel

const locations = {
  'Vienna': { longitude: 16.363449, latitude: 48.210033},
  'Chicago': { longitude: -87.64999999999998, latitude: 41.85}
}

console.log('zoomLevel', zoomLevel)
console.log('scale', scale)


const project = (longitude, latitude) => {

  // limit latitude to +/- 85.051 degrees
  const lat = Math.max(Math.min(MAX_LATITUDE, latitude), -MAX_LATITUDE)
  const sin = Math.sin(lat * DEG2RAD)

  const x = R * longitude * DEG2RAD
  const y = R * Math.log((1 + sin) / (1 - sin)) / 2
  return {x, y}
}

Object
  .entries(locations)
  .forEach(([name, coords]) => console.log(
    name,
    p([coords.longitude, coords.latitude]),
    project(coords.longitude, coords.latitude))
  )
